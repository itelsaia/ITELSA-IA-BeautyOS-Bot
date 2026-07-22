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
    getCommercialAwaitingField,
    setCommercialAwaitingField,
    getCommercialCaptureQuestion,
    updateCommercialCaptureDraft,
    isLikelyCommercialQuestion,
    isPlausibleCommercialBusinessName,
    isPlausibleCommercialCity,
    detectCommercialTeamSize,
    detectCommercialBusinessType,
    detectCommercialNeed,
    isPositiveCommercialAuthorization,
    isNegativeCommercialAuthorization,
    isExplicitCommercialAuthorizationReopen
} = require('../src/routes/webhook');
const { getAudioFileInfo } = require('../src/services/whisper');

function buildPrompt(userData, incomingMessage = '', knowledgeCatalog = []) {
    return buildCommercialPrompt(
        { nombreAgente: 'Sofi', businessName: 'BeautyOS' },
        userData,
        knowledgeCatalog,
        [],
        '17/07/2026',
        'viernes',
        incomingMessage
    );
}

function processCaptureTurn(session, message) {
    const result = updateCommercialCaptureDraft(session, message);
    if (result.directReply) {
        setCommercialAwaitingField(session, result.requiredField);
    }
    return result;
}

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

test('solo un cliente identificado puede usar las herramientas de soporte y cartera', () => {
    const prospectTools = getCommercialToolsForConversation({ estado: 'PROSPECTO' })
        .map(tool => tool.function.name);
    assert.equal(prospectTools.includes('reportar_novedad'), false);
    assert.equal(prospectTools.includes('consultar_estado_cuenta'), false);
    assert.equal(prospectTools.includes('registrar_compromiso_pago'), false);

    const clientTools = getCommercialToolsForConversation({
        estado: 'CLIENTE_EXISTENTE',
        idCliente: 'CLI-001'
    }).map(tool => tool.function.name);
    assert.equal(clientTools.includes('reportar_novedad'), true);
    assert.equal(clientTools.includes('consultar_estado_cuenta'), true);
    assert.equal(clientTools.includes('registrar_compromiso_pago'), true);
});

test('la herramienta de Sofi usa los mismos catálogos y campos obligatorios de la landing', () => {
    const captureTool = getCommercialToolsForConversation({ estado: 'PROSPECTO' })
        .find(tool => tool.function.name === 'capturar_lead');
    const parameters = captureTool.function.parameters;

    assert.deepEqual(parameters.properties.tipoNegocio.enum, [
        'Salón de belleza', 'Spa o centro de bienestar', 'Centro estético', 'Barbería',
        'Estudio de uñas', 'Estudio de cejas y pestañas', 'Profesional independiente', 'Otro negocio de belleza'
    ]);
    assert.deepEqual(parameters.properties.necesidadPrincipal.enum, [
        'Agenda y citas', 'Agente virtual para WhatsApp', 'Seguimiento de clientes',
        'Ventas y marketing', 'Inventario y operación', 'Organización general'
    ]);
    assert.ok(parameters.required.includes('tipoNegocio'));
    assert.ok(parameters.required.includes('necesidadPrincipal'));
});

test('un sí ambiguo no se trata como autorización mientras falta el nombre comercial', () => {
    const prompt = buildPrompt({
        estado: 'PROSPECTO',
        nombre: 'Cris',
        _tipoNegocio: 'Spa o centro de bienestar'
    }, 'sí');

    assert.match(prompt, /Pregunta objetivo: "¡Perfecto! ¿Cómo se llama tu negocio o marca\?"/);
    assert.match(prompt, /cuentan como autorización solo si la pregunta anterior fue esa autorización/i);
    assert.doesNotMatch(prompt, /La autorización expresa ya fue recibida en este mensaje/);
});

test('una pregunta de producto durante la captura se responde antes de retomar solo el dato pendiente', () => {
    const prompt = buildPrompt({
        estado: 'PROSPECTO',
        nombre: 'Cris',
        _tipoNegocio: 'Spa o centro de bienestar',
        _negocio: 'Spa Del Amor'
    }, '¿Cómo funcionan los servicios?', [{
        intent: 'servicios',
        response: 'Puedes crear servicios, precios, duraciones y asignarlos a profesionales.'
    }]);

    assert.match(prompt, /servicios: Puedes crear servicios, precios, duraciones/i);
    assert.match(prompt, /Si el prospecto hace una pregunta concreta sobre precio, funciones, implementación o uso, respóndela primero/i);
    assert.match(prompt, /Después retoma únicamente la pregunta objetivo de la guía/i);
    assert.match(prompt, /Pregunta objetivo: "Spa Del Amor, ¿en qué ciudad atiendes\?"/);
});

