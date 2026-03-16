const fs = require('fs');
const path = require('path');
const { loadClientConfig, loadServicesConfig, loadKnowledgeConfig,
        loadRegisteredClients, loadPendingAppointments, loadPromotions, loadDisponibilidad, loadColaboradores, loadExpiredAppointments } = require('./sheets');
const api = require('./api');
const { isValidLicense } = require('../utils/license');

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

// Almacén en memoria de todos los tenants activos
const tenantStore = {};

// Referencia al cliente de Evolution API (inyectado desde app.js)
let evolutionClient = null;

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
    const [servicesCatalog, knowledgeCatalog, registeredClients, pendingAppointments, promotionsCatalog, disponibilidadCatalog, colaboradoresCatalog] =
        await Promise.all([
            loadServicesConfig(sheetId),
            loadKnowledgeConfig(sheetId),
            loadRegisteredClients(sheetId),
            loadPendingAppointments(sheetId),
            loadPromotions(sheetId),
            loadDisponibilidad(sheetId),
            loadColaboradores(sheetId)
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
        userSessions: {},
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
    console.log(`[${tenantId}] Listo. Licencia: ACTIVA | Negocio: ${config.businessName} | CRM: ${Object.keys(registeredClients).length} clientes | Citas pendientes: ${Object.keys(pendingAppointments).length} cliente(s) | Promos activas: ${promosActivas} | Jornadas: ${jornadasConfig} dias | Bloqueos: ${bloqueosConfig} | Colaboradores: ${colaboradoresCatalog.length}`);
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

        const [config, servicesCatalog, knowledgeCatalog, registeredClients, pendingAppointments, promotionsCatalog, disponibilidadCatalog, colaboradoresCatalog] =
            await Promise.all([
                loadClientConfig(sheetId),
                loadServicesConfig(sheetId),
                loadKnowledgeConfig(sheetId),
                loadRegisteredClients(sheetId),
                loadPendingAppointments(sheetId),
                loadPromotions(sheetId),
                loadDisponibilidad(sheetId),
                loadColaboradores(sheetId)
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

                    api.webhookUrl = tenant.webhookGasUrl;
                    const bday = await api.getBirthdayClients(`${dd}/${mm}`, `${dd2}/${mm2}`);

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
    const plantilla = (cumplePromo.descripcion || '').trim();

    if (timing === 'manana') {
        if (plantilla) {
            mensaje = plantilla
                .replace(/\{nombre\}/gi, cliente.nombre)
                .replace(/\{negocio\}/gi, config.businessName || '')
                .replace(/\{descuento\}/gi, descuento + '%')
                .replace(/\{horario\}/gi, horarioTexto || 'nuestro horario habitual')
                .replace(/\{dia\}/gi, diaLabel);
            if (!plantilla.toLowerCase().includes('mañana') && !plantilla.toLowerCase().includes('manana')) {
                mensaje = `🎂 ¡Hola *${cliente.nombre}*! Mañana va a ser un día muy especial para ti.\n\n` + mensaje;
            }
        } else {
            mensaje = `🎂 ¡Hola *${cliente.nombre}*!\n\nMañana va a ser un día muy especial para ti y en *${config.businessName}* queremos celebrarlo contigo 🎉\n\nTe tenemos preparado un regalo: *${descuento}% de descuento* en el servicio que desees.${horarioInfo}\n\n💬 Responde a este mensaje para agendar tu cita de cumpleaños. ¡Te esperamos!`;
        }
    } else {
        const isFirst = sendIndex === 0;
        const isLast = sendIndex === totalSends - 1 && totalSends > 1;

        if (isFirst) {
            if (plantilla) {
                mensaje = plantilla
                    .replace(/\{nombre\}/gi, cliente.nombre)
                    .replace(/\{negocio\}/gi, config.businessName || '')
                    .replace(/\{descuento\}/gi, descuento + '%')
                    .replace(/\{horario\}/gi, horarioTexto || 'nuestro horario habitual')
                    .replace(/\{dia\}/gi, diaLabel);
            } else {
                mensaje = `🎉🎂 ¡Feliz cumpleaños *${cliente.nombre}*! 🎂🎉\n\nEn *${config.businessName}* queremos que este día sea aún más especial. Te regalamos un *${descuento}% de descuento* en el servicio que prefieras.${horarioInfo}\n\n🎁 Este regalo es solo por hoy. ¡Escríbenos ahora para agendar tu cita de cumpleaños!`;
            }
        } else if (isLast) {
            mensaje = `⏰ ¡*${cliente.nombre}*, última oportunidad!\n\nTu regalo de cumpleaños de *${descuento}% de descuento* en *${config.businessName}* vence hoy a medianoche 🎁\n\nNo dejes pasar esta oportunidad, ¡responde ahora para agendar tu cita! 💬`;
        } else {
            mensaje = `✨ ¡Hola *${cliente.nombre}*! Recuerda que hoy por tu cumpleaños tienes un *${descuento}% de descuento* en *${config.businessName}* 🎂${horarioInfo}\n\n¡Agenda tu cita ahora, solo es válido hoy! 💬 Responde para agendar.`;
        }
    }

    try {
        await evolutionClient.sendText(tenant.instanceName, cliente.celular, mensaje);
        console.log(`[${tenant.instanceName}] Cumpleanos ${timing}[${sendIndex+1}/${totalSends}]: enviado a ${cliente.nombre} (${cliente.celular}) [tipo: ${cliente.tipo}]`);
    } catch (err) {
        console.error(`[${tenant.instanceName}] Error enviando cumpleanos a ${cliente.celular}:`, err.message);
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
