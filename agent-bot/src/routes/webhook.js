const express = require('express');
const router = express.Router();

const { getTenant } = require('../services/tenants');
const { generateAIResponse, analyzePaymentReceipt } = require('../services/openai');
const { handleOnboarding } = require('../services/session');
const { loadPendingAppointments } = require('../services/sheets');
const { transcribeAudio } = require('../services/whisper');
const api = require('../services/api'); // singleton — override webhookUrl por tenant

// Helper: Parsea campo CUMPLE en formato "dd/mm" o "15 de marzo"
const MESES_ES = { enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06', julio:'07', agosto:'08', septiembre:'09', octubre:'10', noviembre:'11', diciembre:'12' };
function parseCumpleDDMM(cumpleStr) {
    if (!cumpleStr) return '';
    const str = cumpleStr.toString().trim();
    const slashParts = str.split('/');
    if (slashParts.length >= 2 && !isNaN(slashParts[0]) && !isNaN(slashParts[1])) {
        return slashParts[0].padStart(2, '0') + '/' + slashParts[1].padStart(2, '0');
    }
    const match = str.toLowerCase().match(/(\d{1,2})\s*de\s*(\w+)/);
    if (match && MESES_ES[match[2]]) return match[1].padStart(2, '0') + '/' + MESES_ES[match[2]];
    return '';
}

// Helper: Convierte URLs de Google Drive a formato de descarga directa
function convertDriveUrl(url) {
    if (!url) return url;
    // Formato: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    // Formato: https://drive.google.com/open?id=FILE_ID
    const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match2) return `https://drive.google.com/uc?export=download&id=${match2[1]}`;
    return url; // Ya es URL directa
}

// Referencia al cliente de Evolution API (se inyecta desde app.js)
let evolutionClient = null;

/**
 * Calcula el anticipo total sumando los anticipos individuales de cada servicio.
 * @param {string} serviciosStr Nombres de servicios separados por coma
 * @param {Array} servicesCatalog Catálogo de servicios del tenant
 * @returns {{ anticipoEnabled: boolean, montoAnticipo: number }}
 */