test('un lead registrado que pide corregir un dato no vuelve al flujo de captura', () => {
    const userData = {
        estado: 'LEAD_EXISTENTE',
        registroCompleto: true,
        nombre: 'Cris',
        negocio: 'Spa Del Amor',
        ciudad: 'Bogotá',
        _empleados: 'Solo yo'
    };
    const prompt = buildPrompt(userData, 'La ciudad correcta es Medellín.');
    const toolNames = getCommercialToolsForConversation(userData)
        .map(tool => tool.function.name);

    assert.match(prompt, /Si pide corregir un dato ya guardado, no reabras la captura/i);
    assert.match(prompt, /CERRADA PARA ESTE CONTACTO/);
    assert.ok(!toolNames.includes('capturar_lead'));
});

test('un cache vacío recién después de guardar conserva la sesión comercial', () => {
    const now = Date.now();
    const session = {
        estado: 'LEAD_EXISTENTE',
        _commercialRegistrationComplete: true,
        _leadCapturado: 'Spa Del Amor',
        _leadAwaitingCacheConfirmation: true,
        _leadSavedAt: now - 30_000,
        _datosCaptura: { negocio: 'Spa Del Amor', ciudad: 'Bogotá' }
    };

    assert.equal(shouldPreservePendingCommercialRegistration(session, now), true);
    assert.equal(session._leadMissingAfterGrace, undefined);
    assert.equal(session.estado, 'LEAD_EXISTENTE');
    assert.equal(session._commercialRegistrationComplete, true);
    assert.equal(session._leadCapturado, 'Spa Del Amor');
    assert.deepEqual(session._datosCaptura, { negocio: 'Spa Del Amor', ciudad: 'Bogotá' });
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

    session._datosCaptura.tipoNegocio = 'Spa o centro de bienestar';
    assert.equal(getCommercialNextExpectedField(session), 'negocio');

    session._datosCaptura.negocio = 'Spa Del amor';
    assert.equal(getCommercialNextExpectedField(session), 'ciudad');

    session._datosCaptura.ciudad = 'Bogotá';
    assert.equal(getCommercialNextExpectedField(session), 'empleados');

    session._datosCaptura.empleados = 'Solo yo';
    assert.equal(getCommercialNextExpectedField(session), 'necesidad');

    session._datosCaptura.necesidadPrincipal = 'Agenda y citas';
    assert.equal(getCommercialNextExpectedField(session), 'nombreContacto');

    session._datosCaptura.nombreContacto = 'Cris';
    assert.equal(getCommercialNextExpectedField(session), 'autorizacion');

    session._leadConsentDeclined = true;
    assert.equal(getCommercialNextExpectedField(session), '');
});

test('un dato faltante no interpreta respuestas breves si el servidor no hizo esa pregunta', () => {
    const session = { estado: 'PROSPECTO', history: [], _datosCaptura: {} };

    const first = processCaptureTurn(session, 'Spa');
    assert.equal(first.requiredField, 'tipoNegocio');
    assert.equal(session._datosCaptura.tipoNegocio, undefined);
    assert.match(first.directReply, /1\. Salón de belleza[\s\S]*8\. Otro negocio de belleza/i);
    assert.equal(getCommercialAwaitingField(session), 'tipoNegocio');

    const accepted = processCaptureTurn(session, 'Spa');
    assert.equal(accepted.changes.tipoNegocio, 'Spa o centro de bienestar');
    assert.equal(session._datosCaptura.tipoNegocio, 'Spa o centro de bienestar');
    assert.equal(getCommercialAwaitingField(session), 'negocio');
});

test('Sofi normaliza opciones numéricas con los mismos catálogos de la landing', () => {
    assert.equal(detectCommercialBusinessType('2', true), 'Spa o centro de bienestar');
    assert.equal(detectCommercialBusinessType('estudio de uñas', true), 'Estudio de uñas');
    assert.equal(detectCommercialNeed('2', true), 'Agente virtual para WhatsApp');
    assert.equal(detectCommercialNeed('Quiero mejorar ventas y marketing', true), 'Ventas y marketing');

    const session = {
        estado: 'PROSPECTO',
        history: [],
        _commercialAwaitingField: 'necesidad',
        _datosCaptura: {
            tipoNegocio: 'Spa o centro de bienestar',
            negocio: 'Aura Spa',
            ciudad: 'Bogotá',
            empleados: '2 a 5'
        }
    };
    const result = processCaptureTurn(session, '3');
    assert.equal(result.changes.necesidadPrincipal, 'Seguimiento de clientes');
    assert.equal(session._datosCaptura.necesidadPrincipal, 'Seguimiento de clientes');
    assert.equal(result.requiredField, 'nombreContacto');
});

