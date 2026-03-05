const { OpenAI } = require("openai");

/**
 * Función para generar respuesta con OpenAI ChatGPT
 * @param {string} incomingMessage El mensaje del usuario de WhatsApp
 * @param {object} config La configuración del cliente cargada desde Google Sheets
 * @param {Array} servicesCatalog El catálogo dinámico de servicios
 * @param {Array} knowledgeCatalog Catálogo RAG de FAQs y URLs Multimedia
 * @param {Array} messageHistory El historial de la conversación actual con el número
 * @param {string} userName El nombre del cliente recuperado del state
 * @returns {Promise<string>} La respuesta generada por el asistente de IA
 */
async function generateAIResponse(incomingMessage, config, servicesCatalog, knowledgeCatalog = [], messageHistory = [], userName = "Cliente") {
    // Verificación de seguridad de API Key
    if (!config.openApiKey || config.openApiKey === "sk-..." || config.openApiKey === "PEGAR_AQUI_API_KEY") {
        console.error("🔴 Bloqueo OpenAI: API Key no configurada o es la plantilla por defecto.");
        return "Disculpa, el servicio de inteligencia artificial no está configurado correctamente. Contacta al administrador.";
    }

    try {
        const openai = new OpenAI({
            apiKey: config.openApiKey
        });

        // 1. Construir el Catálogo de Servicios en texto
        const catalogText = servicesCatalog.map(s =>
            `- ID_INTERNO: ${s.id} | Categoría: ${s.category} | Servicio: ${s.intent} | Info/Precio: ${s.response} | Tiempo: ${s.timeMins} min`
        ).join('\n');

        // 1.5 Construir Base de Conocimiento / Media RAG
        const knowledgeText = knowledgeCatalog.map(k =>
            `- Si el usuario pregunta por: "${k.intent}", DEBES responder con esta información: "${k.response}". Si aplica, acompáñalo SIEMPRE con este enlace exacto de tipo ${k.mediaType}: ${k.url}`
        ).join('\n');

        // 2. Inyectar Reglas de Negocio Estrictas (RAG y Restricciones)
        const businessRules = `
---
📋 REGLAS DE COMPORTAMIENTO Y CÁLCULOS:
1. CONVERSACIÓN FLUIDA: Estás hablando por WhatsApp. NUNCA saludes (ej. "¡Hola!", "¡Buen día!") si el usuario está en el medio de una conversación. Ve siempre directo al grano y mantén un flujo natural. Solo saluda si el usuario te saluda primero o es el comienzo explícito de la charla.
2. MONEDA Y CÁLCULOS: Estás en Colombia. TODOS los precios están en Pesos Colombianos (COP) y usan el punto (.) como separador de miles (ej. $25.000 es veinticinco mil). Al sumar servicios (ej. $20.000 + $25.000), suma en miles matemáticamente y da el total de dinero y de tiempo.
3. CÓDIGOS OCULTOS: NUNCA muestres los códigos "ID_INTERNO" (ej. CEJ-001) al usuario final, úsalos solo internamente.
4. RESUMEN CLARO: Entrega el resumen organizado de precios y tiempos, preparándolo suavemente para agendar.
5. LÍMITE DE CONOCIMIENTO: Responde estrictamente con la información del catálogo. Si piden algo que no está ahí, di cortésmente que aún no ofreces ese servicio.
6. ESTÉTICA Y EMPATÍA: Tu rubro es belleza y SPA. SIEMPRE incluye abundantes emojis de estética (ej. 💅, 💇‍♀️, 💆‍♀️, ✨, 🌸, 💖) en tus respuestas.
7. COMPARTIR MATERIAL MULTIMEDIA (PDFs, Imágenes, Videos): Tienes acceso a material de apoyo. Si el usuario te lo pide O si tú crees que es persuasivo para la venta, envíale el enlace URL EXACTO usando el listado de abajo y coméntale qué es. NUNCA inventes enlaces URL.

🛍️ CATÁLOGO DE SERVICIOS DISPONIBLES:
${catalogText}

📚 BASE DE CONOCIMIENTO / MULTIMEDIA (Úsalo para responder FAQs o enviar catálogos visuales):
${knowledgeText.length > 0 ? knowledgeText : "No hay material multimedia cargado."}
---
`;

        // 3. Iniciar con el Prompt del Sistema (Reglas del bot + Catálogo)
        const systemFinalPrompt = `${config.systemPrompt || "Eres un asistente virtual amable y conciso."}\n\nEstás hablando ahora mismo con el cliente: ${userName}\n\n${businessRules}`;

        const messages = [
            {
                role: 'system',
                content: systemFinalPrompt
            }
        ];

        // 4. Añadir todo el historial previo (Contexto de la conversación)
        if (messageHistory.length > 0) {
            messages.push(...messageHistory);
        }

        // 5. Añadir el mensaje actual del cliente
        messages.push({
            role: 'user',
            content: incomingMessage
        });

        // 6. Solicitar la respuesta a OpenAI
        const completion = await openai.chat.completions.create({
            model: config.aiModel || "gpt-4o-mini", // Forzar uso de gpt-4o-mini por defecto por su economía y velocidad
            messages: messages,
            temperature: 0.7, // Equilibrado entre creatividad y precisión
            max_tokens: 300   // Límite de tokens para mantener respuestas cortas y baratas
        });

        // Retornar la respuesta generada
        return completion.choices[0].message.content;

    } catch (e) {
        console.error("❌ Error comunicando con OpenAI:", e.message);
        return "Disculpa, en este momento tengo problemas de conexión y no puedo procesar tu solicitud.";
    }
}

module.exports = { generateAIResponse };
