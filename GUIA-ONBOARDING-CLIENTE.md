# BeautyOS - Guia de Onboarding para Nuevos Clientes

Guia paso a paso para configurar y desplegar BeautyOS para un nuevo cliente (peluqueria, spa, estetica independiente).

**Tiempo estimado por cliente: ~60 minutos**

---

## Prerequisitos

Antes de empezar, asegurate de tener:

- [ ] Acceso a la cuenta de Google Cloud con la Service Account
- [ ] API Key de OpenAI activa
- [ ] Repositorio clonado: `https://github.com/itelsaia/ITELSA-IA-BeautyOS-Bot.git`
- [ ] Node.js 18+ instalado
- [ ] clasp instalado: `npm install -g @google/clasp`

**Service Account email (para compartir Sheets):**
```
bot-lector-excel@itelsa-beautyos.iam.gserviceaccount.com
```

---

## Datos que Necesitas Pedirle al Cliente

Enviar este formulario por WhatsApp o email antes de empezar:

1. **Nombre del negocio**
2. **Nombre de la dueña/estilista**
3. **Celular WhatsApp** (el que usara para el bot)
4. **Email de contacto**
5. **Lista de servicios** con: nombre, duracion en minutos y precio
6. **Horarios de trabajo** (que dias y en que horario atiende)
7. **Direccion del local** (opcional, para la base de conocimiento)
8. **Instagram/redes sociales** (opcional)
9. **Logo o foto del negocio** (opcional, URL de Google Drive)
10. **Nombre deseado para el bot** (ej: "Luna", "Bella", "Sofi")

---

## FASE 1: Preparacion de Cuentas (5 min)

### 1.1 Crear Gmail para el cliente

Crear una cuenta de Gmail que sera la "dueña" del CRM Web App del cliente.

- **Formato sugerido:** `nombre.negocio.beautyos@gmail.com`
- **Ejemplo:** `cejas.luisa.beautyos@gmail.com`
- Guardar usuario y contraseña en un lugar seguro
- Este correo es para administracion, NO es el WhatsApp del cliente

### 1.2 Credenciales compartidas

Se usa la **misma Service Account** (`credenciales-google.json`) para todos los clientes.
El bot autentica con Google Sheets via JWT usando esta Service Account.

**No necesitas crear credenciales nuevas por cliente.**

---

## FASE 2: Crear Google Sheet del Cliente (10 min)

### 2.1 Crear el Google Sheet

