// ─── SalonTenant: Tenant para salones de belleza (DEMO BeautyOS) ───
// Hereda de BaseTenant y especializa la logica de un salon:
// - Carga de servicios, colaboradores, jornadas, festivos, bloqueos, promociones
// - Gestion de citas pendientes y clientes registrados
// - Auto-expire de citas vencidas
// - Clasificacion automatica de clientes (cada 3 syncs)
// - Cumpleanos proactivos multi-envio
// - Recordatorios de citas 1 hora antes
// - Difusion de promociones del dia (10 reglas anti-bloqueo)
//
// Sub-fase 3.3 — Riesgo MEDIO en codigo, CERO en runtime
// El bot sigue corriendo con services/tenants.js viejo. Esta clase NO se importa todavia.

const BaseTenant = require('./base-tenant');
const {
    loadClientConfig, loadServicesConfig, loadKnowledgeConfig, loadServiceGallery,
    loadRegisteredClients, loadPendingAppointments, loadPromotions, loadDisponibilidad,
    loadColaboradores, loadExpiredAppointments, loadPromoUsage, loadFestivosConfig
} = require('../services/sheets');
const api = require('../services/api');
const { isValidLicense } = require('../utils/license');

// Constantes de difusion de promociones (anti-bloqueo WhatsApp)
const DIFUSION_LIMITES = {
    LIMITE_DIARIO_INSTANCIA: 50,
    DELAY_MIN: 5000,
    DELAY_MAX: 8000,
    MAX_PROMOS_DIA: 2,
    VENTANA_MINUTOS: 30,
    COOLDOWN_ENTRE_PROMOS: 10 * 60 * 1000,
    MAX_ERRORES_CONSECUTIVOS: 3
};

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

/**
 * Convierte URL de Google Drive a formato descarga directa para Evolution API.
 */
function convertDriveUrl(url) {
    if (!url) return url;
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match2) return `https://drive.google.com/uc?export=download&id=${match2[1]}`;
    return url;
}

const normalize = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

class SalonTenant extends BaseTenant {
    constructor(id, definition) {
        super(id, definition);
        this.type = 'salon';
        this._evolutionClient = null;
        this.syncCount = 0;
        this.birthdaySent = null;
        this.remindersSent = null;
    }

    setEvolutionClient(client) {
        this._evolutionClient = client;
    }

    // ─── Inicializacion ───

    async init() {
        if (!this.enabled) {
            this.log('info', 'Tenant deshabilitado, omitiendo.');
            return false;
        }

        this.log('info', `Inicializando tenant: ${this.displayName}...`);

        // 1. Cargar config base
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

        // 3. Cargar todos los catalogos en paralelo (cada uno aislado)
        await this._safeRun('loadAllCatalogs', () => this._loadAllCatalogs());

        this.config.hasAnyAnticipo = (this.servicesCatalog || []).some(s => s.anticipoEnabled);
        this.lastSync = new Date().toISOString();
        this.markHealthy();

        // Logs finales
        const promosActivas = (this.promotionsCatalog || []).filter(p => p.estado === 'ACTIVO').length;
        const jornadasConfig = (this.disponibilidadCatalog || []).filter(d => d.tipo === 'Jornada').length;
        const bloqueosConfig = (this.disponibilidadCatalog || []).filter(d => d.tipo === 'Bloqueo').length;
        const galeriaItems = Object.values(this.serviceGallery || {}).reduce((sum, arr) => sum + arr.length, 0);

        this.log('info', `Listo. Licencia: ACTIVA | Negocio: ${this.config.businessName} | CRM: ${Object.keys(this.registeredClients).length} clientes | Citas pendientes: ${Object.keys(this.pendingAppointments).length} cliente(s) | Promos activas: ${promosActivas} | Jornadas: ${jornadasConfig} dias | Bloqueos: ${bloqueosConfig} | Colaboradores: ${this.colaboradoresCatalog.length} | Galeria: ${galeriaItems} items en ${Object.keys(this.serviceGallery).length} servicios`);
        this.log('info', `⏱️ Tiempos: Slots cada ${this.config.slotInterval || 15}min | Buffer entre citas: ${this.config.bufferTime || 15}min`);

        if (this.colaboradoresCatalog.length > 0) {
            this.colaboradoresCatalog.forEach(c => {
                this.log('info', `  👤 ${c.nombre} (${c.rol}) → Competencias: ${c.competencias || '(sin definir)'}`);
            });
        }

        return true;
    }

