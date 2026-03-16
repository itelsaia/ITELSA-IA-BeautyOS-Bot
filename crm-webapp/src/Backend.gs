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
      case 'confirmarPago':
        result = handleConfirmarPago(ss, payload);
        break;
      case 'toggleExentoAnticipo':
        result = handleToggleExentoAnticipo(ss, payload);
        break;
      case 'classifyClientes':
        result = handleClassifyClientes(ss, payload);
        break;
      case 'getBirthdayClients':
        result = handleGetBirthdayClients(ss, payload);
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
  
  // 2. Insertar los datos calculados (incluye columna I: EXENTO_ANTICIPO)
  sheet.appendRow([
    nextId,
    payload.celular || "",
    payload.nombre || "",
    payload.correo || "",
    payload.cumple || "",
    payload.direccion || "",
    payload.tipo || "Nuevo",
    registro,
    "NO"
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

  // ── Validar disponibilidad (horarios, bloqueos y conflictos de agenda) ──
  validarDisponibilidad(payload.fecha, payload.inicio, payload.fin, payload.profesional || "Por asignar");
  // ──────────────────────────────────────────────────────────────────────────

  // Campos de anticipo/pago (opcionales, las columnas M-S)
  var exentoAnticipo = payload.exentoAnticipo || "";
  var montoAnticipo = payload.montoAnticipo || 0;
  var montoPagado = payload.montoPagado || 0;
  var saldoRestante = payload.saldoRestante || 0;
  var estadoPago = payload.estadoPago || "";
  var refComprobante = payload.refComprobante || "";
  var fechaPago = payload.fechaPago || "";

  // Si hay precio y anticipo pero no se calculó saldoRestante, calcularlo
  if (montoPagado > 0 && saldoRestante === 0) {
    saldoRestante = (payload.precio || 0) - montoPagado;
  }

  // Campos de promocion (opcionales, columnas T-U)
  var promo = payload.promo || "";
  var tipoPromo = payload.tipoPromo || "";

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
    payload.notas || "",
    exentoAnticipo,
    montoAnticipo,
    montoPagado,
    saldoRestante,
    estadoPago,
    refComprobante,
    fechaPago,
    promo,
    tipoPromo
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

  const estadosValidos = ["PENDIENTE", "EJECUTADO", "RECHAZADO", "REAGENDADO", "CANCELADA"];
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
      var fila = i + 1;
      // Limpiar validación obsoleta de la fila
      sheet.getRange(fila, 1, 1, 21).clearDataValidations();
      sheet.getRange(fila, ESTADO_COL).setValue(nuevoEstado);
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
      const profAntiguo = (data[i][9] || 'Por asignar').toString(); // PROFESIONAL columna 10 (index 9)
      const traza = `[Reagendamiento - Antes: ${fecAntigua} a las ${iniAntiguo} | ${srvAntiguo} | Prof: ${profAntiguo}]`;
      const notasPrevias = data[i][11] ? data[i][11] + "\n" : ""; // NOTAS ahora es columna 12 (index 11)

      // ── Validar disponibilidad para la nueva fecha/hora ──
      const nuevoProfVal = payload.nuevoProfesional || profAntiguo;
      validarDisponibilidad(payload.nuevaFecha, payload.nuevoInicio, payload.nuevoFin, nuevoProfVal, payload.id);

      // ── Limpiar validación de datos obsoleta antes de escribir ──
      sheet.getRange(fila, 1, 1, 21).clearDataValidations();

      // Actualizar datos de la fila
      sheet.getRange(fila, 2).setValue(payload.nuevaFecha);
      sheet.getRange(fila, 3).setValue(calcularTipoDia(payload.nuevaFecha)); // Recalcular TIPO_DIA
      sheet.getRange(fila, 4).setValue(payload.nuevoInicio);  // INICIO
      sheet.getRange(fila, 5).setValue(payload.nuevoFin);     // FIN
      sheet.getRange(fila, 8).setValue(payload.nuevosServicios); // SERVICIO
      sheet.getRange(fila, 9).setValue(payload.nuevoPrecio);    // PRECIO

      // Actualizar profesional si se proporcionó uno nuevo
      if (payload.nuevoProfesional) {
        sheet.getRange(fila, 10).setValue(payload.nuevoProfesional); // PROFESIONAL
      }

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

/**
 * Confirma el pago de anticipo de una cita existente.
 * Actualiza las columnas de pago (O, P, Q, R, S) en la hoja AGENDA.
 * Payload: { id, montoPagado, referencia, fechaPago }
 */
function handleConfirmarPago(ss, payload) {
  var sheet = ss.getSheetByName("AGENDA");
  if (!sheet) throw new Error("La hoja AGENDA no existe.");

  var data = sheet.getDataRange().getValues();
  // Columnas de pago (base 1): M=13 EXENTO, N=14 MONTO_ANTICIPO, O=15 MONTO_PAGADO,
  // P=16 SALDO_RESTANTE, Q=17 ESTADO_PAGO, R=18 REF_COMPROBANTE, S=19 FECHA_PAGO

  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim() === payload.id.toString().trim()) {
      var fila = i + 1;
      var precioServicio = parseFloat(data[i][8]) || 0; // Columna I (index 8) = PRECIO
      var montoPagado = parseFloat(payload.montoPagado) || 0;
      var saldoRestante = precioServicio - montoPagado;

      sheet.getRange(fila, 15).setValue(montoPagado);        // O: MONTO_PAGADO
      sheet.getRange(fila, 16).setValue(saldoRestante);       // P: SALDO_RESTANTE
      sheet.getRange(fila, 17).setValue("PAGO_CONFIRMADO");   // Q: ESTADO_PAGO
      sheet.getRange(fila, 18).setValue(payload.referencia || ""); // R: REF_COMPROBANTE
      sheet.getRange(fila, 19).setValue(payload.fechaPago || ""); // S: FECHA_PAGO

      return { status: "Pago confirmado", id: payload.id, saldoRestante: saldoRestante };
    }
  }

  throw new Error("No se encontró la cita con ID: " + payload.id + " para confirmar pago.");
}

/**
 * Alterna el estado EXENTO_ANTICIPO de un cliente en la hoja CLIENTES.
 * Payload: { celular, exento } donde exento es "SI" o "NO"
 */
