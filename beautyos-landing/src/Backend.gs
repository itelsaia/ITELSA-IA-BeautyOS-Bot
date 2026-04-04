// ─── BeautyOS — Backend GAS ───
// Sirve la landing page, el panel CRM admin, y gestiona leads + clientes + novedades.
//
// Hojas usadas (11):
//   CONFIGURACION  — Config unificada landing + CRM (clave-valor)
//   LEADS          — Prospectos capturados desde la landing
//   CLIENTES       — Clientes activos con facturacion y config tecnica
//   PAGOS          — Historial de pagos de clientes
//   NOVEDADES      — Reportes tecnicos de clientes (tickets de soporte)
//   PLANES         — Planes de precio
//   CONDICIONES    — Terminos comerciales y promociones (clave-valor)
//   DOLORES        — Contenido landing: puntos de dolor
//   FUNCIONALIDADES— Contenido landing: features
//   FAQ            — Contenido landing: preguntas frecuentes
//   TESTIMONIOS    — Contenido landing: resenas

// ═══════════════════════════════════════════════
// ─── WEB APP: Rutas HTTP ───
// ═══════════════════════════════════════════════

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'landing';
  if (page === 'admin') {
    return HtmlService.createTemplateFromFile('panel')
      .evaluate()
      .setTitle('BeautyOS - CRM Admin')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('BeautyOS - Tecnologia para tu Negocio de Belleza')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// doPost para integraciones externas: leads, novedades, y consultas del agente IA comercial
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.action === 'saveLead') return jsonResponse(handleSaveLead(payload));
    if (payload.action === 'saveNovedad') return jsonResponse(handleSaveNovedad(payload));
    if (payload.action === 'getInfoComercial') return jsonResponse(handleGetInfoComercial());
    if (payload.action === 'getClientesCRM') return jsonResponse(handleGetClientesCRM());
    if (payload.action === 'getLeads') return jsonResponse(leerTabla(SpreadsheetApp.getActiveSpreadsheet(), 'LEADS') || []);
    if (payload.action === 'updateLeadByWhatsapp') return jsonResponse(handleUpdateLeadByWhatsapp(payload));
    if (payload.action === 'migrateLeads') return jsonResponse(migrateLeadsSheet());
    return jsonResponse({ error: 'Accion no reconocida' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════
// ─── LANDING: Datos para renderizar la pagina ───
// ═══════════════════════════════════════════════

function getDatosLanding() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    config: leerClaveValor(ss, 'CONFIGURACION'),
    dolores: leerTabla(ss, 'DOLORES'),
    funcionalidades: leerTabla(ss, 'FUNCIONALIDADES'),
    faq: leerTabla(ss, 'FAQ'),
    testimonios: leerTabla(ss, 'TESTIMONIOS'),
    planes: leerTabla(ss, 'PLANES'),
    condiciones: leerClaveValor(ss, 'CONDICIONES')
  };
}

// ═══════════════════════════════════════════════
// ─── LEADS ───
// ═══════════════════════════════════════════════

// Guarda un lead desde el formulario de la landing
function handleSaveLead(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('LEADS');
  if (!sheet) return { error: 'Hoja LEADS no encontrada. Ejecuta setupLanding().' };

  var config = leerClaveValor(ss, 'CONFIGURACION');
  var cant = String(payload.cantidadEmpleados || '').trim();
  var categoria = 'Propia empresa';
  if (cant === '2 a 5') categoria = 'Mediano';
  else if (cant === '6 a 10' || cant === '11 o mas') categoria = 'Grande';

  // Asignacion round-robin entre asesores activos
  var asesoresData = leerTabla(ss, 'ASESORES');
  var asesoresActivos = asesoresData.filter(function(a) { return String(a.ACTIVO).toLowerCase() === 'si' && a.WHATSAPP; });
  var asesorAsignado = '';
  var asesorNombre = '';
  if (asesoresActivos.length > 0) {
    var totalLeads = Math.max(0, sheet.getLastRow() - 1);
    var idx = totalLeads % asesoresActivos.length;
    asesorAsignado = String(asesoresActivos[idx].WHATSAPP).trim();
    asesorNombre = asesoresActivos[idx].NOMBRE || '';
    // Incrementar contador de leads del asesor
    var asesorRow = asesoresActivos[idx]._rowNum;
    var asesoresSheet = ss.getSheetByName('ASESORES');
    var currentCount = Number(asesoresSheet.getRange(asesorRow, 6).getValue()) || 0;
    asesoresSheet.getRange(asesorRow, 6).setValue(currentCount + 1);
  }

  sheet.appendRow([
    new Date(),
    payload.nombreContacto || '',
    payload.nombreNegocio || '',
    payload.whatsapp || '',
    payload.email || '',
    payload.ciudad || '',
    cant,
    categoria,
    payload.fuente || 'landing',
    'NUEVO', asesorAsignado, '', ''
  ]);

  // Notificacion por email
  var emailDest = config.EMAIL_LEADS || 'iaitelsa@gmail.com';
  var nombreProducto = config.NOMBRE_PRODUCTO || 'BeautyOS';
  try {
    MailApp.sendEmail({
      to: emailDest,
      subject: 'Nuevo Lead ' + nombreProducto + ': ' + (payload.nombreNegocio || 'Sin nombre') + ' - ' + (payload.ciudad || 'Sin ciudad'),
      htmlBody: buildLeadEmailHtml(payload, nombreProducto, categoria)
    });
  } catch (mailErr) {
    Logger.log('[leads] Error enviando email: ' + mailErr.message);
  }

  // Alerta WhatsApp al asesor asignado via Evolution API
  if (asesorAsignado) {
    var alertMsg = '*🔔 Nuevo Lead ' + nombreProducto + '*\n\n'
      + '👤 Contacto: ' + (payload.nombreContacto || 'Sin nombre') + '\n'
      + '💼 Negocio: ' + (payload.nombreNegocio || '') + '\n'
      + '📱 WhatsApp: ' + (payload.whatsapp || '') + '\n'
      + '📍 Ciudad: ' + (payload.ciudad || 'No indicada') + '\n'
      + '👥 Empleados: ' + (cant || 'No indicado') + '\n'
      + '📋 Fuente: ' + (payload.fuente || 'landing') + '\n\n'
      + '✅ *Asignado a ti (' + asesorNombre + ').* Contactalo para cerrar la venta.';
    try {
      enviarWhatsAppEvolution(config, asesorAsignado, alertMsg);
    } catch (waErr) {
      Logger.log('[leads] Error enviando WhatsApp: ' + waErr.message);
    }
  }

  return { success: true, asesorAsignado: asesorAsignado, asesorNombre: asesorNombre };
}

