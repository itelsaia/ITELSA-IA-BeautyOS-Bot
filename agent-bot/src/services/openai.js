const { OpenAI } = require("openai");
const api = require('./api');

// ============================================================
// Definición de herramientas (Function Calling) para OpenAI
// ============================================================
const TOOLS = [
    {
        type: "function",
        function: {
            name: "verificar_disponibilidad",
            description: "Verifica la disponibilidad de horarios para un servicio en una fecha. OBLIGATORIO: Llama SIEMPRE a esta función ANTES de ofrecer, aceptar o rechazar cualquier horario. Nunca asumas ni inventes disponibilidad sin consultar esta función primero.",
            parameters: {
                type: "object",
                properties: {
                    fecha: {
                        type: "string",
                        description: "Fecha a consultar en formato DD/MM/YYYY. Ejemplo: 11/03/2026"
                    },
                    hora_deseada: {
                        type: "string",
                        description: "Hora específica que desea el cliente en formato HH:MM (24h). Ejemplo: 15:00 para las 3 PM, 09:00 para las 9 AM. Si no especificó hora, omite este campo para ver todos los horarios."
                    },
                    servicio: {
                        type: "string",
                        description: "Nombre del servicio usando TIPO_SERVICIO_OFICIAL del catálogo."
                    },
                    profesional_preferido: {
                        type: "string",
                        description: "Nombre del profesional preferido. Solo incluir si el cliente lo mencionó explícitamente."
                    }
                },
                required: ["fecha", "servicio"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "agendar_cita",
            description: "Agenda una nueva cita para el cliente en el sistema. Llama a esta función SOLO cuando el cliente haya confirmado explícitamente la fecha, hora y servicios que desea, y DESPUÉS de haber verificado disponibilidad con 'verificar_disponibilidad'.",
            parameters: {
                type: "object",
                properties: {
                    fecha: {
                        type: "string",
                        description: "Fecha de la cita en formato DD/MM/YYYY. Ejemplo: 06/03/2026"
                    },
                    hora_inicio: {
                        type: "string",
                        description: "Hora de inicio en formato HH:MM (24h). Ejemplo: 10:00"
                    },
                    hora_fin: {
                        type: "string",
                        description: "Hora estimada de fin calculada sumando la duración de todos los servicios. Ejemplo: 11:10"
                    },
                    servicios: {
                        type: "string",
                        description: "Nombre(s) del/los servicio(s) agendados usando el TIPO_SERVICIO_OFICIAL del catálogo. Si son varios, separados por coma. Ejemplo: Diseño de cejas, Corte de cabello para dama"
                    },
                    precio_total: {
                        type: "number",
                        description: "Precio total numérico en COP sin puntos ni signos. Ejemplo: 45000"
                    },
                    profesional: {
                        type: "string",
                        description: "Nombre EXACTO del profesional asignado. Debe coincidir con un nombre del EQUIPO DE TRABAJO. Usa 'Por asignar' SOLO si no hay colaboradores registrados."
                    },
                    notas: {
                        type: "string",
                        description: "Notas adicionales opcionales de la cita. Puede estar vacío."
                    }
                },
                required: ["fecha", "hora_inicio", "hora_fin", "servicios", "precio_total", "profesional"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "reagendar_cita",
            description: "Reagenda una cita EXISTENTE (PENDIENTE). Marca la cita antigua como REAGENDADO y crea una nueva. Usa esta función cuando el cliente pida cambiar su cita actual — ya sea la fecha, la hora o los servicios.",
            parameters: {
                type: "object",
                properties: {
                    id_cita_antigua: {
                        type: "string",
                        description: "El ID de la cita existente que se va a reagendar. Ejemplo: AGD-001"
                    },
                    nueva_fecha: {
                        type: "string",
                        description: "Nueva fecha de la cita en formato DD/MM/YYYY."
                    },
                    nueva_hora_inicio: {
                        type: "string",
                        description: "Nueva hora de inicio en formato HH:MM (24h)."
                    },
                    nueva_hora_fin: {
                        type: "string",
                        description: "Nueva hora estimada de fin."
                    },
                    nuevos_servicios: {
                        type: "string",
                        description: "Nombre(s) del/los nuevo(s) servicio(s) usando TIPO_SERVICIO_OFICIAL."
                    },
                    nuevo_precio_total: {
                        type: "number",
                        description: "Nuevo precio total en COP."
                    },
                    nuevo_profesional: {
                        type: "string",
                        description: "Nombre EXACTO del profesional para la nueva cita. Puede ser el mismo anterior u otro disponible."
                    },
                    notas: {
                        type: "string",
                        description: "Notas adicionales opcionales."
                    }
                },
                required: ["id_cita_antigua", "nueva_fecha", "nueva_hora_inicio", "nueva_hora_fin", "nuevos_servicios", "nuevo_precio_total", "nuevo_profesional"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "cancelar_cita",
            description: "Cancela una cita EXISTENTE (PENDIENTE o REAGENDADO). Cambia su estado a CANCELADA. Usa esta función cuando el cliente confirme que desea cancelar su cita.",
            parameters: {
                type: "object",
                properties: {
                    id_cita: {
                        type: "string",
                        description: "El ID de la cita a cancelar. Ejemplo: AG-CS-001"
                    },
                    motivo: {
                        type: "string",
                        description: "Motivo de la cancelación dado por el cliente. Puede estar vacío."
                    }
                },
                required: ["id_cita"]
            }
        }
    }
];

// ============================================================
// Helpers de cálculo de disponibilidad (Backend Inteligente)
// ============================================================
const toMin = (t) => { const p = (t||'0:0').split(':').map(Number); return p[0]*60+(p[1]||0); };
const fromMin = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const normDay = (s) => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function subtractRange(slots, start, end) {
    const result = [];
    slots.forEach(([s, e]) => {
        if (start >= e || end <= s) { result.push([s, e]); }
        else {
            if (s < start) result.push([s, start]);
            if (end < e) result.push([end, e]);
        }
    });
    return result;
}

/**
 * Calcula los rangos libres de un profesional en una fecha específica.
 * @returns {Array|null} Array de rangos [start, end] en minutos, o null si cerrado
 */
function computeFreeSlots(fecha, dayName, profName, profId, disponibilidadCatalog, allPendingAppointments, bufferMin, excludeAgendaId) {
    bufferMin = bufferMin || 0;
    const jornadas = disponibilidadCatalog.filter(d => d.tipo === 'Jornada');
    const bloqueos = disponibilidadCatalog.filter(d => d.tipo === 'Bloqueo');

    const jornada = jornadas.find(j => normDay(j.fechaDia) === normDay(dayName));
    if (!jornada) return null;

    let free = [[toMin(jornada.horaIni), toMin(jornada.horaFin)]];

    // Restar bloqueos generales (TODOS)
    bloqueos.filter(b => b.aplicaA === 'TODOS').forEach(b => {
        let applies = false;
        if (b.horario === 'DIARIO' && normDay(b.fechaDia) === normDay(dayName)) applies = true;
        if (b.horario === 'UNICO' && b.fechaDia === fecha) applies = true;
        if (b.horario.startsWith('RANGO:')) {
            const pf = (f) => { const p = f.split('/'); return p.length === 3 ? new Date(p[2], p[1] - 1, p[0]) : null; };
            const fi = pf(b.fechaDia), ff = pf(b.horario.replace('RANGO:', '')), fc = pf(fecha);
            if (fi && ff && fc && fc >= fi && fc <= ff) applies = true;
        }
        if (applies) free = subtractRange(free, toMin(b.horaIni), toMin(b.horaFin));
    });

    // Restar bloqueos del profesional
    if (profId) {
        bloqueos.filter(b => b.aplicaA === profId).forEach(b => {
            let applies = false;
            if (b.horario === 'DIARIO' && normDay(b.fechaDia) === normDay(dayName)) applies = true;
            if (b.horario === 'UNICO' && b.fechaDia === fecha) applies = true;
            if (b.horario.startsWith('RANGO:')) {
                const pf = (f) => { const p = f.split('/'); return p.length === 3 ? new Date(p[2], p[1] - 1, p[0]) : null; };
                const fi = pf(b.fechaDia), ff = pf(b.horario.replace('RANGO:', '')), fc = pf(fecha);
                if (fi && ff && fc && fc >= fi && fc <= ff) applies = true;
            }
            if (applies) {
                if (b.horaIni === '00:00' && b.horaFin === '23:59') free = [];
                else free = subtractRange(free, toMin(b.horaIni), toMin(b.horaFin));
            }
        });
    }

    // Restar citas existentes del profesional en esa fecha (+ buffer de limpieza)
    // Si estamos reagendando, excluir la cita actual para no bloquear su propio horario
    allPendingAppointments.filter(a =>
        a.fecha === fecha && (a.profesional || '').toLowerCase() === profName.toLowerCase()
        && (!excludeAgendaId || a.id !== excludeAgendaId)
    ).forEach(a => {
        free = subtractRange(free, toMin(a.inicio), toMin(a.fin) + bufferMin);
    });

    return free;
}

/**
 * Selecciona slots óptimos distribuidos en mañana y tarde, priorizando cercanía a citas existentes.
 * Evita mostrar slots solapados (ej: 09:00, 09:15, 09:30 para un servicio de 30min).
 * @param {Array} allSlots - Todos los slots disponibles
 * @param {number} serviceDuration - Duración del servicio en minutos
 * @param {Array} appointments - Citas existentes del día
 * @param {string} fecha - Fecha en formato DD/MM/YYYY
 * @param {number} maxSlots - Máximo de slots a retornar
 */
function selectOptimalSlots(allSlots, serviceDuration, appointments, fecha, maxSlots) {
    if (allSlots.length <= maxSlots) return allSlots;

    const sorted = [...allSlots].sort((a, b) => a.minutos - b.minutos);

    // Paso 1: Espaciar — solo mantener slots no solapados (>= duración servicio entre sí)
    const spaced = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].minutos >= spaced[spaced.length - 1].minutos + serviceDuration) {
            spaced.push(sorted[i]);
        }
    }
    if (spaced.length <= maxSlots) return spaced;

    // Paso 2: Puntuar por cercanía a citas existentes (llenar huecos = mayor productividad)
    const scores = new Map();
    spaced.forEach(slot => {
        let score = 0;
        const profAppts = appointments.filter(a =>
            a.fecha === fecha && (a.profesional || '').toLowerCase() === slot.profesional.toLowerCase()
        );
        profAppts.forEach(a => {
            const gapAfterAppt = Math.abs(slot.minutos - toMin(a.fin));
            const gapBeforeAppt = Math.abs(toMin(a.inicio) - toMin(slot.hora_fin));
            const gap = Math.min(gapAfterAppt, gapBeforeAppt);
            if (gap <= 30) score += 10;      // adyacente → máxima prioridad
            else if (gap <= 60) score += 5;  // cercano → prioridad media
        });
        scores.set(slot, score);
    });

    // Paso 3: Distribuir entre mañana (<12:00) y tarde (>=12:00)
    const am = spaced.filter(s => s.minutos < 720);
    const pm = spaced.filter(s => s.minutos >= 720);
    const selected = [];

    if (am.length > 0 && pm.length > 0) {
        const amCount = Math.ceil(maxSlots / 2);
        const pmCount = maxSlots - amCount;
        am.sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0));
        pm.sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0));
        selected.push(...am.slice(0, amCount));
        selected.push(...pm.slice(0, pmCount));
    } else {
        const src = am.length > 0 ? am : pm;
        src.sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0));
        selected.push(...src.slice(0, maxSlots));
    }

    return selected.sort((a, b) => a.minutos - b.minutos);
}

