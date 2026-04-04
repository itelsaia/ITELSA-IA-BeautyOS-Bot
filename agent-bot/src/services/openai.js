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
// Festivos Colombia — Ley 51 de 1983 (Ley Emiliani)
// Calcula TODOS los festivos del año: fijos, Emiliani y Semana Santa
// ============================================================
function getColombianHolidays(year) {
    // --- Easter (algoritmo de Gauss/Meeus) ---
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=mar, 4=abr
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    const easter = new Date(year, month - 1, day);

    function addDays(date, days) {
        const d = new Date(date);
        d.setDate(d.getDate() + days);
        return d;
    }

    // Mover al lunes siguiente si no cae lunes (Ley Emiliani)
    function nextMonday(date) {
        const d = new Date(date);
        const dow = d.getDay();
        if (dow === 1) return d; // ya es lunes
        if (dow === 0) { d.setDate(d.getDate() + 1); return d; }
        d.setDate(d.getDate() + (8 - dow));
        return d;
    }

    function fmt(date) {
        return String(date.getDate()).padStart(2, '0') + '/' +
               String(date.getMonth() + 1).padStart(2, '0') + '/' + date.getFullYear();
    }

    const holidays = [];
    function add(date, name, emiliani) {
        const final = emiliani ? nextMonday(date) : date;
        holidays.push({ date: fmt(final), name, dateObj: final });
    }

    // 1. Festivos FIJOS (no se mueven)
    add(new Date(year, 0, 1),  'Año Nuevo', false);
    add(new Date(year, 4, 1),  'Día del Trabajo', false);
    add(new Date(year, 6, 20), 'Grito de Independencia', false);
    add(new Date(year, 7, 7),  'Batalla de Boyacá', false);
    add(new Date(year, 11, 8), 'Inmaculada Concepción', false);
    add(new Date(year, 11, 25),'Navidad', false);

    // 2. Festivos EMILIANI (se mueven al lunes siguiente)
    add(new Date(year, 0, 6),  'Reyes Magos', true);
    add(new Date(year, 2, 19), 'San José', true);
    add(new Date(year, 5, 29), 'San Pedro y San Pablo', true);
    add(new Date(year, 7, 15), 'Asunción de la Virgen', true);
    add(new Date(year, 9, 12), 'Día de la Raza', true);
    add(new Date(year, 10, 1), 'Todos los Santos', true);
    add(new Date(year, 10, 11),'Independencia de Cartagena', true);

    // 3. Festivos basados en SEMANA SANTA / Pascua
    add(addDays(easter, -3),  'Jueves Santo', false);
    add(addDays(easter, -2),  'Viernes Santo', false);
    add(addDays(easter, 43),  'Ascensión del Señor', true);
    add(addDays(easter, 64),  'Corpus Christi', true);
    add(addDays(easter, 71),  'Sagrado Corazón', true);

    // Ordenar por fecha
    holidays.sort((a, b) => a.dateObj - b.dateObj);
    return holidays;
}