    // ─── Sync periodico ───

    async sync() {
        this.log('info', 'Sincronizando datos desde Google Sheets...');

        // 1. Refrescar todos los catalogos
        const ok = await this._safeRun('sync/loadAllCatalogs', () => this._loadAllCatalogs());

        if (ok) {
            this.config.hasAnyAnticipo = (this.servicesCatalog || []).some(s => s.anticipoEnabled);
            this.lastSync = new Date().toISOString();
            this.log('info', 'Sincronizacion completa.');
        }

        // 2. Auto-expire de citas vencidas
        await this._safeRun('autoExpireAppointments', () => this._autoExpireAppointments());

        // 3. Clasificacion automatica de clientes (cada 3 syncs ~ 15 min)
        this.syncCount++;
        if (this.syncCount % 3 === 0) {
            await this._safeRun('classifyClientes', () => this._classifyClientes());
        }

        // 4. Cumpleanos proactivos
        await this._safeRun('sendBirthdayMessages', () => this._sendBirthdayMessages());

        // 5. Recordatorios de citas 1 hora antes
        await this._safeRun('checkAndSendReminders', () => this._checkAndSendReminders());

        // 6. Difusion de promociones del dia
        await this._safeRun('sendPromoBroadcasts', () => this._sendPromoBroadcasts());
    }

    // ─── Operaciones internas ───

    async _loadAllCatalogs() {
        const sheetId = this.sheetId;
        const [config, servicesCatalog, knowledgeCatalog, registeredClients, pendingAppointments,
            promotionsCatalog, disponibilidadCatalog, colaboradoresCatalog, serviceGallery,
            promoUsage, festivosConfig] = await Promise.all([
                loadClientConfig(sheetId),
                loadServicesConfig(sheetId),
                loadKnowledgeConfig(sheetId),
                loadRegisteredClients(sheetId),
                loadPendingAppointments(sheetId),
                loadPromotions(sheetId),
                loadDisponibilidad(sheetId),
                loadColaboradores(sheetId),
                loadServiceGallery(sheetId),
                loadPromoUsage(sheetId),
                loadFestivosConfig(sheetId)
            ]);

        if (config) this.config = config;
        this.servicesCatalog = servicesCatalog || [];
        this.knowledgeCatalog = knowledgeCatalog || [];
        this.registeredClients = registeredClients || {};
        this.pendingAppointments = pendingAppointments || {};
        this.promotionsCatalog = promotionsCatalog || [];
        this.disponibilidadCatalog = disponibilidadCatalog || [];
        this.colaboradoresCatalog = colaboradoresCatalog || [];
        this.serviceGallery = serviceGallery || {};
        this.promoUsage = promoUsage || {};
        this.festivosConfig = festivosConfig || [];
    }

