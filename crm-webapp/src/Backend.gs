/**
 * Backend.gs
 * Lógica principal del servidor de Apps Script.
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('ITELSA BeautyOS CRM')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    const json = JSON.parse(e.postData.contents);
    const action = json.action;
    const payload = json.payload;

    if (!action || !payload) {
      return responseJSON(400, "Faltan parámetros 'action' o 'payload'");
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let result = null;

    switch (action) {
      case 'createCliente':
        result = handleCreateCliente(ss, payload);
        break;
      case 'createAgenda':
        result = handleCreateAgenda(ss, payload);
        break;
      case 'updateAgendaStatus':
        result = handleUpdateAgendaStatus(ss, payload);
        break;
      case 'rescheduleAgenda':
        result = handleRescheduleAgenda(ss, payload);
        break;
      default:
        return responseJSON(400, "Acción no reconocida: " + action);
    }

    return responseJSON(200, "Éxito", result);

  } catch (error) {
    return responseJSON(500, "Error Interno del API: " + error.message);
  }
}

// ============================================
// Controladores de Eventos (Triggers)
// ============================================

function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();
  
  // Autogenerar ID_COLABORADOR
  if (sheetName === "COLABORADORES") {
    const row = e.range.getRow();
    if (row > 1) { // Evitar fila de encabezados
      const idCell = sheet.getRange(row, 1);
      const rolCell = sheet.getRange(row, 4);
      
      const currentId = idCell.getValue().toString().trim();
      const currentRol = rolCell.getValue().toString().trim().toUpperCase();
      
      // Solo actuar si NO hay ID pero el usuario SI escribió un ROL (ADMIN o STAFF)
      if (currentId === "" && currentRol !== "") {
        let prefix = (currentRol === "ADMIN") ? "ADMIN-" : "COL-";
        
        // Buscar el número consecutivo más alto para ese prefijo
        let maxNum = 0;
        const data = sheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (i + 1 === row) continue;
          const idVal = data[i][0].toString();
          if (idVal.startsWith(prefix)) {
            const numStr = idVal.replace(prefix, "");
            const num = parseInt(numStr, 10);
            if (!isNaN(num) && num > maxNum) {
              maxNum = num;
            }
          }
        }
        
        // Asignar el nuevo consecutivo
        const nextId = prefix + (maxNum + 1).toString().padStart(3, '0');
        idCell.setValue(nextId);
      }
    }
  }
}

// ============================================
// Controladores de Acciones Módulo API
// ============================================

function handleCreateCliente(ss, payload) {
  const sheet = ss.getSheetByName("CLIENTES");
  if (!sheet) throw new Error("La hoja CLIENTES no existe.");
  
  // payload: { celular, nombre, correo, cumple, direccion, tipo }
  const registro = new Date().toLocaleString("es-CO");
  
  // 1. Calcular de forma segura el siguiente ID_CLIENTE (CLI-001)
  let maxNum = 0;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const idVal = data[i][0].toString();
    if (idVal.startsWith("CLI-")) {
      const numStr = idVal.replace("CLI-", "");
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  const nextId = "CLI-" + (maxNum + 1).toString().padStart(3, '0');
  
  // 2. Insertar los datos calculados
  sheet.appendRow([
    nextId,
    payload.celular || "",
    payload.nombre || "",
    payload.correo || "",
    payload.cumple || "",
    payload.direccion || "",
    payload.tipo || "Nuevo",
    registro
  ]);
  
  return { status: "Cliente creado exitosamente", celular: payload.celular };
}

function handleCreateAgenda(ss, payload) {
  const sheet = ss.getSheetByName("AGENDA");
  if (!sheet) throw new Error("La hoja AGENDA no existe.");
  
  // payload: { fecha, inicio, fin, cliente, celularCliente, servicio, precio, profesional, notas }

  // ── Generar ID inteligente: AG-CS-001 ──────────────────────────────────────
  // AG = Agendamiento | CS = Iniciales del nombre del cliente | 001 = Consecutivo por cliente
  const nombreCliente = (payload.cliente || "XX").trim();
  const palabras = nombreCliente.split(/\s+/).filter(p => p.length > 0);
  const iniciales = palabras.map(p => p[0].toUpperCase()).join('').substring(0, 3);
  const prefix = `AG-${iniciales}-`;

  // Contar citas existentes con el mismo prefijo de cliente para calcular el consecutivo
  let maxNum = 0;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const idVal = (data[i][0] || "").toString().trim();
    if (idVal.startsWith(prefix)) {
      const numStr = idVal.replace(prefix, "");
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  const agendaId = prefix + (maxNum + 1).toString().padStart(3, '0');
  // ──────────────────────────────────────────────────────────────────────────

  // ── Calcular TIPO_DIA automáticamente desde la fecha ────────────────────
  const tipoDia = calcularTipoDia(payload.fecha || "");
  // ──────────────────────────────────────────────────────────────────────────

  sheet.appendRow([
    agendaId,
    payload.fecha || "",
    tipoDia,
    payload.inicio || "",
    payload.fin || "",
    payload.cliente || "",
    payload.celularCliente || "",
    payload.servicio || "",
    payload.precio || 0,
    payload.profesional || "Por asignar",
    "PENDIENTE",
    payload.notas || ""
  ]);

  return { status: "Cita agendada exitosamente", id: agendaId };
}

/**
 * Actualiza el estado de una cita existente en la hoja AGENDA.
 * Payload: { id, nuevoEstado }
 * Estados válidos: PENDIENTE | EJECUTADO | RECHAZADO | REAGENDADO
 */
