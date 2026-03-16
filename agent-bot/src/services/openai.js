const { OpenAI } = require("openai");
const api = require('./api');

// ============================================================
// Helper: Parsea campo CUMPLE en formato "dd/mm" o "15 de marzo"
// ============================================================
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
    },
    {
        type: "function",
        function: {
            name: "enviar_informacion_servicio",
            description: "Envía fotos, videos o documentos informativos de un servicio al cliente por WhatsApp. Usa esta función cuando el cliente muestre interés, pida más información, tenga dudas sobre un servicio, o quieras mostrarle resultados (antes/después). NO la uses si no hay galería disponible para ese servicio.",
            parameters: {
                type: "object",
                properties: {
                    servicio: {
                        type: "string",
                        description: "Nombre del servicio usando TIPO_SERVICIO_OFICIAL del catálogo."
                    }
                },
                required: ["servicio"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "enviar_media_promocion",
            description: "Envía la imagen, video o documento visual asociado a una promoción al cliente por WhatsApp. Úsala cuando menciones una promoción que tenga contenido visual disponible, para que el cliente vea la promo de forma más atractiva. NO la uses si la promoción no tiene media.",
            parameters: {
                type: "object",
                properties: {
                    nombre_promocion: {
                        type: "string",
                        description: "Nombre exacto de la promoción tal como aparece en la lista de promociones."
                    }
                },
                required: ["nombre_promocion"]
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
function filterActivePromotions(promotionsCatalog, nowColombia, todayDayName, clientTipo) {
    return promotionsCatalog.filter(p => {
        if (p.estado !== 'ACTIVO') return false;
        // Excluir CUMPLEANOS del listado general (se maneja como birthdayContext)
        if (p.tipoPromo === 'CUMPLEANOS') return false;
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
        // Filtrar por tipo de cliente
        if (clientTipo && p.aplicaTipoCliente && p.aplicaTipoCliente !== 'TODOS') {
            const allowedTypes = p.aplicaTipoCliente.split(',').map(t => t.trim().toLowerCase());
            if (!allowedTypes.includes(clientTipo.toLowerCase())) return false;
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
    session = null,
    serviceGallery = {}
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

        // 2b. Construir contexto de galería multimedia disponible
        const galleryServiceIds = Object.keys(serviceGallery || {});
        let galleryContext = '';
        if (galleryServiceIds.length > 0) {
            galleryContext = galleryServiceIds.map(sid => {
                const svc = servicesCatalog.find(s => s.id === sid);
                const items = serviceGallery[sid];
                const svcName = svc ? svc.name : sid;
                return `- ${svcName}: ${items.length} archivo(s) (${items.map(i => i.type).join(', ')})`;
            }).join('\n');
        }

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

        // 4b. Filtrar promociones activas para hoy (segmentadas por tipo de cliente)
        const clientTipo = (userData.tipo || 'Nuevo');
        const activePromotions = filterActivePromotions(promotionsCatalog, nowColombia, todayDayName, clientTipo);
        let promotionsText = "No hay promociones activas para hoy.";
        if (activePromotions.length > 0) {
            promotionsText = activePromotions.map(p => {
                let descuentoLabel = '';
                if (p.tipoPromo === 'PORCENTAJE') descuentoLabel = `${p.valorDescuento}% de descuento`;
                else if (p.tipoPromo === '2X1') descuentoLabel = '2x1 (segundo gratis)';
                else if (p.tipoPromo === 'VALOR_FIJO') descuentoLabel = `$${p.valorDescuento.toLocaleString('es-CO')} de descuento`;
                const mediaTag = (p.tipoMediaPromo && p.urlMediaPromo) ? ` | 📸 TIENE MEDIA VISUAL (${p.tipoMediaPromo})` : '';
                return `- PROMO: ${p.nombre} | ${p.descripcion} | Descuento: ${descuentoLabel} | Aplica a: ${p.aplicaServicio} | Dias: ${p.aplicaDia} | Valida hasta: ${p.vence}${mediaTag}`;
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
⚠️ ANTI-DOBLE CONFIRMACIÓN: Cuando la función 'agendar_cita' o 'reagendar_cita' retorne ✅ exitosamente, la cita YA ESTÁ GUARDADA. Tu respuesta debe ser SOLO un resumen de confirmación con el ID de la cita. NUNCA pidas "¿Confirmas?" después de que la función haya sido ejecutada con éxito. El cliente NO debe confirmar dos veces.
10. REAGENDAMIENTO: Si el usuario quiere cambiar su cita:
   a) Si tiene MÚLTIPLES citas pendientes, PRIMERO pregúntale CUÁL cita quiere modificar (muéstralas con fecha, hora, servicio e ID para que elija).
   b) Una vez identificada la cita, pregúntale qué quiere cambiar: ¿la fecha/hora, el servicio, o ambos?
   c) Si dice "ambos" o da un servicio nuevo directamente, NO crees una cita nueva. Sigue el flujo de REAGENDAMIENTO: pregúntale la nueva fecha/hora y usa el servicio mencionado como el NUEVO servicio del reagendamiento.
   d) Verifica disponibilidad con 'verificar_disponibilidad' para la nueva fecha/hora.
   e) Presenta el resumen del cambio y espera confirmación.
   f) Llama a 'reagendar_cita' con el ID de la cita antigua y los nuevos datos.
   ⚠️ CRÍTICO: Mientras estés en flujo de reagendamiento, TODO lo que diga el cliente (servicios, fechas, horas) es para MODIFICAR la cita existente. NUNCA llames a 'agendar_cita' durante un reagendamiento — SIEMPRE usa 'reagendar_cita'. Si el cliente menciona un servicio diferente, es porque quiere CAMBIAR el servicio de su cita, NO crear una nueva.
   ⚠️ GUÍA PASO A PASO: Lleva al cliente paso a paso. Si dice "ambos", primero pregunta "¿Qué servicio deseas ahora?" y luego "¿Para qué fecha y hora?". No intentes resolver todo en un solo paso.
11. PROMOCIONES — ESTRATEGIA DE PERSUASIÓN ACTIVA:
   ⚠️ Eres una asesora de ventas experta. Las promociones son tu herramienta principal para cerrar citas.
   a) PRIMER CONTACTO: Si hay promos vigentes hoy, menciónalas con entusiasmo en tu primer mensaje: "¡Y tenemos una promo increíble hoy! 🎉"
   b) CUANDO EL CLIENTE PREGUNTE POR PROMOS: Si pregunta "¿tienen promociones?", "¿hay descuentos?", "¿promos para hoy?", o cualquier variación → muéstrale TODAS las promos activas con detalle completo: nombre, descuento, servicios que aplican, días válidos y fecha de vencimiento. Sé entusiasta: "¡Claro que sí! Mira las promos que tenemos para ti 🎉✨"
   c) DETECCIÓN PROACTIVA AL AGENDAR: Cuando el cliente pida agendar un servicio, CRUZA el servicio solicitado + el día de la cita con la lista de promos activas. Si hay coincidencia, NOTIFÍCALO ANTES de confirmar:
      - Ejemplo: "¡Espera! 🎉 Recuerda que los martes tenemos un 20% de descuento en Pestañas, que es justo el servicio que estás agendando. ¡Tu precio sería de ~$50.000~ → *$40.000*! ¿Aprovechamos? 💖"
      - Si el servicio aplica pero el DÍA no: "Este servicio tiene promo los [días], ¿te gustaría agendar en uno de esos días para aprovechar el descuento? 😉"
   d) PERSUASIÓN NATURAL: No seas robótica. Usa frases persuasivas: "¡Estás de suerte!", "¡Justo hoy hay descuento para eso!", "¡Aprovecha que esta promo vence pronto!", "¡No te la puedes perder!"
   e) CÁLCULO DE DESCUENTO: Al agendar con promo, SIEMPRE muestra el desglose (precio normal → descuento → precio final). Usa el precio CON descuento en precio_total al llamar a 'agendar_cita'.
   f) MEDIA VISUAL: Si una promo tiene "📸 TIENE MEDIA VISUAL", llama 'enviar_media_promocion' con el nombre de la promo para enviarle el contenido visual al cliente. Hazlo cuando menciones la promo por primera vez o cuando el cliente pregunte por ella.
   g) VENCIMIENTO: Si una promo vence pronto (esta semana), menciónalo con urgencia: "¡Ojo que esta promo vence el [fecha], no dejes pasar la oportunidad! ⏰"
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

