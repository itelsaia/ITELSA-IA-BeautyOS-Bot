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
  sheetConfig.appendRow(["DIRECCION_NEGOCIO", "", "Direccion fisica del establecimiento"]);
  sheetConfig.appendRow(["ENLACE_UBICACION", "", "Enlace de Google Maps (copiar desde Compartir en Maps)"]);
  sheetConfig.appendRow(["INTERVALO_SLOTS_MIN", "15", "Intervalo en minutos entre opciones de horario (15, 20 o 30)"]);
  sheetConfig.appendRow(["TIEMPO_ENTRE_CITAS_MIN", "15", "Minutos de preparacion/limpieza entre citas"]);
  sheetConfig.appendRow(["MINUTOS_VENCIMIENTO_CITA", "30", "Minutos despues de vencida una cita para cambiar estado a RECHAZADO automaticamente y liberar agenda del profesional"]);
  sheetConfig.appendRow(["DATOS_PAGO", "", "Instrucciones de pago para anticipos (Nequi, Daviplata, cuenta bancaria, etc.)"]);
  sheetConfig.appendRow(["MOMENTO_ANTICIPO", "DESPUES", "Momento del anticipo: ANTES (pagar para reservar) o DESPUES (reservar y luego pagar)"]);
  sheetConfig.appendRow(["POLITICA_ANTICIPO", "", "Texto de politica de anticipo que el bot comunica al cliente antes de agendar"]);
  sheetConfig.appendRow(["UMBRAL_OCASIONAL", "1", "Citas EJECUTADO minimas para pasar de Nuevo a Ocasional"]);
  sheetConfig.appendRow(["UMBRAL_FRECUENTE", "4", "Citas EJECUTADO minimas para pasar a Frecuente"]);
  sheetConfig.appendRow(["UMBRAL_VIP", "9", "Citas EJECUTADO minimas para pasar a VIP"]);
  sheetConfig.appendRow(["MENSAJE_AGRADECIMIENTO", "¡Gracias {cliente}! Fue un placer atenderte con tu {servicio} en {negocio}. ¡Te esperamos pronto! 💅✨", "Template WhatsApp al cerrar cita. Variables: {cliente}, {servicio}, {negocio}"]);
  sheetConfig.appendRow(["MENSAJE_RECORDATORIO", "¡Hola {cliente}! 🕐 Te recordamos que tienes tu cita de {servicio} hoy a las {hora} con {profesional} en {negocio}. Si no puedes asistir, responde este mensaje para cancelar o reagendar. ¡Te esperamos!", "Template recordatorio antes de cita. Variables: {cliente}, {servicio}, {hora}, {profesional}, {negocio}"]);
  sheetConfig.appendRow(["MINUTOS_RECORDATORIO", "60", "Minutos de anticipacion para enviar recordatorio de cita (ej: 60 = 1 hora antes)"]);
  sheetConfig.appendRow(["URL_BOT_API", "", "URL del servidor Bot Express (ej: http://localhost:3000)"]);
  sheetConfig.appendRow(["API_KEY_BOT", "", "Clave secreta para autenticar llamadas desde CRM al Bot"]);
  sheetConfig.appendRow(["INSTANCE_NAME", "", "Nombre de la instancia Evolution API del tenant"]);
  formatHeaders(sheetConfig);

  // 2. CLIENTES (CRM)
  let sheetClientes = getOrCreateSheet(ss, "CLIENTES");
  sheetClientes.clear();
  sheetClientes.appendRow(["ID_CLIENTE", "CELULAR", "NOMBRE", "CORREO", "CUMPLE", "DIRECCION", "TIPO", "REGISTRO", "EXENTO_ANTICIPO"]);
  formatHeaders(sheetClientes);

  // 3. SESIONES (Máquina de Estados)
  let sheetSesiones = getOrCreateSheet(ss, "SESIONES");
  sheetSesiones.clear();
  sheetSesiones.appendRow(["CELULAR", "ESTADO_ACTUAL", "DATOS_PARCIALES", "TIMESTAMP"]);
  formatHeaders(sheetSesiones);

  // 4. COLABORADORES
  let sheetColaboradores = getOrCreateSheet(ss, "COLABORADORES");
  sheetColaboradores.clear();
  sheetColaboradores.appendRow(["ID_COLABORADOR", "NOMBRE", "CELULAR", "ROL", "PIN", "ESTADO", "COMPETENCIAS"]);
  sheetColaboradores.appendRow(["ADMIN-001", "Andrea", "573001112233", "ADMIN", "1010", "ACTIVO", "Corte de cabello para dama,Diseño de cejas,Tinte"]);
  sheetColaboradores.appendRow(["COL-001", "Camila", "573004445566", "STAFF", "2020", "ACTIVO", "Manicure,Pedicure,Diseño de cejas"]);
  formatHeaders(sheetColaboradores);

  // 5. DISPONIBILIDAD
  let sheetDisponibilidad = getOrCreateSheet(ss, "DISPONIBILIDAD");
  sheetDisponibilidad.clear();
  sheetDisponibilidad.appendRow(["TIPO", "FECHA_DIA", "HORA_INI", "HORA_FIN", "MOTIVO", "APLICA_A", "HORARIO", "CATEGORIA"]);
  sheetDisponibilidad.appendRow(["Jornada", "Lunes", "09:00", "18:00", "Horario Base", "TODOS", "DIARIO"]);
  formatHeaders(sheetDisponibilidad);

  // 6. AGENDA
  let sheetAgenda = getOrCreateSheet(ss, "AGENDA");
  sheetAgenda.clear();
  sheetAgenda.appendRow(["ID", "FECHA", "TIPO_DIA", "INICIO", "FIN", "CLIENTE", "CELULAR_CLIENTE", "SERVICIO", "PRECIO", "PROFESIONAL", "ESTADO", "NOTAS", "EXENTO_ANTICIPO", "MONTO_ANTICIPO", "MONTO_PAGADO", "SALDO_RESTANTE", "ESTADO_PAGO", "REF_COMPROBANTE", "FECHA_PAGO", "PROMO", "TIPO_PROMO"]);
  formatHeaders(sheetAgenda);

  // 6.1 LISTA_ESTADOS (Tabla de referencia para validación de datos)
  let sheetEstados = getOrCreateSheet(ss, "LISTA_ESTADOS");
  sheetEstados.clear();
  sheetEstados.appendRow(["ESTADO", "DESCRIPCION", "USO"]);
  sheetEstados.appendRow(["PENDIENTE", "Cita agendada, servicio aún no prestado", "Bot IA al crear nueva cita"]);
  sheetEstados.appendRow(["EJECUTADO", "Cliente asistió y el servicio fue prestado", "Admin/Colaborador cierra la cita en el CRM"]);
  sheetEstados.appendRow(["RECHAZADO", "Cliente no asistió a la cita programada", "Admin/Colaborador marca inasistencia"]);
  sheetEstados.appendRow(["REAGENDADO", "Cliente solicitó cambio de fecha/hora/servicio", "Bot IA al reprogramar una cita existente"]);
  sheetEstados.appendRow(["CANCELADA", "Cliente canceló la cita proactivamente vía bot", "Bot IA cuando el cliente solicita cancelar"]);
  formatHeaders(sheetEstados);
  // Aplicar validación de datos a la columna ESTADO de AGENDA (columna K, por la nueva columna TIPO_DIA)
  const estadosRange = sheetEstados.getRange("A2:A6");
  const estadosRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(estadosRange, true)
    .setAllowInvalid(false)
    .build();
  sheetAgenda.getRange("K2:K1000").setDataValidation(estadosRule);

  // 7. PROMOCIONES (Motor de descuentos inteligente)
  let sheetPromociones = getOrCreateSheet(ss, "PROMOCIONES");
  sheetPromociones.clear();
  sheetPromociones.appendRow(["NOMBRE", "DESCRIPCION", "TIPO_PROMO", "VALOR_DESCUENTO", "APLICA_SERVICIO", "APLICA_DIA", "VENCE", "ESTADO", "APLICA_TIPO_CLIENTE", "TIPO_MEDIA_PROMO", "URL_MEDIA_PROMO", "MAX_USOS_CLIENTE", "DIFUSION", "HORA_DIFUSION", "MAX_ENVIOS_DIFUSION", "MENSAJE_DIFUSION"]);
  sheetPromociones.appendRow(["Martes de Uñas", "2x1 en manicure y pedicure los martes", "2X1", 50, "Manicure,Pedicure", "Martes", "31/03/2026", "ACTIVO", "TODOS", "", "", "", "SI", "08:00", 20, ""]);
  sheetPromociones.appendRow(["Cumpleanos Especial", "Feliz cumpleanos {nombre}! En {negocio} te regalamos un {descuento} de descuento en el servicio que desees. Escribenos para agendar tu cita de cumpleanos!", "CUMPLEANOS", 20, "TODOS", "08:00,13:00,19:00", "", "ACTIVO", "Frecuente,VIP", "", "", "", "NO", "", "", ""]);
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


  // 10. CONFIG_SERVICIOS (Catálogo de servicios con anticipo per-service)
  let sheetServiciosCfg = ss.getSheetByName("CONFIG_SERVICIOS");
  if (!sheetServiciosCfg) {
    sheetServiciosCfg = ss.insertSheet("CONFIG_SERVICIOS");
    sheetServiciosCfg.appendRow(["ID_SERVICIO", "INTENCION", "RESPUESTA_BASE", "TIEMPO_SERVICIO", "CATEGORIA", "TIPO_SERVICIO", "ANTICIPO_HABILITADO", "TIPO_ANTICIPO", "VALOR_ANTICIPO"]);
    formatHeaders(sheetServiciosCfg);
    Logger.log('✅ CONFIG_SERVICIOS creada con headers de anticipo.');
  } else {
    // Asegurar que las columnas nuevas existan
    const headers = sheetServiciosCfg.getRange(1, 1, 1, sheetServiciosCfg.getLastColumn()).getValues()[0];
    var colsToAdd = ["TIPO_SERVICIO", "ANTICIPO_HABILITADO", "TIPO_ANTICIPO", "VALOR_ANTICIPO"];
    colsToAdd.forEach(function(col) {
      if (!headers.includes(col)) {
        var nextCol = sheetServiciosCfg.getLastColumn() + 1;
        sheetServiciosCfg.getRange(1, nextCol).setValue(col);
        sheetServiciosCfg.getRange(1, nextCol).setFontWeight('bold').setBackground('#f3f3f3');
        Logger.log('✅ Columna ' + col + ' agregada a CONFIG_SERVICIOS.');
      }
    });
  }

  // 11. GALERIA_SERVICIOS (Multimedia por servicio: fotos antes/despues, videos, recomendaciones)
  let sheetGaleria = getOrCreateSheet(ss, "GALERIA_SERVICIOS");
  sheetGaleria.clear();
  sheetGaleria.appendRow(["ID_MATERIAL", "ID_SERVICIO", "CATEGORIA", "TIPO_MEDIA", "TITULO", "DESCRIPCION", "URL_MEDIA", "ORDEN"]);
  sheetGaleria.appendRow(["DIS-001-M01", "DIS-001", "antes_despues", "imagen", "Antes y Despues", "Mira como queda el diseno de cejas con nuestras profesionales", "https://drive.google.com/...", 1]);
  formatHeaders(sheetGaleria);

  // 12. FESTIVOS_CONFIG (Dias festivos colombianos - control de apertura)
  let sheetFestivos = getOrCreateSheet(ss, "FESTIVOS_CONFIG");
  sheetFestivos.clear();
  sheetFestivos.appendRow(["ANO", "FECHA", "NOMBRE", "TRABAJA", "GENERADO_AUTO", "HORA_INI", "HORA_FIN"]);
  populateFestivos2026_(sheetFestivos);
  formatHeaders(sheetFestivos);

  Logger.log("¡Entorno V8 inicializado correctamente con LISTA_ESTADOS y gestión de citas mejorada!");
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
 * Resetea la hoja FESTIVOS_CONFIG con los 18 festivos oficiales de Colombia 2026.
 * Ejecutar manualmente desde el editor GAS cuando se necesite corregir festivos.
 */
