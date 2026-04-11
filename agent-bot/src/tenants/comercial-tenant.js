// ─── ComercialTenant: Tenant del agente comercial Sofi ───
// Hereda de BaseTenant y especializa toda la logica del flujo comercial:
// - Carga de planes/FAQ/funcionalidades/dolores/testimonios desde el CRM (GAS)
// - Carga de campañas activas y anuncios
// - Sync de clientes CRM existentes
// - Cache de leads para reconocer prospectos que vuelven
// - Recordatorios proactivos de pago (8-10 AM)
//
// Sub-fase 3.2 — Riesgo MEDIO (clase nueva, todavia NO se usa en produccion)
// El bot sigue corriendo con services/tenants.js viejo. Esta clase solo se carga
// cuando el TenantManager (sub-fase 3.4) la invoque.

const BaseTenant = require('./base-tenant');
const { loadClientConfig } = require('../services/sheets');
const api = require('../services/api');
const { isValidLicense } = require('../utils/license');

class ComercialTenant extends BaseTenant {
    constructor(id, definition) {
        super(id, definition);
        this.type = 'comercial';
        this._evolutionClient = null;
    }

    /**
     * Inyecta el cliente de Evolution API (para enviar recordatorios de pago).
     */
    setEvolutionClient(client) {
        this._evolutionClient = client;
    }

    // ─── Inicializacion ───

    /**
     * Carga inicial del tenant: config + datos comerciales.
     * Cada paso esta envuelto en try/catch para que un fallo aislado
     * no impida que el tenant se cargue.
     */
    async init() {
        if (!this.enabled) {
            this.log('info', 'Tenant deshabilitado, omitiendo.');
            return false;
        }

        this.log('info', `Inicializando tenant: ${this.displayName}...`);

        // 1. Cargar config base desde Google Sheets
        try {
            this.config = await loadClientConfig(this.sheetId);
            if (!this.config) {
                this.handleError('init/loadClientConfig', new Error('Config nula'));
                return false;
            }
        } catch (e) {
            this.handleError('init/loadClientConfig', e);
            return false;
        }

        // 2. Validar licencia
        if (!isValidLicense(this.config.status)) {
            this.log('warn', `Licencia INACTIVA (estado: ${this.config.status}). Omitiendo.`);
            return false;
        }

        // 3. Resolver crmUrl y datos comerciales por defecto
        this.crmUrl = this.crmUrl || this.config.crmBeautyosUrl;
        this.config.crmBeautyosUrl = this.crmUrl;
        this.config.nombreAgente = this.config.agentName || 'Sofi';
        this.config.paymentInstructions = this.config.paymentInstructions || 'Nequi / Daviplata / Transferencia Bancolombia';
        this.config.hasAnyAnticipo = false;

        // 4. Catalogos vacios por defecto (no aplican a comercial)
        this.registeredClients = {};
        this.pendingAppointments = {};
        this.promotionsCatalog = [];
        this.disponibilidadCatalog = [];
        this.colaboradoresCatalog = [];
        this.serviceGallery = {};
        this.promoUsage = {};
        this.festivosConfig = [];

        // 5. Cargar datos comerciales del CRM (planes, FAQ, etc)
        await this._safeRun('loadInfoComercial', () => this._loadInfoComercial());

        // 6. Cargar clientes CRM existentes
        await this._safeRun('loadClientesCRM', () => this._loadClientesCRM());

        // 7. Cargar cache de leads (para reconocer prospectos que vuelven)
        await this._safeRun('loadLeadsCache', () => this._loadLeadsCache());

        this.lastSync = new Date().toISOString();
        this.markHealthy();

        this.log('info', `Listo. Tipo: COMERCIAL | Agente: ${this.config.nombreAgente} | Planes: ${this.servicesCatalog.length} | FAQ: ${this.knowledgeCatalog.length} | Clientes CRM: ${Object.keys(this.clientesCRM).length}`);
        return true;
    }

    // ─── Sync periodico ───