// Envía mensaje WhatsApp via Evolution API al asesor asignado
function enviarWhatsAppEvolution(config, destinatario, mensaje) {
  var evolutionUrl = config.EVOLUTION_API_URL || 'http://136.119.198.196:8080';
  var evolutionApiKey = config.EVOLUTION_API_KEY || '';
  var instanceName = config.EVOLUTION_INSTANCE || 'beautyos-comercial';
  if (!evolutionApiKey) {
    Logger.log('[whatsapp] API Key de Evolution no configurada');
    return;
  }
  var url = evolutionUrl + '/message/sendText/' + instanceName;
  var payload = {
    number: String(destinatario).replace(/\D/g, ''),
    text: mensaje
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'apikey': evolutionApiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(url, options);
  Logger.log('[whatsapp] Respuesta Evolution: ' + response.getContentText().substring(0, 200));
}

// Actualiza estado de un lead buscando por WhatsApp (usado por el agente IA)
function handleUpdateLeadByWhatsapp(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('LEADS');
  if (!sheet) return { error: 'Hoja LEADS no encontrada' };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { error: 'No hay leads' };
  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  var wa = String(payload.whatsapp || '').trim();
  // Buscar la fila más reciente de este WhatsApp
  var foundRow = -1;
  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][3]).trim() === wa) { foundRow = i + 2; break; }
  }
  if (foundRow < 0) return { error: 'Lead no encontrado para WhatsApp: ' + wa };
  // Actualizar estado (col 10) y notas (col 13) — append notas, no reemplazar
  sheet.getRange(foundRow, 10).setValue(payload.estado);
  sheet.getRange(foundRow, 12).setValue(new Date());
  var notasActuales = sheet.getRange(foundRow, 13).getValue() || '';
  var nuevaNota = (notasActuales ? notasActuales + ' | ' : '') + '[IA ' + new Date().toLocaleDateString('es-CO') + '] ' + (payload.notas || '');
  sheet.getRange(foundRow, 13).setValue(nuevaNota);
  return { success: true, row: foundRow, estado: payload.estado };
}

// Actualiza estado, asignado y notas de un lead desde el panel
function updateLead(rowNum, estado, asignado, notas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('LEADS');
  if (!sheet) return { error: 'Hoja LEADS no encontrada' };

  // Col 10=ESTADO, 11=ASIGNADO_A, 12=FECHA_CONTACTO, 13=NOTAS
  sheet.getRange(rowNum, 10).setValue(estado);
  sheet.getRange(rowNum, 11).setValue(asignado);
  sheet.getRange(rowNum, 12).setValue(new Date());
  sheet.getRange(rowNum, 13).setValue(notas);

  return { success: true };
}

// Migra la hoja LEADS para agregar NOMBRE_CONTACTO sin perder datos
function migrateLeadsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('LEADS');
  if (!sheet) return { error: 'Hoja LEADS no encontrada' };

  var currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var hasNombreContacto = currentHeaders.indexOf('NOMBRE_CONTACTO') >= 0;
  if (hasNombreContacto) return { success: true, message: 'La hoja ya tiene NOMBRE_CONTACTO' };

  // Insertar columna B y poner header
  sheet.insertColumnBefore(2);
  sheet.getRange(1, 2).setValue('NOMBRE_CONTACTO').setFontWeight('bold').setBackground('#1B6B6A').setFontColor('white');
  sheet.setColumnWidth(2, 160);

  return { success: true, message: 'Columna NOMBRE_CONTACTO agregada en posicion B' };
}

// ═══════════════════════════════════════════════
// ─── CLIENTES ───
// ═══════════════════════════════════════════════

