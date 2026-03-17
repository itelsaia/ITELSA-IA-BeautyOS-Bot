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
            systemPrompt: `Eres ${configRaw['NOMBRE_AGENTE'] || 'un asistente virtual amable y conciso'}, y trabajas para el negocio de estética y belleza llamado ${configRaw['NOMBRE_NEGOCIO'] || 'la tienda'}.`,
            slotInterval: parseInt(configRaw['INTERVALO_SLOTS_MIN']) || 15,
            bufferTime: parseInt(configRaw['TIEMPO_ENTRE_CITAS_MIN']) || 15,
            expirationMinutes: parseInt(configRaw['MINUTOS_VENCIMIENTO_CITA']) || 30,
            // Config global de Anticipo (datos bancarios, momento, politica)
            // NOTA: ANTICIPO_HABILITADO, TIPO_ANTICIPO, VALOR_ANTICIPO ahora son per-service en CONFIG_SERVICIOS
            paymentInstructions: configRaw['DATOS_PAGO'] || '',
            paymentMoment: (configRaw['MOMENTO_ANTICIPO'] || 'DESPUES').toUpperCase(),
            paymentPolicy: configRaw['POLITICA_ANTICIPO'] || '',
            // Clasificacion automatica de clientes
            classifyOcasional: parseInt(configRaw['UMBRAL_OCASIONAL']) || 1,
            classifyFrecuente: parseInt(configRaw['UMBRAL_FRECUENTE']) || 4,
            classifyVip: parseInt(configRaw['UMBRAL_VIP']) || 9,
            // Ubicacion del negocio
            businessAddress: configRaw['DIRECCION_NEGOCIO'] || '',
            locationLink: configRaw['ENLACE_UBICACION'] || '',
            // Difusion de promos — ahora se configura POR PROMO en hoja PROMOCIONES
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
                category: cleanData['CATEGORIA'] || 'General',
                // Per-service anticipo config (columnas G, H, I de CONFIG_SERVICIOS)
                anticipoEnabled: (cleanData['ANTICIPO_HABILITADO'] || '').toUpperCase() === 'SI',
                anticipoType: (cleanData['TIPO_ANTICIPO'] || 'FIJO').toUpperCase(),
                anticipoValue: parseInt(String(cleanData['VALOR_ANTICIPO'] || '0').replace(/[.,]/g, ''), 10) || 0
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
 * Carga la galería multimedia vinculada a cada servicio (GALERIA_SERVICIOS).
 * @param {string} sheetId
 * @returns {Promise<Object>} Objeto agrupado por ID_SERVICIO: { "DIS-001": [{ type, title, description, url, order }] }
 */