${galleryContext ? `📸 GALERÍA MULTIMEDIA POR SERVICIO:
Servicios con contenido visual disponible para enviar al cliente:
${galleryContext}

REGLAS DE USO DE LA GALERÍA:
- Si el cliente pregunta por un servicio que TIENE galería, OFRECE enviarle fotos/videos de forma natural: "¡Tengo fotos de resultados de [servicio]! ¿Te las envío para que veas cómo quedan? 📸"
- Si el cliente muestra duda o indecisión sobre un servicio con galería, usa la función 'enviar_informacion_servicio' para enviarle el contenido visual y ayudarlo a decidirse.
- Si el cliente dice "sí" a ver fotos/videos, llama 'enviar_informacion_servicio' con el nombre del servicio.
- NO menciones la galería si el servicio NO tiene contenido disponible.
- Después de enviar media, pregunta si tiene alguna duda o si quiere agendar: "¿Qué te parecen los resultados? ¿Te animas a agendar? 💖"
- NO envíes galería sin que el cliente lo pida o sin que haya un momento natural para ofrecerla.
` : ''}
${config.hasAnyAnticipo ? `
💰 SISTEMA DE ANTICIPO / PAGO ANTICIPADO (POR SERVICIO):
- Algunos servicios requieren anticipo. Revisa la columna ANTICIPO en el catálogo para ver cuáles y cuánto.
- ESTADO DEL CLIENTE: ${userData.exentoAnticipo ? '✅ Este cliente está EXENTO de anticipo. NO le cobres anticipo ni menciones pagos. Flujo 100% normal.' : '⚠️ Este cliente NO está exento. DEBE cumplir con el anticipo si el servicio lo requiere.'}
- Momento de pago: ${config.paymentMoment === 'ANTES' ? 'Paga ANTES de agendar (sin pago no hay cita).' : 'Se agenda primero y luego envía comprobante.'}
- Datos de pago: ${config.paymentInstructions}
${config.paymentPolicy ? '- Política de anticipo: ' + config.paymentPolicy : ''}

📋 FLUJO DE ANTICIPO PARA CLIENTES NO EXENTOS — PASO A PASO OBLIGATORIO:
⚠️ REGLA CRÍTICA: Cuando un cliente NO exento pida un servicio que REQUIERE anticipo, DEBES seguir estos pasos EN ORDEN. NO te saltes ningún paso.

🎯 TONO: Sé cálida, empática y amable al hablar del anticipo. NO lo presentes como una traba o requisito frío. Preséntalo como algo normal y sencillo que ayuda a asegurar su espacio. Usa frases como "para separar tu espacio", "para garantizar tu cita", "es un proceso súper sencillo". Hazle sentir que es por su beneficio, no una imposición.

PASO 1 — INFORMAR CONDICIONES CON CALIDEZ (ANTES de verificar disponibilidad):
   Cuando el cliente mencione el servicio, infórmale de forma amigable y natural:
   a) El precio del servicio con entusiasmo ("¡Excelente elección! El servicio de X tiene un valor de $Y")
   b) El anticipo como algo positivo: "Para separar tu espacio, manejamos un pequeño anticipo de $X, así te garantizamos tu cita 💖"
   c) La política con suavidad: "${config.paymentPolicy || 'Ten en cuenta que en caso de no asistir, el anticipo no es reembolsable.'}" — No lo digas de forma amenazante; preséntalo como información importante de manera comprensiva.
   d) Pregúntale con dulzura: "¿Te parece bien? Así continuamos con tu reserva 😊"
   ⚠️ NO llames a 'verificar_disponibilidad' todavía. Primero el cliente debe aceptar.
   ⚠️ IMPORTANTE: Si el cliente YA mencionó fecha y hora junto con el servicio (ej: "quiero tinte para mañana a las 10"), RECUERDA esos datos para usarlos en el PASO 3 sin volver a preguntarle.

PASO 2 — ACEPTACIÓN DEL CLIENTE:
   - Si el cliente ACEPTA (sí, dale, de acuerdo, ok, etc.) → Responde con calidez ("¡Perfecto! 🌸") y continúa al paso 3.
   - Si el cliente NO acepta o tiene dudas → Sé comprensiva, resuelve sus preguntas con paciencia. Si definitivamente no quiere anticipo, ofrécele amablemente servicios que no requieren anticipo: "¡No te preocupes! Tenemos otros servicios maravillosos que no necesitan anticipo 💅✨"

PASO 3 — VERIFICAR DISPONIBILIDAD:
   Solo después de que el cliente aceptó. Si ya mencionó fecha/hora antes, úsalas directamente y llama a 'verificar_disponibilidad'. Si no mencionó fecha/hora, pregúntale: "¿Para qué fecha y hora te gustaría tu cita? 📅✨"

PASO 4 — RESUMEN Y CONFIRMACIÓN:
   Presenta el resumen de la cita de forma linda e incluye:
   - Servicio, fecha, hora, profesional, precio total
   - Anticipo para reservar: $X 💰
   - Saldo restante al momento del servicio: $Y
   Pregunta con entusiasmo: "¿Confirmas tu cita? 💖"

PASO 5 — POST-CONFIRMACIÓN:
   El sistema se encarga automáticamente de pedir el comprobante de pago después de la confirmación. NO necesitas pedir tú el comprobante ni los datos de pago — el sistema lo hace.

📌 EXCEPCIONES:
- Si el servicio NO tiene anticipo → Flujo normal, no menciones pagos.
- Si el cliente es EXENTO → Flujo normal, no menciones anticipos ni condiciones de pago.
- NUNCA rechaces o cuestiones un comprobante — el sistema lo valida automáticamente con IA.
` : ''}
---
`;

        const userName = userData.nombre || "Cliente";

        // Contexto de cumpleanos: si hay promo CUMPLEANOS activa y el cliente cumple hoy
        let birthdayContext = '';
        const cumplePromo = promotionsCatalog.find(p =>
            p.tipoPromo === 'CUMPLEANOS' && p.estado === 'ACTIVO'
        );
        if (cumplePromo && userData.cumple) {
            // Verificar que el tipo de cliente esta permitido
            const cTipo = (userData.tipo || 'Nuevo');
            const allowedTypes = cumplePromo.aplicaTipoCliente === 'TODOS'
                ? null
                : cumplePromo.aplicaTipoCliente.split(',').map(t => t.trim().toLowerCase());
            const clientAllowed = !allowedTypes || allowedTypes.includes(cTipo.toLowerCase());

            if (clientAllowed) {
                const nowCol = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
                const ddNow = String(nowCol.getDate()).padStart(2, '0');
                const mmNow = String(nowCol.getMonth() + 1).padStart(2, '0');
                const cumpleDDMM = parseCumpleDDMM(userData.cumple);
                if (cumpleDDMM === `${ddNow}/${mmNow}`) {
                    birthdayContext = `\n\nHOY ES EL CUMPLEANOS DE ESTE CLIENTE. Felicitalo calidamente y recuerdale que tiene un ${cumplePromo.valorDescuento || 20}% de descuento especial por su cumpleanos en cualquier servicio. Incentivalo a agendar una cita para celebrar.`;
                }
            }
        }

        const systemFinalPrompt = `${config.systemPrompt || "Eres un asistente virtual amable y conciso."}\n\nEstás hablando con: ${userName}${birthdayContext}\n\n${businessRules}`;

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
                        toolResultText = `✅ Cita reagendada exitosamente. Cita (${session.reagendandoCitaId}) marcada como REAGENDADO. Nueva Fecha: ${functionArgs.fecha} de ${functionArgs.hora_inicio} a ${functionArgs.hora_fin}. Servicios: ${functionArgs.servicios}. Total: $${functionArgs.precio_total.toLocaleString('es-CO')}.${profLabel}\n\n→ IMPORTANTE: La cita YA FUE MODIFICADA en el sistema. Informa al cliente que su cita fue reagendada exitosamente y muéstrale el resumen. NO pidas confirmación adicional.`;
                        session._lastToolAction = 'cita_reagendada';
                    } else {
                        toolResultText = `❌ Error al reagendar la cita ${session.reagendandoCitaId}. Verifica si el ID es correcto.`;
                    }
                } else {
                    // ── Detectar si aplica promo (cumpleaños u otra) ──
                    let promoDetected = 'NO';
                    let tipoPromoDetected = '';
                    const cumplePromoCheck = promotionsCatalog.find(p => p.tipoPromo === 'CUMPLEANOS' && p.estado === 'ACTIVO');
                    if (cumplePromoCheck && userData.cumple) {
                        const cumpleDDMM = parseCumpleDDMM(userData.cumple);
                        if (cumpleDDMM === `${dd}/${mm}`) {
                            promoDetected = 'SI';
                            tipoPromoDetected = 'CUMPLEANOS';
                        }
                    }
                    if (promoDetected === 'NO' && activePromotions.length > 0) {
                        // Verificar si el precio es menor al del catálogo (indica descuento aplicado)
                        const srvNames = functionArgs.servicios.split(',').map(s => s.trim());
                        const catalogPrice = srvNames.reduce((sum, name) => {
                            const info = servicesCatalog.find(s => s.name.toLowerCase().trim() === name.toLowerCase().trim());
                            return sum + (info ? info.price : 0);
                        }, 0);
                        if (catalogPrice > 0 && functionArgs.precio_total < catalogPrice) {
                            promoDetected = 'SI';
                            tipoPromoDetected = activePromotions[0].tipoPromo || 'DESCUENTO';
                        }
                    }

                    const agendaId = await api.createAgenda({
                        fecha: functionArgs.fecha,
                        inicio: functionArgs.hora_inicio,
                        fin: functionArgs.hora_fin,
                        cliente: userName,
                        celularCliente: userData.celular || "",
                        servicio: functionArgs.servicios,
                        precio: functionArgs.precio_total,
                        profesional: functionArgs.profesional || "Por asignar",
                        notas: functionArgs.notas || "",
                        promo: promoDetected,
                        tipoPromo: tipoPromoDetected
                    });

                    if (agendaId) {
                        const profLabel = functionArgs.profesional && functionArgs.profesional !== 'Por asignar' ? ` Profesional: ${functionArgs.profesional}.` : '';
                        toolResultText = `✅ Cita GUARDADA exitosamente en el sistema. ID del turno: ${agendaId}. Fecha: ${functionArgs.fecha} de ${functionArgs.hora_inicio} a ${functionArgs.hora_fin}. Servicios: ${functionArgs.servicios}. Total: $${functionArgs.precio_total.toLocaleString('es-CO')}.${profLabel}\n\n→ IMPORTANTE: La cita YA FUE GUARDADA con ID ${agendaId}. Presenta el resumen de confirmación al cliente. NO pidas otra confirmación, la cita ya está registrada en el sistema.`;
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
                    toolResultText = `✅ Cita reagendada exitosamente en el mismo registro. Cita (${functionArgs.id_cita_antigua}) marcada como REAGENDADO. Nueva Fecha: ${functionArgs.nueva_fecha} de ${functionArgs.nueva_hora_inicio} a ${functionArgs.nueva_hora_fin}. Servicios: ${functionArgs.nuevos_servicios}. Total: $${functionArgs.nuevo_precio_total.toLocaleString('es-CO')}.${profLabel}\n\n→ IMPORTANTE: La cita YA FUE MODIFICADA en el sistema. Informa al cliente que su cita fue reagendada exitosamente. NO pidas confirmación adicional.`;
                    if (session) session._lastToolAction = 'cita_reagendada';
                } else {
                    toolResultText = `❌ Error al reagendar la cita ${functionArgs.id_cita_antigua}. Verifica si el ID es correcto.`;
                }
            }

            // ─── Herramienta: enviar_informacion_servicio ────────────────────
            else if (functionName === "enviar_informacion_servicio") {
                const serviceName = functionArgs.servicio;
                const serviceInfo = servicesCatalog.find(s => normDay(s.name) === normDay(serviceName));

                if (!serviceInfo || !serviceGallery[serviceInfo.id] || serviceGallery[serviceInfo.id].length === 0) {
                    toolResultText = JSON.stringify({ enviado: false, motivo: "No hay contenido multimedia disponible para este servicio." });
                } else {
                    const items = serviceGallery[serviceInfo.id];
                    // Guardar items en session para que webhook.js los envíe por WhatsApp
                    if (session) {
                        session._pendingGalleryMedia = {
                            serviceId: serviceInfo.id,
                            serviceName: serviceInfo.name,
                            items: items
                        };
                    }
                    toolResultText = JSON.stringify({
                        enviado: true,
                        cantidad: items.length,
                        servicio: serviceInfo.name,
                        mensaje: `Se enviaron ${items.length} archivo(s) multimedia de ${serviceInfo.name} al cliente: ${items.map(i => i.title + ' (' + i.type + ')').join(', ')}.`
                    });
                }
            }

            // ─── Herramienta: enviar_media_promocion ─────────────────────────
            else if (functionName === "enviar_media_promocion") {
                const promoName = functionArgs.nombre_promocion;
                const promo = promotionsCatalog.find(p => normDay(p.nombre) === normDay(promoName));

                if (!promo || !promo.tipoMediaPromo || !promo.urlMediaPromo) {
                    toolResultText = JSON.stringify({ enviado: false, motivo: "Esta promoción no tiene contenido multimedia asociado." });
                } else {
                    if (session) {
                        session._pendingPromoMedia = {
                            promoName: promo.nombre,
                            type: promo.tipoMediaPromo,
                            url: promo.urlMediaPromo
                        };
                    }
                    toolResultText = JSON.stringify({
                        enviado: true,
                        promocion: promo.nombre,
                        tipo: promo.tipoMediaPromo,
                        mensaje: `Se envió contenido visual (${promo.tipoMediaPromo}) de la promoción "${promo.nombre}" al cliente.`
                    });
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
