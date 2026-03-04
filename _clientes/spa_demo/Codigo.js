/**
 * Archivo Principal de Cliente (Wrapper)
 * Este archivo simplemente expone las funciones de la Biblioteca CORE (BEAUTY_CORE_MASTER)
 * para que la Web App local del cliente pueda servir el contenido.
 */

function doGet(e) {
  // Asegúrate de requerir cargar la biblioteca en el dashboard del editor GAS
  // Llama a la funcion doGet del CORE
  return BEAUTY_CORE_MASTER.doGet(e);
}

function doPost(e) {
  return BEAUTY_CORE_MASTER.doPost(e);
}

// Expone las utilidades llamadas mediante google.script.run desde el frontend local
function obtenerConfig() {
  return BEAUTY_CORE_MASTER.obtenerConfig();
}

function guardarConfig(datos) {
  return BEAUTY_CORE_MASTER.guardarConfig(datos);
}

function obtenerBaseConocimiento() {
  return BEAUTY_CORE_MASTER.obtenerBaseConocimiento();
}

function guardarBaseConocimiento(datos) {
  return BEAUTY_CORE_MASTER.guardarBaseConocimiento(datos);
}
