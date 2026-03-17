const fs = require('fs');
const path = require('path');
const { loadClientConfig, loadServicesConfig, loadKnowledgeConfig, loadServiceGallery,
        loadRegisteredClients, loadPendingAppointments, loadPromotions, loadDisponibilidad, loadColaboradores, loadExpiredAppointments, loadPromoUsage, loadFestivosConfig } = require('./sheets');
const api = require('./api');
const { isValidLicense } = require('../utils/license');

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

// Almacén en memoria de todos los tenants activos
const tenantStore = {};

// Referencia al cliente de Evolution API (inyectado desde app.js)
let evolutionClient = null;

/**
 * Convierte URL de Google Drive a formato descarga directa para Evolution API.
 */
function convertDriveUrl(url) {
    if (!url) return url;
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match2) return `https://drive.google.com/uc?export=download&id=${match2[1]}`;
    return url;
}

function setEvolutionClient(client) {
    evolutionClient = client;
}

/**
 * Lee las definiciones estáticas de tenants desde tenants.json
 */
function loadTenantDefinitions() {
    const tenantsPath = path.resolve(__dirname, '../../../tenants.json');
    const raw = fs.readFileSync(tenantsPath, 'utf-8');
    return JSON.parse(raw);
}

/**
 * Inicializa un solo tenant: carga todos los datos de Google Sheets
 * @param {string} tenantId Identificador del tenant (key en tenants.json)
 * @param {Object} tenantDef Definición estática del tenant
 */
async function initTenant(tenantId, tenantDef) {
    const { sheetId, webhookGasUrl, instanceName, displayName, enabled } = tenantDef;

    if (!enabled) {
        console.log(`[${tenantId}] Tenant deshabilitado, omitiendo.`);
        return null;
    }

    console.log(`[${tenantId}] Inicializando tenant: ${displayName}...`);

    const config = await loadClientConfig(sheetId);
    if (!config) {
        console.error(`[${tenantId}] Error cargando config del Sheet ${sheetId}. Omitiendo.`);
        return null;
    }

    if (!isValidLicense(config.status)) {
        console.log(`[${tenantId}] Licencia INACTIVA (estado: ${config.status}). Omitiendo.`);
        return null;
    }

    // Cargar todos los datos en paralelo para acelerar el arranque
    const [servicesCatalog, knowledgeCatalog, registeredClients, pendingAppointments, promotionsCatalog, disponibilidadCatalog, colaboradoresCatalog, serviceGallery, promoUsage, festivosConfig] =
        await Promise.all([
            loadServicesConfig(sheetId),
            loadKnowledgeConfig(sheetId),
            loadRegisteredClients(sheetId),
            loadPendingAppointments(sheetId),
            loadPromotions(sheetId),
            loadDisponibilidad(sheetId),
            loadColaboradores(sheetId),
            loadServiceGallery(sheetId),
            loadPromoUsage(sheetId),
            loadFestivosConfig(sheetId)
        ]);

    // Computed flag: al menos un servicio tiene anticipo habilitado
    config.hasAnyAnticipo = servicesCatalog.some(s => s.anticipoEnabled);

    const tenant = {
        ...tenantDef,
        config,
        servicesCatalog,
        knowledgeCatalog,
        registeredClients,
        pendingAppointments,
        promotionsCatalog,
        disponibilidadCatalog,
        colaboradoresCatalog,
        serviceGallery,
        promoUsage,
        festivosConfig,
        userSessions: {},
        promoBroadcastsSent: {},
        syncInterval: null,
        lastSync: new Date().toISOString()
    };

    // Iniciar sincronización periódica con Google Sheets
    const syncMs = tenantDef.syncInterval || DEFAULT_SYNC_INTERVAL_MS;
    tenant.syncInterval = setInterval(async () => {
        await syncTenantData(tenantId);
    }, syncMs);
    console.log(`[${tenantId}] 🔄 Sync cada ${syncMs / 1000}s`);

    tenantStore[tenantId] = tenant;

    const promosActivas = promotionsCatalog.filter(p => p.estado === 'ACTIVO').length;
    const jornadasConfig = disponibilidadCatalog.filter(d => d.tipo === 'Jornada').length;
    const bloqueosConfig = disponibilidadCatalog.filter(d => d.tipo === 'Bloqueo').length;
    const galeriaItems = Object.values(serviceGallery).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`[${tenantId}] Listo. Licencia: ACTIVA | Negocio: ${config.businessName} | CRM: ${Object.keys(registeredClients).length} clientes | Citas pendientes: ${Object.keys(pendingAppointments).length} cliente(s) | Promos activas: ${promosActivas} | Jornadas: ${jornadasConfig} dias | Bloqueos: ${bloqueosConfig} | Colaboradores: ${colaboradoresCatalog.length} | Galeria: ${galeriaItems} items en ${Object.keys(serviceGallery).length} servicios`);
    console.log(`[${tenantId}] ⏱️ Tiempos: Slots cada ${config.slotInterval || 15}min | Buffer entre citas: ${config.bufferTime || 15}min`);
    // Debug: mostrar competencias cargadas por colaborador
    if (colaboradoresCatalog.length > 0) {
        colaboradoresCatalog.forEach(c => {
            console.log(`[${tenantId}]   👤 ${c.nombre} (${c.rol}) → Competencias: ${c.competencias || '(sin definir)'}`);
        });
    }
    return tenant;
}

