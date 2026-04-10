// ─── Healthcheck + Alertas WhatsApp ───
// Monitorea salud de Evolution API, OpenAI y CRM cada 5 minutos.
// Envia alertas WhatsApp al admin cuando algo falla y cuando se recupera.

const axios = require('axios');
const OpenAI = require('openai').default || require('openai');

// Estado anti-spam: solo enviar 1 alerta cuando algo cae, 1 cuando se recupera
const lastState = {
    evolution: { healthy: true, lastAlertAt: null },
    whatsapp: {},   // por tenant: { healthy, lastAlertAt }
    openai: { healthy: true, lastAlertAt: null },
    crm: {}         // por tenant: { healthy, lastAlertAt, failCount }
};

let evolutionClient = null;
let getTenants = null;
let adminPhone = null;
let adminInstance = null;

function init({ evolution, tenantsGetter, alertPhone, alertInstance }) {
    evolutionClient = evolution;
    getTenants = tenantsGetter;
    adminPhone = alertPhone;
    adminInstance = alertInstance;
    console.log(`[healthcheck] Iniciado. Alertas se enviaran a ${adminPhone} via ${adminInstance}`);
}

// Envia mensaje al admin via Evolution. Silencioso si falla (no queremos loops).
async function sendAlert(text) {
    if (!evolutionClient || !adminPhone || !adminInstance) return;
    try {
        await evolutionClient.sendText(adminInstance, adminPhone, text);
        console.log(`[healthcheck] 📤 Alerta enviada: ${text.substring(0, 60)}...`);
    } catch (e) {
        console.error(`[healthcheck] No se pudo enviar alerta: ${e.message}`);
    }
}

// Marca un componente como caido. Solo envia alerta si antes estaba sano (anti-spam).
async function markUnhealthy(component, key, message) {
    const state = key ? (lastState[component][key] = lastState[component][key] || { healthy: true }) : lastState[component];
    if (state.healthy) {
        state.healthy = false;
        state.downSince = new Date();
        await sendAlert(message);
    }
}

// Marca un componente como sano. Solo envia alerta si antes estaba caido.
async function markHealthy(component, key, recoveryMessage) {
    const state = key ? (lastState[component][key] = lastState[component][key] || { healthy: true }) : lastState[component];
    if (!state.healthy) {
        const downtime = state.downSince ? Math.round((Date.now() - state.downSince.getTime()) / 60000) : 0;
        state.healthy = true;
        state.downSince = null;
        await sendAlert(`✅ ${recoveryMessage}\n⏱️ Downtime: ${downtime} min`);
    }
}

// ─── Checks individuales ───

async function checkWhatsApp(tenantId) {
    try {
        const state = await evolutionClient.getConnectionState(tenantId);
        const status = state?.state || state?.instance?.state || 'unknown';
        if (status === 'open') {
            await markHealthy('whatsapp', tenantId, `WhatsApp recuperado para ${tenantId}`);
            return true;
        } else {
            await markUnhealthy('whatsapp', tenantId,
                `🔴 *WhatsApp DESCONECTADO*\n\nTenant: ${tenantId}\nEstado: ${status}\n\n👉 Reconecta en:\nhttp://136.119.198.196:8080/manager`);
            return false;
        }
    } catch (e) {
        await markUnhealthy('whatsapp', tenantId,
            `🔴 *Error consultando WhatsApp*\n\nTenant: ${tenantId}\nError: ${e.message}`);
        return false;
    }
}

async function checkOpenAI(apiKey) {
    if (!apiKey) {
        await markUnhealthy('openai', null, '🔴 *OpenAI sin API Key configurada*');
        return false;
    }
    try {
        const openai = new OpenAI({ apiKey, timeout: 15000 });
        // Llamada minima para verificar que la API responde
        await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1
        });
        await markHealthy('openai', null, 'OpenAI API recuperada');
        return true;
    } catch (e) {
        const errMsg = e.message || 'Error desconocido';
        const isQuota = errMsg.includes('quota') || errMsg.includes('insufficient_quota') || e.status === 429;
        const isAuth = errMsg.includes('401') || e.status === 401;
        let alertText;
        if (isQuota) alertText = `🔴 *OpenAI sin créditos*\n\nLa API de OpenAI rechazó la llamada por quota agotada.\n\n👉 Recarga créditos en https://platform.openai.com`;
        else if (isAuth) alertText = `🔴 *OpenAI API Key inválida*\n\nVerifica CHATGPT_API_KEY_DEFAULT en CONFIGURACION.`;
        else alertText = `🟡 *OpenAI con problemas*\n\nError: ${errMsg.substring(0, 200)}`;
        await markUnhealthy('openai', null, alertText);
        return false;
    }
}

async function checkCRM(tenantId, crmUrl) {
    if (!crmUrl) return true;
    try {
        const response = await axios.post(crmUrl, { action: 'getInfoComercial' }, { timeout: 10000 });
        if (response.data && !response.data.error) {
            await markHealthy('crm', tenantId, `CRM (Google Sheets) recuperado para ${tenantId}`);
            // Reset fail counter
            if (lastState.crm[tenantId]) lastState.crm[tenantId].failCount = 0;
            return true;
        }
        throw new Error('CRM respondio con error');
    } catch (e) {
        const state = lastState.crm[tenantId] = lastState.crm[tenantId] || { healthy: true, failCount: 0 };
        state.failCount = (state.failCount || 0) + 1;
        // Solo alertar despues de 2 fallos seguidos (evita falsos positivos por timeouts puntuales)
        if (state.failCount >= 2 && state.healthy) {
            await markUnhealthy('crm', tenantId,
                `🟡 *CRM (Google Sheets) lento*\n\nTenant: ${tenantId}\nFallos consecutivos: ${state.failCount}\nError: ${e.message.substring(0, 150)}`);
        }
        return false;
    }
}

// ─── Loop principal ───

async function runHealthcheck() {
    if (!getTenants) return;
    const tenants = getTenants();
    if (!tenants || tenants.length === 0) return;

    for (const tenant of tenants) {
        // 1. WhatsApp
        await checkWhatsApp(tenant.id || tenant.instanceName);

        // 2. CRM (solo para tenants comerciales con crmUrl)
        if (tenant.crmUrl || tenant.config?.crmBeautyosUrl) {
            await checkCRM(tenant.id || tenant.instanceName, tenant.crmUrl || tenant.config?.crmBeautyosUrl);
        }
    }

    // 3. OpenAI (una sola vez, no por tenant)
    const firstTenant = tenants[0];
    const apiKey = firstTenant?.config?.openApiKey;
    if (apiKey) await checkOpenAI(apiKey);
}

function start(intervalMs = 300000) {
    // Primera ejecucion despues de 30s (dar tiempo al bot de inicializar)
    setTimeout(() => {
        runHealthcheck().catch(e => console.error('[healthcheck] Error en primer run:', e.message));
        // Luego cada N ms
        setInterval(() => {
            runHealthcheck().catch(e => console.error('[healthcheck] Error en run periodico:', e.message));
        }, intervalMs);
    }, 30000);
    console.log(`[healthcheck] Programado cada ${intervalMs / 60000} minutos (primer run en 30s)`);
}

// Estado actual para endpoint /health/full
function getStatus() {
    return {
        evolution: lastState.evolution,
        whatsapp: lastState.whatsapp,
        openai: lastState.openai,
        crm: lastState.crm,
        adminPhone: adminPhone ? adminPhone.substring(0, 6) + '****' : null
    };
}

module.exports = { init, start, runHealthcheck, getStatus, sendAlert };