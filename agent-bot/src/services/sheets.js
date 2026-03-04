const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const creds = require('../../../credenciales-google.json');

const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

/**
 * Carga la configuración del cliente desde su hoja "CONFIG_SISTEMA"
 * @param {string} sheetId 
 */
async function loadClientConfig(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        // Extraemos Configuración Fila 2
        const sheet = doc.sheetsByTitle['CONFIG_SISTEMA'];
        if (!sheet) throw new Error("La pestaña CONFIG_SISTEMA no existe en este Sheet.");

        await sheet.loadCells('A2:I2');

        return {
            status: sheet.getCell(1, 0).value,      // A2: ESTADO_LICENCIA
            tone: sheet.getCell(1, 1).value,        // B2: TONO_IA
            businessName: sheet.getCell(1, 2).value,// C2: NOMBRE_NEGOCIO
            logoUrl: sheet.getCell(1, 3).value,     // D2: URL_LOGO
            primaryColor: sheet.getCell(1, 4).value,// E2: COLOR_PRIMARIO
            welcomeMsg: sheet.getCell(1, 5).value,  // F2: MENSAJE_BIENVENIDA
            systemPrompt: sheet.getCell(1, 6).value,// G2: PROMPT_SISTEMA
            aiModel: sheet.getCell(1, 7).value,     // H2: MODELO_IA
            openApiKey: sheet.getCell(1, 8).value   // I2: OPENAI_API_KEY
        };
    } catch (e) {
        console.error("❌ Error conectando a Google Sheets:", e.message);
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

module.exports = { loadClientConfig, loadServicesConfig };