/**
 * Refresca los datos de un tenant desde Google Sheets
 */
async function syncTenantData(tenantId) {
    const tenant = tenantStore[tenantId];
    if (!tenant) return;

    try {
        console.log(`[${tenantId}] Sincronizando datos desde Google Sheets...`);
        const { sheetId } = tenant;

        const [config, servicesCatalog, knowledgeCatalog, registeredClients, pendingAppointments, promotionsCatalog, disponibilidadCatalog, colaboradoresCatalog, serviceGallery, promoUsage, festivosConfig] =
            await Promise.all([
                loadClientConfig(sheetId),
                loadServicesConfig(sheetId),
                loadKnowledgeConfig(sheetId),
                loadRegisteredClients(sheetId),
                loadPendingAppointments(sheetId),
                loadPromotions(sheetId),
                loadDisponibilidad(sheetId),
                loadColaboradores(sheetId),
                loadServiceGallery(sheetId),
                loadPromoUsage(sheetId),
                loadFestivosConfig(sheetId)
            ]);

        tenant.config = config || tenant.config;
        tenant.servicesCatalog = servicesCatalog;
        // Recomputar flag de anticipo tras sync
        tenant.config.hasAnyAnticipo = servicesCatalog.some(s => s.anticipoEnabled);
        tenant.knowledgeCatalog = knowledgeCatalog;
        tenant.registeredClients = registeredClients;
        tenant.pendingAppointments = pendingAppointments;
        tenant.promotionsCatalog = promotionsCatalog;
        tenant.disponibilidadCatalog = disponibilidadCatalog;
        tenant.colaboradoresCatalog = colaboradoresCatalog;
        tenant.serviceGallery = serviceGallery;
        tenant.promoUsage = promoUsage;
        tenant.festivosConfig = festivosConfig;
        tenant.lastSync = new Date().toISOString();

        console.log(`[${tenantId}] Sincronizacion completa.`);

        // ── Auto-expire: Marcar citas vencidas como RECHAZADO ──
        try {
            const expirationMinutes = (tenant.config && tenant.config.expirationMinutes) || 30;
            const expiredAppointments = await loadExpiredAppointments(sheetId, expirationMinutes);

            if (expiredAppointments.length > 0) {
                console.log(`[${tenantId}] 🕐 ${expiredAppointments.length} cita(s) vencida(s) encontrada(s). Auto-expire a RECHAZADO...`);

                // Override webhookUrl del singleton api para este tenant
                api.webhookUrl = tenant.webhookGasUrl;

                for (const cita of expiredAppointments) {
                    try {
                        const result = await api.updateAgendaStatus(cita.id, 'RECHAZADO');
                        if (result) {
                            console.log(`[${tenantId}]   ✅ ${cita.id} → RECHAZADO (${cita.fecha} ${cita.fin} - ${cita.servicio})`);
                        } else {
                            console.error(`[${tenantId}]   ❌ Error actualizando ${cita.id}`);
                        }
                    } catch (expErr) {
                        console.error(`[${tenantId}]   ❌ Error en auto-expire ${cita.id}:`, expErr.message);
                    }
                }

                // Refrescar pendingAppointments despues de auto-expire
                tenant.pendingAppointments = await loadPendingAppointments(sheetId);
            }
        } catch (expError) {
            console.error(`[${tenantId}] Error en auto-expire:`, expError.message);
        }

        // ── Clasificacion automatica de clientes (cada 3 syncs = ~15 min) ──
        try {
            tenant.syncCount = (tenant.syncCount || 0) + 1;
            if (tenant.syncCount % 3 === 0) {
                api.webhookUrl = tenant.webhookGasUrl;
                const classResult = await api.classifyClientes({
                    ocasional: tenant.config.classifyOcasional || 1,
                    frecuente: tenant.config.classifyFrecuente || 4,
                    vip: tenant.config.classifyVip || 9
                });
                if (classResult.total > 0) {
                    console.log(`[${tenantId}] Clasificacion: ${classResult.total} cliente(s) actualizado(s)`);
                    classResult.updated.forEach(u => {
                        console.log(`[${tenantId}]   ${u.celular}: ${u.oldTipo || 'Sin tipo'} → ${u.newTipo} (${u.citas} citas)`);
                    });
                }
            }
        } catch (classError) {
            console.error(`[${tenantId}] Error en clasificacion:`, classError.message);
        }

        // ── Cumpleanos proactivos (multi-envio configurable desde PROMOCIONES) ──
        try {
            const cumplePromo = (tenant.promotionsCatalog || []).find(p =>
                p.tipoPromo === 'CUMPLEANOS' && p.estado === 'ACTIVO'
            );

            if (cumplePromo && evolutionClient) {
                const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
                const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

                // Parsear horas de envio desde APLICA_DIA (ej: "08:00,13:00,19:00")
                const rawHours = (cumplePromo.aplicaDia || '08:00').toString().trim();
                const sendHours = rawHours.split(',')
                    .map(h => h.trim())
                    .filter(h => /^\d{1,2}:\d{2}$/.test(h))
                    .map(h => { const [hh, mm] = h.split(':').map(Number); return { h: hh, m: mm, label: h }; });
                if (sendHours.length === 0) sendHours.push({ h: 8, m: 0, label: '08:00' });

                // Resetear tracking si cambio de dia
                if (!tenant.birthdaySent || tenant.birthdaySent.date !== todayKey) {
                    tenant.birthdaySent = { date: todayKey, manana: false, hoy: {} };
                }

                const nowH = today.getHours();
                const nowM = today.getMinutes();

                // Indices de horas que ya llegaron
                const arrivedIndices = [];
                for (let i = 0; i < sendHours.length; i++) {
                    if (nowH > sendHours[i].h || (nowH === sendHours[i].h && nowM >= sendHours[i].m)) {
                        arrivedIndices.push(i);
                    }
                }

                if (arrivedIndices.length > 0) {
                    const allowedTypes = cumplePromo.aplicaTipoCliente === 'TODOS'
                        ? null
                        : cumplePromo.aplicaTipoCliente.split(',').map(t => t.trim().toLowerCase());

                    const dd = String(today.getDate()).padStart(2, '0');
                    const mm = String(today.getMonth() + 1).padStart(2, '0');
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const dd2 = String(tomorrow.getDate()).padStart(2, '0');
                    const mm2 = String(tomorrow.getMonth() + 1).padStart(2, '0');

                    // Llamar API con retry (1 reintento tras 5s si falla)
                    api.webhookUrl = tenant.webhookGasUrl;
                    let bday = { hoy: [], manana: [] };
                    try {
                        bday = await api.getBirthdayClients(`${dd}/${mm}`, `${dd2}/${mm2}`);
                    } catch (apiErr) {
                        console.log(`[${tenantId}] Cumpleanos: primer intento fallo (${apiErr.message}), reintentando en 5s...`);
                        await new Promise(r => setTimeout(r, 5000));
                        try {
                            bday = await api.getBirthdayClients(`${dd}/${mm}`, `${dd2}/${mm2}`);
                        } catch (retryErr) {
                            console.error(`[${tenantId}] Cumpleanos: retry tambien fallo (${retryErr.message})`);
                        }
                    }

                    let enviados = 0;

                    // MANANA: 1 solo mensaje al llegar la primera hora
                    if (!tenant.birthdaySent.manana && bday.manana && bday.manana.length > 0) {
                        tenant.birthdaySent.manana = true;
                        for (const c of bday.manana) {
                            if (allowedTypes && !allowedTypes.includes((c.tipo || 'Nuevo').toLowerCase())) continue;
                            await sendBirthdayMessage(tenant, c, 'manana', cumplePromo, 0, sendHours.length);
                            enviados++;
                        }
                    }

                    // HOY: multi-envio por cliente, se detiene si ya agendo
                    if (bday.hoy && bday.hoy.length > 0) {
                        const todayDDMMYYYY = `${dd}/${mm}/${today.getFullYear()}`;

                        for (const c of bday.hoy) {
                            if (allowedTypes && !allowedTypes.includes((c.tipo || 'Nuevo').toLowerCase())) continue;

                            // Verificar si ya tiene cita para hoy → SKIP
                            const clientAppts = tenant.pendingAppointments[c.celular] || [];
                            const hasApptToday = clientAppts.some(a => a.fecha === todayDDMMYYYY);
                            if (hasApptToday) {
                                console.log(`[${tenantId}] Cumpleanos: ${c.nombre} ya tiene cita hoy, omitiendo envios.`);
                                continue;
                            }

                            // Tracking per-client
                            if (!tenant.birthdaySent.hoy[c.celular]) tenant.birthdaySent.hoy[c.celular] = [];
                            const sentIndices = tenant.birthdaySent.hoy[c.celular];

                            for (const idx of arrivedIndices) {
                                if (!sentIndices.includes(idx)) {
                                    await sendBirthdayMessage(tenant, c, 'hoy', cumplePromo, idx, sendHours.length);
                                    sentIndices.push(idx);
                                    enviados++;
                                }
                            }
                        }
                    }

                    if (enviados > 0) {
                        console.log(`[${tenantId}] Cumpleanos: ${enviados} mensaje(s) enviado(s) (horas: ${rawHours}, tipos: ${cumplePromo.aplicaTipoCliente})`);
                    }
                }
            }
        } catch (bdayError) {
            console.error(`[${tenantId}] Error en cumpleanos:`, bdayError.message);
        }

        // ── Difusion de promociones del dia ──
        try {
            await sendPromoBroadcasts(tenant, tenantId);
        } catch (promoError) {
            console.error(`[${tenantId}] Error en difusion promos:`, promoError.message);
        }
    } catch (error) {
        console.error(`[${tenantId}] Error en sincronizacion:`, error.message);
    }
}