// Crea un cliente directamente desde el panel (sin necesidad de lead previo)
function crearClienteDirecto(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('CLIENTES');
  if (!sheet) return { error: 'Hoja CLIENTES no encontrada. Ejecuta setupLanding().' };

  var hoy = new Date();
  var seq = sheet.getLastRow();
  var idCliente = 'CLI-' + Utilities.formatDate(hoy, 'America/Bogota', 'yyyyMMdd') + '-' + ('00' + seq).slice(-3);

  // Calcular categoria
  var cant = String(data.cantidadEmpleados || '').trim();
  var categoria = 'Propia empresa';
  if (cant === '2 a 5') categoria = 'Mediano';
  else if (cant === '6 a 10' || cant === '11 o mas') categoria = 'Grande';

  // Calcular precio y fecha de cobro
  var planes = leerTabla(ss, 'PLANES');
  var plan = planes.find(function(p) { return p.ID === data.planActivo; }) || planes[0] || {};
  var precio = data.periodoFacturacion === 'Anual'
    ? (Number(plan.PRECIO_ANUAL) || 160000)
    : (Number(plan.PRECIO_MENSUAL) || 180000);

  var fechaInicio = data.fechaInicioFacturacion ? new Date(data.fechaInicioFacturacion) : hoy;
  var proximoCobro = new Date(fechaInicio);
  if (data.periodoFacturacion === 'Anual') {
    proximoCobro.setFullYear(proximoCobro.getFullYear() + 1);
  } else {
    proximoCobro.setMonth(proximoCobro.getMonth() + 1);
  }

  sheet.appendRow([
    idCliente, hoy,
    data.nombreNegocio || '', data.whatsapp || '', data.email || '',
    data.ciudad || '', cant, categoria,
    data.planActivo || 'completo', data.periodoFacturacion || 'Mensual', precio,
    fechaInicio, proximoCobro, 'VIGENTE',
    data.sheetId || '', data.scriptId || '', data.chatgptApiKey || '',
    data.telefonoBeautyos || '', data.mensajeBienvenida || '', data.notasTecnicas || '',
    'ACTIVO', data.leadRowNum || '', 15,
    data.carpetaGoogleWorkspace || ''
  ]);

  // Si viene de un lead, marcarlo como CLIENTE
  if (data.leadRowNum) {
    var leadsSheet = ss.getSheetByName('LEADS');
    if (leadsSheet) {
      leadsSheet.getRange(data.leadRowNum, 10).setValue('CLIENTE');
      leadsSheet.getRange(data.leadRowNum, 12).setValue(hoy);
    }
  }

  return { success: true, idCliente: idCliente };
}

// Convierte un lead existente en cliente con datos de facturacion y config tecnica
function convertLeadToCliente(leadRowNum, clienteData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var leadsSheet = ss.getSheetByName('LEADS');
  if (!leadsSheet) return { error: 'Hoja LEADS no encontrada' };
  var leadRow = leadsSheet.getRange(leadRowNum, 1, 1, 13).getValues()[0];

  var clientesSheet = ss.getSheetByName('CLIENTES');
  if (!clientesSheet) return { error: 'Hoja CLIENTES no encontrada' };

  // ID unico: CLI-YYYYMMDD-NNN
  var hoy = new Date();
  var seq = clientesSheet.getLastRow(); // row 1 = headers → lastRow = total clientes + 1
  var idCliente = 'CLI-' + Utilities.formatDate(hoy, 'America/Bogota', 'yyyyMMdd') + '-' + ('00' + seq).slice(-3);

  // Calcular fecha de proximo cobro segun periodo
  var fechaInicio = clienteData.fechaInicioFacturacion ? new Date(clienteData.fechaInicioFacturacion) : hoy;
  var proximoCobro = new Date(fechaInicio);
  if (clienteData.periodoFacturacion === 'Anual') {
    proximoCobro.setFullYear(proximoCobro.getFullYear() + 1);
  } else {
    proximoCobro.setMonth(proximoCobro.getMonth() + 1);
  }

  // Precio segun plan seleccionado y periodo
  var planes = leerTabla(ss, 'PLANES');
  var plan = planes.find(function(p) { return p.ID === clienteData.planActivo; }) || planes[0] || {};
  var precio = clienteData.periodoFacturacion === 'Anual'
    ? (Number(plan.PRECIO_ANUAL) || 160000)
    : (Number(plan.PRECIO_MENSUAL) || 180000);

  // leadRow: 0=FECHA, 1=NOMBRE_CONTACTO, 2=NOMBRE_NEGOCIO, 3=WHATSAPP, 4=EMAIL, 5=CIUDAD, 6=CANT_EMPLEADOS, 7=CATEGORIA
  clientesSheet.appendRow([
    idCliente,
    hoy,
    leadRow[2] || clienteData.nombreNegocio || '',
    leadRow[3] || '',
    leadRow[4] || '',
    leadRow[5] || '',
    leadRow[6] || '',
    leadRow[7] || 'Propia empresa',
    clienteData.planActivo || 'completo',
    clienteData.periodoFacturacion || 'Mensual',
    precio,
    fechaInicio,
    proximoCobro,
    'VIGENTE',
    clienteData.sheetId || '',
    clienteData.scriptId || '',
    clienteData.chatgptApiKey || '',
    clienteData.telefonoBeautyos || '',
    clienteData.mensajeBienvenida || '',
    clienteData.notasTecnicas || '',
    'ACTIVO',
    leadRowNum,
    15
  ]);

  // Marcar lead como convertido (col 10=ESTADO, col 12=FECHA_CONTACTO)
  leadsSheet.getRange(leadRowNum, 10).setValue('CLIENTE');
  leadsSheet.getRange(leadRowNum, 12).setValue(hoy);

  return { success: true, idCliente: idCliente };
}