/**
 * Procesa la función verificar_disponibilidad.
 * Retorna texto descriptivo para que la IA le responda al cliente.
 */
function handleVerificarDisponibilidad(args, servicesCatalog, colaboradoresCatalog, disponibilidadCatalog, allPendingAppointments, todayStr, nowTimeStr, config, excludeAgendaId) {
    const { fecha, hora_deseada, servicio, profesional_preferido } = args;
    const slotInterval = (config && config.slotInterval) || 15;
    const bufferMin = (config && config.bufferTime) || 15;

    console.log(`🔍 verificar_disponibilidad: servicio="${servicio}" fecha=${fecha} hora=${hora_deseada || '(cualquiera)'} prof=${profesional_preferido || '(cualquiera)'} [slots:${slotInterval}min, buffer:${bufferMin}min]`);

    // Buscar info del servicio
    const serviceInfo = servicesCatalog.find(s => normDay(s.name) === normDay(servicio));
    const serviceDuration = serviceInfo ? (parseInt(serviceInfo.timeMins) || 40) : 40;
    const servicePrice = serviceInfo ? serviceInfo.price : 0;
    const serviceName = serviceInfo ? serviceInfo.name : servicio;

    // Calcular día de la semana para la fecha solicitada
    const dateParts = fecha.split('/');
    if (dateParts.length !== 3) {
        return `❌ Fecha inválida: "${fecha}". Usa formato DD/MM/YYYY.`;
    }
    const requestedDate = new Date(dateParts[2], dateParts[1] - 1, dateParts[0]);
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const dayName = dayNames[requestedDate.getDay()];

    // Filtrar profesionales por competencia
    let candidates = colaboradoresCatalog.filter(c => {
        if (!c.competencias || c.competencias.trim() === '' || normDay(c.competencias) === normDay('Todos los servicios')) return true;
        return c.competencias.split(',').some(comp => normDay(comp.trim()) === normDay(servicio));
    });

    // Si pidió profesional específico, usar solo ese
    if (profesional_preferido) {
        const preferred = colaboradoresCatalog.find(c =>
            c.nombre.toLowerCase().trim() === profesional_preferido.toLowerCase().trim()
        );
        if (preferred) {
            candidates = [preferred];
        } else {
            return `❌ No existe un profesional llamado "${profesional_preferido}" en el equipo. Profesionales disponibles: ${colaboradoresCatalog.map(c => c.nombre).join(', ')}.`;
        }
    }

    if (candidates.length === 0) {
        return `❌ Ningún profesional del equipo domina el servicio "${serviceName}". Profesionales disponibles: ${colaboradoresCatalog.map(c => `${c.nombre} (${c.competencias || 'sin especialidad'})`).join(', ')}.`;
    }

    // Calcular slots disponibles por profesional
    const allAvailableSlots = [];
    candidates.forEach(prof => {
        const freeRanges = computeFreeSlots(fecha, dayName, prof.nombre, prof.id, disponibilidadCatalog, allPendingAppointments, bufferMin, excludeAgendaId);
        if (!freeRanges || freeRanges.length === 0) return;

        // Generar slots donde quepa el servicio completo (intervalo configurable)
        // Alinear al reloj: si rango libre empieza en 14:55 y intervalo es 15, primer slot = 15:00
        freeRanges.forEach(([s, e]) => {
            const alignedStart = Math.ceil(s / slotInterval) * slotInterval;
            for (let m = alignedStart; m + serviceDuration <= e; m += slotInterval) {
                allAvailableSlots.push({
                    profesional: prof.nombre,
                    hora_inicio: fromMin(m),
                    hora_fin: fromMin(m + serviceDuration),
                    minutos: m
                });
            }
        });
    });

    // Filtrar horas pasadas si es HOY
    const isToday = fecha === todayStr;
    const nowMin = toMin(nowTimeStr);
    const futureSlots = isToday
        ? allAvailableSlots.filter(s => s.minutos > nowMin)
        : allAvailableSlots;

    // Si pidió profesional específico y NO tiene disponibilidad, buscar alternativas con otros profesionales
    if (profesional_preferido && futureSlots.length === 0) {
        const otherCandidates = colaboradoresCatalog.filter(c => {
            if (c.nombre.toLowerCase().trim() === profesional_preferido.toLowerCase().trim()) return false;
            if (!c.competencias || c.competencias.trim() === '' || normDay(c.competencias) === normDay('Todos los servicios')) return true;
            return c.competencias.split(',').some(comp => normDay(comp.trim()) === normDay(servicio));
        });

        const altSlots = [];
        otherCandidates.forEach(prof => {
            const freeRanges = computeFreeSlots(fecha, dayName, prof.nombre, prof.id, disponibilidadCatalog, allPendingAppointments, bufferMin, excludeAgendaId);
            if (!freeRanges || freeRanges.length === 0) return;
            freeRanges.forEach(([s, e]) => {
                const alignedStart = Math.ceil(s / slotInterval) * slotInterval;
                for (let m = alignedStart; m + serviceDuration <= e; m += slotInterval) {
                    altSlots.push({ profesional: prof.nombre, hora_inicio: fromMin(m), hora_fin: fromMin(m + serviceDuration), minutos: m });
                }
            });
        });
        const altFutureSlots = isToday ? altSlots.filter(s => s.minutos > nowMin) : altSlots;

        if (altFutureSlots.length > 0) {
            const optimalAlt = selectOptimalSlots(altFutureSlots, serviceDuration, allPendingAppointments, fecha, 6);
            const altText = optimalAlt.map(s =>
                `• ${s.hora_inicio} a ${s.hora_fin} con ${s.profesional}`
            ).join('\n');
            console.log(`⚠️ ${profesional_preferido} sin disponibilidad. Alternativas con otros profesionales: ${optimalAlt.map(s => `${s.profesional} ${s.hora_inicio}`).join(', ')}`);
            return `❌ ${profesional_preferido} NO tiene disponibilidad para ${serviceName} el ${fecha}.\n` +
                `Sin embargo, otros profesionales también realizan ${serviceName}:\n${altText}\n` +
                `Precio: $${Number(servicePrice).toLocaleString('es-CO')}\n` +
                `→ Infórmale al cliente que ${profesional_preferido} no está disponible ese día pero que tiene excelentes opciones con otros profesionales. Ofrécele estas alternativas de forma amable.`;
        } else {
            return `❌ NO HAY DISPONIBILIDAD para ${serviceName} el ${fecha} con ningún profesional del equipo. Sugiere otro día al cliente.`;
        }
    }

    // Si pidió hora específica
    if (hora_deseada) {
        const requestedMin = toMin(hora_deseada);
        const match = futureSlots.find(s => s.minutos === requestedMin);

        if (match) {
            // ✅ HORA DISPONIBLE — retornar objeto con datos para confirmación directa
            console.log(`✅ DISPONIBLE: ${serviceName} ${fecha} ${match.hora_inicio}-${match.hora_fin} con ${match.profesional}`);
            const text = `✅ CONFIRMADO POR EL SISTEMA: La hora ${match.hora_inicio} ESTÁ DISPONIBLE.\n` +
                `Profesional asignado: ${match.profesional}\n` +
                `Servicio: ${serviceName}\n` +
                `Fecha: ${fecha}\n` +
                `Horario: ${match.hora_inicio} a ${match.hora_fin}\n` +
                `Precio: $${Number(servicePrice).toLocaleString('es-CO')}\n\n` +
                `→ Presenta este resumen al cliente y pregúntale si confirma para agendar.`;
            return {
                text,
                confirmationData: {
                    fecha,
                    hora_inicio: match.hora_inicio,
                    hora_fin: match.hora_fin,
                    servicios: serviceName,
                    precio_total: servicePrice,
                    profesional: match.profesional
                }
            };
        } else {
            // ❌ HORA NO DISPONIBLE — ofrecer alternativas
            const alternatives = selectOptimalSlots(futureSlots, serviceDuration, allPendingAppointments, fecha, 6);
            console.log(`❌ NO DISPONIBLE: ${hora_deseada} el ${fecha}. Alternativas óptimas: ${alternatives.map(s => s.hora_inicio).join(', ')}`);

            if (alternatives.length === 0) {
                return `❌ NO HAY DISPONIBILIDAD para ${serviceName} el ${fecha}. Sugiere otro día al cliente.`;
            }

            const altText = alternatives.map(s =>
                `• ${s.hora_inicio} a ${s.hora_fin} con ${s.profesional}`
            ).join('\n');
            return `❌ La hora ${hora_deseada} NO está disponible para ${serviceName} el ${fecha}.\n` +
                `Horarios alternativos disponibles:\n${altText}\n` +
                `Precio: $${Number(servicePrice).toLocaleString('es-CO')}\n` +
                `→ Ofrécele estas opciones al cliente de forma amable.`;
        }
    } else {
        // Sin hora específica — mostrar todos los disponibles
        if (futureSlots.length === 0) {
            return `❌ NO HAY DISPONIBILIDAD para ${serviceName} el ${fecha}. Sugiere otro día al cliente.`;
        }

        const optimalSlots = selectOptimalSlots(futureSlots, serviceDuration, allPendingAppointments, fecha, 8);
        const slotsText = optimalSlots.map(s =>
            `• ${s.hora_inicio} a ${s.hora_fin} con ${s.profesional}`
        ).join('\n');
        console.log(`📋 Slots óptimos para ${serviceName} ${fecha}: ${optimalSlots.map(s => s.hora_inicio).join(', ')}`);
        return `📋 Horarios disponibles para ${serviceName} el ${fecha}:\n${slotsText}\n` +
            `Precio: $${Number(servicePrice).toLocaleString('es-CO')}\n` +
            `→ Ofrécele estas opciones al cliente y pregúntale cuál prefiere.`;
    }
}