function handleToggleExentoAnticipo(ss, payload) {
  var sheet = ss.getSheetByName("CLIENTES");
  if (!sheet) throw new Error("La hoja CLIENTES no existe.");

  // Buscar la columna EXENTO_ANTICIPO (debería ser la columna I = index 8)
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var exentoCol = -1;
  for (var h = 0; h < headers.length; h++) {
    if ((headers[h] || '').toString().trim().toUpperCase() === 'EXENTO_ANTICIPO') {
      exentoCol = h + 1; // base 1
      break;
    }
  }

  // Si no existe la columna, crearla
  if (exentoCol === -1) {
    exentoCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, exentoCol).setValue('EXENTO_ANTICIPO');
  }

  // Buscar al cliente por celular (columna B = index 1)
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var celularSheet = (data[i][1] || '').toString().trim();
    if (celularSheet === payload.celular.toString().trim()) {
      sheet.getRange(i + 1, exentoCol).setValue((payload.exento || 'NO').toUpperCase());
      return { status: "Exención actualizada", celular: payload.celular, exento: payload.exento };
    }
  }

  throw new Error("No se encontró el cliente con celular: " + payload.celular);
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
    estado: row[7] || 'INACTIVO',
    aplicaTipoCliente: row[8] || 'TODOS',
    tipoMediaPromo: row[9] || '',
    urlMediaPromo: row[10] || '',
    maxUsosCliente: parseInt(row[11]) || 0
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
    (data.estado || 'ACTIVO').toUpperCase(),
    data.aplicaTipoCliente || 'TODOS',
    data.tipoMediaPromo || '',
    data.urlMediaPromo || '',
    parseInt(data.maxUsosCliente) || 0
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
  sheet.getRange(row, 9).setValue(data.aplicaTipoCliente || 'TODOS');
  sheet.getRange(row, 10).setValue(data.tipoMediaPromo || '');
  sheet.getRange(row, 11).setValue(data.urlMediaPromo || '');
  sheet.getRange(row, 12).setValue(parseInt(data.maxUsosCliente) || 0);

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

/**
 * Retorna conteo de uso de promociones por cliente desde AGENDA.
 * Solo cuenta citas con ESTADO = PENDIENTE o EJECUTADO y PROMO = SI.
 * @returns {Object} { "573001234567": { "Martes de Cejas": 2, "Promo Tinte": 1 }, ... }
 */
function getPromoUsage() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("AGENDA");
  if (!sheet || sheet.getLastRow() <= 1) return {};

  const data = sheet.getDataRange().getValues();
  var usage = {};
  // Columnas AGENDA: 0=ID, 1=FECHA, ..., 6=CELULAR_CLIENTE, ..., 10=ESTADO, ..., 19=PROMO, 20=TIPO_PROMO
  for (var i = 1; i < data.length; i++) {
    var estado = (data[i][10] || '').toString().toUpperCase();
    var promo = (data[i][19] || '').toString().toUpperCase();
    var tipoPromo = (data[i][20] || '').toString().trim();
    var celular = (data[i][6] || '').toString().trim();

    if (promo !== 'SI' || !tipoPromo || !celular) continue;
    if (estado !== 'PENDIENTE' && estado !== 'EJECUTADO') continue;

    if (!usage[celular]) usage[celular] = {};
    if (!usage[celular][tipoPromo]) usage[celular][tipoPromo] = 0;
    usage[celular][tipoPromo]++;
  }
  return usage;
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
// Controladores CRM Web App — Módulo Horarios / Disponibilidad
// ============================================

function getDisponibilidad() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("DISPONIBILIDAD");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  return data.slice(1).map((row, i) => ({
    rowIndex: i + 2,
    tipo: (row[0] || '').toString(),
    fechaDia: row[1] instanceof Date ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), "dd/MM/yyyy") : (row[1] || '').toString(),
    horaIni: row[2] instanceof Date ? Utilities.formatDate(row[2], Session.getScriptTimeZone(), "HH:mm") : (row[2] || '').toString(),
    horaFin: row[3] instanceof Date ? Utilities.formatDate(row[3], Session.getScriptTimeZone(), "HH:mm") : (row[3] || '').toString(),
    motivo: (row[4] || '').toString(),
    aplicaA: (row[5] || '').toString(),
    horario: (row[6] || '').toString(),
    categoria: (row[7] || '').toString()
  }));
}

function saveHorarioBase(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("DISPONIBILIDAD");
  if (!sheet) throw new Error("La hoja DISPONIBILIDAD no existe.");

  const allData = sheet.getDataRange().getValues();
  let existingRow = -1;

  // Buscar si ya existe una jornada para este dia
  for (let i = 1; i < allData.length; i++) {
    const tipo = (allData[i][0] || '').toString().trim();
    const dia = (allData[i][1] || '').toString().trim();
    if (tipo === 'Jornada' && dia.toLowerCase() === data.dia.toLowerCase()) {
      existingRow = i + 1;
      break;
    }
  }

  if (!data.activo) {
    // Si esta desactivado y existe, eliminar la fila
    if (existingRow > 0) {
      sheet.deleteRow(existingRow);
    }
    return { status: "Dia " + data.dia + " marcado como cerrado" };
  }

  if (existingRow > 0) {
    // Actualizar fila existente
    sheet.getRange(existingRow, 3).setValue(data.horaIni);
    sheet.getRange(existingRow, 4).setValue(data.horaFin);
  } else {
    // Crear nueva fila
    sheet.appendRow(["Jornada", data.dia, data.horaIni, data.horaFin, "Horario Base", "TODOS", "DIARIO", ""]);
  }

  return { status: "Horario de " + data.dia + " guardado" };
}

function saveBloqueo(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("DISPONIBILIDAD");
  if (!sheet) throw new Error("La hoja DISPONIBILIDAD no existe.");

  // Asegurar que el encabezado CATEGORIA exista en columna H
  if (sheet.getRange(1, 8).getValue().toString().trim() === '') {
    sheet.getRange(1, 8).setValue('CATEGORIA');
  }

  let horario = "UNICO";
  if (data.esRecurrente) {
    horario = "DIARIO";
  } else if (data.fechaFinRango) {
    horario = "RANGO:" + data.fechaFinRango;
  }

  sheet.appendRow([
    "Bloqueo",
    data.fechaDia || '',
    data.horaIni || '',
    data.horaFin || '',
    data.motivo || 'Bloqueo',
    data.aplicaA || 'TODOS',
    horario,
    data.categoria || ''
  ]);

  return { status: "Bloqueo creado exitosamente" };
}