test('una duda de producto, incluso sin signos, no se guarda como ciudad ni tipo de negocio', () => {
    const citySession = {
        estado: 'PROSPECTO',
        history: [],
        _commercialAwaitingField: 'ciudad',
        _datosCaptura: { tipoNegocio: 'Spa o centro de bienestar', negocio: 'Spa Del Amor' }
    };
    const cityResult = updateCommercialCaptureDraft(citySession, 'El funcionamiento de los servicios');

    assert.equal(isLikelyCommercialQuestion('El funcionamiento de los servicios'), true);
    assert.equal(cityResult.inputKind, 'product_question');
    assert.equal(citySession._datosCaptura.ciudad, undefined);
    assert.equal(cityResult.blockLeadCapture, true);
    assert.match(cityResult.resumeQuestion, /ciudad o municipio/i);

    const interestSession = {
        estado: 'PROSPECTO',
        history: [],
        _commercialAwaitingField: 'ciudad',
        _datosCaptura: { tipoNegocio: 'Spa o centro de bienestar', negocio: 'Spa Del Amor' }
    };
    const interestResult = updateCommercialCaptureDraft(interestSession, 'Me interesa');
    assert.equal(interestResult.inputKind, 'product_question');
    assert.equal(interestSession._datosCaptura.ciudad, undefined);

    const typeSession = {
        estado: 'PROSPECTO',
        history: [],
        _commercialAwaitingField: 'tipoNegocio',
        _datosCaptura: {}
    };
    const typeResult = updateCommercialCaptureDraft(typeSession, '¿Cómo funcionan las cejas?');
    assert.equal(typeResult.inputKind, 'product_question');
    assert.equal(typeSession._datosCaptura.tipoNegocio, undefined);
});

test('las respuestas ambiguas conservan el campo y generan una pregunta cerrada', () => {
    const session = {
        estado: 'PROSPECTO',
        history: [],
        _commercialAwaitingField: 'empleados',
        _datosCaptura: {
            tipoNegocio: 'Spa o centro de bienestar',
            negocio: 'Spa Del Amor',
            ciudad: 'Bogotá'
        }
    };
    const ambiguous = processCaptureTurn(session, 'Tengo 2 dudas');

    assert.equal(detectCommercialTeamSize('Tengo 2 dudas', true), '');
    assert.equal(ambiguous.inputKind, 'ambiguous');
    assert.equal(session._datosCaptura.empleados, undefined);
    assert.equal(getCommercialAwaitingField(session), 'empleados');
    assert.match(ambiguous.directReply, /solo tú, son 2 a 5, 6 a 10 o 11 o más/i);

    const accepted = processCaptureTurn(session, 'Yo solita');
    assert.equal(accepted.changes.empleados, 'Solo yo');
    assert.equal(session._datosCaptura.empleados, 'Solo yo');
});

test('acepta expresiones colombianas claras sin inventar los datos', () => {
    const session = { estado: 'PROSPECTO', history: [], _datosCaptura: {} };

    processCaptureTurn(session, 'Hola');
    processCaptureTurn(session, 'Tengo una pelu');
    processCaptureTurn(session, "Se llama K'Bella Studio 54");
    processCaptureTurn(session, 'Atiendo en Bogotá, Colombia');
    processCaptureTurn(session, 'Yo solita');
    processCaptureTurn(session, 'Quiero mejorar la agenda y las citas');
    processCaptureTurn(session, 'Me dicen Cris');

    assert.deepEqual(session._datosCaptura, {
        tipoNegocio: 'Salón de belleza',
        negocio: "K'Bella Studio 54",
        ciudad: 'Bogotá',
        empleados: 'Solo yo',
        necesidadPrincipal: 'Agenda y citas',
        nombreContacto: 'Cris'
    });
    assert.equal(getCommercialAwaitingField(session), 'autorizacion');
    assert.match(getCommercialCaptureQuestion('autorizacion', session._datosCaptura), /sí, autorizo/i);
    assert.equal(isPlausibleCommercialBusinessName('Tengo una duda'), false);
    assert.equal(isPlausibleCommercialCity('en el barrio Kennedy'), false);
    assert.equal(isPlausibleCommercialCity('No sé todavía'), false);
});