/**
 * Envia mensaje proactivo de cumpleanos via WhatsApp.
 * @param {number} sendIndex - Indice del envio (0 = primero, N-1 = ultimo)
 * @param {number} totalSends - Total de envios configurados
 */
async function sendBirthdayMessage(tenant, cliente, timing, cumplePromo, sendIndex, totalSends) {
    if (!evolutionClient) return;
    const config = tenant.config;
    const descuento = cumplePromo.valorDescuento || 20;

    // ── Calcular horario disponible del dia de cumpleanos ──
    const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const targetDate = new Date(now);
    if (timing === 'manana') targetDate.setDate(targetDate.getDate() + 1);
    const diaNombre = DIAS_SEMANA[targetDate.getDay()];

    const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const jornadas = (tenant.disponibilidadCatalog || []).filter(d =>
        d.tipo === 'Jornada' && normalize(d.fechaDia) === normalize(diaNombre)
    );
    const horarioTexto = jornadas.length > 0 ? `${jornadas[0].horaIni} a ${jornadas[0].horaFin}` : '';
    const horarioInfo = horarioTexto ? ` Estamos disponibles de ${horarioTexto}.` : '';
    const diaLabel = timing === 'manana' ? 'manana ' + diaNombre : 'hoy ' + diaNombre;

    let mensaje = '';
    const negocio = config.businessName || 'nuestro negocio';
    const plantilla = (cumplePromo.descripcion || '').trim();

    // Si DESCRIPCION tiene texto, se usa como plantilla con variables {nombre}, {negocio}, {descuento}, {horario}, {dia}
    // Si DESCRIPCION esta vacia, se usan mensajes predeterminados con emojis
    if (plantilla) {
        mensaje = plantilla
            .replace(/\{nombre\}/gi, cliente.nombre)
            .replace(/\{negocio\}/gi, negocio)
            .replace(/\{descuento\}/gi, descuento + '%')
            .replace(/\{horario\}/gi, horarioTexto || 'nuestro horario habitual')
            .replace(/\{dia\}/gi, diaLabel);
    } else if (timing === 'manana') {
        mensaje = `🎂✨ ¡Hola *${cliente.nombre}*! ✨🎂\n\n¡Mañana es tu día especial! 🎉 En *${negocio}* queremos celebrar tu cumpleaños contigo y hacerte sentir increíble.\n\n🎁 Te tenemos preparado un regalo exclusivo: *${descuento}% de descuento* en el servicio que tú elijas.\n\n📌 *¿Cómo funciona?*\n1️⃣ Escríbenos *mañana* (el día de tu cumpleaños) para agendar tu cita\n2️⃣ Elige el servicio que más te guste\n3️⃣ El descuento del *${descuento}%* se aplica automáticamente al valor total de tu servicio\n\n⚠️ *Importante:* Esta promoción es válida *únicamente el día de tu cumpleaños*. ¡Agenda tu cita mañana para que no se te pase!${horarioInfo}\n\n👇 *Escribe "Quiero agendar" mañana y nosotros nos encargamos de todo.* ¡Te esperamos con los brazos abiertos! 💖🌸`;
    } else {
        const isFirst = sendIndex === 0;
        const isLast = sendIndex === totalSends - 1 && totalSends > 1;

        if (isFirst) {
            mensaje = `🎉🎂🥳 ¡¡FELIZ CUMPLEAÑOS *${cliente.nombre}*!! 🥳🎂🎉\n\n¡Hoy es tu gran día! 🌟 Todo el equipo de *${negocio}* te desea lo mejor y quiere celebrarlo contigo.\n\n🎁 *Tu regalo de cumpleaños:* ${descuento}% de descuento en el servicio que prefieras.\n\n📌 *¿Cómo usar tu descuento?*\n1️⃣ Escríbenos *hoy* y dinos qué servicio te gustaría\n2️⃣ Te ayudamos a agendar tu cita para hoy\n3️⃣ El *${descuento}%* se descuenta automáticamente del valor total de tu servicio\n\n⚠️ *Recuerda:* Este regalo es *exclusivo para hoy*, día de tu cumpleaños. Mañana ya no estará disponible.${horarioInfo}\n\n👇 *¡Responde ahora con el servicio que quieres y te agendamos al instante!* 📲💖\n_Ejemplo: "Quiero un tinte" o "Quiero diseño de cejas"_ ✨`;
        } else if (isLast) {
            mensaje = `⏰🎂 ¡*${cliente.nombre}*, última oportunidad! 🎂⏰\n\n¡Tu regalo de cumpleaños vence *hoy a medianoche*! 🕛\n\n🎁 Aún tienes tu *${descuento}% de descuento* exclusivo en *${negocio}*.\n\n📌 Solo escríbenos, elige tu servicio favorito y el descuento se aplica automáticamente al valor total.\n\n🚨 *¡Escríbenos YA antes de que termine el día!* Solo responde con el servicio que deseas y nosotros hacemos el resto. 📲\n_¡No dejes ir este regalo, ${cliente.nombre.split(' ')[0]}!_ 💖✨`;
        } else {
            mensaje = `✨🎂 ¡Hola *${cliente.nombre}*! 🎂✨\n\nRecuerda que *hoy* por tu cumpleaños tienes un *${descuento}% de descuento* exclusivo en *${negocio}*.${horarioInfo}\n\n📌 Solo escríbenos, elige el servicio que quieras y el descuento se aplica directo al precio. ¡Es automático!\n\n👇 *Responde con el servicio que te gustaría y te agendamos en minutos.* ⚡\n⚠️ Válido *solo hoy*. ¡Aprovéchalo! 📲💖`;
        }
    }

    try {
        await evolutionClient.sendText(tenant.instanceName, cliente.celular, mensaje);
        console.log(`[${tenant.instanceName}] Cumpleanos ${timing}[${sendIndex+1}/${totalSends}]: enviado a ${cliente.nombre} (${cliente.celular}) [tipo: ${cliente.tipo}]`);

        // Enviar media visual de la promo si tiene configurada
        if (cumplePromo.tipoMediaPromo && cumplePromo.urlMediaPromo) {
            try {
                const directUrl = convertDriveUrl(cumplePromo.urlMediaPromo);
                const mediaType = cumplePromo.tipoMediaPromo === 'imagen' ? 'image' : cumplePromo.tipoMediaPromo === 'video' ? 'video' : 'document';
                const fileName = cumplePromo.tipoMediaPromo === 'documento' ? (cumplePromo.nombre.replace(/[^a-zA-Z0-9 ]/g, '') + '.pdf') : '';
                await new Promise(r => setTimeout(r, 1000));
                await evolutionClient.sendMedia(tenant.instanceName, cliente.celular, mediaType, directUrl, '', fileName);
                console.log(`[${tenant.instanceName}] Cumpleanos media enviada a ${cliente.nombre}`);
            } catch (mediaErr) {
                console.error(`[${tenant.instanceName}] Error enviando media cumpleanos a ${cliente.celular}:`, mediaErr.message);
            }
        }
    } catch (err) {
        console.error(`[${tenant.instanceName}] Error enviando cumpleanos a ${cliente.celular}:`, err.message);
    }
}

