const fs = require('fs');
const path = require('path');
const { loadClientConfig, loadServicesConfig, loadKnowledgeConfig,
        loadRegisteredClients, loadPendingAppointments, loadPromotions } = require('./sheets');
const { isValidLicense } = require('../utils/license');

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

// Almacén en memoria de todos los tenants activos
const tenantStore = {};

/**
 * Lee las definiciones estáticas de tenants desde tenants.json
 */
function loadTenantDefinitions() {
    const tenantsPath = path.resolve(__dirname, '../../../tenants.json');
    const raw = fs.readFileSync(tenantsPath, 'utf-8');
    return JSON.parse(raw);
}

/**
 * Inicializa un solo tenant: carga todos los datos de Google Sheets
 * @param {string} tenantId Identificador del tenant (key en tenants.json)
 * @param {Object} tenantDef Definición estática del tenant
 */
async function initTenant(tenantId, tenantDef) {
    const { sheetId, webhookGasUrl, instanceName, displayName, enabled } = tenantDef;

    if (!enabled) {
        console.log(`[${tenantId}] Tenant deshabilitado, omitiendo.`);
        return null;
    }

    console.log(`[${tenantId}] Inicializando tenant: ${displayName}...`);

    const config = await loadClientConfig(sheetId);
    if (!config) {
        console.error(`[${tenantId}] Error cargando config del Sheet ${sheetId}. Omitiendo.`);
        return null;
    }

    if (!isValidLicense(config.status)) {
        console.log(`[${tenantId}] Licencia INACTIVA (estado: ${config.status}). Omitiendo.`);
        return null;
    }

    // Cargar todos los datos en paralelo para acelerar el arranque
    const [servicesCatalog, knowledgeCatalog, registeredClients, pendingAppointments, promotionsCatalog] =
        await Promise.all([
            loadServicesConfig(sheetId),
            loadKnowledgeConfig(sheetId),
            loadRegisteredClients(sheetId),
            loadPendingAppointments(sheetId),
            loadPromotions(sheetId)
        ]);

    const tenant = {
        ...tenantDef,
        config,
        servicesCatalog,
        knowledgeCatalog,
        registeredClients,
        pendingAppointments,
        promotionsCatalog,
        userSessions: {},
        syncInterval: null,
        lastSync: new Date().toISOString()
    };

    // Iniciar sincronización periódica con Google Sheets
    tenant.syncInterval = setInterval(async () => {
        await syncTenantData(tenantId);
    }, SYNC_INTERVAL_MS);

    tenantStore[tenantId] = tenant;

    const promosActivas = promotionsCatalog.filter(p => p.estado === 'ACTIVO').length;
    console.log(`[${tenantId}] Listo. Licencia: ACTIVA | Negocio: ${config.businessName} | CRM: ${Object.keys(registeredClients).length} clientes | Citas pendientes: ${Object.keys(pendingAppointments).length} cliente(s) | Promos activas: ${promosActivas}`);
    return tenant;
}

/**
 * Refresca los datos de un tenant desde Google Sheets
 */
async function syncTenantData(tenantId) {
    const tenant = tenantStore[tenantId];
    if (!tenant) return;

    try {
        console.log(`[${tenantId}] Sincronizando datos desde Google Sheets...`);
        const { sheetId } = tenant;

        const [config, servicesCatalog, knowledgeCatalog, registeredClients, pendingAppointments, promotionsCatalog] =
            await Promise.all([
                loadClientConfig(sheetId),
                loadServicesConfig(sheetId),
                loadKnowledgeConfig(sheetId),
                loadRegisteredClients(sheetId),
                loadPendingAppointments(sheetId),
                loadPromotions(sheetId)
            ]);

        tenant.config = config || tenant.config;
        tenant.servicesCatalog = servicesCatalog;
        tenant.knowledgeCatalog = knowledgeCatalog;
        tenant.registeredClients = registeredClients;
        tenant.pendingAppointments = pendingAppointments;
        tenant.promotionsCatalog = promotionsCatalog;
        tenant.lastSync = new Date().toISOString();

        console.log(`[${tenantId}] Sincronizacion completa.`);
    } catch (error) {
        console.error(`[${tenantId}] Error en sincronizacion:`, error.message);
    }
}

/**
 * Inicializa todos los tenants definidos en tenants.json
 * @returns {Array<string>} Lista de IDs de tenants activos
 */
async function initAllTenants() {
    const definitions = loadTenantDefinitions();
    const results = [];

    for (const [tenantId, tenantDef] of Object.entries(definitions)) {
        try {
            const tenant = await initTenant(tenantId, tenantDef);
            if (tenant) results.push(tenantId);
        } catch (error) {
            console.error(`[${tenantId}] Error fatal inicializando tenant:`, error.message);
        }
    }

    console.log(`\n=== ${results.length} tenant(s) inicializado(s) exitosamente ===\n`);
    return results;
}

/**
 * Obtiene un tenant por nombre de instancia
 * @param {string} instanceName Nombre de la instancia de Evolution API
 * @returns {Object|null} Datos del tenant o null si no existe
 */
function getTenant(instanceName) {
    return tenantStore[instanceName] || null;
}

/**
 * Retorna los IDs de todos los tenants activos
 */
function getActiveTenantIds() {
    return Object.keys(tenantStore);
}

/**
 * Limpia intervalos y recursos de todos los tenants (para shutdown)
 */
function shutdownAllTenants() {
    for (const [id, tenant] of Object.entries(tenantStore)) {
        if (tenant.syncInterval) {
            clearInterval(tenant.syncInterval);
        }
        console.log(`[${id}] Tenant detenido.`);
    }
}

module.exports = { initAllTenants, getTenant, getActiveTenantIds, syncTenantData, shutdownAllTenants };
