require('dotenv').config({ path: '../.env' });
const express = require('express');

const EvolutionClient = require('./services/evolution');
const { initAllTenants, getActiveTenantIds, shutdownAllTenants } = require('./services/tenants');
const { router: webhookRouter, setEvolutionClient } = require('./routes/webhook');

const PORT = process.env.PORT || 3000;

const main = async () => {
    console.log("=== BeautyOS Agent Bot v2.0 (Evolution API - Multi-Tenant) ===\n");

    // 1. Inicializar cliente de Evolution API
    const evolutionClient = new EvolutionClient(
        process.env.EVOLUTION_API_URL || 'http://localhost:8080',
        process.env.EVOLUTION_API_KEY || 'beautyos-global-api-key-change-me'
    );
    setEvolutionClient(evolutionClient);

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

    // 4. Configurar servidor Express
    const app = express();
    app.use(express.json({ limit: '5mb' }));

    // Health check
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            version: '2.0.0',
            tenants: getActiveTenantIds(),
            uptime: Math.floor(process.uptime()) + 's'
        });
    });

    // Rutas de webhooks
    app.use('/webhook', webhookRouter);

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
        console.log(`Para desarrollo local con ngrok:`);
        console.log(`  1. ngrok http ${PORT}`);
        console.log(`  2. Actualizar WEBHOOK_GLOBAL_URL en evolution-api.env`);
        console.log(`  3. docker compose restart evolution-api\n`);
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
