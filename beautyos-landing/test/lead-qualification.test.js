const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function createLeadSheet() {
  const rows = [[
    'FECHA', 'NOMBRE_CONTACTO', 'NOMBRE_NEGOCIO', 'WHATSAPP', 'EMAIL',
    'CIUDAD', 'CANTIDAD_EMPLEADOS', 'CATEGORIA', 'FUENTE', 'ESTADO',
    'ASIGNADO_A', 'FECHA_CONTACTO', 'NOTAS', 'AUTORIZA_DATOS',
  ]];

  function range(row, column, rowCount = 1, columnCount = 1) {
    return {
      getValues() {
        return Array.from({ length: rowCount }, (_, rowOffset) =>
          Array.from({ length: columnCount }, (_, columnOffset) =>
            rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? '',
          ),
        );
      },
      getValue() {
        return rows[row - 1]?.[column - 1] ?? '';
      },
      setValue(value) {
        if (!rows[row - 1]) rows[row - 1] = [];
        rows[row - 1][column - 1] = value;
        return this;
      },
      setFontWeight() { return this; },
      setBackground() { return this; },
      setFontColor() { return this; },
    };
  }

  return {
    rows,
    getLastColumn() { return rows[0].length; },
    getLastRow() { return rows.length; },
    getRange: range,
    insertColumnBefore(column) {
      rows.forEach((row) => row.splice(column - 1, 0, ''));
    },
    insertColumnAfter(column) {
      rows.forEach((row) => row.splice(column, 0, ''));
    },
    setColumnWidth() {},
    appendRow(values) { rows.push(values.slice()); },
  };
}

function loadBackend(sheet) {
  const spreadsheet = {
    getSheetByName(name) { return name === 'LEADS' ? sheet : null; },
  };
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }),
    },
    Utilities: {
      formatDate: () => '7/22/2026 10:00:00',
    },
    MailApp: { sendEmail() {} },
    Logger: { log() {} },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => '' }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: () => ({ setMimeType() { return this; } }),
    },
  };
  vm.createContext(context);
  vm.runInContext(read('src/Backend.gs'), context);
  context.leerClaveValor = () => ({});
  context.leerTabla = () => [];
  return context;
}

function validPayload(overrides = {}) {
  return {
    nombreContacto: 'Laura Gómez',
    nombreNegocio: 'Aura Spa',
    whatsapp: '573101234567',
    email: '',
    ciudad: 'Bogotá',
    cantidadEmpleados: '2 a 5',
    necesidadPrincipal: 'Agenda y citas',
    fuente: 'landing-hostinger',
    notas: 'Tipo de negocio: Spa',
    autorizaDatos: 'SI',
    ...overrides,
  };
}

test('el formulario, PHP y CRM comparten los dos campos de calificación', () => {
  for (const htmlPath of ['src/index.html', 'hostinger/beautyos/index.html']) {
    const html = read(htmlPath);
    assert.match(html, /name="cantidadEmpleados"/);
    assert.match(html, /cantidadEmpleados:\s*data\.get\("cantidadEmpleados"\)/);
    assert.match(html, /name="necesidadPrincipal"/);
  }

  const php = read('hostinger/beautyos/api/lead.php');
  assert.match(php, /\$input\['cantidadEmpleados'\]/);
  assert.match(php, /'cantidadEmpleados'\s*=>\s*\$cantidadEmpleados/);

  const panel = read('src/panel.html');
  assert.match(panel, /NECESIDAD_PRINCIPAL/);
  assert.match(panel, /CANTIDAD_EMPLEADOS/);
});

test('GAS crea NECESIDAD_PRINCIPAL y persiste ambos valores', () => {
  const sheet = createLeadSheet();
  const backend = loadBackend(sheet);

  const result = backend.handleSaveLead(validPayload());

  assert.equal(result.success, true);
  assert.equal(sheet.rows[0][14], 'NECESIDAD_PRINCIPAL');
  assert.equal(sheet.rows[1][6], '2 a 5');
  assert.equal(sheet.rows[1][14], 'Agenda y citas');
});

test('la migración antigua recupera AUTORIZA_DATOS antes de la necesidad', () => {
  const sheet = createLeadSheet();
  sheet.rows[0].pop();
  const backend = loadBackend(sheet);

  const columns = backend.ensureLeadQualificationColumns_(sheet);

  assert.equal(columns.autorizaDatos, 14);
  assert.equal(columns.necesidadPrincipal, 15);
  assert.equal(sheet.rows[0][13], 'AUTORIZA_DATOS');
  assert.equal(sheet.rows[0][14], 'NECESIDAD_PRINCIPAL');
});

test('un WhatsApp duplicado completa la calificación sin crear otra fila', () => {
  const sheet = createLeadSheet();
  const backend = loadBackend(sheet);
  backend.handleSaveLead(validPayload({ cantidadEmpleados: '', necesidadPrincipal: '' }));

  const result = backend.handleSaveLead(validPayload({
    cantidadEmpleados: '6 a 10',
    necesidadPrincipal: 'Ventas y marketing',
  }));

  assert.equal(result.duplicado, true);
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[1][6], '6 a 10');
  assert.equal(sheet.rows[1][14], 'Ventas y marketing');
});