// Verifica si una fecha DD/MM/YYYY es festivo colombiano
function isColombianHoliday(dateStr, holidays) {
    return holidays.find(h => h.date === dateStr) || null;
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
            description: "Reagenda una cita EXISTENTE (PENDIENTE). Marca la cita antigua como REAGENDADO y crea una nueva. IMPORTANTE: Si la cita tiene promo de DÍA FIJO y la nueva fecha es un día diferente, PRIMERO debes advertir al cliente que perderá el descuento y obtener su confirmación ANTES de llamar esta función con acepta_perder_descuento=true.",
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
                    },
                    acepta_perder_descuento: {
                        type: "boolean",
                        description: "OBLIGATORIO si la cita tiene promo DÍA FIJO y la nueva fecha NO es el día de la promo. true = el cliente YA FUE INFORMADO y ACEPTÓ pagar precio completo sin descuento. false o no enviado = el sistema BLOQUEARÁ el reagendamiento."
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
// Herramientas del agente comercial BeautyOS (Sofi)
// Se usan SOLO cuando tenant.type === 'comercial'
// ============================================================
const COMMERCIAL_TOOLS = [
    {
        type: "function",
        function: {
            name: "capturar_lead",
            description: "Guarda los datos de un prospecto interesado en BeautyOS. Usar cuando el prospecto muestre interes real (pide precio, pide demo, pregunta como funciona).",
            parameters: {
                type: "object",
                properties: {
                    nombreContacto: { type: "string", description: "Nombre de la persona (propietario/a del negocio)" },
                    nombreNegocio: { type: "string", description: "Nombre del salon, peluqueria, barberia o spa" },
                    whatsapp: { type: "string", description: "Numero WhatsApp del prospecto (ya lo tienes del chat)" },
                    email: { type: "string", description: "Correo electronico (opcional)" },
                    ciudad: { type: "string", description: "Ciudad del negocio" },
                    cantidadEmpleados: { type: "string", enum: ["Solo yo", "2 a 5", "6 a 10", "11 o mas"], description: "Cuantos empleados tiene" },
                    notas: { type: "string", description: "Contexto: que busca, objeciones, interes especifico" }
                },
                required: ["nombreContacto", "nombreNegocio", "whatsapp"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "actualizar_estado_lead",
            description: "Cambia el estado de un lead en el CRM. Usar para avanzar el prospecto en el pipeline de ventas o cerrarlo como perdido.",
            parameters: {
                type: "object",
                properties: {
                    nuevoEstado: { type: "string", enum: ["CONTACTADO", "EN_DEMO", "NEGOCIANDO", "SEGUIMIENTO", "NO_CONTESTA", "GANADO", "PERDIDO"], description: "Nuevo estado del lead" },
                    motivo: { type: "string", description: "Razon del cambio: por que se avanza o por que se pierde (objecion, no le interesa, competencia, precio, etc)" }
                },
                required: ["nuevoEstado", "motivo"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "reportar_novedad",
            description: "Registra un reporte tecnico de un cliente existente de BeautyOS. Usar cuando el cliente reporta un problema con su bot, CRM, citas, etc.",
            parameters: {
                type: "object",
                properties: {
                    tipoNovedad: { type: "string", enum: ["Bot no responde", "Error en citas", "Problema con pagos", "Error en CRM", "Consulta tecnica", "Otro"], description: "Categoria del problema" },
                    descripcion: { type: "string", description: "Descripcion detallada del problema reportado por el cliente" },
                    prioridad: { type: "string", enum: ["ALTA", "MEDIA", "BAJA"], description: "ALTA si el servicio esta caido, MEDIA si afecta operacion, BAJA si es consulta" }
                },
                required: ["tipoNovedad", "descripcion"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "transferir_asesor",
            description: "Notifica a un asesor humano para que contacte al prospecto o cliente. Usar cuando: quiere comprar, necesita demo, pregunta compleja, o se molesta.",
            parameters: {
                type: "object",
                properties: {
                    motivo: { type: "string", description: "Razon de la transferencia" },
                    urgente: { type: "boolean", description: "true si el prospecto esta listo para comprar o si hay un problema critico" }
                },
                required: ["motivo"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "consultar_estado_cuenta",
            description: "Consulta el estado de facturacion de un cliente existente: plan, precio, proximo cobro, dias de mora, estado de pago.",
            parameters: {
                type: "object",
                properties: {
                    idCliente: { type: "string", description: "ID del cliente (CLI-...)" }
                },
                required: ["idCliente"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "registrar_compromiso_pago",
            description: "Registra que el cliente se comprometio a pagar en una fecha especifica. Usar cuando el cliente dice 'pago el viernes', 'manana deposito', etc.",
            parameters: {
                type: "object",
                properties: {
                    idCliente: { type: "string", description: "ID del cliente" },
                    fechaCompromiso: { type: "string", description: "Fecha prometida de pago (DD/MM/YYYY)" },
                    monto: { type: "number", description: "Monto que pagara" },
                    notas: { type: "string", description: "Contexto de la conversacion" }
                },
                required: ["idCliente", "fechaCompromiso"]
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
function handleVerificarDisponibilidad(args, servicesCatalog, colaboradoresCatalog, disponibilidadCatalog, allPendingAppointments, todayStr, nowTimeStr, config, excludeAgendaId, festivosConfig, promotionsCatalog) {
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

    // === CHEQUEO DE FESTIVO ===
    let efectiveDisponibilidad = disponibilidadCatalog;
    if (festivosConfig && festivosConfig.length > 0) {
        const holidayMatch = festivosConfig.find(h => h.fecha === fecha);
        if (holidayMatch) {
            if (holidayMatch.trabaja !== 'SI') {
                console.log(`🚫 Festivo bloqueado: ${fecha} es ${holidayMatch.nombre} (CERRADO)`);
                return `❌ El ${fecha} es festivo en Colombia (${holidayMatch.nombre}) y el negocio no atiende ese día. Por favor elige otra fecha.`;
            }
            // Si tiene horario especial, reemplazar la jornada del día
            if (holidayMatch.horaIni && holidayMatch.horaFin) {
                console.log(`📅 Festivo ABIERTO con horario especial: ${fecha} ${holidayMatch.nombre} → ${holidayMatch.horaIni}-${holidayMatch.horaFin}`);
                efectiveDisponibilidad = disponibilidadCatalog.map(d => {
                    if (d.tipo === 'Jornada' && normDay(d.fechaDia) === normDay(dayName)) {
                        return { ...d, horaIni: holidayMatch.horaIni, horaFin: holidayMatch.horaFin };
                    }
                    return d;
                });
            }
        }
    }

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
        const freeRanges = computeFreeSlots(fecha, dayName, prof.nombre, prof.id, efectiveDisponibilidad, allPendingAppointments, bufferMin, excludeAgendaId);
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
            const freeRanges = computeFreeSlots(fecha, dayName, prof.nombre, prof.id, efectiveDisponibilidad, allPendingAppointments, bufferMin, excludeAgendaId);
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

    // Info de anticipo para TODAS las respuestas de verificar_disponibilidad
    let anticipoInfo = '';
    if (serviceInfo && serviceInfo.anticipoEnabled) {
        const anticipoLabel = serviceInfo.anticipoType === 'PORCENTAJE'
            ? `${serviceInfo.anticipoValue}% del precio ($${Math.round(servicePrice * serviceInfo.anticipoValue / 100).toLocaleString('es-CO')})`
            : `$${Number(serviceInfo.anticipoValue).toLocaleString('es-CO')} fijos`;
        anticipoInfo = `\n💰 ANTICIPO REQUERIDO: ${anticipoLabel}`;
    } else {
        anticipoInfo = `\n✅ ANTICIPO: NO requiere. NO menciones anticipo ni pagos para este servicio.`;
    }

    // Si pidió hora específica
    if (hora_deseada) {
        const requestedMin = toMin(hora_deseada);
        const match = futureSlots.find(s => s.minutos === requestedMin);

        if (match) {
            // ✅ HORA DISPONIBLE — retornar objeto con datos para confirmación directa
            console.log(`✅ DISPONIBLE: ${serviceName} ${fecha} ${match.hora_inicio}-${match.hora_fin} con ${match.profesional}`);

            // Calcular precio con promo si aplica
            let precioFinal = servicePrice;
            let promoInfo = '';
            if (promotionsCatalog && promotionsCatalog.length > 0) {
                const srvLower = serviceName.toLowerCase().trim();
                const promoMatch = promotionsCatalog.find(p => {
                    if (p.estado !== 'ACTIVO' || p.tipoPromo === 'CUMPLEANOS') return false;
                    if (p.aplicaDia && p.aplicaDia.trim() !== '') {
                        const dias = p.aplicaDia.split(',').map(d => normDay(d.trim()));
                        if (!dias.includes(normDay(dayName))) return false;
                    }
                    if (p.aplicaServicio && p.aplicaServicio !== 'TODOS') {
                        const srvPromo = p.aplicaServicio.split(',').map(s => s.trim().toLowerCase());
                        if (!srvPromo.some(sp => srvLower.includes(sp) || sp.includes(srvLower))) return false;
                    }
                    return true;
                });
                if (promoMatch && servicePrice > 0) {
                    if (promoMatch.tipoPromo === 'PORCENTAJE') {
                        precioFinal = Math.round(servicePrice * (1 - promoMatch.valorDescuento / 100));
                    } else if (promoMatch.tipoPromo === 'VALOR_FIJO') {
                        precioFinal = Math.max(0, servicePrice - promoMatch.valorDescuento);
                    }
                    if (precioFinal !== servicePrice) {
                        promoInfo = `\n🏷️ PROMO "${promoMatch.nombre}": ~$${Number(servicePrice).toLocaleString('es-CO')}~ → $${Number(precioFinal).toLocaleString('es-CO')} (${promoMatch.valorDescuento}% descuento)`;
                    }
                }
            }

            const precioText = promoInfo
                ? `Precio: ~$${Number(servicePrice).toLocaleString('es-CO')}~ → *$${Number(precioFinal).toLocaleString('es-CO')}* (con descuento)` + promoInfo
                : `Precio: $${Number(servicePrice).toLocaleString('es-CO')}`;

            const text = `✅ CONFIRMADO POR EL SISTEMA: La hora ${match.hora_inicio} ESTÁ DISPONIBLE.\n` +
                `Profesional asignado: ${match.profesional}\n` +
                `Servicio: ${serviceName}\n` +
                `Fecha: ${fecha}\n` +
                `Horario: ${match.hora_inicio} a ${match.hora_fin}\n` +
                precioText +
                anticipoInfo + `\n\n` +
                `→ Presenta este resumen al cliente con el PRECIO CON DESCUENTO y pregúntale si confirma para agendar.`;
            return {
                text,
                confirmationData: {
                    fecha,
                    hora_inicio: match.hora_inicio,
                    hora_fin: match.hora_fin,
                    servicios: serviceName,
                    precio_total: precioFinal,
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
                `Precio: $${Number(servicePrice).toLocaleString('es-CO')}` +
                anticipoInfo + `\n` +
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
            `Precio: $${Number(servicePrice).toLocaleString('es-CO')}` +
            anticipoInfo + `\n` +
            `→ Ofrécele estas opciones al cliente y pregúntale cuál prefiere.`;
    }
}

// ============================================================
// Filtro de promociones vigentes para el día actual
// ============================================================
function filterActivePromotions(promotionsCatalog, nowColombia, todayDayName, clientTipo, clientCelular, promoUsage) {
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
        // Filtrar por limite de usos por cliente
        if (p.maxUsosCliente > 0 && clientCelular && promoUsage) {
            const clientUsage = promoUsage[clientCelular] || {};
            const usedCount = clientUsage[p.nombre] || 0;
            if (usedCount >= p.maxUsosCliente) return false;
        }
        return true;
    });
}

// ============================================================
// Prompt del agente comercial Sofi (BeautyOS)
// ============================================================
function buildCommercialPrompt(config, userData, knowledgeCatalog, servicesCatalog, todayStr, todayDayName) {
    const agentName = config.nombreAgente || 'Sofi';
    const businessName = config.businessName || 'BeautyOS';

    // Construir FAQ/conocimiento desde catalogo sincronizado
    const knowledgeText = knowledgeCatalog.map(k =>
        `- Pregunta: "${k.intent}" → Respuesta: "${k.response}"`
    ).join('\n');

    // Construir catalogo de planes/precios
    const planesText = servicesCatalog.map(s =>
        `- ${s.name}: $${Number(s.price).toLocaleString('es-CO')} / ${s.response}`
    ).join('\n');

    // Detectar modo: CLIENTE_EXISTENTE vs PROSPECTO
    const esCliente = userData.estado === 'CLIENTE_EXISTENTE' || userData.idCliente;
    const clienteNombre = userData.nombre || 'Usuario';

    let modoContexto = '';
    const esLeadExistente = userData.estado === 'LEAD_EXISTENTE' || userData.negocio;

    if (esCliente) {
        modoContexto = `El usuario que te escribe YA es cliente de ${businessName}: ${clienteNombre}${userData.idCliente ? ' (ID: ' + userData.idCliente + ')' : ''}.
Puede estar en modo SOPORTE (problemas técnicos) o CARTERA (facturación/pagos).
Detecta su intención y actúa según corresponda.`;
    } else if (esLeadExistente) {
        modoContexto = `Este usuario YA habló contigo antes. Es un lead existente:
- Nombre: ${userData.nombre || 'No registrado'}
- Negocio: ${userData.negocio || 'No registrado'}
- Ciudad: ${userData.ciudad || 'No registrada'}
- Estado actual: ${userData.estadoLead || 'NUEVO'}

IMPORTANTE: Ya lo conoces. NO le preguntes datos que ya tienes. NO repitas el flujo de venta desde cero.
- Si su estado es NUEVO: retoma con calidez, pregunta si tuvo tiempo de pensar la propuesta.
- Si es CONTACTADO: pregunta si le quedaron dudas, ofrece resolver cualquier inquietud.
- Si es EN_DEMO o NEGOCIANDO: pregunta cómo le fue, si está listo para arrancar.
- Tono: amigable, como si retomaran una conversación pendiente. NO seas insistente.
- Ejemplo: "¡Hola ${userData.nombre ? userData.nombre.split(' ')[0] : ''}! Qué gusto verte de nuevo. ¿Tuviste chance de pensar lo de ${businessName} para ${userData.negocio || 'tu negocio'}?"`;
    } else {
        modoContexto = `El usuario es un PROSPECTO nuevo. No conoce ${businessName} aún.
Estás en modo VENTAS. Tu objetivo es convertirlo en cliente.`;
    }

    // Campaña activa desde hoja CAMPANAS (sincronizada cada 5 min)
    const campana = config.campanaActiva || {};
    const cuposDisponibles = config.cuposDisponibles !== undefined ? config.cuposDisponibles : '?';
    const campanaMsg = campana.MENSAJE_AGENTE
        ? String(campana.MENSAJE_AGENTE).replace('CUPOS_DISPONIBLES', cuposDisponibles)
        : '';
    const implementacionGratis = String(campana.IMPLEMENTACION || 0) === '0' || String(campana.IMPLEMENTACION) === '';
    const primerMesGratis = String(campana.PRIMER_MES_GRATIS || '').toUpperCase() === 'SI';
    const condicionesEspeciales = campana.CONDICIONES_ESPECIALES || '';
    const metaClientes = Number(campana.META_CLIENTES || 0);
    const clientesActuales = Number(campana.CLIENTES_ACTUALES || 0);

    // Fallbacks si no hay campaña
    const ofertaLanzamiento = config.ofertaLanzamiento || 'Primer mes GRATIS al contratar.';
    const implementacionPrecio = implementacionGratis ? 'GRATIS (promo lanzamiento)' : (config.implementacionPrecio || '$400.000');

    return `Eres ${agentName}, asesora comercial de ${businessName}. Fecha: ${todayStr} (${todayDayName}).

## TU IDENTIDAD
- Nombre: ${agentName}
- Rol: Asesora comercial y de soporte de ${businessName}
- Personalidad: Eres cálida, cercana, y hablas como una amiga emprendedora. Tuteas siempre.
- Entiendes los retos de tener un negocio de belleza porque has trabajado con decenas de salones.
- Eres persuasiva pero NUNCA agresiva. Vendes con empatía, no con presión.
- NO eres un chatbot. Eres una persona real que quiere ayudar.

## CONTEXTO DEL USUARIO
${modoContexto}
Estás hablando con: ${clienteNombre}

## QUÉ ES BEAUTYOS
${businessName} es un sistema integral para negocios de belleza que incluye:
- Un agente IA que atiende tu WhatsApp 24/7 (agenda citas, responde preguntas, envía recordatorios)
- Un CRM personalizado con tu marca y colores
- Landing page profesional de tu negocio
- Reportes, promociones, seguimiento de clientes
Durante el primer mes (gratis) configuramos, ajustamos y personalizamos todo junto contigo. Sin prisas, a tu ritmo.

## PLANES Y PRECIOS
${planesText || '- Plan Completo: $180.000/mes (Todo incluido)'}

## 🚀 CAMPAÑA ACTIVA — ${campana.NOMBRE || 'Lanzamiento BeautyOS'}
${condicionesEspeciales ? '📋 ' + condicionesEspeciales : ''}
- 🎁 Implementación: ${implementacionPrecio}${implementacionGratis ? ' (normalmente $400.000, GRATIS en esta campaña)' : ''}
${primerMesGratis ? '- 🆓 Primer mes: GRATIS (empiezas a pagar desde el segundo mes)' : ''}
- 💰 Después: $180.000/mes todo incluido
- 📅 Plan anual: $160.000/mes (ahorra 11%)
- 🔓 Sin contrato de permanencia. Cancela cuando quieras.
${metaClientes > 0 ? '- ⚠️ CUPOS LIMITADOS: Solo ' + cuposDisponibles + ' de ' + metaClientes + ' cupos con implementación GRATIS.' : ''}
- 📊 Ya hay ${clientesActuales} negocio(s) que se han unido a esta campaña.${cuposDisponibles <= 2 && cuposDisponibles > 0 ? ' ¡Quedan los ÚLTIMOS cupos!' : ''}${cuposDisponibles === 0 ? ' ⛔ CUPOS AGOTADOS — la implementación ya tiene costo.' : ''}

DATO CLAVE PARA PERSUADIR: Cada lead que captures es un interesado más. Usa frases como:
- "Ya tenemos varios negocios interesados esta semana, los cupos se están agotando rápido."
- "Ayer se unió un salón en [ciudad del prospecto] y quedó encantado."
- NUNCA digas el número exacto de leads. Solo genera sensación de movimiento y urgencia real.

## BASE DE CONOCIMIENTO
${knowledgeText || 'No hay FAQ cargadas aún.'}

## 📰 NOVEDADES Y MEJORAS DEL PRODUCTO
${(config.anunciosActivos || []).length > 0 ? (config.anunciosActivos || []).map(a => `- ${a.TIPO}: ${a.TITULO} — ${a.MENSAJE_SOFI || a.DESCRIPCION}`).join('\n') : 'No hay anuncios activos.'}
Usa estas novedades durante la conversación para mostrar que el producto MEJORA constantemente.
Si un prospecto pregunta "qué hay de nuevo" o "qué funciones tienen", menciona estas novedades.
Si un cliente existente escribe, puedes comentar las mejoras relevantes para su caso.

## TÉCNICAS DE PERSUASIÓN — Usa estas durante la conversación
1. DOLOR → SOLUCIÓN: "¿Cuántas citas has perdido este mes?" → "Con BeautyOS eso no pasa, el bot agenda y recuerda automáticamente."
2. PRUEBA SOCIAL: "Tenemos salones en Bogotá, Medellín y Cali que ya redujeron los no-shows un 95%."
3. ESCASEZ / OFERTA LIMITADA: "Esta oferta es por LANZAMIENTO. Solo tenemos ${cuposDisponibles} cupos con implementación GRATIS. Cuando se llenen, la implementación costará $400.000. No va a estar siempre."
4. PRECIO EN PESOS DIARIOS: "$180.000 al mes son solo $6.000 al día. Menos de lo que cuesta un almuerzo. Por $6.000 diarios tienes un asistente que trabaja 24/7, agenda, recuerda y fideliza por ti."
5. PRUEBE PRIMERO, PAGUE DESPUÉS: "El primer mes es GRATIS. Configuras, pruebas, capacitas a tu equipo y al final del mes decides si quieres seguir. Si no te convence, cancelas y no pagas un solo peso. Tu dinero está seguro."
6. COMBO ÚNICO: "Un CRM + Agente IA WhatsApp + Landing Page profesional por $6.000/día. Esto no lo consigues en ningún lado. Tienes mucho que ganar y cero que perder."
7. ACOMPAÑAMIENTO COMPLETO: "Durante el primer mes te damos acompañamiento y capacitación completa. Te enseñamos a usar el CRM, configuramos tu bot, ajustamos todo a tu medida. No te dejamos sol@."
8. GARANTÍA CERO RIESGO: "Sin contrato de permanencia. Cancela cuando quieras. Primer mes gratis para que pruebes sin compromiso. Si no te gusta, no pagas nada."
9. IMPLEMENTACIÓN GRATIS: "${implementacionGratis ? 'La implementación que normalmente vale $400.000 te sale GRATIS en esta promo de lanzamiento. Es un ahorro real.' : 'Implementación: ' + implementacionPrecio + ' (única vez).'}"
10. URGENCIA REAL: "Ya tenemos varios negocios que se están uniendo. Los cupos con implementación gratis se están acabando. No querrás pagar $400.000 de implementación por esperar."

## FLUJO DE VENTA (prospectos nuevos) — Sigue estos pasos EN ORDEN
1. SALUDO CÁLIDO: "¡Hola! Soy ${agentName} de ${businessName}. ¿Cómo te llamas y cuál es tu negocio?"
2. DESCUBRIMIENTO (2-3 preguntas máx): Pregunta sobre sus problemas cotidianos:
   - "¿Cómo manejas las citas hoy? ¿Libreta, Excel, de cabeza?"
   - "¿Te pasa que los clientes no llegan o cancelan a última hora?"
   - "¿Tus clientes te escriben por WhatsApp y a veces no alcanzas a responder?"
3. EMPATÍA + HISTORIA: Valida su dolor con un caso real:
   - "Eso le pasaba a una clienta nuestra en [ciudad]. Perdía como 5 citas por semana."
   - "Muchos dueños de salón viven pegados al celular respondiendo WhatsApp. Eso se acaba con BeautyOS."
4. PRESENTACIÓN (máx 2-3 mensajes cortos, NO listas):
   - Relaciona SU dolor específico con UNA función de BeautyOS.
   - "Imagínate: un cliente te escribe a las 11pm para agendar. Con BeautyOS, el bot le agenda automáticamente."
5. RECOLECCIÓN NATURAL: Durante la conversación, obtén:
   - Nombre (del saludo) ✓
   - Negocio (del saludo) ✓
   - Ciudad: "¿Y dónde queda tu negocio?"
   - Empleados: "¿Trabajas sola o tienes equipo?"
6. PRECIO + OFERTA (cuando pregunte o muestre interés) — SIEMPRE menciona estos 3 puntos:
   A) PRECIO DIARIO: "Son $180.000 al mes, que son solo $6.000 al día. Menos que un almuerzo. Por $6.000 diarios tienes tu asistente IA 24/7."
   B) PRUEBE PRIMERO: "Y lo mejor: el primer mes es GRATIS. Pruebas todo, te capacitamos, configuramos tu negocio y al final del mes decides. Si no te convence, cancelas sin pagar nada."
   C) OFERTA LIMITADA: "${implementacionGratis ? 'La implementación que vale $400.000 te sale GRATIS, pero solo para los primeros ' + metaClientes + ' clientes. Ya van ' + clientesActuales + '. Esta oferta no va a estar siempre.' : 'La implementación es de ' + implementacionPrecio + '.'}"
   - Si duda del precio: "Son $6.000 al día. Una sola cita que recuperes ya te lo paga. Y el primer mes ni siquiera pagas."
   - Si duda de la implementación: "Es GRATIS en esta promo. Normalmente vale $400.000 pero hoy te lo regalamos."
   - Si tiene miedo: "Tienes un mes completo para probar SIN PAGAR. Te acompañamos con capacitación y soporte. Si no te gusta, cancelas y ya. Cero riesgo."
   - Si compara con otras herramientas: "Un CRM + Agente IA WhatsApp + Landing Page profesional por $6.000 al día. Eso no lo consigues en ningún lado. Y encima con acompañamiento personalizado."
   - SIEMPRE cierra con: "¿Quieres aprovechar la oferta antes de que se acaben los cupos?"
7. CIERRE (cuando diga "sí quiero"/"listo"/"arranquemos"):
   - NO pidas más datos. Los datos ya se capturaron automáticamente por el sistema.
   - Di: "¡Genial [nombre]! Un asesor te contactará para coordinar todo. Durante el primer mes te acompañamos con la configuración y capacitación. ¡Bienvenid@ a BeautyOS!"
   - NO digas "necesito confirmar datos" ni "dame tu nombre/ciudad/etc". Ya los tienes.

## REGLAS ABSOLUTAS — NO NEGOCIABLE
- NUNCA vuelvas a pedir datos que el prospecto YA te dio en la conversación. Si ya dijo su nombre, negocio, ciudad o empleados, NO LO PREGUNTES DE NUEVO. Lee el historial.
- NUNCA digas "24 horas", "48 horas" ni "24-48 horas". El proceso toma el primer mes completo.
- NUNCA hagas listas numeradas pidiendo datos (1. Nombre 2. Ciudad). Eso es formulario, no conversación.
- NUNCA digas "necesito algunos datos para formalizar". Tú ya tienes los datos del chat. El sistema los captura automáticamente.
- El WhatsApp del prospecto ya lo tienes automáticamente del chat (NO se lo preguntes).
- Cuando el prospecto dice "sí quiero" o "listo arranquemos", NO le pidas más datos. Confirma y despídete.
- Si el prospecto te da información que ya tienes, NO le digas "como te dije anteriormente". Solo fluye natural.

## GESTIÓN DEL PIPELINE — Usa actualizar_estado_lead() para avanzar o cerrar leads
Cambia el estado del lead según cómo avanza la conversación:

AVANZAR — LLAMA actualizar_estado_lead() en cada transición:
- Cuando le explicas el producto y responde positivo → LLAMA actualizar_estado_lead("CONTACTADO", "mostró interés en [tema]")
- Si pide demo o quiere ver el sistema → LLAMA actualizar_estado_lead("EN_DEMO", "pidió ver demo")
- Si pregunta precios o compara → LLAMA actualizar_estado_lead("NEGOCIANDO", "preguntó por precios")
- Si dice "lo pienso" → LLAMA actualizar_estado_lead("SEGUIMIENTO", "pide tiempo para pensar")
- Si dice "sí quiero" o "arranquemos" → LLAMA actualizar_estado_lead("GANADO", "confirmó compra") + transferir_asesor()

CERRAR COMO PERDIDO — OBLIGATORIO llamar actualizar_estado_lead():
Cuando el prospecto dice "no me interesa", "no gracias", "no quiero", etc:
1. Pregunta el motivo UNA vez: "Entiendo. ¿Puedo saber qué no te convenció? Es para mejorar."
2. Cuando te dé el motivo (o diga "no gracias" de nuevo), DEBES llamar inmediatamente:
   actualizar_estado_lead(nuevoEstado: "PERDIDO", motivo: "[motivo exacto que dio el prospecto]")
3. Después de llamar la función, despídete: "Gracias por tu tiempo, [nombre]. Si en el futuro necesitas algo, aquí estaré."
4. NO intentes vender después del segundo "no". Máximo UN intento de retención.

⚠️ OBLIGATORIO: Si el prospecto dice NO dos veces, DEBES llamar actualizar_estado_lead(PERDIDO) en tu SIGUIENTE respuesta. No es opcional.

REGLAS IMPORTANTES:
- Si la sesión tiene _leadPerdido = true, NO intentes vender. Solo responde si pregunta algo.
- Si el lead vuelve a escribir después de ser PERDIDO, sé amable pero NO hagas pitch.
- SIEMPRE registra el motivo de pérdida. Es información valiosa para el negocio.
- Los estados los cambias TÚ automáticamente con la función. El asesor humano NO tiene que hacerlo.
- CADA VEZ que avances o cierres un lead, LLAMA actualizar_estado_lead(). No basta con decirlo en el chat.

## MANEJO DE OBJECIONES Y DUDOSOS — Flujos de confianza

### OBJECIÓN: "Es muy caro" / "No tengo presupuesto"
1. "Entiendo. Pero míralo así: son $6.000 al día. Menos que un tinto con pan. ¿Cuánto pierdes al mes por citas que no llegan?"
2. Si sigue dudando: "Y recuerda: el primer mes es GRATIS. No pones un peso. Pruebas durante 30 días y al final decides."
3. Si insiste: "¿Cuántas citas pierdes al mes? Si son 2 o 3, con lo que recuperas ya pagaste BeautyOS."
→ Si dice NO 2 veces: cerrar como PERDIDO con motivo "precio"

### OBJECIÓN: "Ya tengo sistema" / "Uso Excel/agenda"
1. "¡Qué bueno que ya tienes algo! Pero déjame preguntarte: ¿tu sistema atiende WhatsApp a las 11pm cuando un cliente quiere agendar?"
2. "¿Tu agenda le manda recordatorio automático al cliente 1 hora antes para que no falte?"
3. "BeautyOS hace todo eso y más. Y puedes probarlo GRATIS un mes completo sin dejar lo que ya tienes."
→ Si insiste: PERDIDO con motivo "ya tiene solución"

### OBJECIÓN: "No sé de tecnología" / "Eso es muy complicado"
1. "Tranquil@, no necesitas saber NADA de tecnología. Nosotros hacemos TODO."
2. "Durante el primer mes (gratis) te damos capacitación personalizada. Te enseñamos paso a paso cómo usar el CRM."
3. "Si algo no entiendes, nos escribes y te ayudamos al instante. No te dejamos sol@."
4. "Tenemos clientes que apenas sabían usar WhatsApp y hoy manejan su negocio desde el celular."
→ Si insiste: PERDIDO con motivo "temor a tecnología"

### OBJECIÓN: "No tengo tiempo" / "Estoy muy ocupad@"
1. "Justamente por eso existe BeautyOS. El bot atiende por ti 24/7. Tú descansas y él trabaja."
2. "Y lo mejor: nosotros hacemos toda la configuración. Tú solo nos pasas la info de tu negocio y nosotros nos encargamos."
3. "El primer mes es gratis. No tienes que hacer nada, nosotros configuramos todo."
→ Si insiste: PERDIDO con motivo "no tiene tiempo"

### OBJECIÓN: "Lo voy a pensar" / "Después hablamos"
1. "Dale, tómate tu tiempo. Solo ten en cuenta que la implementación GRATIS ($400.000 de ahorro) es por lanzamiento y los cupos son limitados."
2. "Si quieres, te mando un resumen por aquí para que lo mires con calma."
→ NO insistir más. Dejar en SEGUIMIENTO.

### PROSPECTO DUDOSO / INCRÉDULO: "¿Eso sí funciona?" / "Será que sí sirve?" / "No creo"
1. "Es normal tener dudas. Por eso el primer mes es GRATIS: para que pruebes tú mism@ sin arriesgar nada."
2. "Míralo así: pruebas primero, pagas después. Si no te convence, cancelas y no pagas un peso. Tu dinero está seguro."
3. "Tenemos negocios en Bogotá, Medellín y Cali que empezaron con las mismas dudas y hoy no pueden vivir sin BeautyOS."
4. "Un CRM + Agente IA + Landing Page por $6.000 al día no lo consigues en ningún lado. Tienes mucho que ganar y cero que perder."
5. "Te damos acompañamiento y capacitación completa durante todo el primer mes. No es que te entregamos algo y te dejamos sol@."

### PROSPECTO DESCONFIADO: "¿Y si no me gusta?" / "¿Quedo amarrad@?" / "¿Me puedo salir?"
1. "Cero amarre. No hay contrato de permanencia. Cancelas cuando quieras con un mensaje."
2. "El primer mes es GRATIS justamente para que pruebes sin compromiso. Si al mes dices 'no me sirve', cancelas y listo."
3. "Tu dinero está 100% seguro. Prueba primero, paga después."
4. "Además, durante ese mes te acompañamos en todo. Si algo no te cuadra, lo ajustamos."

### PROSPECTO ESCÉPTICO: "¿Y quiénes son ustedes?" / "¿Esto es serio?"
1. "Somos ITELSA IA, una empresa colombiana de tecnología para negocios de belleza."
2. "Llevamos trabajando con peluquerías, spas y barberías en varias ciudades del país."
3. "Todo es transparente: pruebas un mes gratis, si te gusta sigues, si no cancelas. Así de simple."

### REGLA PARA TODOS LOS DUDOSOS:
- SIEMPRE vuelve al argumento central: "Prueba primero, paga después. Cero riesgo."
- SIEMPRE menciona los $6.000/día y el combo CRM+IA+Landing que no existe en el mercado.
- SIEMPRE recuerda la capacitación y el acompañamiento durante el mes gratis.
- Máximo 3 intentos por objeción. Si después de 3 respuestas sigue diciendo no → cerrar como PERDIDO.
- "No me interesa" (directo sin razón): Preguntar motivo UNA vez → PERDIDO

## FLUJO DE SOPORTE (clientes existentes — problemas técnicos)
Si el usuario menciona un problema técnico (bot no responde, error, falla):
1. Pregunta qué está pasando (qué error ve, desde cuándo, qué intentó)
2. Clasifica el tipo de novedad
3. Registra con reportar_novedad()
4. Asegura que el equipo técnico lo revisará pronto
5. Si es urgente (servicio caído), usa transferir_asesor() con urgente=true

## FLUJO DE CARTERA (clientes existentes — facturación)
Si el cliente pregunta sobre su facturación, pago, o si detectas que tiene mora:
1. Consulta su estado con consultar_estado_cuenta()
2. Informa: plan activo, precio, próximo cobro, estado de pago, días de mora
3. Si tiene mora: explica que necesita pagar para mantener el servicio activo
4. Si se compromete a pagar: registra con registrar_compromiso_pago()
5. Si dice que ya pagó: pídele el comprobante (foto) y dile que lo envíe por aquí
6. Si tiene dudas del monto o método de pago: infórmale los métodos disponibles
${config.paymentInstructionsComercial || config.paymentInstructions ? '\nDatos de pago: ' + (config.paymentInstructionsComercial || config.paymentInstructions) : ''}

## REGLAS DE COBRO
- Sé FIRME pero RESPETUOSA. No amenaces, pero sé clara sobre las consecuencias.
- Si el cliente dice "ya pagué": pídele el comprobante. No le creas de palabra.
- Si el cliente dice "no puedo pagar": ofrece registrar un compromiso de pago y pregunta cuándo puede.
- Si el cliente se molesta: empatiza, explica que es para mantener su servicio activo, y ofrece transferir a un asesor.
- NUNCA modifiques fechas ni estados de pago. Solo informas y registras.

## REGLAS GENERALES
- NUNCA inventes precios. Usa solo los del catálogo.
- NUNCA prometas funciones que no existen.
- Si no sabes algo, di "Déjame confirmar eso con el equipo y te escribo."
- Si el prospecto está listo para comprar, usa transferir_asesor() con urgente=true.
- Usa emojis moderadamente. Máximo 1-2 por mensaje. NO abuses de emojis.
- Mensajes CORTOS (máx 2-3 líneas por mensaje). WhatsApp NO es email. Sé concisa.
- NO hagas listas ni enumeraciones largas. Conversa como en un chat real.
- Responde en español colombiano natural. Ejemplo: "dale", "listo", "super", "genial".
- Haz UNA pregunta a la vez. NO hagas 3 preguntas en un solo mensaje.
- Si el prospecto responde con monosílabos ("si", "ok", "ajá") o solo emojis (👍😊❤️🔥), llévalo a preguntas CERRADAS para obtener datos:
  En vez de: "¿Qué te parece?" → "¿Tu negocio queda en Bogotá o en otra ciudad?"
  En vez de: "¿Te interesa?" → "¿Manejas las citas por WhatsApp o por libreta?"
  Objetivo: obtener nombre del negocio, ciudad y empleados con preguntas que se respondan fácil.
- Si responde solo emojis 2 veces seguidas, sé directa: "Para darte info precisa necesito saber: ¿cómo se llama tu negocio y en qué ciudad queda?"
- SIEMPRE menciona la oferta de implementación GRATIS y el primer mes sin costo. Es el gancho más fuerte.
- Cuando hables de precios, SIEMPRE resalta: "La implementación que vale $400.000 te sale GRATIS y el primer mes no pagas nada."
---
`;
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
    serviceGallery = {},
    promoUsage = {},
    festivosConfig = []
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
            } else {
                line += ` | ANTICIPO: No requiere`;
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
            // Listar CADA item con tipo y título exacto para evitar alucinaciones
            galleryContext = galleryServiceIds.map(sid => {
                const svc = servicesCatalog.find(s => s.id === sid);
                const items = serviceGallery[sid];
                const svcName = svc ? svc.name : sid;
                const itemList = items.map(i => {
                    if (i.category === 'recomendacion') {
                        return `  - TEXTO recomendacion: "${i.title}" → ${i.description || ''}`;
                    }
                    return `  - ${i.type.toUpperCase()}: "${i.title}" (categoria: ${i.category})`;
                }).join('\n');
                return `- ${svcName} (${items.length} item(s)):\n${itemList}`;
            }).join('\n');
        }

        // 3. Construir contexto de citas PENDIENTES del usuario
        let pendingAppointmentsText = "El cliente no tiene citas activas registradas.";
        if (userPendingAppointments.length > 0) {
            pendingAppointmentsText = `⚠️ ATENCIÓN: El cliente TIENE las siguientes citas PENDIENTES:\n` +
                userPendingAppointments.map(c => {
                    const promoTag = c.tipoPromo ? ` | 🏷️ PROMO: ${c.tipoPromo}` : '';
                    return `  - ID: ${c.id} | Fecha: ${c.fecha} | Hora: ${c.inicio}-${c.fin} | Profesional: ${c.profesional || 'Por asignar'} | Servicio: ${c.servicio} | Precio: $${c.precio}${promoTag} | Estado pago: ${c.estadoPago || 'N/A'}`;
                }).join('\n') +
                `\n→ Si el usuario pide cambiar o modificar su cita, usa la herramienta 'reagendar_cita' con el ID_CITA arriba indicado.\n→ Tener citas pendientes NO impide agendar nuevas citas. El cliente puede tener múltiples citas.` +
                `\n→ RECORDATORIO DE CITAS: Si el cliente SOLO saluda (sin preguntar nada más), puedes mencionar brevemente sus citas pendientes. Pero si el mensaje incluye una pregunta o solicitud (ej: "hola que servicios tienen", "hola quiero agendar"), RESPONDE PRIMERO a lo que preguntó. La intención del cliente siempre tiene prioridad sobre el recordatorio.`;
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

        // 4a. Generar fechas exactas de los próximos 7 días para evitar alucinaciones
        const next7Days = [];
        for (let i = 1; i <= 7; i++) {
            const nextDate = new Date(nowColombia);
            nextDate.setDate(nextDate.getDate() + i);
            const ndd = String(nextDate.getDate()).padStart(2, '0');
            const nmm = String(nextDate.getMonth() + 1).padStart(2, '0');
            const nyyyy = nextDate.getFullYear();
            const nDayName = weekDays[nextDate.getDay()];
            next7Days.push(`  - ${nDayName}: ${ndd}/${nmm}/${nyyyy}`);
        }
        const next7DaysText = next7Days.join('\n');

        // 4b. Calcular festivos colombianos del año actual y siguiente
        const colombianHolidays = [
            ...getColombianHolidays(parseInt(yyyy)),
            ...getColombianHolidays(parseInt(yyyy) + 1)
        ];

        // Helper: formato fecha desde Date
        function fmtDate(d) {
            return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
        }

        // 4c. Filtrar promociones activas para hoy (segmentadas por tipo de cliente + limite de uso)
        const clientTipo = (userData.tipo || 'Nuevo');
        const clientCelular = (userData.celular || '').trim();
        const activePromotions = filterActivePromotions(promotionsCatalog, nowColombia, todayDayName, clientTipo, clientCelular, promoUsage);
        let promotionsText = "No hay promociones activas para hoy.";
        if (activePromotions.length > 0) {
            promotionsText = activePromotions.map(p => {
                let descuentoLabel = '';
                if (p.tipoPromo === 'PORCENTAJE') descuentoLabel = `${p.valorDescuento}% de descuento`;
                else if (p.tipoPromo === '2X1') descuentoLabel = '2x1 (segundo gratis)';
                else if (p.tipoPromo === 'VALOR_FIJO') descuentoLabel = `$${p.valorDescuento.toLocaleString('es-CO')} de descuento`;
                const mediaTag = (p.tipoMediaPromo && p.urlMediaPromo) ? ` | 📸 TIENE MEDIA VISUAL (${p.tipoMediaPromo}) → DEBES llamar 'enviar_media_promocion' al mencionarla` : '';
                const usosInfo = p.maxUsosCliente > 0 ? ` | Limite: ${p.maxUsosCliente} uso(s) por cliente` : '';
                const usedByClient = (promoUsage[clientCelular] || {})[p.nombre] || 0;
                const usosRestantes = p.maxUsosCliente > 0 ? ` | Este cliente ha usado: ${usedByClient}/${p.maxUsosCliente}` : '';

                // Clasificar tipo de promo: DÍA FIJO vs RANGO FLEXIBLE
                const diasArr = (p.aplicaDia || '').split(',').map(d => d.trim()).filter(Boolean);
                const esDiaFijo = diasArr.length > 0 && diasArr.length <= 2 && p.aplicaServicio && p.aplicaServicio !== 'TODOS';

                let tipoTag = '';
                if (esDiaFijo) {
                    // Calcular la FECHA EXACTA del próximo día de la promo
                    const dayMap = { 'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3, 'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 0 };
                    const targetDay = dayMap[diasArr[0].toLowerCase()] ?? -1;
                    let fechaHoy = '';      // fecha de hoy si hoy es el día
                    let fechaProxima = '';   // fecha de la próxima semana
                    let fechaAUsar = '';     // la que la IA debe usar por defecto

                    if (targetDay >= 0) {
                        const hoyDay = nowColombia.getDay();
                        let diasHasta = targetDay - hoyDay;
                        if (diasHasta < 0) diasHasta += 7;

                        if (diasHasta === 0) {
                            // Hoy ES el día de la promo — verificar si el negocio aún está abierto
                            let negocioAbierto = true;
                            if (disponibilidadCatalog && disponibilidadCatalog.length > 0) {
                                const jornadaHoy = disponibilidadCatalog.find(d =>
                                    d.tipo.toLowerCase() === 'jornada' && normDay(d.fechaDia) === normDay(todayDayName)
                                );
                                if (jornadaHoy && jornadaHoy.horaFin) {
                                    const [hFin, mFin] = jornadaHoy.horaFin.split(':').map(Number);
                                    const cierreMin = hFin * 60 + mFin;
                                    const ahoraMin = nowColombia.getHours() * 60 + nowColombia.getMinutes();
                                    if (ahoraMin >= cierreMin) negocioAbierto = false;
                                }
                            }
                            const nextWeek = new Date(nowColombia);
                            nextWeek.setDate(nextWeek.getDate() + 7);
                            fechaProxima = fmtDate(nextWeek);
                            if (negocioAbierto) {
                                fechaHoy = todayStr;
                                fechaAUsar = todayStr;
                            } else {
                                // Ya cerró: no ofrecer hoy, apuntar al próximo día de promo
                                fechaAUsar = fechaProxima;
                            }
                        } else {
                            const nextDate = new Date(nowColombia);
                            nextDate.setDate(nextDate.getDate() + diasHasta);
                            fechaProxima = fmtDate(nextDate);
                            fechaAUsar = fechaProxima;
                        }
                    }

                    // Verificar festivos en las fechas calculadas
                    let festivoHoy = fechaHoy ? isColombianHoliday(fechaHoy, colombianHolidays) : null;
                    let festivoProxima = fechaProxima ? isColombianHoliday(fechaProxima, colombianHolidays) : null;

                    // Construir label de fechas con info de festivos
                    let fechasInfo = '';
                    if (fechaHoy && fechaProxima) {
                        // Hoy es el día de la promo — dar ambas opciones
                        let hoyLabel = `HOY ${fechaHoy}`;
                        if (festivoHoy) hoyLabel += ` ⚠️ FESTIVO: ${festivoHoy.name}`;
                        let proxLabel = `PRÓXIMO: ${fechaProxima}`;
                        if (festivoProxima) proxLabel += ` ⚠️ FESTIVO: ${festivoProxima.name}`;
                        fechasInfo = ` FECHAS DISPONIBLES: ${hoyLabel} | ${proxLabel}.`;
                    } else if (fechaAUsar) {
                        let label = `FECHA A USAR: ${fechaAUsar}`;
                        if (festivoProxima) label += ` ⚠️ FESTIVO: ${festivoProxima.name} — El negocio podría estar cerrado, verifica disponibilidad`;
                        fechasInfo = ` ${label}.`;
                    }

                    tipoTag = `🔒 DÍA FIJO — Solo agendable los ${p.aplicaDia} para ${p.aplicaServicio}.${fechasInfo} NO preguntes día ni servicio, solo HORA. Llama verificar_disponibilidad con fecha=${fechaAUsar} y servicio=${p.aplicaServicio}.`;
                } else {
                    tipoTag = `📅 FLEXIBLE — Aplica cualquier día dentro de su vigencia. El cliente elige fecha.`;
                }

                return `- PROMO: ${p.nombre} | ${tipoTag} | ${p.descripcion} | Descuento: ${descuentoLabel} | Aplica a: ${p.aplicaServicio} | Dias: ${p.aplicaDia || 'Todos'} | Valida hasta: ${p.vence}${usosInfo}${usosRestantes}${mediaTag}`;
            }).join('\n');
        }

        // 5a. Construir horario de atencion legible desde disponibilidad
        const DIAS_ORDEN = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];
        const jornadasMap = {};
        (disponibilidadCatalog || []).filter(d => d.tipo === 'Jornada').forEach(d => {
            const dia = d.fechaDia || '';
            jornadasMap[dia] = `${d.horaIni || '?'} - ${d.horaFin || '?'}`;
        });
        // Agrupar dias con mismo horario
        const horarioGroups = {};
        DIAS_ORDEN.forEach(dia => {
            const h = jornadasMap[dia];
            if (h) {
                if (!horarioGroups[h]) horarioGroups[h] = [];
                horarioGroups[h].push(dia);
            }
        });
        let horarioLegible = '';
        if (Object.keys(horarioGroups).length > 0) {
            const lines = [];
            for (const [horario, dias] of Object.entries(horarioGroups)) {
                if (dias.length >= 3) {
                    // Detectar rango consecutivo
                    const first = DIAS_ORDEN.indexOf(dias[0]);
                    const last = DIAS_ORDEN.indexOf(dias[dias.length - 1]);
                    const isConsecutive = dias.every((d, i) => DIAS_ORDEN.indexOf(d) === first + i);
                    lines.push(`- ${isConsecutive ? dias[0] + ' a ' + dias[dias.length - 1] : dias.join(', ')}: ${horario}`);
                } else {
                    lines.push(`- ${dias.join(', ')}: ${horario}`);
                }
            }
            // Agregar dias cerrados
            const diasCerrados = DIAS_ORDEN.filter(d => !jornadasMap[d]);
            if (diasCerrados.length > 0) lines.push(`- ${diasCerrados.join(', ')}: Cerrado`);
            horarioLegible = lines.join('\n');
        } else {
            horarioLegible = 'No hay horarios configurados.';
        }

        // 5b. Construir info de ubicacion + enlaces Google Maps / Waze
        let ubicacionContext = '';
        if (config.businessAddress) {
            const addr = config.businessAddress;
            const addrLower = addr.toLowerCase();

            // Limpiar direccion para navegacion: quitar interior/apartamento/piso (confunde a Waze y Maps)
            const navAddr = addr.replace(/\s*(int(erior)?|apto|apartamento|apt|piso|oficina|ofc|local|torre|bloque|bl)\s*\.?\s*\d*\s*.*/i, '').trim();

            // Asegurar que la direccion incluya ciudad Colombia para precision en mapas
            const needsCity = !addrLower.includes('bogota') && !addrLower.includes('bogotá') && !addrLower.includes('medellin') && !addrLower.includes('medellín') && !addrLower.includes('cali') && !addrLower.includes('barranquilla') && !addrLower.includes('cartagena') && !addrLower.includes('colombia');
            const fullNavAddr = needsCity ? `${navAddr}, Bogota, Colombia` : (addrLower.includes('colombia') ? navAddr : `${navAddr}, Colombia`);
            const encodedAddr = encodeURIComponent(fullNavAddr);

            // Solo usar enlace del usuario si es URL completa de Google Maps (NO enlaces cortos maps.app.goo.gl)
            const userLink = (config.locationLink || '').trim();
            const isShortLink = userLink.includes('maps.app.goo.gl') || userLink.includes('goo.gl/maps');
            const isValidMapsLink = userLink && !isShortLink && (userLink.includes('google.com/maps') || userLink.includes('google.com.co/maps'));
            const mapsLink = isValidMapsLink ? userLink : `https://www.google.com/maps/search/?api=1&query=${encodedAddr}`;
            const wazeLink = `https://waze.com/ul?q=${encodedAddr}`;
            ubicacionContext = `\n📍 UBICACION DEL NEGOCIO:\nDireccion: ${addr}\nGoogle Maps: ${mapsLink}\nWaze: ${wazeLink}\n⚠️ IMPORTANTE: Comparte estos enlaces tal cual estan. NO modifiques ni acortes las URLs.`;
        }

        // 5c. Deduplicar colaboradores (1 persona con 2 roles = 1 nombre visible al cliente)
        const dedupSeen = {};
        const dedupUnique = [];
        colaboradoresCatalog.forEach(c => {
            const norm = c.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
            if (!dedupSeen[norm]) { dedupSeen[norm] = c; dedupUnique.push(c); }
            else if (c.rol === 'STAFF' && dedupSeen[norm].rol !== 'STAFF') {
                const idx = dedupUnique.indexOf(dedupSeen[norm]);
                if (idx >= 0) dedupUnique[idx] = c;
                dedupSeen[norm] = c;
            }
        });
        const isMultiProfessional = dedupUnique.length > 1;
        if (dedupUnique.length !== colaboradoresCatalog.length) {
            console.log(`[openai] 👥 Dedup: ${colaboradoresCatalog.length} registros → ${dedupUnique.length} profesionales únicos`);
        }

        // 5d. Prompt del sistema — ARQUITECTURA "BACKEND INTELIGENTE"
        // La IA NO calcula disponibilidad. Usa verificar_disponibilidad para que el código haga la matemática.
        const businessRules = `
---
📊 FECHA Y HORA ACTUAL (Colombia - Zona horaria oficial):
📅 HOY ES: ${todayStr} (${todayDayName})
⏰ HORA ACTUAL: ${nowTimeStr}
⚠️ REGLA CRÍTICA DE FECHAS:
- "Mañana" = ${(() => { const d = new Date(nowColombia); d.setDate(d.getDate() + 1); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); })()}
- Si el cliente menciona un día de la semana SIN fecha exacta, USA esta referencia:
${next7DaysText}
- USA SIEMPRE formato DD/MM/YYYY. NUNCA inventes fechas ni uses meses o años que ya pasaron.

🇨🇴 FESTIVOS COLOMBIA (próximos 30 días):
${colombianHolidays.filter(h => {
    const diff = (h.dateObj - nowColombia) / (1000 * 60 * 60 * 24);
    return diff >= -1 && diff <= 30;
}).map(h => {
    const cfg = (festivosConfig || []).find(f => f.fecha === h.date);
    const estado = (cfg && cfg.trabaja === 'SI') ? '✅ ABIERTO' : '🚫 CERRADO';
    return `- ${h.date}: ${h.name} [${estado}]`;
}).join('\n') || 'No hay festivos próximos.'}
⚠️ REGLA FESTIVOS:
- Si un festivo dice [🚫 CERRADO]: NO se puede agendar ese día. Informa al cliente: "El [fecha] es festivo ([nombre]) y no atendemos ese día." y sugiere otro día.
- Si un festivo dice [✅ ABIERTO]: El negocio trabaja normalmente a pesar de ser festivo. Puedes agendar sin problema.
- NUNCA intentes verificar disponibilidad en un festivo CERRADO, el sistema rechazará la solicitud.
${ubicacionContext}

🕐 HORARIO DE ATENCION AL PUBLICO:
${horarioLegible}

📌 REGLAS DE UBICACION Y HORARIOS:
- Cuando pregunten "donde quedan", "direccion", "ubicacion", "como llego", "como los encuentro": Responde con la direccion y comparte el enlace de Google Maps y Waze.
- Cuando pregunten "horarios", "a que hora abren", "a que hora cierran", "atienden hoy", "trabajan los sabados": Responde con el horario de atencion.
- Si NO hay direccion configurada, di: "Aun no tenemos la direccion registrada, por favor comunicate directamente con nosotros."

📋 REGLAS DE COMPORTAMIENTO:
1. PRIORIDAD DE INTENCIÓN — REGLA MÁS IMPORTANTE:
   Estás en WhatsApp. SIEMPRE identifica la INTENCIÓN del mensaje y responde a ella DIRECTAMENTE.
   - "Hola que servicios prestan" → Intención: PREGUNTAR POR SERVICIOS → Responde con el catálogo de servicios
   - "Hola quiero agendar cejas" → Intención: AGENDAR → Inicia flujo de agendamiento
   - "Donde quedan?" → Intención: UBICACIÓN → Responde con dirección y enlaces
   - "Hola" (solo saludo, sin pregunta) → Intención: SALUDO → Saluda y pregunta en qué puedes ayudar
   NUNCA respondas con "¿En qué te puedo ayudar?" si el mensaje YA contiene una pregunta o solicitud.
   Puedes incluir un saludo breve integrado ("¡Hola! Nuestros servicios son...") pero la RESPUESTA a la intención es lo primero.
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
   g) REAGENDAMIENTO Y PROMOCIONES:
      ⚠️ PRIMERO revisa los datos de la cita pendiente arriba. Si la cita NO tiene "🏷️ PROMO:" en sus datos, NO menciones promos ni descuentos durante el reagendamiento. El precio se mantiene igual. Sigue el flujo normal.
      SOLO si la cita tiene "🏷️ PROMO:" en sus datos y es tipo "🔒 DÍA FIJO":
      - Si el cliente quiere cambiar a un DÍA DIFERENTE al de la promo, el sistema BLOQUEARÁ automáticamente la llamada a 'reagendar_cita' y te devolverá un mensaje con las opciones para el cliente. Transmite ese mensaje TAL CUAL al cliente y espera su respuesta.
      - Si el cliente ACEPTA perder el descuento, llama de nuevo a 'reagendar_cita' con acepta_perder_descuento=true. El sistema calculará el precio completo automáticamente.
      - Si el cliente prefiere mantener el descuento, ofrécele cambiar solo la HORA dentro del mismo día de promo.
      - Si la promo es "📅 FLEXIBLE": Permite cambiar el día siempre que siga dentro de la vigencia.
11. PROMOCIONES — ESTRATEGIA DE PERSUASIÓN ACTIVA:
   ⚠️ Eres una asesora de ventas experta. Las promociones son tu herramienta principal para cerrar citas.

   HAY DOS TIPOS DE PROMOS — LEE BIEN:
   🔒 DÍA FIJO (ej: "Lunes de Cejas", "Martes de Manicure"):
      - El DÍA y el SERVICIO son FIJOS. NO preguntes "¿para qué día?" ni "¿qué servicio?".
      - Cuando el cliente quiera esta promo, SOLO pregúntale la HORA.
      - Usa las FECHAS indicadas en la promo (puede haber fecha de HOY y de la PRÓXIMA semana).
      - Si la fecha tiene ⚠️ FESTIVO, informa al cliente: "Ten en cuenta que el [fecha] es [nombre festivo], pero deja verifico si hay disponibilidad."
      - Estas promos existen para activar días con baja demanda. El cliente viene ESE día o no hay descuento.
      ⚠️ SI EL CLIENTE PIDE UN DÍA DIFERENTE AL DE LA PROMO (solo al agendar NUEVO, NO en reagendamiento):
         1. NO llames a 'verificar_disponibilidad' de inmediato. DETENTE y advierte primero.
         2. Dile CLARAMENTE: "La promoción *[nombre promo]* es exclusiva de los *[día de la promo]*. Si agendamos para el *[día que pidió]*, el precio sería el normal de $[precio completo] sin descuento. ¿Prefieres mantener tu fecha sin descuento, o prefieres agendar el próximo *[día de promo]* para aprovechar la oferta? 💖"
         3. SOLO cuando el cliente responda y elija una opción, procedes a llamar a 'verificar_disponibilidad' con la fecha que haya elegido.
         4. Si elige el día de promo: usa la FECHA EXACTA de la promo indicada arriba y llama a verificar_disponibilidad.
         5. Si elige otro día sin descuento: llama a verificar_disponibilidad con la fecha que pidió y usa el precio COMPLETO.
   📅 FLEXIBLE (ej: "Día de la Mujer", "Semana de Aniversario"):
      - Aplica a cualquier fecha dentro de la vigencia. El cliente elige día y hora libremente.
      - Puede aplicar a varios servicios.

   a) NO MENCIONES PROMOS SIN QUE EL CLIENTE LAS PIDA: NO menciones promociones de forma espontánea. Solo habla de promos cuando:
      - El cliente pregunte explícitamente por promociones, descuentos u ofertas.
      - Detectes coincidencia servicio+día al agendar (ver sección c) DETECCIÓN PROACTIVA).
      Si el cliente escribe para agendar, preguntar algo o saludar, responde SIN mencionar promos.
   b) CUANDO EL CLIENTE PREGUNTE POR PROMOS: Presentalas con entusiasmo. Si el historial ya las incluye, NO las repitas.
   c) DETECCIÓN PROACTIVA AL AGENDAR (SOLO citas NUEVAS, NO aplica durante reagendamiento): Cuando el cliente pida agendar un servicio NUEVO, CRUZA el servicio + el día de la cita con las promos activas. Si hay coincidencia, NOTIFÍCALO con entusiasmo ANTES de confirmar.
      - Si el servicio aplica pero el DÍA no: "Este servicio tiene promo los [días], ¿te gustaría agendar en uno de esos días para aprovechar el descuento? 😉"
   d) PERSUASIÓN NATURAL: No seas robótica. Usa frases persuasivas: "¡Estás de suerte!", "¡Justo hoy hay descuento!", "¡Aprovecha que vence pronto!"
   e) CÁLCULO DE DESCUENTO: Al agendar con promo, SIEMPRE muestra: ~precio original~ → *precio con descuento*. Usa el precio CON descuento en precio_total al llamar a 'agendar_cita'.
   f) MEDIA VISUAL: Si una promo tiene "📸 TIENE MEDIA VISUAL", llama 'enviar_media_promocion'. IMPORTANTE: Si en el historial dice "[Ya se enviaron imágenes/videos de las promos: ...]", NO vuelvas a enviarlas.
   g) VENCIMIENTO: Si una promo vence pronto (esta semana), menciónalo con urgencia.
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
⚠️ REGLA CRÍTICA DE PRECIO CON DESCUENTO:
- Cuando llames a 'agendar_cita' y haya una promoción aplicable, el campo 'precio_total' DEBE ser el precio YA CON DESCUENTO, NO el precio original.
- Ejemplo: Servicio $30.000 con 20% de descuento → precio_total = 24000 (NO 30000).
- Si usas el precio original, el descuento NO se registrará. SIEMPRE calcula y usa el precio final con descuento.

👥 EQUIPO DE TRABAJO:
${dedupUnique.length > 0 ? dedupUnique.map(c => `  - ${c.nombre} | Especialidades: ${c.competencias || 'Todos los servicios'}`).join('\n') : 'No hay colaboradores registrados.'}

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
- El parámetro 'profesional_preferido' permite filtrar por profesional. Ver FLUJO DE AGENDAMIENTO abajo para saber CUÁNDO y CÓMO usarlo.

📝 FLUJO DE AGENDAMIENTO:
${(() => {
    if (isMultiProfessional) {
        return `🚫🚫🚫 NEGOCIO CON MÚLTIPLES PROFESIONALES — PASO 1 ES OBLIGATORIO 🚫🚫🚫
PROHIBIDO llamar 'verificar_disponibilidad' sin antes haber preguntado por la estilista preferida.
INCLUSO si el cliente da servicio + fecha + hora todo en un solo mensaje, PRIMERO debes preguntar por profesional.
NO puedes saltarte este paso bajo NINGUNA circunstancia.

FLUJO OBLIGATORIO (seguir EN ORDEN, sin saltar pasos):
1. 👩‍🎨 PREGUNTAR POR PROFESIONAL (SIEMPRE, sin excepcion):
   - Responde al cliente confirmando el servicio solicitado
   - Pregunta: "¿Tienes alguna estilista preferida?"
   - Muestra SOLO los profesionales que dominan ese servicio (segun especialidades del EQUIPO DE TRABAJO)
   - NO muestres profesionales que no tienen ese servicio en sus especialidades
   - Ejemplo: "¡Claro! Para Cejas nuestro equipo es: Andrea, Camila y Carolina. ¿Tienes alguna preferida o te busco la mejor disponibilidad?"
   - EXCEPCION: Si el cliente YA eligio profesional antes en ESTA conversacion, no vuelvas a preguntar
2. 📅 VERIFICAR DISPONIBILIDAD (solo DESPUES de que el cliente respondio el paso 1):
   - Si eligio profesional → pasa como 'profesional_preferido'
   - Si dijo "cualquiera" / "me da igual" → NO pases profesional_preferido
   - Llama 'verificar_disponibilidad' con la fecha/hora solicitada
3. ✅ RESULTADO:
   - Si DISPONIBLE → presenta resumen al cliente y espera confirmacion
   - Si NO DISPONIBLE → ofrece las alternativas que devolvio la funcion
4. 📋 CONFIRMAR Y AGENDAR:
   - Cliente confirma (si, dale, ok, vale, confirmo, listo, bueno, hagale, claro, perfecto, etc.) → llama 'agendar_cita' OBLIGATORIAMENTE
   - ⚠️ DEBES ejecutar 'agendar_cita'. Si solo respondes con texto, la cita NO se guarda.
   - Si no estas seguro si el mensaje es confirmacion, asume que SI lo es y ejecuta 'agendar_cita'.`;
    } else {
        return `Solo hay 1 profesional en el negocio. NO preguntes por preferencia de profesional, asignalo automaticamente.
FLUJO:
1. Cliente pide servicio + fecha + hora → llama 'verificar_disponibilidad'
2. Si DISPONIBLE → presenta resumen y espera confirmacion
3. Si NO DISPONIBLE → ofrece alternativas
4. Cliente confirma (si, dale, ok, vale, confirmo, listo, bueno, hagale, claro, perfecto, etc.) → llama 'agendar_cita' OBLIGATORIAMENTE
   - ⚠️ DEBES ejecutar 'agendar_cita'. Si solo respondes con texto, la cita NO se guarda.
   - Si no estas seguro si el mensaje es confirmacion, asume que SI lo es y ejecuta 'agendar_cita'.`;
    }
})()}

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

REGLAS DE USO DE LA GALERÍA — ESTRICTAS:
⚠️ SOLO puedes mencionar el contenido que aparece ARRIBA en la lista. NUNCA inventes ni asumas contenido que no existe.
- Si un servicio tiene 1 VIDEO de procedimiento, di "tengo un video del procedimiento". NO digas "tengo fotos de antes y después" si NO hay fotos listadas.
- Si un servicio tiene 1 IMAGEN antes/despues, di "tengo una foto de resultados". NO digas "tengo videos" si NO hay videos listados.
- Usa los TITULOS exactos de los items al describir el contenido al cliente.
- Si el cliente pide ver contenido, llama 'enviar_informacion_servicio' con el nombre del servicio.
- Para items tipo RECOMENDACION: comparte el texto directamente en tu mensaje, NO llames enviar_informacion_servicio.
- NO menciones galería si el servicio NO tiene contenido en la lista de arriba.
- Después de enviar media, pregunta si tiene dudas o quiere agendar.
- NO envíes galería sin que el cliente lo pida o sin un momento natural para ofrecerla.
` : ''}
${config.hasAnyAnticipo ? `
💰 SISTEMA DE ANTICIPO / PAGO ANTICIPADO (POR SERVICIO):
⚠️⚠️⚠️ REGLA #1 DE ANTICIPO — LEE PRIMERO:
La MAYORÍA de servicios NO requieren anticipo. El campo "ANTICIPO" del catálogo te dice cuáles sí:
- "ANTICIPO: No requiere" → NO menciones anticipo, NO menciones pagos. Flujo normal.
- "ANTICIPO: X% del precio" → SÍ requiere. Sigue los pasos de abajo.
- "ANTICIPO: $X fijos" → SÍ requiere. Sigue los pasos de abajo.
TAMBIÉN: La función 'verificar_disponibilidad' te dirá explícitamente si el servicio requiere anticipo o no. OBEDECE esa instrucción.
SI NO ESTÁS SEGURO → NO menciones anticipo. Es mejor omitirlo que pedirlo incorrectamente.

- ESTADO DEL CLIENTE: ${userData.exentoAnticipo ? '✅ Este cliente está EXENTO de anticipo. NO le cobres anticipo ni menciones pagos. Flujo 100% normal.' : 'Este cliente NO está exento. Debe cumplir con el anticipo SOLO si el servicio lo requiere según el catálogo.'}
- Momento de pago: ${config.paymentMoment === 'ANTES' ? 'Paga ANTES de agendar (sin pago no hay cita).' : 'Se agenda primero y luego envía comprobante.'}
- Datos de pago: ${config.paymentInstructions}
${config.paymentPolicy ? '- Política de anticipo: ' + config.paymentPolicy : ''}

📋 FLUJO DE ANTICIPO — SOLO PARA SERVICIOS QUE LO REQUIEREN:
(Si el catálogo dice "No requiere" o 'verificar_disponibilidad' dijo "NO requiere", IGNORA todo este bloque)

🎯 TONO: Sé cálida, empática y amable al hablar del anticipo. Preséntalo como algo normal: "para separar tu espacio", "para garantizar tu cita". Hazle sentir que es por su beneficio.

PASO 1 — INFORMAR CONDICIONES CON CALIDEZ (ANTES de verificar disponibilidad):
   ⚠️ SOLO si el catálogo dice que el servicio SÍ requiere anticipo.
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

        // ─── Prompt comercial vs salon ───
        let systemFinalPrompt;
        if (config.tenantType === 'comercial') {
            systemFinalPrompt = buildCommercialPrompt(config, userData, knowledgeCatalog, servicesCatalog, todayStr, todayDayName);
        } else {
            systemFinalPrompt = `${config.systemPrompt || "Eres un asistente virtual amable y conciso."}\n\nEstás hablando con: ${userName}${birthdayContext}\n\n${businessRules}`;
        }

        const messages = [
            { role: 'system', content: systemFinalPrompt },
            ...messageHistory,
            { role: 'user', content: incomingMessage }
        ];

        console.log(`[openai] 📋 Prompt: equipo=${dedupUnique.length} pros, agenda=${allPendingAppointments.length} citas, historial=${messageHistory.length} msgs`);

        // 5. Primera llamada a OpenAI
        const activeTools = config.tenantType === 'comercial' ? COMMERCIAL_TOOLS : TOOLS;
        let completion = await openai.chat.completions.create({
            model: config.aiModel || "gpt-4o-mini",
            messages: messages,
            tools: activeTools,
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
                tools: activeTools,
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

                // ── GUARDRAIL: Selección de profesional obligatoria en negocios multi-profesional ──
                // Qué protege: El cliente debe elegir estilista antes de ver horarios
                // Cómo funciona: Bloquea la llamada si no se ha preguntado y no se pasó profesional_preferido
                if (!functionArgs.profesional_preferido && session && !session.stylistAsked && isMultiProfessional) {
                    const servicioSolicitado = (functionArgs.servicio || '').toLowerCase().trim();
                    const relevantPros = dedupUnique.filter(c => {
                        if (!c.competencias) return true;
                        return c.competencias.toLowerCase().includes(servicioSolicitado);
                    });
                    const nombres = (relevantPros.length > 0 ? relevantPros : dedupUnique).map(c => c.nombre);
                    session.stylistAsked = true;
                    toolResultText = `🚫 DETENIDO: Debes preguntar al cliente por su estilista preferida ANTES de verificar disponibilidad.\n` +
                        `Profesionales disponibles para "${functionArgs.servicio}": ${nombres.join(', ')}.\n` +
                        `Pregúntale: "¿Tienes alguna estilista preferida? Nuestro equipo para ${functionArgs.servicio} es: ${nombres.join(', ')}. ¿Tienes alguna preferida o te busco la mejor disponibilidad?"\n` +
                        `Cuando el cliente responda, llama de nuevo a verificar_disponibilidad con profesional_preferido si eligió una, o sin él si dijo "cualquiera".`;
                    console.log(`[openai] ⛔ GUARDRAIL: Bloqueada verificar_disponibilidad — falta selección de profesional (${dedupUnique.length} profesionales)`);
                }

                // Si el guardrail bloqueó, no ejecutar la función
                if (toolResultText) {
                    // toolResultText ya tiene el mensaje del guardrail
                } else {

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
                    excludeId,
                    festivosConfig,
                    promotionsCatalog
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
                } // cierre del else del guardrail de profesional
            }

            // ─── Herramienta: agendar_cita ───────────────────────────────
            else if (functionName === "agendar_cita") {
                // GUARDA: Si estamos en modo reagendamiento, NO crear cita nueva — redirigir a reagendar
                if (session && session.isReagendando && session.reagendandoCitaId) {
                    console.log(`[openai] ⚠️ GUARDA: IA llamó agendar_cita durante reagendamiento. Redirigiendo a reagendar_cita (${session.reagendandoCitaId})`);

                    // ── Validar pérdida de promo DÍA FIJO (igual que reagendar_cita) ──
                    let guardaPromoBlocked = false;
                    const guardaOldAppt = userPendingAppointments.find(c => c.id === session.reagendandoCitaId);
                    if (guardaOldAppt && guardaOldAppt.tipoPromo && session.promoLossAcceptedFor !== session.reagendandoCitaId) {
                        const guardaPromoOrig = promotionsCatalog.find(p =>
                            normDay(p.nombre) === normDay(guardaOldAppt.tipoPromo)
                        );
                        if (guardaPromoOrig && guardaPromoOrig.aplicaDia && guardaPromoOrig.aplicaDia.trim() !== '') {
                            const weekDaysG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                            let nuevaDiaG = '';
                            if (functionArgs.fecha) {
                                const fpG = functionArgs.fecha.split('/');
                                if (fpG.length === 3) {
                                    nuevaDiaG = weekDaysG[new Date(fpG[2], fpG[1] - 1, fpG[0]).getDay()];
                                }
                            }
                            const diasPromoG = guardaPromoOrig.aplicaDia.split(',').map(d => d.trim().toLowerCase());
                            if (nuevaDiaG && !diasPromoG.includes(nuevaDiaG)) {
                                guardaPromoBlocked = true;
                                const srvNamesG = functionArgs.servicios.split(',').map(s => s.trim().toLowerCase());
                                const precioCompletoG = srvNamesG.reduce((sum, name) => {
                                    const info = servicesCatalog.find(s => s.name.toLowerCase().trim() === name);
                                    return sum + (info ? info.price : 0);
                                }, 0);
                                toolResultText = `🚫 REAGENDAMIENTO PAUSADO — REQUIERE CONFIRMACIÓN DEL CLIENTE:\n\n` +
                                    `La cita ${session.reagendandoCitaId} tiene la promoción "${guardaOldAppt.tipoPromo}" que SOLO aplica los ${guardaPromoOrig.aplicaDia}.\n` +
                                    `La nueva fecha solicitada (${functionArgs.fecha}, ${nuevaDiaG}) NO es día de promoción.\n\n` +
                                    `💰 Precio ACTUAL con descuento: $${Number(guardaOldAppt.precio).toLocaleString('es-CO')}\n` +
                                    `💰 Precio SIN descuento: $${precioCompletoG.toLocaleString('es-CO')}\n\n` +
                                    `📋 INSTRUCCIÓN: Informa al cliente que perdería la promo "${guardaOldAppt.tipoPromo}" y el precio quedaría en $${precioCompletoG.toLocaleString('es-CO')}. Pregúntale si desea continuar o prefiere mantener su cita actual.`;
                                console.log(`[openai] ⛔ GUARDA: Reagendamiento bloqueado por promo "${guardaOldAppt.tipoPromo}" → ${nuevaDiaG} pierde promo.`);
                            }
                        }
                    }

                    if (!guardaPromoBlocked) {
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
                        const gasMsg = api.lastErrorMessage || '';
                        if (gasMsg.toLowerCase().includes('horario')) {
                            toolResultText = `⚠️ El sistema rechazó el reagendamiento: ${gasMsg}. Ofrece al cliente un horario DENTRO del rango permitido.`;
                        } else {
                            toolResultText = `❌ Error al reagendar la cita ${session.reagendandoCitaId}.${gasMsg ? ' Detalle: ' + gasMsg : ''} Verifica si el ID es correcto.`;
                        }
                    }
                    }
                } else {
                    // ── GUARDRAIL: Bloquear agendar_cita si no se verificó disponibilidad antes ──
                    // Qué protege: La IA no puede crear citas sin haber confirmado horario libre
                    // Cómo funciona: pendingConfirmation se setea en verificar_disponibilidad exitoso
                    if (session && !session.pendingConfirmation) {
                        toolResultText = `🚫 DETENIDO: Debes llamar primero a 'verificar_disponibilidad' antes de agendar.\n` +
                            `No puedes agendar una cita sin haber verificado que el horario esté disponible.\n` +
                            `Llama a 'verificar_disponibilidad' con la fecha, hora y servicio del cliente.`;
                        console.log(`[openai] ⛔ GUARDRAIL: Bloqueada agendar_cita sin verificar_disponibilidad previa`);
                    }

                    if (!toolResultText) {
                    // ── Detectar si aplica promo (cumpleaños u otra) — MISMO ALGORITMO QUE webhook.js ──
                    let promoDetected = 'NO';
                    let tipoPromoDetected = '';
                    let precioFinalConDescuento = functionArgs.precio_total;

                    // 1. Verificar cumpleaños
                    const cumplePromoCheck = promotionsCatalog.find(p => p.tipoPromo === 'CUMPLEANOS' && p.estado === 'ACTIVO');
                    if (cumplePromoCheck && userData.cumple) {
                        const cumpleDDMM = parseCumpleDDMM(userData.cumple);
                        if (cumpleDDMM === `${dd}/${mm}`) {
                            promoDetected = 'SI';
                            tipoPromoDetected = 'CUMPLEANOS';
                        }
                    }

                    // 2. Verificar promos normales por DIA DE LA CITA + SERVICIO
                    if (promoDetected === 'NO') {
                        const weekDaysPromo = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                        let citaDayName = '';
                        if (functionArgs.fecha) {
                            const fp = functionArgs.fecha.split('/');
                            if (fp.length === 3) {
                                const citaDate = new Date(fp[2], fp[1] - 1, fp[0]);
                                citaDayName = weekDaysPromo[citaDate.getDay()];
                            }
                        }
                        const srvNames = functionArgs.servicios.split(',').map(s => s.trim().toLowerCase());
                        const promosParaCita = (promotionsCatalog || []).filter(p => {
                            if (p.estado !== 'ACTIVO' || p.tipoPromo === 'CUMPLEANOS') return false;
                            if (p.aplicaDia && p.aplicaDia.trim() !== '') {
                                const dias = p.aplicaDia.split(',').map(d => d.trim().toLowerCase());
                                if (citaDayName && !dias.includes(citaDayName)) return false;
                            }
                            if (p.aplicaServicio && p.aplicaServicio !== 'TODOS') {
                                const srvPromo = p.aplicaServicio.split(',').map(s => s.trim().toLowerCase());
                                const matches = srvNames.some(sn => srvPromo.some(sp => sn.includes(sp) || sp.includes(sn)));
                                if (!matches) return false;
                            }
                            return true;
                        });

                        if (promosParaCita.length > 0) {
                            const bestPromo = promosParaCita[0];
                            promoDetected = 'SI';
                            tipoPromoDetected = bestPromo.nombre || bestPromo.tipoPromo || 'DESCUENTO';

                            // Calcular descuento programáticamente (no confiar en la IA)
                            const catalogPrice = srvNames.reduce((sum, name) => {
                                const info = servicesCatalog.find(s => s.name.toLowerCase().trim() === name);
                                return sum + (info ? info.price : 0);
                            }, 0);
                            if (catalogPrice > 0) {
                                if (bestPromo.tipoPromo === 'PORCENTAJE') {
                                    precioFinalConDescuento = Math.round(catalogPrice * (1 - bestPromo.valorDescuento / 100));
                                } else if (bestPromo.tipoPromo === 'VALOR_FIJO') {
                                    precioFinalConDescuento = Math.max(0, catalogPrice - bestPromo.valorDescuento);
                                } else {
                                    precioFinalConDescuento = functionArgs.precio_total;
                                }
                                if (precioFinalConDescuento !== catalogPrice && bestPromo.tipoPromo !== '2X1') {
                                    console.log(`[openai] 🏷️ Promo "${bestPromo.nombre}" aplicada vía agendar_cita: $${catalogPrice} → $${precioFinalConDescuento}`);
                                }
                            }
                        }
                    }

                    const agendaId = await api.createAgenda({
                        fecha: functionArgs.fecha,
                        inicio: functionArgs.hora_inicio,
                        fin: functionArgs.hora_fin,
                        cliente: userName,
                        celularCliente: userData.celular || "",
                        servicio: functionArgs.servicios,
                        precio: precioFinalConDescuento,
                        profesional: functionArgs.profesional || "Por asignar",
                        notas: functionArgs.notas || "",
                        promo: promoDetected,
                        tipoPromo: tipoPromoDetected
                    });

                    if (agendaId) {
                        const profLabel = functionArgs.profesional && functionArgs.profesional !== 'Por asignar' ? ` Profesional: ${functionArgs.profesional}.` : '';
                        const promoNote = promoDetected === 'SI' ? ` (Promo: ${tipoPromoDetected})` : '';
                        toolResultText = `✅ Cita GUARDADA exitosamente en el sistema. ID del turno: ${agendaId}. Fecha: ${functionArgs.fecha} de ${functionArgs.hora_inicio} a ${functionArgs.hora_fin}. Servicios: ${functionArgs.servicios}. Total: $${precioFinalConDescuento.toLocaleString('es-CO')}${promoNote}.${profLabel}\n\n→ IMPORTANTE: La cita YA FUE GUARDADA con ID ${agendaId}. Presenta el resumen de confirmación al cliente con el precio $${precioFinalConDescuento.toLocaleString('es-CO')}. NO pidas otra confirmación, la cita ya está registrada en el sistema.`;
                        if (session) session._lastToolAction = 'cita_creada';
                    } else {
                        const gasMsg = api.lastErrorMessage || '';
                        if (gasMsg.toLowerCase().includes('horario')) {
                            toolResultText = `⚠️ El sistema rechazó la cita: ${gasMsg}. Ofrece al cliente un horario DENTRO del rango permitido.`;
                        } else {
                            toolResultText = `❌ Hubo un problema al registrar la cita en el sistema.${gasMsg ? ' Detalle: ' + gasMsg : ''} Por favor intenta de nuevo.`;
                        }
                    }
                    } // cierre del if (!toolResultText) — guardrail verificar_disponibilidad
                }
            }

            // ─── Herramienta: reagendar_cita ──────────────────────────────
            else if (functionName === "reagendar_cita") {
                // ── GUARDRAIL: Validar pérdida de promo DÍA FIJO ──
                let promoBlocked = false;
                const oldAppt = userPendingAppointments.find(c => c.id === functionArgs.id_cita_antigua);
                if (oldAppt && oldAppt.tipoPromo && !(session && session.promoLossAcceptedFor === functionArgs.id_cita_antigua)) {
                    const promoOriginal = promotionsCatalog.find(p =>
                        normDay(p.nombre) === normDay(oldAppt.tipoPromo)
                    );
                    if (promoOriginal && promoOriginal.aplicaDia && promoOriginal.aplicaDia.trim() !== '') {
                        // Es promo DÍA FIJO — verificar si la nueva fecha califica
                        const weekDaysCheck = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
                        let nuevaFechaDayName = '';
                        if (functionArgs.nueva_fecha) {
                            const fp = functionArgs.nueva_fecha.split('/');
                            if (fp.length === 3) {
                                const nd = new Date(fp[2], fp[1] - 1, fp[0]);
                                nuevaFechaDayName = weekDaysCheck[nd.getDay()];
                            }
                        }
                        const diasPromo = promoOriginal.aplicaDia.split(',').map(d => d.trim().toLowerCase());
                        const nuevaFechaCalifica = diasPromo.includes(nuevaFechaDayName);

                        if (!nuevaFechaCalifica) {
                            // Calcular precio completo sin descuento
                            const srvNames = functionArgs.nuevos_servicios.split(',').map(s => s.trim().toLowerCase());
                            const precioCompleto = srvNames.reduce((sum, name) => {
                                const info = servicesCatalog.find(s => s.name.toLowerCase().trim() === name);
                                return sum + (info ? info.price : 0);
                            }, 0);

                            if (functionArgs.acepta_perder_descuento === true) {
                                // Cliente aceptó explícitamente — forzar precio completo y proceder
                                if (precioCompleto > 0) functionArgs.nuevo_precio_total = precioCompleto;
                                console.log(`[openai] 🏷️ Reagendamiento sin promo aceptado: ${oldAppt.tipoPromo} perdida. Precio: $${oldAppt.precio} → $${functionArgs.nuevo_precio_total}`);
                                // promoBlocked = false → continúa a la ejecución normal
                            } else {
                                // BLOQUEAR — el parámetro acepta_perder_descuento no fue enviado o es false
                                promoBlocked = true;
                                toolResultText = `🚫 REAGENDAMIENTO PAUSADO — REQUIERE CONFIRMACIÓN DEL CLIENTE:\n\n` +
                                    `La cita ${functionArgs.id_cita_antigua} tiene la promoción "${oldAppt.tipoPromo}" que SOLO aplica los ${promoOriginal.aplicaDia}.\n` +
                                    `La nueva fecha solicitada (${functionArgs.nueva_fecha}, ${nuevaFechaDayName}) NO es día de promoción.\n\n` +
                                    `💰 Precio ACTUAL con descuento: $${Number(oldAppt.precio).toLocaleString('es-CO')}\n` +
                                    `💰 Precio SIN descuento: $${precioCompleto.toLocaleString('es-CO')}\n\n` +
                                    `📋 INSTRUCCIÓN: Debes enviarle este mensaje al cliente:\n` +
                                    `"Tu cita actual tiene la promo *${oldAppt.tipoPromo}* que solo aplica los *${promoOriginal.aplicaDia}*. Si la cambias al ${functionArgs.nueva_fecha}, el servicio quedaría a precio normal de *$${precioCompleto.toLocaleString('es-CO')}* sin descuento.\n\n¿Prefieres:\n1️⃣ Cambiar solo la *hora* dentro del día de promo para mantener tu descuento\n2️⃣ Reagendar al ${functionArgs.nueva_fecha} a precio completo de $${precioCompleto.toLocaleString('es-CO')}?"\n\n` +
                                    `⚠️ SOLO si el cliente elige la opción 2 (acepta precio completo), llama de nuevo a 'reagendar_cita' con acepta_perder_descuento=true y nuevo_precio_total=${precioCompleto}.`;
                                console.log(`[openai] ⛔ Reagendamiento bloqueado: promo "${oldAppt.tipoPromo}" se perdería. Esperando confirmación del cliente.`);
                            }
                        }
                    }
                }

                if (!promoBlocked) {
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
                        const gasMsg = api.lastErrorMessage || '';
                        if (gasMsg.toLowerCase().includes('horario')) {
                            toolResultText = `⚠️ El sistema rechazó el reagendamiento: ${gasMsg}. Ofrece al cliente un horario DENTRO del rango permitido.`;
                        } else {
                            toolResultText = `❌ Error al reagendar la cita ${functionArgs.id_cita_antigua}.${gasMsg ? ' Detalle: ' + gasMsg : ''} Verifica si el ID es correcto.`;
                        }
                    }
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
                // ── GUARDRAIL: Bloquear cancelación durante reagendamiento ──
                // Qué protege: Evita que la IA cancele una cita mientras está en flujo de reagendamiento
                // Cómo funciona: Si isReagendando está activo, bloquea y pide aclaración al cliente
                if (session && session.isReagendando && session.reagendandoCitaId) {
                    toolResultText = `🚫 MODO REAGENDAMIENTO ACTIVO — No puedes cancelar mientras reagendas la cita ${session.reagendandoCitaId}.\n` +
                        `Pregúntale al cliente: "Estamos en proceso de reagendar tu cita ${session.reagendandoCitaId}. ¿Prefieres cancelarla en vez de reagendarla?".\n` +
                        `Si el cliente confirma que quiere CANCELAR, primero el sistema debe salir del modo reagendamiento.`;
                    console.log(`[openai] ⛔ GUARDRAIL: Bloqueada cancelar_cita durante reagendamiento (cita: ${session.reagendandoCitaId})`);
                } else {
                    const exito = await api.cancelAgenda(functionArgs.id_cita);
                    if (exito) {
                        toolResultText = `✅ Cita ${functionArgs.id_cita} CANCELADA exitosamente. El horario ha sido liberado.`;
                        if (session) session._lastToolAction = 'cita_cancelada';
                    } else {
                        toolResultText = `❌ Error al cancelar la cita ${functionArgs.id_cita}. Verifica si el ID es correcto.`;
                    }
                }
            }

            // ─── Herramientas comerciales (tenant type: comercial) ─────────
            else if (functionName === "capturar_lead") {
                // ── GUARDRAIL: Evitar leads duplicados en la misma conversación ──
                if (session._leadCapturado) {
                    toolResultText = `⚠️ Ya capturaste este lead (${session._leadCapturado}). No lo vuelvas a guardar. Continúa la conversación normalmente.`;
                    console.log(`[openai] ⛔ Lead duplicado bloqueado: ${session._leadCapturado}`);
                } else {
                    const crmUrl = config.crmBeautyosUrl;
                    if (!crmUrl) {
                        toolResultText = '❌ CRM URL no configurada. No se pudo guardar el lead.';
                    } else {
                        // ── GUARDRAIL: Usar el número real del remitente, no el que inventa la IA ──
                        const whatsappReal = session.datos?.celular || functionArgs.whatsapp;
                        // Limpiar valores undefined/null que la IA puede enviar como string
                        const cleanVal = (v) => (!v || v === 'undefined' || v === 'null') ? '' : String(v).trim();
                        const resp = await api.postToCRM(crmUrl, {
                            action: 'saveLead',
                            nombreContacto: cleanVal(functionArgs.nombreContacto) || cleanVal(session.datos?.nombre),
                            nombreNegocio: cleanVal(functionArgs.nombreNegocio),
                            whatsapp: whatsappReal,
                            email: cleanVal(functionArgs.email),
                            ciudad: cleanVal(functionArgs.ciudad),
                            cantidadEmpleados: cleanVal(functionArgs.cantidadEmpleados),
                            notas: cleanVal(functionArgs.notas),
                            fuente: 'whatsapp-agente'
                        });
                        if (resp && !resp.error) {
                            session._leadCapturado = functionArgs.nombreNegocio;
                            toolResultText = `✅ Lead guardado exitosamente: ${functionArgs.nombreNegocio} (${whatsappReal}). El equipo comercial dará seguimiento.`;
                            console.log(`[openai] 📋 Lead capturado: ${functionArgs.nombreNegocio} - WhatsApp real: ${whatsappReal}`);

                            // Alerta WhatsApp al asesor asignado (round-robin) + resumen al admin
                            const asesores = (config.whatsappAsesores || '').split(',').map(n => n.trim()).filter(Boolean);
                            const asesorAsignado = resp.asesorAsignado || '';
                            if (asesores.length > 0 && asesorAsignado) {
                                const alertMsg = `*🔔 Nuevo Lead BeautyOS*\n\n👤 Contacto: ${functionArgs.nombreContacto || 'Sin nombre'}\n💼 Negocio: ${functionArgs.nombreNegocio}\n📱 WhatsApp: ${whatsappReal}\n📍 Ciudad: ${functionArgs.ciudad || 'No indicada'}\n👥 Empleados: ${functionArgs.cantidadEmpleados || 'No indicado'}\n\n${functionArgs.notas ? '📝 Notas: ' + functionArgs.notas + '\n\n' : ''}✅ *Asignado a ti.* Contactalo para cerrar la venta.`;
                                if (!session._pendingTransferMessages) session._pendingTransferMessages = [];
                                session._pendingTransferMessages.push({ to: asesorAsignado, text: alertMsg });
                                if (asesores.length > 1 && asesores[0] !== asesorAsignado) {
                                    session._pendingTransferMessages.push({ to: asesores[0], text: `*Lead asignado a ${asesorAsignado}*\n${functionArgs.nombreContacto || ''} - ${functionArgs.nombreNegocio} (${functionArgs.ciudad || ''})` });
                                }
                                console.log(`[openai] Lead asignado a ${asesorAsignado} (round-robin)`);
                            }
                        } else {
                            toolResultText = `⚠️ Error guardando lead: ${resp?.error || 'Sin respuesta del CRM'}. Informa al cliente que tomarás nota manualmente.`;
                        }
                    }
                }
            }

            // ── HANDLER: Actualizar estado del lead en el pipeline ──
            else if (functionName === "actualizar_estado_lead") {
                const crmUrl = config.crmBeautyosUrl;
                const whatsappLead = session.datos?.celular || '';
                if (!crmUrl || !whatsappLead) {
                    toolResultText = '❌ No se pudo actualizar: CRM URL o WhatsApp no disponible.';
                } else {
                    try {
                        const resp = await api.postToCRM(crmUrl, {
                            action: 'updateLeadByWhatsapp',
                            whatsapp: whatsappLead,
                            estado: functionArgs.nuevoEstado,
                            notas: functionArgs.motivo || ''
                        });
                        if (resp && resp.success) {
                            if (session.datos) session.datos.estadoLead = functionArgs.nuevoEstado;
                            toolResultText = `✅ Lead actualizado a ${functionArgs.nuevoEstado}. Motivo registrado: ${functionArgs.motivo}`;
                            console.log(`[openai] 📊 Lead ${whatsappLead} → ${functionArgs.nuevoEstado}: ${functionArgs.motivo}`);

                            // GANADO: alertar al asesor para iniciar onboarding
                            if (functionArgs.nuevoEstado === 'GANADO') {
                                const asesores = (config.whatsappAsesores || '').split(',').map(n => n.trim()).filter(Boolean);
                                if (asesores.length > 0) {
                                    const alertMsg = `*🎉 NEGOCIO CERRADO*\n\n👤 ${session.datos?.nombre || ''}\n💼 ${session.datos?.negocio || ''}\n📱 ${whatsappLead}\n\n📝 ${functionArgs.motivo}\n\n👉 Iniciar onboarding técnico.`;
                                    if (!session._pendingTransferMessages) session._pendingTransferMessages = [];
                                    session._pendingTransferMessages.push({ to: asesores[0], text: alertMsg });
                                }
                            }

                            // PERDIDO: marcar sesión para no insistir más
                            if (functionArgs.nuevoEstado === 'PERDIDO') {
                                session._leadPerdido = true;
                            }
                        } else {
                            toolResultText = `⚠️ No se encontró el lead. ${resp?.error || ''}`;
                        }
                    } catch (err) {
                        toolResultText = `⚠️ Error actualizando: ${err.message}`;
                    }
                }
            }

            else if (functionName === "reportar_novedad") {
                const crmUrl = config.crmBeautyosUrl;
                if (!crmUrl) {
                    toolResultText = '❌ CRM URL no configurada. No se pudo registrar la novedad.';
                } else {
                    const clienteData = userData || {};
                    const resp = await api.postToCRM(crmUrl, {
                        action: 'saveNovedad',
                        whatsapp: clienteData.celular || session?.datos?.celular || '',
                        nombreNegocio: clienteData.nombre || session?.datos?.nombre || '',
                        idCliente: clienteData.idCliente || session?.datos?.idCliente || '',
                        tipoNovedad: functionArgs.tipoNovedad,
                        descripcion: functionArgs.descripcion,
                        prioridad: functionArgs.prioridad || 'MEDIA'
                    });
                    if (resp && !resp.error) {
                        const novedadId = resp.data?.id || resp.id || '';
                        toolResultText = `✅ Novedad registrada${novedadId ? ' (ID: ' + novedadId + ')' : ''}. Tipo: ${functionArgs.tipoNovedad}. Prioridad: ${functionArgs.prioridad || 'MEDIA'}. El equipo técnico la revisará pronto.`;
                        console.log(`[openai] 🔧 Novedad registrada: ${functionArgs.tipoNovedad} - ${functionArgs.prioridad || 'MEDIA'}`);
                    } else {
                        toolResultText = `⚠️ Error registrando novedad: ${resp?.error || 'Sin respuesta'}. Asegura al cliente que el equipo fue notificado.`;
                    }
                }
            }

            else if (functionName === "transferir_asesor") {
                const asesores = (config.whatsappAsesores || '').split(',').filter(a => a.trim());
                if (asesores.length === 0) {
                    toolResultText = '⚠️ No hay asesores configurados. Informa al cliente que será contactado pronto por el equipo.';
                } else {
                    const clienteName = userData.nombre || session?.datos?.nombre || 'Sin nombre';
                    const clientePhone = userData.celular || session?.datos?.celular || 'N/A';
                    const msg = `🔔 *Transferencia de lead*\n📱 ${clientePhone}\n👤 ${clienteName}\n📝 ${functionArgs.motivo}\n${functionArgs.urgente ? '🔴 URGENTE' : '🟡 Normal'}`;
                    // Guardar en session para que webhook.js envíe via Evolution API
                    if (session) {
                        session._pendingTransferMessages = asesores.map(a => ({
                            to: a.trim(),
                            text: msg
                        }));
                    }
                    toolResultText = `✅ Asesor${asesores.length > 1 ? 'es' : ''} notificado${asesores.length > 1 ? 's' : ''}. Un miembro del equipo contactará al cliente pronto.${functionArgs.urgente ? ' (Marcado como URGENTE)' : ''}`;
                    console.log(`[openai] 📤 Transferencia a ${asesores.length} asesor(es): ${functionArgs.motivo}`);
                }
            }

            else if (functionName === "consultar_estado_cuenta") {
                const clientesCRM = config._clientesCRM || {};
                const clientePhone = userData.celular || session?.datos?.celular || '';
                const clienteInfo = clientesCRM[clientePhone];
                if (!clienteInfo) {
                    toolResultText = 'No se encontró información de facturación para este cliente. Verifica el número o consulta con el equipo administrativo.';
                } else {
                    toolResultText = `📊 Estado de cuenta:\n` +
                        `- Negocio: ${clienteInfo.nombre}\n` +
                        `- Plan: ${clienteInfo.plan || 'Sin plan'}\n` +
                        `- Periodo: ${clienteInfo.periodo || 'N/A'}\n` +
                        `- Precio: $${Number(clienteInfo.precio || 0).toLocaleString('es-CO')}\n` +
                        `- Próximo cobro: ${clienteInfo.proxCobro || 'N/A'}\n` +
                        `- Estado pago: ${clienteInfo.estadoPago || 'N/A'}\n` +
                        `- Días de mora: ${clienteInfo.diasMora || 0}\n` +
                        `- Días para vencer: ${clienteInfo.diasParaVencer ?? 'N/A'}\n` +
                        `- Días de gracia: ${clienteInfo.diasGracia || 15}`;
                    console.log(`[openai] 💰 Consulta estado cuenta: ${clienteInfo.nombre} (mora: ${clienteInfo.diasMora || 0}d)`);
                }
            }

            else if (functionName === "registrar_compromiso_pago") {
                const crmUrl = config.crmBeautyosUrl;
                if (!crmUrl) {
                    toolResultText = '❌ CRM URL no configurada.';
                } else {
                    const clienteData = userData || {};
                    const resp = await api.postToCRM(crmUrl, {
                        action: 'saveNovedad',
                        idCliente: functionArgs.idCliente,
                        whatsapp: clienteData.celular || session?.datos?.celular || '',
                        nombreNegocio: clienteData.nombre || session?.datos?.nombre || '',
                        tipoNovedad: 'Compromiso de pago',
                        descripcion: `Compromiso: pagar $${functionArgs.monto ? functionArgs.monto.toLocaleString('es-CO') : '?'} el ${functionArgs.fechaCompromiso}. ${functionArgs.notas || ''}`,
                        prioridad: 'MEDIA'
                    });
                    if (resp && !resp.error) {
                        toolResultText = `✅ Compromiso de pago registrado. Cliente se comprometió a pagar $${functionArgs.monto ? functionArgs.monto.toLocaleString('es-CO') : '?'} el ${functionArgs.fechaCompromiso}. Se hará seguimiento.`;
                        console.log(`[openai] 💳 Compromiso de pago: ${functionArgs.idCliente} → $${functionArgs.monto || '?'} el ${functionArgs.fechaCompromiso}`);
                    } else {
                        toolResultText = `⚠️ Error registrando compromiso: ${resp?.error || 'Sin respuesta'}. Informa al cliente que el compromiso fue anotado.`;
                    }
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
