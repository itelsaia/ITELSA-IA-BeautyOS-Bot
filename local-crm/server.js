const express = require('express');
const path = require('path');
const fs = require('fs');

// ── Cargar configuracion ──
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('ERROR: config.json no encontrado. Ejecute install.bat primero.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// ── Inicializar servicios ──
const { ExcelService } = require('./services/excel');
const { QueueService } = require('./services/queue');
const { SyncService } = require('./services/sync');
const apiRoutes = require('./routes/api');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const excelPath = path.join(dataDir, 'beautyos.xlsx');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── Servir archivos estaticos ──
app.use(express.static(path.join(__dirname, 'public')));

// Estado global del servidor
let serverReady = false;
let syncInterval = null;

async function startServer() {
  try {
    // 1. Inicializar Excel
    const excel = new ExcelService(excelPath);
    await excel.init();

    // 2. Inicializar Queue
    const queue = new QueueService(excel);

    // 3. Inicializar Sync
    const syncConfig = {
      sheetId: config.sheetId,
      credencialesPath: path.resolve(__dirname, config.credencialesPath),
      webhookGasUrl: config.webhookGasUrl
    };
    const sync = new SyncService(syncConfig, excel, queue);

    // 4. Intentar sync inicial (descarga datos de Google Sheets si hay internet)
    await sync.initialSync();

    // 5. Montar API routes
    apiRoutes.init(excel, queue);
    app.use('/api', apiRoutes.router);

    // 6. Endpoints de sincronizacion
    app.post('/sync/force', async (req, res) => {
      try {
        const result = await sync.fullSync();
        res.json(result);
      } catch (err) {
        res.json({ error: err.message });
      }
    });

    app.get('/sync/status', (req, res) => {
      res.json(sync.getStatus());
    });

    // 7. Ruta raiz
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // 8. Auto-sync periodico
    const intervalMs = config.syncIntervalMs || 300000;
    syncInterval = setInterval(async () => {
      try {
        await sync.fullSync();
      } catch (err) {
        console.error('[server] Error en auto-sync:', err.message);
      }
    }, intervalMs);

    // 9. Iniciar servidor
    const port = config.port || 5000;
    app.listen(port, () => {
      serverReady = true;
      console.log('========================================');
      console.log('  BeautyOS CRM Local');
      console.log('  http://localhost:' + port);
      console.log('  Sync cada ' + (intervalMs / 60000) + ' minutos');
      console.log('========================================');

      // Auto-abrir navegador
      if (config.autoOpenBrowser !== false) {
        import('open').then(mod => mod.default('http://localhost:' + port)).catch(() => {
          console.log('Abra http://localhost:' + port + ' en su navegador');
        });
      }
    });

  } catch (err) {
    console.error('ERROR al iniciar servidor:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Cleanup al cerrar
process.on('SIGINT', () => {
  console.log('\nCerrando servidor...');
  if (syncInterval) clearInterval(syncInterval);
  process.exit(0);
});

startServer();
