const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const creds = require('../../../credenciales-google.json');

const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

/**
 * Carga la configuración del cliente desde su hoja "CONFIGURACION"
 * Formato esperado Col A: CLAVE, Col B: VALOR
 * @param {string} sheetId 
 */
async function loadClientConfig(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['CONFIGURACION'];
        if (!sheet) throw new Error("La pestaña CONFIGURACION no existe en este Sheet.");

        const rows = await sheet.getRows();
        const configRaw = {};

        // Recorrer filas y convertir en diccionario clave-valor
        rows.forEach(row => {
            const rowObj = row.toObject();
            const rawKey = rowObj['CLAVE'];
            const rawVal = rowObj['VALOR'];

            if (rawKey && rawKey.trim() !== '') {
                configRaw[rawKey.trim()] = rawVal || '';
            }
        });

        // Mapeo unificado para el agente
        return {
            status: configRaw['ESTADO_SERVICIO'],
            openApiKey: configRaw['CLAVE_OPENAI'],
            businessName: configRaw['NOMBRE_NEGOCIO'],
            agentName: configRaw['NOMBRE_AGENTE'],
            welcomeMsg: configRaw['SALUDO_BASE'],
            ownerPhone: configRaw['CELULAR_DUEÑA'],
            ownerEmail: configRaw['CORREO_DUEÑA'],
            systemPrompt: `Eres ${configRaw['NOMBRE_AGENTE'] || 'un asistente virtual amable y conciso'}, y trabajas para el negocio de estética y belleza llamado ${configRaw['NOMBRE_NEGOCIO'] || 'la tienda'}.`
        };
    } catch (e) {
        console.error("❌ Error conectando a Google Sheets (CONFIGURACION):", e.message);
        return null;
    }
}

/**
 * Extrae el Catálogo de Servicios (RAG) configurado por el cliente
 * @param {string} sheetId 
 * @returns {Promise<Array>} Arreglo de servicios con sus detalles
 */
async function loadServicesConfig(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['CONFIG_SERVICIOS'];
        if (!sheet) {
            console.warn("⚠️ La pestaña CONFIG_SERVICIOS no existe.");
            return [];
        }

        await sheet.loadHeaderRow(); // Forzar recarga de headers por si acaso
        console.log("=== DEBUG HEADERS ===");
        console.log(sheet.headerValues);

        const rows = await sheet.getRows();

        // Transformamos cada fila en un objeto manejable y a prueba de errores de espacios
        return rows.map(row => {
            const rawData = row.toObject();
            const cleanData = {};
            // Limpiar las llaves de posibles espacios accidentales que el cliente pudo haber dejado
            for (let key in rawData) {
                if (key) cleanData[key.trim().toUpperCase()] = rawData[key];
            }

            // Intentar extraer un precio numérico de la descripción para agendamientos.
            // Busca símbolos como $25.000 o 25000 y extrae el número base.
            const textResponse = cleanData['RESPUESTA_BASE'] || '';
            let parsedPrice = 0;
            const priceMatch = textResponse.match(/\$?\s*([\d.,]+)/);
            if (priceMatch) {
                // Remueve puntos y comas para guardarlo como int puro
                parsedPrice = parseInt(priceMatch[1].replace(/[.,]/g, ''), 10) || 0;
            }

            return {
                id: cleanData['ID_SERVICIO'] || 'SIN_ID',
                intent: cleanData['INTENCION'] || '',
                name: cleanData['TIPO_SERVICIO'] || cleanData['INTENCION'] || '',
                response: textResponse,
                timeMins: cleanData['TIEMPO_SERVICIO'] || '0',
                price: parsedPrice, // Precio explícito extraído
                category: cleanData['CATEGORIA'] || 'General'
            };
        }).filter(item => item.id !== 'SIN_ID' || item.intent !== ''); // Filtrar filas vacías

    } catch (e) {
        console.error("❌ Error cargando Catálogo de Servicios:", e.message);
        return [];
    }
}

/**
 * Extrae la Base de Conocimiento (RAG para Multimedia/FAQs) configurada
 * @param {string} sheetId 
 * @returns {Promise<Array>} Arreglo de respuestas predefinidas y URLs
 */
async function loadKnowledgeConfig(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['CONOCIMIENTO'];
        if (!sheet) {
            console.warn("⚠️ La pestaña CONOCIMIENTO no existe.");
            return [];
        }

        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        return rows.map(row => {
            const rawData = row.toObject();
            const cleanData = {};
            for (let key in rawData) {
                if (key) cleanData[key.trim().toUpperCase()] = rawData[key];
            }

            return {
                intent: cleanData['INTENCION'] || '',
                response: cleanData['RESPUESTA'] || '',
                mediaType: cleanData['TIPO_MEDIA'] || '',
                url: cleanData['URL'] || ''
            };
        }).filter(item => item.intent !== ''); // Solo filas válidas

    } catch (e) {
        console.error("❌ Error cargando Base de Conocimiento:", e.message);
        return [];
    }
}