// Actualiza campos editables de un cliente (config tecnica, facturacion)
function updateCliente(rowNum, data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('CLIENTES');
  if (!sheet) return { error: 'Hoja CLIENTES no encontrada' };

  var colMap = {
    PLAN_ACTIVO: 9, PERIODO_FACTURACION: 10, PRECIO_MENSUAL: 11,
    FECHA_INICIO_FACTURACION: 12, FECHA_PROXIMO_COBRO: 13, ESTADO_PAGO: 14,
    SHEET_ID: 15, SCRIPT_ID: 16, CHATGPT_API_KEY: 17,
    TELEFONO_BEAUTYOS: 18, MENSAJE_BIENVENIDA: 19, NOTAS_TECNICAS: 20,
    ESTADO: 21, DIAS_GRACIA: 23
  };

  for (var key in data) {
    if (!colMap[key]) continue;
    var val = data[key];
    if (key === 'FECHA_INICIO_FACTURACION' || key === 'FECHA_PROXIMO_COBRO') {
      val = val ? new Date(val) : '';
    }
    sheet.getRange(rowNum, colMap[key]).setValue(val);
  }

  return { success: true };
}

// Extiende la fecha de proximo cobro de un cliente
function renovarCliente(rowNum, periodo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('CLIENTES');
  if (!sheet) return { error: 'Hoja CLIENTES no encontrada' };

  var fechaActual = sheet.getRange(rowNum, 13).getValue();
  var nuevaFecha = fechaActual ? new Date(fechaActual) : new Date();

  if (periodo === 'Anual') {
    nuevaFecha.setFullYear(nuevaFecha.getFullYear() + 1);
  } else {
    nuevaFecha.setMonth(nuevaFecha.getMonth() + 1);
  }

  sheet.getRange(rowNum, 13).setValue(nuevaFecha);
  sheet.getRange(rowNum, 14).setValue('VIGENTE');

  return { success: true, nuevaFecha: nuevaFecha };
}

// ═══════════════════════════════════════════════
// ─── FACTURACION ───
// ═══════════════════════════════════════════════

// Trigger diario: recalcula estados de pago y auto-suspende clientes en mora
// Estados: VIGENTE → POR_VENCER → VENCIDO → (auto-suspension tras dias de gracia)
function verificarFacturaciones() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('CLIENTES');
  if (!sheet || sheet.getLastRow() < 2) return;

  var config = leerClaveValor(ss, 'CONFIGURACION');
  var diasAlerta = Number(config.DIAS_ALERTA_FACTURACION) || 5;
  var diasGraciaDefault = Number(config.DIAS_GRACIA_DEFAULT) || 15;
  var emailAlertas = config.EMAIL_ALERTAS_FACTURACION || 'iaitelsa@gmail.com';

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var col = {};
  ['ESTADO_PAGO','FECHA_PROXIMO_COBRO','ESTADO','NOMBRE_NEGOCIO','WHATSAPP','DIAS_GRACIA'].forEach(function(h) {
    col[h] = headers.indexOf(h);
  });

  var hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  var alertas = [];

  for (var i = 1; i < data.length; i++) {
    var estadoCliente = String(data[i][col.ESTADO]).toUpperCase();
    if (estadoCliente !== 'ACTIVO') continue;

    var proxCobro = data[i][col.FECHA_PROXIMO_COBRO];
    if (!proxCobro) continue;
    proxCobro = new Date(proxCobro);
    proxCobro.setHours(0, 0, 0, 0);

    var diffDias = Math.floor((proxCobro - hoy) / (1000 * 60 * 60 * 24));
    var diasMora = diffDias < 0 ? Math.abs(diffDias) : 0;
    var diasGracia = Number(data[i][col.DIAS_GRACIA]) || diasGraciaDefault;

    var nuevoEstado = 'VIGENTE';
    if (diffDias < 0) nuevoEstado = 'VENCIDO';
    else if (diffDias <= diasAlerta) nuevoEstado = 'POR_VENCER';

    sheet.getRange(i + 1, col.ESTADO_PAGO + 1).setValue(nuevoEstado);

    // Auto-suspension: si los dias de mora superan los dias de gracia
    if (nuevoEstado === 'VENCIDO' && diasMora >= diasGracia) {
      sheet.getRange(i + 1, col.ESTADO + 1).setValue('SUSPENDIDO');
      nuevoEstado = 'SUSPENDIDO';
    }

    if (nuevoEstado !== 'VIGENTE') {
      alertas.push({
        nombre: data[i][col.NOMBRE_NEGOCIO] || '',
        estado: nuevoEstado,
        dias: diffDias,
        diasMora: diasMora,
        diasGracia: diasGracia,
        whatsapp: data[i][col.WHATSAPP] || ''
      });
    }
  }

  if (alertas.length > 0) {
    try {
      MailApp.sendEmail({
        to: emailAlertas,
        subject: 'BeautyOS - Alertas de facturacion (' + alertas.length + ')',
        htmlBody: buildAlertEmailHtml(alertas)
      });
    } catch (e) {
      Logger.log('[facturacion] Error enviando alertas: ' + e.message);
    }
  }
}

