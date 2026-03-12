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
            if (userPendingAppointments.length === 1) {
                const c = userPendingAppointments[0];
                complemento = `Recuerda que tienes una cita el *${c.fecha}* a las *${c.inicio}* para *${c.servicio}* con *${c.profesional || 'Por asignar'}* 📅✨\n\n¿Deseas hacer algo más o modificar tu cita?`;
            } else if (userPendingAppointments.length > 1) {
                const citasTexto = userPendingAppointments.map((c, i) =>
                    `${i + 1}. *${c.fecha}* a las *${c.inicio}* — ${c.servicio} con ${c.profesional || 'Por asignar'} (ID: ${c.id})`
                ).join('\n');
                complemento = `Tienes *${userPendingAppointments.length} citas* pendientes 📅✨:\n${citasTexto}\n\n¿Deseas agendar algo nuevo o modificar alguna cita?`;
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

        // ── Detectar intenciones: REAGENDAMIENTO, CANCELACIÓN, NUEVA CITA ──
        const msgNorm = messageText.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // Detectar intención de REAGENDAMIENTO — EXHAUSTIVO
        // Cubre: todas las formas verbales, typos, coloquialismos colombianos y combinaciones posibles
        const REAGENDAR_KEYWORDS = /reagend|regend|re.?agend|reprogramar|aplazar|postergar|posponer|recorrer|adelantar|atrasar/i;
        // NOTA: "arreglar" removido — en contexto de peluquería es servicio ("arreglo de cejas"), no intención de reagendar
        const REAGENDAR_COMBOS = /(cambiar|mover|correr|pasar|modificar|actualizar|editar|ajustar|acomodar|reorganizar|reacomodar|recuadrar|reubicar).*(cita|hora|fecha|turno|reserva|appointment)/i;
        const REAGENDAR_COMBOS_REV = /(cita|hora|fecha|turno|reserva|appointment).*(cambiar|mover|correr|pasar|modificar|actualizar|editar|ajustar|acomodar|reorganizar|reacomodar|recuadrar|reubicar|cambio|muevo|paso|mueva|pase|corra|cambie)/i;
        const REAGENDAR_FRASES = /otra hora|otro dia|otro horario|diferente hora|diferente dia|distinta hora|distinto dia|no me sirve.*(hora|dia|fecha)|no puedo a esa hora|puedo a otra|puede ser.*(mas temprano|mas tarde|otro dia|otra hora)|necesito cambiar|quiero cambiar|quisiera cambiar|me toca cambiar|toca cambiar|hay que cambiar|debo cambiar|podemos cambiar|se puede cambiar|sera que.*(cambiar|mover|otra hora)|como hago para (cambiar|mover)|cambiarla|cambiarle|moverla|moverle|correrla|pasarla|adelantarla|atrasarla|aplazarla|posponerla|reprogramarla|modificarla/i;

        if (REAGENDAR_KEYWORDS.test(messageText) || REAGENDAR_COMBOS.test(messageText) || REAGENDAR_COMBOS_REV.test(messageText) || REAGENDAR_FRASES.test(messageText)) {
            session.isReagendando = true;
            session.isCancelando = false;
            console.log(`[${instanceName}] 🔄 Modo reagendamiento ACTIVADO por: "${messageText.substring(0, 80)}"`);
        }

        // Detectar intención de CANCELACIÓN — EXHAUSTIVO
        const CANCELAR_REGEX = /cancelar.*(cita|turno|reserva)|(cita|turno|reserva).*cancelar|anular.*(cita|turno)|(cita|turno).*anular|eliminar.*(cita|turno)|borrar.*(cita|turno)|quitar.*(cita|turno)|no (puedo|voy|quiero|voya|pienso).*(ir|asistir|llegar)|ya no (puedo|voy|quiero)|no (ire|asistire|llegare)|cancelarla|anularla|eliminarla|quitarla|borrarla|deshacer.*(cita|turno)|quiero cancelar|quisiera cancelar|necesito cancelar|me toca cancelar|toca cancelar|como cancelo|como hago para cancelar/i;

        if (CANCELAR_REGEX.test(messageText)) {
            session.isCancelando = true;
            session.isReagendando = false;
            console.log(`[${instanceName}] ❌ Modo cancelación ACTIVADO por: "${messageText.substring(0, 80)}"`);
        }

        // Detectar si el usuario cambia a intención de NUEVA cita (desactiva todo)
        if (/\b(nueva cita|nuevo turno|agendar otra|quiero otra|otra cita)\b/i.test(messageText)) {
            session.isReagendando = false;
            session.isCancelando = false;
            console.log(`[${instanceName}] 🆕 Modo nueva cita (flags limpiados)`);
        }

        // Capturar ID de cita mencionado en el mensaje (para reagendamiento/cancelación)
        const idMatch = messageText.match(/AG-[A-Z]+-\d{3}/i);
        if (idMatch && (session.isReagendando || session.isCancelando)) {
            session.reagendandoCitaId = idMatch[0].toUpperCase();
            console.log(`[${instanceName}] 🎯 Cita objetivo: ${session.reagendandoCitaId}`);
        }

        // NO auto-asignar ID aquí. El usuario debe especificar cuál cita quiere reagendar.
        // El ID se captura cuando: (1) el usuario menciona AG-XXX, (2) la IA lo identifica en su respuesta,
        // o (3) como fallback al momento de CONFIRMAR si solo tiene 1 cita pendiente.

        // ── CONFIRMACIÓN DIRECTA: El código guarda/reagenda sin pasar por IA ──
        const CONFIRM_REGEX = /^(si+p?|ok[i]?|okey|okay|dale|de una|de una vez|confirmo|confirmado|confirmar|perfecto|de acuerdo|claro|listo|vale|aprobado|bueno|esta bien|por supuesto|obvio|sep|sepi|sipi|hagale|hagamosle|hagalo|vamos|sale|hecho|ya|venga|adelante|correcto|exacto|asi es|procede|agendame|agendeme|reservame|genial|super|excelente|me parece bien|me parece|va|eso|todo bien|agende|por fa|porfa|por favor|simon|aja|ajap|oki doki|okis|dale dale|dale pues|dale si|va pues|pues si|pues dale|listo pues|listo si|listo dale|eso es|eso si|claro si|claro que si|bueno si|bueno dale|venga pues|venga dale|ya dale|perfecto dale|si claro|si dale|si por favor|si porfa|si por fa|si gracias|si senora|si senor|ok dale|ok si|ok perfecto|ok listo|dale gracias|va va|dale va|ta bien|ta bueno|joya|bien|sisas|metale|mandele|reserva|agenda|haga|parce si|of course|yes|yep|yeah|sure)$/;
        const DENY_REGEX = /^(no+|nop[e]?|nel|nah|nada|no gracias|no quiero|no thanks|mejor no|dejalo|dejemoslo|cancelar?|olvidalo|olvida|paso|noo+|ni modo|para nada|negativo|nunca|jamas|nel pastel|no va|no dale|no seas)$/;

        // ── REAGENDAMIENTO DETERMINISTA (code-level) ──
        if (session.pendingReagendamiento && CONFIRM_REGEX.test(msgNorm)) {
            const reagData = session.pendingReagendamiento;
            session.pendingReagendamiento = null;
            session.pendingConfirmation = null;

            let citaId = session.reagendandoCitaId;

            // Si no hay citaId, intentar resolverlo automáticamente
            if (!citaId) {
                const userAppts = tenant.pendingAppointments[phoneNumber] || [];
                if (userAppts.length === 1) {
                    // Solo tiene 1 cita → usar esa
                    citaId = userAppts[0].id;
                    console.log(`[${instanceName}] 🎯 Auto-resuelto citaId (única cita): ${citaId}`);
                } else if (userAppts.length > 1) {
                    // Buscar en el historial de conversación por AG-XXX
                    const historyText = session.history.map(h => h.content || '').join(' ');
                    const histIdMatch = historyText.match(/AG-[A-Z]+-\d{3}/i);
                    if (histIdMatch) {
                        citaId = histIdMatch[0].toUpperCase();
                        console.log(`[${instanceName}] 🎯 Auto-resuelto citaId (del historial): ${citaId}`);
                    }
                }
                if (citaId) session.reagendandoCitaId = citaId;
            }

            if (citaId) {
                console.log(`✅ [${instanceName}] Reagendamiento directo: ${citaId} → ${reagData.fecha} ${reagData.hora_inicio}`);

                const exito = await api.rescheduleAgenda({
                    id: citaId,
                    nuevaFecha: reagData.fecha,
                    nuevoInicio: reagData.hora_inicio,
                    nuevoFin: reagData.hora_fin,
                    nuevosServicios: reagData.servicios,
                    nuevoPrecio: reagData.precio_total,
                    nuevoProfesional: reagData.profesional || 'Por asignar',
                    notasAdicionales: 'Reagendado vía bot WhatsApp'
                });

                let replyMsg;
                if (exito) {
                    replyMsg = `✅ *¡Tu cita ha sido reagendada exitosamente!* 💖\n\n` +
                        `📋 *Nuevos datos de tu cita (${citaId}):*\n` +
                        `· *Servicio:* ${reagData.servicios} ✂️\n` +
                        `· *Fecha:* ${reagData.fecha}\n` +
                        `· *Hora:* ${reagData.hora_inicio} a ${reagData.hora_fin}\n` +
                        `· *Profesional:* ${reagData.profesional}\n` +
                        `· *Precio:* $${Number(reagData.precio_total).toLocaleString('es-CO')}\n\n` +
                        `¡Te esperamos en tu nueva hora! 🌸✨`;
                    console.log(`✅ [${instanceName}] Cita ${citaId} reagendada exitosamente`);
                } else {
                    replyMsg = `❌ Hubo un problema al reagendar tu cita. Por favor intenta de nuevo. 🙏`;
                    console.error(`❌ [${instanceName}] Error al reagendar cita ${citaId}`);
                }

                session.isReagendando = false;
                session.reagendandoCitaId = null;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: replyMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, replyMsg);

                if (exito) {
                    tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);
                    const ownerPhone = tenant.config.ownerPhone;
                    if (ownerPhone) {
                        const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                        const notifMsg = `🔄 *Cita Reagendada*\n\n` +
                            `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                            `📱 Celular: ${phoneNumber}\n` +
                            `🆔 Cita: ${citaId}\n` +
                            `📅 Nueva fecha: ${reagData.fecha} de ${reagData.hora_inicio} a ${reagData.hora_fin}\n` +
                            `✂️ Servicio: ${reagData.servicios}\n` +
                            `👩‍💼 Profesional: ${reagData.profesional}\n` +
                            `💰 Precio: $${Number(reagData.precio_total).toLocaleString('es-CO')}\n` +
                            `🕐 Modificada: ${ahora}\n\n` +
                            `_Notificación automática de ${tenant.config.agentName || 'BeautyOS'}_`;
                        try {
                            await evolutionClient.sendText(instanceName, ownerPhone, notifMsg);
                        } catch (notifErr) {
                            console.error(`[${instanceName}] Error notificación reagendamiento:`, notifErr.message);
                        }
                    }
                }
                return;
            } else {
                // No hay ID de cita — pasar a IA para que pregunte cuál cita reagendar
                console.log(`[${instanceName}] Reagendamiento pendiente pero sin citaId. Pasando a IA.`);
                session.pendingReagendamiento = null;
            }
        } else if (session.pendingReagendamiento && !CONFIRM_REGEX.test(msgNorm)) {
            // ¿Es un rechazo explícito?
            if (DENY_REGEX.test(msgNorm)) {
                console.log(`[${instanceName}] Reagendamiento RECHAZADO por usuario: "${messageText}"`);
                session.pendingReagendamiento = null;
                session.isReagendando = false;
                session.reagendandoCitaId = null;
                const cancelMsg = `Entendido, no se reagendó ninguna cita. 😊\n\n¿En qué más te puedo ayudar?`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: cancelMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, cancelMsg);
                return;
            }
            // No es confirmación ni rechazo → re-preguntar (mantener datos)
            const rd = session.pendingReagendamiento;
            console.log(`[${instanceName}] Re-preguntando confirmación de reagendamiento. Mensaje no reconocido: "${messageText}"`);
            const reaskMsg = `¿Confirmas el reagendamiento de tu cita? 🤔\n\n` +
                `📋 *Resumen:*\n` +
                `· *Servicio:* ${rd.servicios}\n` +
                `· *Fecha:* ${rd.fecha}\n` +
                `· *Hora:* ${rd.hora_inicio} a ${rd.hora_fin}\n` +
                `· *Profesional:* ${rd.profesional}\n` +
                `· *Precio:* $${Number(rd.precio_total).toLocaleString('es-CO')}\n\n` +
                `Responde *sí* para confirmar o *no* para cancelar.`;
            session.history.push({ role: 'user', content: messageText });
            session.history.push({ role: 'assistant', content: reaskMsg });
            await evolutionClient.sendText(instanceName, phoneNumber, reaskMsg);
            return;
        }

        // ── NUEVA CITA CONFIRMACIÓN (code-level) ──
        if (session.pendingConfirmation) {
            if (CONFIRM_REGEX.test(msgNorm)) {
                const citaData = session.pendingConfirmation;
                session.pendingConfirmation = null;

                console.log(`✅ [${instanceName}] Confirmación directa detectada: "${messageText}" → Guardando cita via api.createAgenda()`);
                session.isReagendando = false;
                session.isCancelando = false;

                const agendaId = await api.createAgenda({
                    fecha: citaData.fecha,
                    inicio: citaData.hora_inicio,
                    fin: citaData.hora_fin,
                    cliente: userData.nombre || 'Cliente',
                    celularCliente: userData.celular || phoneNumber,
                    servicio: citaData.servicios,
                    precio: citaData.precio_total,
                    profesional: citaData.profesional || 'Por asignar',
                    notas: ''
                });

                let replyMsg;
                if (agendaId) {
                    replyMsg = `✅ *¡Tu cita ha sido agendada exitosamente!* 💖\n\n` +
                        `📋 *Resumen de tu cita:*\n` +
                        `· *Servicio:* ${citaData.servicios} ✂️\n` +
                        `· *Fecha:* ${citaData.fecha}\n` +
                        `· *Hora:* ${citaData.hora_inicio} a ${citaData.hora_fin}\n` +
                        `· *Profesional:* ${citaData.profesional}\n` +
                        `· *Precio:* $${Number(citaData.precio_total).toLocaleString('es-CO')}\n` +
                        `· *ID Cita:* ${agendaId}\n\n` +
                        `¡Te esperamos! 🌸✨`;
                    console.log(`✅ [${instanceName}] Cita guardada: ${agendaId}`);
                } else {
                    replyMsg = `❌ Hubo un problema al guardar tu cita. Por favor intenta de nuevo o escríbenos para ayudarte. 🙏`;
                    console.error(`❌ [${instanceName}] Error al guardar cita via api.createAgenda()`);
                }

                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: replyMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, replyMsg);

                if (agendaId) {
                    tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);
                    const ownerPhone = tenant.config.ownerPhone;
                    if (ownerPhone) {
                        const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                        const notifMsg = `📋 *Nueva Cita Agendada*\n\n` +
                            `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                            `📱 Celular: ${phoneNumber}\n` +
                            `📅 ${citaData.fecha} de ${citaData.hora_inicio} a ${citaData.hora_fin}\n` +
                            `✂️ Servicio: ${citaData.servicios}\n` +
                            `👩‍💼 Profesional: ${citaData.profesional}\n` +
                            `💰 Precio: $${Number(citaData.precio_total).toLocaleString('es-CO')}\n` +
                            `🆔 ID: ${agendaId}\n` +
                            `🕐 Registrada: ${ahora}\n\n` +
                            `_Notificación automática de ${tenant.config.agentName || 'BeautyOS'}_`;
                        try {
                            await evolutionClient.sendText(instanceName, ownerPhone, notifMsg);
                            console.log(`[${instanceName}] Notificación enviada a dueña (${ownerPhone})`);
                        } catch (notifErr) {
                            console.error(`[${instanceName}] Error notificación dueña:`, notifErr.message);
                        }
                    }
                }
                return;
            } else {
                // ¿Es un rechazo explícito?
                if (DENY_REGEX.test(msgNorm)) {
                    console.log(`[${instanceName}] Nueva cita RECHAZADA por usuario: "${messageText}"`);
                    session.pendingConfirmation = null;
                    const cancelMsg = `Entendido, no se agendó la cita. 😊\n\n¿En qué más te puedo ayudar?`;
                    session.history.push({ role: 'user', content: messageText });
                    session.history.push({ role: 'assistant', content: cancelMsg });
                    await evolutionClient.sendText(instanceName, phoneNumber, cancelMsg);
                    return;
                }
                // No es confirmación ni rechazo → re-preguntar (mantener datos)
                const cd = session.pendingConfirmation;
                console.log(`[${instanceName}] Re-preguntando confirmación de cita. Mensaje no reconocido: "${messageText}"`);
                const reaskMsg = `¿Confirmas tu cita? 🤔\n\n` +
                    `📋 *Resumen:*\n` +
                    `· *Servicio:* ${cd.servicios}\n` +
                    `· *Fecha:* ${cd.fecha}\n` +
                    `· *Hora:* ${cd.hora_inicio} a ${cd.hora_fin}\n` +
                    `· *Profesional:* ${cd.profesional}\n` +
                    `· *Precio:* $${Number(cd.precio_total).toLocaleString('es-CO')}\n\n` +
                    `Responde *sí* para confirmar o *no* para cancelar.`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: reaskMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, reaskMsg);
                return;
            }
        }

        // ── Respuesta de IA (OpenAI con Function Calling) ──
        let userPendingAppointments = [];
        let allPendingAppointments = [];
        try {
            const liveAppointments = await loadPendingAppointments(tenant.sheetId);
            userPendingAppointments = liveAppointments[phoneNumber] || [];
            tenant.pendingAppointments = liveAppointments;
            // Aplanar toda la agenda para que la IA vea espacios ocupados
            allPendingAppointments = Object.values(liveAppointments).flat();
        } catch (e) {
            userPendingAppointments = tenant.pendingAppointments[phoneNumber] || [];
            allPendingAppointments = Object.values(tenant.pendingAppointments || {}).flat();
        }

        const aiReply = await generateAIResponse(
            messageText,
            tenant.config,
            tenant.servicesCatalog,
            tenant.knowledgeCatalog,
            session.history,
            userData,
            userPendingAppointments,
            tenant.promotionsCatalog || [],
            tenant.disponibilidadCatalog || [],
            tenant.colaboradoresCatalog || [],
            allPendingAppointments,
            session
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

        // ── Capturar ID de cita de la respuesta IA (para reagendamiento/cancelación) ──
        if ((session.isReagendando || session.isCancelando) && !session.reagendandoCitaId) {
            const aiIdMatch = aiReply.match(/AG-[A-Z]+-\d{3}/i);
            if (aiIdMatch) {
                session.reagendandoCitaId = aiIdMatch[0].toUpperCase();
                console.log(`[${instanceName}] 🎯 Cita ID capturado de respuesta IA: ${session.reagendandoCitaId}`);
            }
        }

        // ── Detectar acción REAL en agenda (via _lastToolAction de openai.js) ──
        const toolAction = session._lastToolAction;
        if (toolAction === 'cita_creada' || toolAction === 'cita_reagendada') {
            console.log(`[${instanceName}] Acción en agenda via IA tool: ${toolAction}. Refrescando...`);
            session.isReagendando = false;
            session.isCancelando = false;
            session.reagendandoCitaId = null;
            session.pendingConfirmation = null;
            session.pendingReagendamiento = null;
            session._lastToolAction = null;
            tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);

            // ── Notificación WhatsApp a la dueña ──
            const ownerPhone = tenant.config.ownerPhone;
            if (ownerPhone) {
                const clienteNombre = userData.nombre || 'Cliente';
                const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                const notifMsg = `📋 *Actividad en Agenda*\n\n` +
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

        // ── Red de seguridad: si isReagendando/isCancelando pero la IA no avanzó, guiar al usuario ──
        if (session.isReagendando && !session.pendingReagendamiento && !session.pendingConfirmation && !toolAction) {
            // La IA respondió pero NO verificó disponibilidad ni guardó datos de reagendamiento
            // Verificar si la respuesta de la IA ya está guiando al usuario (preguntando cuál cita, qué hora, etc.)
            const iaEstaGuiando = /cu[aá]l cita|qu[eé] cita|qu[eé] hora|qu[eé] fecha|qu[eé] d[ií]a|selecciona|elige|escoge/i.test(aiReply);
            if (!iaEstaGuiando) {
                // La IA no está guiando al usuario — agregar guía complementaria
                const userAppts = tenant.pendingAppointments[phoneNumber] || [];
                if (userAppts.length === 0) {
                    console.log(`[${instanceName}] ⚠️ Reagendamiento activo pero usuario sin citas. Desactivando.`);
                    session.isReagendando = false;
                } else {
                    console.log(`[${instanceName}] ⚠️ Reagendamiento activo pero IA no avanzó. Recordando al usuario.`);
                }
            }
        }

        // Si se canceló una cita (via IA tool cancelar_cita), refrescar y notificar
        if (toolAction === 'cita_cancelada') {
            console.log(`[${instanceName}] Cancelación detectada via IA tool. Refrescando citas...`);
            session.isCancelando = false;
            session._lastToolAction = null;
            tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);

            const ownerPhone = tenant.config.ownerPhone;
            if (ownerPhone) {
                const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                const notifMsg = `🚫 *Cita Cancelada*\n\n` +
                    `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                    `📱 Celular: ${phoneNumber}\n` +
                    `🕐 Cancelada: ${ahora}\n\n` +
                    `📝 Detalle:\n${aiReply}\n\n` +
                    `_Notificación automática de ${tenant.config.agentName || 'BeautyOS'}_`;
                try {
                    await evolutionClient.sendText(instanceName, ownerPhone, notifMsg);
                    console.log(`[${instanceName}] Notificación de cancelación enviada a dueña`);
                } catch (notifErr) {
                    console.error(`[${instanceName}] Error notificación cancelación:`, notifErr.message);
                }
            }
        }

    } catch (error) {
        console.error('[WEBHOOK] Error procesando mensaje:', error.message);
    }
});

module.exports = { router, setEvolutionClient };