function handleUpdateAgendaStatus(ss, payload) {
  const sheet = ss.getSheetByName("AGENDA");
  if (!sheet) throw new Error("La hoja AGENDA no existe.");

  const estadosValidos = ["PENDIENTE", "EJECUTADO", "RECHAZADO", "REAGENDADO"];
  const nuevoEstado = (payload.nuevoEstado || "").toUpperCase().trim();

  if (!estadosValidos.includes(nuevoEstado)) {
    throw new Error("Estado inválido: " + nuevoEstado + ". Debe ser uno de: " + estadosValidos.join(", "));
  }

  const data = sheet.getDataRange().getValues();
  // La columna ESTADO es la columna K (index 10, base 1 = columna 11) — se corrió por TIPO_DIA
  const ESTADO_COL = 11;
  const ID_COL = 1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][ID_COL - 1].toString().trim() === payload.id.toString().trim()) {
      sheet.getRange(i + 1, ESTADO_COL).setValue(nuevoEstado);
      return { status: "Estado actualizado a " + nuevoEstado, id: payload.id };
    }
  }

  throw new Error("No se encontró la cita con ID: " + payload.id);
}

/**
 * Reagenda una cita existente: modifica los datos in-place, cambia estado a REAGENDADO y deja traza en NOTAS.
 * Payload: { id, nuevaFecha, nuevoInicio, nuevoFin, nuevosServicios, nuevoPrecio, notasAdicionales }
 */
