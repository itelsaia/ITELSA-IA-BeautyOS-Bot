const express = require('express');
const router = express.Router();

const { getTenant } = require('../services/tenants');
const { generateAIResponse, analyzePaymentReceipt } = require('../services/openai');
const { handleOnboarding } = require('../services/session');
const { loadPendingAppointments } = require('../services/sheets');
const { transcribeAudio, MAX_AUDIO_TRANSCRIPTION_BYTES } = require('../services/whisper');
const api = require('../services/api'); // singleton — override webhookUrl por tenant

// Helper: Parsea campo CUMPLE en formato "dd/mm" o "15 de marzo"
const MESES_ES = { enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06', julio:'07', agosto:'08', septiembre:'09', octubre:'10', noviembre:'11', diciembre:'12' };
function parseCumpleDDMM(cumpleStr) {
    if (!cumpleStr) return '';
    const str = cumpleStr.toString().trim();
    const slashParts = str.split('/');
    if (slashParts.length >= 2 && !isNaN(slashParts[0]) && !isNaN(slashParts[1])) {
        return slashParts[0].padStart(2, '0') + '/' + slashParts[1].padStart(2, '0');
    }
    const match = str.toLowerCase().match(/(\d{1,2})\s*de\s*(\w+)/);
    if (match && MESES_ES[match[2]]) return match[1].padStart(2, '0') + '/' + MESES_ES[match[2]];
    return '';
}

// Helper: Convierte URLs de Google Drive a formato de descarga directa
function convertDriveUrl(url) {
    if (!url) return url;
    // Formato: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    // Formato: https://drive.google.com/open?id=FILE_ID
    const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match2) return `https://drive.google.com/uc?export=download&id=${match2[1]}`;
    return url; // Ya es URL directa
}

