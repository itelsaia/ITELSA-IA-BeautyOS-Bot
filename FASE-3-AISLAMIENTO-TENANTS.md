# FASE 3 — Aislamiento de Tenants

> **Estado**: En implementación gradual
> **Versión estable previa**: `stable-pre-fase3` (commit `ece932b`)
> **Fecha inicio**: 2026-04-11

---

## 🎯 Objetivo

Refactorizar `agent-bot/src/services/tenants.js` (~1000 líneas) para que cada tenant sea una instancia aislada. Si un tenant falla, los demás siguen funcionando normalmente.

**Problema que resuelve:** Hoy un bug en el sync de Sofi puede afectar el sync de DEMO. Los logs están mezclados. Difícil saber cuál tenant está sano.

---

## 🛡️ Punto de retorno seguro

### Versión estable
- **Tag Git**: `stable-pre-fase3`
- **Commit hash**: `ece932b`
- **Descripción**: Estado funcional con FASE 1 (healthcheck) + FASE 2 (cola de reintentos) ya implementadas.

### Cómo volver a la versión estable (rollback completo)

**Opción A — Rollback en local + servidor:**
```bash
# En local
cd "c:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA"
git reset --hard stable-pre-fase3
git push --force origin main

# En servidor
cd ~/beautyos
git fetch --all --tags
git reset --hard stable-pre-fase3
cd agent-bot && pm2 restart beautyos-bot
```

**Opción B — Revertir solo el último commit (más seguro):**
```bash
# En local
git revert HEAD --no-edit
git push

# En servidor
cd ~/beautyos && git pull && cd agent-bot && pm2 restart beautyos-bot
```

**Opción C — Rollback granular (revertir 1 sub-fase):**
```bash
# Ver últimos 10 commits
git log --oneline -10

# Identificar el commit que rompió
git revert <hash> --no-edit
git push
```

---

## 📐 Arquitectura objetivo

### Antes
```
agent-bot/src/
└── services/
    └── tenants.js          ← 1000 líneas, todo mezclado
```

### Después
```
agent-bot/src/
├── tenants/                          ← CARPETA NUEVA
│   ├── base-tenant.js                ← Clase base con métodos comunes
│   ├── salon-tenant.js               ← Lógica específica salones (DEMO)
│   ├── comercial-tenant.js           ← Lógica específica Sofi (BeautyOS)
│   └── tenant-manager.js             ← Carga y orquesta tenants desde tenants.json
└── services/
    └── tenants.js                    ← Wrapper de compatibilidad (delega al manager)
```

---

## 🧱 Principios de diseño

### 1. Aislamiento por instancia
Cada tenant es una clase con su propio estado:
- `config`, `userSessions`, `clientesCRM`
- Su propio scheduler de sync
- Su propio handler de errores
- Logger etiquetado con `[tenant-id]`

### 2. Sin compartir memoria entre tenants
Si DEMO falla cargando colaboradores, NO afecta los planes de Sofi.

### 3. Compatibilidad hacia atrás
El archivo viejo `services/tenants.js` se vuelve un **wrapper** que delega al nuevo manager. Los archivos `webhook.js`, `app.js`, `openai.js` **no se tocan**.

### 4. Migración gradual (no big-bang)
6 sub-fases, cada una es un commit independiente. Si una falla, revertir es trivial.

### 5. Try/catch por operación
Cada sync tiene su propio try/catch. Si falla `loadPlanes()`, sigue con `loadFAQ()`.

---

## 📋 Plan de sub-fases

| Sub-fase | Archivo | Acción | Riesgo | Commit |
|---|---|---|---|---|
| **3.1** | `base-tenant.js` | Crear clase base | 🟢 Cero | ✅ Implementado |
| **3.2** | `comercial-tenant.js` | Crear clase Sofi | 🟡 Medio | ✅ Implementado |
| **3.3** | `salon-tenant.js` | Crear clase salones | 🟡 Medio | Por hacer |
| **3.4** | `tenant-manager.js` | Crear orquestador | 🟢 Bajo | Por hacer |
| **3.5** | `services/tenants.js` | Migrar a wrapper | 🔴 Alto | Por hacer |
| **3.6** | — | Validación final | N/A | Por hacer |

---

## 🔒 Archivos que NO se tocan

Estos archivos siguen funcionando exactamente igual. La interfaz pública NO cambia:

