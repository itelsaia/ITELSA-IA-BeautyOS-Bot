# DEMO BeautyOS - Datos de Configuracion

Entorno de demostracion reutilizable. Se cambian los datos en el Google Sheet segun el prospecto.

---

## IDs y URLs del Entorno Demo

| Campo | Valor |
|-------|-------|
| **Tenant ID** | `demo-beautyos` |
| **Instance Name (Evolution)** | `demo-beautyos` |
| **Google Sheet nombre** | `DEMO_BEAUTYOS` |
| **Sheet ID** | `1FYPscayUUApRptMbYfMPb0hEKzhxZ_gm7BDt_Ovks7A` |
| **URL Google Sheet** | https://docs.google.com/spreadsheets/d/1FYPscayUUApRptMbYfMPb0hEKzhxZ_gm7BDt_Ovks7A/edit |
| **Script ID (GAS)** | `1wcsK4CHso-qzIzz5vLp3MvAJPGzY8qDABV2JWYoXgtyp7f8AhsCPQ1B1` |
| **Deployment ID** | `AKfycbyOYj4lUTYTohz8pP2m5eU54oCRZ4CTmgVltqpfzmUlO61_Q2LdEUltXF20O3DweQV0` |
| **CRM Web App URL** | https://script.google.com/macros/s/AKfycbyOYj4lUTYTohz8pP2m5eU54oCRZ4CTmgVltqpfzmUlO61_Q2LdEUltXF20O3DweQV0/exec |
| **Service Account** | `bot-lector-excel@itelsa-beautyos.iam.gserviceaccount.com` |

---

## Como Preparar un Demo para un Nuevo Prospecto

### Paso 1: Editar hoja CONFIGURACION

Cambiar estos campos en el Google Sheet:

| CLAVE | Que poner |
|-------|-----------|
| NOMBRE_NEGOCIO | Nombre del negocio del prospecto |
| NOMBRE_AGENTE | Nombre del bot (ej: Caro, Luna, Bella, Sofi) |
| SALUDO_BASE | Saludo personalizado mencionando el nombre del bot y negocio |
| CELULAR_DUEÑA | Celular del prospecto (formato 573XXXXXXXXX) |
| CORREO_DUEÑA | Email del prospecto |
| COLOR_MARCA | Color hex del branding del prospecto |
| ENLACE_LOGO | URL del logo (subir a Google Drive como publico) |

Campos que NO se cambian entre demos:

| CLAVE | Valor fijo |
|-------|------------|
| ESTADO_SERVICIO | ACTIVO |
| CLAVE_OPENAI | (tu API key centralizada) |
| INTERVALO_SLOTS_MIN | 15 |
| TIEMPO_ENTRE_CITAS_MIN | 15 |
| MINUTOS_VENCIMIENTO_CITA | 30 |

### Paso 2: Editar hoja CONFIG_SERVICIOS

Borrar servicios anteriores y agregar los del prospecto:

| Columna | Descripcion |
|---------|-------------|
| ID_SERVICIO | Codigo unico (ej: CEJ-001, PES-001, COR-001) |
| INTENCION | Palabras clave separadas por coma que disparan el servicio |
| RESPUESTA_BASE | Descripcion del servicio con precio |
| TIEMPO_SERVICIO | Duracion en minutos |
| CATEGORIA | Categoria general (ej: Cejas, Pestañas, Cabello) |
| TIPO_SERVICIO | Nombre oficial del servicio (debe coincidir con COMPETENCIAS del colaborador) |

### Paso 3: Editar hoja COLABORADORES

Borrar anteriores y agregar equipo del prospecto:

| Columna | Descripcion |
|---------|-------------|
| ID_COLABORADOR | ADMIN-001, STAFF-001, etc. |
| NOMBRE | Nombre del colaborador |
| CELULAR | Formato 573XXXXXXXXX |
| ROL | ADMIN (dueña) o STAFF (empleada) |
| PIN | PIN de 4 digitos para acceso CRM |
| ESTADO | ACTIVO |
| COMPETENCIAS | Lista de TIPO_SERVICIO separados por coma SIN espacios (ej: Diseño de cejas,Extensiones de pestañas) |

