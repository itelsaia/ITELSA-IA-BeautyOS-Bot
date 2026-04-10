require('dotenv').config({ path: '../.env' });
const express = require('express');

const EvolutionClient = require('./services/evolution');
const { initAllTenants, getActiveTenantIds, getTenant, shutdownAllTenants, setEvolutionClient: setTenantsEvolutionClient } = require('./services/tenants');
const { router: webhookRouter, setEvolutionClient } = require('./routes/webhook');
const healthcheck = require('./services/healthcheck');

const PORT = process.env.PORT || 3000;

const main = async () => {
    console.log("=== BeautyOS Agent Bot v2.0 (Evolution API - Multi-Tenant) ===\n");

    // 1. Inicializar cliente de Evolution API
    const evolutionClient = new EvolutionClient(
        process.env.EVOLUTION_API_URL || 'http://localhost:8080',
        process.env.EVOLUTION_API_KEY || 'beautyos-global-api-key-change-me'
    );
    setEvolutionClient(evolutionClient);
    setTenantsEvolutionClient(evolutionClient);

    console.log(`Evolution API: ${process.env.EVOLUTION_API_URL || 'http://localhost:8080'}`);

    // 2. Inicializar todos los tenants (carga datos de Google Sheets + inicia sync)
    const activeTenants = await initAllTenants();

    if (activeTenants.length === 0) {
        console.error("No se encontraron tenants activos. Verifica tenants.json y la configuracion de los Sheets.");
        process.exit(1);
    }

    // 3. Verificar/crear instancias en Evolution API para cada tenant
    for (const tenantId of activeTenants) {
        try {
            const state = await evolutionClient.getConnectionState(tenantId);
            console.log(`[${tenantId}] Estado de conexion WhatsApp: ${state?.state || state?.instance?.state || 'desconocido'}`);
        } catch (e) {
            // Si la instancia no existe, crearla automáticamente
            console.log(`[${tenantId}] Instancia no encontrada. Creando en Evolution API...`);
            try {
                await evolutionClient.createInstance(tenantId);
                console.log(`[${tenantId}] Instancia creada. Escanea el QR desde http://localhost:8080`);
            } catch (createErr) {
                console.error(`[${tenantId}] Error creando instancia:`, createErr.message);
            }
        }
    }

    // 3.5. Inicializar healthcheck con alertas WhatsApp
    // ── GUARDRAIL: Monitoreo automatico ──
    // Que protege: Detecta caidas de WhatsApp/OpenAI/CRM y alerta al admin
    // Como funciona: Cada 5 min verifica componentes criticos. Anti-spam: solo 1 alerta por incidente.
    const adminPhone = process.env.ADMIN_ALERT_PHONE || '573017161000';
    const adminInstance = process.env.ADMIN_ALERT_INSTANCE || activeTenants[0];
    healthcheck.init({
        evolution: evolutionClient,
        tenantsGetter: () => getActiveTenantIds().map(id => {
            const t = getTenant(id);
            return t ? { id, instanceName: id, config: t.config, crmUrl: t.crmUrl } : null;
        }).filter(Boolean),
        alertPhone: adminPhone,
        alertInstance: adminInstance
    });
    healthcheck.start(parseInt(process.env.HEALTHCHECK_INTERVAL_MS) || 300000);

    // 4. Configurar servidor Express
    const app = express();
    app.use(express.json({ limit: '5mb' }));

    // Health check basico
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            version: '2.0.0',
            tenants: getActiveTenantIds(),
            uptime: Math.floor(process.uptime()) + 's'
        });
    });

    // Health check completo (estado de cada componente)
    app.get('/health/full', (req, res) => {
        res.json({
            status: 'ok',
            version: '2.0.0',
            tenants: getActiveTenantIds(),
            uptime: Math.floor(process.uptime()) + 's',
            components: healthcheck.getStatus()
        });
    });

    // Trigger manual del healthcheck (para testing)
    app.post('/health/check', async (req, res) => {
        try {
            await healthcheck.runHealthcheck();
            res.json({ status: 'ok', components: healthcheck.getStatus() });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Rutas de webhooks
    app.use('/webhook', webhookRouter);

    // Pagina QR para vincular WhatsApp (usado desde el CRM)
    app.get('/qr/:instanceName', async (req, res) => {
        const { instanceName } = req.params;
        try {
            const state = await evolutionClient.getConnectionState(instanceName);
            const isConnected = state?.state === 'open' || state?.instance?.state === 'open';

            if (isConnected) {
                return res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <title>WhatsApp Vinculado</title>
                <style>body{font-family:'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5;}
                .card{background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1);max-width:400px;}
                .check{font-size:64px;color:#25D366;margin-bottom:16px;}h2{color:#1a1a2e;margin:0 0 8px;}p{color:#666;margin:0 0 20px;}
                .btn{background:#25D366;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer;text-decoration:none;}
                .btn:hover{background:#1da851;}</style></head><body>
                <div class="card"><div class="check">&#10004;</div><h2>WhatsApp Vinculado</h2>
                <p>La instancia <strong>${instanceName}</strong> esta conectada correctamente.</p>
                <a href="javascript:window.close()" class="btn">Cerrar Ventana</a></div></body></html>`);
            }

            const qrData = await evolutionClient.getQrCode(instanceName);
            const qrBase64 = qrData?.base64 || qrData?.qrcode?.base64 || '';
            const qrPairingCode = qrData?.pairingCode || qrData?.code || '';

            res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <title>Vincular WhatsApp - ${instanceName}</title>
            <meta http-equiv="refresh" content="30">
            <style>body{font-family:'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5;}
            .card{background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1);max-width:450px;}
            h2{color:#1a1a2e;margin:0 0 8px;}p{color:#666;margin:0 0 16px;font-size:14px;}
            .qr-img{border:3px solid #25D366;border-radius:12px;padding:8px;background:#fff;max-width:280px;}
            .steps{text-align:left;background:#f8f9fa;border-radius:8px;padding:16px;margin:16px 0;font-size:13px;color:#555;}
            .steps li{margin-bottom:6px;}.code{background:#e8f5e9;padding:8px 16px;border-radius:8px;font-family:monospace;font-size:18px;letter-spacing:2px;color:#1a1a2e;display:inline-block;margin:8px 0;}
            .refresh{color:#888;font-size:12px;margin-top:12px;}</style></head><body>
            <div class="card"><h2>Vincular WhatsApp</h2>
            <p>Escanea el codigo QR con tu WhatsApp para vincular el agente IA</p>
            ${qrBase64 ? '<img src="' + (qrBase64.startsWith('data:') ? qrBase64 : 'data:image/png;base64,' + qrBase64) + '" alt="QR Code" class="qr-img">' : '<p style="color:#e74c3c;">No se pudo generar el QR. Intenta recargar la pagina.</p>'}
            ${qrPairingCode ? '<p style="margin-top:12px;">O usa el codigo de vinculacion:</p><div class="code">' + qrPairingCode + '</div>' : ''}
            <ol class="steps"><li>Abre WhatsApp en tu celular</li><li>Ve a <strong>Configuracion > Dispositivos vinculados</strong></li><li>Toca <strong>Vincular un dispositivo</strong></li><li>Escanea este codigo QR</li></ol>
            <p class="refresh">Esta pagina se actualiza automaticamente cada 30 segundos</p></div></body></html>`);

        } catch (error) {
            console.error(`[QR] Error generando pagina QR para ${instanceName}:`, error.message);
            res.status(500).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;">
            <h2>Error</h2><p>No se pudo conectar con Evolution API: ${error.message}</p>
            <p><a href="javascript:location.reload()">Reintentar</a></p></body></html>`);
        }
    });

    // ─── API: Enviar mensaje WhatsApp desde CRM ───
    app.post('/api/send-message', async (req, res) => {
        try {
            const { instanceName, number, text, apiKey } = req.body;

            if (!apiKey || apiKey !== process.env.BOT_API_KEY) {
                return res.status(401).json({ error: 'API key invalida' });
            }
            if (!instanceName || !number || !text) {
                return res.status(400).json({ error: 'Faltan parametros: instanceName, number, text' });
            }

            // Verificar que la instancia pertenece a un tenant activo
            const activeTenants = getActiveTenantIds();
            if (!activeTenants.includes(instanceName)) {
                return res.status(404).json({ error: 'Instancia no encontrada: ' + instanceName });
            }

            await evolutionClient.sendText(instanceName, number, text);
            res.json({ status: 'ok' });
        } catch (err) {
            console.error('[api] Error en /api/send-message:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // 404
    app.use((req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    // Error handler global
    app.use((err, req, res, next) => {
        console.error('Error no manejado en Express:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    });

    // 5. Iniciar servidor HTTP
    app.listen(PORT, () => {
        console.log(`\n======================================`);
        console.log(`Servidor HTTP escuchando en puerto ${PORT}`);
        console.log(`Webhook URL: http://localhost:${PORT}/webhook/evolution`);
        console.log(`Health check: http://localhost:${PORT}/health`);
        console.log(`======================================\n`);

        // Notificar al admin que el bot esta arriba (despues de 60s para que WhatsApp este listo)
        setTimeout(() => {
            healthcheck.sendAlert(`✅ *BeautyOS Bot iniciado*\n\nVersion: 2.0.0\nTenants activos: ${getActiveTenantIds().join(', ')}\nUptime: ${Math.floor(process.uptime())}s\n\nMonitoreo activo cada 5 minutos.`).catch(() => {});
        }, 60000);
    });

    // 6. Graceful shutdown
    const shutdown = () => {
        console.log('\nApagando BeautyOS Agent Bot...');
        shutdownAllTenants();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
};

main();