function updateBloqueo(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("DISPONIBILIDAD");
  if (!sheet) throw new Error("La hoja DISPONIBILIDAD no existe.");

  const row = data.rowIndex;
  if (!row || row < 2) throw new Error("Fila inválida para actualizar.");

  let horario = "UNICO";
  if (data.esRecurrente) {
    horario = "DIARIO";
  } else if (data.fechaFinRango) {
    horario = "RANGO:" + data.fechaFinRango;
  }

  sheet.getRange(row, 1).setValue("Bloqueo");
  sheet.getRange(row, 2).setValue(data.fechaDia || '');
  sheet.getRange(row, 3).setValue(data.horaIni || '');
  sheet.getRange(row, 4).setValue(data.horaFin || '');
  sheet.getRange(row, 5).setValue(data.motivo || 'Bloqueo');
  sheet.getRange(row, 6).setValue(data.aplicaA || 'TODOS');
  sheet.getRange(row, 7).setValue(horario);
  sheet.getRange(row, 8).setValue(data.categoria || '');

  return { status: "Bloqueo actualizado exitosamente" };
}

function deleteBloqueo(rowIndex) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("DISPONIBILIDAD");
  if (!sheet) throw new Error("La hoja DISPONIBILIDAD no existe.");

  if (rowIndex < 2) throw new Error("No se puede eliminar la fila de encabezados.");
  sheet.deleteRow(rowIndex);

  return { status: "Bloqueo eliminado" };
}

function limpiarBloqueosVencidos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("DISPONIBILIDAD");
  if (!sheet || sheet.getLastRow() <= 1) return { count: 0 };

  const data = sheet.getDataRange().getValues();
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const rowsToDelete = [];

  for (let i = 1; i < data.length; i++) {
    const tipo = (data[i][0] || '').toString().trim();
    if (tipo !== 'Bloqueo') continue;

    const horario = (data[i][6] || '').toString().trim();
    if (horario === 'DIARIO') continue;

    const categoria = (data[i][7] || '').toString().trim().toLowerCase();
    if (categoria === 'incapacidad') continue;

    const fechaDia = (data[i][1] || '').toString().trim();

    if (horario === 'UNICO') {
      const parts = fechaDia.split('/');
      if (parts.length === 3) {
        const fecha = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        if (fecha < hoy) rowsToDelete.push(i + 1);
      }
    } else if (horario.indexOf('RANGO:') === 0) {
      const fechaFinStr = horario.replace('RANGO:', '');
      const parts = fechaFinStr.split('/');
      if (parts.length === 3) {
        const fechaFin = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        if (fechaFin < hoy) rowsToDelete.push(i + 1);
      }
    }
  }

  rowsToDelete.sort(function(a, b) { return b - a; });
  for (const rowIdx of rowsToDelete) {
    sheet.deleteRow(rowIdx);
  }

  return { count: rowsToDelete.length };
}

function getColaboradores() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("COLABORADORES");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  return data.slice(1).map((row, i) => ({
    rowIndex: i + 2,
    id: (row[0] || '').toString(),
    nombre: (row[1] || '').toString(),
    celular: (row[2] || '').toString(),
    rol: (row[3] || '').toString(),
    estado: (row[5] || '').toString(),
    competencias: (row[6] || '').toString()
  })).filter(c => c.id !== '');
}

function saveColaborador(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("COLABORADORES");
  if (!sheet) throw new Error("La hoja COLABORADORES no existe.");

  // Generar ID automaticamente segun rol (replica logica de onEdit)
  const rol = (data.rol || 'STAFF').toUpperCase().trim();
  const prefix = (rol === 'ADMIN') ? 'ADMIN-' : 'COL-';

  let maxNum = 0;
  const allData = sheet.getDataRange().getValues();
  for (let i = 1; i < allData.length; i++) {
    const idVal = (allData[i][0] || '').toString();
    if (idVal.startsWith(prefix)) {
      const num = parseInt(idVal.replace(prefix, ''), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  const newId = prefix + (maxNum + 1).toString().padStart(3, '0');

  // Asegurar que el encabezado COMPETENCIAS exista en columna G
  if (sheet.getRange(1, 7).getValue().toString().trim() === '') {
    sheet.getRange(1, 7).setValue('COMPETENCIAS');
  }

  sheet.appendRow([
    newId,
    data.nombre || '',
    data.celular || '',
    rol,
    data.pin || '',
    (data.estado || 'ACTIVO').toUpperCase(),
    data.competencias || ''
  ]);

  return { status: "Colaborador creado exitosamente", id: newId };
}

function updateColaborador(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("COLABORADORES");
  if (!sheet) throw new Error("La hoja COLABORADORES no existe.");

  const row = data.rowIndex;
  if (!row || row < 2) throw new Error("Fila invalida para actualizar.");

  // NO tocar columna 1 (ID_COLABORADOR)
  sheet.getRange(row, 2).setValue(data.nombre || '');
  sheet.getRange(row, 3).setValue(data.celular || '');
  sheet.getRange(row, 4).setValue((data.rol || 'STAFF').toUpperCase());
  sheet.getRange(row, 5).setValue(data.pin || '');
  sheet.getRange(row, 6).setValue((data.estado || 'ACTIVO').toUpperCase());
  sheet.getRange(row, 7).setValue(data.competencias || '');

  return { status: "Colaborador actualizado", id: data.id };
}

function deleteColaborador(rowIndex) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("COLABORADORES");
  if (!sheet) throw new Error("La hoja COLABORADORES no existe.");

  if (rowIndex < 2) throw new Error("No se puede eliminar la fila de encabezados.");
  sheet.deleteRow(rowIndex);

  return { status: "Colaborador eliminado" };
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
      : (row[7] || '').toString(),
    exentoAnticipo: (row[8] || '').toString()
  }));
}

/**
 * Toggle de exención de anticipo para un cliente (llamado desde CRM Web App).
 * @param {string} celular Celular del cliente
 * @param {string} nuevoEstado "SI" o "NO"
 */