### Paso 4: Editar hoja DISPONIBILIDAD

Borrar anterior y poner horarios del prospecto:

| Columna | Descripcion |
|---------|-------------|
| TIPO | Siempre `Jornada` para horario normal |
| FECHA_DIA | Lunes, Martes, Miercoles, etc. |
| HORA_INI | Hora inicio (formato HH:MM, ej: 09:00) |
| HORA_FIN | Hora fin (formato HH:MM, ej: 18:00) |
| MOTIVO | `Horario Base` |
| APLICA_A | `TODOS` (aplica a todo el equipo) |
| HORARIO | `DIARIO` |
| CATEGORIA | (dejar vacio) |

### Paso 5: Limpiar hojas de datos

Borrar datos (dejar solo headers) de:
- AGENDA
- CLIENTES
- CONOCIMIENTO (o agregar FAQ del prospecto)
- PROMOCIONES (o agregar promos del prospecto)

### Paso 6: Reiniciar el bot

```bash
# Si esta corriendo con PM2:
pm2 restart beautyos-bot

# Si esta corriendo local:
# Cerrar el proceso (Ctrl+C) y volver a iniciar
cd agent-bot && npm start
```

El bot re-sincroniza automaticamente al iniciar y carga los nuevos datos.

---

## Demo Actual: Carolina Leon - Cejas y Pestañas

### CONFIGURACION

| CLAVE | VALOR |
|-------|-------|
| ESTADO_SERVICIO | ACTIVO |
| CLAVE_OPENAI | sk-proj-... (centralizada) |
| NOMBRE_NEGOCIO | Carolina Leon - Cejas y Pestañas |
| NOMBRE_AGENTE | Caro |
| SALUDO_BASE | ¡Hola! Soy Caro, la asistente virtual de Carolina Leon. Estoy aqui para ayudarte a agendar tu cita de cejas o pestañas. ¿En que te puedo ayudar? |
| CELULAR_DUEÑA | 573142797807 (cambiar por el de Carolina) |
| CORREO_DUEÑA | admin@spa.com (cambiar por el de Carolina) |
| COLOR_MARCA | #E8B4B8 |
| INTERVALO_SLOTS_MIN | 15 |
| TIEMPO_ENTRE_CITAS_MIN | 15 |
| MINUTOS_VENCIMIENTO_CITA | 30 |

### CONFIG_SERVICIOS (ejemplo para cejas y pestañas)

| ID_SERVICIO | INTENCION | RESPUESTA_BASE | TIEMPO | CATEGORIA | TIPO_SERVICIO |
|-------------|-----------|----------------|--------|-----------|---------------|
| CEJ-001 | cejas, diseño cejas, arreglo cejas, depilacion cejas, perfilado | Diseño y perfilado profesional de cejas con tecnica personalizada. | 30 | Cejas | Diseño de cejas |
| PES-001 | pestañas, extensiones pestañas, pelo a pelo | Extensiones de pestañas pelo a pelo con materiales premium. | 90 | Pestañas | Extensiones de pestañas |
| PES-002 | lifting, lifting pestañas, laminado | Lifting y laminado de pestañas para una mirada natural. | 60 | Pestañas | Lifting de pestañas |

### COLABORADORES (dueña unica)

| ID_COLABORADOR | NOMBRE | CELULAR | ROL | PIN | ESTADO | COMPETENCIAS |
|----------------|--------|---------|-----|-----|--------|-------------|
| ADMIN-001 | Carolina | 573XXXXXXXXX | ADMIN | 1234 | ACTIVO | Diseño de cejas,Extensiones de pestañas,Lifting de pestañas |

### DISPONIBILIDAD (ejemplo L-V 9-18, Sab 8-14)