// ============================================================
// Filtro de promociones vigentes para el día actual
// ============================================================
function filterActivePromotions(promotionsCatalog, nowColombia, todayDayName) {
    return promotionsCatalog.filter(p => {
        if (p.estado !== 'ACTIVO') return false;
        if (p.vence) {
            const parts = p.vence.split('/');
            if (parts.length === 3) {
                const venceDate = new Date(parts[2], parts[1] - 1, parts[0]);
                venceDate.setHours(23, 59, 59);
                if (venceDate < nowColombia) return false;
            }
        }
        if (p.aplicaDia && p.aplicaDia.trim() !== '') {
            const diasAplicables = p.aplicaDia.split(',').map(d => d.trim().toLowerCase());
            if (!diasAplicables.includes(todayDayName.toLowerCase())) return false;
        }
        return true;
    });
}

// ============================================================
// Función principal de respuesta de IA
// ============================================================
async function generateAIResponse(
    incomingMessage,
    config,
    servicesCatalog,
    knowledgeCatalog = [],
    messageHistory = [],
    userData = {},
    userPendingAppointments = [],
    promotionsCatalog = [],
    disponibilidadCatalog = [],
    colaboradoresCatalog = [],
    allPendingAppointments = [],
    session = null
) {
    if (!config.openApiKey || config.openApiKey === "sk-..." || config.openApiKey === "PEGAR_AQUI_API_KEY") {
        console.error("🔴 Bloqueo OpenAI: API Key no configurada.");
        return "Disculpa, el servicio de inteligencia artificial no está configurado correctamente. Contacta al administrador.";
    }

    try {
        const openai = new OpenAI({ apiKey: config.openApiKey });

        // 1. Construir contexto de servicios
        const catalogText = servicesCatalog.map(s => {
            let line = `- ID_INTERNO: ${s.id} | Categoría: ${s.category} | Intención_Búsqueda: ${s.intent} | TIPO_SERVICIO_OFICIAL: ${s.name} | Info/Precio: ${s.response} | Tiempo: ${s.timeMins} min | PRECIO_NUMERICO: COP ${s.price}`;
            if (s.anticipoEnabled) {
                const label = s.anticipoType === 'PORCENTAJE'
                    ? `${s.anticipoValue}% del precio`
                    : `$${Number(s.anticipoValue).toLocaleString('es-CO')} fijos`;
                line += ` | ANTICIPO: ${label}`;
            }
            return line;
        }).join('\n');

        // 2. Construir conocimiento RAG
        const knowledgeText = knowledgeCatalog.map(k =>
            `- Si preguntan por: "${k.intent}", responde: "${k.response}". Enlace ${k.mediaType}: ${k.url}`
        ).join('\n');

        // 3. Construir contexto de citas PENDIENTES del usuario
        let pendingAppointmentsText = "El cliente no tiene citas activas registradas.";
        if (userPendingAppointments.length > 0) {
            pendingAppointmentsText = `⚠️ ATENCIÓN: El cliente TIENE las siguientes citas PENDIENTES:\n` +
                userPendingAppointments.map(c =>
                    `  - ID: ${c.id} | Fecha: ${c.fecha} | Hora: ${c.inicio}-${c.fin} | Profesional: ${c.profesional || 'Por asignar'} | Servicio: ${c.servicio} | Precio: $${c.precio} | Estado pago: ${c.estadoPago || 'N/A'}`
                ).join('\n') +
                `\n→ Si el usuario pide cambiar o modificar su cita, usa la herramienta 'reagendar_cita' con el ID_CITA arriba indicado.\n→ Tener citas pendientes NO impide agendar nuevas citas. El cliente puede tener múltiples citas.` +
                `\n→ RECORDATORIO: Si el cliente saluda o inicia una nueva conversación, recuérdale amablemente sus citas pendientes de forma natural (no como lista robótica). Pregúntale si necesita algo con ellas (reagendar, cancelar, o confirmar asistencia).`;
        }

        // 4. Calcular fecha y hora actual en Colombia (UTC-5)
        const nowColombia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        const dd = String(nowColombia.getDate()).padStart(2, '0');
        const mm = String(nowColombia.getMonth() + 1).padStart(2, '0');
        const yyyy = nowColombia.getFullYear();
        const hh = String(nowColombia.getHours()).padStart(2, '0');
        const min = String(nowColombia.getMinutes()).padStart(2, '0');
        const todayStr = `${dd}/${mm}/${yyyy}`;
        const nowTimeStr = `${hh}:${min}`;
        const weekDays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        const todayDayName = weekDays[nowColombia.getDay()];

        // 4b. Filtrar promociones activas para hoy
        const activePromotions = filterActivePromotions(promotionsCatalog, nowColombia, todayDayName);
        let promotionsText = "No hay promociones activas para hoy.";
        if (activePromotions.length > 0) {
            promotionsText = activePromotions.map(p => {
                let descuentoLabel = '';
                if (p.tipoPromo === 'PORCENTAJE') descuentoLabel = `${p.valorDescuento}% de descuento`;
                else if (p.tipoPromo === '2X1') descuentoLabel = '2x1 (segundo gratis)';
                else if (p.tipoPromo === 'VALOR_FIJO') descuentoLabel = `$${p.valorDescuento.toLocaleString('es-CO')} de descuento`;
                return `- PROMO: ${p.nombre} | ${p.descripcion} | Descuento: ${descuentoLabel} | Aplica a: ${p.aplicaServicio} | Dias: ${p.aplicaDia} | Valida hasta: ${p.vence}`;
            }).join('\n');
        }

        // 5. Prompt del sistema — ARQUITECTURA "BACKEND INTELIGENTE"
        // La IA NO calcula disponibilidad. Usa verificar_disponibilidad para que el código haga la matemática.
        const businessRules = `
---
📊 FECHA Y HORA ACTUAL (Colombia - Zona horaria oficial):
📅 HOY ES: ${todayStr} (${todayDayName})
⏰ HORA ACTUAL: ${nowTimeStr}
⚠️ REGLA CRÍTICA: Cuando el usuario diga "mañana", la fecha es ${(() => { const d = new Date(nowColombia); d.setDate(d.getDate() + 1); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); })()}. USA SIEMPRE formato DD/MM/YYYY. NUNCA uses fechas de años anteriores.

📋 REGLAS DE COMPORTAMIENTO:
1. CONVERSACIÓN FLUIDA: Estás en WhatsApp. NUNCA saludes si el usuario está en medio de una conversación. Ve directo al grano.
2. MONEDA: Colombia. Precios en COP con punto de miles (ej. $25.000). Al sumar, suma los números y da total en dinero y tiempo.
3. CÓDIGOS OCULTOS: Nunca muestres ID_INTERNO ni PRECIO_NUMERICO puro. Siempre formato peso colombiano.
4. RESUMEN: Al acordar servicios con el usuario, presenta resumen organizado (servicio, precio, tiempo) antes de confirmar y agendar.
5. CONOCIMIENTO: Solo responde con info del catálogo. Si piden algo fuera del catálogo, di que no ofreces ese servicio aún.
6. ESTÉTICA Y EMPATÍA: Incluye emojis de belleza (💅, 💇‍♀️, 💆‍♀️, ✨, 🌸, 💖) en tus respuestas.
7. MULTIMEDIA: Envía el enlace URL exacto cuando sea persuasivo o el usuario lo pida. NUNCA inventes URLs.
8. AGENDAMIENTO: Para agendar usa TIPO_SERVICIO_OFICIAL del catálogo como nombre del servicio guardado.
9. CONFIRMACIÓN = ACCIÓN INMEDIATA: Antes de guardar, presenta el resumen y espera confirmación. Cuando el cliente responda con CUALQUIER expresión afirmativa — ejemplos: "Sí", "Si", "Dale", "Confirmo", "Confirmado", "OK", "Ok", "Perfecto", "De acuerdo", "Claro", "Listo", "Vale", "Aprobado", "Bueno", "Está bien", "Por supuesto", "Obvio", "Sip", "Sep", "Hagale", "Hagámosle", "Vamos", "Sale", "Hecho", "Ya", "Venga", "Adelante", "Correcto", "Exacto", "Así es", "Procede", "Agéndame", "Resérvame", "Genial", "Súper", "Excelente", "Me parece bien", "Va", "Eso", "Todo bien", "Agende", o CUALQUIER otra variante afirmativa — DEBES llamar INMEDIATAMENTE a la función 'agendar_cita' (o 'reagendar_cita'). NUNCA respondas solo con texto diciendo "confirmada" — EJECUTA la función. Sin ejecutar la función, la cita NO se guarda en el sistema.
10. REAGENDAMIENTO: Si el usuario quiere cambiar su cita:
   a) Si tiene MÚLTIPLES citas pendientes, PRIMERO pregúntale CUÁL cita quiere modificar (muéstralas con fecha, hora, servicio e ID para que elija).
   b) Una vez identificada la cita, pregúntale qué quiere cambiar: ¿la fecha/hora, el servicio, o ambos?
   c) Si dice "ambos" o da un servicio nuevo directamente, NO crees una cita nueva. Sigue el flujo de REAGENDAMIENTO: pregúntale la nueva fecha/hora y usa el servicio mencionado como el NUEVO servicio del reagendamiento.
   d) Verifica disponibilidad con 'verificar_disponibilidad' para la nueva fecha/hora.
   e) Presenta el resumen del cambio y espera confirmación.
   f) Llama a 'reagendar_cita' con el ID de la cita antigua y los nuevos datos.
   ⚠️ CRÍTICO: Mientras estés en flujo de reagendamiento, TODO lo que diga el cliente (servicios, fechas, horas) es para MODIFICAR la cita existente. NUNCA llames a 'agendar_cita' durante un reagendamiento — SIEMPRE usa 'reagendar_cita'. Si el cliente menciona un servicio diferente, es porque quiere CAMBIAR el servicio de su cita, NO crear una nueva.
   ⚠️ GUÍA PASO A PASO: Lleva al cliente paso a paso. Si dice "ambos", primero pregunta "¿Qué servicio deseas ahora?" y luego "¿Para qué fecha y hora?". No intentes resolver todo en un solo paso.
11. PROMOCIONES: Si hay promociones vigentes hoy, mencionalas brevemente en tu primer mensaje. Al agendar, aplica el descuento si corresponde y muestra el desglose (precio normal → descuento → precio final). Usa el precio CON descuento en precio_total al llamar a 'agendar_cita'.
12. CANCELACIÓN DE CITAS: Si el usuario quiere cancelar una cita:
   a) Si tiene MÚLTIPLES citas pendientes, pregúntale CUÁL cita quiere cancelar (muéstralas con fecha, hora, servicio e ID).
   b) Si el cliente dice "ambas", "las dos", "todas", "las tres", o cualquier expresión que indique TODAS las citas, confirma: "¿Estás segura de que quieres cancelar TODAS tus citas pendientes?" y si confirma, llama a 'cancelar_cita' UNA VEZ POR CADA CITA (primero una, luego la otra).
   c) Una vez identificada la cita, pregúntale si está seguro de cancelar (muestra resumen de la cita).
   d) Cuando confirme, llama a 'cancelar_cita' con el ID de la cita.
   e) NUNCA canceles una cita sin confirmación explícita del usuario.
   f) Tras cancelar, infórmale que el horario queda libre y pregúntale si desea agendar una nueva cita.
13. RETENCIÓN DE CONTEXTO: Cuando el cliente cambia el servicio, profesional o cualquier dato pero NO menciona una nueva fecha u hora, MANTÉN la fecha y hora originalmente solicitada en la conversación. Ejemplo: si pidió "pestañas para el sábado a las 10am" y luego cambia a "entonces cejas", la fecha sigue siendo el sábado a las 10am. Solo cambia lo que el cliente pidió cambiar explícitamente.

📅 ESTADO DE CITAS ACTUALES DEL CLIENTE:
${pendingAppointmentsText}

🛍️ CATÁLOGO DE SERVICIOS DISPONIBLES:
${catalogText}

🎉 PROMOCIONES VIGENTES HOY (${todayDayName}):
${promotionsText}

📌 REGLAS DE DESCUENTO:
- PORCENTAJE: precio_original × (1 - valor/100). Ej: $25.000 con 20% = $20.000
- 2X1: Si pide 2 servicios iguales, cobra solo 1 (el segundo es gratis). Si pide 1 solo, NO aplica.
- VALOR_FIJO: precio_original - valor_descuento. Ej: $25.000 con $5.000 off = $20.000
- Al presentar el resumen, muestra: ~precio original~ → precio con descuento.

👥 EQUIPO DE TRABAJO:
${colaboradoresCatalog.length > 0 ? colaboradoresCatalog.map(c => `  - ${c.nombre} (${c.rol}) | Especialidades: ${c.competencias || 'Todos los servicios'}`).join('\n') : 'No hay colaboradores registrados.'}

⏱️ TIEMPOS DEL NEGOCIO:
- Intervalo de agenda: cada ${config.slotInterval || 15} minutos
- Buffer entre citas: ${config.bufferTime || 15} minutos (limpieza/preparación)
- La función 'verificar_disponibilidad' ya considera estos tiempos automáticamente.

🔄 ESTADO ACTUAL DEL FLUJO:
${session && session.isReagendando ? `⚠️ MODO REAGENDAMIENTO ACTIVO — Cita objetivo: ${session.reagendandoCitaId || 'POR IDENTIFICAR'}. TODO lo que el cliente diga sobre servicios, fechas u horas es para MODIFICAR esta cita. USA 'reagendar_cita', NUNCA 'agendar_cita'.` : session && session.isCancelando ? `⚠️ MODO CANCELACIÓN ACTIVO — El cliente quiere cancelar una cita. Guíalo para identificar cuál(es) y confirmar.` : '✅ Modo normal — El cliente puede consultar, agendar nuevas citas o pedir otros servicios.'}

⚠️ VERIFICACIÓN DE DISPONIBILIDAD — REGLA OBLIGATORIA:
- Tú NO tienes información sobre horarios disponibles. NO puedes saber si una hora está libre o no.
- Para CUALQUIER consulta de disponibilidad, SIEMPRE llama a la función 'verificar_disponibilidad'.
- NUNCA rechaces ni aceptes un horario sin haber llamado primero a 'verificar_disponibilidad'.
- NUNCA inventes ni supongas horarios. SOLO ofrece lo que 'verificar_disponibilidad' te devuelva.
- La función hace todo el cálculo: filtra por competencias, verifica bloqueos, cruza agendas y asigna al mejor profesional.
- Si el cliente pide un profesional específico, pásalo como 'profesional_preferido'.
- Si NO pide profesional, la función asigna automáticamente al mejor disponible.

📝 FLUJO DE AGENDAMIENTO:
1. Cliente pide servicio + fecha + hora → llama 'verificar_disponibilidad'
2. Si la función dice ✅ DISPONIBLE → presenta resumen al cliente y espera confirmación
3. Si la función dice ❌ NO DISPONIBLE → ofrece las alternativas que devolvió la función
4. Cliente confirma con CUALQUIER expresión afirmativa (sí, dale, ok, vale, confirmo, listo, bueno, hagale, claro, perfecto, etc.) → llama 'agendar_cita' OBLIGATORIAMENTE con los datos del resumen
⚠️ REGLA CRÍTICA: En el paso 4, DEBES ejecutar 'agendar_cita'. Si solo respondes con texto sin llamar a la función, la cita NO se guardará en el sistema y el cliente quedará sin cita. NUNCA saltes el paso 1 ni el paso 4.
⚠️ Si no estás seguro si el mensaje es una confirmación, asume que SÍ lo es y ejecuta 'agendar_cita'.

🗣️ LENGUAJE CON EL CLIENTE:
- NUNCA uses palabras como "bloqueado", "bloqueo", "restricción" ni "no disponible por bloqueo". El cliente NO debe saber que existen bloqueos internos.
- Cuando rechaces una hora, di: "Para esa hora no tenemos disponibilidad" o "Ese horario ya está ocupado".
- SIEMPRE sugiere horarios alternativos cercanos.
- Si un día está cerrado, di: "Ese día no estamos atendiendo" en vez de explicar jornadas.
- Si un colaborador no está disponible y la función ofrece alternativas con OTROS profesionales, di: "En este momento [nombre] no se encuentra disponible, pero [otro nombre] también realiza [servicio] y tiene disponibilidad." Presenta los horarios alternativos. NUNCA reveles el motivo interno (vacaciones, bloqueo, etc.).

📚 BASE DE CONOCIMIENTO / MULTIMEDIA:
${knowledgeText.length > 0 ? knowledgeText : "No hay material multimedia cargado."}

${config.hasAnyAnticipo ? `
💰 SISTEMA DE ANTICIPO / PAGO ANTICIPADO (POR SERVICIO):
- Algunos servicios de este negocio requieren anticipo para confirmar la cita.
- Cada servicio tiene su propio anticipo (fijo o porcentaje). Consulta el catálogo arriba para ver cuáles.
- Momento: ${config.paymentMoment === 'ANTES' ? 'El cliente debe pagar ANTES de agendar la cita.' : 'Se agenda primero y luego el cliente debe enviar el comprobante.'}
- Datos de pago: ${config.paymentInstructions}
${config.paymentPolicy ? '- Política: ' + config.paymentPolicy : ''}

📋 REGLAS DE ANTICIPO:
1. ANTES de presentar el resumen, consulta si el servicio solicitado requiere anticipo (columna ANTICIPO en el catálogo).
2. Si requiere anticipo, informa amablemente el monto SUGERIDO y la política.
3. Incluye los datos de pago (Nequi, Daviplata, cuenta bancaria, etc.) para que el cliente sepa dónde transferir.
4. Después de agendar (si MOMENTO=DESPUES), recuérdale que envíe el comprobante de pago por este mismo chat.
5. Si el cliente es EXENTO de anticipo, NO pidas pago. Flujo normal sin condiciones.
6. Si el servicio NO tiene anticipo, flujo normal sin mencionar pagos anticipados.
7. NUNCA rechaces o cuestiones el comprobante tú mismo — el sistema lo valida automáticamente.
8. El cliente puede pagar el anticipo sugerido, más, o incluso el servicio completo. Cualquier monto es válido.
9. Muestra siempre el SALDO RESTANTE (precio total - monto pagado) que se pagará al momento del servicio.
` : ''}
---
`;

        const userName = userData.nombre || "Cliente";
        const systemFinalPrompt = `${config.systemPrompt || "Eres un asistente virtual amable y conciso."}\n\nEstás hablando con: ${userName}\n\n${businessRules}`;

        const messages = [
            { role: 'system', content: systemFinalPrompt },
            ...messageHistory,
            { role: 'user', content: incomingMessage }
        ];

        // DEBUG
        console.log('\n=== DEBUG PROMPT IA ===');
        console.log('📅 Fecha/Hora:', todayStr, nowTimeStr, todayDayName);
        console.log('👥 Equipo:', colaboradoresCatalog.map(c => `${c.nombre}(${c.competencias || 'todas'})`).join(', '));
        console.log('📋 Agenda total:', allPendingAppointments.length, 'citas pendientes');
        console.log('💬 Historial enviado (' + messageHistory.length + ' msgs):');
        messageHistory.forEach((m, i) => {
            console.log(`  [${i}] ${m.role}: ${(m.content || '').substring(0, 120)}...`);
        });
        console.log('🏗️ Arquitectura: Backend Inteligente (IA usa verificar_disponibilidad)');
        console.log('=== FIN DEBUG ===\n');

        // 5. Primera llamada a OpenAI
        let completion = await openai.chat.completions.create({
            model: config.aiModel || "gpt-4o-mini",
            messages: messages,
            tools: TOOLS,
            tool_choice: "auto",
            temperature: 0.5,
            max_tokens: 1000
        });

        let responseMessage = completion.choices[0].message;

        // Safety net: Si la IA habla de "verificar" pero NO llamó herramienta (truncamiento por tokens),
        // reintentar forzando el uso de herramienta
        const aiText = (responseMessage.content || '').toLowerCase();
        const noToolCalled = !responseMessage.tool_calls || responseMessage.tool_calls.length === 0;
        const shouldHaveCalledTool = /verificar|verificando|disponibilidad|voy a (consultar|revisar|checar|buscar)/i.test(aiText);

        if (noToolCalled && shouldHaveCalledTool) {
            console.log('⚠️ IA mencionó verificar pero NO llamó herramienta. Reintentando con tool_choice: required');
            completion = await openai.chat.completions.create({
                model: config.aiModel || "gpt-4o-mini",
                messages: messages,
                tools: TOOLS,
                tool_choice: "required",
                temperature: 0.3,
                max_tokens: 1000
            });
            responseMessage = completion.choices[0].message;
        }

        // 6. ¿La IA quiere ejecutar una herramienta?
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            const toolCall = responseMessage.tool_calls[0];
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);

            console.log(`🔧 IA solicitó herramienta: ${functionName}`, functionArgs);

            let toolResultText = "";

            // ─── Herramienta: verificar_disponibilidad ──────────────────
            if (functionName === "verificar_disponibilidad") {
                // Si estamos reagendando, pasar el ID de la cita para excluir su horario del cálculo
                const excludeId = (session && session.isReagendando && session.reagendandoCitaId) ? session.reagendandoCitaId : null;
                const verifyResult = handleVerificarDisponibilidad(
                    functionArgs,
                    servicesCatalog,
                    colaboradoresCatalog,
                    disponibilidadCatalog,
                    allPendingAppointments,
                    todayStr,
                    nowTimeStr,
                    config,
                    excludeId
                );

                // Si retornó objeto con confirmationData, guardar en session para confirmación directa
                if (typeof verifyResult === 'object' && verifyResult.confirmationData) {
                    toolResultText = verifyResult.text;
                    if (session) {
                        if (session.isReagendando && session.reagendandoCitaId) {
                            // Reagendamiento: SOLO si ya se identificó cuál cita reagendar
                            session.pendingReagendamiento = verifyResult.confirmationData;
                            session.pendingConfirmation = null;
                            console.log('📌 Datos de REAGENDAMIENTO guardados (cita: ' + session.reagendandoCitaId + '):', JSON.stringify(verifyResult.confirmationData));
                        } else {
                            // Nueva cita (o reagendamiento sin cita identificada → tratar como nueva)
                            session.pendingConfirmation = verifyResult.confirmationData;
                            session.pendingReagendamiento = null;
                            if (session.isReagendando && !session.reagendandoCitaId) {
                                console.log('⚠️ isReagendando=true pero sin citaId → tratando como NUEVA CITA');
                                session.isReagendando = false;
                            }
                            console.log('📌 Datos de confirmación (nueva cita) guardados:', JSON.stringify(verifyResult.confirmationData));
                        }
                    }
                } else {
                    toolResultText = verifyResult;
                    // Limpiar confirmaciones pendientes si la hora no está disponible
                    if (session) {
                        session.pendingConfirmation = null;
                        session.pendingReagendamiento = null;
                    }
                }
            }

            // ─── Herramienta: agendar_cita ───────────────────────────────
            else if (functionName === "agendar_cita") {
                // GUARDA: Si estamos en modo reagendamiento, NO crear cita nueva — redirigir a reagendar
                if (session && session.isReagendando && session.reagendandoCitaId) {
                    console.log(`⚠️ GUARDA: IA llamó agendar_cita durante reagendamiento. Redirigiendo a reagendar_cita (${session.reagendandoCitaId})`);
                    const exito = await api.rescheduleAgenda({
                        id: session.reagendandoCitaId,
                        nuevaFecha: functionArgs.fecha,
                        nuevoInicio: functionArgs.hora_inicio,
                        nuevoFin: functionArgs.hora_fin,
                        nuevosServicios: functionArgs.servicios,
                        nuevoPrecio: functionArgs.precio_total,
                        nuevoProfesional: functionArgs.profesional || "Por asignar",
                        notasAdicionales: functionArgs.notas || ""
                    });
                    if (exito) {
                        const profLabel = functionArgs.profesional && functionArgs.profesional !== 'Por asignar' ? ` Profesional: ${functionArgs.profesional}.` : '';
                        toolResultText = `✅ Cita reagendada exitosamente. Cita (${session.reagendandoCitaId}) marcada como REAGENDADO. Nueva Fecha: ${functionArgs.fecha} de ${functionArgs.hora_inicio} a ${functionArgs.hora_fin}. Servicios: ${functionArgs.servicios}. Total: $${functionArgs.precio_total.toLocaleString('es-CO')}.${profLabel}`;
                        session._lastToolAction = 'cita_reagendada';
                    } else {
                        toolResultText = `❌ Error al reagendar la cita ${session.reagendandoCitaId}. Verifica si el ID es correcto.`;
                    }
                } else {
                    const agendaId = await api.createAgenda({
                        fecha: functionArgs.fecha,
                        inicio: functionArgs.hora_inicio,
                        fin: functionArgs.hora_fin,
                        cliente: userName,
                        celularCliente: userData.celular || "",
                        servicio: functionArgs.servicios,
                        precio: functionArgs.precio_total,
                        profesional: functionArgs.profesional || "Por asignar",
                        notas: functionArgs.notas || ""
                    });

                    if (agendaId) {
                        const profLabel = functionArgs.profesional && functionArgs.profesional !== 'Por asignar' ? ` Profesional: ${functionArgs.profesional}.` : '';
                        toolResultText = `✅ Cita creada exitosamente. ID del turno: ${agendaId}. Fecha: ${functionArgs.fecha} de ${functionArgs.hora_inicio} a ${functionArgs.hora_fin}. Servicios: ${functionArgs.servicios}. Total: $${functionArgs.precio_total.toLocaleString('es-CO')}.${profLabel}`;
                        if (session) session._lastToolAction = 'cita_creada';
                    } else {
                        toolResultText = "❌ Hubo un problema al registrar la cita en el sistema. Por favor intenta de nuevo.";
                    }
                }
            }

            // ─── Herramienta: reagendar_cita ──────────────────────────────
            else if (functionName === "reagendar_cita") {
                const exito = await api.rescheduleAgenda({
                    id: functionArgs.id_cita_antigua,
                    nuevaFecha: functionArgs.nueva_fecha,
                    nuevoInicio: functionArgs.nueva_hora_inicio,
                    nuevoFin: functionArgs.nueva_hora_fin,
                    nuevosServicios: functionArgs.nuevos_servicios,
                    nuevoPrecio: functionArgs.nuevo_precio_total,
                    nuevoProfesional: functionArgs.nuevo_profesional || "Por asignar",
                    notasAdicionales: functionArgs.notas || ""
                });

                if (exito) {
                    const profLabel = functionArgs.nuevo_profesional && functionArgs.nuevo_profesional !== 'Por asignar' ? ` Profesional: ${functionArgs.nuevo_profesional}.` : '';
                    toolResultText = `✅ Cita reagendada exitosamente en el mismo registro. Cita (${functionArgs.id_cita_antigua}) marcada como REAGENDADO. Nueva Fecha: ${functionArgs.nueva_fecha} de ${functionArgs.nueva_hora_inicio} a ${functionArgs.nueva_hora_fin}. Servicios: ${functionArgs.nuevos_servicios}. Total: $${functionArgs.nuevo_precio_total.toLocaleString('es-CO')}.${profLabel}`;
                    if (session) session._lastToolAction = 'cita_reagendada';
                } else {
                    toolResultText = `❌ Error al reagendar la cita ${functionArgs.id_cita_antigua}. Verifica si el ID es correcto.`;
                }
            }

            // ─── Herramienta: cancelar_cita ────────────────────────────────
            else if (functionName === "cancelar_cita") {
                const exito = await api.cancelAgenda(functionArgs.id_cita);
                if (exito) {
                    toolResultText = `✅ Cita ${functionArgs.id_cita} CANCELADA exitosamente. El horario ha sido liberado.`;
                    if (session) session._lastToolAction = 'cita_cancelada';
                } else {
                    toolResultText = `❌ Error al cancelar la cita ${functionArgs.id_cita}. Verifica si el ID es correcto.`;
                }
            }

            // 7. Segunda llamada a OpenAI con resultado de herramienta
            const finalMessages = [
                ...messages,
                responseMessage,
                {
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: toolResultText
                }
            ];

            const finalCompletion = await openai.chat.completions.create({
                model: config.aiModel || "gpt-4o-mini",
                messages: finalMessages,
                temperature: 0.5,
                max_tokens: 800
            });

            return finalCompletion.choices[0].message.content;
        }

        // 8. Sin herramienta: respuesta conversacional normal
        return responseMessage.content;

    } catch (e) {
        console.error("❌ Error comunicando con OpenAI:", e.message);
        return "Disculpa, en este momento tengo problemas de conexión y no puedo procesar tu solicitud.";
    }
}