/**
 * Carga todo el CRM de clientes al arrancar para reconocer usuarios viejos si el bot se reinicia
 * @param {string} sheetId 
 * @returns {Promise<Object>} Diccionario con { "57314...": { nombre: "Juan" } }
 */
async function loadRegisteredClients(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['CLIENTES'];
        if (!sheet) return {};

        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        const clientsDict = {};
        rows.forEach(row => {
            const data = row.toObject();
            const celular = (data['CELULAR'] || '').toString().trim();
            if (celular) {
                clientsDict[celular] = {
                    nombre: data['NOMBRE'] || '',
                    correo: data['CORREO'] || '',
                    id: data['ID_CLIENTE'] || ''
                };
            }
        });

        return clientsDict;

    } catch (e) {
        console.error("❌ Error cargando Base de Clientes (CRM):", e.message);
        return {};
    }
}

/**
 * Carga las citas de la hoja AGENDA que estén en estado PENDIENTE o REAGENDADO.
 * @param {string} sheetId 
 * @returns {Promise<Object>} Diccionario donde la llave es el celular del cliente y el valor es un array de sus citas activas.
 */
async function loadPendingAppointments(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['AGENDA'];
        if (!sheet) return {};

        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();
        const pendingAppointments = {};

        // Fecha de hoy en zona horaria Colombia (para filtrar citas pasadas)
        const hoyStr = new Date().toLocaleString('en-CA', { timeZone: 'America/Bogota' }).split(',')[0]; // "YYYY-MM-DD"
        const hoy = new Date(hoyStr + 'T00:00:00');

        rows.forEach(row => {
            const data = row.toObject();
            const estado = (data['ESTADO'] || '').toUpperCase().trim();
            if (estado === 'PENDIENTE' || estado === 'REAGENDADO') {
                // Filtrar citas con fecha pasada (formato esperado: DD/MM/YYYY)
                const fechaStr = (data['FECHA'] || '').trim();
                if (fechaStr) {
                    const parts = fechaStr.split('/');
                    if (parts.length === 3) {
                        const fechaCita = new Date(parts[2], parts[1] - 1, parts[0]); // YYYY, MM(0-based), DD
                        if (fechaCita < hoy) return; // Saltar citas pasadas
                    }
                }

                const celular = (data['CELULAR_CLIENTE'] || '').toString().trim();
                if (celular) {
                    if (!pendingAppointments[celular]) {
                        pendingAppointments[celular] = [];
                    }
                    pendingAppointments[celular].push({
                        id: data['ID'] || 'N/A',
                        fecha: data['FECHA'] || 'N/A',
                        inicio: data['INICIO'] || 'N/A',
                        fin: data['FIN'] || 'N/A',
                        servicio: data['SERVICIO'] || 'N/A',
                        precio: data['PRECIO'] || 'N/A',
                        estado: estado
                    });
                }
            }
        });

        return pendingAppointments;
    } catch (error) {
        console.error("❌ Error cargando AGENDA pendiente:", error.message);
        return {};
    }
}

/**
 * Carga las promociones vigentes desde la hoja PROMOCIONES.
 * @param {string} sheetId
 * @returns {Promise<Array>} Arreglo de promociones con sus detalles
 */
async function loadPromotions(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['PROMOCIONES'];
        if (!sheet) {
            console.warn("⚠️ La pestaña PROMOCIONES no existe.");
            return [];
        }

        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        return rows.map(row => {
            const rawData = row.toObject();
            const cleanData = {};
            for (let key in rawData) {
                if (key) cleanData[key.trim().toUpperCase()] = rawData[key];
            }

            return {
                nombre: cleanData['NOMBRE'] || '',
                descripcion: cleanData['DESCRIPCION'] || '',
                tipoPromo: (cleanData['TIPO_PROMO'] || '').toUpperCase().trim(),
                valorDescuento: parseInt(cleanData['VALOR_DESCUENTO'], 10) || 0,
                aplicaServicio: cleanData['APLICA_SERVICIO'] || 'TODOS',
                aplicaDia: cleanData['APLICA_DIA'] || '',
                vence: cleanData['VENCE'] || '',
                estado: (cleanData['ESTADO'] || '').toUpperCase().trim()
            };
        }).filter(item => item.nombre !== '');

    } catch (e) {
        console.error("❌ Error cargando PROMOCIONES:", e.message);
        return [];
    }
}

module.exports = { loadClientConfig, loadServicesConfig, loadKnowledgeConfig, loadRegisteredClients, loadPendingAppointments, loadPromotions };