| TIPO | FECHA_DIA | HORA_INI | HORA_FIN | MOTIVO | APLICA_A | HORARIO |
|------|-----------|----------|----------|--------|----------|---------|
| Jornada | Lunes | 09:00 | 18:00 | Horario Base | TODOS | DIARIO |
| Jornada | Martes | 09:00 | 18:00 | Horario Base | TODOS | DIARIO |
| Jornada | Miercoles | 09:00 | 18:00 | Horario Base | TODOS | DIARIO |
| Jornada | Jueves | 09:00 | 18:00 | Horario Base | TODOS | DIARIO |
| Jornada | Viernes | 09:00 | 18:00 | Horario Base | TODOS | DIARIO |
| Jornada | Sabado | 08:00 | 14:00 | Horario Sabado | TODOS | DIARIO |

---

## Comandos Utiles

```bash
# Levantar entorno local
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\evolution-api" && npm start
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\agent-bot" && npm start

# Evolution Manager
http://localhost:8080/manager

# CRM Web App del Demo
https://script.google.com/macros/s/AKfycbyOYj4lUTYTohz8pP2m5eU54oCRZ4CTmgVltqpfzmUlO61_Q2LdEUltXF20O3DweQV0/exec

# Actualizar GAS despues de cambios en Backend.gs
cd crm-webapp
cp .clasp.json .clasp.json.backup
echo '{"scriptId":"1wcsK4CHso-qzIzz5vLp3MvAJPGzY8qDABV2JWYoXgtyp7f8AhsCPQ1B1","rootDir":"src"}' > .clasp.json
npx clasp push --force && npx clasp deploy -i AKfycbyOYj4lUTYTohz8pP2m5eU54oCRZ4CTmgVltqpfzmUlO61_Q2LdEUltXF20O3DweQV0 -d "update"
cp .clasp.json.backup .clasp.json
```

---

## Historial de Demos

| # | Fecha | Prospecto | Estado |
|---|-------|-----------|--------|
| 1 | 2026-03-12 | Carolina Leon - Cejas y Pestañas | Demo local funcionando |

---

## Registro de Clientes (Futuro Google Workspace)

Cuando tengas Google Workspace, migrar este registro a un Sheet centralizado.

| # | Cliente | Tenant ID | Sheet ID | Deployment ID | WhatsApp | Estado | Fecha Alta |
|---|---------|-----------|----------|---------------|----------|--------|------------|
| 1 | Carolina Leon - Cejas y Pestañas | demo-beautyos | 1FYPscayUUApRptMbYfMPb0hEKzhxZ_gm7BDt_Ovks7A | AKfycbyOYj4lUTYTohz8pP2m5eU54oCRZ4CTmgVltqpfzmUlO61_Q2LdEUltXF20O3DweQV0 | 573XXXXXXXXX | Demo | 2026-03-12 |

### Datos por Cliente

**Cliente 1: Carolina Leon**
- Negocio: Carolina Leon - Cejas y Pestañas
- Contacto: carolinaleon@gmail.com
- Bot: Caro
- Servicios: Diseño de cejas, Extensiones de pestañas, Lifting de pestañas
- Horario: L-V 9:00-18:00, Sab 8:00-14:00
- CRM: https://script.google.com/macros/s/AKfycbyOYj4lUTYTohz8pP2m5eU54oCRZ4CTmgVltqpfzmUlO61_Q2LdEUltXF20O3DweQV0/exec

---

## Infraestructura de Produccion

| Componente | Local (Desarrollo) | Produccion (VPS) |
|------------|-------------------|------------------|
| Evolution API | localhost:8080 | IP_VPS:8080 |
| Bot (Express) | localhost:3000 | IP_VPS:3000 |
| Webhook URL | localhost:3000/webhook/evolution | IP_VPS:3000/webhook/evolution |
| Process Manager | manual (node) | PM2 (auto-restart) |
| Evolution Manager | localhost:8080/manager | IP_VPS:8080/manager |
