const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// Schemas de cada hoja (mismos headers que Setup.gs)
const SCHEMAS = {
  CONFIGURACION: ['CLAVE', 'VALOR', 'DESCRIPCION_TECNICA'],
  CLIENTES: ['ID_CLIENTE', 'CELULAR', 'NOMBRE', 'CORREO', 'CUMPLE', 'DIRECCION', 'TIPO', 'REGISTRO', 'EXENTO_ANTICIPO'],
  AGENDA: ['ID', 'FECHA', 'TIPO_DIA', 'INICIO', 'FIN', 'CLIENTE', 'CELULAR_CLIENTE', 'SERVICIO', 'PRECIO', 'PROFESIONAL', 'ESTADO', 'NOTAS', 'EXENTO_ANTICIPO', 'MONTO_ANTICIPO', 'MONTO_PAGADO', 'SALDO_RESTANTE', 'ESTADO_PAGO', 'REF_COMPROBANTE', 'FECHA_PAGO', 'PROMO', 'TIPO_PROMO'],
  CONFIG_SERVICIOS: ['ID_SERVICIO', 'INTENCION', 'RESPUESTA_BASE', 'TIEMPO_SERVICIO', 'CATEGORIA', 'TIPO_SERVICIO', 'ANTICIPO_HABILITADO', 'TIPO_ANTICIPO', 'VALOR_ANTICIPO'],
  COLABORADORES: ['ID_COLABORADOR', 'NOMBRE', 'CELULAR', 'ROL', 'PIN', 'ESTADO', 'COMPETENCIAS'],
  DISPONIBILIDAD: ['TIPO', 'FECHA_DIA', 'HORA_INI', 'HORA_FIN', 'MOTIVO', 'APLICA_A', 'HORARIO', 'CATEGORIA'],
  FESTIVOS_CONFIG: ['ANO', 'FECHA', 'NOMBRE', 'TRABAJA', 'GENERADO_AUTO', 'HORA_INI', 'HORA_FIN'],
  SYNC_QUEUE: ['QUEUE_ID', 'TIMESTAMP', 'ACTION', 'PAYLOAD_JSON', 'STATUS', 'SYNC_TIMESTAMP']
};

// ── Utilidades (port directo de Backend.gs) ──

function horaAMinutos(horaStr) {
  if (!horaStr) return 0;
  var parts = horaStr.toString().split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
}

function normalizarTexto(t) {
  return (t || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function calcularTipoDia(fechaStr) {
  var diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
  var parts = fechaStr.split('/');
  var d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  return diasSemana[d.getDay()];
}

function toStr(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    var dd = String(val.getDate()).padStart(2, '0');
    var mm = String(val.getMonth() + 1).padStart(2, '0');
    var yyyy = val.getFullYear();
    return dd + '/' + mm + '/' + yyyy;
  }
  return val.toString();
}

function nowColombia() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
}

// ── ExcelService ──

class ExcelService {
  constructor(filePath) {
    this.filePath = filePath;
    this.workbook = new ExcelJS.Workbook();
  }

  async init() {
    if (fs.existsSync(this.filePath)) {
      await this.workbook.xlsx.readFile(this.filePath);
      console.log('[excel] Workbook cargado:', this.filePath);
    } else {
      // Crear workbook vacio con todas las hojas
      for (const [name, headers] of Object.entries(SCHEMAS)) {
        const ws = this.workbook.addWorksheet(name);
        ws.addRow(headers);
      }
      await this.save();
      console.log('[excel] Workbook creado:', this.filePath);
    }
  }

  async save() {
    // Atomic write: escribir a temp, luego renombrar
    const tmpPath = this.filePath + '.tmp';
    await this.workbook.xlsx.writeFile(tmpPath);
    fs.renameSync(tmpPath, this.filePath);
  }