function handleRescheduleAgenda(ss, payload) {
  const sheet = ss.getSheetByName("AGENDA");
  if (!sheet) throw new Error("La hoja AGENDA no existe.");

  const data = sheet.getDataRange().getValues();
  // Columnas base 1 (con TIPO_DIA después de FECHA):
  // 1: ID, 2: FECHA, 3: TIPO_DIA, 4: INICIO, 5: FIN, 8: SERVICIO, 9: PRECIO, 11: ESTADO, 12: NOTAS
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim() === payload.id.toString().trim()) {
      const fila = i + 1;

      // Capturar datos antiguos para trazabilidad
      const fecObj = data[i][1];
      const iniObj = data[i][3]; // INICIO ahora es columna 4 (index 3)

      // Formatear fechas si son objetos Date, de lo contrario usarlos como strings
      const fecAntigua = fecObj instanceof Date ? Utilities.formatDate(fecObj, Session.getScriptTimeZone(), "dd/MM/yyyy") : fecObj;
      const iniAntiguo = iniObj instanceof Date ? Utilities.formatDate(iniObj, Session.getScriptTimeZone(), "HH:mm") : iniObj;

      const srvAntiguo = data[i][7]; // SERVICIO ahora es columna 8 (index 7)
      const traza = `[Reagendamiento - Antes: ${fecAntigua} a las ${iniAntiguo} | ${srvAntiguo}]`;
      const notasPrevias = data[i][11] ? data[i][11] + "\n" : ""; // NOTAS ahora es columna 12 (index 11)

      // Actualizar datos de la fila
      sheet.getRange(fila, 2).setValue(payload.nuevaFecha);
      sheet.getRange(fila, 3).setValue(calcularTipoDia(payload.nuevaFecha)); // Recalcular TIPO_DIA
      sheet.getRange(fila, 4).setValue(payload.nuevoInicio);  // INICIO
      sheet.getRange(fila, 5).setValue(payload.nuevoFin);     // FIN
      sheet.getRange(fila, 8).setValue(payload.nuevosServicios); // SERVICIO
      sheet.getRange(fila, 9).setValue(payload.nuevoPrecio);    // PRECIO

      // Cambiar estado
      sheet.getRange(fila, 11).setValue("REAGENDADO"); // ESTADO

      // Añadir notas
      const nuevasNotas = notasPrevias + traza + (payload.notasAdicionales ? "\n" + payload.notasAdicionales : "");
      sheet.getRange(fila, 12).setValue(nuevasNotas); // NOTAS

      return { status: "Cita reagendada e in-place actualizada", id: payload.id };
    }
  }

  throw new Error("No se encontró la cita con ID: " + payload.id + " para reagendar.");
}

// ============================================
// Controladores CRM Web App — Módulo Promociones
// (Llamados via google.script.run desde index.html)
// ============================================

function getPromociones() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PROMOCIONES");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  return data.slice(1).map((row, i) => ({
    rowIndex: i + 2,
    nombre: row[0] || '',
    descripcion: row[1] || '',
    tipoPromo: row[2] || '',
    valorDescuento: row[3] || 0,
    aplicaServicio: row[4] || 'TODOS',
    aplicaDia: row[5] || '',
    vence: row[6] instanceof Date ? Utilities.formatDate(row[6], Session.getScriptTimeZone(), "dd/MM/yyyy") : (row[6] || ''),
    estado: row[7] || 'INACTIVO'
  }));
}

function savePromocion(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PROMOCIONES");
  if (!sheet) throw new Error("La hoja PROMOCIONES no existe.");

  sheet.appendRow([
    data.nombre || '',
    data.descripcion || '',
    (data.tipoPromo || 'PORCENTAJE').toUpperCase(),
    data.valorDescuento || 0,
    data.aplicaServicio || 'TODOS',
    data.aplicaDia || '',
    data.vence || '',
    (data.estado || 'ACTIVO').toUpperCase()
  ]);

  return { status: "Promoción creada exitosamente", nombre: data.nombre };
}

function updatePromocion(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PROMOCIONES");
  if (!sheet) throw new Error("La hoja PROMOCIONES no existe.");

  const row = data.rowIndex;
  if (!row || row < 2) throw new Error("Fila inválida para actualizar.");

  sheet.getRange(row, 1).setValue(data.nombre || '');
  sheet.getRange(row, 2).setValue(data.descripcion || '');
  sheet.getRange(row, 3).setValue((data.tipoPromo || '').toUpperCase());
  sheet.getRange(row, 4).setValue(data.valorDescuento || 0);
  sheet.getRange(row, 5).setValue(data.aplicaServicio || 'TODOS');
  sheet.getRange(row, 6).setValue(data.aplicaDia || '');
  sheet.getRange(row, 7).setValue(data.vence || '');
  sheet.getRange(row, 8).setValue((data.estado || '').toUpperCase());

  return { status: "Promoción actualizada", nombre: data.nombre };
}

function deletePromocion(rowIndex) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PROMOCIONES");
  if (!sheet) throw new Error("La hoja PROMOCIONES no existe.");

  if (rowIndex < 2) throw new Error("No se puede eliminar la fila de encabezados.");
  sheet.deleteRow(rowIndex);

  return { status: "Promoción eliminada" };
}

