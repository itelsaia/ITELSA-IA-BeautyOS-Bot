const { OpenAI } = require("openai");

/**
 * Transcribe un audio usando OpenAI Whisper API.
 * Soporta notas de voz (PTT/OGG Opus) y archivos de audio.
 * @param {Buffer} audioBuffer - Buffer del archivo de audio
 * @param {string} apiKey - API key de OpenAI
 * @returns {string|null} Texto transcrito o null si falla
 */
async function transcribeAudio(audioBuffer, apiKey) {
    try {
        if (!audioBuffer || audioBuffer.length === 0) {
            console.warn('[Whisper] Buffer de audio vacio o nulo');
            return null;
        }

        console.log(`[Whisper] Transcribiendo audio: ${audioBuffer.length} bytes`);

        const openai = new OpenAI({ apiKey });

        // Crear un File-like object para la API de OpenAI
        const file = new File([audioBuffer], 'audio.ogg', { type: 'audio/ogg' });

        const transcription = await openai.audio.transcriptions.create({
            file,
            model: 'whisper-1',
            language: 'es',
            response_format: 'text'
        });

        const text = (transcription || '').trim();
        if (!text) {
            console.warn('[Whisper] Transcripcion vacia');
            return null;
        }

        return text;
    } catch (error) {
        console.error('[Whisper] Error transcribiendo audio:', error.message);
        if (error.response) {
            console.error('[Whisper] Response status:', error.response.status);
        }
        return null;
    }
}

module.exports = { transcribeAudio };
