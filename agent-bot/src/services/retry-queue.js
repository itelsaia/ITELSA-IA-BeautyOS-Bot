// ─── RetryQueue: Cola de reintentos para llamadas al CRM ───
// Cuando una llamada al CRM falla, se encola y se reintenta cada N segundos
// con backoff exponencial. Persiste a disco para sobrevivir reinicios del bot.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const QUEUE_PATH = process.env.RETRY_QUEUE_PATH || path.join(__dirname, '../../data/failed_queue.json');
const INTERVAL_MS = parseInt(process.env.RETRY_QUEUE_INTERVAL_MS) || 30000;
const MAX_ATTEMPTS = parseInt(process.env.RETRY_QUEUE_MAX_ATTEMPTS) || 5;
const MAX_QUEUE_SIZE = parseInt(process.env.RETRY_QUEUE_MAX_SIZE) || 200;
const ALERT_THRESHOLD = parseInt(process.env.RETRY_QUEUE_ALERT_THRESHOLD) || 10;

// Acciones que NO se reintentan (lecturas no criticas)
const NON_RETRYABLE_ACTIONS = new Set([
    'getInfoComercial',
    'getClientesCRM',
    'getLeads',
    'getPanelData'
]);

let queue = [];           // Items pendientes en memoria
let failedFinal = [];     // Items que agotaron reintentos
let workerInterval = null;
let alertSentForSize = false;
let onAlertCallback = null;

// ─── Persistencia ───

function ensureDataDir() {
    const dir = path.dirname(QUEUE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function persist() {
    try {
        ensureDataDir();
        fs.writeFileSync(QUEUE_PATH, JSON.stringify({ queue, failedFinal }, null, 2));
    } catch (e) {
        console.error('[retry-queue] Error persistiendo a disco:', e.message);
    }
}

function load() {
    try {
        if (fs.existsSync(QUEUE_PATH)) {
            const data = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
            queue = data.queue || [];
            failedFinal = data.failedFinal || [];
            console.log(`[retry-queue] Cargados ${queue.length} items pendientes y ${failedFinal.length} fallidos desde ${QUEUE_PATH}`);
        }
    } catch (e) {
        console.error('[retry-queue] Error cargando desde disco:', e.message);
        queue = [];
        failedFinal = [];
    }
}

// ─── API publica ───

function isRetryable(action) {
    return !NON_RETRYABLE_ACTIONS.has(action);
}

function add(item) {
    // item = { url, payload, action, addedAt? }
    if (!item || !item.payload || !item.payload.action) return false;
    if (!isRetryable(item.payload.action)) return false;
    if (queue.length >= MAX_QUEUE_SIZE) {
        console.warn(`[retry-queue] ⚠️ Cola llena (${MAX_QUEUE_SIZE}). Descartando item: ${item.payload.action}`);
        return false;
    }

    const queueItem = {
        id: Date.now() + '-' + Math.random().toString(36).substring(2, 8),
        url: item.url,
        payload: item.payload,
        action: item.payload.action,
        addedAt: item.addedAt || new Date().toISOString(),
        attempts: 0,
        nextRetryAt: Date.now() + INTERVAL_MS,
        lastError: null
    };
    queue.push(queueItem);
    persist();
    console.log(`[retry-queue] 📥 Encolado: ${queueItem.action} (${queueItem.id}) — ${queue.length} pendientes`);

    // Alertar si la cola crece mucho
    if (queue.length >= ALERT_THRESHOLD && !alertSentForSize && onAlertCallback) {
        alertSentForSize = true;
        onAlertCallback(`🟡 *Cola de reintentos crecida*\n\nHay ${queue.length} items pendientes en la cola del CRM.\nEsto significa que Google Sheets esta lento o caido.\n\n👉 Verifica /health/queue en el servidor.`);
    }
    return true;
}

// Calcula proximo retry usando backoff exponencial: 30s, 1m, 2m, 5m, 10m
function calcBackoff(attempts) {
    const backoffs = [30000, 60000, 120000, 300000, 600000];
    return backoffs[Math.min(attempts, backoffs.length - 1)];
}

async function tryItem(item) {
    item.attempts++;
    try {
        const response = await axios.post(item.url, item.payload, { timeout: 25000 });
        if (response.data && response.data.error) {
            throw new Error(response.data.error);
        }
        console.log(`[retry-queue] ✅ Reintento exitoso: ${item.action} (${item.id}) en intento ${item.attempts}`);
        return true;
    } catch (e) {
        item.lastError = e.message;
        item.nextRetryAt = Date.now() + calcBackoff(item.attempts);
        console.log(`[retry-queue] ⚠️ Intento ${item.attempts}/${MAX_ATTEMPTS} fallo para ${item.action} (${item.id}): ${e.message}`);
        return false;
    }
}

async function processQueue() {
    if (queue.length === 0) return;
    const now = Date.now();
    const readyItems = queue.filter(i => i.nextRetryAt <= now);
    if (readyItems.length === 0) return;

    for (const item of readyItems) {
        const success = await tryItem(item);
        if (success) {
            queue = queue.filter(q => q.id !== item.id);
        } else if (item.attempts >= MAX_ATTEMPTS) {
            // Mover a fallido definitivo
            failedFinal.push({ ...item, failedAt: new Date().toISOString() });
            queue = queue.filter(q => q.id !== item.id);
            console.error(`[retry-queue] ❌ Fallido definitivo despues de ${MAX_ATTEMPTS} intentos: ${item.action} (${item.id})`);
            if (onAlertCallback) {
                onAlertCallback(`🔴 *Item fallo despues de ${MAX_ATTEMPTS} intentos*\n\nAccion: ${item.action}\nCliente: ${item.payload.whatsapp || item.payload.nombreContacto || 'N/A'}\nError: ${item.lastError}\n\n👉 Revisar manualmente en data/failed_queue.json`);
            }
        }
    }

    // Reset alerta si la cola se vacio
    if (queue.length < ALERT_THRESHOLD) alertSentForSize = false;

    persist();
}

function start(onAlert) {
    onAlertCallback = onAlert;
    load();
    if (workerInterval) clearInterval(workerInterval);
    workerInterval = setInterval(() => {
        processQueue().catch(e => console.error('[retry-queue] Error en worker:', e.message));
    }, INTERVAL_MS);
    console.log(`[retry-queue] Worker iniciado. Intervalo: ${INTERVAL_MS / 1000}s. Max intentos: ${MAX_ATTEMPTS}. Cola max: ${MAX_QUEUE_SIZE}`);
}

function stop() {
    if (workerInterval) {
        clearInterval(workerInterval);
        workerInterval = null;
    }
    persist();
}

function getStats() {
    return {
        pending: queue.length,
        failed: failedFinal.length,
        maxSize: MAX_QUEUE_SIZE,
        maxAttempts: MAX_ATTEMPTS,
        intervalMs: INTERVAL_MS,
        items: queue.map(i => ({
            id: i.id,
            action: i.action,
            attempts: i.attempts,
            addedAt: i.addedAt,
            nextRetryAt: new Date(i.nextRetryAt).toISOString(),
            lastError: i.lastError
        }))
    };
}

function getFailed() {
    return failedFinal;
}

function clearFailed() {
    failedFinal = [];
    persist();
}

async function forceRetry() {
    // Resetear nextRetryAt de todos a "ahora" para procesar inmediatamente
    queue.forEach(i => i.nextRetryAt = Date.now());
    await processQueue();
    return getStats();
}

module.exports = { add, start, stop, getStats, getFailed, clearFailed, forceRetry, isRetryable };