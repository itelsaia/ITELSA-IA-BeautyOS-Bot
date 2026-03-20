// ── Motor de sincronizacion bidireccional Google Sheets <-> Excel local ──
// Patron de auth: reutiliza JWT de agent-bot/src/services/sheets.js
// Patron de push: reutiliza axios POST de agent-bot/src/services/api.js

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const axios = require('axios');
const fs = require('fs');

// Hojas a sincronizar (pull desde Google Sheets)
const SYNC_SHEETS = [
  'CONFIGURACION',
  'CLIENTES',
  'AGENDA',
  'CONFIG_SERVICIOS',
  'COLABORADORES',
  'DISPONIBILIDAD',
  'FESTIVOS_CONFIG'
];

class SyncService {
  constructor(config, excelService, queueService) {
    this.config = config;
    this.excel = excelService;
    this.queue = queueService;
    this.online = false;
    this.lastSync = null;
    this.lastError = null;
    this.syncing = false;
    this.auth = null;
    this._initAuth();
  }

  _initAuth() {
    try {
      const credsPath = this.config.credencialesPath;
      if (!fs.existsSync(credsPath)) {
        console.warn('[sync] Credenciales no encontradas:', credsPath);
        return;
      }
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      this.auth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
    } catch (err) {
      console.error('[sync] Error cargando credenciales:', err.message);
    }
  }

  async isOnline() {
    if (!this.auth || !this.config.sheetId) return false;
    try {
      const doc = new GoogleSpreadsheet(this.config.sheetId, this.auth);
      await doc.loadInfo();
      this.online = true;
      return true;
    } catch (err) {
      this.online = false;
      return false;
    }
  }

  async fullSync() {
    if (this.syncing) {
      console.log('[sync] Ya hay un sync en progreso, saltando');
      return { skipped: true };
    }
    this.syncing = true;

    try {
      const online = await this.isOnline();
      if (!online) {
        this.lastError = 'Sin conexion a Google Sheets';
        console.log('[sync] Offline, sync cancelado');
        return { online: false };
      }

      // 1. PUSH: enviar cambios locales a GAS
      const pushResult = await this.pushPendingQueue();

      // 2. PULL: descargar datos frescos de Google Sheets
      const pullResult = await this.pullAllData();

      // 3. Limpiar cola antigua
      await this.queue.clearOldSynced(100);

      this.lastSync = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
      this.lastError = null;
      console.log('[sync] Sync completo:', this.lastSync);

      return { online: true, push: pushResult, pull: pullResult, lastSync: this.lastSync };
    } catch (err) {
      this.lastError = err.message;
      console.error('[sync] Error en fullSync:', err.message);
      return { online: true, error: err.message };
    } finally {
      this.syncing = false;
    }
  }

  // ── PUSH: cola local → GAS webhook ──
  async pushPendingQueue() {
    const pending = this.queue.getPendingItems();
    if (pending.length === 0) return { pushed: 0 };

    const webhookUrl = this.config.webhookGasUrl;
    if (!webhookUrl || webhookUrl.includes('DEPLOY_ID')) {
      console.warn('[sync] webhookGasUrl no configurado, saltando push');
      return { pushed: 0, skipped: pending.length };
    }

    let pushed = 0, failed = 0;

    for (const item of pending) {
      try {
        const response = await axios.post(webhookUrl, {
          action: item.action,
          payload: item.payload
        }, { timeout: 15000 });

        const data = response.data;

        // GAS puede retornar HTML si el deploy esta desactualizado
        if (typeof data === 'string') {
          await this.queue.markFailed(item.queueId, 'GAS retorno HTML en vez de JSON');
          failed++;
          continue;
        }

        if (data && data.code === 200) {
          await this.queue.markSynced(item.queueId);
          pushed++;
          console.log('[sync] Pushed:', item.action, item.queueId);
        } else {
          await this.queue.markFailed(item.queueId, data.message || 'Error logico GAS');
          failed++;
        }
      } catch (err) {
        await this.queue.markFailed(item.queueId, err.message);
        failed++;
        console.error('[sync] Push failed:', item.queueId, err.message);
      }
    }

    return { pushed, failed, total: pending.length };
  }

  // ── PULL: Google Sheets → Excel local ──
  async pullAllData() {
    if (!this.auth) return { pulled: 0, error: 'Sin credenciales' };

    const doc = new GoogleSpreadsheet(this.config.sheetId, this.auth);
    await doc.loadInfo();

    let pulled = 0;

    for (const sheetName of SYNC_SHEETS) {
      try {
        const sheet = doc.sheetsByTitle[sheetName];
        if (!sheet) {
          console.warn('[sync] Hoja no encontrada en GS:', sheetName);
          continue;
        }

        await sheet.loadHeaderRow();
        const headers = sheet.headerValues;
        const rows = await sheet.getRows();

        // Convertir filas a arrays de valores
        const dataRows = rows.map(row => {
          return headers.map(h => {
            const val = row.get(h);
            return val !== undefined && val !== null ? val.toString() : '';
          });
        });

        await this.excel.replaceSheet(sheetName, headers, dataRows);
        pulled++;
        console.log('[sync] Pulled:', sheetName, '(' + dataRows.length + ' rows)');
      } catch (err) {
        console.error('[sync] Error pulling', sheetName + ':', err.message);
      }
    }

    await this.excel.save();
    return { pulled, total: SYNC_SHEETS.length };
  }

  // Primer arranque: intentar descargar todo de Google Sheets
  async initialSync() {
    console.log('[sync] Intentando sync inicial...');
    const online = await this.isOnline();
    if (!online) {
      console.log('[sync] Sin conexion. El CRM usara datos locales existentes.');
      return false;
    }
    const result = await this.pullAllData();
    this.lastSync = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    console.log('[sync] Sync inicial completo:', result.pulled, 'hojas descargadas');
    return true;
  }

  getStatus() {
    const queueStats = this.queue.getStats();
    return {
      online: this.online,
      syncing: this.syncing,
      lastSync: this.lastSync,
      lastError: this.lastError,
      pending: queueStats.pending,
      failed: queueStats.failed,
      synced: queueStats.synced
    };
  }
}

module.exports = { SyncService };