function toggleClienteExento(celular, nuevoEstado) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return handleToggleExentoAnticipo(ss, { celular: celular, exento: nuevoEstado });
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
    notas: (row[11] || '').toString(),
    exentoAnticipo: (row[12] || '').toString(),
    montoAnticipo: row[13] || 0,
    montoPagado: row[14] || 0,
    saldoRestante: row[15] || 0,
    estadoPago: (row[16] || '').toString(),
    refComprobante: (row[17] || '').toString(),
    fechaPago: row[18] instanceof Date
      ? Utilities.formatDate(row[18], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm")
      : (row[18] || '').toString(),
    promo: (row[19] || '').toString(),
    tipoPromo: (row[20] || '').toString()
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
    tipoServicio: (row[5] || '').toString(),
    anticipoHabilitado: (row[6] || 'NO').toString(),
    tipoAnticipo: (row[7] || 'FIJO').toString(),
    valorAnticipo: parseInt(String(row[8] || '0').replace(/[.,]/g, '')) || 0
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
    data.tipoServicio || '',
    data.anticipoHabilitado || 'NO',
    data.tipoAnticipo || 'FIJO',
    parseInt(String(data.valorAnticipo).replace(/[.,]/g, '')) || 0
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
  sheet.getRange(row, 7).setValue(data.anticipoHabilitado || 'NO');
  sheet.getRange(row, 8).setValue(data.tipoAnticipo || 'FIJO');
  sheet.getRange(row, 9).setValue(parseInt(String(data.valorAnticipo).replace(/[.,]/g, '')) || 0);

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
// GALERIA DE SERVICIOS (Multimedia por servicio)
// ============================================

function getGaleria() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("GALERIA_SERVICIOS");
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  return data.slice(1).map(function(row, i) {
    return {
      rowIndex: i + 2,
      idServicio: row[0] || '',
      tipoMedia: row[1] || '',
      titulo: row[2] || '',
      descripcion: row[3] || '',
      urlMedia: row[4] || '',
      orden: row[5] || 1
    };
  }).filter(function(g) { return g.idServicio !== ''; });
}

function saveGaleria(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("GALERIA_SERVICIOS");
  if (!sheet) throw new Error("Hoja GALERIA_SERVICIOS no existe. Ejecuta Setup primero.");
  sheet.appendRow([
    data.idServicio,
    data.tipoMedia,
    data.titulo,
    data.descripcion,
    data.urlMedia,
    parseInt(data.orden) || 1
  ]);
  return { status: "Galeria item created" };
}

function updateGaleria(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("GALERIA_SERVICIOS");
  if (!sheet) throw new Error("Hoja GALERIA_SERVICIOS no existe.");
  var row = data.rowIndex;
  sheet.getRange(row, 1).setValue(data.idServicio);
  sheet.getRange(row, 2).setValue(data.tipoMedia);
  sheet.getRange(row, 3).setValue(data.titulo);
  sheet.getRange(row, 4).setValue(data.descripcion);
  sheet.getRange(row, 5).setValue(data.urlMedia);
  sheet.getRange(row, 6).setValue(parseInt(data.orden) || 1);
  return { status: "Galeria item updated" };
}

function deleteGaleria(rowIndex) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("GALERIA_SERVICIOS");
  if (!sheet) throw new Error("Hoja GALERIA_SERVICIOS no existe.");
  if (rowIndex < 2) throw new Error("No se puede eliminar la fila de encabezados.");
  sheet.deleteRow(rowIndex);
  return { status: "Galeria item deleted" };
}

// ============================================
// Validación de Disponibilidad (Defensa en Backend)
// ============================================

/**
 * Valida que una cita caiga dentro del horario de atención, no choque con bloqueos
 * y no tenga conflictos de agenda con el mismo profesional.
 * @param {string} fechaStr Fecha DD/MM/YYYY
 * @param {string} horaIni Hora inicio HH:MM
 * @param {string} horaFin Hora fin HH:MM
 * @param {string} profesional Nombre del profesional asignado (opcional)
 * @param {string} excludeAgendaId ID de cita a excluir (para reagendamiento, no detectarse a sí misma)
 */
function horaAMinutos(timeStr) {
  const parts = (timeStr || '0:0').split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
}

