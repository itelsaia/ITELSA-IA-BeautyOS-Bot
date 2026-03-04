require('dotenv').config({ path: '../.env' });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const { loadClientConfig, loadServicesConfig } = require('./services/sheets');
const { generateAIResponse } = require('./services/openai');
const { isValidLicense } = require('./utils/license');

// Objeto para almacenar la memoria a corto plazo por número de teléfono
const userSessions = {};


const main = async () => {
    console.log("⏳ Iniciando Agent Bot de BeautyOS (via whatsapp-web.js)...");

    // 1. Cargar Configuración Dinámica del Cliente desde el Master Sheet
    const sheetId = process.env.SHEET_ID_MASTER;
    const config = await loadClientConfig(sheetId);

    // Cargar Catálogo de Servicios (RAG)
    const servicesCatalog = await loadServicesConfig(sheetId);
    console.log("=== CATALOGO CARGADO ===");
    console.log(JSON.stringify(servicesCatalog, null, 2));
    console.log("========================");

    if (!config) {
        console.error("🔴 Abortando inicio. Fallo crítico leyendo Google Sheets.");
        process.exit(1);
    }

    // 2. Kill Switch: Verificación de Licencia
    if (!isValidLicense(config.status)) {
        console.log(`🔴 Licencia Suspendida o Inactiva [Estado Actual: ${config.status}]. El bot no iniciará flujos.`);
        process.exit(1);
    }

    console.log(`✅ Licencia ACTIVA. Cliente: ${config.businessName}`);

    // 3. Inicialización del Cliente WhatsApp con Sesión Local
    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: './bot_sessions' }),
        puppeteer: {
            executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    // 4. Eventos del Cliente WhatsApp
    client.on('qr', (qr) => {
        // Genera el código QR en la misma terminal para fácil escaneo
        console.log('\n======================================');
        console.log('📱 ESCANEA ESTE CÓDIGO QR PARA VINCULAR:');
        console.log('======================================\n');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        console.log(`\n======================================`);
        console.log(`🤖 BOT CONECTADO Y LISTO`);
        console.log(`Tono Configurado: ${config.tone}`);
        console.log(`======================================\n`);
    });

    client.on('authenticated', () => {
        console.log('✅ Autenticación exitosa.');
    });

    client.on('auth_failure', msg => {
        console.error('🔴 Falla en la autenticación:', msg);
    });

    // 5. Flujo Base (ChatGPT Integrado)
    client.on('message', async msg => {
        // Excluir estados e interacciones de grupos para evitar spam y consumo de tokens innecesario
        if (msg.from === 'status@broadcast' || msg.from.includes('@g.us')) return;

        const sender = msg.from;
        console.log(`💬 Nuevo mensaje de [Usuario ${sender.split('@')[0]}]: ${msg.body}`);

        // --- Flujo: Inteligencia Artificial (OpenAI) ---

        // 1. Inicializar sesión de memoria si es un usuario nuevo
        if (!userSessions[sender]) {
            userSessions[sender] = [];
        }

        // 2. Simular que un humano está escribiendo en el WhatsApp
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
        } catch (e) {
            console.error("⚠️ Error intentando mostrar 'escribiendo...'", e.message);
        }

        // 3. Obtener respuesta inteligente a través del servicio OpenAI
        const aiReply = await generateAIResponse(msg.body, config, servicesCatalog, userSessions[sender]);

        // 4. Actualizar el contexto en la memoria
        userSessions[sender].push({ role: 'user', content: msg.body });
        userSessions[sender].push({ role: 'assistant', content: aiReply });

        // 5. Economía de TOKENS LIMITADA: 
        // Recordará solo los últimos 6 mensajes (las 3 previas interacciones)
        if (userSessions[sender].length > 6) {
            userSessions[sender].splice(0, 2);
        }

        // 6. Enviar mensaje de respuesta
        await msg.reply(aiReply);
    });

    // Iniciar cliente
    client.initialize();
}

main();