// Registra un pago, renueva la facturacion y reactiva si estaba suspendido
function registrarPago(idCliente, pagoData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Buscar cliente por ID
  var clientesSheet = ss.getSheetByName('CLIENTES');
  if (!clientesSheet) return { error: 'Hoja CLIENTES no encontrada' };
  var clientes = leerTabla(ss, 'CLIENTES');
  var cliente = clientes.find(function(c) { return c.ID_CLIENTE === idCliente; });
  if (!cliente) return { error: 'Cliente no encontrado: ' + idCliente };
  var rowNum = cliente._rowNum;

  // Generar ID de pago
  var pagosSheet = ss.getSheetByName('PAGOS');
  if (!pagosSheet) return { error: 'Hoja PAGOS no encontrada. Ejecuta setupLanding().' };
  var seq = pagosSheet.getLastRow();
  var hoy = new Date();
  var idPago = 'PAG-' + Utilities.formatDate(hoy, 'America/Bogota', 'yyyyMMdd') + '-' + ('00' + seq).slice(-3);

  // Registrar pago
  pagosSheet.appendRow([
    idPago, idCliente, hoy,
    pagoData.monto || '',
    pagoData.periodoCubierto || '',
    pagoData.metodoPago || '',
    pagoData.soporteUrl || '',
    pagoData.notas || ''
  ]);

  // Renovar facturacion
  var periodo = cliente.PERIODO_FACTURACION || 'Mensual';
  var fechaActual = clientesSheet.getRange(rowNum, 13).getValue();
  var nuevaFecha = fechaActual ? new Date(fechaActual) : hoy;
  if (periodo === 'Anual') {
    nuevaFecha.setFullYear(nuevaFecha.getFullYear() + 1);
  } else {
    nuevaFecha.setMonth(nuevaFecha.getMonth() + 1);
  }
  clientesSheet.getRange(rowNum, 13).setValue(nuevaFecha);
  clientesSheet.getRange(rowNum, 14).setValue('VIGENTE');

  // Reactivar si estaba suspendido
  var estadoActual = String(clientesSheet.getRange(rowNum, 21).getValue()).toUpperCase();
  if (estadoActual === 'SUSPENDIDO') {
    clientesSheet.getRange(rowNum, 21).setValue('ACTIVO');
  }

  return { success: true, idPago: idPago, nuevaFecha: nuevaFecha };
}

// Sube soporte de pago a Google Drive y retorna la URL publica
function subirSoportePago(fileName, base64Data, mimeType, idCliente) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = leerClaveValor(ss, 'CONFIGURACION');

  // Obtener o crear carpeta principal
  var folderId = config.CARPETA_SOPORTES_DRIVE;
  var folder;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch(e) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder('BeautyOS - Soportes de Pago');
    var configSheet = ss.getSheetByName('CONFIGURACION');
    if (configSheet) configSheet.appendRow(['CARPETA_SOPORTES_DRIVE', folder.getId()]);
  }

  // Subcarpeta por cliente
  var subFolders = folder.getFoldersByName(idCliente);
  var clientFolder = subFolders.hasNext() ? subFolders.next() : folder.createFolder(idCliente);

  // Decodificar y guardar archivo
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
  var file = clientFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { success: true, url: file.getUrl() };
}

// Retorna historial de pagos de un cliente especifico
function obtenerPagosCliente(idCliente) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pagos = leerTabla(ss, 'PAGOS');
  return pagos.filter(function(p) { return p.ID_CLIENTE === idCliente; }).reverse();
}

// ═══════════════════════════════════════════════
// ─── NOVEDADES (Tickets de soporte tecnico) ───
// ═══════════════════════════════════════════════

// Guarda una novedad reportada por el agente IA via doPost
// El agente envia: action, idCliente, nombreNegocio, whatsapp, tipoNovedad, descripcion, prioridad
function handleSaveNovedad(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('NOVEDADES');
  if (!sheet) return { error: 'Hoja NOVEDADES no encontrada. Ejecuta setupLanding().' };

  var hoy = new Date();
  var seq = sheet.getLastRow();
  var idNovedad = 'NOV-' + Utilities.formatDate(hoy, 'America/Bogota', 'yyyyMMdd') + '-' + ('00' + seq).slice(-3);

  var prioridad = String(payload.prioridad || 'MEDIA').toUpperCase();
  if (['ALTA', 'MEDIA', 'BAJA'].indexOf(prioridad) === -1) prioridad = 'MEDIA';

  sheet.appendRow([
    idNovedad, hoy,
    payload.idCliente || '', payload.nombreNegocio || '', payload.whatsapp || '',
    payload.tipoNovedad || 'Otro',
    payload.descripcion || '',
    prioridad,
    'NUEVO', '', '', ''
  ]);

  // Notificacion por email
  var config = leerClaveValor(ss, 'CONFIGURACION');
  var emailDest = config.EMAIL_ALERTAS_FACTURACION || 'iaitelsa@gmail.com';
  try {
    MailApp.sendEmail({
      to: emailDest,
      subject: 'Novedad tecnica ' + (prioridad === 'ALTA' ? 'URGENTE ' : '') + '- ' + (payload.nombreNegocio || 'Cliente'),
      htmlBody: buildNovedadEmailHtml(payload, idNovedad, prioridad)
    });
  } catch (mailErr) {
    Logger.log('[novedades] Error enviando email: ' + mailErr.message);
  }

  return { success: true, idNovedad: idNovedad };
}

