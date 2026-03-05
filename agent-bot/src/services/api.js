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
     * @param {Object} payload { fecha, inicio, fin, cliente, celularCliente, servicio, precio, profesional, notas }
     * @returns {string|false} El ID generado de la cita (AGD-XXX) o false si falla
     */
    async createAgenda(payload) {
        if (!this.webhookUrl) return false;

        try {
            const response = await axios.post(this.webhookUrl, {
                action: 'createAgenda',
                payload: payload
            });

            if (response.data.code === 200) {
                const agendaId = response.data.data ? response.data.data.id : null;
                console.log(`✅ Cita confirmada e insertada en Sheets (ID: ${agendaId}).`);
                return agendaId || true;
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
     * Actualiza el estado de una cita en Google Sheets
     * @param {string} agendaId ID de la cita (ej. AGD-001)
     * @param {string} nuevoEstado Estado a aplicar (ej. EJECUTADO)
     */
    async updateAgendaStatus(agendaId, nuevoEstado) {
        if (!this.webhookUrl) return false;

        try {
            const response = await axios.post(this.webhookUrl, {
                action: 'updateAgendaStatus',
                payload: { id: agendaId, nuevoEstado: nuevoEstado }
            });

            if (response.data.code === 200) {
                console.log(`✅ Estado de cita ${agendaId} actualizado a ${nuevoEstado}.`);
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
     * Reagenda una cita existente actualizando sus campos in-place y cambiando su estado a REAGENDADO
     */
    async rescheduleAgenda(payload) {
        if (!this.webhookUrl) return false;

        try {
            const response = await axios.post(this.webhookUrl, {
                action: 'rescheduleAgenda',
                payload: payload
            });

            if (response.data.code === 200) {
                console.log(`✅ Cita ${payload.id} reagendada in-place exitosamente.`);
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