function resolveAnticipoForServices(serviciosStr, servicesCatalog) {
    const serviceNames = serviciosStr.split(',').map(s => s.trim()).filter(Boolean);
    let totalAnticipo = 0;
    let anyEnabled = false;

    serviceNames.forEach(serviceName => {
        const serviceInfo = servicesCatalog.find(s =>
            s.name.toLowerCase().trim() === serviceName.toLowerCase().trim()
        );
        if (serviceInfo && serviceInfo.anticipoEnabled) {
            anyEnabled = true;
            const monto = serviceInfo.anticipoType === 'PORCENTAJE'
                ? Math.round(serviceInfo.price * serviceInfo.anticipoValue / 100)
                : serviceInfo.anticipoValue;
            totalAnticipo += monto;
        }
    });

    return { anticipoEnabled: anyEnabled, montoAnticipo: totalAnticipo };
}

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
        let messageText = data.message?.conversation
            || data.message?.extendedTextMessage?.text
            || '';

        // ── Soporte de audios: transcribir con Whisper ──
        const isAudio = !!(data.message?.audioMessage);
        if (isAudio && !messageText) {
            // Resolver tenant primero para obtener la API key de OpenAI
            const tenantForAudio = getTenant(instance);
            if (!tenantForAudio || !tenantForAudio.config?.openApiKey) {
                console.warn(`[WEBHOOK] Audio recibido pero sin tenant/apiKey para transcribir.`);
                return;
            }

            try {
                const audioBuffer = await evolutionClient.getMediaBase64(instance, data.key);
                if (audioBuffer) {
                    const transcription = await transcribeAudio(audioBuffer, tenantForAudio.config.openApiKey);
                    if (transcription) {
                        messageText = transcription;
                        console.log(`[${instance}] 🎤 Audio transcrito: "${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}"`);
                    } else {
                        // Transcripcion vacia — pedir que escriba
                        const phoneForAudio = (data.key.remoteJid || '').split('@')[0];
                        await evolutionClient.sendText(instance, phoneForAudio, '🎤 No pude entender tu audio. ¿Podrías escribirme tu mensaje por favor? 😊');
                        return;
                    }
                } else {
                    const phoneForAudio = (data.key.remoteJid || '').split('@')[0];
                    await evolutionClient.sendText(instance, phoneForAudio, '🎤 No pude procesar tu audio. ¿Podrías escribirme tu mensaje por favor? 😊');
                    return;
                }
            } catch (audioErr) {
                console.error(`[${instance}] Error procesando audio:`, audioErr.message);
                const phoneForAudio = (data.key.remoteJid || '').split('@')[0];
                await evolutionClient.sendText(instance, phoneForAudio, '🎤 Hubo un problema con tu audio. ¿Podrías escribirme tu mensaje por favor? 😊');
                return;
            }
        }

        // ── Detectar si el mensaje es una imagen (posible comprobante de pago) ──
        const isImage = !!(data.message?.imageMessage);
        const imageCaption = data.message?.imageMessage?.caption || '';

        if (!messageText && !isImage) return; // Ignorar mensajes sin texto, audio ni imagen (stickers, etc.)

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
            ? { nombre: session.datos.nombre, celular: phoneNumber, cumple: session.datos.cumple || '', tipo: session.datos.tipo || 'Nuevo', exentoAnticipo: session.datos.exemptFromPayment === true }
            : { nombre: data.pushName || "Cliente", celular: phoneNumber, cumple: '', tipo: 'Nuevo', exentoAnticipo: false };

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

            // Detectar cumpleanos del cliente HOY
            const nowCol = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
            const ddNowSaludo = String(nowCol.getDate()).padStart(2, '0');
            const mmNowSaludo = String(nowCol.getMonth() + 1).padStart(2, '0');
            let birthdayGreeting = '';
            const cumplePromoSaludo = (tenant.promotionsCatalog || []).find(p =>
                p.tipoPromo === 'CUMPLEANOS' && p.estado === 'ACTIVO'
            );
            if (cumplePromoSaludo && session.datos && session.datos.cumple) {
                const cumpleDDMM = parseCumpleDDMM(session.datos.cumple);
                if (cumpleDDMM === `${ddNowSaludo}/${mmNowSaludo}`) {
                    const descuentoBday = cumplePromoSaludo.valorDescuento || 20;
                    const negocioName = tenant.config.businessName || 'nuestro negocio';
                    const serviciosList = tenant.servicesCatalog.map(s => s.name).join(', ');
                    birthdayGreeting = `\n\n🎉🎂 *¡FELIZ CUMPLEAÑOS!* 🎂🎉\nHoy en *${negocioName}* tienes un *${descuentoBday}% de descuento* en el servicio que prefieras como regalo de cumpleaños. Aplica para: ${serviciosList}.\n\n📲 ¡Escríbeme el servicio que quieres y te ayudo a agendar tu cita de cumpleaños!`;
                }
            }

            // Promociones proactivas en el saludo
            const weekDays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
            const hoyDia = weekDays[nowCol.getDay()];
            const clientTipoSaludo = (session.datos && session.datos.tipo) ? session.datos.tipo : 'Nuevo';
            const promosHoy = (tenant.promotionsCatalog || []).filter(p => {
                if (p.estado !== 'ACTIVO') return false;
                if (p.tipoPromo === 'CUMPLEANOS') return false;
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
                if (p.aplicaTipoCliente && p.aplicaTipoCliente !== 'TODOS') {
                    const allowed = p.aplicaTipoCliente.split(',').map(t => t.trim().toLowerCase());
                    if (!allowed.includes(clientTipoSaludo.toLowerCase())) return false;
                }
                return true;
            });

            let promoTexto = '';
            let promoCTA = '';
            if (promosHoy.length > 0) {
                promoTexto = '\n\n🎉 *¡Promociones activas para hoy!*\n' +
                    promosHoy.map(p => {
                        let descLabel = '';
                        if (p.tipoPromo === 'PORCENTAJE') descLabel = `${p.valorDescuento}% de descuento`;
                        else if (p.tipoPromo === '2X1') descLabel = '2x1';
                        else if (p.tipoPromo === 'VALOR_FIJO') descLabel = `$${Number(p.valorDescuento).toLocaleString('es-CO')} de descuento`;
                        return `• *${p.nombre}*: ${descLabel} en ${p.aplicaServicio}`;
                    }).join('\n');
                promoCTA = '\n\n👇 *¿Te gustaría aprovechar alguna de estas promos y agendar tu cita?* 💖✨';
            }

            let saludoPersonalizado;
            if (birthdayGreeting) {
                saludoPersonalizado = `🎉🎂 ¡${saludo.charAt(0).toUpperCase() + saludo.slice(1)}, *${primerNombre}*! 🎂🎉 ¡Qué bueno verte en tu día especial!\n\n${complemento}${birthdayGreeting}${promoTexto}`;
            } else if (promosHoy.length > 0) {
                // Cuando hay promos, el saludo se enfoca en ellas
                const complementoSinGenerico = userPendingAppointments.length > 0 ? complemento + '\n' : '';
                saludoPersonalizado = `🌟 ¡${saludo.charAt(0).toUpperCase() + saludo.slice(1)}, *${primerNombre}*! 💖 ¡Qué bueno verte por acá de nuevo!\n\n${complementoSinGenerico}${promoTexto}${promoCTA}`;
            } else {
                saludoPersonalizado = `🌟 ¡${saludo.charAt(0).toUpperCase() + saludo.slice(1)}, *${primerNombre}*! 💖 ¡Qué bueno verte por acá de nuevo!\n\n${complemento}`;
            }

            session.history.push({ role: 'assistant', content: saludoPersonalizado });
            await evolutionClient.sendText(instanceName, phoneNumber, saludoPersonalizado);

            // Enviar media visual de promos del dia si tienen
            const mediaEnviadaEnSaludo = [];
            for (const p of promosHoy) {
                console.log(`[${instanceName}] Promo "${p.nombre}" media: tipo=${p.tipoMediaPromo || 'NONE'}, url=${p.urlMediaPromo ? 'SI' : 'NO'}`);
                if (p.tipoMediaPromo && p.urlMediaPromo) {
                    try {
                        const directUrl = convertDriveUrl(p.urlMediaPromo);
                        const mediaType = p.tipoMediaPromo === 'imagen' ? 'image' : p.tipoMediaPromo === 'video' ? 'video' : 'document';
                        const fileName = p.tipoMediaPromo === 'documento' ? (p.nombre.replace(/[^a-zA-Z0-9áéíóúñ ]/g, '') + '.pdf') : '';
                        const caption = `🎉 *${p.nombre}* — ¡Aprovecha esta promo!`;
                        await new Promise(r => setTimeout(r, 1500));
                        await evolutionClient.sendMedia(instanceName, phoneNumber, mediaType, directUrl, caption, fileName);
                        mediaEnviadaEnSaludo.push(p.nombre);
                        console.log(`[${instanceName}] ✅ Media promo "${p.nombre}" enviada a ${phoneNumber}`);
                    } catch (promoMediaErr) {
                        console.error(`[${instanceName}] ❌ Error enviando media promo saludo "${p.nombre}":`, promoMediaErr.message);
                    }
                }
            }

            // Si se envió media de promos, registrarlo en el historial para que la IA lo sepa
            if (mediaEnviadaEnSaludo.length > 0) {
                session.history.push({ role: 'assistant', content: `[Ya se enviaron imágenes/videos de las promos: ${mediaEnviadaEnSaludo.join(', ')}. NO preguntar si quiere verlas ni volver a enviarlas.]` });
            }

            // Si el mensaje SOLO es un saludo corto, retornar. Si tiene contenido sustancial (ej: "Hola quiero agendar..."), continuar al procesamiento de IA.
            const msgSinSaludo = messageText.toLowerCase()
                .replace(/\b(hola|buenos?\s*(dias|tardes|noches)|hey|hi|buenas|saludos|que\s*tal|buen\s*dia)\b/gi, '')
                .replace(/[^\w\sáéíóúñ]/g, '')
                .trim();

            // Si el usuario solo pregunta por promos y el saludo ya las mostró, no pasar a IA
            if (promosHoy.length > 0 && /promo(cion|ciones)?|descuento|oferta/.test(msgSinSaludo) && msgSinSaludo.length < 50) {
                console.log(`[${instanceName}] Pregunta de promos ya cubierta por el saludo. No se pasa a IA.`);
                return;
            }

            if (msgSinSaludo.length < 10) {
                return; // Solo un saludo, no hay contenido sustancial
            }
            // El mensaje tiene más contenido → continuar al procesamiento de IA
            console.log(`[${instanceName}] Saludo + contenido detectado: "${msgSinSaludo.substring(0, 80)}". Continuando a IA.`);
        }

        // ── PROCESAMIENTO DE COMPROBANTES DE PAGO (imagen) ──
        if (isImage && tenant.config.hasAnyAnticipo) {
            // Verificar si el usuario tiene un pago pendiente
            const pendingPaymentAfter = session.pendingPaymentAfterBooking;   // DESPUES de agendar
            const pendingPaymentBefore = session.pendingPaymentBeforeBooking; // ANTES de agendar

            if (pendingPaymentAfter || pendingPaymentBefore) {
                const paymentInfo = pendingPaymentAfter || pendingPaymentBefore;
                console.log(`[${instanceName}] 📸 Comprobante recibido de ${phoneNumber}. Analizando con Vision...`);

                try {
                    const imageBuffer = await evolutionClient.getMediaBase64(instanceName, data.key);
                    if (!imageBuffer) {
                        await evolutionClient.sendText(instanceName, phoneNumber, '📸 No pude procesar tu imagen. ¿Podrías enviarla de nuevo? 🙏');
                        return;
                    }

                    const analysis = await analyzePaymentReceipt(
                        imageBuffer,
                        tenant.config.businessName,
                        tenant.config.openApiKey
                    );

                    console.log(`[${instanceName}] 🔍 Resultado Vision:`, JSON.stringify(analysis));

                    // Caso 1: Comprobante no válido (fraude/editado)
                    if (!analysis.esValido) {
                        const rejectMsg = `⚠️ Lo sentimos, no pudimos validar este comprobante.\n\n` +
                            `${analysis.motivoRechazo ? 'Motivo: ' + analysis.motivoRechazo + '\n\n' : ''}` +
                            `Por favor envía un comprobante válido de tu transferencia o contacta directamente al negocio. 📞`;
                        session.history.push({ role: 'user', content: '[Envió imagen de comprobante]' });
                        session.history.push({ role: 'assistant', content: rejectMsg });
                        await evolutionClient.sendText(instanceName, phoneNumber, rejectMsg);

                        // Notificar a dueña
                        const ownerPhone = tenant.config.ownerPhone;
                        if (ownerPhone) {
                            const notifMsg = `⚠️ *Comprobante Sospechoso*\n\n` +
                                `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                                `📱 Celular: ${phoneNumber}\n` +
                                `❌ Motivo: ${analysis.motivoRechazo || 'No se pudo validar'}\n` +
                                `💰 Anticipo esperado: $${Number(paymentInfo.montoAnticipo).toLocaleString('es-CO')}\n\n` +
                                `_Revisa manualmente este caso._`;
                            try { await evolutionClient.sendText(instanceName, ownerPhone, notifMsg); } catch (e) {}
                        }
                        return;
                    }

                    // Caso 2: Fecha no reciente
                    if (!analysis.fechaReciente) {
                        const dateMsg = `⚠️ El comprobante parece ser de otra fecha (${analysis.fecha || 'no detectada'}).\n\n` +
                            `Por favor envía un comprobante *reciente* de tu transferencia de $${Number(paymentInfo.montoAnticipo).toLocaleString('es-CO')}. 📸`;
                        session.history.push({ role: 'user', content: '[Envió imagen de comprobante]' });
                        session.history.push({ role: 'assistant', content: dateMsg });
                        await evolutionClient.sendText(instanceName, phoneNumber, dateMsg);
                        return;
                    }

                    // Caso 3: Todo válido — confirmar pago (acepta cualquier monto)
                    const refStr = `${analysis.fecha || ''} Ref:${analysis.referencia || 'N/A'}`;
                    const saldoRestante = paymentInfo.precioTotal - analysis.monto;

                    if (pendingPaymentAfter) {
                        // Flujo DESPUES: La cita ya existe → confirmar pago
                        api.webhookUrl = tenant.webhookGasUrl;
                        await api.confirmarPago(paymentInfo.agendaId, {
                            montoPagado: analysis.monto,
                            referencia: refStr,
                            fechaPago: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })
                        });

                        const successMsg = `✅ *¡Pago confirmado!* 💖\n\n` +
                            `💰 Anticipo recibido: *$${Number(analysis.monto).toLocaleString('es-CO')}*\n` +
                            `📋 Referencia: ${analysis.referencia || 'N/A'}\n` +
                            `🆔 Cita: ${paymentInfo.agendaId}\n\n` +
                            `Tu cita está 100% reservada. ✨\n` +
                            `💵 Saldo restante al momento del servicio: *$${Number(saldoRestante).toLocaleString('es-CO')}*\n\n` +
                            `¡Te esperamos! 🌸`;

                        session.pendingPaymentAfterBooking = null;
                        session.history.push({ role: 'user', content: '[Envió comprobante de pago]' });
                        session.history.push({ role: 'assistant', content: successMsg });
                        await evolutionClient.sendText(instanceName, phoneNumber, successMsg);

                        // Notificar a dueña
                        const ownerPhone = tenant.config.ownerPhone;
                        if (ownerPhone) {
                            const notifMsg = `✅ *Pago Confirmado*\n\n` +
                                `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                                `📱 Celular: ${phoneNumber}\n` +
                                `🆔 Cita: ${paymentInfo.agendaId}\n` +
                                `💰 Monto: $${Number(analysis.monto).toLocaleString('es-CO')}\n` +
                                `📋 Ref: ${analysis.referencia || 'N/A'}\n` +
                                `💵 Saldo restante: $${Number(saldoRestante).toLocaleString('es-CO')}\n\n` +
                                `_Pago verificado automáticamente por ${tenant.config.agentName || 'BeautyOS'}_`;
                            try { await evolutionClient.sendText(instanceName, ownerPhone, notifMsg); } catch (e) {}
                        }

                        tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);
                    } else if (pendingPaymentBefore) {
                        // Flujo ANTES: Pago primero, luego agendar
                        api.webhookUrl = tenant.webhookGasUrl;
                        const agendaId = await api.createAgenda({
                            fecha: paymentInfo.fecha,
                            inicio: paymentInfo.hora_inicio,
                            fin: paymentInfo.hora_fin,
                            cliente: userData.nombre || 'Cliente',
                            celularCliente: phoneNumber,
                            servicio: paymentInfo.servicios,
                            precio: paymentInfo.precioTotal,
                            profesional: paymentInfo.profesional || 'Por asignar',
                            notas: '',
                            // Datos de anticipo para incluir en la cita
                            exentoAnticipo: 'NO',
                            montoAnticipo: paymentInfo.montoAnticipo,
                            montoPagado: analysis.monto,
                            saldoRestante: saldoRestante,
                            estadoPago: 'PAGO_CONFIRMADO',
                            refComprobante: refStr,
                            fechaPago: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })
                        });

                        let successMsg;
                        if (agendaId) {
                            successMsg = `✅ *¡Pago recibido y cita confirmada!* 💖\n\n` +
                                `📋 *Resumen de tu cita:*\n` +
                                `· *Servicio:* ${paymentInfo.servicios} ✂️\n` +
                                `· *Fecha:* ${paymentInfo.fecha}\n` +
                                `· *Hora:* ${paymentInfo.hora_inicio} a ${paymentInfo.hora_fin}\n` +
                                `· *Profesional:* ${paymentInfo.profesional}\n` +
                                `· *Precio total:* $${Number(paymentInfo.precioTotal).toLocaleString('es-CO')}\n` +
                                `· *Anticipo pagado:* $${Number(analysis.monto).toLocaleString('es-CO')}\n` +
                                `· *Saldo restante:* $${Number(saldoRestante).toLocaleString('es-CO')}\n` +
                                `· *ID Cita:* ${agendaId}\n\n` +
                                `¡Te esperamos! 🌸✨`;
                        } else {
                            successMsg = `✅ Pago recibido de $${Number(analysis.monto).toLocaleString('es-CO')}.\n\n` +
                                `❌ Sin embargo, hubo un problema al guardar tu cita. Por favor escríbenos para resolverlo. 🙏`;
                        }

                        session.pendingPaymentBeforeBooking = null;
                        session.history.push({ role: 'user', content: '[Envió comprobante de pago]' });
                        session.history.push({ role: 'assistant', content: successMsg });
                        await evolutionClient.sendText(instanceName, phoneNumber, successMsg);

                        // Notificar a dueña
                        const ownerPhone = tenant.config.ownerPhone;
                        if (ownerPhone && agendaId) {
                            const notifMsg = `📋 *Nueva Cita + Pago Confirmado*\n\n` +
                                `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                                `📱 Celular: ${phoneNumber}\n` +
                                `🆔 Cita: ${agendaId}\n` +
                                `📅 ${paymentInfo.fecha} de ${paymentInfo.hora_inicio} a ${paymentInfo.hora_fin}\n` +
                                `✂️ Servicio: ${paymentInfo.servicios}\n` +
                                `💰 Anticipo: $${Number(analysis.monto).toLocaleString('es-CO')} | Saldo: $${Number(saldoRestante).toLocaleString('es-CO')}\n` +
                                `📋 Ref: ${analysis.referencia || 'N/A'}\n\n` +
                                `_${tenant.config.agentName || 'BeautyOS'}_`;
                            try { await evolutionClient.sendText(instanceName, ownerPhone, notifMsg); } catch (e) {}
                        }

                        tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);
                    }
                    return;
                } catch (visionErr) {
                    console.error(`[${instanceName}] Error procesando comprobante:`, visionErr.message);
                    await evolutionClient.sendText(instanceName, phoneNumber, '📸 Hubo un problema al procesar tu comprobante. ¿Podrías enviarlo de nuevo? 🙏');
                    return;
                }
            } else if (isImage && !messageText) {
                // Imagen recibida pero no tiene pago pendiente — si tiene caption, usar como texto
                if (imageCaption) {
                    messageText = imageCaption;
                } else {
                    // Imagen sin contexto de pago — ignorar amablemente
                    return;
                }
            }
        } else if (isImage && !messageText) {
            // Anticipo no habilitado — si tiene caption, usar como texto
            if (imageCaption) {
                messageText = imageCaption;
            } else {
                return;
            }
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
            session.pendingCancelacionMasiva = null;
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

        // ── RESOLUCIÓN INTELIGENTE DE CITA: por posición, fecha, hora, servicio, día ──
        if ((session.isCancelando || session.isReagendando) && !session.reagendandoCitaId) {
            const userAppts = tenant.pendingAppointments[phoneNumber] || [];
            const TODAS_REGEX = /\b(ambas?|las dos|las tres|tod[ao]s?|todas las citas|los dos|los tres)\b/i;
            const POSICION_REGEX = /\b(la )?(primer[ao]?|segund[ao]?|tercer[ao]?|1|2|3)\b/i;

            // Cancelación masiva: "ambas", "las dos", "todas"
            if (session.isCancelando && TODAS_REGEX.test(messageText) && userAppts.length > 0 && !session.pendingCancelacionMasiva) {
                session.pendingCancelacionMasiva = userAppts.map(c => c.id);
                const citasTexto = userAppts.map((c, i) =>
                    `${i + 1}. *${c.id}* — ${c.fecha} a las ${c.inicio} — ${c.servicio}`
                ).join('\n');
                const confirmMsg = `⚠️ ¿Estás segur@ de que deseas cancelar *TODAS* tus citas pendientes?\n\n${citasTexto}\n\nResponde *sí* para confirmar o *no* para cancelar.`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: confirmMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, confirmMsg);
                return;
            }

            if (userAppts.length > 1) {
                let resolved = null;

                // 1. Resolver por posición: "la primera", "la segunda", "la 1"
                const posMatch = messageText.match(POSICION_REGEX);
                if (posMatch) {
                    const posText = posMatch[2].toLowerCase();
                    let idx = -1;
                    if (/^(primer[ao]?|1)$/.test(posText)) idx = 0;
                    else if (/^(segund[ao]?|2)$/.test(posText)) idx = 1;
                    else if (/^(tercer[ao]?|3)$/.test(posText)) idx = 2;
                    if (idx >= 0 && idx < userAppts.length) resolved = { appt: userAppts[idx], method: 'posición (' + posText + ')' };
                }

                // 2. Resolver por hora mencionada: "la de las 11", "la de las 3pm"
                if (!resolved) {
                    const horaMatch = messageText.match(/(?:la\s+de\s+(?:las?\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m|p\.m)?/i);
                    if (horaMatch) {
                        let h = parseInt(horaMatch[1]);
                        const ampm = (horaMatch[3] || '').toLowerCase().replace('.', '');
                        if (ampm === 'pm' && h < 12) h += 12;
                        if (ampm === 'am' && h === 12) h = 0;
                        const horaStr = String(h).padStart(2, '0') + ':' + (horaMatch[2] || '00');
                        const match = userAppts.find(c => c.inicio && c.inicio.startsWith(horaStr));
                        if (match) resolved = { appt: match, method: 'hora (' + horaStr + ')' };
                    }
                }

                // 3. Resolver por fecha: "la del viernes", "la del 14", "la del 14/03"
                if (!resolved) {
                    const diasSemana = { 'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6, 'domingo': 0, 'manana': -1, 'mañana': -1 };
                    const msgLower = messageText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                    // Por día de semana: "la del viernes", "la de mañana"
                    for (const [dia, num] of Object.entries(diasSemana)) {
                        const diaNorm = dia.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        if (msgLower.includes(diaNorm)) {
                            let targetDay = num;
                            if (num === -1) {
                                // "mañana"
                                const tomorrow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                targetDay = tomorrow.getDay();
                            }
                            const match = userAppts.find(c => {
                                if (!c.fecha) return false;
                                const parts = c.fecha.split('/');
                                if (parts.length === 3) {
                                    const d = new Date(parts[2], parts[1] - 1, parts[0]);
                                    return d.getDay() === targetDay;
                                }
                                return false;
                            });
                            if (match) { resolved = { appt: match, method: 'día (' + dia + ')' }; break; }
                        }
                    }

                    // Por número de día: "la del 14", "la del 14/03"
                    if (!resolved) {
                        const fechaMatch = messageText.match(/(?:la\s+del?\s+)?(\d{1,2})(?:\/(\d{1,2}))?/);
                        if (fechaMatch) {
                            const diaNum = fechaMatch[1].padStart(2, '0');
                            const mesNum = fechaMatch[2] ? fechaMatch[2].padStart(2, '0') : null;
                            const match = userAppts.find(c => {
                                if (!c.fecha) return false;
                                const parts = c.fecha.split('/');
                                if (parts[0] === diaNum) {
                                    if (mesNum) return parts[1] === mesNum;
                                    return true;
                                }
                                return false;
                            });
                            if (match) resolved = { appt: match, method: 'fecha (' + diaNum + (mesNum ? '/' + mesNum : '') + ')' };
                        }
                    }
                }

                // 4. Resolver por servicio: "la de cejas", "la de manicure"
                if (!resolved) {
                    const servicios = [...new Set(userAppts.map(c => (c.servicio || '').toLowerCase()))];
                    for (const srv of servicios) {
                        if (srv && messageText.toLowerCase().includes(srv)) {
                            const match = userAppts.find(c => (c.servicio || '').toLowerCase() === srv);
                            if (match) { resolved = { appt: match, method: 'servicio (' + srv + ')' }; break; }
                        }
                    }
                }

                if (resolved) {
                    session.reagendandoCitaId = resolved.appt.id;
                    console.log(`[${instanceName}] 🎯 Cita resuelta por ${resolved.method}: ${session.reagendandoCitaId}`);
                }
            }
        }

        // ── CANCELACIÓN MASIVA CONFIRMACIÓN ──
        if (session.pendingCancelacionMasiva) {
            if (CONFIRM_REGEX.test(msgNorm)) {
                const idsACancelar = session.pendingCancelacionMasiva;
                session.pendingCancelacionMasiva = null;
                session.isCancelando = false;
                console.log(`[${instanceName}] ❌ Cancelación masiva confirmada: ${idsACancelar.join(', ')}`);

                let cancelados = [];
                let errores = [];
                for (const id of idsACancelar) {
                    const exito = await api.cancelAgenda(id);
                    if (exito) cancelados.push(id);
                    else errores.push(id);
                }

                let replyMsg;
                if (errores.length === 0) {
                    replyMsg = `✅ *¡Todas tus citas han sido canceladas!* 💔\n\n` +
                        `Citas canceladas: ${cancelados.join(', ')}\n\n` +
                        `Los horarios han sido liberados. ¿Deseas agendar algo nuevo? 🌸`;
                } else {
                    replyMsg = `⚠️ Se cancelaron ${cancelados.length} cita(s): ${cancelados.join(', ')}\n` +
                        `❌ Error en: ${errores.join(', ')}\n\n¿En qué más te puedo ayudar?`;
                }

                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: replyMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, replyMsg);

                tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);

                const ownerPhone = tenant.config.ownerPhone;
                if (ownerPhone && cancelados.length > 0) {
                    const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                    const notifMsg = `🚫 *Cancelación Masiva*\n\n` +
                        `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                        `📱 Celular: ${phoneNumber}\n` +
                        `❌ Citas canceladas: ${cancelados.join(', ')}\n` +
                        `🕐 ${ahora}\n\n` +
                        `_Notificación automática de ${tenant.config.agentName || 'BeautyOS'}_`;
                    try {
                        await evolutionClient.sendText(instanceName, ownerPhone, notifMsg);
                    } catch (notifErr) {
                        console.error(`[${instanceName}] Error notificación cancelación masiva:`, notifErr.message);
                    }
                }
                return;
            } else if (DENY_REGEX.test(msgNorm)) {
                session.pendingCancelacionMasiva = null;
                session.isCancelando = false;
                const cancelMsg = `Entendido, no se canceló ninguna cita. 😊\n\n¿En qué más te puedo ayudar?`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: cancelMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, cancelMsg);
                return;
            } else {
                // Ni sí ni no → re-preguntar
                const ids = session.pendingCancelacionMasiva;
                const reaskMsg = `¿Confirmas que deseas cancelar las citas: ${ids.join(', ')}?\n\nResponde *sí* para confirmar o *no* para mantenerlas.`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: reaskMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, reaskMsg);
                return;
            }
        }

        // ── CONFIRMACIÓN DIRECTA: El código guarda/reagenda sin pasar por IA ──
        const CONFIRM_REGEX = /^(si+p?|ok[i]?|okey|okay|dale|de una|de una vez|confirmo|confirmado|confirmar|perfecto|de acuerdo|claro|listo|vale|aprobado|bueno|esta bien|por supuesto|obvio|sep|sepi|sipi|hagale|hagamosle|hagalo|vamos|sale|hecho|ya|venga|adelante|correcto|exacto|asi es|procede|agendame|agendeme|reservame|genial|super|excelente|me parece bien|me parece|va|eso|todo bien|agende|por fa|porfa|por favor|simon|aja|ajap|oki doki|okis|dale dale|dale pues|dale si|va pues|pues si|pues dale|listo pues|listo si|listo dale|eso es|eso si|claro si|claro que si|bueno si|bueno dale|venga pues|venga dale|ya dale|perfecto dale|si claro|si dale|si por favor|si porfa|si por fa|si gracias|si senora|si senor|ok dale|ok si|ok perfecto|ok listo|dale gracias|va va|dale va|ta bien|ta bueno|joya|bien|sisas|metale|mandele|reserva|agenda|haga|parce si|of course|yes|yep|yeah|sure|si confirmo|si confirmado|si agenda|si agende|si reserva|si reservame|si agendame|confirmo si|confirmo la cita|confirmo cita|si listo|si hecho|si va|si eso|dale confirmo|listo confirmo|confirmar cita|si todo bien)$/;
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

        // ── GUARDA: Si isReagendando + pendingConfirmation, redirigir a pendingReagendamiento ──
        if (session.isReagendando && session.pendingConfirmation && !session.pendingReagendamiento) {
            const citaId = session.reagendandoCitaId;
            if (citaId) {
                console.log(`⚠️ [${instanceName}] GUARDA: pendingConfirmation durante reagendamiento → redirigiendo a pendingReagendamiento (${citaId})`);
                session.pendingReagendamiento = session.pendingConfirmation;
                session.pendingConfirmation = null;
            } else {
                // Sin citaId, intentar resolver
                const userAppts = tenant.pendingAppointments[phoneNumber] || [];
                if (userAppts.length === 1) {
                    session.reagendandoCitaId = userAppts[0].id;
                    console.log(`⚠️ [${instanceName}] GUARDA: Auto-resolvió citaId (${session.reagendandoCitaId}) y redirige a pendingReagendamiento`);
                    session.pendingReagendamiento = session.pendingConfirmation;
                    session.pendingConfirmation = null;
                }
            }
        }

        // ── NUEVA CITA CONFIRMACIÓN (code-level) ──
        if (session.pendingConfirmation) {
            if (CONFIRM_REGEX.test(msgNorm)) {
                const citaData = session.pendingConfirmation;
                session.pendingConfirmation = null;

                console.log(`✅ [${instanceName}] Confirmación directa detectada: "${messageText}" → Guardando cita via api.createAgenda()`);
                session.isReagendando = false;
                session.isCancelando = false;

                // ── Lógica de Anticipo (per-service) ──
                const clientData = session.datos || {};
                const isExempt = clientData.exemptFromPayment === true;
                const { anticipoEnabled, montoAnticipo } = resolveAnticipoForServices(
                    citaData.servicios, tenant.servicesCatalog
                );

                // ── Descuento cumpleanos (desde promo CUMPLEANOS) ──
                let descuentoCumple = 0;
                const clienteInfoBday = tenant.registeredClients[phoneNumber] || {};
                const cumplePromoWh = (tenant.promotionsCatalog || []).find(p =>
                    p.tipoPromo === 'CUMPLEANOS' && p.estado === 'ACTIVO'
                );
                if (cumplePromoWh && clienteInfoBday.cumple) {
                    // Verificar tipo de cliente permitido
                    const cTipoWh = clienteInfoBday.tipo || 'Nuevo';
                    const allowedWh = cumplePromoWh.aplicaTipoCliente === 'TODOS'
                        ? null
                        : cumplePromoWh.aplicaTipoCliente.split(',').map(t => t.trim().toLowerCase());
                    const clientAllowedWh = !allowedWh || allowedWh.includes(cTipoWh.toLowerCase());

                    if (clientAllowedWh) {
                        const nowCol = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
                        const ddNow = String(nowCol.getDate()).padStart(2, '0');
                        const mmNow = String(nowCol.getMonth() + 1).padStart(2, '0');
                        const cumpleDDMM = parseCumpleDDMM(clienteInfoBday.cumple);
                        if (cumpleDDMM === `${ddNow}/${mmNow}`) {
                            const bdayDiscount = cumplePromoWh.valorDescuento || 20;
                            descuentoCumple = Math.round(citaData.precio_total * bdayDiscount / 100);
                            citaData.precio_total = citaData.precio_total - descuentoCumple;
                            citaData.notas_cumple = `DESCUENTO CUMPLE ${bdayDiscount}%: -$${descuentoCumple.toLocaleString('es-CO')}`;
                            console.log(`[${instanceName}] Descuento cumpleanos aplicado: -$${descuentoCumple} -> nuevo total: $${citaData.precio_total}`);
                        }
                    }
                }

                // ── Flujo ANTES: Pedir pago antes de agendar ──
                if (anticipoEnabled && !isExempt && tenant.config.paymentMoment === 'ANTES' && montoAnticipo > 0) {
                    const saldoRestante = citaData.precio_total - montoAnticipo;
                    session.pendingPaymentBeforeBooking = {
                        ...citaData,
                        precioTotal: citaData.precio_total,
                        montoAnticipo: montoAnticipo
                    };

                    const payMsg = `📋 *Resumen de tu cita:*\n` +
                        `· *Servicio:* ${citaData.servicios} ✂️\n` +
                        `· *Fecha:* ${citaData.fecha}\n` +
                        `· *Hora:* ${citaData.hora_inicio} a ${citaData.hora_fin}\n` +
                        `· *Profesional:* ${citaData.profesional}\n` +
                        `· *Precio total:* $${Number(citaData.precio_total).toLocaleString('es-CO')}\n\n` +
                        `💰 Para reservar tu cita, transfiere *$${Number(montoAnticipo).toLocaleString('es-CO')}* de anticipo.\n` +
                        `${tenant.config.paymentPolicy ? '📋 ' + tenant.config.paymentPolicy + '\n\n' : '\n'}` +
                        `📲 *Datos de pago:*\n${tenant.config.paymentInstructions}\n\n` +
                        `💵 Saldo restante al servicio: $${Number(saldoRestante).toLocaleString('es-CO')}\n\n` +
                        `Envía tu comprobante por aquí 📸`;

                    session.history.push({ role: 'user', content: messageText });
                    session.history.push({ role: 'assistant', content: payMsg });
                    await evolutionClient.sendText(instanceName, phoneNumber, payMsg);
                    return;
                }

                // ── Flujo normal (sin anticipo o cliente exento) ──
                const extraPaymentData = {};
                if (anticipoEnabled) {
                    extraPaymentData.exentoAnticipo = isExempt ? 'SI' : 'NO';
                    extraPaymentData.montoAnticipo = montoAnticipo;
                    extraPaymentData.montoPagado = 0;
                    extraPaymentData.saldoRestante = isExempt ? 0 : citaData.precio_total;
                    extraPaymentData.estadoPago = isExempt ? 'EXENTO' : (montoAnticipo > 0 ? 'PENDIENTE_PAGO' : 'EXENTO');
                }

                // ── Detectar si aplica promo (cumpleaños u otra vigente) y CALCULAR descuento en código ──
                let promoFlag = descuentoCumple > 0 ? 'SI' : 'NO';
                let tipoPromoFlag = descuentoCumple > 0 ? 'CUMPLEANOS' : '';
                if (promoFlag === 'NO') {
                    // Verificar promos normales vigentes para el DIA DE LA CITA
                    const weekDaysPromo = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                    // Parsear fecha de la cita para saber qué día es
                    let citaDayName = '';
                    if (citaData.fecha) {
                        const fp = citaData.fecha.split('/');
                        if (fp.length === 3) {
                            const citaDate = new Date(fp[2], fp[1] - 1, fp[0]);
                            citaDayName = weekDaysPromo[citaDate.getDay()];
                        }
                    }
                    const srvNames = citaData.servicios.split(',').map(s => s.trim().toLowerCase());
                    const promosActivas = (tenant.promotionsCatalog || []).filter(p => {
                        if (p.estado !== 'ACTIVO' || p.tipoPromo === 'CUMPLEANOS') return false;
                        if (p.aplicaDia && p.aplicaDia.trim() !== '') {
                            const dias = p.aplicaDia.split(',').map(d => d.trim().toLowerCase());
                            if (citaDayName && !dias.includes(citaDayName)) return false;
                        }
                        // Verificar que la promo aplica al servicio
                        if (p.aplicaServicio && p.aplicaServicio !== 'TODOS') {
                            const srvPromo = p.aplicaServicio.split(',').map(s => s.trim().toLowerCase());
                            const matches = srvNames.some(sn => srvPromo.some(sp => sn.includes(sp) || sp.includes(sn)));
                            if (!matches) return false;
                        }
                        return true;
                    });

                    if (promosActivas.length > 0) {
                        const bestPromo = promosActivas[0];
                        promoFlag = 'SI';
                        tipoPromoFlag = bestPromo.nombre || bestPromo.tipoPromo || 'DESCUENTO';

                        // Calcular precio de catálogo
                        const catalogPrice = srvNames.reduce((sum, name) => {
                            const info = tenant.servicesCatalog.find(s => s.name.toLowerCase().trim() === name);
                            return sum + (info ? info.price : 0);
                        }, 0);

                        // FORZAR el precio con descuento (no confiar en la IA)
                        if (catalogPrice > 0) {
                            let precioFinal = catalogPrice;
                            if (bestPromo.tipoPromo === 'PORCENTAJE') {
                                precioFinal = Math.round(catalogPrice * (1 - bestPromo.valorDescuento / 100));
                            } else if (bestPromo.tipoPromo === 'VALOR_FIJO') {
                                precioFinal = Math.max(0, catalogPrice - bestPromo.valorDescuento);
                            }
                            // 2X1: no cambiar precio aquí (aplica a 2 servicios iguales)
                            if (bestPromo.tipoPromo !== '2X1' && precioFinal !== catalogPrice) {
                                console.log(`[${instanceName}] 🏷️ Promo "${bestPromo.nombre}" aplicada: $${catalogPrice} → $${precioFinal} (${bestPromo.tipoPromo} ${bestPromo.valorDescuento})`);
                                citaData.precio_total = precioFinal;
                            }
                        }
                    }
                }

                const agendaId = await api.createAgenda({
                    fecha: citaData.fecha,
                    inicio: citaData.hora_inicio,
                    fin: citaData.hora_fin,
                    cliente: userData.nombre || 'Cliente',
                    celularCliente: userData.celular || phoneNumber,
                    servicio: citaData.servicios,
                    precio: citaData.precio_total,
                    profesional: citaData.profesional || 'Por asignar',
                    notas: citaData.notas_cumple || '',
                    promo: promoFlag,
                    tipoPromo: tipoPromoFlag,
                    ...extraPaymentData
                });

                let replyMsg;
                if (agendaId) {
                    // ── Flujo DESPUES: Agendar y luego pedir pago ──
                    if (anticipoEnabled && !isExempt && tenant.config.paymentMoment === 'DESPUES' && montoAnticipo > 0) {
                        const saldoRestante = citaData.precio_total - montoAnticipo;
                        session.pendingPaymentAfterBooking = {
                            agendaId: agendaId,
                            precioTotal: citaData.precio_total,
                            montoAnticipo: montoAnticipo,
                            servicios: citaData.servicios
                        };

                        replyMsg = `✅ *¡Tu cita ha sido reservada!* 💖\n\n` +
                            `📋 *Resumen de tu cita:*\n` +
                            `· *Servicio:* ${citaData.servicios} ✂️\n` +
                            `· *Fecha:* ${citaData.fecha}\n` +
                            `· *Hora:* ${citaData.hora_inicio} a ${citaData.hora_fin}\n` +
                            `· *Profesional:* ${citaData.profesional}\n` +
                            `· *Precio total:* $${Number(citaData.precio_total).toLocaleString('es-CO')}\n` +
                            `· *ID Cita:* ${agendaId}\n\n` +
                            `💰 Para confirmar tu asistencia, transfiere *$${Number(montoAnticipo).toLocaleString('es-CO')}* de anticipo.\n` +
                            `${tenant.config.paymentPolicy ? '📋 ' + tenant.config.paymentPolicy + '\n\n' : '\n'}` +
                            `📲 *Datos de pago:*\n${tenant.config.paymentInstructions}\n\n` +
                            `💵 Saldo restante al servicio: $${Number(saldoRestante).toLocaleString('es-CO')}\n\n` +
                            `Envía tu comprobante por aquí 📸`;
                    } else {
                        replyMsg = `✅ *¡Tu cita ha sido agendada exitosamente!* 💖\n\n` +
                            `📋 *Resumen de tu cita:*\n` +
                            `· *Servicio:* ${citaData.servicios} ✂️\n` +
                            `· *Fecha:* ${citaData.fecha}\n` +
                            `· *Hora:* ${citaData.hora_inicio} a ${citaData.hora_fin}\n` +
                            `· *Profesional:* ${citaData.profesional}\n` +
                            `· *Precio:* $${Number(citaData.precio_total).toLocaleString('es-CO')}\n` +
                            `· *ID Cita:* ${agendaId}\n\n` +
                            `¡Te esperamos! 🌸✨`;
                    }
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
                            (montoAnticipo > 0 && !isExempt ? `💳 Anticipo: $${Number(montoAnticipo).toLocaleString('es-CO')} (${tenant.config.paymentMoment === 'DESPUES' ? 'pendiente' : 'por cobrar'})\n` : '') +
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

                // Calcular precio con descuento para mostrar en el re-ask
                let reaskPrecio = cd.precio_total;
                const weekDaysReask = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                let reaskDayName = '';
                if (cd.fecha) {
                    const fpR = cd.fecha.split('/');
                    if (fpR.length === 3) {
                        reaskDayName = weekDaysReask[new Date(fpR[2], fpR[1] - 1, fpR[0]).getDay()];
                    }
                }
                const srvNamesReask = cd.servicios.split(',').map(s => s.trim().toLowerCase());
                const promoReask = (tenant.promotionsCatalog || []).find(p => {
                    if (p.estado !== 'ACTIVO' || p.tipoPromo === 'CUMPLEANOS') return false;
                    if (p.aplicaDia && p.aplicaDia.trim() !== '') {
                        const dias = p.aplicaDia.split(',').map(d => d.trim().toLowerCase());
                        if (reaskDayName && !dias.includes(reaskDayName)) return false;
                    }
                    if (p.aplicaServicio && p.aplicaServicio !== 'TODOS') {
                        const srvPromo = p.aplicaServicio.split(',').map(s => s.trim().toLowerCase());
                        if (!srvNamesReask.some(sn => srvPromo.some(sp => sn.includes(sp) || sp.includes(sn)))) return false;
                    }
                    return true;
                });
                if (promoReask) {
                    const catalogPriceReask = srvNamesReask.reduce((sum, name) => {
                        const info = tenant.servicesCatalog.find(s => s.name.toLowerCase().trim() === name);
                        return sum + (info ? info.price : 0);
                    }, 0);
                    if (catalogPriceReask > 0 && promoReask.tipoPromo === 'PORCENTAJE') {
                        reaskPrecio = Math.round(catalogPriceReask * (1 - promoReask.valorDescuento / 100));
                    } else if (catalogPriceReask > 0 && promoReask.tipoPromo === 'VALOR_FIJO') {
                        reaskPrecio = Math.max(0, catalogPriceReask - promoReask.valorDescuento);
                    }
                }

                const promoReaskLabel = promoReask ? `\n· *Promo:* ${promoReask.nombre} 🎉` : '';
                const reaskMsg = `¿Confirmas tu cita? 🤔\n\n` +
                    `📋 *Resumen:*\n` +
                    `· *Servicio:* ${cd.servicios}\n` +
                    `· *Fecha:* ${cd.fecha}\n` +
                    `· *Hora:* ${cd.hora_inicio} a ${cd.hora_fin}\n` +
                    `· *Profesional:* ${cd.profesional}\n` +
                    `· *Precio:* $${Number(reaskPrecio).toLocaleString('es-CO')}${promoReaskLabel}\n\n` +
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
            session,
            tenant.serviceGallery || {},
            tenant.promoUsage || {}
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

        // ── Enviar galería multimedia si la IA lo solicitó ──
        if (session._pendingGalleryMedia) {
            const gallery = session._pendingGalleryMedia;
            console.log(`[${instanceName}] 📸 Enviando galería: ${gallery.items.length} item(s) de ${gallery.serviceName}`);

            for (const item of gallery.items) {
                try {
                    const directUrl = convertDriveUrl(item.url);
                    const mediaType = item.type === 'imagen' ? 'image' : item.type === 'video' ? 'video' : 'document';
                    const caption = item.title + (item.description ? '\n' + item.description : '');
                    const fileName = item.type === 'documento' ? (item.title.replace(/[^a-zA-Z0-9áéíóúñ ]/g, '') + '.pdf') : '';

                    await evolutionClient.sendMedia(instanceName, phoneNumber, mediaType, directUrl, caption, fileName);

                    // Delay entre envíos para no saturar
                    if (gallery.items.length > 1) {
                        await new Promise(r => setTimeout(r, 1500));
                    }
                } catch (mediaErr) {
                    console.error(`[${instanceName}] Error enviando media "${item.title}":`, mediaErr.message);
                }
            }

            console.log(`[${instanceName}] ✅ Galería enviada: ${gallery.items.length} item(s) de ${gallery.serviceName}`);
            delete session._pendingGalleryMedia;
        }

        // ── Enviar media de promoción si la IA lo solicitó ──
        if (session._pendingPromoMedia) {
            const promoMedia = session._pendingPromoMedia;
            try {
                const directUrl = convertDriveUrl(promoMedia.url);
                const mediaType = promoMedia.type === 'imagen' ? 'image' : promoMedia.type === 'video' ? 'video' : 'document';
                const fileName = promoMedia.type === 'documento' ? (promoMedia.promoName.replace(/[^a-zA-Z0-9áéíóúñ ]/g, '') + '.pdf') : '';
                await evolutionClient.sendMedia(instanceName, phoneNumber, mediaType, directUrl, promoMedia.promoName, fileName);
                console.log(`[${instanceName}] 📸 Media de promo "${promoMedia.promoName}" enviada`);
            } catch (promoMediaErr) {
                console.error(`[${instanceName}] Error enviando media promo "${promoMedia.promoName}":`, promoMediaErr.message);
            }
            delete session._pendingPromoMedia;
        }

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