// ─── Datos parciales del prospecto comercial ─────────────────
// Solo se guardan datos que el usuario expresó de forma explícita. El nombre
// visible de WhatsApp sirve para saludar, pero nunca se usa como contacto CRM.
function normalizeCommercialText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function normalizeCommercialValue(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/^["'“”]+|["'“”]+$/g, '')
        .trim()
        .slice(0, 100);
}

function isGenericCommercialBusinessName(value) {
    const text = normalizeCommercialText(value)
        .replace(/^(?:mi|un|una|el|la)\s+/, '')
        .trim();
    return /^(?:salon(?: de belleza)?|pelu(?:queria)?|barberia(?: de (?:hombres|caballeros|damas))?|barber shop|spa(?: de (?:belleza|bienestar))?|unas|nails|manicure|pedicure|estetica|cejas|pestanas|lash(?:es)?|brows?|belleza|negocio de belleza|beauty salon|(?:salon|centro|estudio) de (?:unas|belleza|cejas|pestanas|estetica))$/.test(text);
}

function isCommercialAcknowledgement(value) {
    return /^(?:si|no|claro|dale|ok(?:ay)?|listo|perfecto|gracias|ningun[oa]?|de acuerdo|esta bien|vale)$/.test(normalizeCommercialText(value).trim());
}

function isCommercialPlaceholderValue(value) {
    return /^(?:pendiente|sin (?:nombre|negocio|datos|registro)|n\/?a|na|desconocido|por (?:confirmar|definir)|tbd|-)$/.test(normalizeCommercialText(value).trim());
}

function isCommercialNonDataResponse(value) {
    const text = normalizeCommercialText(value)
        .replace(/[.!?,;:]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return /^(?:hola|buenas|buenos dias|buenas tardes|bien(?: gracias)?|gracias|me interesa|si quiero|quiero informacion|quiero información|no entiendo|no comprendo|no se|no se todavia|no tengo|no quiero|prefiero no|mas tarde|despues|por ahora|todo bien|de una|hagale|sisas)$/.test(text);
}

function isInvalidCommercialBusinessName(value) {
    return !normalizeCommercialValue(value)
        || isGenericCommercialBusinessName(value)
        || isCommercialAcknowledgement(value)
        || isCommercialNonDataResponse(value)
        || isCommercialPlaceholderValue(value);
}

function isPlausibleCommercialBusinessName(value) {
    const name = normalizeCommercialValue(value);
    const text = normalizeCommercialText(name);
    if (isInvalidCommercialBusinessName(name) || name.length < 2) return false;
    if (/^(?:tengo|quiero|necesito|quisiera|busco|no\s+(?:se|sé|tengo)|aun\s+no|todavia\s+no|despues|luego|por\s+ahora)\b/.test(text)) return false;
    if (/\b(?:duda|pregunta|precio|precios|plan(?:es)?|servicio(?:s)?|informacion|información|ayuda)\b/.test(text)) return false;
    return !isLikelyCommercialQuestion(name);
}

function hasCompleteCommercialDraft(draft) {
    return Boolean(
        draft
        && normalizeCommercialValue(draft.nombreContacto)
        && isPlausibleCommercialBusinessName(draft.negocio)
        && isPlausibleCommercialCity(draft.ciudad)
        && normalizeCommercialValue(draft.empleados)
    );
}

function isPositiveCommercialAuthorization(value) {
    const text = normalizeCommercialText(value)
        .replace(/[.!?,;:]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    // Estas expresiones solo se usan cuando el servidor dejó pendiente la
    // pregunta exacta de autorización. Mantenemos fuera respuestas demasiado
    // ambiguas como "hágale" o "sisas", que pueden referirse a una explicación.
    return /^(?:si(?:\s+(?:claro|por favor|porfa|senora|senor|senorita|quiero|puedes|autorizo|acepto|de acuerdo))?|autorizo(?:\s+el tratamiento(?: de mis datos)?)?|acepto(?:\s+el tratamiento(?: de mis datos)?)?|confirmo(?:\s+la autorizacion)?|puedes(?:\s+guardar)?(?: mis)? datos|ahora si(?: autorizo| puedes guardar(?: mis)? datos)?|de acuerdo|dale|list(?:o|a|ica)|esta bien|okay)$/.test(text);
}

function isNegativeCommercialAuthorization(value) {
    const text = normalizeCommercialText(value)
        .replace(/[.!?,;:]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return /^(?:no|no autorizo|no acepto|no gracias|prefiero no(?: (?:decir(?:lo)?|compartir|dar|guardar)(?: mis)? datos?)?|mejor no|ahora no|por ahora no|despues|luego|paso|no quiero(?: (?:que me contacten|compartir|dar|guardar)(?: mis)? datos?)?)$/.test(text);
}

function isExplicitCommercialAuthorizationReopen(value) {
    const text = normalizeCommercialText(value)
        .replace(/[.!?,;:]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return /^(?:si\s+)?(?:autorizo|acepto)(?:\s+el tratamiento(?: de mis datos)?)?$/.test(text)
        || /^(?:si\s+)?puedes(?:\s+guardar)?(?: mis)? datos$/.test(text);
}

function getCommercialNextExpectedField(session) {
    if (!session || session._commercialRegistrationComplete || session._leadCapturado || session.estado === 'LEAD_EXISTENTE') {
        return '';
    }
    if (session._commercialCapturePaused) return '';
    const draft = session._datosCaptura || {};
    if (session.estado === 'LEAD_INCOMPLETO' && !isPlausibleCommercialBusinessName(draft.negocio)) return 'negocio';
    if (!normalizeCommercialValue(draft.tipoNegocio)) return 'tipoNegocio';
    if (!isPlausibleCommercialBusinessName(draft.negocio)) return 'negocio';
    if (!isPlausibleCommercialCity(draft.ciudad)) return 'ciudad';
    if (!normalizeCommercialValue(draft.empleados)) return 'empleados';
    if (!isLikelyCommercialContactName(draft.nombreContacto)) return 'nombreContacto';
    if (session._leadConsentDeclined) return '';
    return 'autorizacion';
}

function isLikelyCommercialContactName(value) {
    const name = normalizeCommercialValue(value);
    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,3}$/.test(name)) return false;
    const normalized = normalizeCommercialText(name);
    if (/^(?:hola|si|no|claro|gracias|buenas|buenos|usuario|cliente)$/i.test(normalized)) return false;
    if (isCommercialNonDataResponse(name)) return false;
    if (/^(?:(?:soy|es)\s+)?(?:la|el)?\s*(?:duen[oa]|encargad[oa]|administrador(?:a)?|asesor(?:a)?|cliente)$/i.test(normalized)) return false;
    if (/^(?:no\s+(?:quiero|tengo)\s+(?:decir|nombre)|prefiero\s+no\s+decir(?:lo)?)$/.test(normalized)) return false;
    return !/\b(?:duda|pregunta|precio|precios|servicio|servicios|negocio|barberia|spa|salon)\b/i.test(normalized);
}

function formatCommercialCity(value) {
    const city = normalizeCommercialValue(value);
    const normalized = normalizeCommercialText(city)
        .replace(/\./g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const aliases = {
        'bogota': 'Bogotá',
        'bogota dc': 'Bogotá',
        'bogota d c': 'Bogotá',
        'bta': 'Bogotá',
        'medellin': 'Medellín',
        'medallo': 'Medellín',
        'bga': 'Bucaramanga'
    };
    if (aliases[normalized]) return aliases[normalized];
    // No usamos \b: sus límites son ASCII y corrompen tildes como Cúcuta o
    // Chía. Si la persona ya usó mayúsculas/minúsculas mixtas, conservamos
    // exactamente su escritura; si escribió todo en una sola caja, normalizamos
    // solo el inicio de cada palabra.
    if (city !== city.toLocaleLowerCase('es-CO') && city !== city.toLocaleUpperCase('es-CO')) {
        return city;
    }
    const lowercaseWords = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y']);
    return city.split(/\s+/).map((word, index) => {
        const lower = word.toLocaleLowerCase('es-CO');
        if (index > 0 && lowercaseWords.has(lower)) return lower;
        return lower.charAt(0).toLocaleUpperCase('es-CO') + lower.slice(1);
    }).join(' ');
}

function parseCommercialCity(value) {
    let city = normalizeCommercialValue(value);
    const normalized = normalizeCommercialText(city).replace(/\s+/g, ' ').trim();

    // Si la persona aclara una ciudad principal, sí se permite la cobertura
    // secundaria posterior. En cualquier otra mención de dos ciudades, no
    // elegimos una arbitrariamente.
    const primaryMatch = city.match(/^(?:(?:mi\s+)?(?:ciudad|zona)\s+)?principal\s+(?:es|ser[ií]a)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]{2,60})(?:,|;|\.|$)/i);
    if (primaryMatch) city = primaryMatch[1].trim();
    else {
        city = city
            .replace(/^(?:(?:mi\s+)?(?:negocio|sal[oó]n|barber[ií]a|spa|marca|estudio)\s+)?(?:estoy|queda|est[aá]|atiendo|atendemos|estamos|ubicad[oa]s?|soy|vivo|resido|trabajo)\s+(?:en|de|desde|por)\s+/i, '')
            .replace(/^(?:(?:(?:mi|la)\s+)?ciudad\s+(?:correcta\s+)?(?:es|ser[ií]a)|(?:en\s+)?(?:la\s+)?ciudad\s+de)\s+/i, '')
            .replace(/^en\s+/i, '')
            .trim();
    }

    if (!primaryMatch && (/\b(?:y|o)\b/.test(normalized) || /\b(?:tambien|también)\s+(?:atiendo|trabajo|tengo)\b/.test(normalized))) {
        return '';
    }
    if (/,/.test(city)) city = city.split(',')[0].trim();
    city = city.replace(/\s+(?:colombia|col)\.?$/i, '').trim();
    return formatCommercialCity(city);
}

function isPlausibleCommercialCity(value) {
    const city = parseCommercialCity(value);
    const raw = normalizeCommercialText(value).replace(/[.!?,;:]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]{1,59}$/.test(city)) return false;
    if (isCommercialAcknowledgement(city)) return false;
    if (isCommercialNonDataResponse(city)) return false;
    if (isCommercialPlaceholderValue(city)) return false;
    const normalized = normalizeCommercialText(city);
    if (/^(?:mi ciudad|el negocio|colombia|no se|no se todavia|todavia no|mas adelante|por ahora|por el momento|estoy empezando|ninguna|ninguno|la casa|mi casa|prefiero no(?: decirlo)?|solo yo|yo solit[oa]|por mi cuenta|independiente)$/i.test(normalized)) return false;
    if (isPositiveCommercialAuthorization(raw) || isNegativeCommercialAuthorization(raw)) return false;
    if (detectCommercialTeamSize(raw, false) || detectCommercialBusinessType(raw, true)) return false;
    if (/\b(?:barrio|localidad|zona|sector|centro|direccion|dirección|casa|hogar|domicilio|local|sur|norte|oriente|occidente)\b/.test(normalized)) return false;
    if (/^(?:kennedy|suba|chapinero|usaquen|engativa|bosa|fontibon|teusaquillo|tunjuelito|ciudad bolivar|el sur|el norte|el centro)$/i.test(normalized)) return false;
    if (/^(?:cris(?:tian)?|maria(?: jose)?|juan|jose|ana|carla|carolina|diana|andrea|sofia|carlos|luis|david|pedro|laura|natalia|camila)$/i.test(normalized)) return false;
    if (/\b(?:quiero|tengo|necesito|duda|pregunta|precio|servicio|funciona|saber)\b/.test(normalized)) return false;
    return !/\b(?: y | o )\b/.test(normalized);
}

function detectCommercialBusinessType(messageText, isExpectedTypeAnswer = false) {
    const text = normalizeCommercialText(messageText);
    const isOwnershipStatement = /\b(tengo|manejo|mi\s+(?:negocio|salon|barberia|spa|estudio)|soy\s+duen[oa]|trabajo\s+en)\b/.test(text);
    if (!isExpectedTypeAnswer && !isOwnershipStatement) return '';
    if (/\bbarber(?:ia|shop)?\b/i.test(text)) return 'Barbería';
    if (/\bspa\b|masajes?|terapias?\b/.test(text)) return 'Spa / bienestar';
    if (/\bunas\b|nails?\b|manicur|pedicur/.test(text)) return 'Uñas';
    if (/\bcejas\b|pestanas\b|lash(?:es)?\b|brows?\b/.test(text)) return 'Cejas y pestañas';
    if (/\bestetica\b|facial(?:es)?\b|depilaci/.test(text)) return 'Estética';
    if (/\bsalon\b|pelu(?:quer)?|estilista|cabello\b/.test(text)) return 'Salón de belleza';
    return '';
}

function detectCommercialTeamSize(messageText, allowBareAnswer = false) {
    const text = normalizeCommercialText(messageText);
    const solo = /\b(?:solo\s*yo|yo\s+sol[oa]|yo\s+solit[oa]|trabajo\s+sol[oa]|por\s+mi\s+cuenta|independiente|unico\s+empleado|yo\s+soy\s+el\s+unico|solo\s+atiendo\s+yo)\b/.test(text);
    if (solo && (allowBareAnswer || /\b(?:trabajo|atiendo|soy|por)\b/.test(text))) return 'Solo yo';
    if (allowBareAnswer && /\b(?:mi\s+(?:hermana|socio|companera)|una\s+(?:chica|muchacha))\s+y\s+yo\b/.test(text)) return '2 a 5';

    const teamCount = '(?:[2-9]|[1-9]\\d|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince)';
    const teamNoun = '(?:emplead(?:o|a|os|as)?|personas?|trabajador(?:a|es|as)?|estilistas?|colaboradores?|asesores?|profesionales?|chic[oa]s?|en\\s+total)';
    const nonTeamNoun = '(?:sede(?:s)?|local(?:es)?|cliente(?:s)?|dia(?:s)?|plan(?:es)?|servicio(?:s)?|pregunta(?:s)?|cita(?:s)?|hora(?:s)?)';
    const hasNamedTeam = new RegExp('\\b(?:tenemos|atendemos|contamos\\s+con|cuento\\s+con|trabajamos)\\s+' + teamCount + '\\s+' + teamNoun + '\\b').test(text)
        || new RegExp('\\b' + teamCount + '\\s+' + teamNoun + '\\b').test(text);
    const hasSomosCount = new RegExp('\\bsomos\\s+(?:mas\\s+de\\s+)?' + teamCount + '\\b(?!\\s+' + nonTeamNoun + '\\b)').test(text)
        || /\bsomos\s+mas\s+de\s+(?:10|diez)\b/.test(text);
    const hasBareWorkCount = allowBareAnswer
        && new RegExp('\\btrabajamos\\s+' + teamCount + '\\b(?!\\s+' + nonTeamNoun + '\\b)').test(text);
    const hasTeamContext = hasNamedTeam || hasSomosCount || hasBareWorkCount
        || /\bmas\s+de\s+(?:10|diez)\s+(?:emplead(?:o|a|os|as)?|personas?|trabajador(?:a|es|as)?|estilistas?|colaboradores?|asesores?|profesionales?)\b/.test(text);
    if (hasTeamContext) {
        if (/\b(?:[2-5]|dos|tres|cuatro|cinco)\b/.test(text)) return '2 a 5';
        if (/\b(?:[6-9]|10|seis|siete|ocho|nueve|diez)\b/.test(text)) return '6 a 10';
        if (/\b(?:1[1-9]|[2-9]\d|once|doce|trece|catorce|quince|mas\s+de\s+(?:10|diez))\b/.test(text)) return '11 o mas';
    }
    if (allowBareAnswer) {
        if (/^(?:1|uno|una|yo)$/.test(text)) return 'Solo yo';
        if (/^(?:[2-5]|dos|tres|cuatro|cinco)$/.test(text)) return '2 a 5';
        if (/^(?:[6-9]|10|seis|siete|ocho|nueve|diez)$/.test(text)) return '6 a 10';
        if (/^(?:1[1-9]|[2-9]\d|once|doce|trece|catorce|quince|mas de (?:10|diez))$/.test(text)) return '11 o mas';
    }
    return '';
}

function isLikelyCommercialQuestion(value) {
    const raw = String(value || '');
    const text = normalizeCommercialText(raw).replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (/[¿?]/.test(raw)) return true;
    if (/^(?:como|que|cual|cuanto|cuando|donde|por que|para que|me explicas?|explicame|cuentame|quiero saber|quiero conocer|necesito saber|tengo (?:una )?duda|informame|dime|me cuentas?|me interesa|me gustaria|me gustaría|quisiera|no entiendo|no comprendo|ayudame|ayúdame)\b/.test(text)) return true;
    if (/^(?:quiero|necesito|dame)\s+(?:saber|ver|conocer|informacion|información|precios?|planes?|servicios?|una\s+demo|soporte)\b/.test(text)) return true;
    // En audio es frecuente recibir "el funcionamiento de los servicios" sin
    // signos de interrogación. Detectamos intención, no palabras aisladas:
    // "Agenda Beauty" o "Citas de Reinas" pueden ser marcas totalmente válidas.
    if (/\b(?:funcionamiento|funciona|implementacion|configur(?:ar|acion)|soporte)\b/.test(text)) return true;
    if (/\b(?:precio|precios|plan(?:es)?|servicio(?:s)?|agenda|citas?|crm|sistema|herramienta|demo)\s+(?:de|del|para|por|en|con|sobre)\b/.test(text)) return true;
    return /^(?:precios?|planes?|servicios?|soporte|demo)(?:\s+beautyos)?$/.test(text);
}

function isCommercialOptOut(value) {
    const text = normalizeCommercialText(value).replace(/[.!?,;:]+$/g, '').trim();
    return /^(?:no gracias|no me interesa|no quiero|mejor no|despues|luego|ahora no|por ahora no|paso|prefiero no)$/i.test(text);
}

function getCommercialAwaitingField(session, lastAssistantMessage = '') {
    const requiredField = getCommercialNextExpectedField(session);
    const current = String(session?._commercialAwaitingField || '').trim();
    if (current && current === requiredField) return current;

    // Compatibilidad segura para conversaciones iniciadas antes de este
    // despliegue: solo recuperamos el campo anterior si el último mensaje
    // realmente contenía esa pregunta, nunca solo porque falta el dato.
    const legacy = String(session?._commercialExpectedField || '').trim();
    if (!current && legacy && legacy === requiredField
        && inferCommercialExpectedField(lastAssistantMessage) === legacy) {
        return legacy;
    }
    return '';
}

function setCommercialAwaitingField(session, field) {
    const nextField = field || '';
    session._commercialAwaitingField = nextField;
    // Se conserva temporalmente para compatibilidad con sesiones en memoria
    // creadas por versiones anteriores del bot.
    session._commercialExpectedField = nextField;
    session._awaitingLeadAuthorization = nextField === 'autorizacion';
}

function getCommercialCaptureQuestion(field, draft = {}, options = {}) {
    const attempt = Number(options.attempt || 0);
    const resume = Boolean(options.resume);
    const prefix = resume
        ? 'Para continuar con tu solicitud, '
        : (attempt > 1 ? 'No pasa nada; para seguir, ' : (attempt === 1 ? 'Para dejarlo claro, ' : ''));
    const business = normalizeCommercialValue(draft.negocio);
    const city = parseCommercialCity(draft.ciudad);
    const employees = normalizeCommercialValue(draft.empleados);

    if (field === 'tipoNegocio') {
        const typePrefix = resume
            ? 'Para continuar con tu solicitud, '
            : (attempt > 1 ? 'No pasa nada; para seguir, ' : (attempt === 1 ? 'Para dejarlo claro, ' : 'Para orientarte mejor, '));
        return typePrefix + '¿tu negocio es salón/peluquería, barbería, spa, uñas, cejas/pestañas o estética? Puedes responder con una opción.';
    }
    if (field === 'negocio') {
        return prefix + '¿cómo se llama tu negocio o marca? Ejemplo: “Spa Del Amor”.';
    }
    if (field === 'ciudad') {
        return prefix + '¿en qué ciudad o municipio atiendes principalmente? Ejemplo: Bogotá, Soacha, Medellín o Chía.';
    }
    if (field === 'empleados') {
        return prefix + '¿atiendes solo tú, son 2 a 5, 6 a 10 o 11 o más personas? Puedes responder con una opción.';
    }
    if (field === 'nombreContacto') {
        return prefix + '¿con qué nombre prefieres que te contactemos? Ejemplo: Cris o María José.';
    }
    if (field === 'autorizacion') {
        const contact = normalizeCommercialValue(draft.nombreContacto);
        const resumen = [business, city, employees].filter(Boolean).join(' · ');
        const contactoResumen = contact ? 'Contacto: ' + contact : '';
        return 'Tengo: ' + [resumen, contactoResumen].filter(Boolean).join(' · ') + '. '
            + '¿Está correcto y autorizas usar estos datos solo para contactarte sobre BeautyOS? Responde “sí, autorizo” o “no autorizo”.';
    }
    return '';
}

function updateCommercialCaptureDraft(session, messageText) {
    if (!session._datosCaptura) session._datosCaptura = {};
    const draft = session._datosCaptura;
    const changes = {};
    const lastAssistantMessage = [...(session.history || [])]
        .reverse()
        .find(entry => entry.role === 'assistant')?.content || '';
    const rawAnswer = normalizeCommercialValue(messageText);
    // Una pausa explícita no borra el borrador, pero evita que el agente siga
    // pidiendo datos hasta que la persona indique claramente que desea retomar.
    if (session._commercialCapturePaused && /^(?:quiero\s+(?:continuar|registrarme|dejar\s+mis\s+datos)|podemos\s+continuar|si\s+quiero\s+registrarme|me\s+quiero\s+registrar)$/i.test(normalizeCommercialText(messageText).trim())) {
        session._commercialCapturePaused = false;
    }
    const isQuestion = isLikelyCommercialQuestion(messageText);
    const flowClosed = Boolean(
        session._commercialRegistrationComplete
        || session._leadCapturado
        || session.estado === 'LEAD_EXISTENTE'
    );
    const awaitingField = flowClosed ? '' : getCommercialAwaitingField(session, lastAssistantMessage);
    let awaitingFieldHandled = false;
    const changesField = (field, value) => {
        const cleanValue = normalizeCommercialValue(value);
        if (!cleanValue || normalizeCommercialValue(draft[field]) === cleanValue) return false;
        draft[field] = cleanValue;
        changes[field] = cleanValue;
        return true;
    };
    const stripBusinessPrefix = (value) => normalizeCommercialValue(value)
        .replace(/^(?:(?:mi|el|la)\s+)?(?:(?:negocio|sal[oó]n|barber[ií]a|spa|marca|estudio)\s+)?(?:se\s+llama|es)\s+/i, '')
        .trim();
    const stripContactPrefix = (value) => normalizeCommercialValue(value)
        .replace(/^(?:me\s+llamo|mi\s+nombre\s+es|me\s+dicen|puedes?\s+llamarme|pueden\s+llamarme|soy)\s+/i, '')
        .trim();
    const acceptField = (field, value) => {
        const changed = changesField(field, value);
        if (field === awaitingField && (changed || normalizeCommercialValue(draft[field]))) {
            awaitingFieldHandled = true;
            // El siguiente dato no se marca como "preguntado" hasta que la
            // respuesta se envíe con éxito. Así un fallo de Evolution no deja
            // una respuesta corta asociada a una pregunta que nunca llegó.
            setCommercialAwaitingField(session, '');
        }
        return changed;
    };

    const applyExpectedAnswer = () => {
        if (!rawAnswer || isQuestion || !awaitingField) return;
        if (awaitingField === 'tipoNegocio') {
            const tipoNegocio = detectCommercialBusinessType(messageText, true);
            if (tipoNegocio) {
                acceptField('tipoNegocio', tipoNegocio);
            }
        } else if (awaitingField === 'negocio') {
            const negocio = stripBusinessPrefix(rawAnswer);
            if (isPlausibleCommercialBusinessName(negocio)) {
                acceptField('negocio', negocio);
            }
        } else if (awaitingField === 'ciudad') {
            const ciudad = parseCommercialCity(rawAnswer);
            if (ciudad && isPlausibleCommercialCity(rawAnswer)) {
                acceptField('ciudad', ciudad);
            }
        } else if (awaitingField === 'empleados') {
            const empleados = detectCommercialTeamSize(messageText, true);
            if (empleados) {
                acceptField('empleados', empleados);
            }
        } else if (awaitingField === 'nombreContacto') {
            const nombre = stripContactPrefix(rawAnswer);
            if (isLikelyCommercialContactName(nombre)
                && normalizeCommercialText(nombre) !== normalizeCommercialText(draft.negocio)) {
                acceptField('nombreContacto', nombre);
            }
        } else if (awaitingField === 'necesidad') {
            draft.notas = 'Necesidad/duda: ' + rawAnswer;
            changes.notas = draft.notas;
            awaitingFieldHandled = true;
            setCommercialAwaitingField(session, '');
        }
    };

    // Nunca interpretar una respuesta corta desde el simple dato faltante:
    // solo se acepta si ese campo fue preguntado realmente por el servidor.
    applyExpectedAnswer();

    let authorizationAccepted = false;
    let authorizationDeclined = false;
    if (awaitingField === 'autorizacion' && rawAnswer && !isQuestion) {
        if (isPositiveCommercialAuthorization(messageText)) {
            draft.autorizaDatos = 'SI';
            session._leadConsentDeclined = false;
            setCommercialAwaitingField(session, '');
            changes.autorizaDatos = 'SI';
            awaitingFieldHandled = true;
            authorizationAccepted = true;
        } else if (isNegativeCommercialAuthorization(messageText)) {
            draft.autorizaDatos = 'NO';
            session._leadConsentDeclined = true;
            setCommercialAwaitingField(session, '');
            changes.autorizaDatos = 'NO';
            awaitingFieldHandled = true;
            authorizationDeclined = true;
        }
    } else if (session._leadConsentDeclined && isExplicitCommercialAuthorizationReopen(messageText)
        && hasCompleteCommercialDraft(draft)) {
        // Permitir que un prospecto cambie de opinión más tarde sin obligarlo
        // a repetir el formulario.
        draft.autorizaDatos = 'SI';
        session._leadConsentDeclined = false;
        setCommercialAwaitingField(session, '');
        changes.autorizaDatos = 'SI';
        authorizationAccepted = true;
    }

    if (!draft.email) {
        const emailMatch = String(messageText || '').match(/[\w.+-]+@[\w-]+\.[\w.]+/i);
        if (emailMatch) {
            draft.email = emailMatch[0].toLowerCase();
            changes.email = draft.email;
        }
    }

    // Extracción adicional solo para afirmaciones explícitas. Puede coexistir
    // con una pregunta en el mismo audio/texto ("Atiendo en Bogotá, ¿cuánto
    // cuesta?"), pero jamás se extrae un dato desde una pregunta pura.
    if (rawAnswer) {
        if (!draft.tipoNegocio) {
            const tipoNegocio = detectCommercialBusinessType(messageText, false);
            if (tipoNegocio) acceptField('tipoNegocio', tipoNegocio);
        }

        const nombreMatch = String(messageText || '').match(/^(?:me llamo|mi nombre es|me dicen|puedes?\s+llamarme|pueden\s+llamarme|soy)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{2,80})/i);
        if (nombreMatch) {
            const nombre = stripContactPrefix(nombreMatch[0])
                .replace(/\s+(?:y|pero)\s+(?=(?:tengo|manejo|trabajo|soy|mi\s+(?:negocio|sal[oó]n|barber[ií]a|spa|marca|estudio))\b).*$/i, '')
                .trim();
            if (isLikelyCommercialContactName(nombre)
                && normalizeCommercialText(nombre) !== normalizeCommercialText(draft.negocio)) {
                acceptField('nombreContacto', nombre);
            }
        }

        const negocioMatch = String(messageText || '').match(/^(?:(?:mi\s+)?(?:negocio|sal[oó]n|barber[ií]a|spa|marca|estudio)\s+(?:se\s+llama|es)|(?:la\s+)?marca\s+(?:se\s+llama|es)|se\s+llama)\s+["'“”]?([^.,!?]+)/i);
        if (negocioMatch) {
            const negocio = stripBusinessPrefix(negocioMatch[0])
                .replace(/\s+(?:y|pero)\s+(?=(?:tengo|manejo|trabajo|soy|mi\s+(?:negocio|sal[oó]n|barber[ií]a|spa|marca|estudio))\b).*$/i, '')
                .trim();
            if (isPlausibleCommercialBusinessName(negocio)) acceptField('negocio', negocio);
        }

        const cityStatement = /^(?:(?:(?:mi|la)\s+)?ciudad\s+(?:correcta\s+)?(?:es|ser[ií]a)|(?:mi\s+)?(?:negocio|sal[oó]n|barber[ií]a|spa|marca|estudio)\s+)?(?:queda|est[aá]|atiendo|atendemos|estamos|ubicad[oa]s?|soy|vivo|resido|trabajo)\s+(?:en|de|desde|por)\s+/i.test(String(messageText || ''))
            || /^(?:(?:(?:mi|la)\s+)?ciudad\s+(?:correcta\s+)?(?:es|ser[ií]a)|(?:en\s+)?la\s+ciudad\s+de)\s+/i.test(String(messageText || ''));
        if (cityStatement && isPlausibleCommercialCity(messageText)) {
            const ciudad = parseCommercialCity(messageText);
            if (ciudad) acceptField('ciudad', ciudad);
        }

        const empleados = detectCommercialTeamSize(messageText, false);
        if (empleados) acceptField('empleados', empleados);
    }

    const requiredField = flowClosed ? '' : getCommercialNextExpectedField(session);
    const attempts = session._commercialClarificationAttempts || {};
    const clearAttempt = (field) => {
        if (field && attempts[field]) attempts[field] = 0;
    };
    if (awaitingFieldHandled) clearAttempt(awaitingField);

    let inputKind = 'accepted';
    let directReply = '';
    let resumeQuestion = '';
    let blockLeadCapture = false;

    if (flowClosed) {
        inputKind = 'registered';
    } else if (authorizationAccepted) {
        inputKind = 'authorization';
    } else if (authorizationDeclined) {
        inputKind = 'authorization_declined';
        directReply = 'Entendido, respeto tu decisión. Si más adelante quieres que el equipo te contacte sobre BeautyOS, puedes autorizarlo por este medio.';
    } else if (isCommercialOptOut(messageText)) {
        session._commercialCapturePaused = true;
        setCommercialAwaitingField(session, '');
        inputKind = 'opt_out';
        directReply = 'Claro, no hay problema. Si más adelante quieres conocer BeautyOS o resolver una duda, aquí estoy.';
    } else if (isQuestion) {
        inputKind = 'product_question';
        if (requiredField) {
            resumeQuestion = getCommercialCaptureQuestion(requiredField, draft, { resume: true });
            blockLeadCapture = true;
        }
    } else if (requiredField) {
        const needsClarification = awaitingField
            && awaitingField === requiredField
            && !awaitingFieldHandled
            && Object.keys(changes).length === 0;
        if (needsClarification) {
            attempts[requiredField] = Math.min((Number(attempts[requiredField]) || 0) + 1, 3);
            inputKind = 'ambiguous';
        } else {
            attempts[requiredField] = 0;
        }
        directReply = getCommercialCaptureQuestion(requiredField, draft, { attempt: attempts[requiredField] || 0 });
    }

    session._commercialClarificationAttempts = attempts;
    return {
        changes,
        requiredField,
        awaitingField,
        inputKind,
        directReply,
        resumeQuestion,
        blockLeadCapture,
        authorizationAccepted,
        authorizationDeclined
    };
}

function asksCommercialDataAuthorization(text) {
    return /autorizas?(?:\s+a)?\s+(?:guardar|registrar).{0,120}datos/i.test(String(text || ''));
}

function inferCommercialExpectedField(text) {
    const normalized = normalizeCommercialText(text);
    if (asksCommercialDataAuthorization(text)) return 'autorizacion';
    if (/que tipo de negocio(?: de belleza)? tienes/.test(normalized)) return 'tipoNegocio';
    if (/como se llama tu (?:negocio|marca|salon|barberia|spa|estudio)/.test(normalized)) return 'negocio';
    if (/en que ciudad (?:atiendes|esta|se encuentra|funciona)/.test(normalized)) return 'ciudad';
    if (/(?:trabajas tu sol[oa]|cuantas personas (?:atienden|trabajan)|solo yo, 2 a 5)/.test(normalized)) return 'empleados';
    if (/(?:como prefieres que te llamemos|como te llamas)/.test(normalized)) return 'nombreContacto';
    if (/que te gustaria (?:resolver|conocer) primero/.test(normalized)) return 'necesidad';
    return '';
}

// Referencia al cliente de Evolution API (se inyecta desde app.js)
let evolutionClient = null;

// Evolution puede reenviar un evento y un audio puede tardar más que un texto
// en descargarse/transcribirse. Estas dos protecciones hacen que una misma
// conversación se procese en orden y que un mismo message-id no vuelva a
// ejecutar una captura o una alerta.
const RECENT_MESSAGE_TTL_MS = 15 * 60 * 1000;
const MAX_RECENT_MESSAGE_IDS = 10000;
const recentMessageIds = new Map();
const conversationQueues = new Map();

function acceptIncomingMessage(instance, messageId, now = Date.now()) {
    if (!messageId) return true;
    const key = `${instance || 'unknown'}:${messageId}`;
    const previous = recentMessageIds.get(key);
    if (previous && now - previous < RECENT_MESSAGE_TTL_MS) return false;

    recentMessageIds.set(key, now);
    if (recentMessageIds.size > MAX_RECENT_MESSAGE_IDS) {
        for (const [storedKey, seenAt] of recentMessageIds) {
            if (now - seenAt >= RECENT_MESSAGE_TTL_MS || recentMessageIds.size > MAX_RECENT_MESSAGE_IDS) {
                recentMessageIds.delete(storedKey);
            }
            if (recentMessageIds.size <= MAX_RECENT_MESSAGE_IDS) break;
        }
    }
    return true;
}

function enqueueConversationTask(conversationKey, task) {
    const previous = conversationQueues.get(conversationKey) || Promise.resolve();
    const current = previous
        .catch(error => console.error(`[WEBHOOK] Error previo en cola ${conversationKey}:`, error.message))
        .then(task);
    const tracked = current.finally(() => {
        if (conversationQueues.get(conversationKey) === tracked) {
            conversationQueues.delete(conversationKey);
        }
    });
    conversationQueues.set(conversationKey, tracked);
    return tracked;
}

function resetWebhookGuardsForTests() {
    recentMessageIds.clear();
    conversationQueues.clear();
}

/**
 * Calcula el anticipo total sumando los anticipos individuales de cada servicio.
 * @param {string} serviciosStr Nombres de servicios separados por coma
 * @param {Array} servicesCatalog Catálogo de servicios del tenant
 * @returns {{ anticipoEnabled: boolean, montoAnticipo: number }}
 */
function resolveAnticipoForServices(serviciosStr, servicesCatalog) {
    const serviceNames = serviciosStr.split(',').map(s => s.trim()).filter(Boolean);
    let totalAnticipo = 0;
    let anyEnabled = false;

    serviceNames.forEach(serviceName => {
        const serviceInfo = servicesCatalog.find(s =>
            s.name.toLowerCase().trim() === serviceName.toLowerCase().trim()
        );
        if (serviceInfo && serviceInfo.anticipoEnabled) {
            anyEnabled = true;
            const monto = serviceInfo.anticipoType === 'PORCENTAJE'
                ? Math.round(serviceInfo.price * serviceInfo.anticipoValue / 100)
                : serviceInfo.anticipoValue;
            totalAnticipo += monto;
        }
    });

    return { anticipoEnabled: anyEnabled, montoAnticipo: totalAnticipo };
}

function setEvolutionClient(client) {
    evolutionClient = client;
}

async function processEvolutionWebhookEvent(event, instance, data) {
    try {
        // ── Manejar eventos de conexión (log informativo) ──
        if (event === 'connection.update' || event === 'CONNECTION_UPDATE') {
            const state = data?.state || data?.connection || 'unknown';
            console.log(`[${instance}] Conexion: ${state}`);
            return;
        }

        // ── Manejar QR code (log informativo) ──
        if (event === 'qrcode.updated' || event === 'QRCODE_UPDATED') {
            console.log(`[${instance}] QR Code actualizado. Escanea desde Evolution Manager UI (http://localhost:8080).`);
            return;
        }

        // ── Solo procesar mensajes entrantes ──
        if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') return;
        if (!data || !data.key) return;
        if (data.key.fromMe) return; // Ignorar mensajes propios

        const remoteJid = data.key.remoteJid || '';

        // Excluir estados de broadcast y mensajes de grupos
        if (remoteJid === 'status@broadcast' || remoteJid.includes('@g.us')) return;

        // Extraer texto del mensaje (manejar ambos formatos)
        let messageText = data.message?.conversation
            || data.message?.extendedTextMessage?.text
            || '';

        // ── Soporte de audios: transcribir con Whisper ──
        // Detecta audioMessage (archivos de audio) y pttMessage (notas de voz/PTT)
        const audioMessage = data.message?.audioMessage || data.message?.pttMessage || null;
        const isAudio = !!audioMessage;
        if (isAudio && !messageText) {
            console.log(`[${instance}] 🎤 Audio detectado: audioMessage=${!!data.message?.audioMessage}, pttMessage=${!!data.message?.pttMessage}, ptt=${data.message?.audioMessage?.ptt}`);

            // Resolver tenant primero para obtener la API key de OpenAI
            const tenantForAudio = getTenant(instance);
            if (!tenantForAudio || !tenantForAudio.config?.openApiKey) {
                console.warn(`[WEBHOOK] Audio recibido pero sin tenant/apiKey para transcribir.`);
                return;
            }

            try {
                const audioBuffer = await evolutionClient.getMediaBase64(instance, data.key);
                if (audioBuffer) {
                    if (audioBuffer.length > MAX_AUDIO_TRANSCRIPTION_BYTES) {
                        const phoneForAudio = (data.key.remoteJid || '').split('@')[0];
                        await evolutionClient.sendText(instance, phoneForAudio, '🎤 El audio es muy largo para procesarlo. Envíame una nota de voz más corta o escríbeme el mensaje, por favor.');
                        return;
                    }
                    const transcription = await transcribeAudio(
                        audioBuffer,
                        tenantForAudio.config.openApiKey,
                        audioMessage.mimetype || 'audio/ogg'
                    );
                    if (transcription) {
                        messageText = transcription;
                        console.log(`[${instance}] 🎤 Audio transcrito correctamente (${messageText.length} caracteres).`);
                    } else {
                        // Transcripcion vacia — pedir que escriba
                        const phoneForAudio = (data.key.remoteJid || '').split('@')[0];
                        await evolutionClient.sendText(instance, phoneForAudio, '🎤 No pude entender tu audio. ¿Podrías escribirme tu mensaje por favor? 😊');
                        return;
                    }
                } else {
                    const phoneForAudio = (data.key.remoteJid || '').split('@')[0];
                    await evolutionClient.sendText(instance, phoneForAudio, '🎤 No pude procesar tu audio. ¿Podrías escribirme tu mensaje por favor? 😊');
                    return;
                }
            } catch (audioErr) {
                console.error(`[${instance}] Error procesando audio:`, audioErr.message);
                const phoneForAudio = (data.key.remoteJid || '').split('@')[0];
                await evolutionClient.sendText(instance, phoneForAudio, '🎤 Hubo un problema con tu audio. ¿Podrías escribirme tu mensaje por favor? 😊');
                return;
            }
        }

        // ── Detectar si el mensaje es una imagen (posible comprobante de pago) ──
        const isImage = !!(data.message?.imageMessage);
        const imageCaption = data.message?.imageMessage?.caption || '';

        // Log diagnostico para tipos de mensaje no procesados (stickers, contactos, ubicaciones, etc.)
        if (!messageText && !isImage) {
            const msgKeys = Object.keys(data.message || {}).filter(k => !['messageContextInfo', 'messageTimestamp'].includes(k));
            if (msgKeys.length > 0) console.log(`[${instance}] Tipo de mensaje no procesado: ${msgKeys.join(', ')}`);
            return;
        }

        // ── Resolver tenant por nombre de instancia ──
        const tenant = getTenant(instance);
        if (!tenant) {
            console.warn(`[WEBHOOK] Instancia desconocida: ${instance}. Ignorando.`);
            return;
        }

        // Override del webhook URL del singleton api.js para este tenant
        api.webhookUrl = tenant.webhookGasUrl;

        const instanceName = tenant.instanceName;
        const phoneNumber = remoteJid.split('@')[0]; // "573145551234"

        console.log(`[${instanceName}] Mensaje de [${phoneNumber}]: ${messageText}`);

        // ── Inicializar sesión del usuario ──
        const isComercial = tenant.type === 'comercial';

        if (!tenant.userSessions[phoneNumber]) {
            if (isComercial) {
                // Comercial: detectar cliente existente vs lead existente vs prospecto nuevo
                const clientesCRM = tenant.clientesCRM || {};
                const clienteMatch = clientesCRM[phoneNumber];
                if (clienteMatch) {
                    tenant.userSessions[phoneNumber] = {
                        history: [],
                        estado: 'CLIENTE_EXISTENTE',
                        // El CRM comercial expone el nombre del negocio como
                        // "nombre". Lo conservamos también como negocio para
                        // que los tickets de soporte queden ligados a la marca
                        // correcta y no al nombre visible del contacto.
                        datos: {
                            celular: phoneNumber,
                            nombre: clienteMatch.nombre,
                            negocio: clienteMatch.nombre,
                            idCliente: clienteMatch.id
                        }
                    };
                } else {
                    // Buscar si ya es un lead capturado previamente
                    const leadsCache = tenant._leadsCache || [];
                    const normalizedPhoneNumber = String(phoneNumber || '').replace(/\D/g, '');
                    const leadMatch = leadsCache.find(l => String(l.whatsapp || '').replace(/\D/g, '') === normalizedPhoneNumber);
                    if (leadMatch) {
                        const isIncompleteLead = isInvalidCommercialBusinessName(leadMatch.negocio);
                        if (isIncompleteLead) {
                            const draft = {};
                            if (isPlausibleCommercialCity(leadMatch.ciudad)) draft.ciudad = normalizeCommercialValue(leadMatch.ciudad);
                            if (['Solo yo', '2 a 5', '6 a 10', '11 o mas'].includes(normalizeCommercialValue(leadMatch.empleados))) {
                                draft.empleados = normalizeCommercialValue(leadMatch.empleados);
                            }
                            tenant.userSessions[phoneNumber] = {
                                history: [],
                                estado: 'LEAD_INCOMPLETO',
                                _leadNeedsCompletion: true,
                                // La ficha antigua puede contener datos heredados.
                                // Solo conservamos ciudad/equipo válidos y pedimos de
                                // nuevo el contacto y la marca de forma explícita.
                                datos: { celular: phoneNumber, nombrePerfil: data.pushName || '', ciudad: draft.ciudad || '', estadoLead: leadMatch.estado || 'NUEVO' },
                                _datosCaptura: draft
                            };
                            console.log(`[${instanceName}] Lead incompleto detectado: ${phoneNumber}; se solicitará marca real antes de actualizar CRM.`);
                        } else {
                            tenant.userSessions[phoneNumber] = {
                                history: [],
                                estado: 'LEAD_EXISTENTE',
                                datos: { celular: phoneNumber, nombre: leadMatch.nombre || data.pushName || '', negocio: leadMatch.negocio || '', ciudad: leadMatch.ciudad || '', estadoLead: leadMatch.estado || 'NUEVO' },
                                _leadCapturado: leadMatch.negocio
                            };
                            console.log(`[${instanceName}] Lead existente reconocido: ${leadMatch.nombre} - ${leadMatch.negocio}`);
                        }
                    } else {
                        // Detectar si viene de un link de campaña (mensaje pre-llenado)
                        const esCampana = messageText.match(/beautyos|beauty.?os|sofi|eliminar.*caos|quiero.*automatizar/i);
                        tenant.userSessions[phoneNumber] = {
                            history: [],
                            estado: 'PROSPECTO',
                            _deCampana: !!esCampana,
                            // El nombre de perfil solo personaliza el saludo. No es
                            // un nombre confirmado para guardar en el CRM.
                            datos: { celular: phoneNumber, nombrePerfil: data.pushName || '' }
                        };
                    }
                }
            } else if (tenant.registeredClients[phoneNumber]) {
                tenant.userSessions[phoneNumber] = {
                    history: [],
                    estado: 'REGISTRADO',
                    datos: tenant.registeredClients[phoneNumber]
                };
            } else {
                tenant.userSessions[phoneNumber] = { history: [], estado: null, datos: null };
            }
        }

        const session = tenant.userSessions[phoneNumber];

        // ── Comercial: saltar onboarding, ir directo a IA ──
        let userData;
        let commercialCaptureState = null;
        if (isComercial) {
            commercialCaptureState = updateCommercialCaptureDraft(session, messageText);
            const draftChanges = commercialCaptureState.changes;
            const datosCaptura = session._datosCaptura || {};
            const datosSesion = session.datos || {};
            userData = {
                // nombre es exclusivamente el contacto confirmado; nombrePerfil
                // nunca debe satisfacer el dato obligatorio del CRM.
                nombre: datosCaptura.nombreContacto || datosSesion.nombre || '',
                nombreContacto: datosCaptura.nombreContacto || datosSesion.nombre || '',
                nombrePerfil: datosSesion.nombrePerfil || data.pushName || '',
                celular: phoneNumber,
                estado: session.estado,
                idCliente: datosSesion.idCliente || '',
                // Dos señales redundantes protegen la conversación si un sync
                // del CRM llega tarde: una sesión que ya confirmó el guardado
                // nunca debe volver a entrar al flujo de captura.
                registroCompleto: Boolean(session._commercialRegistrationComplete || session._leadCapturado || session.estado === 'LEAD_EXISTENTE'),
                leadCapturado: Boolean(session._leadCapturado),
                negocio: datosSesion.negocio || datosCaptura.negocio || '',
                ciudad: datosSesion.ciudad || datosCaptura.ciudad || '',
                estadoLead: datosSesion.estadoLead || '',
                _negocio: datosCaptura.negocio || '',
                _ciudad: datosCaptura.ciudad || '',
                _empleados: datosCaptura.empleados || '',
                _email: datosCaptura.email || '',
                _tipoNegocio: datosCaptura.tipoNegocio || '',
                _notasLead: datosCaptura.notas || '',
                _autorizaDatos: datosCaptura.autorizaDatos || '',
                _leadConsentDeclined: Boolean(session._leadConsentDeclined),
                _commercialRequiredField: commercialCaptureState.requiredField || '',
                _commercialAwaitingField: commercialCaptureState.awaitingField || '',
                _commercialResumeQuestion: commercialCaptureState.resumeQuestion || '',
                _commercialBlockLeadCapture: Boolean(commercialCaptureState.blockLeadCapture),
                _draftChanges: draftChanges
            };
        } else {
            // ── Máquina de Estados: Onboarding CRM (solo salones) ──
            const senderForSession = remoteJid;
            const sessionPayload = await handleOnboarding(senderForSession, messageText, session, tenant.config);

            if (!sessionPayload.isGpt) {
                await evolutionClient.sendText(instanceName, phoneNumber, sessionPayload.text);
                if (session.estado === 'REGISTRADO') {
                    session.history.push({ role: 'assistant', content: sessionPayload.text });
                }
                return;
            }

            // ── Datos del usuario para contexto de IA ──
            const datosCaptura = session._datosCaptura || {};
            userData = session.datos
                ? { nombre: session.datos.nombre, celular: phoneNumber, cumple: session.datos.cumple || '', tipo: session.datos.tipo || 'Nuevo', exentoAnticipo: session.datos.exemptFromPayment === true, estado: session.estado, negocio: session.datos.negocio || '', ciudad: session.datos.ciudad || '', estadoLead: session.datos.estadoLead || '', _negocio: datosCaptura.negocio || '', _ciudad: datosCaptura.ciudad || '', _empleados: datosCaptura.empleados || '', _email: datosCaptura.email || '' }
                : { nombre: data.pushName || "Cliente", celular: phoneNumber, cumple: '', tipo: 'Nuevo', exentoAnticipo: false, _negocio: '', _ciudad: '', _empleados: '', _email: '' };
        }

        // ── Bloques de salon: saludo personalizado + comprobantes de pago (NO aplican a comercial) ──
        if (!isComercial) {

        // ── GUARDRAIL: Deteccion temprana de intencion fuerte ──
        // Que protege: Evita enviar saludo generico cuando el mensaje ya contiene intencion clara
        // Como funciona: Regex detecta keywords de agendamiento, cancelacion, consulta de servicios
        const INTENT_FUERTE_REGEX = /\b(agendar|agenda[mr]e|reservar|reserv[ae]me|cita|turno|cancelar(?:la)?|reagendar(?:la)?|reprogramar|cambiar\s*(?:la\s*)?(?:cita|hora|fecha)|mover\s*(?:la\s*)?(?:cita|hora)|que\s*servicios|cuanto\s*(?:cuesta|vale)|precios?|disponibilidad|horarios?\s*(?:disponibles?)?|quiero\s+(?:un[ao]?\s+)?(?:servicio|corte|manicur[ea]?|pedicur[ea]?|cejas|pestanas|tratamiento|arreglo)|necesito\s+(?:un[ao]?\s+)?(?:cita|turno|reserva)|para\s+(?:hoy|ma[nñ]ana|el\s+\w+))\b/i;

        // ── Saludo cálido para clientes REGISTRADOS (primer mensaje de sesión) ──
        const esClienteRegistrado = session.estado === 'REGISTRADO';
        const esNuevaSesion = session.history.length === 0;

        if (esClienteRegistrado && esNuevaSesion) {
            const primerNombre = userData.nombre.split(' ')[0];

            const horaColombia = new Date(
                new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' })
            ).getHours();
            let saludo;
            if (horaColombia >= 5 && horaColombia < 12) saludo = 'buenos días';
            else if (horaColombia >= 12 && horaColombia < 18) saludo = 'buenas tardes';
            else saludo = 'buenas noches';

            // Fetch en vivo de citas pendientes
            let userPendingAppointments = [];
            try {
                const liveAppointments = await loadPendingAppointments(tenant.sheetId);
                userPendingAppointments = liveAppointments[phoneNumber] || [];
                tenant.pendingAppointments = liveAppointments;
            } catch (e) {
                userPendingAppointments = tenant.pendingAppointments[phoneNumber] || [];
            }

            let complemento = '¿En qué te puedo ayudar hoy? 🌸✨';
            if (userPendingAppointments.length === 1) {
                const c = userPendingAppointments[0];
                complemento = `Recuerda que tienes una cita el *${c.fecha}* a las *${c.inicio}* para *${c.servicio}* con *${c.profesional || 'Por asignar'}* 📅✨\n\n¿Deseas hacer algo más o modificar tu cita?`;
            } else if (userPendingAppointments.length > 1) {
                const citasTexto = userPendingAppointments.map((c, i) =>
                    `${i + 1}. *${c.fecha}* a las *${c.inicio}* — ${c.servicio} con ${c.profesional || 'Por asignar'} (ID: ${c.id})`
                ).join('\n');
                complemento = `Tienes *${userPendingAppointments.length} citas* pendientes 📅✨:\n${citasTexto}\n\n¿Deseas agendar algo nuevo o modificar alguna cita?`;
            }

            // Detectar cumpleanos del cliente HOY
            const nowCol = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
            const ddNowSaludo = String(nowCol.getDate()).padStart(2, '0');
            const mmNowSaludo = String(nowCol.getMonth() + 1).padStart(2, '0');
            let birthdayGreeting = '';
            const cumplePromoSaludo = (tenant.promotionsCatalog || []).find(p =>
                p.tipoPromo === 'CUMPLEANOS' && p.estado === 'ACTIVO'
            );
            if (cumplePromoSaludo && session.datos && session.datos.cumple) {
                const cumpleDDMM = parseCumpleDDMM(session.datos.cumple);
                if (cumpleDDMM === `${ddNowSaludo}/${mmNowSaludo}`) {
                    const descuentoBday = cumplePromoSaludo.valorDescuento || 20;
                    const negocioName = tenant.config.businessName || 'nuestro negocio';
                    const serviciosList = tenant.servicesCatalog.map(s => s.name).join(', ');
                    birthdayGreeting = `\n\n🎉🎂 *¡FELIZ CUMPLEAÑOS!* 🎂🎉\nHoy en *${negocioName}* tienes un *${descuentoBday}% de descuento* en el servicio que prefieras como regalo de cumpleaños. Aplica para: ${serviciosList}.\n\n📲 ¡Escríbeme el servicio que quieres y te ayudo a agendar tu cita de cumpleaños!`;
                }
            }

            // Promociones proactivas en el saludo
            const weekDays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
            const hoyDia = weekDays[nowCol.getDay()];
            const clientTipoSaludo = (session.datos && session.datos.tipo) ? session.datos.tipo : 'Nuevo';
            const promosHoy = (tenant.promotionsCatalog || []).filter(p => {
                if (p.estado !== 'ACTIVO') return false;
                if (p.tipoPromo === 'CUMPLEANOS') return false;
                if (p.vence) {
                    const parts = p.vence.split('/');
                    if (parts.length === 3) {
                        const venceDate = new Date(parts[2], parts[1] - 1, parts[0]);
                        venceDate.setHours(23, 59, 59);
                        if (venceDate < nowCol) return false;
                    }
                }
                if (p.aplicaDia && p.aplicaDia.trim() !== '') {
                    const dias = p.aplicaDia.split(',').map(d => d.trim().toLowerCase());
                    if (!dias.includes(hoyDia)) return false;
                }
                if (p.aplicaTipoCliente && p.aplicaTipoCliente !== 'TODOS') {
                    const allowed = p.aplicaTipoCliente.split(',').map(t => t.trim().toLowerCase());
                    if (!allowed.includes(clientTipoSaludo.toLowerCase())) return false;
                }
                return true;
            });

            let promoTexto = '';
            let promoCTA = '';
            if (promosHoy.length > 0) {
                promoTexto = '\n\n🎉 *¡Promociones activas para hoy!*\n' +
                    promosHoy.map(p => {
                        let descLabel = '';
                        if (p.tipoPromo === 'PORCENTAJE') descLabel = `${p.valorDescuento}% de descuento`;
                        else if (p.tipoPromo === '2X1') descLabel = '2x1';
                        else if (p.tipoPromo === 'VALOR_FIJO') descLabel = `$${Number(p.valorDescuento).toLocaleString('es-CO')} de descuento`;
                        return `• *${p.nombre}*: ${descLabel} en ${p.aplicaServicio}`;
                    }).join('\n');
                promoCTA = '\n\n👇 *¿Te gustaría aprovechar alguna de estas promos y agendar tu cita?* 💖✨';
            }

            let saludoPersonalizado;
            if (birthdayGreeting) {
                saludoPersonalizado = `🎉🎂 ¡${saludo.charAt(0).toUpperCase() + saludo.slice(1)}, *${primerNombre}*! 🎂🎉 ¡Qué bueno verte en tu día especial!\n\n${complemento}${birthdayGreeting}${promoTexto}`;
            } else if (promosHoy.length > 0) {
                // Cuando hay promos, el saludo se enfoca en ellas
                const complementoSinGenerico = userPendingAppointments.length > 0 ? complemento + '\n' : '';
                saludoPersonalizado = `🌟 ¡${saludo.charAt(0).toUpperCase() + saludo.slice(1)}, *${primerNombre}*! 💖 ¡Qué bueno verte por acá de nuevo!\n\n${complementoSinGenerico}${promoTexto}${promoCTA}`;
            } else {
                saludoPersonalizado = `🌟 ¡${saludo.charAt(0).toUpperCase() + saludo.slice(1)}, *${primerNombre}*! 💖 ¡Qué bueno verte por acá de nuevo!\n\n${complemento}`;
            }

            // ── Deteccion temprana de intencion: decidir si enviar saludo o suprimir ──
            const msgSinSaludo = messageText.toLowerCase()
                .replace(/\b(hola|buenos?\s*(dias|tardes|noches)|hey|hi|buenas|saludos|que\s*tal|buen\s*dia)\b/gi, '')
                .replace(/[^\w\sáéíóúñ]/g, '')
                .trim();

            const tieneIntentFuerte = INTENT_FUERTE_REGEX.test(msgSinSaludo);

            if (tieneIntentFuerte) {
                // ── Intent detectado: NO enviar saludo, inyectar contexto silencioso para OpenAI ──
                const contextParts = [`[CONTEXTO: Cliente registrado "${primerNombre}" inicio sesion con intencion directa.`];

                if (userPendingAppointments.length === 1) {
                    const c = userPendingAppointments[0];
                    contextParts.push(`Tiene 1 cita pendiente: ${c.id} el ${c.fecha} a las ${c.inicio} para ${c.servicio} con ${c.profesional || 'Por asignar'}.`);
                } else if (userPendingAppointments.length > 1) {
                    const citasList = userPendingAppointments.map(c =>
                        `${c.id}: ${c.fecha} ${c.inicio} - ${c.servicio}`
                    ).join('; ');
                    contextParts.push(`Tiene ${userPendingAppointments.length} citas pendientes: ${citasList}.`);
                }

                if (birthdayGreeting) {
                    contextParts.push(`HOY es su cumpleanos - tiene descuento de cumpleanos disponible.`);
                }

                if (promosHoy.length > 0) {
                    const promosList = promosHoy.map(p => `${p.nombre} (${p.tipoPromo} ${p.valorDescuento || ''})`).join(', ');
                    contextParts.push(`Promos activas hoy: ${promosList}.`);
                }

                contextParts.push(']');
                session.history.push({ role: 'assistant', content: contextParts.join(' ') });
                console.log(`[${instanceName}] ⚡ Intent fuerte detectado en saludo: "${msgSinSaludo.substring(0, 80)}". Saludo suprimido, contexto inyectado.`);
                // Continua al procesamiento de IA (intent detection + generateAIResponse)

            } else {
                // ── Sin intent fuerte: enviar saludo personalizado (comportamiento original) ──
                session.history.push({ role: 'assistant', content: saludoPersonalizado });
                await evolutionClient.sendText(instanceName, phoneNumber, saludoPersonalizado);

                // Enviar media visual de promos del dia si tienen
                const mediaEnviadaEnSaludo = [];
                for (const p of promosHoy) {
                    console.log(`[${instanceName}] Promo "${p.nombre}" media: tipo=${p.tipoMediaPromo || 'NONE'}, url=${p.urlMediaPromo ? 'SI' : 'NO'}`);
                    if (p.tipoMediaPromo && p.urlMediaPromo) {
                        try {
                            const directUrl = convertDriveUrl(p.urlMediaPromo);
                            const mediaType = p.tipoMediaPromo === 'imagen' ? 'image' : p.tipoMediaPromo === 'video' ? 'video' : 'document';
                            const fileName = p.tipoMediaPromo === 'documento' ? (p.nombre.replace(/[^a-zA-Z0-9áéíóúñ ]/g, '') + '.pdf') : '';
                            const caption = `🎉 *${p.nombre}* — ¡Aprovecha esta promo!`;
                            await new Promise(r => setTimeout(r, 1500));
                            await evolutionClient.sendMedia(instanceName, phoneNumber, mediaType, directUrl, caption, fileName);
                            mediaEnviadaEnSaludo.push(p.nombre);
                            console.log(`[${instanceName}] ✅ Media promo "${p.nombre}" enviada a ${phoneNumber}`);
                        } catch (promoMediaErr) {
                            console.error(`[${instanceName}] ❌ Error enviando media promo saludo "${p.nombre}":`, promoMediaErr.message);
                        }
                    }
                }

                // Si se envió media de promos, registrarlo en el historial para que la IA lo sepa
                if (mediaEnviadaEnSaludo.length > 0) {
                    session.history.push({ role: 'assistant', content: `[Ya se enviaron imágenes/videos de las promos: ${mediaEnviadaEnSaludo.join(', ')}. NO preguntar si quiere verlas ni volver a enviarlas.]` });
                }

                // Si el usuario solo pregunta por promos y el saludo ya las mostró, no pasar a IA
                if (promosHoy.length > 0 && /promo(cion|ciones)?|descuento|oferta/.test(msgSinSaludo) && msgSinSaludo.length < 50) {
                    console.log(`[${instanceName}] Pregunta de promos ya cubierta por el saludo. No se pasa a IA.`);
                    return;
                }

                if (msgSinSaludo.length < 10) {
                    return; // Solo un saludo, no hay contenido sustancial
                }
                // El mensaje tiene más contenido → continuar al procesamiento de IA
                console.log(`[${instanceName}] Saludo + contenido detectado: "${msgSinSaludo.substring(0, 80)}". Continuando a IA.`);
            }
        }

        // ── PROCESAMIENTO DE COMPROBANTES DE PAGO (imagen) ──
        if (isImage && tenant.config.hasAnyAnticipo) {
            // Verificar si el usuario tiene un pago pendiente
            const pendingPaymentAfter = session.pendingPaymentAfterBooking;   // DESPUES de agendar
            const pendingPaymentBefore = session.pendingPaymentBeforeBooking; // ANTES de agendar

            if (pendingPaymentAfter || pendingPaymentBefore) {
                const paymentInfo = pendingPaymentAfter || pendingPaymentBefore;
                console.log(`[${instanceName}] 📸 Comprobante recibido de ${phoneNumber}. Analizando con Vision...`);

                try {
                    const imageBuffer = await evolutionClient.getMediaBase64(instanceName, data.key);
                    if (!imageBuffer) {
                        await evolutionClient.sendText(instanceName, phoneNumber, '📸 No pude procesar tu imagen. ¿Podrías enviarla de nuevo? 🙏');
                        return;
                    }

                    const analysis = await analyzePaymentReceipt(
                        imageBuffer,
                        tenant.config.businessName,
                        tenant.config.openApiKey
                    );

                    console.log(`[${instanceName}] 🔍 Resultado Vision:`, JSON.stringify(analysis));

                    // Caso 1: Comprobante no válido (fraude/editado)
                    if (!analysis.esValido) {
                        const rejectMsg = `⚠️ Lo sentimos, no pudimos validar este comprobante.\n\n` +
                            `${analysis.motivoRechazo ? 'Motivo: ' + analysis.motivoRechazo + '\n\n' : ''}` +
                            `Por favor envía un comprobante válido de tu transferencia o contacta directamente al negocio. 📞`;
                        session.history.push({ role: 'user', content: '[Envió imagen de comprobante]' });
                        session.history.push({ role: 'assistant', content: rejectMsg });
                        await evolutionClient.sendText(instanceName, phoneNumber, rejectMsg);

                        // Notificar a dueña
                        const ownerPhone = tenant.config.ownerPhone;
                        if (ownerPhone) {
                            const notifMsg = `⚠️ *Comprobante Sospechoso*\n\n` +
                                `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                                `📱 Celular: ${phoneNumber}\n` +
                                `❌ Motivo: ${analysis.motivoRechazo || 'No se pudo validar'}\n` +
                                `💰 Anticipo esperado: $${Number(paymentInfo.montoAnticipo).toLocaleString('es-CO')}\n\n` +
                                `_Revisa manualmente este caso._`;
                            try { await evolutionClient.sendText(instanceName, ownerPhone, notifMsg); } catch (e) {}
                        }
                        return;
                    }

                    // Caso 2: Fecha no reciente
                    if (!analysis.fechaReciente) {
                        const dateMsg = `⚠️ El comprobante parece ser de otra fecha (${analysis.fecha || 'no detectada'}).\n\n` +
                            `Por favor envía un comprobante *reciente* de tu transferencia de $${Number(paymentInfo.montoAnticipo).toLocaleString('es-CO')}. 📸`;
                        session.history.push({ role: 'user', content: '[Envió imagen de comprobante]' });
                        session.history.push({ role: 'assistant', content: dateMsg });
                        await evolutionClient.sendText(instanceName, phoneNumber, dateMsg);
                        return;
                    }

                    // Caso 3: Todo válido — confirmar pago (acepta cualquier monto)
                    const refStr = `${analysis.fecha || ''} Ref:${analysis.referencia || 'N/A'}`;
                    const saldoRestante = paymentInfo.precioTotal - analysis.monto;

                    if (pendingPaymentAfter) {
                        // Flujo DESPUES: La cita ya existe → confirmar pago
                        api.webhookUrl = tenant.webhookGasUrl;
                        await api.confirmarPago(paymentInfo.agendaId, {
                            montoPagado: analysis.monto,
                            referencia: refStr,
                            fechaPago: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })
                        });

                        const successMsg = `✅ *¡Pago confirmado!* 💖\n\n` +
                            `💰 Anticipo recibido: *$${Number(analysis.monto).toLocaleString('es-CO')}*\n` +
                            `📋 Referencia: ${analysis.referencia || 'N/A'}\n` +
                            `🆔 Cita: ${paymentInfo.agendaId}\n\n` +
                            `Tu cita está 100% reservada. ✨\n` +
                            `💵 Saldo restante al momento del servicio: *$${Number(saldoRestante).toLocaleString('es-CO')}*\n\n` +
                            `¡Te esperamos! 🌸`;

                        session.pendingPaymentAfterBooking = null;
                        session.history.push({ role: 'user', content: '[Envió comprobante de pago]' });
                        session.history.push({ role: 'assistant', content: successMsg });
                        await evolutionClient.sendText(instanceName, phoneNumber, successMsg);

                        // Notificar a dueña
                        const ownerPhone = tenant.config.ownerPhone;
                        if (ownerPhone) {
                            const notifMsg = `✅ *Pago Confirmado*\n\n` +
                                `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                                `📱 Celular: ${phoneNumber}\n` +
                                `🆔 Cita: ${paymentInfo.agendaId}\n` +
                                `💰 Monto: $${Number(analysis.monto).toLocaleString('es-CO')}\n` +
                                `📋 Ref: ${analysis.referencia || 'N/A'}\n` +
                                `💵 Saldo restante: $${Number(saldoRestante).toLocaleString('es-CO')}\n\n` +
                                `_Pago verificado automáticamente por ${tenant.config.agentName || 'BeautyOS'}_`;
                            try { await evolutionClient.sendText(instanceName, ownerPhone, notifMsg); } catch (e) {}
                        }

                        tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);
                    } else if (pendingPaymentBefore) {
                        // Flujo ANTES: Pago primero, luego agendar
                        api.webhookUrl = tenant.webhookGasUrl;
                        const agendaId = await api.createAgenda({
                            fecha: paymentInfo.fecha,
                            inicio: paymentInfo.hora_inicio,
                            fin: paymentInfo.hora_fin,
                            cliente: userData.nombre || 'Cliente',
                            celularCliente: phoneNumber,
                            servicio: paymentInfo.servicios,
                            precio: paymentInfo.precioTotal,
                            profesional: paymentInfo.profesional || 'Por asignar',
                            notas: '',
                            // Datos de anticipo para incluir en la cita
                            exentoAnticipo: 'NO',
                            montoAnticipo: paymentInfo.montoAnticipo,
                            montoPagado: analysis.monto,
                            saldoRestante: saldoRestante,
                            estadoPago: 'PAGO_CONFIRMADO',
                            refComprobante: refStr,
                            fechaPago: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })
                        });

                        let successMsg;
                        if (agendaId) {
                            successMsg = `✅ *¡Pago recibido y cita confirmada!* 💖\n\n` +
                                `📋 *Resumen de tu cita:*\n` +
                                `· *Servicio:* ${paymentInfo.servicios} ✂️\n` +
                                `· *Fecha:* ${paymentInfo.fecha}\n` +
                                `· *Hora:* ${paymentInfo.hora_inicio} a ${paymentInfo.hora_fin}\n` +
                                `· *Profesional:* ${paymentInfo.profesional}\n` +
                                `· *Precio total:* $${Number(paymentInfo.precioTotal).toLocaleString('es-CO')}\n` +
                                `· *Anticipo pagado:* $${Number(analysis.monto).toLocaleString('es-CO')}\n` +
                                `· *Saldo restante:* $${Number(saldoRestante).toLocaleString('es-CO')}\n` +
                                `· *ID Cita:* ${agendaId}\n\n` +
                                `¡Te esperamos! 🌸✨`;
                        } else {
                            successMsg = `✅ Pago recibido de $${Number(analysis.monto).toLocaleString('es-CO')}.\n\n` +
                                `❌ Sin embargo, hubo un problema al guardar tu cita. Por favor escríbenos para resolverlo. 🙏`;
                        }

                        session.pendingPaymentBeforeBooking = null;
                        session.history.push({ role: 'user', content: '[Envió comprobante de pago]' });
                        session.history.push({ role: 'assistant', content: successMsg });
                        await evolutionClient.sendText(instanceName, phoneNumber, successMsg);

                        // Notificar a dueña
                        const ownerPhone = tenant.config.ownerPhone;
                        if (ownerPhone && agendaId) {
                            const notifMsg = `📋 *Nueva Cita + Pago Confirmado*\n\n` +
                                `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                                `📱 Celular: ${phoneNumber}\n` +
                                `🆔 Cita: ${agendaId}\n` +
                                `📅 ${paymentInfo.fecha} de ${paymentInfo.hora_inicio} a ${paymentInfo.hora_fin}\n` +
                                `✂️ Servicio: ${paymentInfo.servicios}\n` +
                                `💰 Anticipo: $${Number(analysis.monto).toLocaleString('es-CO')} | Saldo: $${Number(saldoRestante).toLocaleString('es-CO')}\n` +
                                `📋 Ref: ${analysis.referencia || 'N/A'}\n\n` +
                                `_${tenant.config.agentName || 'BeautyOS'}_`;
                            try { await evolutionClient.sendText(instanceName, ownerPhone, notifMsg); } catch (e) {}
                        }

                        tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);
                    }
                    return;
                } catch (visionErr) {
                    console.error(`[${instanceName}] Error procesando comprobante:`, visionErr.message);
                    await evolutionClient.sendText(instanceName, phoneNumber, '📸 Hubo un problema al procesar tu comprobante. ¿Podrías enviarlo de nuevo? 🙏');
                    return;
                }
            } else if (isImage && !messageText) {
                // Imagen recibida pero no tiene pago pendiente — si tiene caption, usar como texto
                if (imageCaption) {
                    messageText = imageCaption;
                } else {
                    // Imagen sin contexto de pago — ignorar amablemente
                    return;
                }
            }
        } else if (isImage && !messageText) {
            // Anticipo no habilitado — si tiene caption, usar como texto
            if (imageCaption) {
                messageText = imageCaption;
            } else {
                return;
            }
        }

        // ── Detectar intenciones: REAGENDAMIENTO, CANCELACIÓN, NUEVA CITA ──
        const msgNorm = messageText.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // Detectar intención de REAGENDAMIENTO — EXHAUSTIVO
        // Cubre: todas las formas verbales, typos, coloquialismos colombianos y combinaciones posibles
        const REAGENDAR_KEYWORDS = /reagend|regend|re.?agend|reprogramar|aplazar|postergar|posponer|recorrer|adelantar|atrasar/i;
        // NOTA: "arreglar" removido — en contexto de peluquería es servicio ("arreglo de cejas"), no intención de reagendar
        const REAGENDAR_COMBOS = /(cambiar|mover|correr|pasar|modificar|actualizar|editar|ajustar|acomodar|reorganizar|reacomodar|recuadrar|reubicar).*(cita|hora|fecha|turno|reserva|appointment)/i;
        const REAGENDAR_COMBOS_REV = /(cita|hora|fecha|turno|reserva|appointment).*(cambiar|mover|correr|pasar|modificar|actualizar|editar|ajustar|acomodar|reorganizar|reacomodar|recuadrar|reubicar|cambio|muevo|paso|mueva|pase|corra|cambie)/i;
        const REAGENDAR_FRASES = /otra hora|otro dia|otro horario|diferente hora|diferente dia|distinta hora|distinto dia|no me sirve.*(hora|dia|fecha)|no puedo a esa hora|puedo a otra|puede ser.*(mas temprano|mas tarde|otro dia|otra hora)|necesito cambiar|quiero cambiar|quisiera cambiar|me toca cambiar|toca cambiar|hay que cambiar|debo cambiar|podemos cambiar|se puede cambiar|sera que.*(cambiar|mover|otra hora)|como hago para (cambiar|mover)|cambiarla|cambiarle|moverla|moverle|correrla|pasarla|adelantarla|atrasarla|aplazarla|posponerla|reprogramarla|modificarla/i;

        if (REAGENDAR_KEYWORDS.test(messageText) || REAGENDAR_COMBOS.test(messageText) || REAGENDAR_COMBOS_REV.test(messageText) || REAGENDAR_FRASES.test(messageText)) {
            session.isReagendando = true;
            session.isCancelando = false;
            session.pendingCancelacionMasiva = null;
            console.log(`[${instanceName}] 🔄 Modo reagendamiento ACTIVADO por: "${messageText.substring(0, 80)}"`);
        }

        // Detectar intención de CANCELACIÓN — EXHAUSTIVO
        const CANCELAR_REGEX = /cancelar.*(cita|turno|reserva)|(cita|turno|reserva).*cancelar|anular.*(cita|turno)|(cita|turno).*anular|eliminar.*(cita|turno)|borrar.*(cita|turno)|quitar.*(cita|turno)|no (puedo|voy|quiero|voya|pienso).*(ir|asistir|llegar)|ya no (puedo|voy|quiero)|no (ire|asistire|llegare)|cancelarla|anularla|eliminarla|quitarla|borrarla|deshacer.*(cita|turno)|quiero cancelar|quisiera cancelar|necesito cancelar|me toca cancelar|toca cancelar|como cancelo|como hago para cancelar/i;

        if (CANCELAR_REGEX.test(messageText)) {
            session.isCancelando = true;
            session.isReagendando = false;
            console.log(`[${instanceName}] ❌ Modo cancelación ACTIVADO por: "${messageText.substring(0, 80)}"`);
        }

        // Detectar si el usuario cambia a intención de NUEVA cita (desactiva todo)
        if (/\b(nueva cita|nuevo turno|agendar otra|quiero otra|otra cita)\b/i.test(messageText)) {
            session.isReagendando = false;
            session.isCancelando = false;
            console.log(`[${instanceName}] 🆕 Modo nueva cita (flags limpiados)`);
        }

        // Capturar ID de cita mencionado en el mensaje (para reagendamiento/cancelación)
        const idMatch = messageText.match(/AG-[A-Z]+-\d{3}/i);
        if (idMatch && (session.isReagendando || session.isCancelando)) {
            session.reagendandoCitaId = idMatch[0].toUpperCase();
            console.log(`[${instanceName}] 🎯 Cita objetivo: ${session.reagendandoCitaId}`);
        }

        // ── RESOLUCIÓN INTELIGENTE DE CITA: por posición, fecha, hora, servicio, día ──
        if ((session.isCancelando || session.isReagendando) && !session.reagendandoCitaId) {
            const userAppts = tenant.pendingAppointments[phoneNumber] || [];
            const TODAS_REGEX = /\b(ambas?|las dos|las tres|tod[ao]s?|todas las citas|los dos|los tres)\b/i;
            const POSICION_REGEX = /\b(la )?(primer[ao]?|segund[ao]?|tercer[ao]?|1|2|3)\b/i;

            // Cancelación masiva: "ambas", "las dos", "todas"
            if (session.isCancelando && TODAS_REGEX.test(messageText) && userAppts.length > 0 && !session.pendingCancelacionMasiva) {
                session.pendingCancelacionMasiva = userAppts.map(c => c.id);
                const citasTexto = userAppts.map((c, i) =>
                    `${i + 1}. *${c.id}* — ${c.fecha} a las ${c.inicio} — ${c.servicio}`
                ).join('\n');
                const confirmMsg = `⚠️ ¿Estás segur@ de que deseas cancelar *TODAS* tus citas pendientes?\n\n${citasTexto}\n\nResponde *sí* para confirmar o *no* para cancelar.`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: confirmMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, confirmMsg);
                return;
            }

            if (userAppts.length === 1) {
                // Auto-resolver cuando hay exactamente 1 cita pendiente
                session.reagendandoCitaId = userAppts[0].id;
                console.log(`[${instanceName}] 🎯 Cita auto-resuelta (única cita): ${session.reagendandoCitaId}`);
            } else if (userAppts.length > 1) {
                let resolved = null;

                // 1. Resolver por posición: "la primera", "la segunda", "la 1"
                const posMatch = messageText.match(POSICION_REGEX);
                if (posMatch) {
                    const posText = posMatch[2].toLowerCase();
                    let idx = -1;
                    if (/^(primer[ao]?|1)$/.test(posText)) idx = 0;
                    else if (/^(segund[ao]?|2)$/.test(posText)) idx = 1;
                    else if (/^(tercer[ao]?|3)$/.test(posText)) idx = 2;
                    if (idx >= 0 && idx < userAppts.length) resolved = { appt: userAppts[idx], method: 'posición (' + posText + ')' };
                }

                // 2. Resolver por hora mencionada: "la de las 11", "la de las 3pm"
                if (!resolved) {
                    const horaMatch = messageText.match(/(?:la\s+de\s+(?:las?\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m|p\.m)?/i);
                    if (horaMatch) {
                        let h = parseInt(horaMatch[1]);
                        const ampm = (horaMatch[3] || '').toLowerCase().replace('.', '');
                        if (ampm === 'pm' && h < 12) h += 12;
                        if (ampm === 'am' && h === 12) h = 0;
                        const horaStr = String(h).padStart(2, '0') + ':' + (horaMatch[2] || '00');
                        const match = userAppts.find(c => c.inicio && c.inicio.startsWith(horaStr));
                        if (match) resolved = { appt: match, method: 'hora (' + horaStr + ')' };
                    }
                }

                // 3. Resolver por fecha: "la del viernes", "la del 14", "la del 14/03"
                if (!resolved) {
                    const diasSemana = { 'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6, 'domingo': 0, 'manana': -1, 'mañana': -1 };
                    const msgLower = messageText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                    // Por día de semana: "la del viernes", "la de mañana"
                    for (const [dia, num] of Object.entries(diasSemana)) {
                        const diaNorm = dia.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        if (msgLower.includes(diaNorm)) {
                            let targetDay = num;
                            if (num === -1) {
                                // "mañana"
                                const tomorrow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                targetDay = tomorrow.getDay();
                            }
                            const match = userAppts.find(c => {
                                if (!c.fecha) return false;
                                const parts = c.fecha.split('/');
                                if (parts.length === 3) {
                                    const d = new Date(parts[2], parts[1] - 1, parts[0]);
                                    return d.getDay() === targetDay;
                                }
                                return false;
                            });
                            if (match) { resolved = { appt: match, method: 'día (' + dia + ')' }; break; }
                        }
                    }

                    // Por número de día: "la del 14", "la del 14/03"
                    if (!resolved) {
                        const fechaMatch = messageText.match(/(?:la\s+del?\s+)?(\d{1,2})(?:\/(\d{1,2}))?/);
                        if (fechaMatch) {
                            const diaNum = fechaMatch[1].padStart(2, '0');
                            const mesNum = fechaMatch[2] ? fechaMatch[2].padStart(2, '0') : null;
                            const match = userAppts.find(c => {
                                if (!c.fecha) return false;
                                const parts = c.fecha.split('/');
                                if (parts[0] === diaNum) {
                                    if (mesNum) return parts[1] === mesNum;
                                    return true;
                                }
                                return false;
                            });
                            if (match) resolved = { appt: match, method: 'fecha (' + diaNum + (mesNum ? '/' + mesNum : '') + ')' };
                        }
                    }
                }

                // 4. Resolver por servicio: "la de cejas", "la de manicure"
                if (!resolved) {
                    const servicios = [...new Set(userAppts.map(c => (c.servicio || '').toLowerCase()))];
                    for (const srv of servicios) {
                        if (srv && messageText.toLowerCase().includes(srv)) {
                            const match = userAppts.find(c => (c.servicio || '').toLowerCase() === srv);
                            if (match) { resolved = { appt: match, method: 'servicio (' + srv + ')' }; break; }
                        }
                    }
                }

                if (resolved) {
                    session.reagendandoCitaId = resolved.appt.id;
                    console.log(`[${instanceName}] 🎯 Cita resuelta por ${resolved.method}: ${session.reagendandoCitaId}`);
                }
            }
        }

        // ── PROMO WARNING PROACTIVO: Respuesta del cliente a la advertencia ──
        if (session.pendingPromoWarning) {
            const CHOICE_1 = /^(1|uno|primera|hora|mismo.?dia|cambiar.?hora|solo.?hora|mantener|descuento|promo)$/i;
            const CHOICE_2 = /^(2|dos|segunda|otro.?dia|diferente|acepto|precio.?completo|sin.?promo|sin.?descuento|completo|cambiar.?dia)$/i;

            if (CHOICE_1.test(msgNorm)) {
                const pw = session.pendingPromoWarning;
                session.pendingPromoWarning = null;
                const ackMsg = `¡Perfecto! Mantengamos tu descuento 💖\n\n¿Para qué hora del *${pw.promoDias}* te gustaría cambiar tu cita?`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: ackMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, ackMsg);
                console.log(`[${instanceName}] ✅ Cliente eligió mantener promo (opción 1). Reagendando en mismo día.`);
                return;
            } else if (CHOICE_2.test(msgNorm)) {
                const pw = session.pendingPromoWarning;
                session.pendingPromoWarning = null;
                session.promoLossAcceptedFor = session.reagendandoCitaId;
                const ackMsg = `Entendido, el precio sería de *$${Number(pw.precioSinPromo).toLocaleString('es-CO')}* sin descuento.\n\n¿Para qué día y hora te gustaría reagendar tu cita? 📅`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: ackMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, ackMsg);
                console.log(`[${instanceName}] ⚠️ Cliente aceptó perder promo (opción 2). Precio completo: $${pw.precioSinPromo}`);
                return;
            } else {
                const pw = session.pendingPromoWarning;
                const reaskMsg = `Por favor elige una opción:\n\n1️⃣ Cambiar solo la *hora* del *${pw.promoDias}* (mantener descuento)\n2️⃣ Reagendar a otro día (precio completo: *$${Number(pw.precioSinPromo).toLocaleString('es-CO')}*)\n\nResponde *1* o *2* 💖`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: reaskMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, reaskMsg);
                return;
            }
        }

        // ── PROMO WARNING PROACTIVO: Disparar al detectar reagendamiento sobre cita con promo DÍA FIJO ──
        if (session.isReagendando && session.reagendandoCitaId && !session.promoWarningShown && session.promoLossAcceptedFor !== session.reagendandoCitaId) {
            const userApptsPromo = tenant.pendingAppointments[phoneNumber] || [];
            const citaReag = userApptsPromo.find(c => c.id === session.reagendandoCitaId);
            console.log(`[${instanceName}] 🔍 PROMO-TRIGGER: citaId=${session.reagendandoCitaId}, appts=${userApptsPromo.length}, found=${!!citaReag}${citaReag ? `, promo="${citaReag.promo}", tipoPromo="${citaReag.tipoPromo}"` : ''}`);

            if (citaReag && citaReag.tipoPromo) {
                const promoOrig = (tenant.promotionsCatalog || []).find(p =>
                    p.nombre && p.nombre.toLowerCase().trim() === citaReag.tipoPromo.toLowerCase().trim()
                );
                console.log(`[${instanceName}] 🔍 PROMO-TRIGGER: promoOrig=${promoOrig ? `{nombre:"${promoOrig.nombre}", aplicaDia:"${promoOrig.aplicaDia}"}` : 'NOT FOUND'}, buscando="${citaReag.tipoPromo}", catalogo=[${(tenant.promotionsCatalog || []).map(p => p.nombre).join(',')}]`);

                if (promoOrig && promoOrig.aplicaDia && promoOrig.aplicaDia.trim() !== '') {
                    // Es promo DÍA FIJO → advertir PROACTIVAMENTE
                    const srvNamesP = citaReag.servicio.split(',').map(s => s.trim().toLowerCase());
                    const precioSinDesc = srvNamesP.reduce((sum, name) => {
                        const info = tenant.servicesCatalog.find(s => s.name.toLowerCase().trim() === name);
                        return sum + (info ? info.price : 0);
                    }, 0);

                    const warningMsg = `⚠️ *Importante antes de continuar:*\n\n` +
                        `Tu cita *${citaReag.id}* tiene la promo *${citaReag.tipoPromo}* que aplica los *${promoOrig.aplicaDia}*.\n` +
                        `Precio actual con descuento: *$${Number(citaReag.precio).toLocaleString('es-CO')}*\n\n` +
                        `Si reagendas para un día diferente, el precio sería de *$${Number(precioSinDesc).toLocaleString('es-CO')}* (sin descuento).\n\n` +
                        `¿Qué prefieres?\n` +
                        `1️⃣ Cambiar solo la *hora* dentro del *${promoOrig.aplicaDia}* para mantener tu descuento\n` +
                        `2️⃣ Reagendar a otro día a precio completo\n\n` +
                        `Responde *1* o *2* 💖`;

                    session.promoWarningShown = true;
                    session.pendingPromoWarning = {
                        citaId: citaReag.id,
                        promoName: citaReag.tipoPromo,
                        promoDias: promoOrig.aplicaDia,
                        precioConPromo: citaReag.precio,
                        precioSinPromo: precioSinDesc
                    };
                    session.history.push({ role: 'user', content: messageText });
                    session.history.push({ role: 'assistant', content: warningMsg });
                    await evolutionClient.sendText(instanceName, phoneNumber, warningMsg);
                    console.log(`[${instanceName}] ⚠️ PROMO WARNING PROACTIVO: ${citaReag.tipoPromo} (${citaReag.id}). Esperando elección 1 o 2.`);
                    return;
                }
            }
        }

        // ── CANCELACIÓN MASIVA CONFIRMACIÓN ──
        if (session.pendingCancelacionMasiva) {
            if (CONFIRM_REGEX.test(msgNorm)) {
                const idsACancelar = session.pendingCancelacionMasiva;
                session.pendingCancelacionMasiva = null;
                session.isCancelando = false;
                console.log(`[${instanceName}] ❌ Cancelación masiva confirmada: ${idsACancelar.join(', ')}`);

                let cancelados = [];
                let errores = [];
                for (const id of idsACancelar) {
                    const exito = await api.cancelAgenda(id);
                    if (exito) cancelados.push(id);
                    else errores.push(id);
                }

                let replyMsg;
                if (errores.length === 0) {
                    replyMsg = `✅ *¡Todas tus citas han sido canceladas!* 💔\n\n` +
                        `Citas canceladas: ${cancelados.join(', ')}\n\n` +
                        `Los horarios han sido liberados. ¿Deseas agendar algo nuevo? 🌸`;
                } else {
                    replyMsg = `⚠️ Se cancelaron ${cancelados.length} cita(s): ${cancelados.join(', ')}\n` +
                        `❌ Error en: ${errores.join(', ')}\n\n¿En qué más te puedo ayudar?`;
                }

                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: replyMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, replyMsg);

                tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);

                const ownerPhone = tenant.config.ownerPhone;
                if (ownerPhone && cancelados.length > 0) {
                    const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                    const notifMsg = `🚫 *Cancelación Masiva*\n\n` +
                        `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                        `📱 Celular: ${phoneNumber}\n` +
                        `❌ Citas canceladas: ${cancelados.join(', ')}\n` +
                        `🕐 ${ahora}\n\n` +
                        `_Notificación automática de ${tenant.config.agentName || 'BeautyOS'}_`;
                    try {
                        await evolutionClient.sendText(instanceName, ownerPhone, notifMsg);
                    } catch (notifErr) {
                        console.error(`[${instanceName}] Error notificación cancelación masiva:`, notifErr.message);
                    }
                }
                return;
            } else if (DENY_REGEX.test(msgNorm)) {
                session.pendingCancelacionMasiva = null;
                session.isCancelando = false;
                const cancelMsg = `Entendido, no se canceló ninguna cita. 😊\n\n¿En qué más te puedo ayudar?`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: cancelMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, cancelMsg);
                return;
            } else {
                // Ni sí ni no → re-preguntar
                const ids = session.pendingCancelacionMasiva;
                const reaskMsg = `¿Confirmas que deseas cancelar las citas: ${ids.join(', ')}?\n\nResponde *sí* para confirmar o *no* para mantenerlas.`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: reaskMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, reaskMsg);
                return;
            }
        }

        // ── CONFIRMACIÓN DIRECTA: El código guarda/reagenda sin pasar por IA ──
        const CONFIRM_REGEX = /^(si+p?|ok[i]?|okey|okay|dale|de una|de una vez|confirmo|confirmado|confirmar|perfecto|de acuerdo|claro|listo|vale|aprobado|bueno|esta bien|por supuesto|obvio|sep|sepi|sipi|hagale|hagamosle|hagalo|vamos|sale|hecho|ya|venga|adelante|correcto|exacto|asi es|procede|agendame|agendeme|reservame|genial|super|excelente|me parece bien|me parece|va|eso|todo bien|agende|por fa|porfa|por favor|simon|aja|ajap|oki doki|okis|dale dale|dale pues|dale si|va pues|pues si|pues dale|listo pues|listo si|listo dale|eso es|eso si|claro si|claro que si|bueno si|bueno dale|venga pues|venga dale|ya dale|perfecto dale|si claro|si dale|si por favor|si porfa|si por fa|si gracias|si senora|si senor|ok dale|ok si|ok perfecto|ok listo|dale gracias|va va|dale va|ta bien|ta bueno|joya|bien|sisas|metale|mandele|reserva|agenda|haga|parce si|of course|yes|yep|yeah|sure|si confirmo|si confirmado|si agenda|si agende|si reserva|si reservame|si agendame|confirmo si|confirmo la cita|confirmo cita|si listo|si hecho|si va|si eso|dale confirmo|listo confirmo|confirmar cita|si todo bien)$/;
        const DENY_REGEX = /^(no+|nop[e]?|nel|nah|nada|no gracias|no quiero|no thanks|mejor no|dejalo|dejemoslo|cancelar?|olvidalo|olvida|paso|noo+|ni modo|para nada|negativo|nunca|jamas|nel pastel|no va|no dale|no seas)$/;

        // ── REAGENDAMIENTO DETERMINISTA (code-level) ──
        if (session.pendingReagendamiento && CONFIRM_REGEX.test(msgNorm)) {
            const reagData = session.pendingReagendamiento;
            console.log(`[${instanceName}] 🔄 REAGENDAMIENTO DETERMINISTA: confirmación detectada. reagData=${JSON.stringify(reagData)}`);

            let citaId = session.reagendandoCitaId;

            // Si no hay citaId, intentar resolverlo automáticamente
            if (!citaId) {
                const userAppts = tenant.pendingAppointments[phoneNumber] || [];
                if (userAppts.length === 1) {
                    citaId = userAppts[0].id;
                    console.log(`[${instanceName}] 🎯 Auto-resuelto citaId (única cita): ${citaId}`);
                } else if (userAppts.length > 1) {
                    const historyText = session.history.map(h => h.content || '').join(' ');
                    const histIdMatch = historyText.match(/AG-[A-Z]+-\d{3}/i);
                    if (histIdMatch) {
                        citaId = histIdMatch[0].toUpperCase();
                        console.log(`[${instanceName}] 🎯 Auto-resuelto citaId (del historial): ${citaId}`);
                    }
                }
                if (citaId) session.reagendandoCitaId = citaId;
            }

            // ── ADVERTENCIA DE PÉRDIDA DE PROMO (code-level) ──
            console.log(`[${instanceName}] 🔍 PROMO-CHECK entrada: citaId=${citaId}, promoWarningShown=${session.promoWarningShown}, phone=${phoneNumber}`);
            if (citaId && !session.promoWarningShown) {
                const userAppts = tenant.pendingAppointments[phoneNumber] || [];
                const citaOriginal = userAppts.find(c => c.id === citaId);
                console.log(`[${instanceName}] 🔍 PROMO-CHECK: appts=${userAppts.length}, found=${!!citaOriginal}${citaOriginal ? `, promo="${citaOriginal.promo}", tipoPromo="${citaOriginal.tipoPromo}"` : ''}`);
                if (!citaOriginal && userAppts.length > 0) {
                    console.log(`[${instanceName}] 🔍 PROMO-CHECK IDs disponibles: ${userAppts.map(c => c.id).join(', ')}`);
                }

                if (citaOriginal && citaOriginal.tipoPromo) {
                    // Buscar la promo en el catálogo
                    const promoOriginal = (tenant.promotionsCatalog || []).find(p =>
                        p.nombre && p.nombre.toLowerCase().trim() === citaOriginal.tipoPromo.toLowerCase().trim()
                    );
                    console.log(`[${instanceName}] 🔍 PROMO-CHECK: promoOriginal=${promoOriginal ? `"${promoOriginal.nombre}" aplicaDia="${promoOriginal.aplicaDia}"` : 'NOT FOUND'}, buscando="${citaOriginal.tipoPromo}"`);

                    if (promoOriginal && promoOriginal.aplicaDia && promoOriginal.aplicaDia.trim() !== '') {
                        // Es una promo de DÍA FIJO — verificar si la nueva fecha cumple
                        const weekDaysWarn = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                        let nuevoDia = '';
                        if (reagData.fecha) {
                            const fpW = reagData.fecha.split('/');
                            if (fpW.length === 3) {
                                nuevoDia = weekDaysWarn[new Date(fpW[2], fpW[1] - 1, fpW[0]).getDay()];
                            }
                        }

                        const diasPromo = promoOriginal.aplicaDia.split(',').map(d => d.trim().toLowerCase());
                        const pierdePromo = nuevoDia && !diasPromo.includes(nuevoDia);
                        console.log(`[${instanceName}] 🔍 PROMO-CHECK: nuevoDia="${nuevoDia}", diasPromo=[${diasPromo}], pierdePromo=${pierdePromo}, reagFecha="${reagData.fecha}"`);

                        if (pierdePromo) {
                            // Calcular precio sin descuento
                            const srvNames = reagData.servicios.split(',').map(s => s.trim().toLowerCase());
                            const precioSinDescuento = srvNames.reduce((sum, name) => {
                                const info = tenant.servicesCatalog.find(s => s.name.toLowerCase().trim() === name);
                                return sum + (info ? info.price : 0);
                            }, 0);

                            const warningMsg = `⚠️ *Importante antes de continuar:*\n\n` +
                                `Tu cita actual tiene la promo *${citaOriginal.tipoPromo}* que aplica los *${promoOriginal.aplicaDia}*.\n\n` +
                                `Si la cambias para el *${nuevoDia} ${reagData.fecha}*, perderías el beneficio de la promoción y el precio sería de *$${Number(precioSinDescuento).toLocaleString('es-CO')}* (precio normal sin descuento).\n\n` +
                                `¿Deseas continuar con el reagendamiento de todas formas?\n` +
                                `Responde *sí* para continuar o *no* para mantener tu cita actual con la promo. 💖`;

                            session.promoWarningShown = true;
                            // Actualizar el precio en los datos pendientes al precio sin descuento
                            reagData.precio_total = precioSinDescuento;
                            session.history.push({ role: 'user', content: messageText });
                            session.history.push({ role: 'assistant', content: warningMsg });
                            await evolutionClient.sendText(instanceName, phoneNumber, warningMsg);
                            console.log(`[${instanceName}] ⚠️ Advertencia promo mostrada: ${citaOriginal.tipoPromo} → ${nuevoDia} pierde promo. Esperando re-confirmación.`);
                            return;
                        }
                    }
                }
            }

            // Limpiar flags de advertencia
            session.promoWarningShown = false;
            session.pendingReagendamiento = null;
            session.pendingConfirmation = null;

            if (citaId) {
                console.log(`✅ [${instanceName}] Reagendamiento directo: ${citaId} → ${reagData.fecha} ${reagData.hora_inicio}`);

                const exito = await api.rescheduleAgenda({
                    id: citaId,
                    nuevaFecha: reagData.fecha,
                    nuevoInicio: reagData.hora_inicio,
                    nuevoFin: reagData.hora_fin,
                    nuevosServicios: reagData.servicios,
                    nuevoPrecio: reagData.precio_total,
                    nuevoProfesional: reagData.profesional || 'Por asignar',
                    notasAdicionales: 'Reagendado vía bot WhatsApp'
                });

                let replyMsg;
                if (exito) {
                    replyMsg = `✅ *¡Tu cita ha sido reagendada exitosamente!* 💖\n\n` +
                        `📋 *Nuevos datos de tu cita (${citaId}):*\n` +
                        `· *Servicio:* ${reagData.servicios} ✂️\n` +
                        `· *Fecha:* ${reagData.fecha}\n` +
                        `· *Hora:* ${reagData.hora_inicio} a ${reagData.hora_fin}\n` +
                        `· *Profesional:* ${reagData.profesional}\n` +
                        `· *Precio:* $${Number(reagData.precio_total).toLocaleString('es-CO')}\n\n` +
                        `¡Te esperamos en tu nueva hora! 🌸✨`;
                    console.log(`✅ [${instanceName}] Cita ${citaId} reagendada exitosamente`);
                } else {
                    replyMsg = `❌ Hubo un problema al reagendar tu cita. Por favor intenta de nuevo. 🙏`;
                    console.error(`❌ [${instanceName}] Error al reagendar cita ${citaId}`);
                }

                session.isReagendando = false;
                session.reagendandoCitaId = null;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: replyMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, replyMsg);

                if (exito) {
                    tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);
                    const ownerPhone = tenant.config.ownerPhone;
                    if (ownerPhone) {
                        const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                        const notifMsg = `🔄 *Cita Reagendada*\n\n` +
                            `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                            `📱 Celular: ${phoneNumber}\n` +
                            `🆔 Cita: ${citaId}\n` +
                            `📅 Nueva fecha: ${reagData.fecha} de ${reagData.hora_inicio} a ${reagData.hora_fin}\n` +
                            `✂️ Servicio: ${reagData.servicios}\n` +
                            `👩‍💼 Profesional: ${reagData.profesional}\n` +
                            `💰 Precio: $${Number(reagData.precio_total).toLocaleString('es-CO')}\n` +
                            `🕐 Modificada: ${ahora}\n\n` +
                            `_Notificación automática de ${tenant.config.agentName || 'BeautyOS'}_`;
                        try {
                            await evolutionClient.sendText(instanceName, ownerPhone, notifMsg);
                        } catch (notifErr) {
                            console.error(`[${instanceName}] Error notificación reagendamiento:`, notifErr.message);
                        }
                    }
                }
                return;
            } else {
                // No hay ID de cita — pasar a IA para que pregunte cuál cita reagendar
                console.log(`[${instanceName}] Reagendamiento pendiente pero sin citaId. Pasando a IA.`);
                session.pendingReagendamiento = null;
            }
        } else if (session.pendingReagendamiento && !CONFIRM_REGEX.test(msgNorm)) {
            // ¿Es un rechazo explícito?
            if (DENY_REGEX.test(msgNorm)) {
                console.log(`[${instanceName}] Reagendamiento RECHAZADO por usuario: "${messageText}"`);
                const wasPromoWarning = session.promoWarningShown === true;
                session.pendingReagendamiento = null;
                session.isReagendando = false;
                session.reagendandoCitaId = null;
                session.promoWarningShown = false;
                const cancelMsg = wasPromoWarning
                    ? `¡Perfecto! Tu cita con la promoción se mantiene sin cambios. 💖✨\n\n¿Necesitas algo más?`
                    : `Entendido, no se reagendó ninguna cita. 😊\n\n¿En qué más te puedo ayudar?`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: cancelMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, cancelMsg);
                return;
            }
            // No es confirmación ni rechazo → re-preguntar (mantener datos)
            const rd = session.pendingReagendamiento;
            console.log(`[${instanceName}] Re-preguntando confirmación de reagendamiento. Mensaje no reconocido: "${messageText}"`);
            const reaskMsg = `¿Confirmas el reagendamiento de tu cita? 🤔\n\n` +
                `📋 *Resumen:*\n` +
                `· *Servicio:* ${rd.servicios}\n` +
                `· *Fecha:* ${rd.fecha}\n` +
                `· *Hora:* ${rd.hora_inicio} a ${rd.hora_fin}\n` +
                `· *Profesional:* ${rd.profesional}\n` +
                `· *Precio:* $${Number(rd.precio_total).toLocaleString('es-CO')}\n\n` +
                `Responde *sí* para confirmar o *no* para cancelar.`;
            session.history.push({ role: 'user', content: messageText });
            session.history.push({ role: 'assistant', content: reaskMsg });
            await evolutionClient.sendText(instanceName, phoneNumber, reaskMsg);
            return;
        }

        // ── GUARDA: Si isReagendando + pendingConfirmation, redirigir a pendingReagendamiento ──
        if (session.isReagendando && session.pendingConfirmation && !session.pendingReagendamiento) {
            const citaId = session.reagendandoCitaId;
            if (citaId) {
                console.log(`⚠️ [${instanceName}] GUARDA: pendingConfirmation durante reagendamiento → redirigiendo a pendingReagendamiento (${citaId})`);
                session.pendingReagendamiento = session.pendingConfirmation;
                session.pendingConfirmation = null;
            } else {
                // Sin citaId, intentar resolver
                const userAppts = tenant.pendingAppointments[phoneNumber] || [];
                if (userAppts.length === 1) {
                    session.reagendandoCitaId = userAppts[0].id;
                    console.log(`⚠️ [${instanceName}] GUARDA: Auto-resolvió citaId (${session.reagendandoCitaId}) y redirige a pendingReagendamiento`);
                    session.pendingReagendamiento = session.pendingConfirmation;
                    session.pendingConfirmation = null;
                }
            }
        }

        // ── NUEVA CITA CONFIRMACIÓN (code-level) ──
        if (session.pendingConfirmation) {
            if (CONFIRM_REGEX.test(msgNorm)) {
                const citaData = session.pendingConfirmation;
                session.pendingConfirmation = null;

                console.log(`✅ [${instanceName}] Confirmación directa detectada: "${messageText}" → Guardando cita via api.createAgenda()`);
                session.isReagendando = false;
                session.isCancelando = false;

                // ── Lógica de Anticipo (per-service) ──
                const clientData = session.datos || {};
                const isExempt = clientData.exemptFromPayment === true;
                const { anticipoEnabled, montoAnticipo } = resolveAnticipoForServices(
                    citaData.servicios, tenant.servicesCatalog
                );

                // ── Descuento cumpleanos (desde promo CUMPLEANOS) ──
                let descuentoCumple = 0;
                const clienteInfoBday = tenant.registeredClients[phoneNumber] || {};
                const cumplePromoWh = (tenant.promotionsCatalog || []).find(p =>
                    p.tipoPromo === 'CUMPLEANOS' && p.estado === 'ACTIVO'
                );
                if (cumplePromoWh && clienteInfoBday.cumple) {
                    // Verificar tipo de cliente permitido
                    const cTipoWh = clienteInfoBday.tipo || 'Nuevo';
                    const allowedWh = cumplePromoWh.aplicaTipoCliente === 'TODOS'
                        ? null
                        : cumplePromoWh.aplicaTipoCliente.split(',').map(t => t.trim().toLowerCase());
                    const clientAllowedWh = !allowedWh || allowedWh.includes(cTipoWh.toLowerCase());

                    if (clientAllowedWh) {
                        const nowCol = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
                        const ddNow = String(nowCol.getDate()).padStart(2, '0');
                        const mmNow = String(nowCol.getMonth() + 1).padStart(2, '0');
                        const cumpleDDMM = parseCumpleDDMM(clienteInfoBday.cumple);
                        if (cumpleDDMM === `${ddNow}/${mmNow}`) {
                            const bdayDiscount = cumplePromoWh.valorDescuento || 20;
                            descuentoCumple = Math.round(citaData.precio_total * bdayDiscount / 100);
                            citaData.precio_total = citaData.precio_total - descuentoCumple;
                            citaData.notas_cumple = `DESCUENTO CUMPLE ${bdayDiscount}%: -$${descuentoCumple.toLocaleString('es-CO')}`;
                            console.log(`[${instanceName}] Descuento cumpleanos aplicado: -$${descuentoCumple} -> nuevo total: $${citaData.precio_total}`);
                        }
                    }
                }

                // ── Flujo ANTES: Pedir pago antes de agendar ──
                if (anticipoEnabled && !isExempt && tenant.config.paymentMoment === 'ANTES' && montoAnticipo > 0) {
                    const saldoRestante = citaData.precio_total - montoAnticipo;
                    session.pendingPaymentBeforeBooking = {
                        ...citaData,
                        precioTotal: citaData.precio_total,
                        montoAnticipo: montoAnticipo
                    };

                    const payMsg = `📋 *Resumen de tu cita:*\n` +
                        `· *Servicio:* ${citaData.servicios} ✂️\n` +
                        `· *Fecha:* ${citaData.fecha}\n` +
                        `· *Hora:* ${citaData.hora_inicio} a ${citaData.hora_fin}\n` +
                        `· *Profesional:* ${citaData.profesional}\n` +
                        `· *Precio total:* $${Number(citaData.precio_total).toLocaleString('es-CO')}\n\n` +
                        `💰 Para reservar tu cita, transfiere *$${Number(montoAnticipo).toLocaleString('es-CO')}* de anticipo.\n` +
                        `${tenant.config.paymentPolicy ? '📋 ' + tenant.config.paymentPolicy + '\n\n' : '\n'}` +
                        `📲 *Datos de pago:*\n${tenant.config.paymentInstructions}\n\n` +
                        `💵 Saldo restante al servicio: $${Number(saldoRestante).toLocaleString('es-CO')}\n\n` +
                        `Envía tu comprobante por aquí 📸`;

                    session.history.push({ role: 'user', content: messageText });
                    session.history.push({ role: 'assistant', content: payMsg });
                    await evolutionClient.sendText(instanceName, phoneNumber, payMsg);
                    return;
                }

                // ── Flujo normal (sin anticipo o cliente exento) ──
                const extraPaymentData = {};
                if (anticipoEnabled) {
                    extraPaymentData.exentoAnticipo = isExempt ? 'SI' : 'NO';
                    extraPaymentData.montoAnticipo = montoAnticipo;
                    extraPaymentData.montoPagado = 0;
                    extraPaymentData.saldoRestante = isExempt ? 0 : citaData.precio_total;
                    extraPaymentData.estadoPago = isExempt ? 'EXENTO' : (montoAnticipo > 0 ? 'PENDIENTE_PAGO' : 'EXENTO');
                }

                // ── Detectar si aplica promo (cumpleaños u otra vigente) y CALCULAR descuento en código ──
                let promoFlag = descuentoCumple > 0 ? 'SI' : 'NO';
                let tipoPromoFlag = descuentoCumple > 0 ? 'CUMPLEANOS' : '';
                if (promoFlag === 'NO') {
                    // Verificar promos normales vigentes para el DIA DE LA CITA
                    const weekDaysPromo = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                    // Parsear fecha de la cita para saber qué día es
                    let citaDayName = '';
                    if (citaData.fecha) {
                        const fp = citaData.fecha.split('/');
                        if (fp.length === 3) {
                            const citaDate = new Date(fp[2], fp[1] - 1, fp[0]);
                            citaDayName = weekDaysPromo[citaDate.getDay()];
                        }
                    }
                    const srvNames = citaData.servicios.split(',').map(s => s.trim().toLowerCase());
                    const promosActivas = (tenant.promotionsCatalog || []).filter(p => {
                        if (p.estado !== 'ACTIVO' || p.tipoPromo === 'CUMPLEANOS') return false;
                        if (p.aplicaDia && p.aplicaDia.trim() !== '') {
                            const dias = p.aplicaDia.split(',').map(d => d.trim().toLowerCase());
                            if (citaDayName && !dias.includes(citaDayName)) return false;
                        }
                        // Verificar que la promo aplica al servicio
                        if (p.aplicaServicio && p.aplicaServicio !== 'TODOS') {
                            const srvPromo = p.aplicaServicio.split(',').map(s => s.trim().toLowerCase());
                            const matches = srvNames.some(sn => srvPromo.some(sp => sn.includes(sp) || sp.includes(sn)));
                            if (!matches) return false;
                        }
                        return true;
                    });

                    if (promosActivas.length > 0) {
                        const bestPromo = promosActivas[0];
                        promoFlag = 'SI';
                        tipoPromoFlag = bestPromo.nombre || bestPromo.tipoPromo || 'DESCUENTO';

                        // Calcular precio de catálogo
                        const catalogPrice = srvNames.reduce((sum, name) => {
                            const info = tenant.servicesCatalog.find(s => s.name.toLowerCase().trim() === name);
                            return sum + (info ? info.price : 0);
                        }, 0);

                        // FORZAR el precio con descuento (no confiar en la IA)
                        if (catalogPrice > 0) {
                            let precioFinal = catalogPrice;
                            if (bestPromo.tipoPromo === 'PORCENTAJE') {
                                precioFinal = Math.round(catalogPrice * (1 - bestPromo.valorDescuento / 100));
                            } else if (bestPromo.tipoPromo === 'VALOR_FIJO') {
                                precioFinal = Math.max(0, catalogPrice - bestPromo.valorDescuento);
                            }
                            // 2X1: no cambiar precio aquí (aplica a 2 servicios iguales)
                            if (bestPromo.tipoPromo !== '2X1' && precioFinal !== catalogPrice) {
                                console.log(`[${instanceName}] 🏷️ Promo "${bestPromo.nombre}" aplicada: $${catalogPrice} → $${precioFinal} (${bestPromo.tipoPromo} ${bestPromo.valorDescuento})`);
                                citaData.precio_total = precioFinal;
                            }
                        }
                    }
                }

                const agendaId = await api.createAgenda({
                    fecha: citaData.fecha,
                    inicio: citaData.hora_inicio,
                    fin: citaData.hora_fin,
                    cliente: userData.nombre || 'Cliente',
                    celularCliente: userData.celular || phoneNumber,
                    servicio: citaData.servicios,
                    precio: citaData.precio_total,
                    profesional: citaData.profesional || 'Por asignar',
                    notas: citaData.notas_cumple || '',
                    promo: promoFlag,
                    tipoPromo: tipoPromoFlag,
                    ...extraPaymentData
                });

                let replyMsg;
                if (agendaId) {
                    // ── Flujo DESPUES: Agendar y luego pedir pago ──
                    if (anticipoEnabled && !isExempt && tenant.config.paymentMoment === 'DESPUES' && montoAnticipo > 0) {
                        const saldoRestante = citaData.precio_total - montoAnticipo;
                        session.pendingPaymentAfterBooking = {
                            agendaId: agendaId,
                            precioTotal: citaData.precio_total,
                            montoAnticipo: montoAnticipo,
                            servicios: citaData.servicios
                        };

                        replyMsg = `✅ *¡Tu cita ha sido reservada!* 💖\n\n` +
                            `📋 *Resumen de tu cita:*\n` +
                            `· *Servicio:* ${citaData.servicios} ✂️\n` +
                            `· *Fecha:* ${citaData.fecha}\n` +
                            `· *Hora:* ${citaData.hora_inicio} a ${citaData.hora_fin}\n` +
                            `· *Profesional:* ${citaData.profesional}\n` +
                            `· *Precio total:* $${Number(citaData.precio_total).toLocaleString('es-CO')}\n` +
                            `· *ID Cita:* ${agendaId}\n\n` +
                            `💰 Para confirmar tu asistencia, transfiere *$${Number(montoAnticipo).toLocaleString('es-CO')}* de anticipo.\n` +
                            `${tenant.config.paymentPolicy ? '📋 ' + tenant.config.paymentPolicy + '\n\n' : '\n'}` +
                            `📲 *Datos de pago:*\n${tenant.config.paymentInstructions}\n\n` +
                            `💵 Saldo restante al servicio: $${Number(saldoRestante).toLocaleString('es-CO')}\n\n` +
                            `Envía tu comprobante por aquí 📸`;
                    } else {
                        replyMsg = `✅ *¡Tu cita ha sido agendada exitosamente!* 💖\n\n` +
                            `📋 *Resumen de tu cita:*\n` +
                            `· *Servicio:* ${citaData.servicios} ✂️\n` +
                            `· *Fecha:* ${citaData.fecha}\n` +
                            `· *Hora:* ${citaData.hora_inicio} a ${citaData.hora_fin}\n` +
                            `· *Profesional:* ${citaData.profesional}\n` +
                            `· *Precio:* $${Number(citaData.precio_total).toLocaleString('es-CO')}\n` +
                            `· *ID Cita:* ${agendaId}\n\n` +
                            `¡Te esperamos! 🌸✨`;
                    }
                    console.log(`✅ [${instanceName}] Cita guardada: ${agendaId}`);
                } else {
                    replyMsg = `❌ Hubo un problema al guardar tu cita. Por favor intenta de nuevo o escríbenos para ayudarte. 🙏`;
                    console.error(`❌ [${instanceName}] Error al guardar cita via api.createAgenda()`);
                }

                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: replyMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, replyMsg);

                if (agendaId) {
                    tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);
                    const ownerPhone = tenant.config.ownerPhone;
                    if (ownerPhone) {
                        const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                        const notifMsg = `📋 *Nueva Cita Agendada*\n\n` +
                            `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                            `📱 Celular: ${phoneNumber}\n` +
                            `📅 ${citaData.fecha} de ${citaData.hora_inicio} a ${citaData.hora_fin}\n` +
                            `✂️ Servicio: ${citaData.servicios}\n` +
                            `👩‍💼 Profesional: ${citaData.profesional}\n` +
                            `💰 Precio: $${Number(citaData.precio_total).toLocaleString('es-CO')}\n` +
                            `🆔 ID: ${agendaId}\n` +
                            (montoAnticipo > 0 && !isExempt ? `💳 Anticipo: $${Number(montoAnticipo).toLocaleString('es-CO')} (${tenant.config.paymentMoment === 'DESPUES' ? 'pendiente' : 'por cobrar'})\n` : '') +
                            `🕐 Registrada: ${ahora}\n\n` +
                            `_Notificación automática de ${tenant.config.agentName || 'BeautyOS'}_`;
                        try {
                            await evolutionClient.sendText(instanceName, ownerPhone, notifMsg);
                            console.log(`[${instanceName}] Notificación enviada a dueña (${ownerPhone})`);
                        } catch (notifErr) {
                            console.error(`[${instanceName}] Error notificación dueña:`, notifErr.message);
                        }
                    }
                }
                return;
            } else {
                // ¿Es un rechazo explícito?
                if (DENY_REGEX.test(msgNorm)) {
                    console.log(`[${instanceName}] Nueva cita RECHAZADA por usuario: "${messageText}"`);
                    session.pendingConfirmation = null;
                    const cancelMsg = `Entendido, no se agendó la cita. 😊\n\n¿En qué más te puedo ayudar?`;
                    session.history.push({ role: 'user', content: messageText });
                    session.history.push({ role: 'assistant', content: cancelMsg });
                    await evolutionClient.sendText(instanceName, phoneNumber, cancelMsg);
                    return;
                }
                // No es confirmación ni rechazo → re-preguntar (mantener datos)
                const cd = session.pendingConfirmation;
                console.log(`[${instanceName}] Re-preguntando confirmación de cita. Mensaje no reconocido: "${messageText}"`);

                // Calcular precio con descuento para mostrar en el re-ask
                let reaskPrecio = cd.precio_total;
                const weekDaysReask = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                let reaskDayName = '';
                if (cd.fecha) {
                    const fpR = cd.fecha.split('/');
                    if (fpR.length === 3) {
                        reaskDayName = weekDaysReask[new Date(fpR[2], fpR[1] - 1, fpR[0]).getDay()];
                    }
                }
                const srvNamesReask = cd.servicios.split(',').map(s => s.trim().toLowerCase());
                const promoReask = (tenant.promotionsCatalog || []).find(p => {
                    if (p.estado !== 'ACTIVO' || p.tipoPromo === 'CUMPLEANOS') return false;
                    if (p.aplicaDia && p.aplicaDia.trim() !== '') {
                        const dias = p.aplicaDia.split(',').map(d => d.trim().toLowerCase());
                        if (reaskDayName && !dias.includes(reaskDayName)) return false;
                    }
                    if (p.aplicaServicio && p.aplicaServicio !== 'TODOS') {
                        const srvPromo = p.aplicaServicio.split(',').map(s => s.trim().toLowerCase());
                        if (!srvNamesReask.some(sn => srvPromo.some(sp => sn.includes(sp) || sp.includes(sn)))) return false;
                    }
                    return true;
                });
                if (promoReask) {
                    const catalogPriceReask = srvNamesReask.reduce((sum, name) => {
                        const info = tenant.servicesCatalog.find(s => s.name.toLowerCase().trim() === name);
                        return sum + (info ? info.price : 0);
                    }, 0);
                    if (catalogPriceReask > 0 && promoReask.tipoPromo === 'PORCENTAJE') {
                        reaskPrecio = Math.round(catalogPriceReask * (1 - promoReask.valorDescuento / 100));
                    } else if (catalogPriceReask > 0 && promoReask.tipoPromo === 'VALOR_FIJO') {
                        reaskPrecio = Math.max(0, catalogPriceReask - promoReask.valorDescuento);
                    }
                }

                const promoReaskLabel = promoReask ? `\n· *Promo:* ${promoReask.nombre} 🎉` : '';
                const reaskMsg = `¿Confirmas tu cita? 🤔\n\n` +
                    `📋 *Resumen:*\n` +
                    `· *Servicio:* ${cd.servicios}\n` +
                    `· *Fecha:* ${cd.fecha}\n` +
                    `· *Hora:* ${cd.hora_inicio} a ${cd.hora_fin}\n` +
                    `· *Profesional:* ${cd.profesional}\n` +
                    `· *Precio:* $${Number(reaskPrecio).toLocaleString('es-CO')}${promoReaskLabel}\n\n` +
                    `Responde *sí* para confirmar o *no* para cancelar.`;
                session.history.push({ role: 'user', content: messageText });
                session.history.push({ role: 'assistant', content: reaskMsg });
                await evolutionClient.sendText(instanceName, phoneNumber, reaskMsg);
                return;
            }
        }

        } // fin de if (!isComercial) — bloques de salon

        // ── Captura comercial controlada por servidor ──
        // Las preguntas de formulario se generan aquí, no por la IA. Esto
        // conserva el mismo dato pendiente cuando la respuesta es ambigua o
        // cuando el prospecto escribe de forma informal.
        if (isComercial && commercialCaptureState?.directReply) {
            const directReply = commercialCaptureState.directReply;
            const nextField = commercialCaptureState.inputKind === 'opt_out'
                ? ''
                : commercialCaptureState.requiredField;
            setCommercialAwaitingField(session, nextField);

            session.history.push({ role: 'user', content: messageText });
            session.history.push({ role: 'assistant', content: directReply });
            if (session.history.length > 8) session.history.splice(0, 2);

            await evolutionClient.sendText(instanceName, phoneNumber, directReply);
            return;
        }

        // ── Respuesta de IA (OpenAI con Function Calling) ��─
        // Inyectar datos comerciales en config para openai.js
        if (isComercial) {
            tenant.config.tenantType = 'comercial';
            tenant.config._clientesCRM = tenant.clientesCRM || {};
        }

        let userPendingAppointments = [];
        let allPendingAppointments = [];
        if (!isComercial) {
            try {
                const liveAppointments = await loadPendingAppointments(tenant.sheetId);
                userPendingAppointments = liveAppointments[phoneNumber] || [];
                tenant.pendingAppointments = liveAppointments;
                allPendingAppointments = Object.values(liveAppointments).flat();
            } catch (e) {
                userPendingAppointments = tenant.pendingAppointments[phoneNumber] || [];
                allPendingAppointments = Object.values(tenant.pendingAppointments || {}).flat();
            }
        }

        let aiReply = await generateAIResponse(
            messageText,
            tenant.config,
            tenant.servicesCatalog,
            tenant.knowledgeCatalog,
            session.history,
            userData,
            userPendingAppointments,
            tenant.promotionsCatalog || [],
            tenant.disponibilidadCatalog || [],
            tenant.colaboradoresCatalog || [],
            allPendingAppointments,
            session,
            tenant.serviceGallery || {},
            tenant.promoUsage || {},
            tenant.festivosConfig || []
        );

        // Una duda de producto se responde con IA, pero el servidor vuelve a
        // anexar la pregunta cerrada del mismo campo. Así no se reinicia el
        // registro ni una respuesta posterior se interpreta como otro dato.
        if (isComercial && commercialCaptureState?.resumeQuestion) {
            const normalizedReply = normalizeCommercialText(aiReply).replace(/\s+/g, ' ').trim();
            const normalizedQuestion = normalizeCommercialText(commercialCaptureState.resumeQuestion).replace(/\s+/g, ' ').trim();
            if (!normalizedReply.includes(normalizedQuestion)) {
                aiReply = String(aiReply || '').trim() + '\n\n' + commercialCaptureState.resumeQuestion;
            }
        }

        // Recordar cuál fue la pregunta concreta de Sofi. Esto permite que
        // una respuesta breve en el siguiente turno se guarde sin adivinar.
        // La autorización solo se habilita con el perfil ya validado.
        if (isComercial) {
            const registroCompleto = Boolean(
                session._commercialRegistrationComplete
                || session._leadCapturado
                || session.estado === 'LEAD_EXISTENTE'
            );
            if (registroCompleto) {
                // Una pregunta de producto nunca puede dejar armada una
                // autorización pendiente ni un campo de formulario. Así un
                // "sí" posterior conserva el contexto de la explicación.
                setCommercialAwaitingField(session, '');
            } else {
                const requiredField = getCommercialNextExpectedField(session);
                const serverResumedField = commercialCaptureState?.resumeQuestion
                    ? requiredField
                    : '';
                const aiAskedField = inferCommercialExpectedField(aiReply);
                const nextAwaitingField = serverResumedField
                    || (aiAskedField === requiredField ? aiAskedField : '');
                setCommercialAwaitingField(session, nextAwaitingField);
            }
        }

        // Actualizar historial de conversación
        session.history.push({ role: 'user', content: messageText });
        session.history.push({ role: 'assistant', content: aiReply });

        // Economía de tokens: mantener solo los últimos 8 mensajes
        if (session.history.length > 8) {
            session.history.splice(0, 2);
        }

        // Enviar respuesta de IA vía Evolution API
        await evolutionClient.sendText(instanceName, phoneNumber, aiReply);

        // ── Enviar galería multimedia si la IA lo solicitó ──
        if (session._pendingGalleryMedia) {
            const gallery = session._pendingGalleryMedia;
            console.log(`[${instanceName}] 📸 Enviando galería: ${gallery.items.length} item(s) de ${gallery.serviceName}`);

            for (const item of gallery.items) {
                try {
                    // Recomendaciones se envían como texto, no como media
                    if (item.category === 'recomendacion') {
                        const recText = `📋 *${item.title}*\n${item.description || ''}`;
                        await evolutionClient.sendText(instanceName, phoneNumber, recText);
                    } else {
                        const directUrl = convertDriveUrl(item.url);
                        const mediaType = item.type === 'imagen' ? 'image' : item.type === 'video' ? 'video' : 'document';
                        const caption = item.title + (item.description ? '\n' + item.description : '');
                        const fileName = item.type === 'documento' ? (item.title.replace(/[^a-zA-Z0-9áéíóúñ ]/g, '') + '.pdf') : '';

                        await evolutionClient.sendMedia(instanceName, phoneNumber, mediaType, directUrl, caption, fileName);
                    }

                    // Delay entre envíos para no saturar
                    if (gallery.items.length > 1) {
                        await new Promise(r => setTimeout(r, 1500));
                    }
                } catch (mediaErr) {
                    console.error(`[${instanceName}] Error enviando media "${item.title}":`, mediaErr.message);
                }
            }

            console.log(`[${instanceName}] ✅ Galería enviada: ${gallery.items.length} item(s) de ${gallery.serviceName}`);
            delete session._pendingGalleryMedia;
        }

        // ── Enviar media de promoción si la IA lo solicitó ──
        if (session._pendingPromoMedia) {
            const promoMedia = session._pendingPromoMedia;
            try {
                const directUrl = convertDriveUrl(promoMedia.url);
                const mediaType = promoMedia.type === 'imagen' ? 'image' : promoMedia.type === 'video' ? 'video' : 'document';
                const fileName = promoMedia.type === 'documento' ? (promoMedia.promoName.replace(/[^a-zA-Z0-9áéíóúñ ]/g, '') + '.pdf') : '';
                await evolutionClient.sendMedia(instanceName, phoneNumber, mediaType, directUrl, promoMedia.promoName, fileName);
                console.log(`[${instanceName}] 📸 Media de promo "${promoMedia.promoName}" enviada`);
            } catch (promoMediaErr) {
                console.error(`[${instanceName}] Error enviando media promo "${promoMedia.promoName}":`, promoMediaErr.message);
            }
            delete session._pendingPromoMedia;
        }

        // ═══════════════════════════════════════════════════════════
        // ── GUARDRAILS COMERCIALES: Captura + Estados por CÓDIGO ──
        // No dependemos de la IA — todo se fuerza desde aquí
        // ═══════════════════════════════════════════════════════════
        if (isComercial) {
            const crmUrl = tenant.crmUrl || tenant.config?.crmBeautyosUrl;
            const msgLower = messageText.toLowerCase().trim();
            const allUserMsgs = session.history.filter(h => h.role === 'user').map(h => h.content.toLowerCase()).join(' ');

            // ── 0. DETECCIÓN DE EMOJIS: marcar para que Sofi haga preguntas cerradas ──
            const emojiOnly = /^[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\s👍👎❤️😊😂🤔💪🙏✅❌🔥💯😍🤩😎👏🙌💰✨🎉👀🤷‍♀️🤷‍♂️]+$/u;
            if (emojiOnly.test(messageText.trim()) || messageText.trim().length <= 3) {
                session._emojiResponder = true;
            }

            // ── 1. INICIALIZAR DATOS PARCIALES ──
            if (!session._datosCaptura) session._datosCaptura = {};

            // ── 1a. DETECTAR EMAIL en el mensaje actual ──
            if (!session._datosCaptura.email) {
                const emailMatch = messageText.match(/[\w.+-]+@[\w-]+\.[\w.]+/i);
                if (emailMatch) {
                    session._datosCaptura.email = emailMatch[0].toLowerCase();
                    console.log(`[${instanceName}] 📧 Email detectado: ${emailMatch[0]}`);
                }
            }

            // ── 1b. DETECTAR EMPLEADOS en el mensaje actual (para cualquier estado) ──
            if (!session._datosCaptura.empleados && crmUrl) {
                const mLow = messageText.toLowerCase();
                let emp = '';
                if (mLow.match(/\b(solo\s*yo|sola\b|yo\s+sol[oa]|trabajo\s+sol[oa]|independiente|[uú]nico\s+empleado|yo\s+soy\s+el\s+[uú]nico)\b/i)) emp = 'Solo yo';
                else if (mLow.match(/\b(tengo\s+[2-5]|somos\s+[2-5]|[2-5]\s+(?:emplead|persona|trabajador|estilista|colaborador|chic[oa]s?))\b/i)) emp = '2 a 5';
                else if (mLow.match(/\b(tengo\s+(?:[6-9]|10)|somos\s+(?:[6-9]|10)|(?:[6-9]|10)\s+(?:emplead|persona|trabajador))\b/i)) emp = '6 a 10';
                else if (mLow.match(/\b(tengo\s+(?:1[1-9]|[2-9]\d)|(?:1[1-9]|[2-9]\d)\s+(?:emplead|persona)|m[aá]s\s+de\s+(?:10|diez))\b/i)) emp = '11 o mas';
                if (emp) {
                    session._datosCaptura.empleados = emp;
                    // Si ya se capturó el lead, actualizar empleados en GAS
                    if (session._leadCapturado) {
                        try {
                            await api.postToCRM(crmUrl, { action: 'updateLeadEmpleados', whatsapp: phoneNumber, cantidadEmpleados: emp });
                            console.log(`[${instanceName}] 👥 Empleados: ${phoneNumber} → ${emp}`);
                        } catch (err) { /* no crítico */ }
                    }
                }
            }

            // ── 2. TRANSICIÓN DE ESTADOS: detectar señales y actualizar GAS ──
            if ((session.estado === 'LEAD_EXISTENTE' || session._leadCapturado) && !session._leadPerdido && crmUrl) {
                const estadoActual = session.datos?.estadoLead || 'NUEVO';
                let nuevoEstado = null;
                let motivo = '';

                // RECHAZO → contar y cerrar como PERDIDO al 2do "no"
                // Colombianismos: "no pilla", "no me copa", "eso no es pa mi", "nel", "nah", "paso"
                const RECHAZO_REGEX = /\b(no\s+(?:me\s+)?(?:interesa|quiero|gracias|necesito|copa|convence|sirve|llama\s+la\s+atencion)|no\s+gracias|ya\s+tengo|no\s+(?:por\s+)?ahora|no\s+(?:lo\s+)?necesito|no\s+(?:me\s+)?(?:parece|gusta)|paso|nel\b|nah\b|eso\s+no\s+es\s+(?:pa|para)\s+m[ií]|no\s+estoy\s+interesad[oa]|dejalo\s+as[ií]|no\s+va|olv[ií]da(?:lo|te)|no\s+(?:me\s+)?late)\b/i;
                if (RECHAZO_REGEX.test(msgLower)) {
                    if (!session._rechazosCount) session._rechazosCount = 0;
                    session._rechazosCount++;
                    if (session._rechazosCount >= 2) {
                        const userMsgs = session.history.filter(h => h.role === 'user').map(h => h.content);
                        nuevoEstado = 'PERDIDO';
                        motivo = userMsgs.slice(-3).join(' | ') || 'No interesado';
                        session._leadPerdido = true;
                    }
                }

                // INTERÉS EN PRECIOS → NEGOCIANDO
                // Colombianismos: "a cómo es", "qué vale eso", "cuánto me sale"
                const PRECIO_REGEX = /\b(cuanto\s+(?:cuesta|vale|es|sale|cobran)|precio|valor|que\s+(?:cuesta|vale)|tarifas?|cotiza|a\s+c[oó]mo\s+(?:es|sale|queda)|cu[aá]nto\s+(?:me\s+)?(?:sale|queda|cobran|toca\s+pagar)|qu[eé]\s+(?:tan\s+)?caro|cuanto\s+(?:hay\s+que\s+)?pagar)/i;
                if (!nuevoEstado && PRECIO_REGEX.test(msgLower) && ['NUEVO', 'CONTACTADO'].includes(estadoActual)) {
                    nuevoEstado = 'NEGOCIANDO';
                    motivo = 'Preguntó por precios';
                }

                // QUIERE COMPRAR → GANADO
                // Solo frases de CIERRE REAL — no "si me gustaría" genérico
                const COMPRA_REGEX = /\b(quiero\s+(?:contratar|empezar|arrancar|adquirir|comprar|iniciar|obtener|tomar|el\s+servicio)|gustar[ií]a\s+(?:empezar|arrancar|contratar|adquirir|iniciar|obtener|tomar|el\s+servicio)|d[oó]nde\s+pago|como\s+(?:pago|hago\s+(?:pa|para)\s+pagar)|me\s+(?:inscribo|registro|anoto|apunto)|listo\s+(?:iniciemos|empecemos|arranquemos|comenzamos|para\s+empezar|dale)|hag[aá]mosle|hag[aá]moslo|vamos\s+(?:con\s+eso|a\s+darle)|dele\s+pues|met[aá]le|arranquemos|iniciemos|empecemos|comenzamos|cuando\s+(?:empezamos|arrancamos|iniciamos)|(?:si\s+)?(?:me\s+)?gustar[ií]a\s+obtener|(?:quiero|deseo)\s+(?:el\s+)?servicio|(?:si\s+)?(?:estoy\s+)?interesad[oa]\s+en\s+(?:adquirir|contratar|obtener|tomar))\b/i;
                if (!nuevoEstado && COMPRA_REGEX.test(msgLower)) {
                    nuevoEstado = 'GANADO';
                    motivo = 'Confirmó intención de compra';
                }

                // PIDE TIEMPO → SEGUIMIENTO
                // Colombianismos: "déjame camellar y después hablamos", "toca cuadrar con mi socio"
                const SEGUIMIENTO_REGEX = /\b((?:lo\s+)?(?:voy\s+a\s+)?(?:pensar|mirar|consultar|revisar|analizar|estudiar)|despu[eé]s\s+te\s+(?:cuento|aviso|escribo|digo)|m[aá]s\s+adelante|ahora\s+no\s+(?:puedo|tengo)|dame\s+(?:unos\s+)?d[ií]as|(?:la|esta)\s+(?:pr[oó]xima\s+)?semana|(?:me\s+)?(?:toca|necesito)\s+(?:cuadrar|hablar|consultar)|voy\s+a\s+(?:mirar|ver)\s+(?:si\s+)?(?:vale\s+la\s+pena|me\s+conviene)|luego\s+(?:te\s+)?(?:cuento|aviso|escribo|hablamos)|despu[eé]s\s+hablamos|(?:tengo\s+que\s+)?(?:hablarlo|consultarlo)\s+con\s+mi\s+(?:soci[oa]|espos[oa]|pareja))\b/i;
                if (!nuevoEstado && SEGUIMIENTO_REGEX.test(msgLower) && ['NUEVO', 'CONTACTADO', 'NEGOCIANDO'].includes(estadoActual)) {
                    nuevoEstado = 'SEGUIMIENTO';
                    motivo = 'Pide tiempo para decidir';
                }

                // INTERÉS GENERAL (responde positivo) → CONTACTADO
                // Colombianismos: "de una", "va pues", "listo", "suena bien", "a ver"
                const CONTACTO_REGEX = /\b(s[ií]\b|claro|dale|me\s+interesa|cu[eé]ntame|como\s+funciona|quiero\s+saber|de\s+una|va\s+pues|listo|bueno|suena\s+(?:bien|interesante|chévere|chevere)|a\s+ver|dime\s+m[aá]s|cont[aá]me|qu[eé]\s+(?:incluye|tiene|ofrece)|me\s+llama\s+la\s+atenci[oó]n|chévere|chevere|bacano|genial|interesante)\b/i;
                if (!nuevoEstado && CONTACTO_REGEX.test(msgLower) && estadoActual === 'NUEVO') {
                    nuevoEstado = 'CONTACTADO';
                    motivo = 'Mostró interés inicial';
                }

                // Aplicar cambio de estado si se detectó uno
                if (nuevoEstado && nuevoEstado !== estadoActual) {
                    try {
                        await api.postToCRM(crmUrl, {
                            action: 'updateLeadByWhatsapp',
                            whatsapp: phoneNumber,
                            estado: nuevoEstado,
                            notas: motivo
                        });
                        if (session.datos) session.datos.estadoLead = nuevoEstado;
                        const emoji = { CONTACTADO: '📞', NEGOCIANDO: '💰', SEGUIMIENTO: '⏳', GANADO: '🎉', PERDIDO: '⛔' };
                        console.log(`[${instanceName}] ${emoji[nuevoEstado] || '📊'} Lead ${phoneNumber}: ${estadoActual} → ${nuevoEstado} (${motivo})`);

                        // GANADO: alertar al asesor para onboarding
                        if (nuevoEstado === 'GANADO') {
                            const asesores = (tenant.config?.whatsappAsesores || '').split(',').map(n => n.trim()).filter(Boolean);
                            if (asesores.length > 0) {
                                const nombre = session.datos?.nombre || '';
                                const negocio = session.datos?.negocio || session._leadCapturado || '';
                                const alertMsg = `*🎉 NEGOCIO CERRADO*\n\n👤 ${nombre}\n💼 ${negocio}\n📱 ${phoneNumber}\n\n👉 Iniciar onboarding técnico.`;
                                if (!session._pendingTransferMessages) session._pendingTransferMessages = [];
                                session._pendingTransferMessages.push({ to: asesores[0], text: alertMsg });
                            }
                        }
                    } catch (err) {
                        console.error(`[${instanceName}] Error actualizando estado:`, err.message);
                    }
                }
            }
        }

        // ── Enviar mensajes de transferencia a asesores (comercial) ──
        if (session._pendingTransferMessages) {
            for (const msg of session._pendingTransferMessages) {
                try {
                    await evolutionClient.sendText(instanceName, msg.to, msg.text);
                    console.log(`[${instanceName}] 📤 Transferencia enviada a asesor ${msg.to}`);
                } catch (transferErr) {
                    console.error(`[${instanceName}] Error enviando transferencia a ${msg.to}:`, transferErr.message);
                }
                await new Promise(r => setTimeout(r, 1000));
            }
            delete session._pendingTransferMessages;
        }

        // ── Capturar ID de cita de la respuesta IA (para reagendamiento/cancelación) ──
        if ((session.isReagendando || session.isCancelando) && !session.reagendandoCitaId) {
            const aiIdMatch = aiReply.match(/AG-[A-Z]+-\d{3}/i);
            if (aiIdMatch) {
                session.reagendandoCitaId = aiIdMatch[0].toUpperCase();
                console.log(`[${instanceName}] 🎯 Cita ID capturado de respuesta IA: ${session.reagendandoCitaId}`);
            }
        }

        // ── Detectar acción REAL en agenda (via _lastToolAction de openai.js) ──
        const toolAction = session._lastToolAction;
        if (toolAction === 'cita_creada' || toolAction === 'cita_reagendada') {
            console.log(`[${instanceName}] Acción en agenda via IA tool: ${toolAction}. Refrescando...`);
            session.isReagendando = false;
            session.isCancelando = false;
            session.reagendandoCitaId = null;
            session.pendingConfirmation = null;
            session.pendingReagendamiento = null;
            session._lastToolAction = null;
            session.promoLossAcceptedFor = null;
            session.promoWarningShown = false;
            session.pendingPromoWarning = null;
            session.stylistAsked = false;
            tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);

            // ── Notificación WhatsApp a la dueña ──
            const ownerPhone = tenant.config.ownerPhone;
            if (ownerPhone) {
                const clienteNombre = userData.nombre || 'Cliente';
                const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                const notifMsg = `📋 *Actividad en Agenda*\n\n` +
                    `👤 Cliente: *${clienteNombre}*\n` +
                    `📱 Celular: ${phoneNumber}\n` +
                    `🕐 Registrada: ${ahora}\n\n` +
                    `📝 Detalle del bot:\n${aiReply}\n\n` +
                    `_Notificación automática de ${tenant.config.agentName || 'BeautyOS'}_`;

                try {
                    await evolutionClient.sendText(instanceName, ownerPhone, notifMsg);
                    console.log(`[${instanceName}] Notificación enviada a dueña (${ownerPhone})`);
                } catch (notifErr) {
                    console.error(`[${instanceName}] Error enviando notificación a dueña:`, notifErr.message);
                }
            }
        }

        // ── Red de seguridad: si isReagendando/isCancelando pero la IA no avanzó, guiar al usuario ──
        if (session.isReagendando && !session.pendingReagendamiento && !session.pendingConfirmation && !toolAction) {
            // La IA respondió pero NO verificó disponibilidad ni guardó datos de reagendamiento
            // Verificar si la respuesta de la IA ya está guiando al usuario (preguntando cuál cita, qué hora, etc.)
            const iaEstaGuiando = /cu[aá]l cita|qu[eé] cita|qu[eé] hora|qu[eé] fecha|qu[eé] d[ií]a|selecciona|elige|escoge/i.test(aiReply);
            if (!iaEstaGuiando) {
                // La IA no está guiando al usuario — agregar guía complementaria
                const userAppts = tenant.pendingAppointments[phoneNumber] || [];
                if (userAppts.length === 0) {
                    console.log(`[${instanceName}] ⚠️ Reagendamiento activo pero usuario sin citas. Desactivando.`);
                    session.isReagendando = false;
                } else {
                    console.log(`[${instanceName}] ⚠️ Reagendamiento activo pero IA no avanzó. Recordando al usuario.`);
                }
            }
        }

        // Si se canceló una cita (via IA tool cancelar_cita), refrescar y notificar
        if (toolAction === 'cita_cancelada') {
            console.log(`[${instanceName}] Cancelación detectada via IA tool. Refrescando citas...`);
            session.isCancelando = false;
            session.isReagendando = false;
            session.reagendandoCitaId = null;
            session.pendingConfirmation = null;
            session.pendingReagendamiento = null;
            session._lastToolAction = null;
            session.promoLossAcceptedFor = null;
            session.promoWarningShown = false;
            session.pendingPromoWarning = null;
            session.stylistAsked = false;
            tenant.pendingAppointments = await loadPendingAppointments(tenant.sheetId);

            const ownerPhone = tenant.config.ownerPhone;
            if (ownerPhone) {
                const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                const notifMsg = `🚫 *Cita Cancelada*\n\n` +
                    `👤 Cliente: *${userData.nombre || 'Cliente'}*\n` +
                    `📱 Celular: ${phoneNumber}\n` +
                    `🕐 Cancelada: ${ahora}\n\n` +
                    `📝 Detalle:\n${aiReply}\n\n` +
                    `_Notificación automática de ${tenant.config.agentName || 'BeautyOS'}_`;
                try {
                    await evolutionClient.sendText(instanceName, ownerPhone, notifMsg);
                    console.log(`[${instanceName}] Notificación de cancelación enviada a dueña`);
                } catch (notifErr) {
                    console.error(`[${instanceName}] Error notificación cancelación:`, notifErr.message);
                }
            }
        }

    } catch (error) {
        console.error('[WEBHOOK] Error procesando mensaje:', error.message);
    }
}

