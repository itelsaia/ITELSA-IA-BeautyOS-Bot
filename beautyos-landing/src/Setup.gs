// ─── Setup BeautyOS Landing + CRM ───
// Ejecutar setupLanding() UNA vez para crear las 14 hojas con datos iniciales.
// Ejecutar limpiarHojas() para eliminar hojas obsoletas del spreadsheet.
// Ejecutar crearTriggerFacturacion() para activar alertas diarias de cobro.

// ═══════════════════════════════════════════════
// ─── SETUP PRINCIPAL ───
// ═══════════════════════════════════════════════

function setupLanding() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja1 = ss.getSheetByName('Hoja 1');

  crearConfiguracion(ss);
  crearLeads(ss);
  crearEstadosLead(ss);
  crearClientes(ss);
  crearPagos(ss);
  crearNovedades(ss);
  crearEstadosNovedad(ss);
  crearAsesores(ss);
  crearPlanes(ss);
  crearCondiciones(ss);
  crearDolores(ss);
  crearFuncionalidades(ss);
  crearFAQ(ss);
  crearTestimonios(ss);

  if (hoja1) {
    try { ss.deleteSheet(hoja1); } catch(e) {}
  }

  SpreadsheetApp.flush();
  Logger.log('Setup completado: 14 hojas creadas.');
}

// Crea solo las hojas nuevas (ESTADOS_LEAD, ESTADOS_NOVEDAD, ASESORES) + migra LEADS
function crearHojasNuevas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  crearEstadosLead(ss);
  crearEstadosNovedad(ss);
  crearAsesores(ss);
  // Migrar LEADS: agregar columna NOMBRE_CONTACTO si no existe
  var leadsSheet = ss.getSheetByName('LEADS');
  if (leadsSheet) {
    var headers = leadsSheet.getRange(1, 1, 1, leadsSheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('NOMBRE_CONTACTO') < 0) {
      leadsSheet.insertColumnBefore(2);
      leadsSheet.getRange(1, 2).setValue('NOMBRE_CONTACTO').setFontWeight('bold').setBackground('#1B6B6A').setFontColor('white');
      leadsSheet.setColumnWidth(2, 160);
      Logger.log('Columna NOMBRE_CONTACTO agregada a LEADS');
    }
  }
  SpreadsheetApp.flush();
  Logger.log('Hojas nuevas creadas: ESTADOS_LEAD, ESTADOS_NOVEDAD, ASESORES. LEADS migrada.');
}

// ─── Elimina hojas que ya no se usan ───
function limpiarHojas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var permitidas = [
    'CONFIGURACION', 'LEADS', 'ESTADOS_LEAD', 'CLIENTES', 'PAGOS',
    'NOVEDADES', 'ESTADOS_NOVEDAD', 'ASESORES', 'PLANES',
    'CONDICIONES', 'DOLORES', 'FUNCIONALIDADES', 'FAQ', 'TESTIMONIOS'
  ];
  var sheets = ss.getSheets();
  var eliminadas = [];

  for (var i = 0; i < sheets.length; i++) {
    var nombre = sheets[i].getName();
    if (permitidas.indexOf(nombre) === -1) {
      eliminadas.push(nombre);
    }
  }

  // No eliminar si quedaria sin hojas
  if (eliminadas.length >= sheets.length) {
    Logger.log('No se puede eliminar todas las hojas. Ejecuta setupLanding() primero.');
    return;
  }

  for (var j = 0; j < eliminadas.length; j++) {
    var sheet = ss.getSheetByName(eliminadas[j]);
    if (sheet) {
      ss.deleteSheet(sheet);
      Logger.log('Eliminada: ' + eliminadas[j]);
    }
  }

  Logger.log('Limpieza completada. Eliminadas ' + eliminadas.length + ' hojas: ' + eliminadas.join(', '));
}

// ─── Trigger diario de verificacion de facturacion (ejecutar UNA vez) ───
function crearTriggerFacturacion() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'verificarFacturaciones') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('verificarFacturaciones')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
  Logger.log('Trigger creado: verificarFacturaciones() cada dia a las 8 AM.');
}