// Actualiza estado y notas de resolucion de una novedad desde el panel
function updateNovedad(rowNum, estado, asignado, notasResolucion) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('NOVEDADES');
  if (!sheet) return { error: 'Hoja NOVEDADES no encontrada' };

  // Col 9=ESTADO, 10=ASIGNADO_A, 11=FECHA_RESOLUCION, 12=NOTAS_RESOLUCION
  sheet.getRange(rowNum, 9).setValue(estado);
  sheet.getRange(rowNum, 10).setValue(asignado);
  if (estado === 'RESUELTO' || estado === 'CERRADO') {
    sheet.getRange(rowNum, 11).setValue(new Date());
  }
  sheet.getRange(rowNum, 12).setValue(notasResolucion);

  return { success: true };
}

// ═══════════════════════════════════════════════
// ─── AGENTE IA COMERCIAL: Datos para sync ───
// ═══════════════════════════════════════════════

// Retorna FAQ, planes, features, condiciones y campaña activa para el agente comercial
function handleGetInfoComercial() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var campanas = [];
  try { campanas = leerTabla(ss, 'CAMPANAS') || []; } catch(e) {}
  var campanaActiva = campanas.find(function(c) { return c.ESTADO === 'ACTIVA'; }) || null;
  return {
    planes: leerTabla(ss, 'PLANES'),
    condiciones: leerClaveValor(ss, 'CONDICIONES'),
    faq: leerTabla(ss, 'FAQ'),
    funcionalidades: leerTabla(ss, 'FUNCIONALIDADES'),
    dolores: leerTabla(ss, 'DOLORES'),
    testimonios: leerTabla(ss, 'TESTIMONIOS'),
    campanaActiva: campanaActiva,
    anunciosActivos: (function() { try { return (leerTabla(ss, 'ANUNCIOS') || []).filter(function(a) { return a.ESTADO === 'ACTIVO' && a.CANAL !== 'landing'; }); } catch(e) { return []; } })()
  };
}

// Retorna clientes con datos de facturacion computados (para deteccion + cartera)
function handleGetClientesCRM() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var clientes = leerTabla(ss, 'CLIENTES');
  var hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  return clientes.map(function(c) {
    var diasMora = 0, diasParaVencer = 999;
    if (c.FECHA_PROXIMO_COBRO) {
      var prox = new Date(c.FECHA_PROXIMO_COBRO);
      prox.setHours(0, 0, 0, 0);
      var diff = Math.floor((prox - hoy) / 86400000);
      diasMora = diff < 0 ? Math.abs(diff) : 0;
      diasParaVencer = diff;
    }
    return {
      whatsapp: c.WHATSAPP || '', nombre: c.NOMBRE_NEGOCIO || '', id: c.ID_CLIENTE || '',
      plan: c.PLAN_ACTIVO || '', periodo: c.PERIODO_FACTURACION || '',
      precio: c.PRECIO_MENSUAL || '', proxCobro: c.FECHA_PROXIMO_COBRO || '',
      estadoPago: c.ESTADO_PAGO || '', estado: c.ESTADO || '',
      diasMora: diasMora, diasParaVencer: diasParaVencer,
      diasGracia: Number(c.DIAS_GRACIA) || 15
    };
  });
}

// ═══════════════════════════════════════════════
// ─── PANEL ADMIN ───
// ═══════════════════════════════════════════════

// Carga todos los datos necesarios para el panel CRM
// Computa _diasMora y _diasParaVencer en cada cliente para las alertas visuales
function getPanelData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = {};
  try { data = getDatosLanding(); } catch(e) { data = {}; }
  try { data.leads = leerTabla(ss, 'LEADS') || []; } catch(e) { data.leads = []; }
  try { data.clientes = leerTabla(ss, 'CLIENTES') || []; } catch(e) { data.clientes = []; }
  try { data.novedades = leerTabla(ss, 'NOVEDADES') || []; } catch(e) { data.novedades = []; }
  try { data.asesores = leerTabla(ss, 'ASESORES') || []; } catch(e) { data.asesores = []; }
  try { data.campanas = leerTabla(ss, 'CAMPANAS') || []; } catch(e) { data.campanas = []; }
  try { data.anuncios = leerTabla(ss, 'ANUNCIOS') || []; } catch(e) { data.anuncios = []; }

  // Computar dias de mora/vencimiento en cada cliente
  var hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  (data.clientes || []).forEach(function(c) {
    if (!c.FECHA_PROXIMO_COBRO) { c._diasMora = 0; c._diasParaVencer = 999; return; }
    var prox = new Date(c.FECHA_PROXIMO_COBRO);
    prox.setHours(0, 0, 0, 0);
    var diff = Math.floor((prox - hoy) / (1000 * 60 * 60 * 24));
    c._diasMora = diff < 0 ? Math.abs(diff) : 0;
    c._diasParaVencer = diff;
  });

  var deployUrl = '';
  try { deployUrl = ScriptApp.getService().getUrl(); } catch(e) {}
  var landingUrl = deployUrl
    ? deployUrl.replace(/\?.*$/, '')
    : 'https://script.google.com/macros/s/AKfycbwtUhZBPQAy2Xh-badiGlIFVvUb1ufd9xCiNxIs1fmA5VsWPod4oV7E5Tbsf6GOVapPFw/exec';

  // Devolver como JSON string para evitar problemas de serialización en google.script.run
  return JSON.stringify({ data: data, landingUrl: landingUrl });
}

