require('dotenv').config({ path: '../.env' });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const { exec } = require('child_process');

const { loadClientConfig, loadServicesConfig, loadKnowledgeConfig, loadRegisteredClients, loadPendingAppointments } = require('./services/sheets');
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

    // Cargar Citas PENDIENTES (contexto de agendamiento activo)
    let pendingAppointments = await loadPendingAppointments(sheetId);

    console.log("=== CATALOGO CARGADO ===");
    console.log(JSON.stringify(servicesCatalog, null, 2));
    console.log("========================");

    console.log(`📚 Base de Conocimiento RAG cargada: ${knowledgeCatalog.length} recursos.`);
    console.log(`👥 Clientes registrados en memoria CRM: ${Object.keys(registeredClients).length}`);
    console.log(`📅 Citas PENDIENTES cargadas para: ${Object.keys(pendingAppointments).length} cliente(s).`);

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
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-default-apps',
                '--disable-sync',
                '--metrics-recording-only',
                '--mute-audio',
                '--no-default-browser-check',
                '--safebrowsing-disable-auto-update'
            ],
            timeout: 60000
        }
    });

    // 4. Eventos del Cliente WhatsApp
    client.on('qr', async (qr) => {
        const qrPath = path.join(__dirname, '..', 'qr.png');
        try {
            await qrcode.toFile(qrPath, qr, { width: 400 });
            console.log('\n======================================');
            console.log('📱 QR GENERADO — Abre el archivo qr.png para escanear');
            console.log('📂 Ruta: ' + qrPath);
            console.log('======================================\n');
            // Abrir automáticamente la imagen en Windows
            exec(`start "" "${qrPath}"`);
        } catch (err) {
            console.error('❌ Error generando QR imagen:', err.message);
        }
    });

    client.on('ready', () => {
        console.log(`\n======================================`);
        console.log(`🤖 BOT CONECTADO Y LISTO`);
        console.log(`======================================\n`);

        // Tarea en segundo plano: Refrescar Google Sheets cada 5 minutos
        setInterval(async () => {
            try {
                console.log("🔄 Sincronizando datos 'en caliente' desde Google Sheets...");
                config = await loadClientConfig(sheetId);
                servicesCatalog = await loadServicesConfig(sheetId);
                knowledgeCatalog = await loadKnowledgeConfig(sheetId);
                registeredClients = await loadRegisteredClients(sheetId);
                pendingAppointments = await loadPendingAppointments(sheetId);
                console.log(`✅ Memoria del Agente actualizada. Citas PENDIENTES: ${Object.keys(pendingAppointments).length} cliente(s).`);
            } catch (error) {
                console.error("⚠️ Error en la sincronización automática:", error.message);
            }
        }, 5 * 60 * 1000);
    });

    client.on('authenticated', () => {
        console.log('✅ Autenticación exitosa.');
    });

    client.on('auth_failure', msg => {
        console.error('🔴 Falla en la autenticación:', msg);
    });

    // 5. Flujo Base (ChatGPT Integrado)
    client.on('message', async msg => {
        // Excluir estados e interacciones de grupos
        if (msg.from === 'status@broadcast' || msg.from.includes('@g.us')) return;

        const sender = msg.from;
        console.log(`💬 Nuevo mensaje de [Usuario ${sender.split('@')[0]}]: ${msg.body}`);

        // --- Flujo: Inteligencia Artificial y Memoria de Estado ---

        // 1. Inicializar sesión de memoria consultando la base CRM
        if (!userSessions[sender]) {
            const numeroTel = sender.split('@')[0];

            if (registeredClients[numeroTel]) {
                userSessions[sender] = {
                    history: [],
                    estado: 'REGISTRADO',
                    datos: registeredClients[numeroTel]
                };
            } else {
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
            await msg.reply(sessionPayload.text);
            return;
        }

        // 4. Preparar datos del usuario y citas pendientes para el contexto de la IA
        const numeroTel = sender.split('@')[0];
        const userData = userSessions[sender].datos
            ? { nombre: userSessions[sender].datos.nombre, celular: numeroTel }
            : { nombre: "Cliente", celular: numeroTel };

        // 4.1 Saludo cálido y personalizado para clientes REGISTRADOS en su primer mensaje de sesión
        const esClienteRegistrado = userSessions[sender].estado === 'REGISTRADO';
        const esNuevaSesion = userSessions[sender].history.length === 0;

        if (esClienteRegistrado && esNuevaSesion) {
            const primerNombre = userData.nombre.split(' ')[0];

            // Determinar saludo según hora del día (hora Colombia UTC-5)
            const horaColombia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' })).getHours();
            let saludo;
            if (horaColombia >= 5 && horaColombia < 12) saludo = 'buenos días';
            else if (horaColombia >= 12 && horaColombia < 18) saludo = 'buenas tardes';
            else saludo = 'buenas noches';

            // Fetch en vivo para evitar que cite citas que fueron borradas a mano en Google Sheets
            let userPendingAppointments = [];
            try {
                const sheetId = process.env.SHEET_ID_MASTER;
                const liveAppointments = await loadPendingAppointments(sheetId);
                userPendingAppointments = liveAppointments[numeroTel] || [];
                pendingAppointments = liveAppointments; // Update master cache
            } catch (e) {
                userPendingAppointments = pendingAppointments[numeroTel] || [];
            }

            // Consultar si tiene cita pendiente para personalizar más el mensaje
            const citasUsuario = userPendingAppointments;
            let complemento = '\u00bfEn qué te puedo ayudar hoy? \ud83c\udf38\u2728';
            if (citasUsuario.length > 0) {
                const c = citasUsuario[0];
                complemento = `Recuerda que tienes una cita el *${c.fecha}* a las *${c.inicio}* para *${c.servicio}* \ud83d\udcc5\u2728\n\n\u00bfDeseas hacer algo más o modificar tu cita?`;
            }

            const saludoPersonalizado = `\ud83c\udf1f \u00a1${saludo.charAt(0).toUpperCase() + saludo.slice(1)}, *${primerNombre}*! \ud83d\udc96 \u00a1Qué bueno verte por acá de nuevo!\n\n${complemento}`;

            // Inyectamos el saludo en el historial para que la IA tenga contexto
            userSessions[sender].history.push({ role: 'assistant', content: saludoPersonalizado });

            await msg.reply(saludoPersonalizado);
            return;
        }

        // Si no entró por el saludo cálido, necesitamos asegurar que tenemos las citas más recientes
        // (En caso de que NO haya entrado al bloque IF anterior)
        let userPendingAppointments = [];
        try {
            const sheetId = process.env.SHEET_ID_MASTER;
            const liveAppointments = await loadPendingAppointments(sheetId);
            userPendingAppointments = liveAppointments[numeroTel] || [];
            pendingAppointments = liveAppointments; // Update master cache
        } catch (e) {
            userPendingAppointments = pendingAppointments[numeroTel] || [];
        }
        // 5. Obtener respuesta inteligente a través del servicio OpenAI
        const aiReply = await generateAIResponse(
            msg.body,
            config,
            servicesCatalog,
            knowledgeCatalog,
            userSessions[sender].history,
            userData,
            userPendingAppointments
        );

        // 6. Actualizar la memoria del chat GPT
        userSessions[sender].history.push({ role: 'user', content: msg.body });
        userSessions[sender].history.push({ role: 'assistant', content: aiReply });

        // 7. Economía de TOKENS LIMITADA (recordar solo últimos 8 mensajes para agendamiento)
        if (userSessions[sender].history.length > 8) {
            userSessions[sender].history.splice(0, 2);
        }

        // 8. Enviar mensaje de respuesta OpenAI
        await msg.reply(aiReply);

        // 9. Si se acaba de ejecutar una cita nueva, refrescar los PENDIENTES en caliente
        if (aiReply.includes("AGD-")) {
            console.log("🔄 Refrescando citas PENDIENTES tras agendamiento...");
            pendingAppointments = await loadPendingAppointments(sheetId);
        }
    });

    // Iniciar cliente
    client.initialize();
}

main();