/** Normaliza texto: quita acentos y convierte a minúsculas para comparaciones seguras */
function normalizarTexto(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function validarDisponibilidad(fechaStr, horaIni, horaFin, profesional, excludeAgendaId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("DISPONIBILIDAD");
  if (!sheet || sheet.getLastRow() <= 1) return; // Sin datos = sin restricciones

  const data = sheet.getDataRange().getValues();
  const dias = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

  // Determinar dia de la semana de la fecha
  let diaSemana = '';
  if (fechaStr instanceof Date) {
    diaSemana = dias[fechaStr.getDay()];
  } else if (typeof fechaStr === 'string' && fechaStr.includes('/')) {
    const parts = fechaStr.split('/');
    if (parts.length === 3) {
      const d = new Date(parts[2], parts[1] - 1, parts[0]);
      diaSemana = dias[d.getDay()];
    }
  }
  if (!diaSemana) return; // No se pudo determinar dia

  // === CHEQUEO DE FESTIVO ===
  var fechaChequeo = '';
  if (fechaStr instanceof Date) {
    fechaChequeo = Utilities.formatDate(fechaStr, Session.getScriptTimeZone(), "dd/MM/yyyy");
  } else if (typeof fechaStr === 'string') {
    fechaChequeo = fechaStr.trim();
  }
  if (fechaChequeo) {
    var festivoSheet = ss.getSheetByName('FESTIVOS_CONFIG');
    if (festivoSheet && festivoSheet.getLastRow() > 1) {
      var festivoData = festivoSheet.getDataRange().getValues();
      for (var fi = 1; fi < festivoData.length; fi++) {
        var fFecha = festivoData[fi][1];
        var fFechaStr = fFecha instanceof Date ? Utilities.formatDate(fFecha, Session.getScriptTimeZone(), "dd/MM/yyyy") : (fFecha || '').toString().trim();
        if (fFechaStr === fechaChequeo) {
          var trabaja = (festivoData[fi][3] || 'NO').toString().toUpperCase().trim();
          if (trabaja !== 'SI') {
            var nombreFestivo = (festivoData[fi][2] || 'festivo').toString();
            throw new Error("El " + fechaChequeo + " es festivo (" + nombreFestivo + ") y el negocio no atiende. Por favor elige otro dia.");
          }
          break;
        }
      }
    }
  }

  const citaIniMin = horaAMinutos(horaIni);
  const citaFinMin = horaAMinutos(horaFin);

  // Buscar jornada para este dia
  let jornadaEncontrada = false;
  let jornadaIniStr = '';
  let jornadaFinStr = '';
  let jornadaIniMin = 0;
  let jornadaFinMin = 0;

  for (let i = 1; i < data.length; i++) {
    const tipo = (data[i][0] || '').toString().trim();
    const dia = (data[i][1] || '').toString().trim();
    if (tipo === 'Jornada' && normalizarTexto(dia) === normalizarTexto(diaSemana)) {
      jornadaEncontrada = true;
      const hi = data[i][2];
      const hf = data[i][3];
      jornadaIniStr = hi instanceof Date ? Utilities.formatDate(hi, Session.getScriptTimeZone(), "HH:mm") : hi.toString();
      jornadaFinStr = hf instanceof Date ? Utilities.formatDate(hf, Session.getScriptTimeZone(), "HH:mm") : hf.toString();
      jornadaIniMin = horaAMinutos(jornadaIniStr);
      jornadaFinMin = horaAMinutos(jornadaFinStr);
      break;
    }
  }

  // Si no hay jornada para este dia, el negocio esta cerrado
  if (!jornadaEncontrada) {
    throw new Error("El negocio no atiende los dias " + diaSemana + ". Por favor elige otro dia.");
  }

  // Validar que la cita cae dentro de la jornada
  if (citaIniMin < jornadaIniMin || citaFinMin > jornadaFinMin) {
    throw new Error("La cita esta fuera del horario de atencion. Horario de " + diaSemana + ": " + jornadaIniStr + " - " + jornadaFinStr);
  }

  // Resolver nombre de profesional a ID de colaborador (para comparar con aplicaA de bloqueos)
  let profesionalId = '';
  if (profesional && profesional !== 'Por asignar') {
    const colSheet = ss.getSheetByName("COLABORADORES");
    if (colSheet && colSheet.getLastRow() > 1) {
      const colData = colSheet.getDataRange().getValues();
      for (let c = 1; c < colData.length; c++) {
        if ((colData[c][1] || '').toString().trim().toLowerCase() === profesional.toLowerCase()) {
          profesionalId = (colData[c][0] || '').toString().trim();
          break;
        }
      }
    }
  }

  // Verificar bloqueos
  for (let i = 1; i < data.length; i++) {
    const tipo = (data[i][0] || '').toString().trim();
    if (tipo !== 'Bloqueo') continue;

    const bloqueoDia = (data[i][1] || '').toString().trim();
    const horario = (data[i][6] || '').toString().trim();
    const aplicaA = (data[i][5] || '').toString().trim();

    // Filtrar bloqueos por profesional: si el bloqueo es de un colaborador específico,
    // solo aplica si coincide con el profesional de la cita
    if (aplicaA !== 'TODOS' && profesionalId && aplicaA !== profesionalId) {
      continue; // Este bloqueo es de otro colaborador, no aplica
    }
    // Si el bloqueo es de un colaborador específico y la cita es "Por asignar", lo saltamos
    if (aplicaA !== 'TODOS' && (!profesional || profesional === 'Por asignar')) {
      continue;
    }

    // Saltar bloques vencidos (excepto incapacidades, requieren alta manual)
    const catVal = (data[i][7] || '').toString().trim().toLowerCase();
    if (horario !== 'DIARIO' && catVal !== 'incapacidad') {
      const hoyVal = new Date();
      hoyVal.setHours(0, 0, 0, 0);
      if (horario === 'UNICO') {
        const pv = bloqueoDia.split('/');
        if (pv.length === 3) {
          const fv = new Date(parseInt(pv[2]), parseInt(pv[1]) - 1, parseInt(pv[0]));
          if (fv < hoyVal) continue;
        }
      } else if (horario.indexOf('RANGO:') === 0) {
        const ffr = horario.replace('RANGO:', '').split('/');
        if (ffr.length === 3) {
          const fvr = new Date(parseInt(ffr[2]), parseInt(ffr[1]) - 1, parseInt(ffr[0]));
          if (fvr < hoyVal) continue;
        }
      }
    }

    const bhi = data[i][2];
    const bhf = data[i][3];
    const bloqueoIniStr = bhi instanceof Date ? Utilities.formatDate(bhi, Session.getScriptTimeZone(), "HH:mm") : bhi.toString();
    const bloqueoFinStr = bhf instanceof Date ? Utilities.formatDate(bhf, Session.getScriptTimeZone(), "HH:mm") : bhf.toString();
    const bloqueoIniMin = horaAMinutos(bloqueoIniStr);
    const bloqueoFinMin = horaAMinutos(bloqueoFinStr);

    let aplica = false;
    if (horario === 'DIARIO' && normalizarTexto(bloqueoDia) === normalizarTexto(diaSemana)) {
      aplica = true;
    } else if (horario === 'UNICO' && bloqueoDia === fechaStr) {
      aplica = true;
    } else if (horario.indexOf('RANGO:') === 0) {
      // Rango de fechas: RANGO:DD/MM/YYYY
      const fechaFinRango = horario.replace('RANGO:', '');
      const parseFechaDDMMYYYY = function(f) {
        const p = f.split('/');
        return p.length === 3 ? new Date(p[2], p[1] - 1, p[0]) : null;
      };
      const fechaBloqueoIni = parseFechaDDMMYYYY(bloqueoDia);
      const fechaBloqueoFin = parseFechaDDMMYYYY(fechaFinRango);
      const fechaCita = parseFechaDDMMYYYY(fechaStr);
      if (fechaBloqueoIni && fechaBloqueoFin && fechaCita) {
        if (fechaCita >= fechaBloqueoIni && fechaCita <= fechaBloqueoFin) {
          aplica = true;
        }
      }
    }

    if (aplica) {
      // Verificar solapamiento
      if (citaIniMin < bloqueoFinMin && citaFinMin > bloqueoIniMin) {
        const motivo = (data[i][4] || '').toString();
        throw new Error("Horario bloqueado de " + bloqueoIniStr + " a " + bloqueoFinStr + " (" + motivo + "). Por favor elige otra hora.");
      }
    }
  }

  // ── Verificar conflictos de citas existentes para el mismo profesional ──
  if (profesional && profesional !== 'Por asignar') {
    const agendaSheet = ss.getSheetByName("AGENDA");
    if (agendaSheet && agendaSheet.getLastRow() > 1) {
      const agendaData = agendaSheet.getDataRange().getValues();

      for (let i = 1; i < agendaData.length; i++) {
        // Solo citas activas (PENDIENTE o REAGENDADO)
        const estado = (agendaData[i][10] || '').toString().toUpperCase().trim();
        if (estado !== 'PENDIENTE' && estado !== 'REAGENDADO') continue;

        // Excluir la cita que se está reagendando (no detectarse a sí misma)
        const agId = (agendaData[i][0] || '').toString().trim();
        if (excludeAgendaId && agId === excludeAgendaId.toString().trim()) continue;

        // Solo citas del mismo profesional
        const prof = (agendaData[i][9] || '').toString().trim();
        if (prof.toLowerCase() !== profesional.toLowerCase()) continue;

        // Comparar fecha
        const existFecha = agendaData[i][1];
        let existFechaStr = '';
        if (existFecha instanceof Date) {
          existFechaStr = Utilities.formatDate(existFecha, Session.getScriptTimeZone(), "dd/MM/yyyy");
        } else {
          existFechaStr = (existFecha || '').toString().trim();
        }

        if (existFechaStr !== fechaStr) continue;

        // Comparar horas — solapamiento
        const existIni = agendaData[i][3];
        const existFin = agendaData[i][4];
        const existIniStr = existIni instanceof Date ? Utilities.formatDate(existIni, Session.getScriptTimeZone(), "HH:mm") : existIni.toString();
        const existFinStr = existFin instanceof Date ? Utilities.formatDate(existFin, Session.getScriptTimeZone(), "HH:mm") : existFin.toString();
        const existIniMin = horaAMinutos(existIniStr);
        const existFinMin = horaAMinutos(existFinStr);

        if (citaIniMin < existFinMin && citaFinMin > existIniMin) {
          throw new Error(profesional + " ya tiene una cita de " + existIniStr + " a " + existFinStr + " en esa fecha. Por favor elige otra hora u otro profesional.");
        }
      }
    }
  }
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

// ============================================
// Festivos Colombia — Ley 51 de 1983 (Ley Emiliani)
// ============================================

/**
 * Calcula TODOS los festivos colombianos de un año.
 * Incluye festivos fijos, Ley Emiliani (mueven al lunes) y basados en Semana Santa.
 */
function getColombianHolidaysGAS(year) {
  // Easter (algoritmo de Gauss/Meeus)
  var a = year % 19;
  var b = Math.floor(year / 100);
  var c = year % 100;
  var d = Math.floor(b / 4);
  var e = b % 4;
  var f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4);
  var k = c % 4;
  var l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var month = Math.floor((h + l - 7 * m + 114) / 31);
  var day = ((h + l - 7 * m + 114) % 31) + 1;
  var easter = new Date(year, month - 1, day);

  function addDays(date, days) {
    var d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function nextMonday(date) {
    var d = new Date(date);
    var dow = d.getDay();
    if (dow === 1) return d;
    if (dow === 0) { d.setDate(d.getDate() + 1); return d; }
    d.setDate(d.getDate() + (8 - dow));
    return d;
  }

  function fmt(date) {
    return String(date.getDate()).padStart(2, '0') + '/' +
           String(date.getMonth() + 1).padStart(2, '0') + '/' + date.getFullYear();
  }

  var holidays = [];
  function add(date, name, emiliani) {
    var final = emiliani ? nextMonday(date) : date;
    holidays.push({ date: fmt(final), name: name });
  }

  // Festivos FIJOS
  add(new Date(year, 0, 1),  'Año Nuevo', false);
  add(new Date(year, 4, 1),  'Dia del Trabajo', false);
  add(new Date(year, 6, 20), 'Grito de Independencia', false);
  add(new Date(year, 7, 7),  'Batalla de Boyaca', false);
  add(new Date(year, 11, 8), 'Inmaculada Concepcion', false);
  add(new Date(year, 11, 25),'Navidad', false);

  // Festivos EMILIANI (se mueven al lunes siguiente)
  add(new Date(year, 0, 6),  'Reyes Magos', true);
  add(new Date(year, 2, 19), 'San Jose', true);
  add(new Date(year, 5, 29), 'San Pedro y San Pablo', true);
  add(new Date(year, 7, 15), 'Asuncion de la Virgen', true);
  add(new Date(year, 9, 12), 'Dia de la Raza', true);
  add(new Date(year, 10, 1), 'Todos los Santos', true);
  add(new Date(year, 10, 11),'Independencia de Cartagena', true);

  // Festivos basados en SEMANA SANTA / Pascua
  add(addDays(easter, -3),  'Jueves Santo', false);
  add(addDays(easter, -2),  'Viernes Santo', false);
  add(addDays(easter, 43),  'Ascension del Senor', true);
  add(addDays(easter, 64),  'Corpus Christi', true);
  add(addDays(easter, 71),  'Sagrado Corazon', true);

  return holidays;
}

/**
 * Retorna la configuracion de festivos. Auto-genera festivos faltantes para año actual y siguiente.
 */
function getFestivosConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('FESTIVOS_CONFIG');
  if (!sheet) {
    sheet = ss.insertSheet('FESTIVOS_CONFIG');
    sheet.appendRow(['ANO', 'FECHA', 'NOMBRE', 'TRABAJA', 'GENERADO_AUTO']);
    formatHeaders(sheet);
  }

  var now = new Date();
  var currentYear = now.getFullYear();
  var years = [currentYear, currentYear + 1];

  // Leer datos existentes
  var existingDates = {};
  if (sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var fecha = (data[i][1] || '').toString().trim();
      if (fecha) existingDates[fecha] = true;
    }
  }

  // Auto-generar festivos faltantes
  var nuevos = 0;
  years.forEach(function(year) {
    var holidays = getColombianHolidaysGAS(year);
    holidays.forEach(function(h) {
      if (!existingDates[h.date]) {
        sheet.appendRow([year, h.date, h.name, 'NO', 'SI']);
        existingDates[h.date] = true;
        nuevos++;
      }
    });
  });

  // Re-leer y retornar
  var finalData = sheet.getDataRange().getValues();
  return finalData.slice(1).map(function(row, i) {
    var fechaVal = row[1];
    var fechaStr = '';
    if (fechaVal instanceof Date) {
      fechaStr = Utilities.formatDate(fechaVal, Session.getScriptTimeZone(), "dd/MM/yyyy");
    } else {
      fechaStr = (fechaVal || '').toString().trim();
    }
    return {
      rowIndex: i + 2,
      ano: parseInt(row[0]) || 0,
      fecha: fechaStr,
      nombre: (row[2] || '').toString().trim(),
      trabaja: (row[3] || 'NO').toString().toUpperCase().trim(),
      generadoAuto: (row[4] || 'SI').toString().trim()
    };
  }).filter(function(r) {
    return r.fecha !== '' && years.indexOf(r.ano) >= 0;
  });
}