async function loadServiceGallery(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['GALERIA_SERVICIOS'];
        if (!sheet) return {};

        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        const gallery = {};
        rows.forEach(row => {
            const rawData = row.toObject();
            const cleanData = {};
            for (let key in rawData) {
                if (key) cleanData[key.trim().toUpperCase()] = rawData[key];
            }
            const serviceId = (cleanData['ID_SERVICIO'] || '').toString().trim();
            if (!serviceId) return;

            if (!gallery[serviceId]) gallery[serviceId] = [];
            gallery[serviceId].push({
                type: (cleanData['TIPO_MEDIA'] || 'imagen').toLowerCase(),
                title: cleanData['TITULO'] || '',
                description: cleanData['DESCRIPCION'] || '',
                url: cleanData['URL_MEDIA'] || '',
                order: parseInt(cleanData['ORDEN']) || 1
            });
        });

        // Ordenar por ORDEN dentro de cada servicio
        for (let sid in gallery) {
            gallery[sid].sort((a, b) => a.order - b.order);
        }
        return gallery;

    } catch (e) {
        console.error("⚠️ Error cargando galería de servicios:", e.message);
        return {};
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
                    id: data['ID_CLIENTE'] || '',
                    cumple: (data['CUMPLE'] || '').toString().trim(),
                    exemptFromPayment: (data['EXENTO_ANTICIPO'] || '').toUpperCase() === 'SI',
                    tipo: (data['TIPO'] || 'Nuevo').toString().trim()
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
                        estado: estado,
                        profesional: data['PROFESIONAL'] || 'Por asignar',
                        // Columnas de promo
                        promo: (data['PROMO'] || '').toUpperCase().trim(),
                        tipoPromo: (data['TIPO_PROMO'] || '').trim(),
                        // Columnas de anticipo/pago
                        exentoAnticipo: (data['EXENTO_ANTICIPO'] || '').toUpperCase() === 'SI',
                        montoAnticipo: parseInt(data['MONTO_ANTICIPO']) || 0,
                        montoPagado: parseInt(data['MONTO_PAGADO']) || 0,
                        saldoRestante: parseInt(data['SALDO_RESTANTE']) || 0,
                        estadoPago: data['ESTADO_PAGO'] || '',
                        refComprobante: data['REF_COMPROBANTE'] || '',
                        fechaPago: data['FECHA_PAGO'] || ''
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
                estado: (cleanData['ESTADO'] || '').toUpperCase().trim(),
                aplicaTipoCliente: (cleanData['APLICA_TIPO_CLIENTE'] || 'TODOS').trim(),
                tipoMediaPromo: (cleanData['TIPO_MEDIA_PROMO'] || '').toLowerCase().trim(),
                urlMediaPromo: (cleanData['URL_MEDIA_PROMO'] || '').trim(),
                maxUsosCliente: parseInt(cleanData['MAX_USOS_CLIENTE'], 10) || 0,
                // Difusion automatica por promo
                difusionEnabled: (cleanData['DIFUSION'] || 'NO').toUpperCase() === 'SI',
                horaDifusion: (cleanData['HORA_DIFUSION'] || '').trim(),
                maxEnviosDifusion: Math.min(parseInt(cleanData['MAX_ENVIOS_DIFUSION'], 10) || 20, 50),
                mensajeDifusion: (cleanData['MENSAJE_DIFUSION'] || '').trim()
            };
        }).filter(item => item.nombre !== '');

    } catch (e) {
        console.error("❌ Error cargando PROMOCIONES:", e.message);
        return [];
    }
}

/**
 * Carga la disponibilidad (jornadas y bloqueos) desde la hoja DISPONIBILIDAD.
 * @param {string} sheetId
 * @returns {Promise<Array>} Arreglo de registros de disponibilidad
 */
async function loadDisponibilidad(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['DISPONIBILIDAD'];
        if (!sheet) {
            console.warn("⚠️ La pestaña DISPONIBILIDAD no existe.");
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
                tipo: (cleanData['TIPO'] || '').trim(),
                fechaDia: (cleanData['FECHA_DIA'] || '').trim(),
                horaIni: (cleanData['HORA_INI'] || '').trim(),
                horaFin: (cleanData['HORA_FIN'] || '').trim(),
                motivo: (cleanData['MOTIVO'] || '').trim(),
                aplicaA: (cleanData['APLICA_A'] || '').trim(),
                horario: (cleanData['HORARIO'] || '').trim(),
                categoria: (cleanData['CATEGORIA'] || '').trim()
            };
        }).filter(item => item.tipo !== '');

    } catch (e) {
        console.error("❌ Error cargando DISPONIBILIDAD:", e.message);
        return [];
    }
}

/**
 * Carga la configuracion de festivos colombianos desde FESTIVOS_CONFIG.
 * @param {string} sheetId
 * @returns {Promise<Array>} Arreglo de {ano, fecha, nombre, trabaja}
 */
async function loadFestivosConfig(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['FESTIVOS_CONFIG'];
        if (!sheet) {
            console.warn("⚠️ La pestaña FESTIVOS_CONFIG no existe.");
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
                ano: parseInt(cleanData['ANO']) || 0,
                fecha: (cleanData['FECHA'] || '').trim(),
                nombre: (cleanData['NOMBRE'] || '').trim(),
                trabaja: (cleanData['TRABAJA'] || 'NO').toUpperCase().trim(),
                horaIni: (cleanData['HORA_INI'] || '').trim(),
                horaFin: (cleanData['HORA_FIN'] || '').trim()
            };
        }).filter(item => item.fecha !== '');

    } catch (e) {
        console.error("❌ Error cargando FESTIVOS_CONFIG:", e.message);
        return [];
    }
}

/**
 * Carga los colaboradores activos desde la hoja COLABORADORES.
 * @param {string} sheetId
 * @returns {Promise<Array>} Arreglo de colaboradores
 */
