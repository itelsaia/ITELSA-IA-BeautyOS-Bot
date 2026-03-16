const axios = require('axios');

/**
 * Cliente REST para comunicarse con Evolution API v2.
 * Reemplaza la dependencia directa de whatsapp-web.js.
 */
class EvolutionClient {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.apiKey = apiKey;
        this.http = axios.create({
            baseURL: this.baseUrl,
            headers: { 'apikey': this.apiKey, 'Content-Type': 'application/json' },
            timeout: 15000
        });
    }

    /**
     * Envía un mensaje de texto a un número vía una instancia específica.
     * @param {string} instanceName Nombre de la instancia de Evolution API
     * @param {string} number Número destino con código de país (ej. 573145551234)
     * @param {string} text Texto del mensaje
     * @param {number} delay Delay en ms antes de enviar (simula "escribiendo...")
     */
    async sendText(instanceName, number, text, delay = 1200) {
        try {
            const response = await this.http.post(
                `/message/sendText/${instanceName}`,
                { number, text, delay }
            );
            return response.data;
        } catch (error) {
            console.error(`[Evolution] Error enviando mensaje a ${number}:`, error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Envía un archivo multimedia (imagen, video, documento) a un número.
     * @param {string} instanceName Nombre de la instancia
     * @param {string} number Número destino con código de país
     * @param {string} mediaType Tipo: "image" | "video" | "document"
     * @param {string} mediaUrl URL pública del archivo (Google Drive, etc.)
     * @param {string} caption Texto acompañante (opcional)
     * @param {string} fileName Nombre del archivo para documentos (opcional)
     */
    async sendMedia(instanceName, number, mediaType, mediaUrl, caption = '', fileName = '') {
        try {
            const body = { number, mediatype: mediaType, media: mediaUrl, caption };
            if (fileName) body.fileName = fileName;
            const response = await this.http.post(
                `/message/sendMedia/${instanceName}`, body
            );
            return response.data;
        } catch (error) {
            console.error(`[Evolution] Error enviando media a ${number}:`, error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Crea una nueva instancia de WhatsApp en Evolution API.
     * @param {string} instanceName Nombre único de la instancia
     */
    async createInstance(instanceName) {
        try {
            const response = await this.http.post('/instance/create', {
                instanceName,
                integration: 'WHATSAPP-BAILEYS',
                qrcode: true
            });
            console.log(`[Evolution] Instancia "${instanceName}" creada exitosamente.`);
            return response.data;
        } catch (error) {
            // Si ya existe, no es error crítico
            if (error.response?.status === 403 || error.response?.data?.message?.includes('already')) {
                console.log(`[Evolution] Instancia "${instanceName}" ya existe.`);
                return null;
            }
            console.error(`[Evolution] Error creando instancia "${instanceName}":`, error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Obtiene el estado de conexión de una instancia.
     * @param {string} instanceName
     * @returns {Object} { state: 'open' | 'close' | 'connecting' }
     */
    async getConnectionState(instanceName) {
        try {
            const response = await this.http.get(`/instance/connectionState/${instanceName}`);
            return response.data;
        } catch (error) {
            // Si la instancia no existe (404), re-lanzar para que app.js la cree
            if (error.response?.status === 404) {
                console.log(`[Evolution] Instancia "${instanceName}" no existe (404).`);
                throw error;
            }
            console.error(`[Evolution] Error consultando estado de "${instanceName}":`, error.response?.data || error.message);
            return { state: 'unknown' };
        }
    }

    /**
     * Reinicia una instancia existente.
     * @param {string} instanceName
     */
    async restartInstance(instanceName) {
        try {
            const response = await this.http.put(`/instance/restart/${instanceName}`);
            console.log(`[Evolution] Instancia "${instanceName}" reiniciada.`);
            return response.data;
        } catch (error) {
            console.error(`[Evolution] Error reiniciando "${instanceName}":`, error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Descarga el contenido multimedia (audio, imagen, etc.) de un mensaje en base64.
     * @param {string} instanceName Nombre de la instancia
     * @param {Object} messageKey Objeto key del mensaje (remoteJid, fromMe, id)
     * @returns {Buffer|null} Buffer del archivo o null si falla
     */
    async getMediaBase64(instanceName, messageKey) {
        try {
            const response = await this.http.post(
                `/chat/getBase64FromMediaMessage/${instanceName}`,
                { message: { key: messageKey } }
            );
            const base64Data = response.data?.base64;
            if (!base64Data) return null;
            return Buffer.from(base64Data, 'base64');
        } catch (error) {
            console.error(`[Evolution] Error descargando media de "${instanceName}":`, error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Obtiene el QR code de una instancia para escanear.
     * @param {string} instanceName
     */
    async getQrCode(instanceName) {
        try {
            const response = await this.http.get(`/instance/connect/${instanceName}`);
            return response.data;
        } catch (error) {
            console.error(`[Evolution] Error obteniendo QR de "${instanceName}":`, error.response?.data || error.message);
            return null;
        }
    }
}

module.exports = EvolutionClient;