    async _autoExpireAppointments() {
        const expirationMinutes = (this.config && this.config.expirationMinutes) || 30;
        const expiredAppointments = await loadExpiredAppointments(this.sheetId, expirationMinutes);

        if (expiredAppointments.length > 0) {
            this.log('info', `🕐 ${expiredAppointments.length} cita(s) vencida(s) encontrada(s). Auto-expire a RECHAZADO...`);
            api.webhookUrl = this.webhookGasUrl;

            for (const cita of expiredAppointments) {
                try {
                    const result = await api.updateAgendaStatus(cita.id, 'RECHAZADO');
                    if (result) {
                        this.log('info', `  ✅ ${cita.id} → RECHAZADO (${cita.fecha} ${cita.fin} - ${cita.servicio})`);
                    } else {
                        this.log('error', `  ❌ Error actualizando ${cita.id}`);
                    }
                } catch (expErr) {
                    this.log('error', `  ❌ Error en auto-expire ${cita.id}: ${expErr.message}`);
                }
            }

            // Refrescar pendingAppointments despues de auto-expire
            this.pendingAppointments = await loadPendingAppointments(this.sheetId);
        }
    }

    async _classifyClientes() {
        api.webhookUrl = this.webhookGasUrl;
        const classResult = await api.classifyClientes({
            ocasional: this.config.classifyOcasional || 1,
            frecuente: this.config.classifyFrecuente || 4,
            vip: this.config.classifyVip || 9
        });
        if (classResult.total > 0) {
            this.log('info', `Clasificacion: ${classResult.total} cliente(s) actualizado(s)`);
            classResult.updated.forEach(u => {
                this.log('info', `  ${u.celular}: ${u.oldTipo || 'Sin tipo'} → ${u.newTipo} (${u.citas} citas)`);
            });
        }
    }

    async _sendBirthdayMessages() {
        if (!this._evolutionClient) return;

        const cumplePromo = (this.promotionsCatalog || []).find(p =>
            p.tipoPromo === 'CUMPLEANOS' && p.estado === 'ACTIVO'
        );
        if (!cumplePromo) return;

        const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        // Parsear horas de envio desde APLICA_DIA (ej: "08:00,13:00,19:00")
        const rawHours = (cumplePromo.aplicaDia || '08:00').toString().trim();
        const sendHours = rawHours.split(',')
            .map(h => h.trim())
            .filter(h => /^\d{1,2}:\d{2}$/.test(h))
            .map(h => { const [hh, mm] = h.split(':').map(Number); return { h: hh, m: mm, label: h }; });
        if (sendHours.length === 0) sendHours.push({ h: 8, m: 0, label: '08:00' });

        if (!this.birthdaySent || this.birthdaySent.date !== todayKey) {
            this.birthdaySent = { date: todayKey, manana: false, hoy: {} };
        }

        const nowH = today.getHours();
        const nowM = today.getMinutes();

        const arrivedIndices = [];
        for (let i = 0; i < sendHours.length; i++) {
            if (nowH > sendHours[i].h || (nowH === sendHours[i].h && nowM >= sendHours[i].m)) {
                arrivedIndices.push(i);
            }
        }
        if (arrivedIndices.length === 0) return;

        const allowedTypes = cumplePromo.aplicaTipoCliente === 'TODOS'
            ? null
            : cumplePromo.aplicaTipoCliente.split(',').map(t => t.trim().toLowerCase());

        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dd2 = String(tomorrow.getDate()).padStart(2, '0');
        const mm2 = String(tomorrow.getMonth() + 1).padStart(2, '0');

        api.webhookUrl = this.webhookGasUrl;
        let bday = { hoy: [], manana: [] };
        try {
            bday = await api.getBirthdayClients(`${dd}/${mm}`, `${dd2}/${mm2}`);
        } catch (apiErr) {
            this.log('warn', `Cumpleanos: primer intento fallo (${apiErr.message}), reintentando en 5s...`);
            await new Promise(r => setTimeout(r, 5000));
            try {
                bday = await api.getBirthdayClients(`${dd}/${mm}`, `${dd2}/${mm2}`);
            } catch (retryErr) {
                this.log('error', `Cumpleanos: retry tambien fallo (${retryErr.message})`);
                return;
            }
        }

        let enviados = 0;

        // MANANA: 1 solo mensaje al llegar la primera hora
        if (!this.birthdaySent.manana && bday.manana && bday.manana.length > 0) {
            this.birthdaySent.manana = true;
            for (const c of bday.manana) {
                if (allowedTypes && !allowedTypes.includes((c.tipo || 'Nuevo').toLowerCase())) continue;
                await this._sendBirthdayMessage(c, 'manana', cumplePromo, 0, sendHours.length);
                enviados++;
            }
        }

        // HOY: multi-envio por cliente, se detiene si ya agendo
        if (bday.hoy && bday.hoy.length > 0) {
            const todayDDMMYYYY = `${dd}/${mm}/${today.getFullYear()}`;

            for (const c of bday.hoy) {
                if (allowedTypes && !allowedTypes.includes((c.tipo || 'Nuevo').toLowerCase())) continue;

                const clientAppts = this.pendingAppointments[c.celular] || [];
                const hasApptToday = clientAppts.some(a => a.fecha === todayDDMMYYYY);
                if (hasApptToday) {
                    this.log('info', `Cumpleanos: ${c.nombre} ya tiene cita hoy, omitiendo envios.`);
                    continue;
                }

                if (!this.birthdaySent.hoy[c.celular]) this.birthdaySent.hoy[c.celular] = [];
                const sentIndices = this.birthdaySent.hoy[c.celular];

                for (const idx of arrivedIndices) {
                    if (!sentIndices.includes(idx)) {
                        await this._sendBirthdayMessage(c, 'hoy', cumplePromo, idx, sendHours.length);
                        sentIndices.push(idx);
                        enviados++;
                    }
                }
            }
        }

        if (enviados > 0) {
            this.log('info', `Cumpleanos: ${enviados} mensaje(s) enviado(s) (horas: ${rawHours}, tipos: ${cumplePromo.aplicaTipoCliente})`);
        }
    }

