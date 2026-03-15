# BeautyOS - Guia de Servidores

## Servicios Necesarios (en orden de inicio)

| # | Servicio | Puerto | Que hace |
|---|----------|--------|----------|
| 1 | PostgreSQL | 5432 | Base de datos de Evolution API |
| 2 | Evolution API | 8080 | Servidor WhatsApp (recibe/envia mensajes via Baileys) |
| 3 | ngrok | 4040 | Tunel publico para webhooks de WhatsApp |
| 4 | Bot BeautyOS | 3000 | Bot IA multi-tenant (procesa mensajes con OpenAI) |

---

## Mac Boot Camp (SIN Docker)

Necesitas **4 ventanas de CMD** abiertas simultaneamente.

### Ventana 1 - PostgreSQL
Se inicia automaticamente como servicio de Windows. Para verificar:
```
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "SELECT 1"
```

### Ventana 2 - Evolution API
```
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\evolution-api" && npx tsx ./src/main.ts
```
Esperar hasta ver: `HTTP - ON: 8080`

### Ventana 3 - ngrok
```
C:\Users\Critian\Documents\ngrok.exe http 3000
```
Copiar la URL publica (ej: `https://xxxx.ngrok-free.app`)

**IMPORTANTE**: Cada vez que reinicias ngrok la URL cambia. Debes:
1. Abrir el archivo: `C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\evolution-api\.env`
2. Cambiar `WEBHOOK_GLOBAL_URL` con la nueva URL + `/webhook/evolution`
3. Reiniciar Evolution API (Ctrl+C y ejecutar de nuevo)

### Ventana 4 - Bot BeautyOS
```
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\agent-bot" && npm start
```

### Para apagar todo
- Ctrl+C en cada ventana (Bot, ngrok, Evolution API)
- PostgreSQL sigue corriendo como servicio (no necesitas apagarlo)

---

## PC Windows (CON Docker)

### Ventana 1 - Docker (PostgreSQL + Redis + Evolution API)
```
cd "RUTA_DEL_PROYECTO\APP_WEB_PELUQUERIAS_SPA" && docker compose up -d
```
Esto levanta PostgreSQL + Redis + Evolution API en un solo comando.

### Ventana 2 - ngrok
```
ngrok http 3000
```
Actualizar `WEBHOOK_GLOBAL_URL` en `evolution-api.env` (version Docker) y reiniciar:
```
docker compose restart evolution-api
```

### Ventana 3 - Bot BeautyOS
```
cd "RUTA_DEL_PROYECTO\APP_WEB_PELUQUERIAS_SPA\agent-bot" && npm start
```

### Para apagar todo
- Ctrl+C en Bot y ngrok
- `docker compose down` para apagar los contenedores

---

## Configuracion inicial del PC Windows (Docker)

