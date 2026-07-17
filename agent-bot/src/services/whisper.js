const { OpenAI } = require("openai");

const MAX_AUDIO_TRANSCRIPTION_BYTES = 20 * 1024 * 1024;

function getAudioFileInfo(mimeType = '') {
    const normalizedMime = String(mimeType || 'audio/ogg').split(';')[0].trim().toLowerCase();
    const extensionByMime = {
        'audio/ogg': 'ogg',
        'audio/opus': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/mp4': 'm4a',
        'audio/x-m4a': 'm4a',
        'audio/wav': 'wav',
        'audio/webm': 'webm'
    };
    return {
        mimeType: normalizedMime || 'audio/ogg',
        fileName: `audio.${extensionByMime[normalizedMime] || 'ogg'}`
    };
}

/**
 * Transcribe un audio usando OpenAI Whisper API.
 * Soporta notas de voz (PTT/OGG Opus) y archivos de audio.
 * @param {Buffer} audioBuffer - Buffer del archivo de audio
 * @param {string} apiKey - API key de OpenAI
 * @param {string} mimeType - MIME original reportado por WhatsApp/Evolution
 * @returns {string|null} Texto transcrito o null si falla
 */
async function transcribeAudio(audioBuffer, apiKey, mimeType = 'audio/ogg') {
    try {
        if (!audioBuffer || audioBuffer.length === 0) {
            console.warn('[Whisper] Buffer de audio vacio o nulo');
            return null;
        }
        if (audioBuffer.length > MAX_AUDIO_TRANSCRIPTION_BYTES) {
            console.warn(`[Whisper] Audio supera limite seguro (${audioBuffer.length} bytes)`);
            return null;
        }

        console.log(`[Whisper] Transcribiendo audio: ${audioBuffer.length} bytes`);

        const openai = new OpenAI({ apiKey, timeout: 30000, maxRetries: 1 });
        const fileInfo = getAudioFileInfo(mimeType);

        // Crear un File-like object para la API de OpenAI
        const file = new File([audioBuffer], fileInfo.fileName, { type: fileInfo.mimeType });

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

module.exports = { transcribeAudio, getAudioFileInfo, MAX_AUDIO_TRANSCRIPTION_BYTES };
