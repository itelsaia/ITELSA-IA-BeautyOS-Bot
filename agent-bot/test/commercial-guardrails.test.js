const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildCommercialPrompt,
    getCommercialToolsForConversation
} = require('../src/services/openai');
const {
    shouldPreservePendingCommercialRegistration
} = require('../src/services/tenants');

test('un lead ya registrado no recibe instrucciones de captura ni la herramienta capturar_lead', () => {
    const userData = {
        estado: 'LEAD_EXISTENTE',
        registroCompleto: true,
        nombre: 'Cris',
        negocio: 'Spa Del amor',
        ciudad: 'Bogotá',
        _empleados: 'Solo yo'
    };
    const prompt = buildCommercialPrompt(
        { nombreAgente: 'Sofi', businessName: 'BeautyOS' },
        userData,
        [],
        [],
        '17/07/2026',
        'viernes',
        'Sí'
    );
    const toolNames = getCommercialToolsForConversation(userData)
        .map(tool => tool.function.name);

    assert.match(prompt, /CONVERSACIÓN POST-REGISTRO/);
    assert.match(prompt, /CERRADA PARA ESTE CONTACTO/);
    assert.doesNotMatch(prompt, /Antes de capturar exige nombre de contacto confirmado/);
    assert.ok(!toolNames.includes('capturar_lead'));
    assert.ok(toolNames.includes('actualizar_estado_lead'));
    assert.ok(toolNames.includes('transferir_asesor'));
});

test('un cache vacío recién después de guardar conserva la sesión comercial', () => {
    const now = Date.now();
    const session = {
        _leadAwaitingCacheConfirmation: true,
        _leadSavedAt: now - 30_000
    };

    assert.equal(shouldPreservePendingCommercialRegistration(session, now), true);
    assert.equal(session._leadMissingAfterGrace, undefined);
});

test('un registro no confirmado solo se reinicia después de dos ausencias fuera de la gracia', () => {
    const expired = Date.now() - (16 * 60 * 1000);
    const session = {
        _leadAwaitingCacheConfirmation: true,
        _leadSavedAt: expired
    };

    assert.equal(shouldPreservePendingCommercialRegistration(session, Date.now()), true);
    assert.equal(shouldPreservePendingCommercialRegistration(session, Date.now()), false);
});