- ✅ `agent-bot/src/routes/webhook.js`
- ✅ `agent-bot/src/services/openai.js`
- ✅ `agent-bot/src/services/evolution.js`
- ✅ `agent-bot/src/services/api.js`
- ✅ `agent-bot/src/services/session.js`
- ✅ `agent-bot/src/services/sheets.js`
- ✅ `agent-bot/src/services/healthcheck.js` (FASE 1)
- ✅ `agent-bot/src/services/retry-queue.js` (FASE 2)
- ✅ `agent-bot/src/app.js`
- ✅ `agent-bot/tenants.json`

---

## ✅ Validación después de cada sub-fase

Después de cada commit, ejecutar en el servidor:

```bash
# 1. Pull
cd ~/beautyos && git pull

# 2. Restart
cd agent-bot && pm2 restart beautyos-bot

# 3. Verificar logs (debe arrancar sin errores)
pm2 logs beautyos-bot --lines 30 --nostream

# 4. Verificar healthcheck básico
curl http://localhost:3000/health

# 5. Verificar tenants activos
# Debe mostrar: tenants: ["demo-beautyos", "beautyos-comercial"]

# 6. Verificar healthcheck completo
curl http://localhost:3000/health/full | python3 -m json.tool

# 7. Test funcional: enviar "Hola" a Sofi por WhatsApp
# 8. Test funcional: enviar "Hola" a DEMO por WhatsApp
```

### Checklist por sub-fase

Marcar ✅ cuando se valide:

**Sub-fase 3.1 (BaseTenant):**
- [ ] Bot arranca sin errores
- [ ] Logs muestran ambos tenants inicializados
- [ ] Sofi responde "Hola"
- [ ] DEMO responde "Hola"
- [ ] `/health/full` muestra ambos tenants healthy

**Sub-fase 3.2 (ComercialTenant):**
- [ ] Bot arranca sin errores
- [ ] Sofi sincroniza planes y FAQ correctamente
- [ ] Sofi responde y captura un lead de prueba
- [ ] DEMO no se ve afectada

**Sub-fase 3.3 (SalonTenant):**
- [ ] Bot arranca sin errores
- [ ] DEMO sincroniza servicios y colaboradores
- [ ] DEMO responde y agenda una cita de prueba
- [ ] Sofi no se ve afectada

**Sub-fase 3.4 (TenantManager):**
- [ ] Bot arranca usando el manager
- [ ] Ambos tenants se cargan desde tenants.json
- [ ] Si un tenant falla al inicializar, los demás cargan

**Sub-fase 3.5 (Wrapper de compatibilidad):**
- [ ] Bot arranca usando el wrapper que delega al manager
- [ ] Webhook, openai, app.js siguen funcionando sin cambios
- [ ] Sofi captura leads y los guarda en GAS
- [ ] DEMO agenda citas correctamente

**Sub-fase 3.6 (Validación final):**
- [ ] Test completo de captura de lead end-to-end
- [ ] Test completo de agendamiento DEMO end-to-end
- [ ] Verificar logs etiquetados por tenant
- [ ] Verificar /health/full muestra estado correcto
- [ ] Healthcheck no envía falsos positivos
- [ ] Cola de reintentos sigue funcionando
- [ ] Documentar versión estable nueva con tag `stable-post-fase3`

---

## 🚨 Plan de contingencia

### Si el bot no arranca después de un commit
```bash
# En el servidor
cd ~/beautyos && git log --oneline -5
# Identificar el commit que rompió
git revert HEAD --no-edit
git push
pm2 restart beautyos-bot
# Avisar al equipo y diagnosticar antes de seguir
```

### Si un tenant no carga
```bash
# Verificar logs específicos del tenant
pm2 logs beautyos-bot --lines 100 --nostream | grep "beautyos-comercial"
# o
pm2 logs beautyos-bot --lines 100 --nostream | grep "demo-beautyos"
```

### Si Sofi no responde mensajes
```bash
# 1. Verificar WhatsApp conectado
curl http://localhost:3000/health/full | python3 -m json.tool

# 2. Verificar logs del webhook
pm2 logs beautyos-bot --lines 30 --nostream | grep "webhook\|openai"

# 3. Si está roto por culpa de FASE 3, rollback inmediato
cd ~/beautyos && git fetch --all --tags && git reset --hard stable-pre-fase3
cd agent-bot && pm2 restart beautyos-bot
```