    /**
     * Sync periodico: refresca config, info comercial, clientes CRM y leads.
     * Tambien ejecuta recordatorios de pago si es la franja horaria.
     */
    async sync() {
        this.log('info', 'Sincronizando datos comerciales desde CRM...');

        // 1. Refrescar config base
        await this._safeRun('sync/loadClientConfig', async () => {
            const config = await loadClientConfig(this.sheetId);
            if (config) {
                this.config = { ...this.config, ...config };
                this.config.crmBeautyosUrl = this.crmUrl || config.crmBeautyosUrl;
                this.config.nombreAgente = config.agentName || this.config.nombreAgente || 'Sofi';
            }
        });

        // 2. Refrescar info comercial (planes, FAQ, campañas, anuncios)
        await this._safeRun('sync/loadInfoComercial', () => this._loadInfoComercial());

        // 3. Refrescar clientes CRM
        await this._safeRun('sync/loadClientesCRM', () => this._loadClientesCRM());

        // 4. Refrescar cache de leads
        await this._safeRun('sync/loadLeadsCache', () => this._loadLeadsCache());

        // 5. Recordatorios de pago proactivos (solo entre 8-10 AM)
        await this._safeRun('sync/sendPaymentReminders', () => this._sendPaymentReminders());

        this.lastSync = new Date().toISOString();
        this.log('info', `Sync comercial completo. Planes: ${this.servicesCatalog.length}, FAQ: ${this.knowledgeCatalog.length}`);
    }

    // ─── Operaciones internas ───

    /**
     * Carga planes, FAQ, funcionalidades, dolores, testimonios, campañas y anuncios.
     */
    async _loadInfoComercial() {
        if (!this.crmUrl) return;

        const resp = await api.postToCRM(this.crmUrl, { action: 'getInfoComercial' });
        if (!resp || resp.error) return;

        // Transformar PLANES → servicesCatalog
        this.servicesCatalog = (resp.planes || []).map(p => ({
            id: p.ID || 'plan-' + (p.NOMBRE || '').toLowerCase().replace(/\s+/g, '-'),
            category: 'Plan',
            intent: `${p.NOMBRE} precio costo cuanto vale plan`,
            name: p.NOMBRE || 'Plan',
            response: `${p.DESCRIPCION || ''} — Mensual: $${Number(p.PRECIO_MENSUAL || 0).toLocaleString('es-CO')} / Anual: $${Number(p.PRECIO_ANUAL || 0).toLocaleString('es-CO')}`,
            timeMins: 0,
            price: Number(p.PRECIO_MENSUAL) || 0
        }));

        // FAQ + funcionalidades + dolores + testimonios → knowledgeCatalog
        const knowledge = [];
        (resp.faq || []).forEach(f => {
            knowledge.push({ intent: f.PREGUNTA || '', response: f.RESPUESTA || '', mediaType: '', url: '' });
        });
        (resp.funcionalidades || []).forEach(f => {
            knowledge.push({ intent: `que es ${f.TITULO} funcionalidad feature`, response: `${f.TITULO}: ${f.DESCRIPCION}`, mediaType: '', url: '' });
        });
        (resp.dolores || []).forEach(d => {
            knowledge.push({ intent: `problema ${d.TITULO}`, response: `Entendemos ese dolor: ${d.DESCRIPCION}. BeautyOS lo resuelve con automatizacion.`, mediaType: '', url: '' });
        });
        (resp.testimonios || []).forEach(t => {
            knowledge.push({ intent: `testimonio caso exito referencia`, response: `${t.NOMBRE} (${t.ROL}): "${t.TEXTO}"`, mediaType: '', url: '' });
        });

        // Condiciones comerciales
        const condiciones = resp.condiciones || {};
        if (condiciones.IMPLEMENTACION) {
            knowledge.push({
                intent: 'implementacion setup instalacion costo',
                response: `Implementacion: $${Number(condiciones.IMPLEMENTACION).toLocaleString('es-CO')}. ${condiciones.PROMO_LANZAMIENTO || ''}`,
                mediaType: '', url: ''
            });
        }
        this.knowledgeCatalog = knowledge;

        // Anuncios activos
        if (resp.anunciosActivos && resp.anunciosActivos.length > 0) {
            this.config.anunciosActivos = resp.anunciosActivos;
            this.log('info', `📰 Anuncios activos: ${resp.anunciosActivos.length}`);
        }

        // Campaña activa
        if (resp.campanaActiva) {
            this.config.campanaActiva = resp.campanaActiva;
            const cuposDisp = Math.max(0, Number(resp.campanaActiva.META_CLIENTES || 0) - Number(resp.campanaActiva.CLIENTES_ACTUALES || 0));
            this.config.cuposDisponibles = cuposDisp;
            this.log('info', `📢 Campaña activa: ${resp.campanaActiva.NOMBRE} — ${cuposDisp} cupos disponibles`);
        }
    }

