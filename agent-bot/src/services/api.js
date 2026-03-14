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
        if (!this.webhookUrl) {
            console.error("❌ webhookUrl no definido para updateAgendaStatus");
            return false;
        }

        try {
            const response = await axios.post(this.webhookUrl, {
                action: 'updateAgendaStatus',
                payload: { id: agendaId, nuevoEstado: nuevoEstado }
            }, { timeout: 15000 });

            const data = response.data;

            // GAS puede retornar texto HTML en vez de JSON si el deployment no esta actualizado
            if (typeof data === 'string') {
                console.error(`⚠️ GAS retornó texto en vez de JSON para ${agendaId}:`, data.substring(0, 200));
                return false;
            }

            if (data && data.code === 200) {
                console.log(`✅ Estado de cita ${agendaId} actualizado a ${nuevoEstado}.`);
                return true;
            } else {
                console.error(`⚠️ Error lógico en GAS (${agendaId} → ${nuevoEstado}):`, data?.message || JSON.stringify(data).substring(0, 200));
                return false;
            }
        } catch (error) {
            console.error(`❌ Error HTTP contactando GAS (${agendaId} → ${nuevoEstado}):`, error.message);
            return false;
        }
    }

    /**
     * Reagenda una cita existente actualizando sus campos in-place y cambiando su estado a REAGENDADO
     */
    async rescheduleAgenda(payload) {
        if (!this.webhookUrl) {
            console.error("❌ webhookUrl no definido para rescheduleAgenda");
            return false;
        }

        console.log(`📤 rescheduleAgenda → ${payload.id}:`, JSON.stringify(payload));

        try {
            const response = await axios.post(this.webhookUrl, {
                action: 'rescheduleAgenda',
                payload: payload
            }, { timeout: 15000 });

            const data = response.data;

            if (typeof data === 'string') {
                console.error(`⚠️ GAS retornó texto en vez de JSON para reschedule ${payload.id}:`, data.substring(0, 200));
                return false;
            }

            if (data && data.code === 200) {
                console.log(`✅ Cita ${payload.id} reagendada in-place exitosamente.`);
                return true;
            } else {
                console.error(`⚠️ Error lógico en GAS (reschedule ${payload.id}):`, data?.message || JSON.stringify(data).substring(0, 200));
                return false;
            }
        } catch (error) {
            console.error(`❌ Error HTTP rescheduleAgenda (${payload.id}):`, error.message);
            return false;
        }
    }
    /**
     * Confirma el pago de anticipo de una cita, actualizando las columnas de pago en AGENDA.
     * @param {string} agendaId ID de la cita (ej. AG-CS-001)
     * @param {Object} paymentData { montoPagado, referencia, fechaPago }
     * @returns {boolean} true si se actualizó correctamente
     */
    async confirmarPago(agendaId, paymentData) {
        if (!this.webhookUrl) {
            console.error("❌ webhookUrl no definido para confirmarPago");
            return false;
        }

        try {
            const response = await axios.post(this.webhookUrl, {
                action: 'confirmarPago',
                payload: {
                    id: agendaId,
                    montoPagado: paymentData.montoPagado || 0,
                    referencia: paymentData.referencia || '',
                    fechaPago: paymentData.fechaPago || new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })
                }
            }, { timeout: 15000 });

            const data = response.data;

            if (typeof data === 'string') {
                console.error(`⚠️ GAS retornó texto en vez de JSON para confirmarPago ${agendaId}:`, data.substring(0, 200));
                return false;
            }

            if (data && data.code === 200) {
                console.log(`✅ Pago confirmado para cita ${agendaId}. Monto: $${paymentData.montoPagado}`);
                return true;
            } else {
                console.error(`⚠️ Error lógico en GAS (confirmarPago ${agendaId}):`, data?.message || JSON.stringify(data).substring(0, 200));
                return false;
            }
        } catch (error) {
            console.error(`❌ Error HTTP confirmarPago (${agendaId}):`, error.message);
            return false;
        }
    }

    /**
     * Cancela una cita existente cambiando su estado a CANCELADA
     * @param {string} agendaId ID de la cita (ej. AG-CS-001)
     */
    async cancelAgenda(agendaId) {
        if (!this.webhookUrl) return false;

        try {
            const response = await axios.post(this.webhookUrl, {
                action: 'updateAgendaStatus',
                payload: { id: agendaId, nuevoEstado: 'CANCELADA' }
            });

            if (response.data.code === 200) {
                console.log(`✅ Cita ${agendaId} cancelada exitosamente.`);
                return true;
            } else {
                console.error("⚠️ Error cancelando cita:", response.data.message);
                return false;
            }
        } catch (error) {
            console.error("❌ Error HTTP cancelando cita:", error.message);
            return false;
        }
    }
}

module.exports = new ApiService();
