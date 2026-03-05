const axios = require('axios');

/**
 * Servicio centralizado para comunicarse con el Backend de Google Apps Script (ERP)
 */
class ApiService {
    constructor() {
        this.webhookUrl = process.env.WEBHOOK_GAS_URL;
    }

    /**
     * Envía datos del nuevo cliente (Lead) a la hoja CLIENTES
     * @param {Object} payload { celular, nombre, correo, cumple, direccion }
     */
    async createCliente(payload) {
        if (!this.webhookUrl) {
            console.error("❌ WEBHOOK_GAS_URL no está definido en .env");
            return false;
        }

        try {
            const response = await axios.post(this.webhookUrl, {
                action: 'createCliente',
                payload: payload
            });

            if (response.data.code === 200) {
                console.log(`✅ Cliente ${payload.nombre} registrado exitosamente en Sheets.`);
                return true;
            } else {
                console.error("⚠️ Error lógico en GAS:", response.data.message);
                return false;
            }
        } catch (error) {
            console.error("❌ Error HTTP contactando GAS:", error.message);
            return false;
        }
    }

    /**
     * Envía datos para agendar una nueva cita en la hoja AGENDA
     * @param {Object} payload { id, fecha, inicio, fin, cliente, servicio, profesional }
     */
    async createAgenda(payload) {
        if (!this.webhookUrl) return false;

        try {
            const response = await axios.post(this.webhookUrl, {
                action: 'createAgenda',
                payload: payload
            });

            if (response.data.code === 200) {
                console.log(`✅ Cita confirmada e insertada en Sheets (ID: ${payload.id}).`);
                return true;
            } else {
                console.error("⚠️ Error lógico en GAS:", response.data.message);
                return false;
            }
        } catch (error) {
            console.error("❌ Error HTTP contactando GAS:", error.message);
            return false;
        }
    }
}

module.exports = new ApiService();
