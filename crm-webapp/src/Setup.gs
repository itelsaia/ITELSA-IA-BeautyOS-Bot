/**
 * Setup.gs
 * Script para automatizar la creación y configuración inicial 
 * de la base de datos (Spreadsheet) del cliente.
 * 
 * Uso: Ejecutar "inicializarEntorno" UNA SOLA VEZ desde el editor GAS.
 */

function inicializarEntorno() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (!ss) {
    Logger.log("Error: Este script debe estar vinculado a un Google Sheet.");
    return;
  }

  // 1. Crear pestaña CONFIG_SISTEMA
  let sheetConfig = getOrCreateSheet(ss, "CONFIG_SISTEMA");
  sheetConfig.clear();
  sheetConfig.appendRow(["ESTADO_LICENCIA", "TONO_IA", "NOMBRE_NEGOCIO", "URL_LOGO", "COLOR_PRIMARIO", "MENSAJE_BIENVENIDA", "PROMPT_SISTEMA", "MODELO_IA", "OPENAI_API_KEY"]);
  sheetConfig.appendRow(["ACTIVO", "Amable y Empático", "Demo Spa", "", "#E91E63", "¡Hola! Soy tu asistente virtual de citas.", "Eres Leydi Cejas, asesora de servicio al cliente del Demo Spa. Responde de forma amable, persuasiva y siempre de forma BREVE. Ayuda al cliente a conocer nuestro catálogo de servicios y guíalo para agendar una cita.", "gpt-4o-mini", "sk-..."]);
  formatHeaders(sheetConfig);

  // 2. Crear pestaña CONFIG_SERVICIOS (Catálogo RAG)
  let sheetRag = getOrCreateSheet(ss, "CONFIG_SERVICIOS");
  sheetRag.clear();
  sheetRag.appendRow(["ID_SERVICIO", "INTENCION", "RESPUESTA_BASE", "TIEMPO_SERVICIO", "CATEGORIA"]);
  sheetRag.appendRow(["CEJ-001", "precios_cejas", "El diseño de cejas vale $20.", "30", "Estética"]);
  sheetRag.appendRow(["MAN-001", "precios_manicure", "El manicure tradicional cuesta $15.", "45", "Manos y Pies"]);
  sheetRag.appendRow(["COR-001", "corte_cabello", "El corte de cabello para dama cuesta $25.", "40", "Peluquería"]);
  formatHeaders(sheetRag);

  // 3. Crear pestaña CITAS_DB
  let sheetCitas = getOrCreateSheet(ss, "CITAS_DB");
  sheetCitas.clear();
  sheetCitas.appendRow(["ID", "FECHA", "HORA", "CLIENTE", "TELEFONO", "SERVICIO", "ESTADO"]);
  formatHeaders(sheetCitas);

  // 4. Crear pestaña LEADS
  let sheetLeads = getOrCreateSheet(ss, "LEADS");
  sheetLeads.clear();
  sheetLeads.appendRow(["FECHA_REGISTRO", "NOMBRE", "TELEFONO", "INTERES", "ORIGEN"]);
  formatHeaders(sheetLeads);

  // Limpiar "Hoja 1" si existe por defecto
  let sheetDefault = ss.getSheetByName("Hoja 1") || ss.getSheetByName("Sheet1");
  if (sheetDefault && ss.getSheets().length > 1) {
    ss.deleteSheet(sheetDefault);
  }

  Logger.log("¡Entorno inicializado correctamente!");
}

/**
 * Función auxiliar para obtener o crear una hoja
 */
function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

/**
 * Función auxiliar para dar formato a los encabezados
 */
function formatHeaders(sheet) {
  const range = sheet.getRange("A1:Z1");
  range.setFontWeight("bold");
  range.setBackground("#f3f3f3");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, sheet.getLastColumn());
}
