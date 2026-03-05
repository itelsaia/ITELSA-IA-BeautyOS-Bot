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

            return {
                id: cleanData['ID_SERVICIO'] || 'SIN_ID',
                intent: cleanData['INTENCION'] || '',
                response: cleanData['RESPUESTA_BASE'] || '',
                timeMins: cleanData['TIEMPO_SERVICIO'] || '0',
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

module.exports = { loadClientConfig, loadServicesConfig, loadKnowledgeConfig, loadRegisteredClients };