function togglePromocionEstado(rowIndex, nuevoEstado, nuevaFechaVence) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PROMOCIONES");
  if (!sheet) throw new Error("La hoja PROMOCIONES no existe.");

  if (rowIndex < 2) throw new Error("Fila inválida.");

  sheet.getRange(rowIndex, 8).setValue(nuevoEstado.toUpperCase());

  if (nuevoEstado.toUpperCase() === 'ACTIVO' && nuevaFechaVence) {
    sheet.getRange(rowIndex, 7).setValue(nuevaFechaVence);
  }

  return { status: "Estado cambiado a " + nuevoEstado, rowIndex: rowIndex };
}

function getServiciosDisponibles() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CONFIG_SERVICIOS");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const tipoIdx = headers.indexOf('TIPO_SERVICIO');
  const intencionIdx = headers.indexOf('INTENCION');

  return data.slice(1).map(row => {
    const nombre = (tipoIdx >= 0 ? row[tipoIdx] : '') || (intencionIdx >= 0 ? row[intencionIdx] : '');
    return nombre.toString().trim();
  }).filter(n => n !== '');
}

// ============================================
// Controladores CRM Web App — Módulo Configuración
// ============================================

function getConfiguracion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CONFIGURACION");
  if (!sheet || sheet.getLastRow() <= 1) return { flat: {}, detailed: [] };

  const data = sheet.getDataRange().getValues();
  const flat = {};
  const detailed = [];

  data.slice(1).forEach((row, i) => {
    const key = (row[0] || '').toString().trim();
    if (key) {
      flat[key] = (row[1] !== undefined && row[1] !== null) ? row[1].toString() : '';
      detailed.push({
        rowIndex: i + 2,
        clave: key,
        valor: (row[1] !== undefined && row[1] !== null) ? row[1].toString() : '',
        descripcion: (row[2] || '').toString()
      });
    }
  });

  return { flat: flat, detailed: detailed };
}

function updateConfiguracion(updates) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CONFIGURACION");
  if (!sheet) throw new Error("La hoja CONFIGURACION no existe.");

  const data = sheet.getDataRange().getValues();
  const existingKeys = [];

  // Actualizar claves existentes
  for (let i = 1; i < data.length; i++) {
    const key = (data[i][0] || '').toString().trim();
    existingKeys.push(key);
    if (key && updates.hasOwnProperty(key)) {
      sheet.getRange(i + 1, 2).setValue(updates[key]);
    }
  }

  // Crear claves nuevas que no existen en la hoja
  for (const key in updates) {
    if (updates.hasOwnProperty(key) && !existingKeys.includes(key)) {
      sheet.appendRow([key, updates[key], '']);
    }
  }

  return { status: "Configuración actualizada exitosamente" };
}

// ============================================
// Controladores CRM Web App — Módulo Clientes
// ============================================

function getClientes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CLIENTES");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  return data.slice(1).map((row, i) => ({
    rowIndex: i + 2,
    id: (row[0] || '').toString(),
    celular: (row[1] || '').toString(),
    nombre: (row[2] || '').toString(),
    correo: (row[3] || '').toString(),
    cumple: row[4] instanceof Date
      ? Utilities.formatDate(row[4], Session.getScriptTimeZone(), "dd/MM/yyyy")
      : (row[4] || '').toString(),
    direccion: (row[5] || '').toString(),
    tipo: (row[6] || '').toString(),
    registro: row[7] instanceof Date
      ? Utilities.formatDate(row[7], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm")
      : (row[7] || '').toString()
  }));
}

// ============================================
// Controladores CRM Web App — Módulo Agenda
// ============================================