    async _sendBirthdayMessage(cliente, timing, cumplePromo, sendIndex, totalSends) {
        if (!this._evolutionClient) return;
        const config = this.config;
        const descuento = cumplePromo.valorDescuento || 20;

        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        const targetDate = new Date(now);
        if (timing === 'manana') targetDate.setDate(targetDate.getDate() + 1);
        const diaNombre = DIAS_SEMANA[targetDate.getDay()];

        const jornadas = (this.disponibilidadCatalog || []).filter(d =>
            d.tipo === 'Jornada' && normalize(d.fechaDia) === normalize(diaNombre)
        );
        const horarioTexto = jornadas.length > 0 ? `${jornadas[0].horaIni} a ${jornadas[0].horaFin}` : '';
        const horarioInfo = horarioTexto ? ` Estamos disponibles de ${horarioTexto}.` : '';
        const diaLabel = timing === 'manana' ? 'manana ' + diaNombre : 'hoy ' + diaNombre;

        let mensaje = '';
        const negocio = config.businessName || 'nuestro negocio';
        const plantilla = (cumplePromo.descripcion || '').trim();

        if (plantilla) {
            mensaje = plantilla
                .replace(/\{nombre\}/gi, cliente.nombre)
                .replace(/\{negocio\}/gi, negocio)
                .replace(/\{descuento\}/gi, descuento + '%')
                .replace(/\{horario\}/gi, horarioTexto || 'nuestro horario habitual')
                .replace(/\{dia\}/gi, diaLabel);
        } else if (timing === 'manana') {
            mensaje = `🎂✨ ¡Hola *${cliente.nombre}*! ✨🎂\n\n¡Mañana es tu día especial! 🎉 En *${negocio}* queremos celebrar tu cumpleaños contigo y hacerte sentir increíble.\n\n🎁 Te tenemos preparado un regalo exclusivo: *${descuento}% de descuento* en el servicio que tú elijas.\n\n📌 *¿Cómo funciona?*\n1️⃣ Escríbenos *mañana* (el día de tu cumpleaños) para agendar tu cita\n2️⃣ Elige el servicio que más te guste\n3️⃣ El descuento del *${descuento}%* se aplica automáticamente al valor total de tu servicio\n\n⚠️ *Importante:* Esta promoción es válida *únicamente el día de tu cumpleaños*. ¡Agenda tu cita mañana para que no se te pase!${horarioInfo}\n\n👇 *Escribe "Quiero agendar" mañana y nosotros nos encargamos de todo.* ¡Te esperamos con los brazos abiertos! 💖🌸`;
        } else {
            const isFirst = sendIndex === 0;
            const isLast = sendIndex === totalSends - 1 && totalSends > 1;

            if (isFirst) {
                mensaje = `🎉🎂🥳 ¡¡FELIZ CUMPLEAÑOS *${cliente.nombre}*!! 🥳🎂🎉\n\n¡Hoy es tu gran día! 🌟 Todo el equipo de *${negocio}* te desea lo mejor y quiere celebrarlo contigo.\n\n🎁 *Tu regalo de cumpleaños:* ${descuento}% de descuento en el servicio que prefieras.\n\n📌 *¿Cómo usar tu descuento?*\n1️⃣ Escríbenos *hoy* y dinos qué servicio te gustaría\n2️⃣ Te ayudamos a agendar tu cita para hoy\n3️⃣ El *${descuento}%* se descuenta automáticamente del valor total de tu servicio\n\n⚠️ *Recuerda:* Este regalo es *exclusivo para hoy*, día de tu cumpleaños. Mañana ya no estará disponible.${horarioInfo}\n\n👇 *¡Responde ahora con el servicio que quieres y te agendamos al instante!* 📲💖\n_Ejemplo: "Quiero un tinte" o "Quiero diseño de cejas"_ ✨`;
            } else if (isLast) {
                mensaje = `⏰🎂 ¡*${cliente.nombre}*, última oportunidad! 🎂⏰\n\n¡Tu regalo de cumpleaños vence *hoy a medianoche*! 🕛\n\n🎁 Aún tienes tu *${descuento}% de descuento* exclusivo en *${negocio}*.\n\n📌 Solo escríbenos, elige tu servicio favorito y el descuento se aplica automáticamente al valor total.\n\n🚨 *¡Escríbenos YA antes de que termine el día!* Solo responde con el servicio que deseas y nosotros hacemos el resto. 📲\n_¡No dejes ir este regalo, ${cliente.nombre.split(' ')[0]}!_ 💖✨`;
            } else {
                mensaje = `✨🎂 ¡Hola *${cliente.nombre}*! 🎂✨\n\nRecuerda que *hoy* por tu cumpleaños tienes un *${descuento}% de descuento* exclusivo en *${negocio}*.${horarioInfo}\n\n📌 Solo escríbenos, elige el servicio que quieras y el descuento se aplica directo al precio. ¡Es automático!\n\n👇 *Responde con el servicio que te gustaría y te agendamos en minutos.* ⚡\n⚠️ Válido *solo hoy*. ¡Aprovéchalo! 📲💖`;
            }
        }

        try {
            await this._evolutionClient.sendText(this.instanceName, cliente.celular, mensaje);
            this.log('info', `Cumpleanos ${timing}[${sendIndex + 1}/${totalSends}]: enviado a ${cliente.nombre} (${cliente.celular}) [tipo: ${cliente.tipo}]`);

            // Enviar media visual de la promo si tiene configurada
            if (cumplePromo.tipoMediaPromo && cumplePromo.urlMediaPromo) {
                try {
                    const directUrl = convertDriveUrl(cumplePromo.urlMediaPromo);
                    const mediaType = cumplePromo.tipoMediaPromo === 'imagen' ? 'image' : cumplePromo.tipoMediaPromo === 'video' ? 'video' : 'document';
                    const fileName = cumplePromo.tipoMediaPromo === 'documento' ? (cumplePromo.nombre.replace(/[^a-zA-Z0-9 ]/g, '') + '.pdf') : '';
                    await new Promise(r => setTimeout(r, 1000));
                    await this._evolutionClient.sendMedia(this.instanceName, cliente.celular, mediaType, directUrl, '', fileName);
                    this.log('info', `Cumpleanos media enviada a ${cliente.nombre}`);
                } catch (mediaErr) {
                    this.log('error', `Error enviando media cumpleanos a ${cliente.celular}: ${mediaErr.message}`);
                }
            }
        } catch (err) {
            this.log('error', `Error enviando cumpleanos a ${cliente.celular}: ${err.message}`);
        }
    }

