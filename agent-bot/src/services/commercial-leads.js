const api = require('./api');

function cleanValue(value) {
    if (value === undefined || value === null || value === 'undefined' || value === 'null') return '';
    return String(value).trim();
}

function buildCommercialNotes(draft) {
    return [
        cleanValue(draft.tipoNegocio) ? 'Tipo de negocio: ' + cleanValue(draft.tipoNegocio) : '',
        cleanValue(draft.necesidadPrincipal) ? 'Necesidad principal: ' + cleanValue(draft.necesidadPrincipal) : '',
        cleanValue(draft.notas)
    ].filter(Boolean).join(' | ').slice(0, 900);
}

function queueAdvisorAlert(config, session, result) {
    const asesores = String(config.whatsappAsesores || '')
        .split(',')
        .map(number => number.trim())
        .filter(Boolean);
    const asesorAsignado = cleanValue(result.response?.asesorAsignado);

    if (result.response?.actualizado || result.response?.duplicado || !asesorAsignado || asesores.length === 0) {
        return;
    }

    const { nombreContacto, nombreNegocio, whatsapp, ciudad, cantidadEmpleados, tipoNegocio, necesidadPrincipal, notas } = result;
    const alertMsg = `*🔔 Nuevo Lead BeautyOS*\n\n👤 Contacto: ${nombreContacto}\n💼 Negocio: ${nombreNegocio}\n🏷️ Tipo: ${tipoNegocio}\n📱 WhatsApp: ${whatsapp}\n📍 Ciudad: ${ciudad}\n👥 Empleados: ${cantidadEmpleados}\n🎯 Desea mejorar: ${necesidadPrincipal}\n\n${notas ? '📝 Notas: ' + notas + '\n\n' : ''}✅ *Asignado a ti.* Contáctalo para cerrar la venta.`;
    if (!session._pendingTransferMessages) session._pendingTransferMessages = [];
    session._pendingTransferMessages.push({ to: asesorAsignado, text: alertMsg });
    if (asesores.length > 1 && asesores[0] !== asesorAsignado) {
        session._pendingTransferMessages.push({
            to: asesores[0],
            text: `*Lead asignado a ${asesorAsignado}*\n${nombreContacto} - ${nombreNegocio} (${ciudad})`
        });
    }
}

function markCommercialLeadSaved(session, result) {
    const { nombreContacto, nombreNegocio, ciudad, cantidadEmpleados, tipoNegocio, necesidadPrincipal, notas, email, response } = result;
    const isCompletingExistingLead = Boolean(session._leadNeedsCompletion || session.estado === 'LEAD_INCOMPLETO');

    session._leadCapturado = nombreNegocio;
    session.estado = 'LEAD_EXISTENTE';
    session._commercialRegistrationComplete = true;
    session._leadAwaitingCacheConfirmation = true;
    session._leadSavedAt = Date.now();
    session._leadMissingAfterGrace = 0;
    session._commercialExpectedField = '';
    session._commercialAwaitingField = '';
    session._awaitingLeadAuthorization = false;
    session._commercialCapturePaused = false;
    delete session._leadNeedsCompletion;

    if (!session.datos) session.datos = {};
    session.datos.nombre = nombreContacto;
    session.datos.negocio = nombreNegocio;
    session.datos.ciudad = ciudad;
    session.datos.estadoLead = isCompletingExistingLead
        ? (session.datos.estadoLead || 'NUEVO')
        : 'NUEVO';

    session._datosCaptura = {
        ...(session._datosCaptura || {}),
        nombreContacto,
        negocio: nombreNegocio,
        ciudad,
        empleados: cantidadEmpleados,
        tipoNegocio,
        necesidadPrincipal,
        notas,
        email,
        autorizaDatos: 'SI'
    };

    return {
        isCompletingExistingLead,
        actualizado: Boolean(response?.actualizado),
        duplicado: Boolean(response?.duplicado),
        queued: Boolean(response?.queued)
    };
}

