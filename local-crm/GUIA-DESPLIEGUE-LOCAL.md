# BeautyOS CRM Local — Guia de Despliegue y Configuracion

## Indice
1. [Que es el CRM Local](#1-que-es-el-crm-local)
2. [Requisitos previos](#2-requisitos-previos)
3. [Obtener las credenciales de Google](#3-obtener-las-credenciales-de-google)
4. [Obtener el Sheet ID del cliente](#4-obtener-el-sheet-id-del-cliente)
5. [Obtener el Webhook GAS URL](#5-obtener-el-webhook-gas-url)
6. [Configurar config.json](#6-configurar-configjson)
7. [Instalacion paso a paso](#7-instalacion-paso-a-paso)
8. [Primer arranque y sync inicial](#8-primer-arranque-y-sync-inicial)
9. [Uso diario](#9-uso-diario)
10. [Plan de pruebas / Diagnostico](#10-plan-de-pruebas--diagnostico)
11. [Troubleshooting](#11-troubleshooting)
12. [Checklist por cliente nuevo](#12-checklist-por-cliente-nuevo)

---

## 1. Que es el CRM Local

El CRM Local es una **copia hibrida** del CRM web de BeautyOS que funciona directamente en el computador del local (peluqueria/SPA). Permite:

- **Operar SIN internet**: consultar clientes, ver agenda, registrar walk-ins, agendar citas
- **Respaldo automatico** en un archivo Excel local (`data/beautyos.xlsx`)
- **Sincronizacion bidireccional** con Google Sheets cuando hay internet

### Como funciona

```
GOOGLE SHEETS (fuente de verdad en la nube)
       |              ^
  [PULL cada 5min] [PUSH cola local]
       |              |
   SYNC ENGINE (sync.js)
       |              |
   EXCEL LOCAL (data/beautyos.xlsx)
       |              ^
   [lectura]     [escritura + cola]
       |              |
   SERVIDOR EXPRESS (localhost:5000)
       |              ^
   [JSON]        [fetch POST]
       |              |
   NAVEGADOR CHROME (index.html)
```

### Que funciona offline vs online

| Funcionalidad | Offline | Online |
|---|---|---|
| Login (PIN) | SI | SI |
| Ver Dashboard | SI | SI |
| Ver/Buscar Clientes | SI | SI |
| Ver Agenda (cualquier fecha) | SI | SI |
| Crear cliente walk-in | SI (guarda local + cola sync) | SI |
| Agendar cita manual | SI (valida disponibilidad local) | SI |
| Cerrar/marcar cita | SI | SI |
| Toggle exento anticipo | SI | SI |
| Ver Servicios | SI | SI |
| Ver Equipo | SI | SI |
| Promociones | NO — "Solo disponible con conexion" | SI (via CRM web) |
| Novedades/Solicitudes | NO | SI (via CRM web) |
| Galeria | NO | SI (via CRM web) |
| Configuracion avanzada | NO | SI (via CRM web) |
| Analytics | NO | SI (via CRM web) |

---

## 2. Requisitos previos

### En TU computador (el de desarrollo/soporte)
- Git instalado
- Node.js v16 o superior
- Acceso a la consola de Google Cloud Platform (GCP)
- Acceso al proyecto GAS con `clasp` (para obtener el deploy ID)

### En el computador del CLIENTE (el del local)
- **Windows 10 o superior**
- **Node.js v16 o superior** — Descargar de https://nodejs.org (version LTS)
  - Al instalar, marcar la opcion "Add to PATH"
  - Verificar: abrir CMD y escribir `node --version` (debe mostrar v16+)
- **Navegador Chrome** (o Edge basado en Chromium)
- **Conexion a internet** para el primer arranque (sync inicial)
  - Despues de eso, funciona offline

### Verificar que Node.js esta instalado en el PC del cliente

Abrir CMD (tecla Windows + escribir "cmd" + Enter):
```
node --version
```
Debe mostrar algo como `v18.20.5` o superior. Si dice "no se reconoce", instalar Node.js.

---

## 3. Obtener las credenciales de Google

El archivo `credenciales-google.json` es una **cuenta de servicio** (Service Account) de Google Cloud que permite al CRM Local leer y escribir en Google Sheets del cliente.

### Si ya tienes una cuenta de servicio (reutilizar la del bot)

El bot de WhatsApp ya usa un archivo `credenciales-google.json`. **Es el mismo archivo** — se puede copiar directamente.

Ubicacion actual del archivo:
```
agent-bot/credenciales-google.json
```

Copiarlo a:
```
local-crm/credenciales-google.json
```

### Si necesitas crear una cuenta de servicio nueva

1. Ir a [Google Cloud Console](https://console.cloud.google.com/)
2. Seleccionar el proyecto `itelsa-beautyos` (o el que corresponda)
3. Menu lateral → **IAM y administracion** → **Cuentas de servicio**
4. Click **"Crear cuenta de servicio"**
   - Nombre: `beautyos-local-crm`
   - ID: `beautyos-local-crm`
   - Click Crear
5. En la lista de cuentas, click en la cuenta creada
6. Pestana **"Claves"** → **"Agregar clave"** → **"Crear clave nueva"**
   - Tipo: **JSON**
   - Se descarga automaticamente un archivo `.json`
7. Renombrar ese archivo a `credenciales-google.json`

### Compartir el Google Sheet con la cuenta de servicio

**CRITICO**: El Google Sheet del cliente debe estar compartido con el email de la cuenta de servicio.

1. Abrir el archivo `credenciales-google.json` con un editor de texto
2. Buscar el campo `"client_email"` — copiar ese email (ej: `beautyos@itelsa-beautyos.iam.gserviceaccount.com`)
3. Abrir el Google Sheet del cliente en el navegador
4. Click **"Compartir"** (boton verde arriba a la derecha)
5. Pegar el email de la cuenta de servicio
6. Asignar permiso: **Editor**
7. Desmarcar "Notificar"
8. Click **"Compartir"**

Sin este paso, el sync fallara con error de permisos.

### Estructura del archivo credenciales-google.json

```json
{
  "type": "service_account",
  "project_id": "itelsa-beautyos",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "beautyos@itelsa-beautyos.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

Los campos que usa el CRM Local son: `client_email` y `private_key`. Los demas son metadata.

---

## 4. Obtener el Sheet ID del cliente

El Sheet ID es el identificador unico del Google Sheet del cliente. Se encuentra en la URL del Google Sheet:

```
https://docs.google.com/spreadsheets/d/ESTE_ES_EL_SHEET_ID/edit
                                       ^^^^^^^^^^^^^^^^^^^^^^^^
```

### Ejemplo
URL: `https://docs.google.com/spreadsheets/d/1WDoHDnl0j7VwjrjtqjrZGiQxdo0fI36B9yNLCrA4o2y/edit`
Sheet ID: `1WDoHDnl0j7VwjrjtqjrZGiQxdo0fI36B9yNLCrA4o2y`

### Donde encontrarlo

**Opcion A**: Desde el navegador — abrir el Google Sheet del cliente y copiar de la URL.

**Opcion B**: Desde el archivo `tenants.json` del bot — buscar el tenant del cliente:
```json
{
  "tenant_carolina": {
    "sheetId": "1WDoHDnl0j7VwjrjtqjrZGiQxdo0fI36B9yNLCrA4o2y",
    ...
  }
}
```

### Verificar que el Sheet tiene la estructura correcta

El Google Sheet DEBE tener estas pestanas (hojas) con los headers correctos:

| Hoja | Se usa en CRM Local | Headers obligatorios (fila 1) |
|---|---|---|
| CONFIGURACION | SI | CLAVE, VALOR, DESCRIPCION_TECNICA |
| CLIENTES | SI | ID_CLIENTE, CELULAR, NOMBRE, CORREO, CUMPLE, DIRECCION, TIPO, REGISTRO, EXENTO_ANTICIPO |
| AGENDA | SI | ID, FECHA, TIPO_DIA, INICIO, FIN, CLIENTE, CELULAR_CLIENTE, SERVICIO, PRECIO, PROFESIONAL, ESTADO, NOTAS, EXENTO_ANTICIPO, MONTO_ANTICIPO, MONTO_PAGADO, SALDO_RESTANTE, ESTADO_PAGO, REF_COMPROBANTE, FECHA_PAGO, PROMO, TIPO_PROMO |
| CONFIG_SERVICIOS | SI | ID_SERVICIO, INTENCION, RESPUESTA_BASE, TIEMPO_SERVICIO, CATEGORIA, TIPO_SERVICIO, ANTICIPO_HABILITADO, TIPO_ANTICIPO, VALOR_ANTICIPO |
| COLABORADORES | SI | ID_COLABORADOR, NOMBRE, CELULAR, ROL, PIN, ESTADO, COMPETENCIAS |
| DISPONIBILIDAD | SI | TIPO, FECHA_DIA, HORA_INI, HORA_FIN, MOTIVO, APLICA_A, HORARIO, CATEGORIA |
| FESTIVOS_CONFIG | SI | ANO, FECHA, NOMBRE, TRABAJA, GENERADO_AUTO, HORA_INI, HORA_FIN |

Si alguna hoja falta, el sync descargara lo que exista y creara las demas vacias en el Excel local.

---

## 5. Obtener el Webhook GAS URL

El Webhook GAS URL es la direccion del backend de Google Apps Script que procesa las escrituras (crear clientes, agendar citas, etc.).

### Formato

```
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

### Donde encontrarlo

**Opcion A**: Desde `tenants.json` del bot:
```json
{
  "tenant_carolina": {
    "webhookGasUrl": "https://script.google.com/macros/s/AKfycbxTfm6MBwaqYOU27QQ2RaO5uy_JzRjywMZN-q9ZnfdotaJCqNSjYN57mB28zImVmZHT/exec"
  }
}
```

**Opcion B**: Desde Google Apps Script directamente:
1. Abrir https://script.google.com
2. Buscar el proyecto GAS del cliente
3. Click **"Implementar"** → **"Gestionar implementaciones"**
4. Copiar la URL de la implementacion activa

### URLs de produccion actuales

| Cliente | Webhook GAS URL |
|---|---|
| Produccion (Carolina Leon) | `https://script.google.com/macros/s/AKfycbxTfm6MBwaqYOU27QQ2RaO5uy_JzRjywMZN-q9ZnfdotaJCqNSjYN57mB28zImVmZHT/exec` |
| DEMO_BEAUTYOS | `https://script.google.com/macros/s/AKfycbyOYj4lUTYTohz8pP2m5eU54oCRZ4CTmgVltqpfzmUlO61_Q2LdEUltXF20O3DweQV0/exec` |

### Acciones que soporta el webhook (push desde CRM Local)

Cuando el CRM Local crea un cliente o agenda una cita offline, envia un POST a esta URL con:

| Accion local | Action enviado | Payload |
|---|---|---|
| Crear cliente | `createCliente` | `{ celular, nombre, correo, cumple, direccion, tipo }` |
| Agendar cita | `createAgenda` | `{ fecha, inicio, fin, cliente, celularCliente, servicio, precio, profesional, notas }` |
| Cerrar/cambiar estado cita | `updateAgendaStatus` | `{ id, nuevoEstado }` |
| Toggle exento anticipo | `toggleExentoAnticipo` | `{ celular, exento }` |

---

## 6. Configurar config.json

Abrir `local-crm/config.json` con un editor de texto y completar:

```json
{
  "sheetId": "PEGAR_AQUI_EL_SHEET_ID_DEL_CLIENTE",
  "credencialesPath": "./credenciales-google.json",
  "webhookGasUrl": "PEGAR_AQUI_LA_URL_DEL_WEBHOOK_GAS",
  "port": 5000,
  "syncIntervalMs": 300000,
  "autoOpenBrowser": true
}
```

### Descripcion de cada campo

| Campo | Que poner | Ejemplo |
|---|---|---|
| `sheetId` | El ID del Google Sheet del cliente (ver seccion 4) | `"1WDoHDnl0j7Vwjr..."` |
| `credencialesPath` | Ruta al archivo de credenciales. Si esta en la misma carpeta, dejar `"./credenciales-google.json"` | `"./credenciales-google.json"` |
| `webhookGasUrl` | La URL del webhook GAS del cliente (ver seccion 5) | `"https://script.google.com/macros/s/.../exec"` |
| `port` | Puerto del servidor local. Dejar `5000` a menos que este ocupado | `5000` |
| `syncIntervalMs` | Cada cuanto sincroniza con Google Sheets (en milisegundos). `300000` = 5 minutos | `300000` |
| `autoOpenBrowser` | Si el navegador se abre automaticamente al iniciar. `true` para clientes | `true` |

### Ejemplo real (cliente Carolina Leon)

```json
{
  "sheetId": "1WDoHDnl0j7VwjrjtqjrZGiQxdo0fI36B9yNLCrA4o2y",
  "credencialesPath": "./credenciales-google.json",
  "webhookGasUrl": "https://script.google.com/macros/s/AKfycbxTfm6MBwaqYOU27QQ2RaO5uy_JzRjywMZN-q9ZnfdotaJCqNSjYN57mB28zImVmZHT/exec",
  "port": 5000,
  "syncIntervalMs": 300000,
  "autoOpenBrowser": true
}
```

---

## 7. Instalacion paso a paso

### 7.1 Preparar la carpeta en el PC del cliente

1. Copiar toda la carpeta `local-crm/` al PC del cliente
   - Puede ser via USB, descarga del repo, o copia manual
   - Ubicacion recomendada: `C:\BeautyOS\` o el Escritorio

2. La estructura debe quedar asi:
```
C:\BeautyOS\local-crm\
  ├── config.json              ← Ya configurado (seccion 6)
  ├── credenciales-google.json ← Ya copiado (seccion 3)
  ├── install.bat
  ├── start.bat
  ├── server.js
  ├── package.json
  ├── package-lock.json
  ├── services/
  │   ├── excel.js
  │   ├── queue.js
  │   └── sync.js
  ├── routes/
  │   └── api.js
  ├── public/
  │   ├── index.html
  │   └── assets/
  │       ├── bootstrap.min.css
  │       ├── bootstrap.bundle.min.js
  │       ├── chart.umd.js
  │       ├── inter.css
  │       └── fontawesome/
  │           ├── css/all.min.css
  │           └── webfonts/ (6 archivos .woff2 y .ttf)
  └── data/                    ← Se crea automaticamente
      └── beautyos.xlsx        ← Se crea en el primer arranque
```

### 7.2 Instalar dependencias

Doble clic en **`install.bat`**

O abrir CMD en la carpeta y ejecutar:
```
cd C:\BeautyOS\local-crm
npm install
```

Debe terminar sin errores. Se crea la carpeta `node_modules/`.

### 7.3 Iniciar el servidor

Doble clic en **`start.bat`**

O abrir CMD:
```
cd C:\BeautyOS\local-crm
node server.js
```

Debe mostrar:
```
[excel] Workbook creado: data\beautyos.xlsx
[sync] Intentando sync inicial...
[sync] Pulled: CONFIGURACION (15 rows)
[sync] Pulled: CLIENTES (42 rows)
[sync] Pulled: AGENDA (87 rows)
[sync] Pulled: CONFIG_SERVICIOS (12 rows)
[sync] Pulled: COLABORADORES (5 rows)
[sync] Pulled: DISPONIBILIDAD (8 rows)
[sync] Pulled: FESTIVOS_CONFIG (18 rows)
[sync] Sync inicial completo: 7 hojas descargadas
========================================
  BeautyOS CRM Local
  http://localhost:5000
  Sync cada 5 minutos
========================================
```

Se abre Chrome automaticamente en `http://localhost:5000`.

### 7.4 Crear acceso directo para el cliente

1. Click derecho en el Escritorio → Nuevo → Acceso directo
2. Ubicacion: `C:\BeautyOS\local-crm\start.bat`
3. Nombre: **"BeautyOS CRM"**
4. Cambiar icono si se desea

El cliente solo necesita hacer doble clic en este acceso directo cada dia.

---

## 8. Primer arranque y sync inicial

### Que pasa en el primer arranque

1. **Se crea `data/beautyos.xlsx`** — archivo Excel vacio con 8 hojas
2. **Sync inicial** — se conecta a Google Sheets y descarga todos los datos:
   - Configuracion, Clientes, Agenda, Servicios, Colaboradores, Disponibilidad, Festivos
3. **El Excel se llena** con los datos descargados
4. **El CRM se abre en Chrome** — listo para usar

### Si NO hay internet en el primer arranque

```
[sync] Sin conexion. El CRM usara datos locales existentes.
```

El CRM arranca con un Excel vacio (sin datos). Podra crear clientes y citas, pero no vera datos historicos hasta que haya internet y se haga el primer sync.

**Recomendacion**: Siempre hacer el primer arranque CON internet.

### Como verificar que el sync funciono

1. Abrir `data/beautyos.xlsx` con Excel/LibreOffice
2. Verificar que la hoja CLIENTES tiene datos
3. Verificar que la hoja AGENDA tiene citas
4. En el CRM web: el indicador verde al lado del nombre del negocio = online

---

## 9. Uso diario

### Iniciar el CRM
- Doble clic en `start.bat` (o el acceso directo)
- Se abre Chrome en `http://localhost:5000`

### Cerrar el CRM
- Cerrar la ventana de CMD (la ventana negra)
- O presionar `Ctrl+C` en la ventana de CMD

### Sincronizacion

| Tipo | Como | Cuando |
|---|---|---|
| **Automatica** | El servidor sincroniza cada 5 minutos si hay internet | Siempre que el servidor esta corriendo |
| **Manual** | Click en el boton de sync (icono de flechas circulares en la barra superior) | Cuando se quiere forzar una sincronizacion inmediata |

### Indicadores en la interfaz

| Elemento | Significado |
|---|---|
| Punto verde (barra superior) | Conectado a Google Sheets |
| Punto rojo | Sin conexion |
| `Sync: 20/03/2026, 14:30:05` | Ultima sincronizacion exitosa |
| Badge amarillo con numero | Cantidad de cambios pendientes de sincronizar |
| Icono sync girando | Sincronizacion en progreso |

### Cuando se crea algo offline

1. El dato se guarda inmediatamente en el Excel local
2. Se agrega a la cola de sincronizacion (hoja SYNC_QUEUE)
3. Badge amarillo muestra "1" (o el numero de items pendientes)
4. Cuando vuelve internet (o se hace sync manual), se envia a Google Sheets
5. El badge desaparece cuando todos los items se sincronizaron

---

## 10. Plan de pruebas / Diagnostico

### FASE 1: Verificacion de instalacion

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 1.1 | Ejecutar `node --version` en CMD | Muestra v16+ | ☐ |
| 1.2 | Ejecutar `npm install` en la carpeta local-crm | Termina sin errores, crea `node_modules/` | ☐ |
| 1.3 | Verificar que `credenciales-google.json` existe en la carpeta | Archivo presente | ☐ |
| 1.4 | Verificar que `config.json` tiene sheetId real (no `ID_DEL_GOOGLE_SHEET_DEL_CLIENTE`) | sheetId != placeholder | ☐ |
| 1.5 | Verificar que `config.json` tiene webhookGasUrl real (no `DEPLOY_ID`) | webhookGasUrl != placeholder | ☐ |

### FASE 2: Arranque del servidor

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 2.1 | Ejecutar `node server.js` | No muestra errores de sintaxis | ☐ |
| 2.2 | Consola muestra `[excel] Workbook creado/cargado` | Excel inicializado | ☐ |
| 2.3 | Consola muestra `[sync] Pulled: CONFIGURACION (N rows)` | Sync inicial exitoso | ☐ |
| 2.4 | Consola muestra `http://localhost:5000` | Servidor activo | ☐ |
| 2.5 | Chrome se abre automaticamente | Navegador abierto | ☐ |
| 2.6 | Se ve la pantalla de login (PIN) del CRM | Frontend cargado | ☐ |

### FASE 3: Autenticacion

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 3.1 | Ingresar PIN valido de un colaborador ACTIVO | Entra al Dashboard | ☐ |
| 3.2 | Ingresar PIN invalido (ej: `0000`) | Muestra error, no entra | ☐ |
| 3.3 | Ingresar PIN de colaborador INACTIVO | No deja entrar | ☐ |

### FASE 4: Lectura de datos (sin internet requerido)

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 4.1 | Dashboard muestra estadisticas | Numeros de clientes, citas del dia, etc. | ☐ |
| 4.2 | Seccion Clientes muestra la tabla de clientes | Lista con datos del Google Sheet | ☐ |
| 4.3 | Buscar un cliente por nombre | El filtro funciona | ☐ |
| 4.4 | Seccion Agenda muestra citas | Citas del dia o fecha seleccionada | ☐ |
| 4.5 | Cambiar fecha en Agenda | Muestra citas de otra fecha | ☐ |
| 4.6 | Seccion Servicios muestra catalogo | Lista de servicios con precios | ☐ |
| 4.7 | Seccion Equipo muestra colaboradores | Nombres y roles | ☐ |

### FASE 5: Escrituras locales

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 5.1 | Crear cliente nuevo (boton "Nuevo Cliente") | Toast "Cliente creado exitosamente", aparece en la tabla | ☐ |
| 5.2 | Verificar en Excel: abrir `data/beautyos.xlsx`, hoja CLIENTES | Fila nueva con el cliente creado | ☐ |
| 5.3 | Verificar en Excel: hoja SYNC_QUEUE | Fila con ACTION=createCliente, STATUS=PENDING | ☐ |
| 5.4 | Badge amarillo muestra "1" en la barra superior | Queue tiene 1 item pendiente | ☐ |
| 5.5 | Agendar cita manual (boton "Nueva Cita") | Toast "Cita agendada exitosamente", aparece en agenda | ☐ |
| 5.6 | Intentar agendar cita en horario fuera de jornada | Error "fuera del horario de atencion" | ☐ |
| 5.7 | Intentar agendar cita en conflicto con otra cita del mismo profesional | Error "ya tiene una cita" | ☐ |
| 5.8 | Cerrar cita (marcar como EJECUTADO) | Estado cambia a EJECUTADO | ☐ |
| 5.9 | Marcar cita como No Asistio (RECHAZADO) | Estado cambia a RECHAZADO | ☐ |
| 5.10 | Toggle "Exento anticipo" en un cliente | Checkbox cambia | ☐ |

### FASE 6: Sincronizacion

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 6.1 | Click boton sync (icono flechas circulares) | Icono gira, luego para | ☐ |
| 6.2 | Toast muestra "Datos sincronizados con la nube" | Sync exitoso | ☐ |
| 6.3 | Badge amarillo desaparece (0 pendientes) | Queue vacia | ☐ |
| 6.4 | `Sync: DD/MM/YYYY, HH:MM:SS` se actualiza | Timestamp actualizado | ☐ |
| 6.5 | Abrir Google Sheets del cliente en el navegador | El cliente creado en 5.1 aparece en la hoja CLIENTES | ☐ |
| 6.6 | La cita creada en 5.5 aparece en la hoja AGENDA | Datos sincronizados | ☐ |
| 6.7 | Esperar 5 minutos sin hacer nada | Consola muestra `[sync] Sync completo` automatico | ☐ |

### FASE 7: Modo offline

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 7.1 | Desconectar internet del PC (desactivar Wi-Fi / desconectar cable) | — | ☐ |
| 7.2 | Navegar por Clientes, Agenda, Servicios | Datos visibles (del Excel local) | ☐ |
| 7.3 | Crear un cliente nuevo sin internet | Toast exitoso, se guarda en Excel | ☐ |
| 7.4 | Agendar una cita sin internet | Valida disponibilidad local, se guarda | ☐ |
| 7.5 | Click boton sync | Toast "Sin conexion a internet" (warning) | ☐ |
| 7.6 | Punto indicador es rojo | Muestra offline | ☐ |
| 7.7 | Reconectar internet | — | ☐ |
| 7.8 | Click boton sync | Toast "Datos sincronizados" | ☐ |
| 7.9 | Verificar en Google Sheets | Cliente y cita creados offline ahora aparecen | ☐ |

### FASE 8: Features online-only (stubs)

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 8.1 | Ir a seccion Promociones | Se muestra vacia (sin error) | ☐ |
| 8.2 | Intentar crear promocion | Toast "Solo disponible con conexion a internet" | ☐ |
| 8.3 | Ir a seccion Novedades | Se muestra vacia | ☐ |
| 8.4 | Ir a seccion Solicitudes | Se muestra vacia | ☐ |
| 8.5 | Ir a Configuracion e intentar guardar | Toast "Solo disponible con conexion" | ☐ |

### FASE 9: Verificacion del Excel

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 9.1 | Abrir `data/beautyos.xlsx` mientras el servidor esta apagado | Abre sin error | ☐ |
| 9.2 | Hoja CONFIGURACION tiene datos (CLAVE, VALOR) | Llena con config del negocio | ☐ |
| 9.3 | Hoja CLIENTES tiene los mismos datos que Google Sheets | Datos sincronizados | ☐ |
| 9.4 | Hoja AGENDA tiene las citas | Datos sincronizados | ☐ |
| 9.5 | Hoja SYNC_QUEUE muestra items SYNCED/PENDING/FAILED | Cola visible | ☐ |
| 9.6 | Cerrar Excel y reiniciar el servidor | Arranca sin error, datos persisten | ☐ |

### FASE 10: Prueba de resistencia

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| 10.1 | Cerrar CMD (matar servidor) mientras navega el CRM | Chrome muestra error de conexion | ☐ |
| 10.2 | Reiniciar servidor (`start.bat`) | CRM se recupera, datos intactos | ☐ |
| 10.3 | Borrar `data/beautyos.xlsx` y reiniciar | Se recrea vacio, sync inicial descarga todo | ☐ |
| 10.4 | Crear cita desde el bot WhatsApp → esperar 5 min | Aparece en CRM Local | ☐ |
| 10.5 | Crear cliente desde CRM Local → esperar 5 min → verificar bot | Bot reconoce al cliente | ☐ |

---

## 11. Troubleshooting

### Error: "config.json no encontrado"
**Causa**: Falta el archivo config.json en la carpeta local-crm
**Solucion**: Verificar que config.json existe y tiene los valores correctos

### Error: "Cannot find module 'express'"
**Causa**: No se ejecuto `npm install`
**Solucion**: Abrir CMD en la carpeta y ejecutar `npm install`

### Error: "[sync] Credenciales no encontradas"
**Causa**: Falta el archivo `credenciales-google.json`
**Solucion**: Copiar el archivo de credenciales a la carpeta local-crm (ver seccion 3)

### Error: "[sync] Sin conexion. El CRM usara datos locales existentes"
**Causa**: No hay internet O las credenciales son invalidas O el Sheet no esta compartido
**Solucion**:
1. Verificar internet: abrir Chrome y navegar a Google
2. Verificar que el Google Sheet esta compartido con el email de la cuenta de servicio
3. Verificar que el sheetId en config.json es correcto

### El sync funciona pero los datos no aparecen en Google Sheets
**Causa**: El `webhookGasUrl` esta mal configurado o el deploy de GAS esta desactualizado
**Solucion**:
1. Verificar la URL en config.json
2. En Google Apps Script: Implementar → Gestionar implementaciones → verificar que hay un deploy activo
3. Hacer `clasp push && clasp deploy` si es necesario

### Puerto 5000 ocupado
**Causa**: Otro proceso usa el puerto 5000
**Solucion**: Cambiar `"port": 5001` en config.json

### Chrome no se abre automaticamente
**Causa**: El modulo `open` no funciona en todos los entornos
**Solucion**: Abrir Chrome manualmente y navegar a `http://localhost:5000`

### Error: "GAS retorno HTML en vez de JSON"
**Causa**: El deployment de Google Apps Script esta desactualizado
**Solucion**: Hacer `clasp push && clasp deploy` en el proyecto GAS correspondiente

### El Excel esta corrupto / no abre
**Causa**: Crash durante escritura
**Solucion**:
1. Cerrar el servidor
2. Borrar `data/beautyos.xlsx` y `data/beautyos.xlsx.tmp`
3. Reiniciar el servidor — se recrea y hace sync inicial

### Items FAILED en la cola de sync
**Causa**: El webhook GAS rechazo el dato (ej: celular duplicado, cita en conflicto)
**Solucion**:
1. Abrir `data/beautyos.xlsx`, hoja SYNC_QUEUE
2. Ver la columna SYNC_TIMESTAMP — contiene el mensaje de error
3. Los items FAILED no se reintentan automaticamente
4. Despues del proximo pull (sync), los datos de Google Sheets reemplazan los locales

---

## 12. Checklist por cliente nuevo

Usar esta lista cada vez que se instala el CRM Local en un nuevo cliente:

### Preparacion (tu PC)
- [ ] El Google Sheet del cliente existe y tiene las 7 hojas obligatorias
- [ ] El Sheet esta compartido con el email de la cuenta de servicio (Editor)
- [ ] Se tiene el Sheet ID (copiado de la URL)
- [ ] Se tiene el Webhook GAS URL (del deploy activo)
- [ ] Se tiene el archivo `credenciales-google.json`

### Configuracion
- [ ] `config.json` editado con el sheetId correcto
- [ ] `config.json` editado con el webhookGasUrl correcto
- [ ] `credenciales-google.json` copiado en la carpeta local-crm

### Instalacion (PC del cliente)
- [ ] Node.js instalado (`node --version` muestra v16+)
- [ ] Carpeta `local-crm/` copiada al PC
- [ ] `npm install` ejecutado sin errores
- [ ] `node server.js` arranca sin errores
- [ ] Sync inicial descarga datos (se ven en consola)
- [ ] Chrome se abre en `http://localhost:5000`
- [ ] Login con PIN funciona

### Validacion
- [ ] Dashboard muestra estadisticas correctas
- [ ] Clientes visibles en la seccion Clientes
- [ ] Agenda muestra citas del dia
- [ ] Crear cliente de prueba → aparece en tabla
- [ ] Sync manual → cliente aparece en Google Sheets
- [ ] Acceso directo creado en el Escritorio

### Entrega al cliente
- [ ] Explicar: doble clic en acceso directo para abrir
- [ ] Explicar: boton sync para sincronizar manualmente
- [ ] Explicar: funciona sin internet (datos locales)
- [ ] Explicar: cerrar ventana CMD para apagar
- [ ] Explicar: Promociones y Config solo disponibles en la version web