    async _checkAndSendReminders() {
        if (!this._evolutionClient) return;

        const configObj = this.config || {};
        const template = configObj.reminderMessage || '';
        if (!template) return;

        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        const todayDD = String(now.getDate()).padStart(2, '0');
        const todayMM = String(now.getMonth() + 1).padStart(2, '0');
        const todayYYYY = now.getFullYear();
        const todayStr = `${todayDD}/${todayMM}/${todayYYYY}`;
        const todayKey = `${todayYYYY}-${todayMM}-${todayDD}`;

        if (!this.remindersSent || this.remindersSent.date !== todayKey) {
            this.remindersSent = { date: todayKey, ids: new Set() };
        }

        const pendingAppts = this.pendingAppointments || {};
        const businessName = configObj.businessName || 'nuestro salon';
        let enviados = 0;

        for (const celular of Object.keys(pendingAppts)) {
            const citas = pendingAppts[celular];
            if (!Array.isArray(citas)) continue;

            for (const cita of citas) {
                if (this.remindersSent.ids.has(cita.id)) continue;
                if (cita.fecha !== todayStr) continue;

                const [horaH, horaM] = (cita.inicio || '00:00').split(':').map(Number);
                const citaMin = horaH * 60 + horaM;
                const nowMin = now.getHours() * 60 + now.getMinutes();
                const diffMin = citaMin - nowMin;

                const reminderMin = configObj.reminderMinutes || 60;
                if (diffMin < (reminderMin - 5) || diffMin > (reminderMin + 5)) continue;

                const mensaje = template
                    .replace(/\{cliente\}/g, cita.cliente || '')
                    .replace(/\{servicio\}/g, cita.servicio || '')
                    .replace(/\{hora\}/g, cita.inicio || '')
                    .replace(/\{profesional\}/g, cita.profesional || '')
                    .replace(/\{negocio\}/g, businessName);

                try {
                    await this._evolutionClient.sendText(this.instanceName, celular, mensaje);
                    this.remindersSent.ids.add(cita.id);
                    enviados++;
                    this.log('info', `🔔 Recordatorio enviado: ${cita.id} → ${celular} (${cita.servicio} a las ${cita.inicio})`);
                } catch (err) {
                    this.log('error', `Error enviando recordatorio ${cita.id}: ${err.message}`);
                }
            }
        }

        if (enviados > 0) {
            this.log('info', `🔔 ${enviados} recordatorio(s) enviado(s)`);
        }
    }