    /**
     * Carga clientes CRM existentes en un map por whatsapp.
     */
    async _loadClientesCRM() {
        if (!this.crmUrl) return;

        const crmResp = await api.postToCRM(this.crmUrl, { action: 'getClientesCRM' });
        if (Array.isArray(crmResp)) {
            const map = {};
            crmResp.forEach(c => { if (c.whatsapp) map[c.whatsapp] = c; });
            this.clientesCRM = map;
            this.log('info', `📊 Sync comercial: ${Object.keys(map).length} clientes CRM`);
        }
    }

    /**
     * Carga cache de leads para reconocer prospectos que vuelven a escribir.
     */
    async _loadLeadsCache() {
        if (!this.crmUrl) return;

        const leadsResp = await api.postToCRM(this.crmUrl, { action: 'getLeads' });
        if (Array.isArray(leadsResp)) {
            this._leadsCache = leadsResp.map(l => ({
                whatsapp: String(l.WHATSAPP || '').trim(),
                nombre: l.NOMBRE_CONTACTO || '',
                negocio: l.NOMBRE_NEGOCIO || '',
                ciudad: l.CIUDAD || '',
                estado: l.ESTADO || 'NUEVO'
            }));
        }
    }

    /**
     * Envia recordatorios de pago proactivos a clientes con facturacion vencida o por vencer.
     * Solo se ejecuta entre 8-10 AM hora Colombia. Una vez por dia por cliente.
     */
    async _sendPaymentReminders() {
        if (!this._evolutionClient) return;

        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        const hora = now.getHours();
        if (hora < 8 || hora > 10) return;

        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (!this._paymentRemindersSent || this._paymentRemindersSent._date !== todayKey) {
            this._paymentRemindersSent = { _date: todayKey };
        }

        const clientes = Object.values(this.clientesCRM || {});
        let enviados = 0;

        for (const c of clientes) {
            if (!c.whatsapp || c.estado === 'SUSPENDIDO') continue;
            if (this._paymentRemindersSent[c.whatsapp]) continue;

            const diasGracia = c.diasGracia || 15;
            let msg = '';

            if (c.estadoPago === 'POR_VENCER' && (c.diasParaVencer <= 5 || c.diasParaVencer === 1)) {
                msg = `Hola ${c.nombre}! Soy Sofi de BeautyOS. Te escribo para recordarte que tu facturacion vence en ${c.diasParaVencer} dia(s) (${c.proxCobro}). Si ya pagaste, enviame el soporte por aqui. Si necesitas ayuda, estoy aqui!`;
            }

            if (c.estadoPago === 'VENCIDO' && c.diasMora > 0 && c.diasMora < diasGracia) {
                if (c.diasMora % 3 === 0 || c.diasMora === 1) {
                    msg = `Hola ${c.nombre}. Soy Sofi de BeautyOS. Tu facturacion tiene ${c.diasMora} dia(s) de mora. Para evitar la suspension del servicio, te pido realizar el pago lo antes posible. Puedes enviarme el comprobante por aqui. Cualquier duda estoy para ayudarte.`;
                }
            }

            if (c.estadoPago === 'VENCIDO' && c.diasMora >= (diasGracia - 3) && c.diasMora <= diasGracia) {
                const diasRestantes = diasGracia - c.diasMora;
                msg = `${c.nombre}, tu servicio BeautyOS sera suspendido en ${diasRestantes > 0 ? diasRestantes + ' dia(s)' : 'las proximas horas'} por falta de pago. Contactame urgente para resolver esta situacion.`;
            }

            if (msg) {
                try {
                    await this._evolutionClient.sendText(this.instanceName, c.whatsapp, msg);
                    this._paymentRemindersSent[c.whatsapp] = true;
                    enviados++;
                    this.log('info', `💰 Recordatorio pago enviado a ${c.nombre} (mora: ${c.diasMora || 0}d)`);
                    await new Promise(r => setTimeout(r, 5000));
                } catch (sendErr) {
                    this.log('error', `Error enviando recordatorio a ${c.whatsapp}: ${sendErr.message}`);
                }
            }
        }

        if (enviados > 0) {
            this.log('info', `💰 Recordatorios de pago: ${enviados} enviado(s)`);
        }
    }
}

module.exports = ComercialTenant;