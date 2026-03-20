// ── Endpoints Express espejo de Backend.gs ──
// Cada google.script.run.method(args) del frontend se convierte en POST /api/method
// El polyfill envia { args: [...] } en el body

const express = require('express');
const router = express.Router();

// Inyectados por server.js al montar las rutas
let excel = null;
let queue = null;

function init(excelService, queueService) {
  excel = excelService;
  queue = queueService;
}

// Helper: extraer args del body (polyfill envia { args: [...] })
function getArgs(req) {
  return (req.body && req.body.args) || [];
}

// ══════════════════════════════════════════
// GETTERS (lectura desde Excel local)
// ══════════════════════════════════════════

router.post('/validatePin', (req, res) => {
  try {
    const args = getArgs(req);
    const result = excel.validatePin(args[0]);
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/getConfiguracion', (req, res) => {
  try {
    res.json(excel.getConfiguracion());
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/getClientes', (req, res) => {
  try {
    res.json(excel.getClientes());
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/getAgenda', (req, res) => {
  try {
    res.json(excel.getAgenda());
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/getServicios', (req, res) => {
  try {
    res.json(excel.getServicios());
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/getColaboradores', (req, res) => {
  try {
    res.json(excel.getColaboradores());
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/getDisponibilidad', (req, res) => {
  try {
    res.json(excel.getDisponibilidad());
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/getFestivosConfig', (req, res) => {
  try {
    res.json(excel.getFestivosConfig());
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ══════════════════════════════════════════
// WRITERS (escriben Excel + encolan para sync)
// ══════════════════════════════════════════

router.post('/saveCliente', async (req, res) => {
  try {
    const args = getArgs(req);
    const data = args[0] || {};
    const result = await excel.saveCliente(data);
    await queue.enqueue('createCliente', {
      celular: data.celular,
      nombre: data.nombre,
      correo: data.correo || '',
      cumple: data.cumple || '',
      direccion: data.direccion || '',
      tipo: data.tipo || 'Nuevo'
    });
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/saveCitaManual', async (req, res) => {
  try {
    const args = getArgs(req);
    const data = args[0] || {};
    const result = await excel.saveCitaManual(data);
    await queue.enqueue('createAgenda', {
      fecha: data.fecha,
      inicio: data.inicio,
      fin: data.fin,
      cliente: data.cliente,
      celularCliente: data.celularCliente || '',
      servicio: data.servicio,
      precio: data.precio || 0,
      profesional: data.profesional || 'Por asignar',
      notas: data.notas || ''
    });
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/updateAgendaStatus', async (req, res) => {
  try {
    const args = getArgs(req);
    const citaId = args[0];
    const nuevoEstado = args[1];
    const result = await excel.updateAgendaStatus(citaId, nuevoEstado);
    await queue.enqueue('updateAgendaStatus', { id: citaId, nuevoEstado: nuevoEstado });
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/toggleClienteExento', async (req, res) => {
  try {
    const args = getArgs(req);
    const celular = args[0];
    const nuevoEstado = args[1];
    const result = await excel.toggleClienteExento(celular, nuevoEstado);
    await queue.enqueue('toggleExentoAnticipo', { celular: celular, exento: nuevoEstado });
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/deleteCita', async (req, res) => {
  try {
    const args = getArgs(req);
    const rowIndex = args[0];
    const result = await excel.deleteCita(rowIndex);
    // No sync — GAS no tiene delete endpoint, se resuelve en el pull
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ══════════════════════════════════════════
// STUBS: features solo disponibles con internet
// ══════════════════════════════════════════

const ONLINE_ONLY_MSG = 'Esta funcion solo esta disponible con conexion a internet';

// Lecturas que retornan vacio
const emptyArrayStubs = [
  'getPromociones', 'getGaleria', 'getNovedades', 'getSolicitudes',
  'getHorarios', 'getBloqueos'
];
emptyArrayStubs.forEach(method => {
  router.post('/' + method, (req, res) => res.json([]));
});

const emptyObjectStubs = [
  'getAnalytics', 'getLandingUrl', 'getDatosLanding', 'getPromoUsage'
];
emptyObjectStubs.forEach(method => {
  router.post('/' + method, (req, res) => res.json(null));
});

// Escrituras que retornan error amigable
const onlineOnlyWriteStubs = [
  'savePromocion', 'deletePromocion', 'activarPromo', 'desactivarPromo',
  'saveGaleriaItem', 'deleteGaleriaItem',
  'saveNovedad', 'cerrarNovedad', 'deleteNovedad',
  'saveSolicitud', 'aprobarSolicitud', 'rechazarSolicitud',
  'saveColaborador',
  'saveServicio',
  'saveConfiguracion',
  'saveHorarios', 'saveBloqueo', 'deleteBloqueo',
  'toggleFestivo', 'guardarHorarioFestivo', 'agregarAnoFestivo',
  'saveLanding', 'updateLandingConfig'
];
onlineOnlyWriteStubs.forEach(method => {
  router.post('/' + method, (req, res) => res.json({ error: ONLINE_ONLY_MSG }));
});

// ══════════════════════════════════════════
// Catch-all: metodos no implementados
// ══════════════════════════════════════════

router.post('/:method', (req, res) => {
  console.warn('[api] Metodo no implementado:', req.params.method);
  res.json(null);
});

module.exports = { router, init };