    async _sendPromoBroadcasts() {
        if (!this._evolutionClient) return;

        const L = DIFUSION_LIMITES;
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        const todayName = DIAS_SEMANA[now.getDay()];
        const nowMinutes = now.getHours() * 60 + now.getMinutes();

        // Verificar que hoy hay jornada (negocio abierto)
        const jornadas = (this.disponibilidadCatalog || []).filter(d =>
            d.tipo === 'Jornada' && normalize(d.fechaDia) === normalize(todayName)
        );
        if (jornadas.length === 0) return;

        const jornadaStart = jornadas[0].horaIni || '08:00';

        // Reset tracking si cambio el dia
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const todayKey = `${dd}/${mm}/${now.getFullYear()}`;

        if (!this.promoBroadcastsSent || this.promoBroadcastsSent._date !== todayKey) {
            this.promoBroadcastsSent = { _date: todayKey, _clientesHoy: {}, _totalHoy: 0 };
        }

        if ((this.promoBroadcastsSent._totalHoy || 0) >= L.LIMITE_DIARIO_INSTANCIA) return;

        // Filtrar promos elegibles
        const todayPromos = (this.promotionsCatalog || []).filter(p => {
            if (!p.difusionEnabled) return false;
            if (p.estado !== 'ACTIVO' || p.tipoPromo === 'CUMPLEANOS') return false;
            if (!p.aplicaDia || p.aplicaDia.trim() === '') return false;
            const dias = p.aplicaDia.split(',').map(d => d.trim());
            if (!dias.some(d => normalize(d) === normalize(todayName))) return false;
            if (p.vence) {
                const parts = p.vence.split('/');
                if (parts.length === 3) {
                    const venceDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), 23, 59, 59);
                    if (venceDate < now) return false;
                }
            }
            return true;
        });

        if (todayPromos.length === 0) return;

        const promosAProcesar = todayPromos.slice(0, L.MAX_PROMOS_DIA);
        const negocio = this.config.businessName || 'nuestro negocio';
        let totalEnviados = 0;
        let promoIndex = 0;

        for (const promo of promosAProcesar) {
            const horaEnvio = promo.horaDifusion || jornadaStart;
            const [envH, envM] = horaEnvio.split(':').map(Number);
            const envioMinutes = (envH || 0) * 60 + (envM || 0);
            if (nowMinutes < envioMinutes || nowMinutes > envioMinutes + L.VENTANA_MINUTOS) continue;

            const trackingKey = `${todayKey}:${promo.nombre}`;
            if (this.promoBroadcastsSent[trackingKey] && Object.keys(this.promoBroadcastsSent[trackingKey]).length > 0) continue;

            if (!this.promoBroadcastsSent[trackingKey]) {
                this.promoBroadcastsSent[trackingKey] = {};
            }
            const sentMap = this.promoBroadcastsSent[trackingKey];

            if (promoIndex > 0) {
                this.log('info', `Difusion: cooldown 10 min antes de promo "${promo.nombre}"`);
                await new Promise(r => setTimeout(r, L.COOLDOWN_ENTRE_PROMOS));
            }

            const allowedTypes = (!promo.aplicaTipoCliente || promo.aplicaTipoCliente === 'TODOS')
                ? null
                : promo.aplicaTipoCliente.split(',').map(t => t.trim().toLowerCase());

            const clientesHoy = this.promoBroadcastsSent._clientesHoy || {};

            const eligibleClients = Object.entries(this.registeredClients || {}).filter(([celular, client]) => {
                if (sentMap[celular]) return false;
                if (!client.nombre || client.nombre.trim() === '') return false;
                if (clientesHoy[celular]) return false;
                if (allowedTypes && !allowedTypes.includes((client.tipo || 'Nuevo').toLowerCase())) return false;
                return true;
            });

            const maxPromo = promo.maxEnviosDifusion || 20;
            const limiteRestante = L.LIMITE_DIARIO_INSTANCIA - (this.promoBroadcastsSent._totalHoy || 0);
            const batch = eligibleClients.slice(0, Math.min(maxPromo, limiteRestante));

            if (batch.length === 0) { promoIndex++; continue; }

            this.log('info', `Difusion: iniciando "${promo.nombre}" → ${batch.length} cliente(s)`);
            let erroresConsecutivos = 0;

            for (const [celular, client] of batch) {
                if (erroresConsecutivos >= L.MAX_ERRORES_CONSECUTIVOS) {
                    this.log('error', `Difusion DETENIDA: ${L.MAX_ERRORES_CONSECUTIVOS} errores consecutivos en "${promo.nombre}". Posible bloqueo.`);
                    break;
                }

                if ((this.promoBroadcastsSent._totalHoy || 0) >= L.LIMITE_DIARIO_INSTANCIA) {
                    this.log('warn', `Difusion DETENIDA: limite diario de ${L.LIMITE_DIARIO_INSTANCIA} mensajes alcanzado.`);
                    break;
                }

                try {
                    let mensaje;
                    if (promo.mensajeDifusion && promo.mensajeDifusion.trim() !== '') {
                        mensaje = promo.mensajeDifusion.replace(/\{nombre\}/gi, client.nombre);
                    } else {
                        let descuentoLabel = '';
                        if (promo.tipoPromo === 'PORCENTAJE') descuentoLabel = `${promo.valorDescuento}% de descuento`;
                        else if (promo.tipoPromo === '2X1') descuentoLabel = '2x1';
                        else if (promo.tipoPromo === 'VALOR_FIJO') descuentoLabel = `$${(promo.valorDescuento || 0).toLocaleString('es-CO')} de descuento`;
                        mensaje = `Hola *${client.nombre}*! Hoy es *${promo.nombre}* en *${negocio}*. ${promo.descripcion || ''}${descuentoLabel ? ' (' + descuentoLabel + ')' : ''}. Escribenos para agendar tu cita!`;
                    }

                    await this._evolutionClient.sendText(this.instanceName, celular, mensaje);
                    sentMap[celular] = true;
                    clientesHoy[celular] = true;
                    this.promoBroadcastsSent._totalHoy = (this.promoBroadcastsSent._totalHoy || 0) + 1;
                    totalEnviados++;
                    erroresConsecutivos = 0;

                    this.log('info', `Difusion OK: "${promo.nombre}" → ${celular} (${client.nombre})`);

                    if (promo.tipoMediaPromo && promo.urlMediaPromo) {
                        try {
                            const directUrl = convertDriveUrl(promo.urlMediaPromo);
                            const mediaType = promo.tipoMediaPromo === 'imagen' ? 'image'
                                : promo.tipoMediaPromo === 'video' ? 'video' : 'document';
                            const fileName = promo.tipoMediaPromo === 'documento'
                                ? (promo.nombre.replace(/[^a-zA-Z0-9 ]/g, '') + '.pdf') : '';
                            await new Promise(r => setTimeout(r, 1500));
                            await this._evolutionClient.sendMedia(this.instanceName, celular, mediaType, directUrl, '', fileName);
                        } catch (mediaErr) {
                            this.log('error', `Difusion media error (${celular}): ${mediaErr.message}`);
                        }
                    }

                    // Guardar en historial de conversacion
                    if (!this.userSessions) this.userSessions = {};
                    if (!this.userSessions[celular] && this.registeredClients && this.registeredClients[celular]) {
                        this.userSessions[celular] = {
                            history: [],
                            estado: 'REGISTRADO',
                            datos: this.registeredClients[celular]
                        };
                    }
                    if (this.userSessions[celular]) {
                        const hist = this.userSessions[celular].history;
                        const mediaNote = (promo.tipoMediaPromo && promo.urlMediaPromo) ? ` [Se envió imagen/video promocional de "${promo.nombre}". NO reenviar la imagen si el cliente responde.]` : '';
                        hist.push({ role: 'assistant', content: `[DIFUSION AUTOMATICA de promo "${promo.nombre}"] ${mensaje}${mediaNote}` });
                        if (hist.length > 8) hist.splice(0, 2);
                    }

                    const delay = L.DELAY_MIN + Math.floor(Math.random() * (L.DELAY_MAX - L.DELAY_MIN));
                    await new Promise(r => setTimeout(r, delay));
                } catch (sendErr) {
                    erroresConsecutivos++;
                    this.log('error', `Difusion error #${erroresConsecutivos} enviando a ${celular}: ${sendErr.message}`);
                }
            }

            promoIndex++;
        }

        if (totalEnviados > 0) {
            this.log('info', `Difusion promos completada: ${totalEnviados} mensaje(s) enviado(s) hoy`);
        }
    }
}

module.exports = SalonTenant;