### Si todo está roto y no sé qué pasó
```bash
# Rollback nuclear al estado pre-FASE 3
cd ~/beautyos && git fetch --all --tags && git reset --hard stable-pre-fase3
cd agent-bot && pm2 restart beautyos-bot
# Esto te devuelve al estado del 2026-04-11 antes de empezar FASE 3
```

---

## 📊 Beneficios esperados

| Antes | Después |
|---|---|
| Bug en sync de Sofi tumba sync de DEMO | Sofi falla aislada, DEMO sigue funcionando |
| Logs mezclados de todos los tenants | Logs etiquetados `[beautyos-comercial]` `[demo-beautyos]` |
| `pm2 restart` reinicia todo | Puedes reiniciar lógica por tenant (futuro) |
| Cargar nuevo tenant requiere modificar tenants.js | Solo agregas en tenants.json |
| Difícil saber cuál tenant está sano | `tenant.isHealthy()` por tenant |
| 1 archivo de 1000 líneas | 4 archivos pequeños y enfocados |

---

## 📝 Bitácora de cambios

| Fecha | Sub-fase | Commit | Estado | Notas |
|---|---|---|---|---|
| 2026-04-11 | Documentación inicial | b6e8798 | ✅ | Tag stable-pre-fase3 creado |
| 2026-04-11 | 3.1 BaseTenant | 9b4d7d5 | ✅ | Clase base creada, no afecta nada existente |
| 2026-04-11 | 3.2 ComercialTenant | (este commit) | ✅ | Clase Sofi creada, NO se usa todavia (sigue tenants.js viejo) |
| | 3.3 SalonTenant | | ⏳ | |
| | 3.4 TenantManager | | ⏳ | |
| | 3.5 Wrapper | | ⏳ | |
| | 3.6 Validación final | | ⏳ | |

---

## 🔍 Cómo entender la nueva estructura (para futuro)

### Para agregar un nuevo tipo de tenant

1. Crear nuevo archivo en `agent-bot/src/tenants/mi-tenant.js`
2. Heredar de `BaseTenant`
3. Implementar `init()` y `sync()`
4. Registrarlo en `tenant-manager.js` mapeando a su `type`
5. Agregar al `tenants.json` con el nuevo `type`

### Para agregar un nuevo cliente comercial

1. En `tenants.json` agregar:
```json
"nuevo-cliente": {
  "displayName": "Nombre Cliente",
  "sheetId": "...",
  "webhookGasUrl": "...",
  "instanceName": "nuevo-cliente",
  "type": "comercial",
  "enabled": true
}
```
2. Reiniciar bot — se carga automáticamente

### Para deshabilitar un tenant temporalmente

1. En `tenants.json`, cambiar `"enabled": true` a `"enabled": false`
2. Reiniciar bot — el tenant se omite

### Para depurar un tenant específico

```bash
# Ver solo logs del tenant
pm2 logs beautyos-bot --lines 100 --nostream | grep "beautyos-comercial"

# Forzar sync manual del tenant (futuro endpoint)
curl -X POST http://localhost:3000/tenant/beautyos-comercial/sync
```

---

## 🎓 Glosario

- **Tenant**: Cada cliente del bot. Ej: `demo-beautyos` (salón) o `beautyos-comercial` (Sofi).
- **BaseTenant**: Clase abstracta que define la estructura común de todos los tenants.
- **TenantManager**: Orquestador que carga, inicializa y administra todos los tenants.
- **Wrapper**: El archivo `services/tenants.js` se mantiene como capa de compatibilidad.
- **Sub-fase**: Cada uno de los 6 pasos atómicos de la migración.
- **Rollback**: Volver a una versión anterior del código (`git reset --hard stable-pre-fase3`).

---

## 📞 En caso de emergencia

Si después de un cambio el bot deja de funcionar y no hay tiempo de diagnosticar:

```bash
# ROLLBACK COMPLETO A VERSIÓN PRE-FASE 3
cd ~/beautyos
git fetch --all --tags
git reset --hard stable-pre-fase3
cd agent-bot && pm2 restart beautyos-bot

# Verificar
pm2 logs beautyos-bot --lines 20 --nostream
```

Esto restaura el bot al estado del **11 de abril de 2026** con FASE 1 + FASE 2 funcionando.