/**
 * Validador de Licencia Central / Kill Switch
 * @param {string} status Estado leído desde el Google Sheet
 * @returns {boolean} True si está activo, False si no debe operar
 */
function isValidLicense(status) {
    if (!status) return false;
    return status.toString().trim().toUpperCase() === 'ACTIVO';
}

module.exports = { isValidLicense };
