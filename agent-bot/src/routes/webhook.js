const express = require('express');
const router = express.Router();

const { getTenant } = require('../services/tenants');
const { generateAIResponse } = require('../services/openai');
const { handleOnboarding } = require('../services/session');
const { loadPendingAppointments } = require('../services/sheets');
const api = require('../services/api'); // singleton — override webhookUrl por tenant

// Referencia al cliente de Evolution API (se inyecta desde app.js)
let evolutionClient = null;

function setEvolutionClient(client) {
    evolutionClient = client;
}

/**
 * POST /webhook/evolution
 * Punto de entrada principal para TODOS los eventos de Evolution API.
 * El webhook global enruta todos los eventos de todas las instancias aquí.
 */
router.post('/evolution', async (req, res) => {
    // Responder inmediatamente — Evolution API espera un 200 rápido
    res.status(200).json({ received: true });

    try {
        const { event, instance, data } = req.body;

        // ── Manejar eventos de conexión (log informativo) ──
        if (event === 'connection.update' || event === 'CONNECTION_UPDATE') {
            const state = data?.state || data?.connection || 'unknown';
            console.log(`[${instance}] Conexion: ${state}`);
            return;
        }

        // ── Manejar QR code (log informativo) ──
        if (event === 'qrcode.updated' || event === 'QRCODE_UPDATED') {
            console.log(`[${instance}] QR Code actualizado. Escanea desde Evolution Manager UI (http://localhost:8080).`);
            return;
        }

        // ── Solo procesar mensajes entrantes ──
        if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') return;
        if (!data || !data.key) return;
        if (data.key.fromMe) return; // Ignorar mensajes propios

        const remoteJid = data.key.remoteJid || '';

        // Excluir estados de broadcast y mensajes de grupos
        if (remoteJid === 'status@broadcast' || remoteJid.includes('@g.us')) return;

        // Extraer texto del mensaje (manejar ambos formatos)
        const messageText = data.message?.conversation
            || data.message?.extendedTextMessage?.text
            || '';
        if (!messageText) return; // Ignorar mensajes no-texto (imágenes, stickers, etc.)

        // ── Resolver tenant por nombre de instancia ──
        const tenant = getTenant(instance);
        if (!tenant) {
            console.warn(`[WEBHOOK] Instancia desconocida: ${instance}. Ignorando.`);
            return;
        }

        // Override del webhook URL del singleton api.js para este tenant
        api.webhookUrl = tenant.webhookGasUrl;

        const instanceName = tenant.instanceName;
        const phoneNumber = remoteJid.split('@')[0]; // "573145551234"

        console.log(`[${instanceName}] Mensaje de [${phoneNumber}]: ${messageText}`);

        // ── Inicializar sesión del usuario (misma lógica que app.js original) ──
        if (!tenant.userSessions[phoneNumber]) {
            if (tenant.registeredClients[phoneNumber]) {
                tenant.userSessions[phoneNumber] = {
                    history: [],
                    estado: 'REGISTRADO',
                    datos: tenant.registeredClients[phoneNumber]
                };
            } else {
                tenant.userSessions[phoneNumber] = { history: [], estado: null, datos: null };
            }
        }

        const session = tenant.userSessions[phoneNumber];

        // ── Máquina de Estados: Onboarding CRM ──
        const senderForSession = remoteJid; // Mantiene formato "573145551234@s.whatsapp.net"
        const sessionPayload = await handleOnboarding(senderForSession, messageText, session, tenant.config);

        if (!sessionPayload.isGpt) {
            await evolutionClient.sendText(instanceName, phoneNumber, sessionPayload.text);
            // Si el onboarding acaba de completarse, agregar al historial
            // para que el siguiente mensaje NO dispare el saludo de bienvenida
            if (session.estado === 'REGISTRADO') {
                session.history.push({ role: 'assistant', content: sessionPayload.text });
            }
            return;
        }

        // ── Datos del usuario para contexto de IA ──
        const userData = session.datos
            ? { nombre: session.datos.nombre, celular: phoneNumber }
            : { nombre: data.pushName || "Cliente", celular: phoneNumber };

        // ── Saludo cálido para clientes REGISTRADOS (primer mensaje de sesión) ──
        const esClienteRegistrado = session.estado === 'REGISTRADO';
        const esNuevaSesion = session.history.length === 0;

        if (esClienteRegistrado && esNuevaSesion) {
            const primerNombre = userData.nombre.split(' ')[0];

            const horaColombia = new Date(
                new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' })
            ).getHours();
            let saludo;
            if (horaColombia >= 5 && horaColombia < 12) saludo = 'buenos días';
            else if (horaColombia >= 12 && horaColombia < 18) saludo = 'buenas tardes';
            else saludo = 'buenas noches';

            // Fetch en vivo de citas pendientes
            let userPendingAppointments = [];
            try {
                const liveAppointments = await loadPendingAppointments(tenant.sheetId);
                userPendingAppointments = liveAppointments[phoneNumber] || [];
                tenant.pendingAppointments = liveAppointments;
            } catch (e) {
                userPendingAppointments = tenant.pendingAppointments[phoneNumber] || [];
            }

            let complemento = '¿En qué te puedo ayudar hoy? 🌸✨';
            if (userPendingAppointments.length > 0) {
                const c = userPendingAppointments[0];
                complemento = `Recuerda que tienes una cita el *${c.fecha}* a las *${c.inicio}* para *${c.servicio}* 📅✨\n\n¿Deseas hacer algo más o modificar tu cita?`;
            }

            // Promociones proactivas en el saludo
            const weekDays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
            const nowCol = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
            const hoyDia = weekDays[nowCol.getDay()];
            const promosHoy = (tenant.promotionsCatalog || []).filter(p => {
                if (p.estado !== 'ACTIVO') return false;
                if (p.vence) {
                    const parts = p.vence.split('/');
                    if (parts.length === 3) {
                        const venceDate = new Date(parts[2], parts[1] - 1, parts[0]);
                        venceDate.setHours(23, 59, 59);
                        if (venceDate < nowCol) return false;
                    }
                }
                if (p.aplicaDia && p.aplicaDia.trim() !== '') {
                    const dias = p.aplicaDia.split(',').map(d => d.trim().toLowerCase());
                    if (!dias.includes(hoyDia)) return false;
                }
                return true;
            });

            let promoTexto = '';
            if (promosHoy.length > 0) {
                promoTexto = '\n\n🎉 *Promociones de hoy:*\n' +
                    promosHoy.map(p => `• ${p.nombre}: ${p.descripcion}`).join('\n');
            }

            const saludoPersonalizado = `🌟 ¡${saludo.charAt(0).toUpperCase() + saludo.slice(1)}, *${primerNombre}*! 💖 ¡Qué bueno verte por acá de nuevo!\n\n${complemento}${promoTexto}`;

            session.history.push({ role: 'assistant', content: saludoPersonalizado });
            await evolutionClient.sendText(instanceName, phoneNumber, saludoPersonalizado);
            return;
        }

        // ── Respuesta de IA (OpenAI con Function Calling) ──
        let userPendingAppointments = [];
        try {
            const liveAppointments = await loadPendingAppointments(tenant.sheetId);
            userPendingAppointments = liveAppointments[phoneNumber] || [];
            tenant.pendingAppointments = liveAppointments;
        } catch (e) {
            userPendingAppointments = tenant.pendingAppointments[phoneNumber] || [];
        }

        const aiReply = await generateAIResponse(
            messageText,
            tenant.config,
            tenant.servicesCatalog,
            tenant.knowledgeCatalog,
            session.history,
            userData,
            userPendingAppointments,
            tenant.promotionsCatalog || []
        );

        // Actualizar historial de conversación
        session.history.push({ role: 'user', content: messageText });
        session.history.push({ role: 'assistant', content: aiReply });

        // Economía de tokens: mantener solo los últimos 8 mensajes
        if (session.history.length > 8) {
            session.history.splice(0, 2);
        }

        // Enviar respuesta de IA vía Evolution API
        await evolutionClient.sendText(instanceName, phoneNumber, aiReply);

        // Si se creó una cita nueva, refrescar citas pendientes y notificar a la dueña
        if (aiReply.includes("AG-")) {
            console.log(`[${instanceName}] Refrescando citas pendientes tras agendamiento...`);
            tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);

            // ── Notificación WhatsApp a la dueña ──
            const ownerPhone = tenant.config.ownerPhone;
            if (ownerPhone) {
                const clienteNombre = userData.nombre || 'Cliente';
                const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                const notifMsg = `📋 *Nueva Cita Agendada*\n\n` +
                    `👤 Cliente: *${clienteNombre}*\n` +
                    `📱 Celular: ${phoneNumber}\n` +
                    `🕐 Registrada: ${ahora}\n\n` +
                    `📝 Detalle del bot:\n${aiReply}\n\n` +
                    `_Notificación automática de ${tenant.config.agentName || 'BeautyOS'}_`;

                try {
                    await evolutionClient.sendText(instanceName, ownerPhone, notifMsg);
                    console.log(`[${instanceName}] Notificación enviada a dueña (${ownerPhone})`);
                } catch (notifErr) {
                    console.error(`[${instanceName}] Error enviando notificación a dueña:`, notifErr.message);
                }
            }
        }

    } catch (error) {
        console.error('[WEBHOOK] Error procesando mensaje:', error.message);
    }
});

module.exports = { router, setEvolutionClient };