/**
 * Envia difusion de promociones activas a clientes registrados.
 * Solo envia durante los primeros 30 min despues del inicio de la jornada.
 * Controles anti-bloqueo: delay 3-5s, max 30 msgs/promo, mensajes personalizados.
 */
async function sendPromoBroadcasts(tenant, tenantId) {
    if (!evolutionClient) return;
    if (tenant.config.broadcastEnabled === false) return;

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
    const todayName = DIAS_SEMANA[now.getDay()];
    const normalize = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Buscar jornada de hoy para obtener hora de apertura
    const jornadas = (tenant.disponibilidadCatalog || []).filter(d =>
        d.tipo === 'Jornada' && normalize(d.fechaDia) === normalize(todayName)
    );
    if (jornadas.length === 0) return; // Negocio cerrado hoy

    const jornadaStart = jornadas[0].horaIni || '08:00';
    const [startH, startM] = jornadaStart.split(':').map(Number);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startH * 60 + (startM || 0);

    // Solo enviar durante los primeros 30 min de la jornada
    if (nowMinutes < startMinutes || nowMinutes > startMinutes + 30) return;

    // Reset tracking si cambio el dia
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const todayKey = `${dd}/${mm}/${now.getFullYear()}`;

    if (!tenant.promoBroadcastsSent || tenant.promoBroadcastsSent._date !== todayKey) {
        tenant.promoBroadcastsSent = { _date: todayKey };
    }

    // Filtrar promos activas de hoy (no CUMPLEANOS, coincida APLICA_DIA)
    const todayPromos = (tenant.promotionsCatalog || []).filter(p => {
        if (p.estado !== 'ACTIVO' || p.tipoPromo === 'CUMPLEANOS') return false;
        if (!p.aplicaDia || p.aplicaDia.trim() === '') return false;
        const dias = p.aplicaDia.split(',').map(d => d.trim());
        if (!dias.some(d => normalize(d) === normalize(todayName))) return false;
        // Verificar vencimiento
        if (p.vence) {
            const parts = p.vence.split('/');
            if (parts.length === 3) {
                const venceDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), 23, 59, 59);
                if (venceDate < now) return false;
            }
        }
        return true;
    });

    if (todayPromos.length === 0) return;

    const maxPerPromo = tenant.config.broadcastMaxPerPromo || 30;
    const negocio = tenant.config.businessName || 'nuestro negocio';
    let totalEnviados = 0;

    for (const promo of todayPromos) {
        const trackingKey = `${todayKey}:${promo.nombre}`;

        if (!tenant.promoBroadcastsSent[trackingKey]) {
            tenant.promoBroadcastsSent[trackingKey] = {};
        }
        const sentMap = tenant.promoBroadcastsSent[trackingKey];

        // Filtrar clientes elegibles
        const allowedTypes = (!promo.aplicaTipoCliente || promo.aplicaTipoCliente === 'TODOS')
            ? null
            : promo.aplicaTipoCliente.split(',').map(t => t.trim().toLowerCase());

        const eligibleClients = Object.entries(tenant.registeredClients || {}).filter(([celular, client]) => {
            if (sentMap[celular]) return false;
            if (!client.nombre || client.nombre.trim() === '') return false;
            if (allowedTypes && !allowedTypes.includes((client.tipo || 'Nuevo').toLowerCase())) return false;
            return true;
        });

        const remaining = maxPerPromo - Object.keys(sentMap).length;
        if (remaining <= 0) continue;

        const batch = eligibleClients.slice(0, remaining);

        for (const [celular, client] of batch) {
            try {
                // Construir mensaje personalizado
                let descuentoLabel = '';
                if (promo.tipoPromo === 'PORCENTAJE') descuentoLabel = `${promo.valorDescuento}% de descuento`;
                else if (promo.tipoPromo === '2X1') descuentoLabel = '2x1';
                else if (promo.tipoPromo === 'VALOR_FIJO') descuentoLabel = `$${(promo.valorDescuento || 0).toLocaleString('es-CO')} de descuento`;

                const mensaje = `Hola *${client.nombre}*! Hoy es *${promo.nombre}* en *${negocio}*. ${promo.descripcion || ''}${descuentoLabel ? ' (' + descuentoLabel + ')' : ''}. Escribenos para agendar tu cita!`;

                await evolutionClient.sendText(tenant.instanceName, celular, mensaje);
                sentMap[celular] = true;
                totalEnviados++;

                // Enviar media si tiene
                if (promo.tipoMediaPromo && promo.urlMediaPromo) {
                    try {
                        const directUrl = convertDriveUrl(promo.urlMediaPromo);
                        const mediaType = promo.tipoMediaPromo === 'imagen' ? 'image'
                            : promo.tipoMediaPromo === 'video' ? 'video' : 'document';
                        const fileName = promo.tipoMediaPromo === 'documento'
                            ? (promo.nombre.replace(/[^a-zA-Z0-9 ]/g, '') + '.pdf') : '';
                        await new Promise(r => setTimeout(r, 1000));
                        await evolutionClient.sendMedia(tenant.instanceName, celular, mediaType, directUrl, '', fileName);
                    } catch (mediaErr) {
                        console.error(`[${tenantId}] Difusion media error (${celular}):`, mediaErr.message);
                    }
                }

                // Anti-bloqueo: delay aleatorio 3-5 segundos
                const delay = 3000 + Math.floor(Math.random() * 2000);
                await new Promise(r => setTimeout(r, delay));
            } catch (sendErr) {
                console.error(`[${tenantId}] Difusion error enviando a ${celular}:`, sendErr.message);
            }
        }
    }

    if (totalEnviados > 0) {
        console.log(`[${tenantId}] Difusion promos: ${totalEnviados} mensaje(s) enviado(s)`);
    }
}

