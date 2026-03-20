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

  // 8. NOVEDADES (reportes de staff → gestion admin)
  let sheetNovedades = getOrCreateSheet(ss, "NOVEDADES");
  sheetNovedades.clear();
  sheetNovedades.appendRow(["ID", "FECHA", "HORA", "STAFF", "TIPO", "MENSAJE", "ESTADO", "RESPUESTA", "FECHA_CIERRE"]);
  formatHeaders(sheetNovedades);

  // 9. SOLICITUDES (permisos, vacaciones, etc.)
  let sheetSolicitudes = getOrCreateSheet(ss, "SOLICITUDES");
  sheetSolicitudes.clear();
  sheetSolicitudes.appendRow(["ID", "FECHA", "STAFF", "TIPO", "DESCRIPCION", "FECHA_DESDE", "FECHA_HASTA", "HORA_DESDE", "HORA_HASTA", "ESTADO", "MOTIVO_RECHAZO", "FECHA_RESPUESTA"]);
  formatHeaders(sheetSolicitudes);

  // 10. CONOCIMIENTO (RAG y Multimedia extra)
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
 * Crea la hoja PLAN_PRUEBAS con los 158 casos de prueba organizados por modulo.
 * Ejecutar UNA VEZ desde el editor GAS: crearPlanPruebas()
 */
