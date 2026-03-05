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
  
  // payload: { id, fecha, inicio, fin, cliente, servicio, profesional, notas }
  
  sheet.appendRow([
    payload.id || Utilities.getUuid().slice(0, 8),
    payload.fecha || "",
    payload.inicio || "",
    payload.fin || "",
    payload.cliente || "",
    payload.servicio || "",
    payload.profesional || "",
    "PENDIENTE",
    payload.notas || ""
  ]);
  
  return { status: "Cita agendada exitosamente", id: payload.id };
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