/**
 * POST /webhook/evolution
 * Punto de entrada principal para TODOS los eventos de Evolution API.
 * Evolution recibe 200 de inmediato y las conversaciones se encolan por
 * instancia + WhatsApp para que un audio no adelante ni desordene un texto.
 */
router.post('/evolution', (req, res) => {
    res.status(200).json({ received: true });

    const { event, instance, data } = req.body || {};
    if (event === 'connection.update' || event === 'CONNECTION_UPDATE'
        || event === 'qrcode.updated' || event === 'QRCODE_UPDATED') {
        void processEvolutionWebhookEvent(event, instance, data);
        return;
    }

    if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') return;
    if (!data?.key || data.key.fromMe) return;

    const remoteJid = data.key.remoteJid || '';
    if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.includes('@g.us')) return;

    const messageId = String(data.key.id || '');
    if (!acceptIncomingMessage(instance, messageId)) {
        console.log(`[${instance}] ↩️ Evento duplicado ignorado: ${messageId || 'sin-id'}`);
        return;
    }

    const conversationKey = `${instance || 'unknown'}:${remoteJid}`;
    void enqueueConversationTask(conversationKey, () => processEvolutionWebhookEvent(event, instance, data))
        .catch(error => console.error(`[WEBHOOK] Error no controlado en cola ${conversationKey}:`, error.message));
});

module.exports = {
    router,
    setEvolutionClient,
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
    isPositiveCommercialAuthorization,
    isNegativeCommercialAuthorization,
    isExplicitCommercialAuthorizationReopen
};