/**
 * Actualiza el estado de un festivo (SI/NO trabaja).
 */
function saveFestivoConfig(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('FESTIVOS_CONFIG');
  if (!sheet) throw new Error("La hoja FESTIVOS_CONFIG no existe. Ejecuta Setup.");

  var row = data.rowIndex;
  if (!row || row < 2) throw new Error("Fila invalida.");

  sheet.getRange(row, 4).setValue(data.trabaja.toUpperCase());
  sheet.getRange(row, 5).setValue('NO'); // Marca como configurado manualmente
  return { status: "Festivo actualizado" };
}

// ============================================
// Controladores CRM Web App — Módulo Analytics
// ============================================

/**
 * Retorna datos pre-procesados para el dashboard de análisis.
 * @param {string} rangoMeses - Número de meses hacia atrás (1, 3, 6, 12 o "todo")
 */
function getAnalytics(rangoMeses, profesionalFiltro) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Leer profesionales de la hoja COLABORADORES (siempre disponible)
  var profesionales = [];
  var colabSheet = ss.getSheetByName("COLABORADORES");
  if (colabSheet && colabSheet.getLastRow() > 1) {
    var colabData = colabSheet.getDataRange().getValues();
    for (var c = 1; c < colabData.length; c++) {
      var nombre = (colabData[c][1] || '').toString().trim();
      if (nombre) profesionales.push(nombre);
    }
    profesionales.sort();
  }

  const sheet = ss.getSheetByName("AGENDA");
  if (!sheet || sheet.getLastRow() <= 1) {
    return { byStatus: {}, byProfessional: [], byDayOfWeek: [], byService: [], byMonth: [], byHour: [], kpis: {}, profesionales: profesionales };
  }

  const tz = Session.getScriptTimeZone();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  // Filtro por rango de fecha
  const now = new Date();
  let fechaLimite = null;
  if (rangoMeses && rangoMeses !== 'todo') {
    const meses = parseInt(rangoMeses) || 6;
    fechaLimite = new Date(now.getFullYear(), now.getMonth() - meses, now.getDate());
  }

  // Parsear filas
  const todasCitas = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var fechaRaw = row[1];
    var fechaDate = null;

    if (fechaRaw instanceof Date) {
      fechaDate = fechaRaw;
    } else if (typeof fechaRaw === 'string' && fechaRaw.includes('/')) {
      var parts = fechaRaw.split('/');
      if (parts.length === 3) fechaDate = new Date(parts[2], parts[1] - 1, parts[0]);
    }

    if (!fechaDate) continue;
    if (fechaLimite && fechaDate < fechaLimite) continue;

    var inicioRaw = row[3];
    var hora = 0;
    if (inicioRaw instanceof Date) {
      hora = inicioRaw.getHours();
    } else if (typeof inicioRaw === 'string' && inicioRaw.includes(':')) {
      hora = parseInt(inicioRaw.split(':')[0]) || 0;
    }

    todasCitas.push({
      fecha: fechaDate,
      tipoDia: (row[2] || '').toString(),
      hora: hora,
      servicio: (row[7] || '').toString(),
      precio: parseFloat(row[8]) || 0,
      profesional: (row[9] || '').toString(),
      estado: (row[10] || '').toString()
    });
  }

  // Filtro por profesional
  var citas = todasCitas;
  if (profesionalFiltro && profesionalFiltro !== 'todos') {
    citas = [];
    for (var i = 0; i < todasCitas.length; i++) {
      if (todasCitas[i].profesional === profesionalFiltro) citas.push(todasCitas[i]);
    }
  }

  // --- Calculos ---

  // 1. Por estado
  var byStatus = {};
  for (var i = 0; i < citas.length; i++) {
    var est = citas[i].estado || 'SIN_ESTADO';
    byStatus[est] = (byStatus[est] || 0) + 1;
  }

  // 2. Por profesional
  var profMap = {};
  for (var i = 0; i < citas.length; i++) {
    var c = citas[i];
    var prof = c.profesional || 'Sin asignar';
    if (!profMap[prof]) profMap[prof] = { nombre: prof, total: 0, ejecutadas: 0, rechazadas: 0, canceladas: 0, reagendadas: 0, ingresos: 0 };
    profMap[prof].total++;
    if (c.estado === 'EJECUTADO') { profMap[prof].ejecutadas++; profMap[prof].ingresos += c.precio; }
    else if (c.estado === 'RECHAZADO') profMap[prof].rechazadas++;
    else if (c.estado === 'CANCELADA') profMap[prof].canceladas++;
    else if (c.estado === 'REAGENDADO') profMap[prof].reagendadas++;
  }
  var byProfessional = [];
  for (var key in profMap) byProfessional.push(profMap[key]);
  byProfessional.sort(function(a, b) { return b.total - a.total; });

  // 3. Por dia de semana
  var diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var dayMap = {};
  for (var d = 0; d < 7; d++) dayMap[diasSemana[d]] = { dia: diasSemana[d], total: 0, ejecutadas: 0, ingresos: 0 };
  for (var i = 0; i < citas.length; i++) {
    var c = citas[i];
    var diaNombre = diasSemana[c.fecha.getDay()];
    dayMap[diaNombre].total++;
    if (c.estado === 'EJECUTADO') { dayMap[diaNombre].ejecutadas++; dayMap[diaNombre].ingresos += c.precio; }
  }
  var byDayOfWeek = [];
  for (var d = 1; d <= 6; d++) byDayOfWeek.push(dayMap[diasSemana[d]]); // Lunes a Sabado
  byDayOfWeek.push(dayMap[diasSemana[0]]); // Domingo al final

  // 4. Por servicio
  var srvMap = {};
  for (var i = 0; i < citas.length; i++) {
    var c = citas[i];
    var srv = c.servicio || 'Sin servicio';
    if (!srvMap[srv]) srvMap[srv] = { servicio: srv, total: 0, ingresos: 0 };
    srvMap[srv].total++;
    if (c.estado === 'EJECUTADO') srvMap[srv].ingresos += c.precio;
  }
  var byService = [];
  for (var key in srvMap) byService.push(srvMap[key]);
  byService.sort(function(a, b) { return b.total - a.total; });

  // 5. Por mes (tendencia)
  var monthMap = {};
  for (var i = 0; i < citas.length; i++) {
    var c = citas[i];
    var mesKey = c.fecha.getFullYear() + '-' + String(c.fecha.getMonth() + 1).padStart(2, '0');
    if (!monthMap[mesKey]) monthMap[mesKey] = { mes: mesKey, total: 0, ejecutadas: 0, ingresos: 0 };
    monthMap[mesKey].total++;
    if (c.estado === 'EJECUTADO') { monthMap[mesKey].ejecutadas++; monthMap[mesKey].ingresos += c.precio; }
  }
  var byMonth = [];
  for (var key in monthMap) byMonth.push(monthMap[key]);
  byMonth.sort(function(a, b) { return a.mes.localeCompare(b.mes); });

  // 6. Por hora
  var hourMap = {};
  for (var h = 6; h <= 21; h++) hourMap[h] = { hora: h, label: String(h).padStart(2, '0') + ':00', total: 0 };
  for (var i = 0; i < citas.length; i++) {
    var h = citas[i].hora;
    if (hourMap[h]) hourMap[h].total++;
  }
  var byHour = [];
  for (var h = 6; h <= 21; h++) byHour.push(hourMap[h]);

  // 7. KPIs
  var totalCitas = citas.length;
  var ejecutadas = byStatus['EJECUTADO'] || 0;
  var rechazadas = byStatus['RECHAZADO'] || 0;
  var canceladas = byStatus['CANCELADA'] || 0;
  var reagendadas = byStatus['REAGENDADO'] || 0;
  var ingresosTotales = 0;
  for (var i = 0; i < citas.length; i++) {
    if (citas[i].estado === 'EJECUTADO') ingresosTotales += citas[i].precio;
  }

  var kpis = {
    totalCitas: totalCitas,
    ejecutadas: ejecutadas,
    tasaCumplimiento: totalCitas > 0 ? Math.round((ejecutadas / totalCitas) * 100) : 0,
    ticketPromedio: ejecutadas > 0 ? Math.round(ingresosTotales / ejecutadas) : 0,
    ingresosTotales: ingresosTotales,
    tasaCancelacion: totalCitas > 0 ? Math.round((canceladas / totalCitas) * 100) : 0,
    tasaReagendamiento: totalCitas > 0 ? Math.round((reagendadas / totalCitas) * 100) : 0,
    tasaRechazo: totalCitas > 0 ? Math.round((rechazadas / totalCitas) * 100) : 0
  };

  return {
    byStatus: byStatus,
    byProfessional: byProfessional,
    byDayOfWeek: byDayOfWeek,
    byService: byService,
    byMonth: byMonth,
    byHour: byHour,
    kpis: kpis,
    profesionales: profesionales
  };
}

