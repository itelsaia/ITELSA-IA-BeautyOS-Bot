/**
 * Backend.gs
 * Lógica principal del servidor de Apps Script.
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('ITELSA BeautyOS CRM')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  // Lógica de posts si se requiere
}
