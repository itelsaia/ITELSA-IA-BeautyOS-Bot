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

  // 1. CONFIGURACION (Estilo Clave/Valor)
  let sheetConfig = getOrCreateSheet(ss, "CONFIGURACION");
  sheetConfig.clear();
  sheetConfig.appendRow(["CLAVE", "VALOR", "DESCRIPCION_TECNICA"]);
  sheetConfig.appendRow(["ESTADO_SERVICIO", "ACTIVO", "Kill Switch (Control SaaS)"]);
  sheetConfig.appendRow(["CLAVE_OPENAI", "sk-...", "API Key IA"]);
  sheetConfig.appendRow(["NOMBRE_NEGOCIO", "Estética Divina", "Contexto general"]);
  sheetConfig.appendRow(["NOMBRE_AGENTE", "Valentina", "Identidad del Bot"]);
  sheetConfig.appendRow(["SALUDO_BASE", "¡Hola! Soy Valentina, tu asistente de belleza.", "Mensaje inicial"]);
  sheetConfig.appendRow(["CELULAR_DUEÑA", "573000000000", "Alertas Críticas"]);
  sheetConfig.appendRow(["CORREO_DUEÑA", "admin@spa.com", "Reportes Email"]);
  sheetConfig.appendRow(["ENLACE_LOGO", "https://...", "Branding Automático"]);
  sheetConfig.appendRow(["COLOR_MARCA", "#E91E63", "UI Theme"]);
  formatHeaders(sheetConfig);

  // 2. CLIENTES (CRM)
  let sheetClientes = getOrCreateSheet(ss, "CLIENTES");
  sheetClientes.clear();
  sheetClientes.appendRow(["ID_CLIENTE", "CELULAR", "NOMBRE", "CORREO", "CUMPLE", "DIRECCION", "TIPO", "REGISTRO"]);
  formatHeaders(sheetClientes);

  // 3. SESIONES (Máquina de Estados)
  let sheetSesiones = getOrCreateSheet(ss, "SESIONES");
  sheetSesiones.clear();
  sheetSesiones.appendRow(["CELULAR", "ESTADO_ACTUAL", "DATOS_PARCIALES", "TIMESTAMP"]);
  formatHeaders(sheetSesiones);

  // 4. COLABORADORES
  let sheetColaboradores = getOrCreateSheet(ss, "COLABORADORES");
  sheetColaboradores.clear();
  sheetColaboradores.appendRow(["ID_COLABORADOR", "NOMBRE", "CELULAR", "ROL", "PIN", "ESTADO"]);
  sheetColaboradores.appendRow(["ADMIN-001", "Andrea", "573001112233", "ADMIN", "1010", "ACTIVO"]);
  sheetColaboradores.appendRow(["COL-001", "Camila", "573004445566", "STAFF", "2020", "ACTIVO"]);
  formatHeaders(sheetColaboradores);

  // 5. DISPONIBILIDAD
  let sheetDisponibilidad = getOrCreateSheet(ss, "DISPONIBILIDAD");
  sheetDisponibilidad.clear();
  sheetDisponibilidad.appendRow(["TIPO", "FECHA_DIA", "HORA_INI", "HORA_FIN", "MOTIVO", "APLICA_A", "HORARIO"]);
  sheetDisponibilidad.appendRow(["Jornada", "Lunes", "09:00", "18:00", "Horario Base", "TODOS", "DIARIO"]);
  formatHeaders(sheetDisponibilidad);

  // 6. AGENDA
  let sheetAgenda = getOrCreateSheet(ss, "AGENDA");
  sheetAgenda.clear();
  sheetAgenda.appendRow(["ID", "FECHA", "INICIO", "FIN", "CLIENTE", "SERVICIO", "PROFESIONAL", "ESTADO", "NOTAS"]);
  formatHeaders(sheetAgenda);

  // 7. PROMOCIONES
  let sheetPromociones = getOrCreateSheet(ss, "PROMOCIONES");
  sheetPromociones.clear();
  sheetPromociones.appendRow(["NOMBRE", "DESCRIPCION", "ESTADO", "VENCE", "APLICA_DIA"]);
  formatHeaders(sheetPromociones);

  // 8. NOVEDADES
  let sheetNovedades = getOrCreateSheet(ss, "NOVEDADES");
  sheetNovedades.clear();
  sheetNovedades.appendRow(["FECHA", "HORA", "STAFF", "TIPO", "MENSAJE", "ESTADO"]);
  formatHeaders(sheetNovedades);

  // 9. CONOCIMIENTO (RAG y Multimedia extra)
  let sheetConocimiento = getOrCreateSheet(ss, "CONOCIMIENTO");
  sheetConocimiento.clear();
  sheetConocimiento.appendRow(["INTENCION", "RESPUESTA", "TIPO_MEDIA", "URL"]);
  sheetConocimiento.appendRow(["catalogo", "Para ver todos nuestros modelos ingresa a este link", "pdf", "https://drive.google.com/..."]);
  formatHeaders(sheetConocimiento);

  // Limpiar Hojas viejas
  const oldSheets = ["CONFIG_SISTEMA", "ESPECIALIDADES", "SERVICIOS", "BASE_CONOCIMIENTO", "CITAS_DB", "LEADS", "Hoja 1", "Sheet1"];
  oldSheets.forEach(name => {
    let oldS = ss.getSheetByName(name);
    if (oldS && ss.getSheets().length > 1) {
      ss.deleteSheet(oldS); 
    }
  });

  Logger.log("¡Entorno V7 inicializado correctamente (Limpio)!");
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