// ============================================
// Clasificacion Automatica de Clientes
// ============================================

function handleClassifyClientes(ss, payload) {
  var agendaSheet = ss.getSheetByName('AGENDA');
  var clientesSheet = ss.getSheetByName('CLIENTES');
  if (!agendaSheet || !clientesSheet) throw new Error("Hojas AGENDA o CLIENTES no encontradas.");

  var umbrales = payload.umbrales || { ocasional: 1, frecuente: 4, vip: 9 };

  // Contar citas EJECUTADO por celular
  var agendaData = agendaSheet.getDataRange().getValues();
  var conteo = {};
  for (var i = 1; i < agendaData.length; i++) {
    var estado = (agendaData[i][10] || '').toString().toUpperCase().trim(); // Col K = ESTADO
    var celular = (agendaData[i][6] || '').toString().trim();               // Col G = CELULAR_CLIENTE
    if (estado === 'EJECUTADO' && celular) {
      conteo[celular] = (conteo[celular] || 0) + 1;
    }
  }

  // Clasificar y actualizar
  var clientesData = clientesSheet.getDataRange().getValues();
  var updated = [];
  for (var j = 1; j < clientesData.length; j++) {
    var cel = (clientesData[j][1] || '').toString().trim(); // Col B = CELULAR
    var oldTipo = (clientesData[j][6] || '').toString().trim(); // Col G = TIPO
    var citas = conteo[cel] || 0;

    var newTipo = 'Nuevo';
    if (citas >= umbrales.vip) newTipo = 'VIP';
    else if (citas >= umbrales.frecuente) newTipo = 'Frecuente';
    else if (citas >= umbrales.ocasional) newTipo = 'Ocasional';

    if (newTipo !== oldTipo) {
      clientesSheet.getRange(j + 1, 7).setValue(newTipo); // Col G = TIPO
      updated.push({ celular: cel, oldTipo: oldTipo, newTipo: newTipo, citas: citas });
    }
  }

  return { updated: updated, total: updated.length };
}

