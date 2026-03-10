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
