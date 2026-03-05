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

  sheet.appendRow([
    agendaId,
    payload.fecha || "",
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
  // La columna ESTADO es la columna J (index 9, base 1 = columna 10)
  const ESTADO_COL = 10; 
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
  // Columnas base 1:
  // 1: ID, 2: FECHA, 3: INICIO, 4: FIN, 7: SERVICIO, 8: PRECIO, 10: ESTADO, 11: NOTAS
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim() === payload.id.toString().trim()) {
      const fila = i + 1;
      
      // Capturar datos antiguos para trazabilidad
      const fecAntigua = data[i][1];
      const iniAntiguo = data[i][2];
      const srvAntiguo = data[i][6];
      const traza = `[Reagendamiento - Antes: ${fecAntigua} ${iniAntiguo} | ${srvAntiguo}]`;
      const notasPrevias = data[i][10] ? data[i][10] + "\n" : "";

      // Actualizar datos de la fila
      sheet.getRange(fila, 2).setValue(payload.nuevaFecha);
      sheet.getRange(fila, 3).setValue(payload.nuevoInicio);
      sheet.getRange(fila, 4).setValue(payload.nuevoFin);
      sheet.getRange(fila, 7).setValue(payload.nuevosServicios);
      sheet.getRange(fila, 8).setValue(payload.nuevoPrecio);
      
      // Cambiar estado
      sheet.getRange(fila, 10).setValue("REAGENDADO");
      
      // Añadir notas
      const nuevasNotas = notasPrevias + traza + (payload.notasAdicionales ? "\n" + payload.notasAdicionales : "");
      sheet.getRange(fila, 11).setValue(nuevasNotas);

      return { status: "Cita reagendada e in-place actualizada", id: payload.id };
    }
  }

  throw new Error("No se encontró la cita con ID: " + payload.id + " para reagendar.");
}

// ============================================
// Utilidades
// ============================================

function responseJSON(code, message, data = null) {
  const out = { code: code, message: message };
  if (data) out.data = data;
  
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
