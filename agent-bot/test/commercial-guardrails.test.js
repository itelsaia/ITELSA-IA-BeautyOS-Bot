const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildCommercialPrompt,
    getCommercialToolsForConversation
} = require('../src/services/openai');
const {
    shouldPreservePendingCommercialRegistration
} = require('../src/services/tenants');
const {
    acceptIncomingMessage,
    enqueueConversationTask,
    resetWebhookGuardsForTests,
    getCommercialNextExpectedField,
    isPositiveCommercialAuthorization,
    isNegativeCommercialAuthorization
} = require('../src/routes/webhook');
const { getAudioFileInfo } = require('../src/services/whisper');

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

test('un webhook duplicado se ignora por message-id', () => {
    resetWebhookGuardsForTests();

    assert.equal(acceptIncomingMessage('beautyos-comercial', 'msg-001', 1_000), true);
    assert.equal(acceptIncomingMessage('beautyos-comercial', 'msg-001', 1_001), false);
    assert.equal(acceptIncomingMessage('beautyos-comercial', 'msg-002', 1_001), true);
});

test('mensajes rápidos del mismo WhatsApp se procesan estrictamente en orden', async () => {
    resetWebhookGuardsForTests();
    const events = [];
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });

    const first = enqueueConversationTask('beautyos-comercial:573001', async () => {
        events.push('inicio-primero');
        await firstGate;
        events.push('fin-primero');
    });
    const second = enqueueConversationTask('beautyos-comercial:573001', async () => {
        events.push('segundo');
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['inicio-primero']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['inicio-primero', 'fin-primero', 'segundo']);
});

test('la máquina comercial conserva el campo pendiente aunque la IA parafrasee su pregunta', () => {
    const session = { estado: 'PROSPECTO', _datosCaptura: {} };
    assert.equal(getCommercialNextExpectedField(session), 'tipoNegocio');

    session._datosCaptura.tipoNegocio = 'Spa / bienestar';
    assert.equal(getCommercialNextExpectedField(session), 'negocio');

    session._datosCaptura.negocio = 'Spa Del amor';
    assert.equal(getCommercialNextExpectedField(session), 'ciudad');

    session._datosCaptura.ciudad = 'Bogotá';
    assert.equal(getCommercialNextExpectedField(session), 'empleados');

    session._datosCaptura.empleados = 'Solo yo';
    assert.equal(getCommercialNextExpectedField(session), 'nombreContacto');

    session._datosCaptura.nombreContacto = 'Cris';
    assert.equal(getCommercialNextExpectedField(session), 'autorizacion');

    session._leadConsentDeclined = true;
    assert.equal(getCommercialNextExpectedField(session), '');
});

test('consentimientos naturales solo se reconocen como respuestas explícitas', () => {
    for (const answer of ['Sí', 'sí claro', 'de acuerdo', 'puedes guardar mis datos', 'acepto', 'ahora sí autorizo']) {
        assert.equal(isPositiveCommercialAuthorization(answer), true, answer);
    }
    for (const answer of ['No', 'prefiero no', 'no autorizo']) {
        assert.equal(isNegativeCommercialAuthorization(answer), true, answer);
    }
    assert.equal(isPositiveCommercialAuthorization('sí, explícame los servicios'), false);
});

test('los audios conservan un formato compatible con Whisper según su MIME', () => {
    assert.deepEqual(getAudioFileInfo('audio/ogg; codecs=opus'), {
        mimeType: 'audio/ogg',
        fileName: 'audio.ogg'
    });
    assert.deepEqual(getAudioFileInfo('audio/mpeg'), {
        mimeType: 'audio/mpeg',
        fileName: 'audio.mp3'
    });
    assert.deepEqual(getAudioFileInfo('audio/mp4'), {
        mimeType: 'audio/mp4',
        fileName: 'audio.m4a'
    });
});