function crearPlanPruebas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("PLAN_PRUEBAS");
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet("PLAN_PRUEBAS");

  // Headers
  sheet.appendRow(["ID", "MODULO", "PRIORIDAD", "CASO DE PRUEBA", "RESULTADO", "FECHA", "TESTER", "BUG / NOTAS"]);

  var casos = [
    // MODULO 1: Autenticacion
    ["1.01", "Autenticacion", "CRITICA", "PIN correcto ADMIN → bienvenida animada → Dashboard"],
    ["1.02", "Autenticacion", "CRITICA", "PIN correcto STAFF → bienvenida animada → Mi Agenda"],
    ["1.03", "Autenticacion", "CRITICA", "PIN incorrecto → dots rojos, shake, mensaje error"],
    ["1.04", "Autenticacion", "ALTA", "Saludo correcto segun hora (Buenos dias/tardes/noches)"],
    ["1.05", "Autenticacion", "MEDIA", "Frase motivadora cambia aleatoriamente cada login"],
    ["1.06", "Autenticacion", "ALTA", "Refrescar pagina con sesion activa → NO muestra bienvenida"],
    ["1.07", "Autenticacion", "ALTA", "Cerrar sesion → muestra login con numpad"],
    ["1.08", "Autenticacion", "CRITICA", "ADMIN ve sidebar completo (Dashboard, Agenda, Clientes, Equipo, etc.)"],
    ["1.09", "Autenticacion", "CRITICA", "ADMIN NO ve 'Mi Agenda' en sidebar"],
    ["1.10", "Autenticacion", "CRITICA", "STAFF solo ve Mi Agenda, Novedades, Solicitudes"],
    ["1.11", "Autenticacion", "ALTA", "STAFF intenta navegar a pagina admin → redirige a Mi Agenda"],

    // MODULO 2: Onboarding Bot
    ["2.01", "Onboarding Bot", "CRITICA", "Mensaje desde numero nuevo → bot pide nombre"],
    ["2.02", "Onboarding Bot", "CRITICA", "Enviar nombre → bot pide correo"],
    ["2.03", "Onboarding Bot", "CRITICA", "Enviar correo → bot pide cumpleanos"],
    ["2.04", "Onboarding Bot", "ALTA", "Cumpleanos formato DD/MM → bot acepta"],
    ["2.05", "Onboarding Bot", "ALTA", "Cumpleanos formato texto '15 de marzo' → bot acepta"],
    ["2.06", "Onboarding Bot", "CRITICA", "Enviar direccion → bot confirma registro completo"],
    ["2.07", "Onboarding Bot", "CRITICA", "Verificar en Sheet CLIENTES → datos correctos"],
    ["2.08", "Onboarding Bot", "CRITICA", "Segundo mensaje mismo numero → NO pide datos otra vez"],

    // MODULO 3: Agendamiento Bot
    ["3.01", "Agendamiento Bot", "CRITICA", "Pedir cita para servicio existente → bot ofrece horarios"],
    ["3.02", "Agendamiento Bot", "ALTA", "Pedir cita con profesional especifico → filtra por competencias"],
    ["3.03", "Agendamiento Bot", "ALTA", "Pedir cita dia sin disponibilidad → bot sugiere otro dia"],
    ["3.04", "Agendamiento Bot", "MEDIA", "Pedir cita dia festivo cerrado → bot informa"],
    ["3.05", "Agendamiento Bot", "CRITICA", "Confirmar cita → resumen con fecha, hora, servicio, profesional, precio"],
    ["3.06", "Agendamiento Bot", "CRITICA", "Verificar en Sheet AGENDA → estado PENDIENTE, datos correctos"],
    ["3.07", "Agendamiento Bot", "ALTA", "ID auto-generado formato AG-XX-001"],
    ["3.08", "Agendamiento Bot", "ALTA", "Servicio CON anticipo → bot pide comprobante"],
    ["3.09", "Agendamiento Bot", "ALTA", "Enviar foto comprobante → bot analiza con Vision API"],
    ["3.10", "Agendamiento Bot", "ALTA", "Servicio SIN anticipo → confirma sin pedir pago"],
    ["3.11", "Agendamiento Bot", "MEDIA", "Cliente exento de anticipo → no pide comprobante"],
    ["3.12", "Agendamiento Bot", "CRITICA", "Reagendar cita pendiente → bot muestra cita y pide nueva fecha"],
    ["3.13", "Agendamiento Bot", "ALTA", "Reagendar cita con promo DIA FIJO → advierte perdida de descuento"],
    ["3.14", "Agendamiento Bot", "CRITICA", "Confirmar reagendamiento → original CANCELADA, nueva PENDIENTE"],
    ["3.15", "Agendamiento Bot", "ALTA", "Notas en cita cancelada → '[Reagendamiento - Antes: fecha/hora]'"],
    ["3.16", "Agendamiento Bot", "CRITICA", "Cancelar cita → estado CANCELADA en Sheet"],
    ["3.17", "Agendamiento Bot", "ALTA", "Promo porcentaje → precio con descuento correcto"],
    ["3.18", "Agendamiento Bot", "ALTA", "Promo 2x1 → aplicada correctamente"],
    ["3.19", "Agendamiento Bot", "ALTA", "Promo dia fijo en dia incorrecto → bot informa restriccion"],
    ["3.20", "Agendamiento Bot", "MEDIA", "Limite uso promo por cliente → no aplica si llego al limite"],

    // MODULO 4: Mensajes Automaticos
    ["4.01", "Mensajes Auto", "CRITICA", "Recordatorio de cita segun MINUTOS_RECORDATORIO"],
    ["4.02", "Mensajes Auto", "ALTA", "Solo 1 recordatorio por cita (no duplicados)"],
    ["4.03", "Mensajes Auto", "ALTA", "Cambiar MINUTOS_RECORDATORIO → nuevo timing tras sync 5min"],
    ["4.04", "Mensajes Auto", "MEDIA", "Cliente cumple hoy → bot envia felicitacion con promo"],
    ["4.05", "Mensajes Auto", "MEDIA", "No envia cumpleanos duplicado al mismo cliente"],
    ["4.06", "Mensajes Auto", "MEDIA", "Difusion promo activa → envia a clientes registrados"],
    ["4.07", "Mensajes Auto", "MEDIA", "Limites anti-bloqueo respetados (max 50/dia, delays 5-8s)"],

    // MODULO 5: Multimedia Bot
    ["5.01", "Multimedia Bot", "MEDIA", "Pedir info servicio con galeria → bot envia fotos/videos"],
    ["5.02", "Multimedia Bot", "MEDIA", "Enviar audio → bot transcribe y responde"],
    ["5.03", "Multimedia Bot", "BAJA", "Enviar imagen (no comprobante) → bot analiza segun contexto"],

    // MODULO 6: Dashboard
    ["6.01", "Dashboard", "ALTA", "KPIs correctos (total citas, pendientes, ejecutadas, promos, clientes)"],
    ["6.02", "Dashboard", "ALTA", "Tabla ultimas citas coincide con Sheet AGENDA"],
    ["6.03", "Dashboard", "MEDIA", "Badge agenda muestra conteo PENDIENTE + REAGENDADO"],

    // MODULO 7: Agenda Admin
    ["7.01", "Agenda Admin", "CRITICA", "Ver todas las citas en tabla"],
    ["7.02", "Agenda Admin", "CRITICA", "Summary cards con conteo correcto por estado"],
    ["7.03", "Agenda Admin", "CRITICA", "Filtrar por fecha (calendario) → solo citas de esa fecha"],
    ["7.04", "Agenda Admin", "ALTA", "Filtrar por profesional → solo sus citas"],
    ["7.05", "Agenda Admin", "ALTA", "Filtrar por estado (click summary card) → solo ese estado"],
    ["7.06", "Agenda Admin", "ALTA", "Buscar por texto → busca en cliente, servicio, ID, fecha"],
    ["7.07", "Agenda Admin", "ALTA", "Combinar filtro fecha + profesional + estado juntos"],
    ["7.08", "Agenda Admin", "MEDIA", "Limpiar filtro fecha (vacio) → muestra todas las fechas"],
    ["7.09", "Agenda Admin", "CRITICA", "Cerrar cita (boton verde) → modal de cierre aparece"],
    ["7.10", "Agenda Admin", "CRITICA", "Confirmar cierre → EJECUTADO + WhatsApp agradecimiento"],
    ["7.11", "Agenda Admin", "ALTA", "Marcar 'No asistio' → modal bonito → RECHAZADO"],
    ["7.12", "Agenda Admin", "ALTA", "Eliminar cita CANCELADA → modal con datos → eliminada"],
    ["7.13", "Agenda Admin", "ALTA", "Eliminar cita EJECUTADA → funciona correctamente"],
    ["7.14", "Agenda Admin", "CRITICA", "NO hay boton eliminar en citas PENDIENTE"],

    // MODULO 8: Mi Agenda Staff
    ["8.01", "Mi Agenda Staff", "CRITICA", "STAFF ve solo SUS citas (filtrado por nombre)"],
    ["8.02", "Mi Agenda Staff", "ALTA", "Cards: hora, cliente, celular click-to-call, servicio, precio"],
    ["8.03", "Mi Agenda Staff", "ALTA", "Badges resumen: pendientes, cerradas, canceladas, total, $ dia"],
    ["8.04", "Mi Agenda Staff", "MEDIA", "Mini-cards por servicio (Cejas: 3 | Pestanas: 2)"],
    ["8.05", "Mi Agenda Staff", "ALTA", "Cambiar fecha → muestra citas de esa fecha"],
    ["8.06", "Mi Agenda Staff", "ALTA", "Boton cerrar cita funciona desde Mi Agenda"],
    ["8.07", "Mi Agenda Staff", "MEDIA", "Notas de cita visibles en italica si existen"],

    // MODULO 9: Clientes
    ["9.01", "Clientes", "ALTA", "Ver lista completa con ID, nombre, celular, correo, tipo"],
    ["9.02", "Clientes", "ALTA", "Buscar por nombre o celular en tiempo real"],
    ["9.03", "Clientes", "ALTA", "Toggle exento anticipo → cambia en Sheet"],
    ["9.04", "Clientes", "MEDIA", "Clasificacion auto (Ocasional/Frecuente/VIP) segun umbrales"],

    // MODULO 10: Equipo
    ["10.01", "Equipo", "ALTA", "Ver lista colaboradores con todos los campos"],
    ["10.02", "Equipo", "ALTA", "Crear nuevo colaborador → modal → guarda con ID auto"],
    ["10.03", "Equipo", "ALTA", "Editar colaborador → modal pre-llenado → actualiza"],
    ["10.04", "Equipo", "ALTA", "Eliminar colaborador → confirmacion bonita → elimina"],
    ["10.05", "Equipo", "ALTA", "Asignar competencias multiples (checkboxes servicios)"],
    ["10.06", "Equipo", "MEDIA", "PIN unico entre colaboradores"],

    // MODULO 11: Servicios
    ["11.01", "Servicios", "ALTA", "Ver catalogo con nombre, precio, duracion, estado"],
    ["11.02", "Servicios", "ALTA", "Crear nuevo servicio → modal → guarda"],
    ["11.03", "Servicios", "ALTA", "Editar servicio → modal pre-llenado → actualiza"],
    ["11.04", "Servicios", "ALTA", "Eliminar servicio → confirmacion → elimina"],
    ["11.05", "Servicios", "ALTA", "Configurar anticipo (activar/desactivar, porcentaje)"],
    ["11.06", "Servicios", "MEDIA", "Galeria multimedia: agregar/ver/eliminar fotos y videos"],

    // MODULO 12: Promociones
    ["12.01", "Promociones", "ALTA", "Ver lista con nombre, tipo, descuento, estado"],
    ["12.02", "Promociones", "ALTA", "Crear promo tipo porcentaje → descuento correcto"],
    ["12.03", "Promociones", "ALTA", "Crear promo tipo 2x1 → guarda correctamente"],
    ["12.04", "Promociones", "ALTA", "Crear promo tipo dia fijo → guarda con dia"],
    ["12.05", "Promociones", "ALTA", "Activar/Desactivar promo toggle funciona"],
    ["12.06", "Promociones", "MEDIA", "Promo con fecha vencimiento → se desactiva si vence"],
    ["12.07", "Promociones", "MEDIA", "Difusion: configurar horario y mensaje"],

    // MODULO 13: Horarios
    ["13.01", "Horarios", "ALTA", "Ver horario base por dia"],
    ["13.02", "Horarios", "ALTA", "Editar horario de un dia → guardar"],
    ["13.03", "Horarios", "ALTA", "Desactivar dia completo → no disponible para agendamiento"],
    ["13.04", "Horarios", "ALTA", "Crear bloqueo horario → modal con profesional, fecha, hora, motivo"],
    ["13.05", "Horarios", "MEDIA", "Crear bloqueo todo el dia → toggle funciona"],
    ["13.06", "Horarios", "MEDIA", "Crear bloqueo por rango de fechas"],
    ["13.07", "Horarios", "ALTA", "Eliminar bloqueo → confirmacion bonita → elimina"],
    ["13.08", "Horarios", "MEDIA", "Limpiar bloqueos vencidos (toast + boton limpia)"],
    ["13.09", "Horarios", "MEDIA", "Festivos: ver calendario del ano generado"],
    ["13.10", "Horarios", "MEDIA", "Festivos: marcar abierto con horario especial"],

    // MODULO 14: Novedades
    ["14.01", "Novedades STAFF", "MEDIA", "STAFF ve solo SUS novedades"],
    ["14.02", "Novedades STAFF", "MEDIA", "Crear novedad tipo Insumo → ayuda cambia segun tipo"],
    ["14.03", "Novedades STAFF", "MEDIA", "Crear novedad tipo Equipo → estado ABIERTO"],
    ["14.04", "Novedades STAFF", "MEDIA", "Ver respuesta admin en novedad cerrada (bloque verde)"],
    ["14.05", "Novedades STAFF", "BAJA", "Empty state 'No has reportado novedades'"],
    ["14.06", "Novedades ADMIN", "MEDIA", "ADMIN ve TODAS las novedades de todos"],
    ["14.07", "Novedades ADMIN", "MEDIA", "Filtrar por estado (Abierto/Cerrado)"],
    ["14.08", "Novedades ADMIN", "MEDIA", "Filtrar por profesional"],
    ["14.09", "Novedades ADMIN", "MEDIA", "Cerrar novedad con respuesta → CERRADO"],
    ["14.10", "Novedades ADMIN", "MEDIA", "Eliminar novedad cerrada → confirmacion con detalle"],
    ["14.11", "Novedades ADMIN", "MEDIA", "Fechas legibles DD/MM/YYYY HH:mm (no raw Date)"],

    // MODULO 15: Solicitudes
    ["15.01", "Solicitudes STAFF", "MEDIA", "STAFF ve solo SUS solicitudes"],
    ["15.02", "Solicitudes STAFF", "MEDIA", "Crear solicitud Permiso → campos fecha y horas aparecen"],
    ["15.03", "Solicitudes STAFF", "MEDIA", "Crear solicitud Vacaciones → campos fecha aparecen"],
    ["15.04", "Solicitudes STAFF", "MEDIA", "Crear solicitud Cambio Horario → sin campos fecha"],
    ["15.05", "Solicitudes STAFF", "MEDIA", "Estado PENDIENTE inicial (badge amarillo)"],
    ["15.06", "Solicitudes STAFF", "MEDIA", "Ver motivo rechazo si NO APROBADO (texto rojo)"],
    ["15.07", "Solicitudes STAFF", "MEDIA", "Ver solicitud aprobada (badge verde)"],
    ["15.08", "Solicitudes ADMIN", "MEDIA", "ADMIN ve TODAS las solicitudes"],
    ["15.09", "Solicitudes ADMIN", "MEDIA", "Filtrar por estado"],
    ["15.10", "Solicitudes ADMIN", "MEDIA", "Filtrar por profesional"],
    ["15.11", "Solicitudes ADMIN", "MEDIA", "Aprobar solicitud → confirmacion bonita → APROBADO"],
    ["15.12", "Solicitudes ADMIN", "MEDIA", "Rechazar con motivo → modal → NO APROBADO"],
    ["15.13", "Solicitudes ADMIN", "MEDIA", "Rechazar sin motivo (opcional) → acepta"],

    // MODULO 16: Analisis
    ["16.01", "Analisis", "MEDIA", "6 graficas se renderizan sin errores"],
    ["16.02", "Analisis", "MEDIA", "KPIs calculados correctamente vs datos Sheet"],
    ["16.03", "Analisis", "MEDIA", "Filtrar por rango de meses → datos actualizados"],
    ["16.04", "Analisis", "MEDIA", "Filtrar por profesional → graficas reflejan solo ese"],
    ["16.05", "Analisis", "BAJA", "Tabla rendimiento profesional coincide con datos reales"],

    // MODULO 17: Configuracion
    ["17.01", "Configuracion", "ALTA", "Ver config actual con campos pre-llenados"],
    ["17.02", "Configuracion", "ALTA", "Editar nombre negocio → guarda y refleja en header"],
    ["17.03", "Configuracion", "ALTA", "Editar mensaje agradecimiento → textarea guarda"],
    ["17.04", "Configuracion", "ALTA", "Editar mensaje recordatorio con variables"],
    ["17.05", "Configuracion", "ALTA", "Editar minutos recordatorio → guarda en Sheet"],
    ["17.06", "Configuracion", "MEDIA", "Editar umbrales clasificacion"],
    ["17.07", "Configuracion", "ALTA", "Guardar config → toast exito, datos persisten al recargar"],

    // MODULO 18: Modales
    ["18.01", "Modales", "MEDIA", "Todas las confirmaciones usan modal Bootstrap (no alert nativo)"],
    ["18.02", "Modales", "MEDIA", "Modal eliminar cita muestra cliente y servicio"],
    ["18.03", "Modales", "MEDIA", "Modal 'No asistio' muestra detalle de cita"],
    ["18.04", "Modales", "MEDIA", "Modal aprobar solicitud muestra resumen"],
    ["18.05", "Modales", "BAJA", "Boton Cancelar cierra modal sin accion"],
    ["18.06", "Modales", "BAJA", "Colores correctos: rojo=eliminar, verde=aprobar, amarillo=advertencia"],

    // MODULO 19: Multi-Tenant
    ["19.01", "Multi-Tenant", "ALTA", "Bot atiende al tenant correcto → Sheet correcto"],
    ["19.02", "Multi-Tenant", "ALTA", "Sync datos cada 5 min → cambios en Sheet reflejados en bot"],
    ["19.03", "Multi-Tenant", "MEDIA", "Config por tenant independiente (no se cruzan)"],

    // MODULO 20: Integracion
    ["20.01", "Integracion WA-CRM", "CRITICA", "Cita agendada por bot aparece en CRM Agenda"],
    ["20.02", "Integracion WA-CRM", "CRITICA", "Cita cerrada desde CRM → WhatsApp agradecimiento llega"],
    ["20.03", "Integracion WA-CRM", "CRITICA", "Recordatorio se envia segun minutos configurados"],
    ["20.04", "Integracion WA-CRM", "ALTA", "Cambios en servicios/precios → reflejados en bot tras sync"],
    ["20.05", "Integracion WA-CRM", "ALTA", "Cambios en horarios → disponibilidad actualizada en bot"],
    ["20.06", "Integracion WA-CRM", "ALTA", "Bloqueo creado en CRM → bot no ofrece esos horarios"],

    // MODULO 21: Responsive
    ["21.01", "Responsive UX", "BAJA", "CRM en desktop 1920px → layout completo, sidebar visible"],
    ["21.02", "Responsive UX", "BAJA", "CRM en tablet 768px → sidebar colapsable, tablas scroll"],
    ["21.03", "Responsive UX", "BAJA", "CRM en movil 375px → sidebar oculto, cards apiladas"],
    ["21.04", "Responsive UX", "BAJA", "Click-to-call en celular → abre app llamadas"],
    ["21.05", "Responsive UX", "BAJA", "Toast notifications visibles y auto-cierran en 4s"]
  ];

  casos.forEach(function(c) {
    sheet.appendRow([c[0], c[1], c[2], c[3], "", "", "", ""]);
  });

  // Formato
  formatHeaders(sheet);
  sheet.setColumnWidth(1, 60);   // ID
  sheet.setColumnWidth(2, 150);  // Modulo
  sheet.setColumnWidth(3, 80);   // Prioridad
  sheet.setColumnWidth(4, 500);  // Caso de Prueba
  sheet.setColumnWidth(5, 100);  // Resultado
  sheet.setColumnWidth(6, 100);  // Fecha
  sheet.setColumnWidth(7, 100);  // Tester
  sheet.setColumnWidth(8, 300);  // Bug/Notas

  // Validacion de datos para RESULTADO
  var resultRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["PASO", "FALLO", "BLOQUEADO", "N/A"], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange("E2:E" + (casos.length + 1)).setDataValidation(resultRule);

  // Validacion de datos para PRIORIDAD (colores condicionales)
  var prioRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["CRITICA", "ALTA", "MEDIA", "BAJA"], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange("C2:C" + (casos.length + 1)).setDataValidation(prioRule);

  // Colores por prioridad
  var data = sheet.getRange(2, 3, casos.length, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = i + 2;
    var prio = data[i][0];
    if (prio === "CRITICA") sheet.getRange(row, 3).setBackground("#FFCDD2").setFontColor("#B71C1C");
    else if (prio === "ALTA") sheet.getRange(row, 3).setBackground("#FFE0B2").setFontColor("#E65100");
    else if (prio === "MEDIA") sheet.getRange(row, 3).setBackground("#FFF9C4").setFontColor("#F57F17");
    else if (prio === "BAJA") sheet.getRange(row, 3).setBackground("#C8E6C9").setFontColor("#1B5E20");
  }

  // Hoja resumen al final
  sheet.appendRow([]);
  sheet.appendRow(["", "RESUMEN DE EJECUCION", "", "", "", "", "", ""]);
  var resumenStart = casos.length + 3;
  sheet.getRange(resumenStart, 2).setFontWeight("bold").setFontSize(12);

  sheet.appendRow(["", "Modulo", "Total", "Pasaron", "Fallaron", "Bloqueado", "Pendientes", ""]);
  sheet.getRange(resumenStart + 1, 2, 1, 6).setFontWeight("bold").setBackground("#f3f3f3");

  var modulos = ["Autenticacion", "Onboarding Bot", "Agendamiento Bot", "Mensajes Auto", "Multimedia Bot",
    "Dashboard", "Agenda Admin", "Mi Agenda Staff", "Clientes", "Equipo", "Servicios", "Promociones",
    "Horarios", "Novedades STAFF", "Novedades ADMIN", "Solicitudes STAFF", "Solicitudes ADMIN",
    "Analisis", "Configuracion", "Modales", "Multi-Tenant", "Integracion WA-CRM", "Responsive UX"];

  modulos.forEach(function(mod) {
    var total = casos.filter(function(c) { return c[1] === mod; }).length;
    if (total > 0) {
      var rowNum = sheet.getLastRow() + 1;
      sheet.appendRow(["", mod, total,
        '=COUNTIFS(B2:B' + (casos.length+1) + ',"' + mod + '",E2:E' + (casos.length+1) + ',"PASO")',
        '=COUNTIFS(B2:B' + (casos.length+1) + ',"' + mod + '",E2:E' + (casos.length+1) + ',"FALLO")',
        '=COUNTIFS(B2:B' + (casos.length+1) + ',"' + mod + '",E2:E' + (casos.length+1) + ',"BLOQUEADO")',
        '=' + total + '-COUNTIFS(B2:B' + (casos.length+1) + ',"' + mod + '",E2:E' + (casos.length+1) + ',"<>")',
        ""]);
    }
  });

  // Fila total
  var lastRow = sheet.getLastRow() + 1;
  sheet.appendRow(["", "TOTAL", casos.length,
    '=SUM(D' + (resumenStart+2) + ':D' + (lastRow-1) + ')',
    '=SUM(E' + (resumenStart+2) + ':E' + (lastRow-1) + ')',
    '=SUM(F' + (resumenStart+2) + ':F' + (lastRow-1) + ')',
    '=SUM(G' + (resumenStart+2) + ':G' + (lastRow-1) + ')',
    ""]);
  sheet.getRange(lastRow, 2, 1, 7).setFontWeight("bold").setBackground("#E3F2FD");

  Logger.log("Plan de pruebas creado: " + casos.length + " casos en hoja PLAN_PRUEBAS");
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