// ─── Crea hoja CAMPANAS si no existe ───
function crearCampanas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, 'CAMPANAS');
  if (sheet.getLastRow() > 0) { Logger.log('CAMPANAS ya tiene datos, no se sobreescribe.'); return; }
  var headers = [
    'ID_CAMPANA', 'NOMBRE', 'ESTADO', 'FECHA_INICIO', 'FECHA_FIN',
    'PRECIO_MENSUAL', 'PRECIO_ANUAL', 'IMPLEMENTACION', 'PRIMER_MES_GRATIS',
    'META_CLIENTES', 'CLIENTES_ACTUALES', 'CONDICIONES_ESPECIALES',
    'MENSAJE_AGENTE', 'CANAL'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#145251').setFontColor('white');
  sheet.setFrozenRows(1);
  // Campaña de lanzamiento por defecto
  sheet.appendRow([
    'CAMP-001', 'Lanzamiento BeautyOS 2026', 'ACTIVA',
    new Date(), '',
    180000, 160000, 0, 'SI',
    5, 0,
    'Implementacion GRATIS hasta completar 5 clientes. Primer mes GRATIS. Sin contrato de permanencia.',
    'Estamos en lanzamiento. La implementacion que normalmente vale $400.000 es GRATIS para los primeros 5 clientes. Ademas, el primer mes te sale gratis. Son $180.000/mes todo incluido, sin contrato. Solo quedan CUPOS_DISPONIBLES cupos disponibles.',
    'whatsapp,landing'
  ]);
  sheet.setColumnWidth(12, 300);
  sheet.setColumnWidth(13, 400);
  SpreadsheetApp.flush();
  Logger.log('Hoja CAMPANAS creada con campaña de lanzamiento.');
}

// ═══════════════════════════════════════════════
// ─── CREACION DE HOJAS ───
// ═══════════════════════════════════════════════

// ─── CONFIGURACION: Config unificada (landing + CRM) ───
function crearConfiguracion(ss) {
  var sheet = getOrCreateSheet(ss, 'CONFIGURACION');
  sheet.clear();
  var data = [
    ['CLAVE', 'VALOR'],
    // Branding
    ['NOMBRE_PRODUCTO', 'BeautyOS'],
    ['COLOR_PRIMARIO', '#1B6B6A'],
    ['COLOR_SECUNDARIO', '#C8845A'],
    ['LOGO_URL', 'https://drive.google.com/file/d/1I0XzbOfCf0BFAbua1S-otVRu-d_iM7F3/view'],
    ['MOCKUP_URL', 'https://drive.google.com/file/d/10LW-xiEEd_88ezpgm4bRY4cxi_YJS5Hz/view'],
    // Landing — Hero
    ['HERO_BADGE', 'Tecnologia para tu negocio de belleza'],
    ['HERO_TITULO', 'Mientras lees esto, tu competencia ya esta <span>automatizando su negocio</span>'],
    ['HERO_SUBTITULO', 'Peluquerias, spas, centros esteticos y barbershops que usan IA ya no pierden citas ni clientes.'],
    // Landing — Secciones
    ['DOLOR_TITULO', 'Esto te suena familiar?'],
    ['DOLOR_SUBTITULO', 'Tu negocio enfrenta estos problemas todos los dias. La tecnologia puede resolverlos.'],
    ['SOLUCION_TITULO', 'Asi se ve tu negocio con BeautyOS'],
    ['SOLUCION_DESC', 'Un sistema completo, profesional y facil de usar. Mira las pantallas reales.'],
    ['SOLUTION_IMG_URL', 'https://drive.google.com/file/d/1NF4gpL6e9-HNvsymJWz3JGq6MZ9VWLCf/view'],
    ['DEMOCRAT_TITULO', 'Tecnologia para TODOS los negocios de belleza'],
    ['DEMOCRAT_DESC', 'No importa si trabajas solo o tienes 20 empleados. BeautyOS se adapta a tu negocio.'],
    ['CTA_TITULO', 'No dejes que tu competencia te lleve la ventaja'],
    ['CTA_DESC', 'Unete a los negocios que ya estan usando tecnologia para crecer.'],
    // Landing — Imagenes carousel
    ['DEMO_DASHBOARD_URL', 'https://drive.google.com/file/d/10LW-xiEEd_88ezpgm4bRY4cxi_YJS5Hz/view'],
    ['DEMO_AGENDA_URL', 'https://drive.google.com/file/d/1LrF1pR9IOUBBUw_0rynYbzqxKG7_poi0/view'],
    ['DEMO_SERVICIOS_URL', 'https://drive.google.com/file/d/1NF4gpL6e9-HNvsymJWz3JGq6MZ9VWLCf/view'],
    ['DEMO_ANALISIS_URL', 'https://drive.google.com/file/d/1fDkb6S849dll1Y156j2-LSZA4OoBqMll/view'],
    ['DEMO_HORARIOS_URL', 'https://drive.google.com/file/d/1UFxTvxkMdg3eyr4gXaw4cQXChGOAUo0m/view'],
    ['DEMO_PROMOS_URL', 'https://drive.google.com/file/d/1QZuqCCj1WnSfWZmZDc_7z1dyEnlLdH8y/view'],
    ['DEMO_NOVEDADES_URL', 'https://drive.google.com/file/d/11QDqP6ZJLKMCWJBFSbBhoHz7KY-5zO9N/view'],
    ['DEMO_SOLICITUDES_URL', 'https://drive.google.com/file/d/196XzIMAAR9guJmND-U6f22n60ypAVRIQ/view'],
    // Contacto
    ['WHATSAPP_VENTAS', ''],
    ['EMAIL_VENTAS', 'iaitelsa@gmail.com'],
    ['EMAIL_LEADS', 'iaitelsa@gmail.com'],
    // CRM — Agente IA
    ['CHATGPT_API_KEY_DEFAULT', ''],
    ['IA_MODEL', 'gpt-4o-mini'],
    // CRM — BeautyOS General
    ['BEAUTYOS_WHATSAPP', ''],
    ['MENSAJE_BIENVENIDA_DEFAULT', 'Bienvenido a BeautyOS! Tu negocio {nombre_negocio} esta listo para recibir clientes.'],
    ['DIAS_ALERTA_FACTURACION', '5'],
    ['EMAIL_ALERTAS_FACTURACION', 'iaitelsa@gmail.com'],
    // Facturacion — suspension automatica
    ['DIAS_GRACIA_DEFAULT', '15'],
    ['CARPETA_SOPORTES_DRIVE', ''],
    // Agente IA Comercial (Sofi)
    ['NOMBRE_AGENTE_COMERCIAL', 'Sofi'],
    ['WHATSAPP_ASESORES', ''],
    ['DATOS_PAGO_BEAUTYOS', 'Nequi / Daviplata / Transferencia Bancolombia']
  ];
  sheet.getRange(1, 1, data.length, 2).setValues(data);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#1B6B6A').setFontColor('white');
  sheet.setColumnWidth(1, 250);
  sheet.setColumnWidth(2, 500);
}