// ============================================
// Clientes de Cumpleanos
// ============================================

function handleGetBirthdayClients(ss, payload) {
  var sheet = ss.getSheetByName('CLIENTES');
  if (!sheet) throw new Error("Hoja CLIENTES no encontrada.");

  var data = sheet.getDataRange().getValues();
  var hoy = [], manana = [];

  for (var i = 1; i < data.length; i++) {
    var cumpleRaw = data[i][4]; // Col E = CUMPLE
    if (!cumpleRaw) continue;

    var ddmm = '';
    if (cumpleRaw instanceof Date) {
      var d = cumpleRaw.getDate().toString().padStart(2, '0');
      var m = (cumpleRaw.getMonth() + 1).toString().padStart(2, '0');
      ddmm = d + '/' + m;
    } else {
      var cumpleStr = cumpleRaw.toString().trim();
      var parts = cumpleStr.split('/');
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        ddmm = parts[0].padStart(2, '0') + '/' + parts[1].padStart(2, '0');
      } else {
        // Formato español: "15 de marzo", "15 de Marzo"
        var mesesEs = {enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12'};
        var match = cumpleStr.toLowerCase().match(/(\d{1,2})\s*de\s*(\w+)/);
        if (match && mesesEs[match[2]]) ddmm = match[1].padStart(2, '0') + '/' + mesesEs[match[2]];
      }
    }

    if (!ddmm) continue;

    var clienteInfo = {
      celular: (data[i][1] || '').toString(),
      nombre: (data[i][2] || '').toString(),
      cumple: ddmm,
      tipo: (data[i][6] || 'Nuevo').toString()
    };

    if (ddmm === payload.fechaHoy) hoy.push(clienteInfo);
    if (ddmm === payload.fechaManana) manana.push(clienteInfo);
  }

  return { hoy: hoy, manana: manana };
}

function responseJSON(code, message, data = null) {
  const out = { code: code, message: message };
  if (data) out.data = data;
  
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