1. Inicia sesion con la cuenta Gmail del cliente (o la tuya)
2. Ir a [sheets.google.com](https://sheets.google.com) → crear hoja nueva
3. Nombre: `BeautyOS - [Nombre del Negocio]`
   - Ejemplo: `BeautyOS - Cejas y Pestañas Luisa`
4. Copiar el **Sheet ID** de la URL del navegador:
   ```
   https://docs.google.com/spreadsheets/d/ESTE_ES_EL_SHEET_ID/edit
   ```
   > Anotar este ID, lo necesitaras en la Fase 5

### 2.2 Compartir con la Service Account

1. En el Google Sheet, click en boton **"Compartir"**
2. Pegar el email de la Service Account:
   ```
   bot-lector-excel@itelsa-beautyos.iam.gserviceaccount.com
   ```
3. Permiso: **Editor**
4. Desmarcar "Notificar a las personas" → Click "Compartir"

> **CRITICO:** Sin este paso, el bot NO puede leer ni escribir en el Sheet del cliente.

---

## FASE 3: Crear y Desplegar el CRM Web App (15 min)

Cada cliente necesita su PROPIO proyecto de Google Apps Script porque `Backend.gs` usa `SpreadsheetApp.getActiveSpreadsheet()` (proyecto container-bound al Sheet).

### 3.1 Crear el proyecto Apps Script

1. Abrir el Google Sheet del cliente (Fase 2)
2. Menu: **Extensiones → Apps Script**
3. Se abre el editor de Apps Script en una nueva pestaña
4. Copiar el **Script ID** de la URL:
   ```
   https://script.google.com/home/projects/ESTE_ES_EL_SCRIPT_ID/edit
   ```
   > Anotar este ID

### 3.2 Subir el codigo (Opcion A: con clasp - RECOMENDADA)

```bash
# Ir al directorio del CRM
cd crm-webapp

# Backup del .clasp.json actual (apunta al proyecto de Valentina)
cp .clasp.json .clasp.json.backup

# Apuntar clasp al nuevo proyecto del cliente
echo '{"scriptId":"SCRIPT_ID_DEL_CLIENTE","rootDir":"src"}' > .clasp.json

# Login con la cuenta que tiene acceso al script (si es primera vez)
npx clasp login

# Subir todo el codigo (Backend.gs, Setup.gs, index.html, appsscript.json)
npx clasp push --force

# Crear el primer deployment (Web App)
npx clasp deploy -d "v1 - Setup inicial"
# ↑ ANOTAR el Deployment ID que retorna en la consola

# IMPORTANTE: Restaurar el .clasp.json original
cp .clasp.json.backup .clasp.json
```

### 3.2b Subir el codigo (Opcion B: manual, si clasp falla)

1. En el editor de Apps Script, borrar el archivo `Code.gs` que viene por defecto
2. Crear archivo `Backend.gs` → copiar y pegar todo el contenido de `crm-webapp/src/Backend.gs`
3. Crear archivo `Setup.gs` → copiar y pegar todo el contenido de `crm-webapp/src/Setup.gs`
4. Crear archivo `index.html` → copiar y pegar todo el contenido de `crm-webapp/src/index.html`
5. Ir a **Configuracion del proyecto** (icono engranaje) → marcar **"Mostrar archivo de manifiesto appsscript.json"**
6. Editar `appsscript.json` con:
   ```json
   {
     "timeZone": "America/Bogota",
     "dependencies": {},
     "exceptionLogging": "STACKDRIVER",
     "runtimeVersion": "V8",
     "webapp": {
       "executeAs": "USER_DEPLOYING",
       "access": "ANYONE_ANONYMOUS"
     }
   }
   ```
7. Click en **Implementar → Nueva implementacion**
   - Tipo: **Aplicacion web**
   - Ejecutar como: **Yo**
   - Acceso: **Cualquier persona**
8. Click "Implementar" → Anotar la **URL del deployment**

### 3.3 Ejecutar Setup inicial (crear hojas)

1. En el editor de Apps Script, seleccionar la funcion `inicializarEntorno` en el dropdown
2. Click en **Ejecutar** (triangulo ▶)
3. La primera vez pedira permisos de Google → **Aceptar todos**
4. Verificar en el Google Sheet que se crearon estas hojas:
   - CONFIGURACION
   - CLIENTES
   - SESIONES
   - COLABORADORES
   - DISPONIBILIDAD
   - AGENDA
   - LISTA_ESTADOS
   - PROMOCIONES
   - NOVEDADES
   - CONOCIMIENTO
   - CONFIG_SERVICIOS

> Si alguna hoja no se creo, ejecutar `inicializarEntorno()` de nuevo.

---

## FASE 4: Llenar los Datos del Cliente (15 min)

Abrir el Google Sheet del cliente y llenar las siguientes hojas con los datos recopilados:

### 4.1 Hoja: CONFIGURACION

Editar la columna B (VALOR) de cada fila:

| CLAVE | VALOR a poner | Notas |
|-------|--------------|-------|
| ESTADO_SERVICIO | `ACTIVO` | Fijo. `INACTIVO` deshabilita al cliente |
| CLAVE_OPENAI | `sk-proj-...` | Tu API key centralizada de OpenAI |
| NOMBRE_NEGOCIO | `Cejas y Pestañas Luisa` | Nombre real del negocio |
| NOMBRE_AGENTE | `Luna` | Nombre del bot (inventar algo bonito) |
| SALUDO_BASE | `Hola! Soy Luna, tu asistente de belleza...` | Personalizar segun el cliente |
| CELULAR_DUEÑA | `573001234567` | Formato: 57 + 10 digitos. Para notificaciones |
| CORREO_DUEÑA | `luisa@email.com` | Email de la dueña |
| ENLACE_LOGO | `https://drive.google.com/...` | URL publica del logo |
| COLOR_MARCA | `#E91E63` | Color hex favorito del negocio |
| INTERVALO_SLOTS_MIN | `15` | Cada cuantos minutos ofrecer horarios (15, 20 o 30) |
| TIEMPO_ENTRE_CITAS_MIN | `10` | Minutos de descanso/preparacion entre citas |
| MINUTOS_VENCIMIENTO_CITA | `30` | Minutos para auto-expirar citas no atendidas |

### 4.2 Hoja: CONFIG_SERVICIOS

Agregar los servicios del negocio. **Ejemplo para cejas y pestañas:**

| ID_SERVICIO | INTENCION | RESPUESTA_BASE | TIEMPO_SERVICIO | CATEGORIA | TIPO_SERVICIO |
|-------------|-----------|----------------|-----------------|-----------|---------------|
| CEJ-001 | cejas, diseño cejas, arreglo cejas, depilacion cejas | Diseño y arreglo profesional de cejas con tecnica personalizada. Precio: $25.000 | 30 | Cejas | Diseño de cejas |
| PES-001 | pestañas, extensiones, lifting pestañas, rizado | Extensiones de pestañas pelo a pelo con materiales premium. Precio: $80.000 | 90 | Pestañas | Extensiones de pestañas |
| PES-002 | lifting, laminado pestañas | Lifting y laminado de pestañas para una mirada natural. Precio: $50.000 | 60 | Pestañas | Lifting de pestañas |

> **Importante:** `TIPO_SERVICIO` es el nombre oficial que usa el bot para agendar. `INTENCION` son las palabras clave que disparan el servicio. `RESPUESTA_BASE` debe incluir el precio con formato `Precio: $XX.000`.

### 4.3 Hoja: COLABORADORES

| ID_COLABORADOR | NOMBRE | CELULAR | ROL | PIN | ESTADO | COMPETENCIAS |
|----------------|--------|---------|-----|-----|--------|-------------|
| ADMIN-001 | Luisa | 573001234567 | ADMIN | 1234 | ACTIVO | Diseño de cejas,Extensiones de pestañas,Lifting de pestañas |

> **Competencias:** Separar con coma SIN espacios despues de la coma. Deben coincidir EXACTAMENTE con `TIPO_SERVICIO` de CONFIG_SERVICIOS.

> Si es una dueña sola, solo necesita 1 fila. Si tiene empleadas, agregar una fila por cada una con ROL = `STAFF`.

### 4.4 Hoja: DISPONIBILIDAD

Agregar una fila por cada dia que el negocio trabaja:

| TIPO | FECHA_DIA | HORA_INI | HORA_FIN | MOTIVO | APLICA_A | HORARIO | CATEGORIA |
|------|-----------|----------|----------|--------|----------|---------|-----------|
| Jornada | Lunes | 09:00 | 18:00 | Horario Base | TODOS | DIARIO | |
| Jornada | Martes | 09:00 | 18:00 | Horario Base | TODOS | DIARIO | |
| Jornada | Miercoles | 09:00 | 18:00 | Horario Base | TODOS | DIARIO | |
| Jornada | Jueves | 09:00 | 18:00 | Horario Base | TODOS | DIARIO | |
| Jornada | Viernes | 09:00 | 18:00 | Horario Base | TODOS | DIARIO | |
| Jornada | Sabado | 08:00 | 14:00 | Horario Sabado | TODOS | DIARIO | |

> **Dias NO listados = negocio cerrado.** Si no trabaja domingos, simplemente no agregar fila de Domingo.

> Los bloqueos (vacaciones, incapacidades) se agregan despues desde el CRM Web App o directamente en esta hoja.

### 4.5 Hoja: CONOCIMIENTO (opcional)

Para FAQ y recursos multimedia:

| INTENCION | RESPUESTA | TIPO_MEDIA | URL |
|-----------|-----------|------------|-----|
| ubicacion, donde quedan, direccion, como llego | Estamos ubicados en Calle 45 #12-34, Bogota. Te esperamos! | enlace | https://maps.google.com/... |
| catalogo, trabajos, portafolio, fotos | Mira nuestros trabajos en Instagram | enlace | https://instagram.com/cejasluisa |
| precios, cuanto cuesta, tarifas | Te comparto nuestro catalogo de servicios y precios | pdf | https://drive.google.com/... |

### 4.6 Hoja: PROMOCIONES (opcional)

Se pueden agregar despues desde el CRM Web App. Ejemplo:

| NOMBRE | DESCRIPCION | TIPO_PROMO | VALOR_DESCUENTO | APLICA_SERVICIO | APLICA_DIA | VENCE | ESTADO |
|--------|-------------|------------|-----------------|-----------------|------------|-------|--------|
| Martes de Cejas | 20% OFF en diseño de cejas todos los martes | PORCENTAJE | 20 | Diseño de cejas | Martes | 31/12/2026 | ACTIVO |

---

## FASE 5: Registrar Tenant en tenants.json (2 min)

Abrir el archivo `tenants.json` en la raiz del proyecto y agregar el nuevo cliente:

```json
{
  "peluqueria-valentina": {
    "displayName": "Peluqueria Valentina",
    "sheetId": "1cBGRkCI1m2pY9A6dakECo4YD94OUNSq1QEXMmQAnIbs",
    "webhookGasUrl": "https://script.google.com/macros/s/AKfycbx.../exec",
    "instanceName": "peluqueria-valentina",
    "enabled": true
  },
  "cejas-luisa": {
    "displayName": "Cejas y Pestañas Luisa",
    "sheetId": "SHEET_ID_DE_LA_FASE_2",
    "webhookGasUrl": "https://script.google.com/macros/s/DEPLOYMENT_ID_DE_LA_FASE_3/exec",
    "instanceName": "cejas-luisa",
    "enabled": true
  }
}
```

**Campos:**
- `displayName`: Nombre visible en logs y notificaciones
- `sheetId`: El ID copiado en la Fase 2.1
- `webhookGasUrl`: La URL del deployment de la Fase 3.2
- `instanceName`: ID unico para Evolution API (usar kebab-case, sin espacios ni tildes)
- `enabled`: `true` para activar, `false` para deshabilitar sin borrar

---

## FASE 6: Crear Instancia WhatsApp (5 min)

### 6.1 Iniciar Evolution API

```bash
cd "ruta/a/evolution-api"
npm start
# Esperar: "[SERVER] HTTP - ON: 8080"
```

### 6.2 Iniciar el Bot

```bash
cd "ruta/al/proyecto/agent-bot"
npm start
# Esperar: "Servidor HTTP escuchando en puerto 3000"
# Esperar: "[cejas-luisa] Sincronizacion completa"
```

> El bot crea la instancia de Evolution API automaticamente si no existe.

### 6.3 Conectar WhatsApp

1. Abrir en el navegador: `http://localhost:8080/manager` (o `http://IP_VPS:8080/manager`)
2. Buscar la instancia `cejas-luisa`
3. La dueña del negocio debe escanear el **codigo QR** con su WhatsApp:
   - Abrir WhatsApp → menu (3 puntos) → Dispositivos vinculados → Vincular dispositivo
4. Esperar a que el badge cambie a **verde** (Connected)

### 6.4 Configurar Webhook en Evolution Manager

Si es la primera vez que se configura esta instancia:

1. En Evolution Manager → click en la instancia → **Events**
2. Webhook URL: `http://localhost:3000/webhook/evolution` (local) o `http://IP_VPS:3000/webhook/evolution` (produccion)
3. Habilitar evento: `MESSAGES_UPSERT`
4. Guardar

---

## FASE 7: Verificacion y Testing (10 min)

### Checklist rapido:

- [ ] Google Sheet tiene las 11 hojas creadas
- [ ] Service Account tiene acceso Editor al Sheet
- [ ] GAS responde JSON (test abajo)
- [ ] Tenant carga en logs: `[cejas-luisa] Sincronizacion completa`
- [ ] WhatsApp conectado (badge verde en Evolution Manager)
- [ ] Enviar "Hola" → bot responde con saludo personalizado
- [ ] Pedir servicio → bot muestra catalogo del cliente
- [ ] Agendar cita → cita aparece en hoja AGENDA
- [ ] Confirmar en CRM Web App que la cita se ve
- [ ] Notificacion llega al WhatsApp de la dueña

### Test del GAS endpoint:

```bash
node -e "
const axios = require('axios');
axios.post('PEGAR_URL_DEPLOYMENT_AQUI', {
  action: 'getAgenda',
  payload: {}
}).then(r => console.log('OK:', r.data))
  .catch(e => console.error('ERROR:', e.message));
"
```

**Resultado esperado:** `{ code: 200, message: "...", data: [...] }`
**Si retorna HTML:** El deployment no se actualizo. Hacer `clasp push --force && clasp deploy -i DEPLOYMENT_ID -d "fix"` de nuevo.

### Test del bot via WhatsApp:

1. Enviar: `"Hola"` → Debe saludar con el nombre del agente
2. Enviar: `"Quiero agendar cejas para mañana a las 10am"` → Debe verificar disponibilidad y ofrecer horario
3. Confirmar: `"Si"` → Debe crear la cita y enviar confirmacion
4. Verificar en Google Sheet → hoja AGENDA que la cita aparezca
5. Verificar que la dueña recibio notificacion por WhatsApp

---

## FASE 8: Despliegue en VPS para Produccion 24/7

### 8.1 Servidor recomendado

| Proveedor | Plan | RAM | Precio |
|-----------|------|-----|--------|
| **Hetzner Cloud** | CX22 | 4GB | ~$4.50/mes |
| **DigitalOcean** | Basic Droplet | 2GB | $6/mes |
| **AWS Lightsail** | Linux | 2GB | $5/mes |

**Requisitos minimos:** Ubuntu 22.04, 2GB RAM, 1 vCPU

### 8.2 Setup inicial del VPS

```bash
# 1. Conectar al VPS
ssh root@IP_DEL_VPS

# 2. Actualizar sistema
apt update && apt upgrade -y

# 3. Instalar Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# 4. Instalar PM2 (process manager — mantiene el bot vivo 24/7)
npm install -g pm2

# 5. Instalar Git
apt install -y git

# 6. Clonar el repositorio
git clone https://github.com/itelsaia/ITELSA-IA-BeautyOS-Bot.git
cd ITELSA-IA-BeautyOS-Bot

# 7. Copiar archivos sensibles desde tu PC (NO estan en git):
#    - .env
#    - credenciales-google.json
#    - tenants.json
# Usar SCP desde tu PC:
# scp .env credenciales-google.json tenants.json root@IP_VPS:~/ITELSA-IA-BeautyOS-Bot/

# 8. Instalar dependencias del bot
cd agent-bot && npm install && cd ..

# 9. Instalar Evolution API (opcion Docker)
apt install -y docker.io
docker run -d --name evolution-api \
  -p 8080:8080 \
  -v evolution_data:/evolution/instances \
  atendai/evolution-api:latest

# 10. Verificar Evolution API
curl http://localhost:8080

# 11. Configurar .env para produccion
# EVOLUTION_API_URL=http://localhost:8080  (ya apunta a localhost)

# 12. Iniciar bot con PM2
cd agent-bot
pm2 start src/app.js --name "beautyos-bot"
pm2 save
pm2 startup  # Configura auto-inicio al reiniciar el VPS
```

### 8.3 Configurar Webhook con IP publica

En Evolution Manager (`http://IP_VPS:8080/manager`), actualizar webhook de cada instancia:

```
http://IP_PUBLICA_VPS:3000/webhook/evolution
```

### 8.4 (Opcional) Nginx como reverse proxy + dominio

```bash
apt install -y nginx

# Crear config
cat > /etc/nginx/sites-available/beautyos << 'EOF'
server {
    listen 80;
    server_name api.tunegocio.com;

    location /webhook/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    location /manager/ {
        proxy_pass http://localhost:8080;
    }
}
EOF

ln -s /etc/nginx/sites-available/beautyos /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx
```

### 8.5 Monitoreo y mantenimiento

```bash
# Ver estado del bot
pm2 status

# Ver logs en tiempo real
pm2 logs beautyos-bot

# Reiniciar despues de cambios en el codigo
pm2 restart beautyos-bot

# Actualizar codigo desde GitHub
cd ~/ITELSA-IA-BeautyOS-Bot && git pull && cd agent-bot && npm install && pm2 restart beautyos-bot

# Ver metricas de memoria/CPU
pm2 monit
```

---

## Registro de Clientes Desplegados

Mantener una tabla con los datos de cada cliente:

| Campo | Cliente 1 | Cliente 2 |
|-------|-----------|-----------|
| **Tenant ID** | `peluqueria-valentina` | `cejas-luisa` |
| **Negocio** | Peluqueria Valentina | Cejas y Pestañas Luisa |
| **Gmail** | valentina.beautyos@gmail.com | cejas.luisa.beautyos@gmail.com |
| **Sheet ID** | `1cBGRkCI...` | `1abc...xyz` |
| **Script ID** | `1WDoHDn...` | `1XYZ...abc` |
| **Deployment ID** | `AKfycbx...ZHT` | `AKfycby...ABC` |
| **CRM URL** | `https://script.google.com/macros/s/.../exec` | `https://script.google.com/macros/s/.../exec` |
| **Instance Name** | `peluqueria-valentina` | `cejas-luisa` |
| **WhatsApp** | +57 300 111 2233 | +57 300 444 5566 |
| **Estado** | Activo | Demo |

---

## Troubleshooting

| Problema | Causa probable | Solucion |
|----------|---------------|----------|
| GAS retorna HTML en vez de JSON | Deployment desactualizado | `clasp push --force` + `clasp deploy -i ID -d "fix"` |
| Bot no recibe mensajes | Webhook URL incorrecta | Verificar en Evolution Manager → Events → Webhook |
| "Sincronizacion fallida" en logs | Service Account sin acceso | Compartir Sheet con `bot-lector-excel@itelsa-beautyos.iam.gserviceaccount.com` como Editor |
| Tenant no carga (licencia INACTIVA) | `ESTADO_SERVICIO` en Sheets no es "ACTIVO" | Editar hoja CONFIGURACION |
| Bot responde pero no agenda | `CLAVE_OPENAI` vacia o invalida | Verificar API key en CONFIGURACION |
| "Puerto 8080 en uso" | Evolution API ya esta corriendo | `docker restart evolution-api` o matar proceso |
| Cita no aparece en CRM | Data validation legacy | GAS ya limpia validaciones. Si persiste, borrar validaciones manualmente en la hoja AGENDA |
| Auto-expire no funciona | Config falta en Sheet | Agregar fila `MINUTOS_VENCIMIENTO_CITA` con valor `30` en CONFIGURACION |

---

## Tiempo Total por Fase

| Fase | Descripcion | Tiempo |
|------|-------------|--------|
| 1 | Crear cuentas (Gmail) | 5 min |
| 2 | Google Sheet + compartir con SA | 10 min |
| 3 | Apps Script + Deploy | 15 min |
| 4 | Llenar datos del cliente | 15 min |
| 5 | Registrar en tenants.json | 2 min |
| 6 | Conectar WhatsApp (QR) | 5 min |
| 7 | Verificacion y testing | 10 min |
| 8 | VPS (solo primera vez) | 30 min |
| **TOTAL (primer cliente)** | | **~90 min** |
| **TOTAL (clientes siguientes)** | (sin Fase 8) | **~60 min** |