function getAgenda() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("AGENDA");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  return data.slice(1).map((row, i) => ({
    rowIndex: i + 2,
    id: (row[0] || '').toString(),
    fecha: row[1] instanceof Date
      ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), "dd/MM/yyyy")
      : (row[1] || '').toString(),
    tipoDia: (row[2] || '').toString(),
    inicio: row[3] instanceof Date
      ? Utilities.formatDate(row[3], Session.getScriptTimeZone(), "HH:mm")
      : (row[3] || '').toString(),
    fin: row[4] instanceof Date
      ? Utilities.formatDate(row[4], Session.getScriptTimeZone(), "HH:mm")
      : (row[4] || '').toString(),
    cliente: (row[5] || '').toString(),
    celularCliente: (row[6] || '').toString(),
    servicio: (row[7] || '').toString(),
    precio: row[8] || 0,
    profesional: (row[9] || '').toString(),
    estado: (row[10] || '').toString(),
    notas: (row[11] || '').toString()
  }));
}

// ============================================
// Controladores CRM Web App — Módulo Servicios
// ============================================

function getServicios() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CONFIG_SERVICIOS");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  return data.slice(1).map((row, i) => ({
    rowIndex: i + 2,
    idServicio: (row[0] || '').toString(),
    intencion: (row[1] || '').toString(),
    respuestaBase: (row[2] || '').toString(),
    tiempoServicio: row[3] || 0,
    categoria: (row[4] || '').toString(),
    tipoServicio: (row[5] || '').toString()
  }));
}

function saveServicio(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CONFIG_SERVICIOS");
  if (!sheet) throw new Error("La hoja CONFIG_SERVICIOS no existe.");

  const tipo = (data.tipoServicio || 'SRV').toUpperCase().replace(/\s+/g, '');
  const prefix = tipo.substring(0, 3) + '-';
  let maxNum = 0;
  const allData = sheet.getDataRange().getValues();
  for (let i = 1; i < allData.length; i++) {
    const idVal = (allData[i][0] || '').toString();
    if (idVal.startsWith(prefix)) {
      const numStr = idVal.replace(prefix, '');
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  const newId = prefix + (maxNum + 1).toString().padStart(3, '0');

  sheet.appendRow([
    newId,
    data.intencion || '',
    data.respuestaBase || '',
    parseInt(data.tiempoServicio) || 0,
    data.categoria || '',
    data.tipoServicio || ''
  ]);

  return { status: "Servicio creado exitosamente", id: newId };
}

function updateServicio(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CONFIG_SERVICIOS");
  if (!sheet) throw new Error("La hoja CONFIG_SERVICIOS no existe.");

  const row = data.rowIndex;
  if (!row || row < 2) throw new Error("Fila inválida para actualizar.");

  sheet.getRange(row, 2).setValue(data.intencion || '');
  sheet.getRange(row, 3).setValue(data.respuestaBase || '');
  sheet.getRange(row, 4).setValue(parseInt(data.tiempoServicio) || 0);
  sheet.getRange(row, 5).setValue(data.categoria || '');
  sheet.getRange(row, 6).setValue(data.tipoServicio || '');

  return { status: "Servicio actualizado", id: data.idServicio };
}

function deleteServicio(rowIndex) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CONFIG_SERVICIOS");
  if (!sheet) throw new Error("La hoja CONFIG_SERVICIOS no existe.");

  if (rowIndex < 2) throw new Error("No se puede eliminar la fila de encabezados.");
  sheet.deleteRow(rowIndex);

  return { status: "Servicio eliminado" };
}

// ============================================
// Utilidades
// ============================================

/**
 * Calcula el nombre del día de la semana a partir de una fecha en formato DD/MM/YYYY.
 * Útil para identificar días de bajo volumen y crear promociones focalizadas.
 */
function calcularTipoDia(fechaStr) {
  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  if (fechaStr instanceof Date) {
    return dias[fechaStr.getDay()];
  }

  if (typeof fechaStr === 'string' && fechaStr.includes('/')) {
    const parts = fechaStr.split('/');
    if (parts.length === 3) {
      const d = new Date(parts[2], parts[1] - 1, parts[0]);
      return dias[d.getDay()];
    }
  }

  return '';
}

function responseJSON(code, message, data = null) {
  const out = { code: code, message: message };
  if (data) out.data = data;
  
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
