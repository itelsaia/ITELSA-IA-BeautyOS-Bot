const { OpenAI } = require("openai");
const api = require('./api');

// ============================================================
// Definición de herramientas (Function Calling) para OpenAI
// ============================================================
const TOOLS = [
    {
        type: "function",
        function: {
            name: "agendar_cita",
            description: "Agenda una nueva cita para el cliente en el sistema. Llama a esta función SOLO cuando el cliente haya confirmado explícitamente la fecha, hora y servicios que desea.",
            parameters: {
                type: "object",
                properties: {
                    fecha: {
                        type: "string",
                        description: "Fecha de la cita en formato DD/MM/YYYY. Ejemplo: 06/03/2026"
                    },
                    hora_inicio: {
                        type: "string",
                        description: "Hora de inicio en formato HH:MM (24h). Ejemplo: 10:00"
                    },
                    hora_fin: {
                        type: "string",
                        description: "Hora estimada de fin calculada sumando la duración de todos los servicios. Ejemplo: 11:10"
                    },
                    servicios: {
                        type: "string",
                        description: "Nombre(s) del/los servicio(s) agendados usando el TIPO_SERVICIO_OFICIAL del catálogo. Si son varios, separados por coma. Ejemplo: Diseño de cejas, Corte de cabello para dama"
                    },
                    precio_total: {
                        type: "number",
                        description: "Precio total numérico en COP sin puntos ni signos. Ejemplo: 45000"
                    },
                    notas: {
                        type: "string",
                        description: "Notas adicionales opcionales de la cita. Puede estar vacío."
                    }
                },
                required: ["fecha", "hora_inicio", "hora_fin", "servicios", "precio_total"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "reagendar_cita",
            description: "Reagenda una cita EXISTENTE (PENDIENTE). Marca la cita antigua como REAGENDADO y crea una nueva. Usa esta función cuando el cliente pida cambiar su cita actual — ya sea la fecha, la hora o los servicios.",
            parameters: {
                type: "object",
                properties: {
                    id_cita_antigua: {
                        type: "string",
                        description: "El ID de la cita existente que se va a reagendar. Ejemplo: AGD-001"
                    },
                    nueva_fecha: {
                        type: "string",
                        description: "Nueva fecha de la cita en formato DD/MM/YYYY."
                    },
                    nueva_hora_inicio: {
                        type: "string",
                        description: "Nueva hora de inicio en formato HH:MM (24h)."
                    },
                    nueva_hora_fin: {
                        type: "string",
                        description: "Nueva hora estimada de fin."
                    },
                    nuevos_servicios: {
                        type: "string",
                        description: "Nombre(s) del/los nuevo(s) servicio(s) usando TIPO_SERVICIO_OFICIAL."
                    },
                    nuevo_precio_total: {
                        type: "number",
                        description: "Nuevo precio total en COP."
                    },
                    notas: {
                        type: "string",
                        description: "Notas adicionales opcionales."
                    }
                },
                required: ["id_cita_antigua", "nueva_fecha", "nueva_hora_inicio", "nueva_hora_fin", "nuevos_servicios", "nuevo_precio_total"]
            }
        }
    }
];

// ============================================================
// Función principal de respuesta de IA
// ============================================================
/**
 * Genera la respuesta del agente vía OpenAI, con soporte de Function Calling.
 * @param {string} incomingMessage Mensaje del usuario
 * @param {object} config Configuración del negocio desde Sheets
 * @param {Array} servicesCatalog Catálogo de servicios RAG
 * @param {Array} knowledgeCatalog Base de conocimiento/FAQs
 * @param {Array} messageHistory Historial de conversación
 * @param {Object} userData Objeto con datos del usuario: { nombre, celular }
 * @param {Array} userPendingAppointments Citas PENDIENTES actuales del usuario
 */
async function generateAIResponse(
    incomingMessage,
    config,
    servicesCatalog,
    knowledgeCatalog = [],
    messageHistory = [],
    userData = {},
    userPendingAppointments = []
) {
    if (!config.openApiKey || config.openApiKey === "sk-..." || config.openApiKey === "PEGAR_AQUI_API_KEY") {
        console.error("🔴 Bloqueo OpenAI: API Key no configurada.");
        return "Disculpa, el servicio de inteligencia artificial no está configurado correctamente. Contacta al administrador.";
    }

    try {
        const openai = new OpenAI({ apiKey: config.openApiKey });

        // 1. Construir contexto de servicios
        const catalogText = servicesCatalog.map(s =>
            `- ID_INTERNO: ${s.id} | Categoría: ${s.category} | Intención_Búsqueda: ${s.intent} | TIPO_SERVICIO_OFICIAL: ${s.name} | Info/Precio: ${s.response} | Tiempo: ${s.timeMins} min | PRECIO_NUMERICO: COP ${s.price}`
        ).join('\n');

        // 2. Construir conocimiento RAG
        const knowledgeText = knowledgeCatalog.map(k =>
            `- Si preguntan por: "${k.intent}", responde: "${k.response}". Enlace ${k.mediaType}: ${k.url}`
        ).join('\n');

        // 3. Construir contexto de citas PENDIENTES del usuario
        let pendingAppointmentsText = "El cliente no tiene citas activas registradas.";
        if (userPendingAppointments.length > 0) {
            pendingAppointmentsText = `⚠️ ATENCIÓN: El cliente TIENE las siguientes citas PENDIENTES:\n` +
                userPendingAppointments.map(c =>
                    `  - ID: ${c.id} | Fecha: ${c.fecha} | Hora: ${c.inicio}-${c.fin} | Servicio: ${c.servicio} | Precio: $${c.precio}`
                ).join('\n') +
                `\n→ Si el usuario pide cambiar o modificar su cita, usa la herramienta 'reagendar_cita' con el ID_CITA arriba indicado.`;
        }

        // 4. Calcular fecha y hora actual en Colombia (UTC-5)
        const nowColombia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        const dd = String(nowColombia.getDate()).padStart(2, '0');
        const mm = String(nowColombia.getMonth() + 1).padStart(2, '0');
        const yyyy = nowColombia.getFullYear();
        const hh = String(nowColombia.getHours()).padStart(2, '0');
        const min = String(nowColombia.getMinutes()).padStart(2, '0');
        const todayStr = `${dd}/${mm}/${yyyy}`;
        const nowTimeStr = `${hh}:${min}`;
        const weekDays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        const todayDayName = weekDays[nowColombia.getDay()];

        // 5. Prompt del sistema con todas las reglas
        const businessRules = `
---
📊 FECHA Y HORA ACTUAL (Colombia - Zona horaria oficial):
📅 HOY ES: ${todayStr} (${todayDayName})
⏰ HORA ACTUAL: ${nowTimeStr}
⚠️ REGLA CRÍTICA: Cuando el usuario diga "mañana", la fecha es ${(() => { const d = new Date(nowColombia); d.setDate(d.getDate() + 1); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); })()}. USA SIEMPRE formato DD/MM/YYYY. NUNCA uses fechas de años anteriores.

📋 REGLAS DE COMPORTAMIENTO:
1. CONVERSACIÓN FLUIDA: Estás en WhatsApp. NUNCA saludes si el usuario está en medio de una conversación. Ve directo al grano.
2. MONEDA: Colombia. Precios en COP con punto de miles (ej. $25.000). Al sumar, suma los números y da total en dinero y tiempo.
3. CÓDIGOS OCULTOS: Nunca muestres ID_INTERNO ni PRECIO_NUMERICO puro. Siempre formato peso colombiano.
4. RESUMEN: Al acordar servicios con el usuario, presenta resumen organizado (servicio, precio, tiempo) antes de confirmar y agendar.
5. CONOCIMIENTO: Solo responde con info del catálogo. Si piden algo fuera del catálogo, di que no ofreces ese servicio aún.
6. ESTÉTICA Y EMPATÍA: Incluye emojis de belleza (💅, 💇‍♀️, 💆‍♀️, ✨, 🌸, 💖) en tus respuestas.
7. MULTIMEDIA: Envía el enlace URL exacto cuando sea persuasivo o el usuario lo pida. NUNCA inventes URLs.
8. AGENDAMIENTO: Para agendar usa TIPO_SERVICIO_OFICIAL del catálogo como nombre del servicio guardado.
9. CONFIRMACIÓN ANTES DE GUARDAR: Antes de llamar a 'agendar_cita' o 'reagendar_cita', siempre presenta el resumen al cliente y espera su confirmación ("Sí", "Perfecto", "De acuerdo") para proceder.
10. REAGENDAMIENTO: Si el usuario quiere cambiar su cita, usa 'reagendar_cita'. Pregúntale si quiere cambiar solo la fecha/hora o también los servicios.

📅 ESTADO DE CITAS ACTUALES DEL CLIENTE:
${pendingAppointmentsText}

🛍️ CATÁLOGO DE SERVICIOS DISPONIBLES:
${catalogText}

📚 BASE DE CONOCIMIENTO / MULTIMEDIA:
${knowledgeText.length > 0 ? knowledgeText : "No hay material multimedia cargado."}
---
`;

        const userName = userData.nombre || "Cliente";
        const systemFinalPrompt = `${config.systemPrompt || "Eres un asistente virtual amable y conciso."}\n\nEstás hablando con: ${userName}\n\n${businessRules}`;

        const messages = [
            { role: 'system', content: systemFinalPrompt },
            ...messageHistory,
            { role: 'user', content: incomingMessage }
        ];

        // 5. Primera llamada a OpenAI (la IA puede pedir ejecutar una herramienta)
        const completion = await openai.chat.completions.create({
            model: config.aiModel || "gpt-4o-mini",
            messages: messages,
            tools: TOOLS,
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 500
        });

        const responseMessage = completion.choices[0].message;

        // 6. ¿La IA quiere ejecutar una herramienta?
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            const toolCall = responseMessage.tool_calls[0];
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);

            console.log(`🔧 IA solicitó herramienta: ${functionName}`, functionArgs);

            let toolResultText = "";

            // ─── Herramienta: agendar_cita ───────────────────────────────
            if (functionName === "agendar_cita") {
                const agendaId = await api.createAgenda({
                    fecha: functionArgs.fecha,
                    inicio: functionArgs.hora_inicio,
                    fin: functionArgs.hora_fin,
                    cliente: userName,
                    celularCliente: userData.celular || "",
                    servicio: functionArgs.servicios,
                    precio: functionArgs.precio_total,
                    notas: functionArgs.notas || ""
                });

                if (agendaId) {
                    toolResultText = `✅ Cita creada exitosamente. ID del turno: ${agendaId}. Fecha: ${functionArgs.fecha} de ${functionArgs.hora_inicio} a ${functionArgs.hora_fin}. Servicios: ${functionArgs.servicios}. Total: $${functionArgs.precio_total.toLocaleString('es-CO')}.`;
                } else {
                    toolResultText = "❌ Hubo un problema al registrar la cita en el sistema. Por favor intenta de nuevo.";
                }
            }

            // ─── Herramienta: reagendar_cita ──────────────────────────────
            else if (functionName === "reagendar_cita") {
                const exito = await api.rescheduleAgenda({
                    id: functionArgs.id_cita_antigua,
                    nuevaFecha: functionArgs.nueva_fecha,
                    nuevoInicio: functionArgs.nueva_hora_inicio,
                    nuevoFin: functionArgs.nueva_hora_fin,
                    nuevosServicios: functionArgs.nuevos_servicios,
                    nuevoPrecio: functionArgs.nuevo_precio_total,
                    notasAdicionales: functionArgs.notas || ""
                });

                if (exito) {
                    toolResultText = `✅ Cita reagendada exitosamente en el mismo registro. Cita (${functionArgs.id_cita_antigua}) marcada como REAGENDADO. Nueva Fecha: ${functionArgs.nueva_fecha} de ${functionArgs.nueva_hora_inicio} a ${functionArgs.nueva_hora_fin}. Servicios: ${functionArgs.nuevos_servicios}. Total: $${functionArgs.nuevo_precio_total.toLocaleString('es-CO')}.`;
                } else {
                    toolResultText = `❌ Error al reagendar la cita ${functionArgs.id_cita_antigua}. Verifica si el ID es correcto.`;
                }
            }

            // 7. Segunda llamada a OpenAI: dar el resultado de la herramienta para que formule la respuesta final
            const finalMessages = [
                ...messages,
                responseMessage,
                {
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: toolResultText
                }
            ];

            const finalCompletion = await openai.chat.completions.create({
                model: config.aiModel || "gpt-4o-mini",
                messages: finalMessages,
                temperature: 0.7,
                max_tokens: 400
            });

            return finalCompletion.choices[0].message.content;
        }

        // 8. Sin herramienta: respuesta conversacional normal
        return responseMessage.content;

    } catch (e) {
        console.error("❌ Error comunicando con OpenAI:", e.message);
        return "Disculpa, en este momento tengo problemas de conexión y no puedo procesar tu solicitud.";
    }
}

module.exports = { generateAIResponse };