/**
 * Guarda el lead desde el servidor, usando únicamente el borrador validado
 * por el flujo comercial. El modelo de IA no es fuente de campos del CRM.
 */
async function saveCommercialLeadFromDraft({ config, session, phoneNumber }) {
    if (session?._leadCapturado || session?._commercialRegistrationComplete) {
        return { ok: true, alreadySaved: true, response: {} };
    }

    const draft = session?._datosCaptura || {};
    const nombreContacto = cleanValue(draft.nombreContacto);
    const nombreNegocio = cleanValue(draft.negocio);
    const ciudad = cleanValue(draft.ciudad);
    const cantidadEmpleados = cleanValue(draft.empleados);
    const tipoNegocio = cleanValue(draft.tipoNegocio);
    const necesidadPrincipal = cleanValue(draft.necesidadPrincipal);
    const email = cleanValue(draft.email).toLowerCase();
    const autorizaDatos = cleanValue(draft.autorizaDatos).toUpperCase();
    const whatsapp = cleanValue(session?.datos?.celular || phoneNumber);
    const notas = buildCommercialNotes(draft);
    const missing = [];
    if (!nombreContacto) missing.push('nombre de contacto');
    if (!nombreNegocio) missing.push('nombre comercial');
    if (!ciudad) missing.push('ciudad');
    if (!cantidadEmpleados) missing.push('equipo');
    if (!tipoNegocio) missing.push('tipo de negocio');
    if (!necesidadPrincipal) missing.push('qué desea mejorar');
    if (autorizaDatos !== 'SI') missing.push('autorización');
    if (!whatsapp) missing.push('WhatsApp');
    if (missing.length > 0) return { ok: false, missing, error: 'Faltan datos validados para registrar el lead.' };

    const crmUrl = cleanValue(config?.crmBeautyosUrl);
    if (!crmUrl) return { ok: false, error: 'CRM URL no configurada.' };

    const isCompletingExistingLead = Boolean(session._leadNeedsCompletion || session.estado === 'LEAD_INCOMPLETO');
    const payload = {
        action: isCompletingExistingLead ? 'completeLeadByWhatsapp' : 'saveLead',
        schemaVersion: 'lead-v2',
        nombreContacto,
        nombreNegocio,
        whatsapp,
        email,
        ciudad,
        cantidadEmpleados,
        tipoNegocio,
        necesidadPrincipal,
        notas,
        fuente: 'whatsapp-agente',
        autorizaDatos: 'SI'
    };
    const response = await api.postToCRM(crmUrl, payload);
    if (!response || response.error) {
        return { ok: false, error: response?.error || 'Sin respuesta del CRM.' };
    }

    const result = {
        ok: true,
        response,
        nombreContacto,
        nombreNegocio,
        whatsapp,
        email,
        ciudad,
        cantidadEmpleados,
        tipoNegocio,
        necesidadPrincipal,
        notas
    };
    result.state = markCommercialLeadSaved(session, result);
    queueAdvisorAlert(config || {}, session, result);
    return result;
}

function getCommercialLeadConfirmation(result) {
    if (result.alreadySaved) return 'Tu información ya estaba registrada. Si tienes una duda sobre BeautyOS, aquí estoy para ayudarte.';
    if (!result.ok) return 'Recibí tu autorización, pero no pude confirmar el registro en este momento. El equipo revisará tu solicitud y te contactará por este medio.';
    if (result.state.actualizado) return `Listo, ${result.nombreContacto}. Actualizamos tu registro y el equipo comercial te dará seguimiento.`;
    if (result.state.duplicado) return 'Listo, encontramos tu registro y continuamos la atención sin duplicarlo. El equipo comercial te dará seguimiento.';
    if (result.state.queued) return `Recibí tu solicitud, ${result.nombreContacto}. Está en proceso de registro y el equipo comercial te contactará por este medio.`;
    return `Listo, ${result.nombreContacto}. Tu información quedó registrada y el equipo comercial te contactará por este medio.`;
}

module.exports = {
    saveCommercialLeadFromDraft,
    getCommercialLeadConfirmation,
    buildCommercialNotes
};