function resetFestivos2026() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) { Logger.log("Error: Script debe estar vinculado a un Google Sheet."); return; }

  let sheet = getOrCreateSheet(ss, "FESTIVOS_CONFIG");
  sheet.clear();
  sheet.appendRow(["ANO", "FECHA", "NOMBRE", "TRABAJA", "GENERADO_AUTO", "HORA_INI", "HORA_FIN"]);
  populateFestivos2026_(sheet);
  formatHeaders(sheet);
  Logger.log("Festivos 2026 actualizados correctamente (18 festivos oficiales Colombia).");
}

/**
 * Helper: Inserta los 18 festivos oficiales de Colombia 2026 (Ley Emiliani aplicada).
 */
function populateFestivos2026_(sheet) {
  const festivos = [
    // Fechas fijas
    [2026, "01/01/2026", "Ano Nuevo",                        "NO", "SI", "", ""],
    [2026, "02/04/2026", "Jueves Santo",                     "NO", "SI", "", ""],
    [2026, "03/04/2026", "Viernes Santo",                    "NO", "SI", "", ""],
    [2026, "01/05/2026", "Dia del Trabajo",                  "NO", "SI", "", ""],
    [2026, "20/07/2026", "Dia de la Independencia",          "NO", "SI", "", ""],
    [2026, "07/08/2026", "Batalla de Boyaca",                "NO", "SI", "", ""],
    [2026, "08/12/2026", "Inmaculada Concepcion",            "NO", "SI", "", ""],
    [2026, "25/12/2026", "Navidad",                          "NO", "SI", "", ""],
    // Ley Emiliani (trasladados al lunes)
    [2026, "12/01/2026", "Reyes Magos",                      "NO", "SI", "", ""],
    [2026, "23/03/2026", "San Jose",                         "NO", "SI", "", ""],
    [2026, "18/05/2026", "Ascension del Senor",              "NO", "SI", "", ""],
    [2026, "08/06/2026", "Corpus Christi",                   "NO", "SI", "", ""],
    [2026, "15/06/2026", "Sagrado Corazon de Jesus",         "NO", "SI", "", ""],
    [2026, "29/06/2026", "San Pedro y San Pablo",            "NO", "SI", "", ""],
    [2026, "17/08/2026", "Asuncion de la Virgen",            "NO", "SI", "", ""],
    [2026, "12/10/2026", "Dia de la Diversidad Etnica",      "NO", "SI", "", ""],
    [2026, "02/11/2026", "Todos los Santos",                 "NO", "SI", "", ""],
    [2026, "16/11/2026", "Independencia de Cartagena",       "NO", "SI", "", ""],
  ];
  festivos.forEach(row => sheet.appendRow(row));
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