/**
 * Analiza un comprobante de pago/transferencia usando GPT-4o Vision.
 * Extrae monto, fecha, referencia y valida autenticidad.
 * @param {Buffer} imageBuffer Buffer de la imagen del comprobante
 * @param {string} businessName Nombre del negocio destinatario
 * @param {string} openApiKey API Key de OpenAI del tenant
 * @returns {Object} { monto, fecha, referencia, destinatario, esValido, fechaReciente, motivoRechazo }
 */
async function analyzePaymentReceipt(imageBuffer, businessName, openApiKey) {
    try {
        const openai = new OpenAI({ apiKey: openApiKey });
        const base64Image = imageBuffer.toString('base64');
        const todayStr = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Analiza este comprobante de pago/transferencia bancaria.
Extrae y valida:
1. MONTO transferido (numero exacto, sin puntos ni comas)
2. FECHA de la transaccion (formato DD/MM/YYYY)
3. REFERENCIA o numero de transaccion
4. NOMBRE del destinatario (a quien le transfirieron)
5. Es un comprobante REAL y VALIDO? (no editado, no screenshot de chat, formato consistente de banco o app de pagos)

El negocio destinatario es: ${businessName}
La fecha de hoy es: ${todayStr}

IMPORTANTE: Considera la fecha como "reciente" si es del dia de hoy o de ayer.
NO valides el monto — solo extraelo. Cualquier monto es aceptable.

Responde SOLO con un JSON valido, sin markdown ni texto adicional:
{
    "monto": numero,
    "fecha": "DD/MM/YYYY",
    "referencia": "string",
    "destinatario": "string",
    "esValido": true/false,
    "fechaReciente": true/false,
    "motivoRechazo": "string o null"
}`
                    },
                    {
                        type: 'image_url',
                        image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                    }
                ]
            }],
            max_tokens: 500,
            temperature: 0.1
        });

        const content = response.choices[0].message.content.trim();
        // Limpiar posible markdown wrapping
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error('❌ Error analizando comprobante con Vision:', error.message);
        return {
            monto: 0,
            fecha: '',
            referencia: '',
            destinatario: '',
            esValido: false,
            fechaReciente: false,
            motivoRechazo: 'Error al procesar la imagen: ' + error.message
        };
    }
}

module.exports = { generateAIResponse, analyzePaymentReceipt };