async function loadColaboradores(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['COLABORADORES'];
        if (!sheet) {
            console.warn("⚠️ La pestaña COLABORADORES no existe.");
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
                id: (cleanData['ID_COLABORADOR'] || '').trim(),
                nombre: (cleanData['NOMBRE'] || '').trim(),
                rol: (cleanData['ROL'] || '').trim(),
                estado: (cleanData['ESTADO'] || '').trim(),
                competencias: (cleanData['COMPETENCIAS'] || '').trim()
            };
        }).filter(item => item.id !== '' && item.estado === 'ACTIVO');

    } catch (e) {
        console.error("❌ Error cargando COLABORADORES:", e.message);
        return [];
    }
}

/**
 * Carga citas vencidas (PENDIENTE o REAGENDADO) que ya pasaron su hora de fin + umbral de minutos.
 * Estas citas deben pasar automáticamente a estado RECHAZADO.
 * @param {string} sheetId
 * @param {number} minutesThreshold Minutos de gracia después de la hora fin (default 30)
 * @returns {Promise<Array>} Array de { id, fecha, fin, celular, servicio, cliente }
 */
async function loadExpiredAppointments(sheetId, minutesThreshold = 30) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['AGENDA'];
        if (!sheet) return [];

        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        // Hora actual en Colombia
        const nowColombia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        const expired = [];

        rows.forEach(row => {
            const data = row.toObject();
            const estado = (data['ESTADO'] || '').toUpperCase().trim();
            if (estado !== 'PENDIENTE' && estado !== 'REAGENDADO') return;

            const fechaStr = (data['FECHA'] || '').trim();
            const finStr = (data['FIN'] || '').trim();
            if (!fechaStr || !finStr) return;

            // Parsear fecha DD/MM/YYYY
            const parts = fechaStr.split('/');
            if (parts.length !== 3) return;

            // Parsear hora fin HH:MM
            const timeParts = finStr.split(':');
            if (timeParts.length < 2) return;

            // Construir fecha+hora de fin de la cita
            const citaEnd = new Date(
                parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]),
                parseInt(timeParts[0]), parseInt(timeParts[1] || '0')
            );

            // Calcular diferencia en minutos
            const diffMs = nowColombia.getTime() - citaEnd.getTime();
            const diffMinutes = diffMs / (1000 * 60);

            if (diffMinutes >= minutesThreshold) {
                expired.push({
                    id: (data['ID'] || '').trim(),
                    fecha: fechaStr,
                    fin: finStr,
                    celular: (data['CELULAR_CLIENTE'] || '').toString().trim(),
                    servicio: (data['SERVICIO'] || '').trim(),
                    cliente: (data['CLIENTE'] || '').trim()
                });
            }
        });

        return expired;
    } catch (error) {
        console.error("❌ Error cargando citas vencidas:", error.message);
        return [];
    }
}

/**
 * Carga el conteo de uso de promos por cliente desde la hoja AGENDA.
 * Solo cuenta citas con ESTADO PENDIENTE o EJECUTADO y PROMO = SI.
 * @returns {Object} { "573001234567": { "Martes de Cejas": 2 }, ... }
 */
async function loadPromoUsage(sheetId) {
    try {
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['AGENDA'];
        if (!sheet) return {};
        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        const usage = {};
        rows.forEach(row => {
            const rawData = row.toObject();
            const cleanData = {};
            for (let key in rawData) {
                if (key) cleanData[key.trim().toUpperCase()] = rawData[key];
            }
            const estado = (cleanData['ESTADO'] || '').toUpperCase().trim();
            const promo = (cleanData['PROMO'] || '').toUpperCase().trim();
            const tipoPromo = (cleanData['TIPO_PROMO'] || '').trim();
            const celular = (cleanData['CELULAR_CLIENTE'] || '').trim();

            if (promo !== 'SI' || !tipoPromo || !celular) return;
            if (estado !== 'PENDIENTE' && estado !== 'EJECUTADO') return;

            if (!usage[celular]) usage[celular] = {};
            if (!usage[celular][tipoPromo]) usage[celular][tipoPromo] = 0;
            usage[celular][tipoPromo]++;
        });
        return usage;
    } catch (e) {
        console.error("⚠️ Error cargando uso de promos:", e.message);
        return {};
    }
}

module.exports = { loadClientConfig, loadServicesConfig, loadKnowledgeConfig, loadServiceGallery, loadRegisteredClients, loadPendingAppointments, loadPromotions, loadDisponibilidad, loadColaboradores, loadExpiredAppointments, loadPromoUsage, loadFestivosConfig };