test('consentimiento solo se acepta en la pregunta exacta y conserva el borrador si es coloquial ambiguo', () => {
    const draft = {
        tipoNegocio: 'Spa o centro de bienestar',
        negocio: 'Spa Del Amor',
        ciudad: 'Bogotá',
        empleados: 'Solo yo',
        necesidadPrincipal: 'Agenda y citas',
        nombreContacto: 'Cris'
    };
    const session = {
        estado: 'PROSPECTO',
        history: [],
        _commercialAwaitingField: 'autorizacion',
        _datosCaptura: { ...draft }
    };

    const ambiguous = processCaptureTurn(session, 'De una');
    assert.equal(ambiguous.inputKind, 'ambiguous');
    assert.equal(session._datosCaptura.autorizaDatos, undefined);
    assert.match(ambiguous.directReply, /sí, autorizo/i);

    const accepted = updateCommercialCaptureDraft(session, 'Sí autorizo');
    assert.equal(accepted.inputKind, 'authorization');
    assert.equal(session._datosCaptura.autorizaDatos, 'SI');

    const declined = {
        estado: 'PROSPECTO',
        history: [],
        _leadConsentDeclined: true,
        _datosCaptura: { ...draft }
    };
    assert.equal(isExplicitCommercialAuthorizationReopen('sí'), false);
    updateCommercialCaptureDraft(declined, 'Sí');
    assert.equal(declined._datosCaptura.autorizaDatos, undefined);
    const reopened = updateCommercialCaptureDraft(declined, 'Sí autorizo');
    assert.equal(reopened.inputKind, 'authorization');
    assert.equal(declined._datosCaptura.autorizaDatos, 'SI');
});

test('una corrección explícita antes de guardar actualiza solo ese dato y vuelve a pedir autorización', () => {
    const session = {
        estado: 'PROSPECTO',
        history: [],
        _commercialAwaitingField: 'autorizacion',
        _datosCaptura: {
            tipoNegocio: 'Spa o centro de bienestar',
            negocio: 'Spa Del Amor',
            ciudad: 'Bogotá',
            empleados: 'Solo yo',
            necesidadPrincipal: 'Agenda y citas',
            nombreContacto: 'Cris'
        }
    };

    const result = processCaptureTurn(session, 'La ciudad correcta es Soacha');
    assert.equal(result.changes.ciudad, 'Soacha');
    assert.equal(session._datosCaptura.ciudad, 'Soacha');
    assert.equal(getCommercialAwaitingField(session), 'autorizacion');
    assert.match(result.directReply, /Spa Del Amor · Soacha · Solo yo/i);
});

test('consentimientos naturales solo se reconocen como respuestas explícitas', () => {
    for (const answer of [
        'Sí', 'sí claro', 'de acuerdo', 'puedes guardar mis datos', 'acepto',
        'ahora sí autorizo', 'dale', 'listo', 'listica', 'sí señora', 'está bien', 'okay'
    ]) {
        assert.equal(isPositiveCommercialAuthorization(answer), true, answer);
    }
    for (const answer of ['No', 'prefiero no', 'no autorizo']) {
        assert.equal(isNegativeCommercialAuthorization(answer), true, answer);
    }
    assert.equal(isPositiveCommercialAuthorization('sí, explícame los servicios'), false);
    assert.equal(isPositiveCommercialAuthorization('hágale'), false);
    assert.equal(isPositiveCommercialAuthorization('sisas'), false);
});

test('una duda en medio de la captura bloquea técnicamente capturar_lead hasta retomar el dato pendiente', () => {
    const userData = {
        estado: 'PROSPECTO',
        nombre: 'Cris',
        _tipoNegocio: 'Spa o centro de bienestar',
        _negocio: 'Spa Del Amor',
        _commercialRequiredField: 'ciudad',
        _commercialResumeQuestion: 'Para continuar con tu solicitud, ¿en qué ciudad atiendes?',
        _commercialBlockLeadCapture: true
    };
    const prompt = buildPrompt(userData, 'Quiero saber los precios');
    const toolNames = getCommercialToolsForConversation(userData)
        .map(tool => tool.function.name);

    assert.match(prompt, /CONTROL DEL SERVIDOR/i);
    assert.match(prompt, /No pidas ni infieras otros datos/i);
    assert.ok(!toolNames.includes('capturar_lead'));
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
