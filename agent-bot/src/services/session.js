const api = require('./api');

/**
 * Máquina de Estados Híbrida (Portero Inteligente).
 * Filtra usuarios nuevos vs recurrentes antes de darle control a ChatGPT.
 * 
 * @param {string} sender Número de teléfono del usurio
 * @param {string} message Mensaje de texto entrante
 * @param {Object} config La configuración del cliente desde Sheets
 * @returns {Object} { isGpt: boolean, text: string } Si isGpt es true, el control pasa a OpenAI.
 */
const handleOnboarding = async (sender, message, memory, config) => {
    // Si el usuario ya completó el registro, delegar control a la IA.
    if (memory.estado === 'REGISTRADO') return { isGpt: true };

    // Si es su primera vez absoluta (No tiene estado)
    if (!memory.estado) {
        memory.estado = 'ESPERANDO_NOMBRE';
        memory.datos = { celular: sender.split('@')[0], nombre: '', correo: '', cumple: '', direccion: '' };

        const saludo = config.welcomeMsg || "¡Hola! Soy tu asistente virtual.";
        return { isGpt: false, text: `${saludo}\n\nPara darte la mejor atención, me gustaría conocerte.\n\n👤 ¿Cuál es tu primer nombre y apellido?` };
    }

    // Transiciones de estado
    switch (memory.estado) {
        case 'ESPERANDO_NOMBRE':
            memory.datos.nombre = message.trim();
            memory.estado = 'ESPERANDO_CORREO';
            return { isGpt: false, text: `¡Mucho gusto ${memory.datos.nombre}! 🌸\n\n✉️ ¿A qué correo electrónico puedo enviarte las confirmaciones de tus citas?` };

        case 'ESPERANDO_CORREO':
            memory.datos.correo = message.trim();
            memory.estado = 'ESPERANDO_CUMPLE';
            return { isGpt: false, text: `¡Anotado! También nos encanta celebrar. 🎉\n\n🎂 ¿Cuál es tu fecha de cumpleaños? (Ej: 15 de abril)` };

        case 'ESPERANDO_CUMPLE':
            memory.datos.cumple = message.trim();
            memory.estado = 'ESPERANDO_DIRECCION';
            return { isGpt: false, text: `¡Perfecto!\n\n📍 Finalmente, ¿De qué barrio o ciudad nos visitas?` };

        case 'ESPERANDO_DIRECCION':
            memory.datos.direccion = message.trim();
            memory.estado = 'REGISTRADO';

            // GuardarLead en Google Sheets (CRM) en background sin bloquear
            await api.createCliente(memory.datos);

            return { isGpt: false, text: `¡Todo listo, ${memory.datos.nombre}! Ya formas parte de nuestra familia 💖.\n\nA partir de ahora, soy tu asesora virtual. Estoy aquí para ayudarte a consultar nuestro catálogo de servicios y agendar tus citas automáticamente.\n\n✨ ¿En qué te puedo ayudar el día de hoy?` };

        default:
            return { isGpt: true };
    }
};

module.exports = { handleOnboarding };