// ─── LEADS: Captura simplificada de prospectos ───
function crearLeads(ss) {
  var sheet = getOrCreateSheet(ss, 'LEADS');
  sheet.clear();
  var headers = [
    'FECHA', 'NOMBRE_CONTACTO', 'NOMBRE_NEGOCIO', 'WHATSAPP', 'EMAIL',
    'CIUDAD', 'CANTIDAD_EMPLEADOS', 'CATEGORIA', 'FUENTE',
    'ESTADO', 'ASIGNADO_A', 'FECHA_CONTACTO', 'NOTAS'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1B6B6A').setFontColor('white');
  sheet.setFrozenRows(1);
  var widths = [140, 160, 200, 140, 200, 120, 140, 130, 100, 120, 130, 140, 300];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

// ─── ESTADOS_LEAD: Catalogo de estados para gestion comercial ───
function crearEstadosLead(ss) {
  var sheet = getOrCreateSheet(ss, 'ESTADOS_LEAD');
  sheet.clear();
  var data = [
    ['ESTADO', 'DESCRIPCION', 'COLOR', 'ORDEN'],
    ['NUEVO', 'Lead recien capturado por la IA. Nadie lo ha contactado aun.', '#3b82f6', 1],
    ['CONTACTADO', 'El asesor ya llamo o escribio al prospecto. Esperando respuesta.', '#f59e0b', 2],
    ['EN_DEMO', 'Se le mostro una demo o presentacion de BeautyOS.', '#8b5cf6', 3],
    ['NEGOCIANDO', 'El prospecto esta interesado pero esta evaluando. Pide tiempo, compara precios, consulta con socios.', '#f97316', 4],
    ['SEGUIMIENTO', 'El prospecto pidio que lo contacten despues. Agendar fecha de re-contacto.', '#06b6d4', 5],
    ['NO_CONTESTA', 'Se intento contactar pero no responde. Reintentar en 2-3 dias.', '#6b7280', 6],
    ['GANADO', 'Cerro el negocio. Se convierte en CLIENTE. Iniciar onboarding tecnico.', '#22c55e', 7],
    ['PERDIDO', 'No compro. Registrar motivo en notas (precio, no le interesa, competencia, etc).', '#ef4444', 8]
  ];
  sheet.getRange(1, 1, data.length, 4).setValues(data);
  sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#1e40af').setFontColor('white');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 500);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 60);
}

// ─── CLIENTES: Registro con facturacion y config tecnica ───
function crearClientes(ss) {
  var sheet = getOrCreateSheet(ss, 'CLIENTES');
  sheet.clear();
  var headers = [
    'ID_CLIENTE', 'FECHA_ALTA', 'NOMBRE_NEGOCIO', 'WHATSAPP', 'EMAIL',
    'CIUDAD', 'CANTIDAD_EMPLEADOS', 'CATEGORIA',
    'PLAN_ACTIVO', 'PERIODO_FACTURACION', 'PRECIO_MENSUAL',
    'FECHA_INICIO_FACTURACION', 'FECHA_PROXIMO_COBRO', 'ESTADO_PAGO',
    'SHEET_ID', 'SCRIPT_ID', 'CHATGPT_API_KEY',
    'TELEFONO_BEAUTYOS', 'MENSAJE_BIENVENIDA', 'NOTAS_TECNICAS',
    'ESTADO', 'LEAD_ORIGEN_ROW', 'DIAS_GRACIA', 'CARPETA_GOOGLE_WORKSPACE'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#145251').setFontColor('white');
  sheet.setFrozenRows(1);
  var widths = [160, 140, 200, 140, 200, 120, 140, 130, 160, 150, 130, 170, 170, 120, 300, 300, 300, 150, 300, 300, 100, 120, 100];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

// ─── PAGOS: Historial de pagos de clientes ───
function crearPagos(ss) {
  var sheet = getOrCreateSheet(ss, 'PAGOS');
  sheet.clear();
  var headers = ['ID_PAGO', 'ID_CLIENTE', 'FECHA_PAGO', 'MONTO', 'PERIODO_CUBIERTO', 'METODO_PAGO', 'SOPORTE_URL', 'NOTAS'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#10b981').setFontColor('white');
  sheet.setFrozenRows(1);
  var widths = [180, 180, 140, 130, 180, 150, 300, 300];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

// ─── NOVEDADES: Reportes tecnicos de clientes ───
function crearNovedades(ss) {
  var sheet = getOrCreateSheet(ss, 'NOVEDADES');
  sheet.clear();
  var headers = [
    'ID_NOVEDAD', 'FECHA', 'ID_CLIENTE', 'NOMBRE_NEGOCIO', 'WHATSAPP',
    'TIPO_NOVEDAD', 'DESCRIPCION', 'PRIORIDAD', 'ESTADO',
    'ASIGNADO_A', 'FECHA_RESOLUCION', 'NOTAS_RESOLUCION'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f59e0b').setFontColor('white');
  sheet.setFrozenRows(1);
  var widths = [180, 140, 160, 200, 140, 180, 400, 100, 120, 130, 140, 400];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

// ─── ESTADOS_NOVEDAD: Catalogo de estados para tickets de soporte ───
function crearEstadosNovedad(ss) {
  var sheet = getOrCreateSheet(ss, 'ESTADOS_NOVEDAD');
  sheet.clear();
  var data = [
    ['ESTADO', 'DESCRIPCION', 'COLOR', 'ORDEN'],
    ['ABIERTA', 'Novedad recien reportada. Pendiente de revision por el equipo tecnico.', '#ef4444', 1],
    ['EN_REVISION', 'El equipo tecnico esta investigando el problema.', '#f59e0b', 2],
    ['EN_PROGRESO', 'Se identifico el problema y se esta trabajando en la solucion.', '#3b82f6', 3],
    ['ESPERANDO_CLIENTE', 'Se necesita informacion adicional del cliente para continuar.', '#8b5cf6', 4],
    ['RESUELTA', 'El problema fue solucionado. Informar al cliente.', '#22c55e', 5],
    ['CERRADA', 'Novedad cerrada. El cliente confirmo que funciona correctamente.', '#6b7280', 6]
  ];
  sheet.getRange(1, 1, data.length, 4).setValues(data);
  sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#92400e').setFontColor('white');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 500);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 60);
}

// ─── ASESORES: Equipo comercial con asignacion round-robin ───
function crearAsesores(ss) {
  var sheet = getOrCreateSheet(ss, 'ASESORES');
  sheet.clear();
  var headers = [
    'NOMBRE', 'WHATSAPP', 'EMAIL', 'ROL', 'ACTIVO', 'LEADS_ASIGNADOS'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#6366f1').setFontColor('white');
  sheet.setFrozenRows(1);
  var widths = [180, 140, 200, 140, 80, 130];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

// ─── PLANES: Planes de precio disponibles ───
function crearPlanes(ss) {
  var sheet = getOrCreateSheet(ss, 'PLANES');
  sheet.clear();
  var data = [
    ['ID', 'NOMBRE', 'PRECIO_MENSUAL', 'PRECIO_ANUAL', 'DESCRIPCION', 'POPULAR'],
    ['completo', 'BeautyOS Completo', 180000, 160000, 'CRM + Agente IA WhatsApp + Landing Page. Todo lo que tu negocio necesita.', 'si']
  ];
  sheet.getRange(1, 1, data.length, 6).setValues(data);
  sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#1B6B6A').setFontColor('white');
  sheet.getRange(2, 3, 1, 2).setNumberFormat('$#,##0');
  var widths = [100, 180, 140, 140, 450, 80];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

// ─── CONDICIONES: Terminos comerciales y promociones ───
function crearCondiciones(ss) {
  var sheet = getOrCreateSheet(ss, 'CONDICIONES');
  sheet.clear();
  var data = [
    ['CLAVE', 'VALOR'],
    ['IMPLEMENTACION', '400000'],
    ['PROMO_LANZAMIENTO', 'Lanzamiento: Primer mes GRATIS al contratar'],
    ['PROMO_ACTIVA', 'si'],
    ['PROMO_DESCUENTO_PORCENTAJE', ''],
    ['PROMO_FECHA_FIN', ''],
    ['DESCUENTO_ANUAL', '11'],
    ['1', 'Sin contrato, cancela cuando quieras'],
    ['2', 'Pago por Nequi, Daviplata o transferencia'],
    ['3', 'Implementacion y configuracion en 24-48h'],
    ['4', 'Soporte por WhatsApp'],
    ['5', 'Incluye CRM + Agente IA + Landing Page']
  ];
  sheet.getRange(1, 1, data.length, 2).setValues(data);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#374151').setFontColor('white');
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 400);
}

// ─── DOLORES: Puntos de dolor para la landing ───
function crearDolores(ss) {
  var sheet = getOrCreateSheet(ss, 'DOLORES');
  sheet.clear();
  var data = [
    ['ICONO', 'TITULO', 'DESCRIPCION'],
    ['exclamation-triangle', 'Citas perdidas', 'Clientes que no llegan, cancelan a ultimo momento o simplemente olvidan su cita. Pierdes tiempo y dinero.'],
    ['calendar-xmark', 'Agenda en papel', 'Agendas fisicas que se pierden, se mojan o se confunden. No hay historial digital de tus clientes.'],
    ['phone-slash', 'Llamadas sin respuesta', 'Pierdes clientes porque no puedes contestar el telefono mientras atiendes a alguien mas.'],
    ['chart-line', 'Sin datos de tu negocio', 'No sabes cuantos clientes tienes, cual es tu servicio estrella o cuando vendes mas.'],
    ['clock', 'Tiempo perdido en WhatsApp', 'Horas respondiendo los mismos mensajes: precios, horarios, disponibilidad. Una y otra vez.'],
    ['user-slash', 'Clientes que no vuelven', 'Sin seguimiento ni recordatorios automaticos, los clientes simplemente se olvidan de tu negocio.']
  ];
  sheet.getRange(1, 1, data.length, 3).setValues(data);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#ef4444').setFontColor('white');
  var widths = [180, 200, 500];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

// ─── FUNCIONALIDADES: Features para la landing ───
function crearFuncionalidades(ss) {
  var sheet = getOrCreateSheet(ss, 'FUNCIONALIDADES');
  sheet.clear();
  var data = [
    ['ICONO', 'TITULO', 'DESCRIPCION'],
    ['robot', 'Asistente IA 24/7', 'Un bot inteligente atiende tu WhatsApp, responde preguntas, agenda citas y envia recordatorios automaticamente.'],
    ['calendar-check', 'Agendamiento automatico', 'Tus clientes agendan directo desde WhatsApp. Sin llamadas, sin esperas, sin errores.'],
    ['palette', 'CRM personalizado', 'Panel web con tu logo, tus colores, tu marca. Gestiona citas, clientes y servicios en un solo lugar.'],
    ['bell', 'Recordatorios inteligentes', 'Confirmacion y recordatorio automatico por WhatsApp antes de cada cita. Reduce no-shows hasta un 95%.'],
    ['chart-bar', 'Reportes y metricas', 'Conoce tus servicios mas vendidos, horarios pico, clientes frecuentes y el rendimiento de tu equipo.'],
    ['tags', 'Promociones segmentadas', 'Envia promociones por WhatsApp solo a los clientes que te interesan, en el momento perfecto.'],
    ['headset', 'Soporte humano', 'No estas solo. Nuestro equipo te acompana en la configuracion y te ayuda cuando lo necesites.'],
    ['mobile-screen', 'Sin instalar nada', 'Todo funciona desde WhatsApp y el navegador. Tus clientes no necesitan descargar ninguna app.'],
    ['lock', 'Datos seguros', 'Tu informacion esta protegida con Google Cloud, encriptacion y backups automaticos diarios.']
  ];
  sheet.getRange(1, 1, data.length, 3).setValues(data);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#1B6B6A').setFontColor('white');
  var widths = [180, 220, 500];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

// ─── FAQ: Preguntas frecuentes para la landing ───
function crearFAQ(ss) {
  var sheet = getOrCreateSheet(ss, 'FAQ');
  sheet.clear();
  var data = [
    ['PREGUNTA', 'RESPUESTA'],
    ['Necesito saber de tecnologia para usar BeautyOS?', 'Para nada. Si sabes usar WhatsApp, ya puedes usar BeautyOS. Nosotros hacemos toda la configuracion por ti y te ensenamos paso a paso.'],
    ['Cuanto tiempo toma la configuracion?', 'Entre 24 y 48 horas tenemos tu negocio 100% listo con logo, colores, servicios, precios y el bot de WhatsApp funcionando.'],
    ['Puedo cancelar en cualquier momento?', 'Si. No hay contrato ni clausula de permanencia. Cancelas cuando quieras, sin penalidades ni letras pequenas.'],
    ['Funciona con mi numero de WhatsApp actual?', 'Si. BeautyOS se integra con tu numero de WhatsApp Business. Tus clientes siguen escribiendo al mismo numero de siempre.'],
    ['Mis datos estan seguros?', 'Absolutamente. Usamos infraestructura de Google Cloud con encriptacion y backups automaticos. Tu informacion siempre esta protegida.'],
    ['Puedo tener varios colaboradores/estilistas?', 'Si. Cada especialista puede tener su propia agenda, sus propios servicios y horarios independientes.'],
    ['Funciona para barberias y spas tambien?', 'Si. BeautyOS esta disenado para peluquerias, salones de belleza, barberias, spas, centros esteticos y cualquier negocio de belleza.'],
    ['Que metodos de pago aceptan?', 'Nequi, Daviplata, transferencia bancaria (Bancolombia) y PSE. Facturamos mensualmente.'],
    ['Puedo personalizar los servicios y precios?', 'Todo es 100% configurable: servicios, precios, duraciones, especialistas, horarios, promociones y mas.']
  ];
  sheet.getRange(1, 1, data.length, 2).setValues(data);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#374151').setFontColor('white');
  sheet.setColumnWidth(1, 350);
  sheet.setColumnWidth(2, 600);
}

// ─── TESTIMONIOS: Resenas para la landing ───
function crearTestimonios(ss) {
  var sheet = getOrCreateSheet(ss, 'TESTIMONIOS');
  sheet.clear();
  var data = [
    ['NOMBRE', 'ROL', 'TEXTO', 'ESTRELLAS'],
    ['Carolina L.', 'Propietaria, Salon Glamour', 'Desde que active BeautyOS mis clientas agendan solas por WhatsApp. Ya no pierdo citas y el CRM con mi logo se ve super profesional.', 5],
    ['Andrea M.', 'Administradora, Beauty Center', 'Antes perdia horas respondiendo mensajes en WhatsApp. Ahora el bot atiende todo y yo me enfoco en atender a mis clientas. Lo mejor: el precio es justo.', 5],
    ['Luis G.', 'Propietario, Barberia LG', 'Pense que la tecnologia era solo para negocios grandes. BeautyOS me demostro lo contrario. Lo configure en un dia y mis clientes estan felices.', 5]
  ];
  sheet.getRange(1, 1, data.length, 4).setValues(data);
  sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#C8845A').setFontColor('white');
  var widths = [150, 220, 500, 100];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

// ═══════════════════════════════════════════════
// ─── HELPER ───
// ═══════════════════════════════════════════════

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}