/**
 * Inicializa todos los tenants definidos en tenants.json
 * @returns {Array<string>} Lista de IDs de tenants activos
 */
async function initAllTenants() {
    const definitions = loadTenantDefinitions();
    const results = [];

    for (const [tenantId, tenantDef] of Object.entries(definitions)) {
        try {
            const tenant = await initTenant(tenantId, tenantDef);
            if (tenant) results.push(tenantId);
        } catch (error) {
            console.error(`[${tenantId}] Error fatal inicializando tenant:`, error.message);
        }
    }

    console.log(`\n=== ${results.length} tenant(s) inicializado(s) exitosamente ===\n`);
    return results;
}

/**
 * Obtiene un tenant por nombre de instancia
 * @param {string} instanceName Nombre de la instancia de Evolution API
 * @returns {Object|null} Datos del tenant o null si no existe
 */
function getTenant(instanceName) {
    return tenantStore[instanceName] || null;
}

/**
 * Retorna los IDs de todos los tenants activos
 */
function getActiveTenantIds() {
    return Object.keys(tenantStore);
}

/**
 * Limpia intervalos y recursos de todos los tenants (para shutdown)
 */
function shutdownAllTenants() {
    for (const [id, tenant] of Object.entries(tenantStore)) {
        if (tenant.syncInterval) {
            clearInterval(tenant.syncInterval);
        }
        console.log(`[${id}] Tenant detenido.`);
    }
}

module.exports = { initAllTenants, getTenant, getActiveTenantIds, syncTenantData, shutdownAllTenants, setEvolutionClient };