1. Instalar **Docker Desktop** (https://www.docker.com/products/docker-desktop)
2. Instalar **Node.js** v18+ (https://nodejs.org)
3. Instalar **ngrok** (https://ngrok.com/download) y configurar authtoken
4. Clonar el repo: `git clone TU_REPO_URL`
5. Crear `.env` en la raiz del proyecto (copiar del otro PC)
6. Copiar `credenciales-google.json` (NO se sube a git por seguridad)
7. `docker compose up -d` (levanta infraestructura)
8. `cd agent-bot && npm install && npm start`

---

## Mantener el proyecto alineado entre PCs

### Flujo Git
```
Antes de trabajar:  git pull
Despues de cambios: git add . && git commit -m "descripcion" && git push
Al cambiar de PC:   git pull
```

### Que es igual en ambos PCs (se sincroniza con git)
- `agent-bot/` - Todo el codigo del bot
- `tenants.json` - Configuracion de clientes
- `crm-webapp/` - Google Apps Script
- `.env` del proyecto (PORT, EVOLUTION_API_URL, EVOLUTION_API_KEY)

### Que es diferente por PC (NO se sube a git)
- `evolution-api/` en el Mac (instalacion local, esta fuera del repo)
- `docker-compose.yml` se usa en el PC Windows, no en el Mac
- La URL de ngrok (cambia cada reinicio)
- `credenciales-google.json` (debe copiarse manualmente)

---

## Evolution API Manager (interfaz visual)

- URL: http://localhost:8080/manager
- API Key: `beautyos-global-api-key-change-me`
- Aqui puedes ver instancias conectadas, escanear QR, ver contactos/mensajes

---

## Troubleshooting

### El bot no recibe mensajes
1. Verificar que ngrok esta corriendo (`ngrok http 3000`)
2. Verificar que la URL de ngrok esta actualizada en el `.env` de Evolution API
3. Verificar que Evolution API fue reiniciada despues de cambiar la URL
4. Verificar que el bot esta corriendo en puerto 3000

### Evolution API no arranca (EADDRINUSE)
El puerto 8080 ya esta ocupado. Buscar y cerrar el proceso:
```
netstat -ano | findstr :8080
taskkill /PID NUMERO_PID /F
```

### WhatsApp desconectado
1. Ir a http://localhost:8080/manager
2. Click en la instancia
3. Click "Consigue un codigo QR"
4. Escanear con WhatsApp del celular

### Error de credenciales Google Sheets
Verificar que `credenciales-google.json` existe en la raiz del proyecto y tiene los permisos correctos.

### GAS retorna HTML en vez de JSON (Error critico)
Si en los logs del bot aparece:
```
⚠️ GAS retornó texto en vez de JSON: <!DOCTYPE html>...<title>Error</title>
```
Significa que el deployment del CRM Web App esta desactualizado. `clasp push` sube el codigo pero **NO actualiza el deployment**.

**Solucion:** Ejecutar este comando despues de cada `clasp push`:
```
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\crm-webapp"
npx clasp deploy -i AKfycbxTfm6MBwaqYOU27QQ2RaO5uy_JzRjywMZN-q9ZnfdotaJCqNSjYN57mB28zImVmZHT -d "descripcion del cambio"
```
Esto actualiza el deployment existente (misma URL) con la version mas reciente del codigo.

---

## Despliegue de Google Apps Script (CRM Web App)

### Concepto clave
Google Apps Script tiene DOS pasos separados:
1. **`clasp push`** = Sube el codigo fuente al proyecto GAS (como un `git push`)
2. **`clasp deploy`** = Publica una nueva version del Web App (como hacer un "release")

**Si solo haces `clasp push` sin `clasp deploy`, el Web App sigue ejecutando la version vieja.**

### Comandos de despliegue

**Subir codigo + actualizar deployment (hacer SIEMPRE los dos juntos):**
```bash
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\crm-webapp"
npx clasp push --force
npx clasp deploy -i AKfycbxTfm6MBwaqYOU27QQ2RaO5uy_JzRjywMZN-q9ZnfdotaJCqNSjYN57mB28zImVmZHT -d "descripcion"
```

**Ver deployments actuales:**
```bash
npx clasp deployments
```

**Ver versiones:**
```bash
npx clasp versions
```

### Datos del deployment actual
| Campo | Valor |
|-------|-------|
| Deployment ID | `AKfycbxTfm6MBwaqYOU27QQ2RaO5uy_JzRjywMZN-q9ZnfdotaJCqNSjYN57mB28zImVmZHT` |
| URL Web App | `https://script.google.com/macros/s/AKfycbxTfm6MBwaqYOU27QQ2RaO5uy_JzRjywMZN-q9ZnfdotaJCqNSjYN57mB28zImVmZHT/exec` |
| Script ID | `1WDoHDnl0j7VwjrjtqjrZGiQxdo0fI36B9yNLCrA4o2yIKYyUOXo9a7ak` |
| Configurada en | `tenants.json` campo `webhookGasUrl` |

### Alternativa manual (desde el navegador)
1. Abrir https://script.google.com
2. Abrir el proyecto CRM
3. Ir a **Implementar > Administrar implementaciones**
4. Click en el **lapiz** (editar) de la implementacion activa
5. En "Version" seleccionar **Nueva version**
6. Click **Implementar**

**IMPORTANTE:** NO crear una implementacion nueva (genera URL diferente). Siempre EDITAR la existente.

---

## Servidor de Produccion - Google Cloud VM (SIN Docker)

El bot corre 24/7 en una VM de Google Cloud Compute Engine. **NO usa Docker**. PostgreSQL se instala directamente en Ubuntu y Evolution API usa Prisma para conectarse.

### Datos del Servidor

| Campo | Valor |
|-------|-------|
| Proyecto GCP | `itelsa-beautyos` |
| Nombre VM | `beautyos-server` |
| Usuario SSH | `iaitelsa` |
| Hostname | `beautyos` |
| SO | Ubuntu 24.04 LTS |
| Machine Type | `e2-micro` (0.25 vCPU, 1GB RAM) - Free Tier |
| Region/Zona | `us-central1-a` (Iowa) |
| Disco | 30GB Standard (Free Tier) |
| Swap | 2GB (archivo /swapfile) |
| Firewall | Puertos 3000, 8080 abiertos (tag `beautyos`) |

### Acceder por SSH

**Desde Google Cloud Console:**
- Ir a Compute Engine > VM Instances > click en "SSH" de `beautyos-server`

**Desde terminal local:**
```bash
gcloud compute ssh beautyos-server --zone=us-central1-a
```

---

### FASE 1: Creacion de la VM (ya hecho)

1. Google Cloud Console > Compute Engine > VM Instances > Create Instance
2. Nombre: `beautyos-server`
3. Region: `us-central1-a` (Free Tier)
4. Machine type: `e2-micro`
5. Boot disk: Ubuntu 24.04 LTS, 30GB Standard
6. Firewall: Allow HTTP + HTTPS traffic
7. Network tag: `beautyos`

**IP Estatica:** VPC Network > External IP Addresses > Reservar IP para la VM

**Reglas de Firewall:**
- Nombre: `allow-beautyos-ports`
- Target tags: `beautyos`
- Source: `0.0.0.0/0`
- Protocols: `tcp:3000,8080`

---

### FASE 2: Instalacion de Software Base (ya hecho)

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Verificar
node -v    # v18.x+
npm -v     # 9.x+

# Instalar PM2 (process manager 24/7)
sudo npm install -g pm2

# Crear swap de 2GB (respaldo para 1GB RAM)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

### FASE 3: Instalar PostgreSQL (ya hecho)

Evolution API v2 **requiere PostgreSQL** (no funciona standalone como v1).

```bash
# Instalar PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# Verificar que esta corriendo
sudo systemctl status postgresql

# Crear base de datos para Evolution API
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'TU_PASSWORD_AQUI';"
sudo -u postgres psql -c "CREATE DATABASE evolution;"

# Verificar conexion
sudo -u postgres psql -c "SELECT 1;"
```

PostgreSQL corre como servicio automatico (se inicia con el servidor).

---

### FASE 4: Instalar Evolution API (ya hecho)

```bash
cd /home/iaitelsa
git clone https://github.com/EvolutionAPI/evolution-api.git
cd evolution-api
npm install
```

**Configurar .env de Evolution API** (`/home/iaitelsa/evolution-api/.env`):
Copiar desde `deploy/evolution-api-env-produccion.txt` y agregar datos de PostgreSQL:
```env
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=http://IP_ESTATICA:8080

AUTHENTICATION_API_KEY=beautyos-prod-key-2026

DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://postgres:evolution2026@localhost:5432/evolution?schema=public

WEBHOOK_GLOBAL_ENABLED=true
WEBHOOK_GLOBAL_URL=http://localhost:3000/webhook/evolution
WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS=false

CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true

CONFIG_SESSION_PHONE_CLIENT=BeautyOS
CONFIG_SESSION_PHONE_NAME=Chrome
QRCODE_LIMIT=30
```

**Generar Prisma Client y migrar DB:**
```bash
cd /home/iaitelsa/evolution-api
npm run db:generate
npm run db:deploy
```

**NOTA**: `WEBHOOK_GLOBAL_URL` apunta a `localhost:3000` porque ambos servicios corren en la misma VM. **No necesita ngrok.**

---

### FASE 5: Desplegar el Bot

El script `deploy/setup-server.sh` clona el repo como `beautyos`:
```bash
cd /home/iaitelsa
git clone https://github.com/itelsaia/ITELSA-IA-BeautyOS-Bot.git beautyos
cd beautyos/agent-bot
npm install
```

**Archivos sensibles** (copiar manualmente, NO estan en git):

| Archivo | Ubicacion en servidor | Que contiene |
|---------|----------------------|--------------|
| `.env` | `/home/iaitelsa/beautyos/agent-bot/.env` | PORT, EVOLUTION_API_URL, EVOLUTION_API_KEY |
| `credenciales-google.json` | `/home/iaitelsa/beautyos/agent-bot/credenciales-google.json` | Service Account JWT |
| `tenants.json` | `/home/iaitelsa/beautyos/tenants.json` | Configuracion de clientes |

**Archivo `.env` del bot en produccion** (ver `deploy/env-produccion.txt`):
```env
PORT=3000
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=beautyos-prod-key-2026
```

**IMPORTANTE:** La API KEY debe coincidir en ambos `.env` (Evolution API y Bot).

---

### FASE 6: Configurar PM2 (24/7)

Copiar `deploy/ecosystem.config.js` al servidor (`/home/iaitelsa/ecosystem.config.js`):
```javascript
module.exports = {
  apps: [
    {
      name: 'evolution-api',
      cwd: '/home/iaitelsa/evolution-api',
      script: 'npm',
      args: 'start',
      interpreter: 'none',
      restart_delay: 5000,
      max_restarts: 10,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'beautyos-bot',
      cwd: '/home/iaitelsa/beautyos/agent-bot',
      script: 'src/app.js',
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        EVOLUTION_API_URL: 'http://localhost:8080',
        EVOLUTION_API_KEY: 'beautyos-prod-key-2026'
      }
    }
  ]
};
```

**Iniciar servicios:**
```bash
# Evolution API primero, luego el bot
pm2 start ecosystem.config.js --only evolution-api
sleep 10
pm2 start ecosystem.config.js --only beautyos-bot

# Guardar para auto-inicio al reiniciar VM
pm2 save
pm2 startup  # Ejecutar el comando que muestra
```

**Verificar:**
```bash
pm2 status          # Ambos deben estar "online"
pm2 logs            # Ver logs en tiempo real
curl localhost:3000/health   # Debe retornar JSON ok
curl localhost:8080          # Debe retornar Welcome to Evolution API
```

---

### FASE 7: Conectar WhatsApp

1. Abrir en navegador: `http://IP_ESTATICA:8080/manager`
2. API Key: `beautyos-api-key-produccion-2026`
3. Las instancias se crean automaticamente al iniciar el bot
4. Click en la instancia > escanear QR con WhatsApp del celular
5. Esperar a que muestre "Connected" (badge verde)

---

### Comandos de Mantenimiento (Produccion)

**Ver estado de servicios:**
```bash
pm2 status
```

**Ver logs en tiempo real:**
```bash
pm2 logs                        # Todos
pm2 logs beautyos-bot           # Solo bot
pm2 logs evolution-api          # Solo Evolution
```

**Reiniciar servicios:**
```bash
pm2 restart beautyos-bot        # Solo bot
pm2 restart evolution-api       # Solo Evolution
pm2 restart all                 # Todo
```

**Actualizar el bot (despues de git push desde local):**
```bash
cd ~/beautyos && git pull && cd agent-bot && npm install && pm2 restart beautyos-bot
```

**Actualizar Evolution API:**
```bash
cd ~/evolution-api && git pull && npm install && npm run db:generate && npm run db:deploy && pm2 restart evolution-api
```

**Ver uso de RAM:**
```bash
free -h
pm2 monit
```

**Estado de PostgreSQL:**
```bash
sudo systemctl status postgresql
```

---

### Costos Mensuales

| Recurso | Costo/mes |
|---------|-----------|
| VM e2-micro (Free Tier) | $0 |
| 30GB disco (Free Tier) | $0 |
| IP estatica (asignada a VM) | $0 |
| Firewall rules | $0 |
| OpenAI API (GPT + Whisper) | ~$2-5 |
| **TOTAL** | **~$2-5/mes** |

Si se necesita upgrade a e2-small (2GB RAM): +$13/mes

---

### Estructura de Directorios en el Servidor

```
/home/iaitelsa/
  evolution-api/              # Evolution API v2 + Prisma + PostgreSQL
    .env                      # Config (SERVER_URL, DATABASE_CONNECTION_URI, API_KEY, WEBHOOK)
    prisma/                   # Schemas y migraciones
  beautyos/                   # Repositorio (clonado como "beautyos")
    agent-bot/
      .env                    # Config del bot (PORT, EVOLUTION_API_URL, API_KEY)
      credenciales-google.json # Service Account JWT
      src/app.js              # Entry point
    tenants.json              # Configuracion multi-tenant
    crm-webapp/               # Codigo fuente GAS (se despliega con clasp desde local)
    deploy/                   # Scripts de despliegue
      setup-server.sh         # Script automatizado de instalacion
      ecosystem.config.js     # Config PM2 (copiar a ~/)
      env-produccion.txt      # Template .env del bot
      evolution-api-env-produccion.txt  # Template .env de Evolution API
  ecosystem.config.js         # Configuracion PM2 (copia de deploy/)
```

### Diferencias Local vs Produccion

| Aspecto | Local (Mac Boot Camp) | Produccion (Google Cloud) |
|---------|----------------------|--------------------------|
| ngrok | Necesario (URL cambia) | NO necesario (localhost) |
| PostgreSQL | Servicio Windows local | Servicio Ubuntu local |
| Evolution API | `npx tsx ./src/main.ts` | PM2 con `npm start` |
| Bot | `npm start` manual | PM2 24/7 auto-restart |
| Webhook URL | `https://xxxx.ngrok-free.app/webhook/evolution` | `http://localhost:3000/webhook/evolution` |
| IP | Dinamica (ngrok) | Estatica (Google Cloud) |