  // ── Helper: leer hoja como array de arrays (sin header) ──
  _getSheetRows(sheetName) {
    const ws = this.workbook.getWorksheet(sheetName);
    if (!ws || ws.rowCount <= 1) return [];
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      rows.push({ rowNumber, values: row.values.slice(1) }); // row.values[0] is undefined (1-based)
    });
    return rows;
  }

  // ══════════════════════════════════════════
  // GETTERS (mismos formatos que Backend.gs)
  // ══════════════════════════════════════════

  getConfiguracion() {
    const rows = this._getSheetRows('CONFIGURACION');
    const flat = {};
    const detailed = [];
    rows.forEach(r => {
      const key = toStr(r.values[0]).trim();
      if (key) {
        flat[key] = toStr(r.values[1]);
        detailed.push({ rowIndex: r.rowNumber, clave: key, valor: toStr(r.values[1]), descripcion: toStr(r.values[2]) });
      }
    });
    return { flat, detailed };
  }

  getClientes() {
    return this._getSheetRows('CLIENTES').map(r => ({
      rowIndex: r.rowNumber,
      id: toStr(r.values[0]),
      celular: toStr(r.values[1]),
      nombre: toStr(r.values[2]),
      correo: toStr(r.values[3]),
      cumple: toStr(r.values[4]),
      direccion: toStr(r.values[5]),
      tipo: toStr(r.values[6]),
      registro: toStr(r.values[7]),
      exentoAnticipo: toStr(r.values[8])
    }));
  }

  getAgenda() {
    return this._getSheetRows('AGENDA').map(r => ({
      rowIndex: r.rowNumber,
      id: toStr(r.values[0]),
      fecha: toStr(r.values[1]),
      tipoDia: toStr(r.values[2]),
      inicio: toStr(r.values[3]),
      fin: toStr(r.values[4]),
      cliente: toStr(r.values[5]),
      celularCliente: toStr(r.values[6]),
      servicio: toStr(r.values[7]),
      precio: parseFloat(r.values[8]) || 0,
      profesional: toStr(r.values[9]),
      estado: toStr(r.values[10]),
      notas: toStr(r.values[11]),
      exentoAnticipo: toStr(r.values[12]),
      montoAnticipo: parseFloat(r.values[13]) || 0,
      montoPagado: parseFloat(r.values[14]) || 0,
      saldoRestante: parseFloat(r.values[15]) || 0,
      estadoPago: toStr(r.values[16]),
      refComprobante: toStr(r.values[17]),
      fechaPago: toStr(r.values[18]),
      promo: toStr(r.values[19]),
      tipoPromo: toStr(r.values[20])
    }));
  }

  getServicios() {
    return this._getSheetRows('CONFIG_SERVICIOS').map(r => ({
      rowIndex: r.rowNumber,
      idServicio: toStr(r.values[0]),
      intencion: toStr(r.values[1]),
      respuestaBase: toStr(r.values[2]),
      tiempoServicio: parseInt(r.values[3]) || 0,
      categoria: toStr(r.values[4]),
      tipoServicio: toStr(r.values[5]),
      anticipoHabilitado: toStr(r.values[6] || 'NO'),
      tipoAnticipo: toStr(r.values[7] || 'FIJO'),
      valorAnticipo: parseInt(String(r.values[8] || '0').replace(/[.,]/g, '')) || 0
    }));
  }

  getColaboradores() {
    return this._getSheetRows('COLABORADORES')
      .map(r => ({
        rowIndex: r.rowNumber,
        id: toStr(r.values[0]),
        nombre: toStr(r.values[1]),
        celular: toStr(r.values[2]),
        rol: toStr(r.values[3]),
        estado: toStr(r.values[5]),
        competencias: toStr(r.values[6])
      }))
      .filter(c => c.id !== '');
  }

  getDisponibilidad() {
    return this._getSheetRows('DISPONIBILIDAD').map(r => ({
      rowIndex: r.rowNumber,
      tipo: toStr(r.values[0]),
      fechaDia: toStr(r.values[1]),
      horaIni: toStr(r.values[2]),
      horaFin: toStr(r.values[3]),
      motivo: toStr(r.values[4]),
      aplicaA: toStr(r.values[5]),
      horario: toStr(r.values[6]),
      categoria: toStr(r.values[7])
    }));
  }

  getFestivosConfig() {
    return this._getSheetRows('FESTIVOS_CONFIG').map(r => ({
      rowIndex: r.rowNumber,
      ano: toStr(r.values[0]),
      fecha: toStr(r.values[1]),
      nombre: toStr(r.values[2]),
      trabaja: toStr(r.values[3]),
      generadoAuto: toStr(r.values[4]),
      horaIni: toStr(r.values[5]),
      horaFin: toStr(r.values[6])
    }));
  }

  // ══════════════════════════════════════════
  // AUTH
  // ══════════════════════════════════════════

  validatePin(pin) {
    const pinStr = (pin || '').toString().trim();
    const rows = this._getSheetRows('COLABORADORES');
    for (const r of rows) {
      const estado = toStr(r.values[5]).trim().toUpperCase();
      if (estado !== 'ACTIVO') continue;
      const sheetPin = toStr(r.values[4]).trim();
      if (sheetPin === pinStr) {
        return {
          valid: true,
          id: toStr(r.values[0]),
          nombre: toStr(r.values[1]),
          rol: toStr(r.values[3]).toUpperCase(),
          competencias: toStr(r.values[6])
        };
      }
    }
    return { valid: false };
  }

  // ══════════════════════════════════════════
  // WRITERS
  // ══════════════════════════════════════════

  _getNextId(sheetName, prefix) {
    const rows = this._getSheetRows(sheetName);
    let maxNum = 0;
    for (const r of rows) {
      const id = toStr(r.values[0]);
      if (id.startsWith(prefix)) {
        const num = parseInt(id.replace(prefix, ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
    return prefix + String(maxNum + 1).padStart(3, '0');
  }

  async saveCliente(data) {
    const celular = (data.celular || '').toString().trim();
    const nombre = (data.nombre || '').toString().trim();
    if (!celular || celular.length < 10) throw new Error('Celular obligatorio (min 10 digitos)');
    if (!nombre) throw new Error('Nombre obligatorio');

    // Verificar duplicado
    const clientes = this.getClientes();
    if (clientes.find(c => c.celular === celular)) {
      throw new Error('Ya existe un cliente con ese celular');
    }

    const newId = this._getNextId('CLIENTES', 'CLI-');
    const now = nowColombia();
    const registro = String(now.getDate()).padStart(2, '0') + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + now.getFullYear() + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    const ws = this.workbook.getWorksheet('CLIENTES');
    ws.addRow([newId, celular, nombre, data.correo || '', data.cumple || '', data.direccion || '', data.tipo || 'Nuevo', registro, 'NO']);
    await this.save();

    return { status: 'Cliente creado exitosamente', id: newId };
  }

  async saveCitaManual(data) {
    const fecha = (data.fecha || '').toString().trim();
    const inicio = (data.inicio || '').toString().trim();
    const fin = (data.fin || '').toString().trim();
    const cliente = (data.cliente || '').toString().trim();
    const servicio = (data.servicio || '').toString().trim();
    const profesional = (data.profesional || '').toString().trim();

    if (!fecha || !inicio || !fin) throw new Error('Fecha, inicio y fin son obligatorios');
    if (!cliente) throw new Error('Cliente obligatorio');
    if (!servicio) throw new Error('Servicio obligatorio');

    // Validar disponibilidad
    this.validarDisponibilidad(fecha, inicio, fin, profesional, null);

    const tipoDia = calcularTipoDia(fecha);
    const clienteNombre = cliente;
    const initials = clienteNombre.split(' ').map(w => w.charAt(0).toUpperCase()).join('').substring(0, 2) || 'XX';
    const newId = this._getNextId('AGENDA', 'AG-' + initials + '-');

    // Buscar si cliente es exento
    const clientes = this.getClientes();
    const cli = clientes.find(c => c.celular === (data.celularCliente || ''));
    const exento = (cli && cli.exentoAnticipo === 'SI') ? 'SI' : (data.exentoAnticipo || 'NO');

    const ws = this.workbook.getWorksheet('AGENDA');
    ws.addRow([
      newId, fecha, tipoDia, inicio, fin,
      cliente, data.celularCliente || '', servicio, parseFloat(data.precio) || 0, profesional,
      'PENDIENTE', data.notas || '', exento, 0, 0, 0, '', '', '', '', ''
    ]);
    await this.save();

    return { status: 'Cita agendada exitosamente', id: newId };
  }

  async updateAgendaStatus(citaId, nuevoEstado) {
    const ws = this.workbook.getWorksheet('AGENDA');
    let found = false;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      if (toStr(row.values[1]) === citaId) { // col A = index 1 en ExcelJS (1-based)
        row.getCell(11).value = nuevoEstado; // col K = ESTADO
        found = true;
      }
    });
    if (!found) throw new Error('Cita no encontrada: ' + citaId);
    await this.save();
    return { status: 'ok' };
  }

  async toggleClienteExento(celular, nuevoEstado) {
    const ws = this.workbook.getWorksheet('CLIENTES');
    let found = false;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      if (toStr(row.values[2]) === celular) { // col B = CELULAR
        row.getCell(9).value = nuevoEstado; // col I = EXENTO_ANTICIPO
        found = true;
      }
    });
    if (!found) throw new Error('Cliente no encontrado: ' + celular);
    await this.save();
    return { status: 'ok' };
  }

  async deleteCita(rowIndex) {
    const ws = this.workbook.getWorksheet('AGENDA');
    const row = ws.getRow(rowIndex);
    if (!row) throw new Error('Fila no encontrada');
    const estado = toStr(row.values[11]); // col K
    if (estado === 'PENDIENTE' || estado === 'REAGENDADO') {
      throw new Error('No se pueden eliminar citas pendientes o reagendadas');
    }
    ws.spliceRows(rowIndex, 1);
    await this.save();
    return { status: 'ok' };
  }

  // ══════════════════════════════════════════
  // VALIDACION DE DISPONIBILIDAD
  // (port directo de Backend.gs lineas 1233-1451)
  // ══════════════════════════════════════════

  validarDisponibilidad(fechaStr, horaIni, horaFin, profesional, excludeAgendaId) {
    const disponibilidad = this.getDisponibilidad();
    const festivos = this.getFestivosConfig();
    const agenda = this.getAgenda();

    if (disponibilidad.length === 0) return; // sin datos, permitir todo

    const diaSemana = calcularTipoDia(fechaStr);
    const citaIni = horaAMinutos(horaIni);
    const citaFin = horaAMinutos(horaFin);

    // 1. Verificar festivo
    const festivo = festivos.find(f => f.fecha === fechaStr);
    if (festivo && normalizarTexto(festivo.trabaja) !== 'si') {
      throw new Error('El negocio no atiende el ' + fechaStr + ' (' + festivo.nombre + '). Por favor elige otro dia.');
    }

    // 2. Verificar jornada del dia
    const jornadas = disponibilidad.filter(d =>
      d.tipo === 'Jornada' && normalizarTexto(d.fechaDia) === normalizarTexto(diaSemana)
    );

    if (jornadas.length === 0) {
      throw new Error('El negocio no atiende los dias ' + diaSemana + '. Por favor elige otro dia.');
    }

    // Si es festivo con horario especial, usar ese horario
    let jornadaIni, jornadaFin;
    if (festivo && festivo.trabaja === 'SI' && festivo.horaIni && festivo.horaFin) {
      jornadaIni = horaAMinutos(festivo.horaIni);
      jornadaFin = horaAMinutos(festivo.horaFin);
    } else {
      jornadaIni = horaAMinutos(jornadas[0].horaIni);
      jornadaFin = horaAMinutos(jornadas[0].horaFin);
    }

    if (citaIni < jornadaIni || citaFin > jornadaFin) {
      throw new Error('La cita esta fuera del horario de atencion. Horario de ' + diaSemana + ': ' + jornadas[0].horaIni + '-' + jornadas[0].horaFin);
    }

    // 3. Verificar bloqueos
    const bloqueos = disponibilidad.filter(d => d.tipo === 'Bloqueo');
    for (const blq of bloqueos) {
      // Filtrar por profesional
      if (profesional && profesional !== 'Por asignar' && blq.aplicaA !== 'TODOS') {
        if (normalizarTexto(blq.aplicaA) !== normalizarTexto(profesional)) continue;
      }

      let aplica = false;
      const horario = (blq.horario || '').toString().trim();

      if (horario === 'DIARIO') {
        aplica = normalizarTexto(blq.fechaDia) === normalizarTexto(diaSemana);
      } else if (horario === 'UNICO') {
        aplica = blq.fechaDia === fechaStr;
      } else if (horario.startsWith('RANGO:')) {
        const fechaFinRango = horario.replace('RANGO:', '');
        const partsIni = blq.fechaDia.split('/');
        const partsFin = fechaFinRango.split('/');
        const partsCita = fechaStr.split('/');
        const dIni = new Date(partsIni[2], partsIni[1] - 1, partsIni[0]);
        const dFin = new Date(partsFin[2], partsFin[1] - 1, partsFin[0]);
        const dCita = new Date(partsCita[2], partsCita[1] - 1, partsCita[0]);
        aplica = dCita >= dIni && dCita <= dFin;
      }

      if (!aplica) continue;

      const blqIni = horaAMinutos(blq.horaIni);
      const blqFin = horaAMinutos(blq.horaFin);
      if (citaIni < blqFin && citaFin > blqIni) {
        throw new Error('Horario bloqueado de ' + blq.horaIni + ' a ' + blq.horaFin + ' (' + blq.motivo + '). Por favor elige otra hora.');
      }
    }

    // 4. Verificar conflictos con citas del mismo profesional
    if (profesional && profesional !== 'Por asignar') {
      for (const cita of agenda) {
        if (excludeAgendaId && cita.id === excludeAgendaId) continue;
        if (cita.estado !== 'PENDIENTE' && cita.estado !== 'REAGENDADO') continue;
        if (cita.fecha !== fechaStr) continue;
        if (normalizarTexto(cita.profesional) !== normalizarTexto(profesional)) continue;

        const existIni = horaAMinutos(cita.inicio);
        const existFin = horaAMinutos(cita.fin);
        if (citaIni < existFin && citaFin > existIni) {
          throw new Error(profesional + ' ya tiene una cita de ' + cita.inicio + ' a ' + cita.fin + ' en esa fecha. Por favor elige otra hora u otro profesional.');
        }
      }
    }
  }

  // ══════════════════════════════════════════
  // BULK (para sync)
  // ══════════════════════════════════════════

  async replaceSheet(sheetName, headers, dataRows) {
    let ws = this.workbook.getWorksheet(sheetName);
    if (ws) {
      this.workbook.removeWorksheet(ws.id);
    }
    ws = this.workbook.addWorksheet(sheetName);
    ws.addRow(headers);
    for (const row of dataRows) {
      ws.addRow(row);
    }
    // No save here — caller should batch saves
  }
}

module.exports = { ExcelService, horaAMinutos, calcularTipoDia, normalizarTexto };
