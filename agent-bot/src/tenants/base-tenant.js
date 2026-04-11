// ─── BaseTenant: Clase base para todos los tenants ───
// Define la estructura común que todo tenant debe tener.
// Las clases hijas (SalonTenant, ComercialTenant) heredan y especializan.
//
// Esta clase es PASIVA: no toca el sistema actual. Solo define la forma.
// Sub-fase 3.1 — Riesgo cero (archivo nuevo, nadie lo importa todavía).

class BaseTenant {
    /**
     * @param {string} id - Identificador del tenant (ej: "beautyos-comercial")
     * @param {Object} definition - Definición desde tenants.json
     */
    constructor(id, definition) {
        // ── Identidad ──
        this.id = id;
        this.instanceName = definition.instanceName || id;
        this.displayName = definition.displayName || id;
        this.type = definition.type || 'salon';
        this.enabled = definition.enabled !== false;

        // ── Definición original ──
        this.definition = definition;
        this.sheetId = definition.sheetId || null;
        this.webhookGasUrl = definition.webhookGasUrl || null;
        this.crmUrl = definition.crmUrl || null;

        // ── Configuración cargada desde Google Sheets ──
        this.config = null;

        // ── Catálogos (cargan en init/sync) ──
        this.servicesCatalog = [];
        this.knowledgeCatalog = [];
        this.registeredClients = {};
        this.pendingAppointments = {};
        this.promotionsCatalog = [];
        this.disponibilidadCatalog = [];
        this.colaboradoresCatalog = [];
        this.serviceGallery = {};
        this.promoUsage = {};
        this.festivosConfig = [];
        this.clientesCRM = {};

        // ── Estado en runtime ──
        this.userSessions = {};
        this.promoBroadcastsSent = {};
        this._paymentRemindersSent = {};
        this._leadsCache = [];

        // ── Sync y healthcheck ──
        this.syncInterval = null;
        this.syncIntervalMs = definition.syncInterval || 5 * 60 * 1000;
        this.lastSync = null;
        this._isHealthy = true;
        this._lastError = null;
    }

    // ─── Métodos abstractos (cada hijo los implementa) ───

    /**
     * Inicialización del tenant. Carga config + catálogos.
     * Debe ser sobreescrito por la clase hija.
     */
    async init() {
        throw new Error(`init() no implementado en ${this.constructor.name}`);
    }

    /**
     * Sync periódico de datos. Cada hijo decide qué sincronizar.
     */
    async sync() {
        throw new Error(`sync() no implementado en ${this.constructor.name}`);
    }

    // ─── Métodos comunes ───

    /**
     * Programa el sync periódico cada `syncIntervalMs` milisegundos.
     */
    scheduleSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        this.syncInterval = setInterval(() => {
            this.sync().catch(e => this.handleError('sync periodico', e));
        }, this.syncIntervalMs);
        this.log('info', `Sync programado cada ${this.syncIntervalMs / 1000}s`);
    }

    /**
     * Limpia recursos al detener el tenant.
     */
    shutdown() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        this.log('info', 'Tenant detenido.');
    }

    /**
     * Logger etiquetado con el ID del tenant.
     * @param {'info'|'warn'|'error'} level
     * @param {string} message
     */
    log(level, message) {
        const prefix = `[${this.id}]`;
        if (level === 'error') console.error(`${prefix} ${message}`);
        else if (level === 'warn') console.warn(`${prefix} ${message}`);
        else console.log(`${prefix} ${message}`);
    }

    /**
     * Maneja errores de operaciones internas sin tirar el tenant.
     * @param {string} operation - Nombre de la operación que falló
     * @param {Error} error
     */
    handleError(operation, error) {
        this._lastError = { operation, message: error.message, at: new Date().toISOString() };
        this._isHealthy = false;
        this.log('error', `${operation} fallo: ${error.message}`);
    }

    /**
     * Marca el tenant como saludable después de una operación exitosa.
     */
    markHealthy() {
        if (!this._isHealthy) {
            this.log('info', 'Tenant recuperado.');
        }
        this._isHealthy = true;
        this._lastError = null;
    }

    /**
     * Indica si el tenant está sano (sin errores recientes).
     * @returns {boolean}
     */
    isHealthy() {
        return this._isHealthy;
    }

    /**
     * Retorna el último error registrado (útil para healthcheck).
     */
    getLastError() {
        return this._lastError;
    }

    /**
     * Helper para ejecutar una operación de sync sin que un fallo
     * interrumpa el resto. Cada operación queda aislada.
     *
     * @param {string} name - Nombre descriptivo de la operación
     * @param {Function} fn - Función async a ejecutar
     */
    async _safeRun(name, fn) {
        try {
            await fn();
            return true;
        } catch (e) {
            this.log('warn', `${name} fallo: ${e.message}`);
            return false;
        }
    }

    /**
     * Convierte el tenant a un objeto plano compatible con el wrapper viejo.
     * Esto se usa en sub-fase 3.5 cuando services/tenants.js delegue al manager.
     */
    toPlainObject() {
        return {
            id: this.id,
            instanceName: this.instanceName,
            displayName: this.displayName,
            type: this.type,
            enabled: this.enabled,
            sheetId: this.sheetId,
            webhookGasUrl: this.webhookGasUrl,
            crmUrl: this.crmUrl,
            config: this.config,
            servicesCatalog: this.servicesCatalog,
            knowledgeCatalog: this.knowledgeCatalog,
            registeredClients: this.registeredClients,
            pendingAppointments: this.pendingAppointments,
            promotionsCatalog: this.promotionsCatalog,
            disponibilidadCatalog: this.disponibilidadCatalog,
            colaboradoresCatalog: this.colaboradoresCatalog,
            serviceGallery: this.serviceGallery,
            promoUsage: this.promoUsage,
            festivosConfig: this.festivosConfig,
            clientesCRM: this.clientesCRM,
            userSessions: this.userSessions,
            promoBroadcastsSent: this.promoBroadcastsSent,
            _paymentRemindersSent: this._paymentRemindersSent,
            _leadsCache: this._leadsCache,
            syncInterval: this.syncInterval,
            lastSync: this.lastSync
        };
    }
}

module.exports = BaseTenant;