// Guarda los cambios del panel en las hojas correspondientes
function savePanelData(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (data.config) guardarClaveValor(ss, 'CONFIGURACION', data.config);
  if (data.condiciones) guardarClaveValor(ss, 'CONDICIONES', data.condiciones);
  if (data.dolores) guardarTabla(ss, 'DOLORES', ['ICONO', 'TITULO', 'DESCRIPCION'], data.dolores);
  if (data.funcionalidades) guardarTabla(ss, 'FUNCIONALIDADES', ['ICONO', 'TITULO', 'DESCRIPCION'], data.funcionalidades);
  if (data.faq) guardarTabla(ss, 'FAQ', ['PREGUNTA', 'RESPUESTA'], data.faq);
  if (data.testimonios) guardarTabla(ss, 'TESTIMONIOS', ['NOMBRE', 'ROL', 'TEXTO', 'ESTRELLAS'], data.testimonios);
  if (data.planes) guardarTabla(ss, 'PLANES', ['ID', 'NOMBRE', 'PRECIO_MENSUAL', 'PRECIO_ANUAL', 'DESCRIPCION', 'POPULAR'], data.planes);
  if (data.asesores && data.asesores.length > 0) {
    guardarTabla(ss, 'ASESORES', ['NOMBRE', 'WHATSAPP', 'EMAIL', 'ROL', 'ACTIVO', 'LEADS_ASIGNADOS'], data.asesores);
    // Sincronizar WHATSAPP_ASESORES en CONFIGURACION para que el bot tenga la lista
    var activos = data.asesores.filter(function(a) { return String(a.ACTIVO).toLowerCase() === 'si' && a.WHATSAPP; });
    var listaWa = activos.map(function(a) { return String(a.WHATSAPP).trim(); }).join(',');
    var configSheet = ss.getSheetByName('CONFIGURACION');
    if (configSheet) {
      var configData = configSheet.getDataRange().getValues();
      for (var i = 0; i < configData.length; i++) {
        if (configData[i][0] === 'WHATSAPP_ASESORES') { configSheet.getRange(i + 1, 2).setValue(listaWa); break; }
      }
    }
  }
  if (data.campanas && data.campanas.length > 0) {
    guardarTabla(ss, 'CAMPANAS', ['ID_CAMPANA', 'NOMBRE', 'ESTADO', 'FECHA_INICIO', 'FECHA_FIN', 'PRECIO_MENSUAL', 'PRECIO_ANUAL', 'IMPLEMENTACION', 'PRIMER_MES_GRATIS', 'META_CLIENTES', 'CLIENTES_ACTUALES', 'CONDICIONES_ESPECIALES', 'MENSAJE_AGENTE', 'CANAL'], data.campanas);
  }
  if (data.anuncios && data.anuncios.length > 0) {
    guardarTabla(ss, 'ANUNCIOS', ['FECHA', 'TITULO', 'TIPO', 'ESTADO', 'CANAL', 'DESCRIPCION', 'MENSAJE_SOFI'], data.anuncios);
  }

  SpreadsheetApp.flush();
  return { success: true };
}

// ═══════════════════════════════════════════════
// ─── EMAIL TEMPLATES ───
// ═══════════════════════════════════════════════

function buildLeadEmailHtml(payload, nombreProducto, categoria) {
  return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">'
    + '<div style="background:#1B6B6A;color:white;padding:20px;border-radius:8px 8px 0 0;">'
    + '<h2 style="margin:0;">Nuevo Lead ' + nombreProducto + '</h2>'
    + '<p style="margin:5px 0 0;opacity:0.9;">' + new Date().toLocaleString('es-CO') + '</p></div>'
    + '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;">'
    + '<h3 style="color:#1B6B6A;border-bottom:2px solid #1B6B6A;padding-bottom:5px;">Datos del Lead</h3>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + emailRow('Negocio / Marca', payload.nombreNegocio)
    + emailRow('WhatsApp', payload.whatsapp)
    + emailRow('Email', payload.email)
    + emailRow('Ciudad', payload.ciudad)
    + emailRow('Empleados', payload.cantidadEmpleados)
    + emailRow('Categoria', categoria)
    + emailRow('Fuente', payload.fuente)
    + '</table></div>'
    + '<div style="background:#f8f6f3;padding:15px;text-align:center;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">'
    + '<p style="margin:0;color:#666;font-size:13px;">Lead capturado desde la landing page de ' + nombreProducto + '</p>'
    + '</div></div>';
}

