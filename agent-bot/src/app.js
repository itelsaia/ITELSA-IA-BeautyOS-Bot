require('dotenv').config({ path: '../.env' });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const { loadClientConfig, loadServicesConfig, loadKnowledgeConfig, loadRegisteredClients } = require('./services/sheets');
const { generateAIResponse } = require('./services/openai');
const { handleOnboarding } = require('./services/session');
const { isValidLicense } = require('./utils/license');

// Objeto para almacenar la memoria a corto plazo por número de teléfono
const userSessions = {};


const main = async () => {
    console.log("⏳ Iniciando Agent Bot de BeautyOS (via whatsapp-web.js)...");

    // 1. Cargar Configuración Dinámica del Cliente desde el Master Sheet
    const sheetId = process.env.SHEET_ID_MASTER;
    let config = await loadClientConfig(sheetId);

    // Cargar Catálogo de Servicios (RAG)
    let servicesCatalog = await loadServicesConfig(sheetId);

    // Cargar Base de Conocimiento (RAG Multimedia)
    let knowledgeCatalog = await loadKnowledgeConfig(sheetId);

    // Cargar CRM Actual (Memoria de Clientes)
    let registeredClients = await loadRegisteredClients(sheetId);

    console.log("=== CATALOGO CARGADO ===");
    console.log(JSON.stringify(servicesCatalog, null, 2));
    console.log("========================");

    console.log("========================");

    console.log(`📚 Base de Conocimiento RAG cargada: ${knowledgeCatalog.length} recursos.`);
    console.log(`👥 Clientes registrados en memoria CRM: ${Object.keys(registeredClients).length}`);

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
        console.log(`======================================\n`);

        // Tarea en segundo plano: Refrescar Google Sheets cada 5 minutos
        setInterval(async () => {
            try {
                console.log("🔄 Sincronizando datos 'en caliente' desde Google Sheets (Catálogos y CRM)...");
                config = await loadClientConfig(sheetId);
                servicesCatalog = await loadServicesConfig(sheetId);
                knowledgeCatalog = await loadKnowledgeConfig(sheetId);
                registeredClients = await loadRegisteredClients(sheetId);
                console.log("✅ Memoria del Agente actualizada con éxito.");
            } catch (error) {
                console.error("⚠️ Error en la sincronización automática:", error.message);
            }
        }, 5 * 60 * 1000); // 300,000 milisegundos = 5 minutos
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

        // --- Flujo: Inteligencia Artificial y Memoria de Estado ---

        // 1. Inicializar sesión de memoria consultando la base CRM
        if (!userSessions[sender]) {
            const numeroTel = sender.split('@')[0];

            if (registeredClients[numeroTel]) {
                // El usuario ya existe en Google Sheets
                userSessions[sender] = {
                    history: [],
                    estado: 'REGISTRADO',
                    datos: registeredClients[numeroTel]
                };
            } else {
                // Es un usuario 100% nuevo
                userSessions[sender] = { history: [], estado: null, datos: null };
            }
        }

        // 2. Simular escritura en WhatsApp
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
        } catch (e) {
            console.error("⚠️ Error intentando mostrar 'escribiendo...'", e.message);
        }

        // 3. Ejecutar Máquina de Estados (Onboarding CRM)
        const sessionPayload = await handleOnboarding(sender, msg.body, userSessions[sender], config);

        if (!sessionPayload.isGpt) {
            // Si el estado no es GPT, la máquina de estados responde y corta el flujo.
            await msg.reply(sessionPayload.text);
            return;
        }

        // 4. Obtener respuesta inteligente a través del servicio OpenAI (Usuario Registrado)
        // Pasamos específicamente el history y el nombre
        const userName = userSessions[sender].datos ? userSessions[sender].datos.nombre : "Cliente";
        const aiReply = await generateAIResponse(msg.body, config, servicesCatalog, knowledgeCatalog, userSessions[sender].history, userName);

        // 5. Actualizar la memoria del chat GPT
        userSessions[sender].history.push({ role: 'user', content: msg.body });
        userSessions[sender].history.push({ role: 'assistant', content: aiReply });

        // 6. Economía de TOKENS LIMITADA (recordar solo últimos 6 mensajes)
        if (userSessions[sender].history.length > 6) {
            userSessions[sender].history.splice(0, 2);
        }

        // 7. Enviar mensaje de respuesta OpenAI
        await msg.reply(aiReply);
    });

    // Iniciar cliente
    client.initialize();
}

main();