function buildAlertEmailHtml(alertas) {
  var rows = alertas.map(function(a) {
    var color = a.estado === 'VENCIDO' ? '#ef4444' : '#f59e0b';
    return '<tr>'
      + '<td style="padding:8px;border-bottom:1px solid #f0f0f0;">' + a.nombre + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #f0f0f0;text-align:center;"><span style="background:' + color + ';color:white;padding:2px 8px;border-radius:50px;font-size:12px;">' + a.estado + '</span></td>'
      + '<td style="padding:8px;border-bottom:1px solid #f0f0f0;text-align:center;">' + a.dias + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #f0f0f0;">' + a.whatsapp + '</td></tr>';
  }).join('');

  return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">'
    + '<div style="background:#ef4444;color:white;padding:20px;border-radius:8px 8px 0 0;">'
    + '<h2 style="margin:0;">Alertas de Facturacion BeautyOS</h2>'
    + '<p style="margin:5px 0 0;opacity:0.9;">' + alertas.length + ' cliente(s) requieren atencion</p></div>'
    + '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;">'
    + '<table style="width:100%;border-collapse:collapse;">'
    + '<tr style="background:#f9fafb;"><th style="padding:8px;text-align:left;">Negocio</th><th style="padding:8px;">Estado</th><th style="padding:8px;">Dias</th><th style="padding:8px;">WhatsApp</th></tr>'
    + rows + '</table></div>'
    + '<div style="background:#f8f6f3;padding:15px;text-align:center;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">'
    + '<p style="margin:0;color:#666;font-size:13px;">Ingresa al panel admin para gestionar estos clientes.</p>'
    + '</div></div>';
}

function buildNovedadEmailHtml(payload, idNovedad, prioridad) {
  var colorPri = prioridad === 'ALTA' ? '#ef4444' : (prioridad === 'MEDIA' ? '#f59e0b' : '#3b82f6');
  return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">'
    + '<div style="background:' + colorPri + ';color:white;padding:20px;border-radius:8px 8px 0 0;">'
    + '<h2 style="margin:0;">Novedad Tecnica - ' + prioridad + '</h2>'
    + '<p style="margin:5px 0 0;opacity:0.9;">' + idNovedad + ' | ' + new Date().toLocaleString('es-CO') + '</p></div>'
    + '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;">'
    + '<table style="width:100%;border-collapse:collapse;">'
    + emailRow('Negocio', payload.nombreNegocio)
    + emailRow('WhatsApp', payload.whatsapp)
    + emailRow('Tipo', payload.tipoNovedad)
    + emailRow('Descripcion', payload.descripcion)
    + emailRow('ID Cliente', payload.idCliente)
    + '</table></div>'
    + '<div style="background:#f8f6f3;padding:15px;text-align:center;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">'
    + '<p style="margin:0;color:#666;font-size:13px;">Ingresa al panel admin para gestionar esta novedad.</p>'
    + '</div></div>';
}

// ═══════════════════════════════════════════════
// ─── HELPERS: Lectura/escritura de hojas ───
// ═══════════════════════════════════════════════

// Lee hoja clave-valor (col A=clave, col B=valor). Salta el header.
function leerClaveValor(ss, nombreHoja) {
  var sheet = ss.getSheetByName(nombreHoja);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var data = sheet.getDataRange().getValues();
  var obj = {};
  for (var i = 1; i < data.length; i++) {
    var clave = String(data[i][0]).trim();
    if (clave) obj[clave] = data[i][1];
  }
  return obj;
}

// Lee hoja tipo tabla. Retorna array de objetos con _rowNum para updates directos.
function leerTabla(ss, nombreHoja) {
  var sheet = ss.getSheetByName(nombreHoja);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = { _rowNum: i + 1 };
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  return rows;
}

// Actualiza claves en hoja clave-valor sin borrar las que no vienen en obj
function guardarClaveValor(ss, nombreHoja, obj) {
  var sheet = ss.getSheetByName(nombreHoja);
  if (!sheet) {
    sheet = ss.insertSheet(nombreHoja);
    sheet.getRange(1, 1, 1, 2).setValues([['CLAVE', 'VALOR']]).setFontWeight('bold');
  }
  var lastRow = sheet.getLastRow();
  var existing = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  var map = {};
  for (var i = 0; i < existing.length; i++) {
    map[String(existing[i][0]).trim()] = i;
  }
  for (var key in obj) {
    if (key === '_rowNum' || key === 'CLAVE') continue;
    var val = obj[key] !== undefined && obj[key] !== null ? obj[key] : '';
    if (map.hasOwnProperty(key)) {
      sheet.getRange(map[key] + 2, 2).setValue(val);
    } else {
      sheet.appendRow([key, val]);
    }
  }
}

// Escribe hoja tipo tabla completa (reemplaza todo el contenido)
function guardarTabla(ss, nombreHoja, headers, rows) {
  var sheet = ss.getSheetByName(nombreHoja);
  if (!sheet) sheet = ss.insertSheet(nombreHoja);
  sheet.clear();
  var data = [headers];
  rows.forEach(function(row) {
    data.push(headers.map(function(h) { return row[h] !== undefined ? row[h] : ''; }));
  });
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
}

// Genera una fila HTML para emails de notificacion
function emailRow(label, value) {
  if (!value) return '';
  return '<tr><td style="padding:6px 10px;font-weight:bold;color:#555;width:40%;border-bottom:1px solid #f0f0f0;">' + label + '</td>'
    + '<td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;">' + value + '</td></tr>';
}
