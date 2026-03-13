# Plan de Implementacion: Audios WhatsApp + Dashboard Analytics

## MEJORA 1: Entender Audios de WhatsApp (Whisper)

### Objetivo
Cuando un cliente envie un audio por WhatsApp, el bot lo transcribe automaticamente y procesa el texto como si lo hubiera escrito. Los flujos de agendamiento, reagendamiento, cancelacion y consultas funcionan igual.

### Archivos a modificar

**1. `agent-bot/src/services/whisper.js` (NUEVO)**
- Servicio que recibe un buffer/URL de audio y retorna texto transcrito
- Usa OpenAI Whisper API (`openai.audio.transcriptions.create`)
- Soporta formatos: ogg/opus (el formato nativo de WhatsApp)
- Toma la API key de OpenAI de la config del tenant

**2. `agent-bot/src/services/evolution.js` (MODIFICAR)**
- Agregar metodo `getMediaBase64(instanceName, messageId)` que descarga el audio del mensaje via Evolution API
- Endpoint: `GET /chat/getBase64FromMediaMessage/{instanceName}` con body `{ message: { key: {...} } }`

**3. `agent-bot/src/routes/webhook.js` (MODIFICAR)**
- Linea 52-56: Actualmente extrae solo texto y descarta mensajes no-texto (`if (!messageText) return`)
- Cambiar para detectar mensajes de audio (`data.message?.audioMessage`)
- Si es audio: descargar via Evolution API → transcribir con Whisper → usar el texto transcrito como `messageText`
- El resto del flujo (onboarding, IA, confirmaciones) funciona identico con el texto transcrito
- Agregar log: `[instanceName] Audio de [phone]: (transcripcion)`

### Flujo tecnico detallado

```
1. WhatsApp envia audio → Evolution API recibe
2. Webhook detecta: data.message.audioMessage existe
3. Descarga audio: evolutionClient.getMediaBase64(instance, messageId)
4. Transcribe: whisper.transcribe(base64Audio, config.openApiKey)
5. messageText = transcripcion
6. Continua flujo normal (linea 59 en adelante)
```

### Consideraciones
- El audio de WhatsApp viene en formato OGG/Opus - Whisper lo soporta nativamente
- Si la transcripcion falla, enviar mensaje amigable: "No pude entender tu audio, podrias escribirme por favor?"
- La transcripcion se logea en consola para debugging
- No se guarda el audio, solo el texto transcrito entra al historial de sesion

---

## MEJORA 2: Dashboard de Analytics en CRM Web App

### Objetivo
Nueva seccion "Analisis" en el CRM Web App con graficas interactivas que muestren metricas de rendimiento del negocio: citas por estado, por profesional, dias/horas de mayor demanda, tendencias, y dias muertos.

### Archivos a modificar

**1. `crm-webapp/src/Backend.gs` (MODIFICAR)**
- Agregar funcion `getAnalytics()` que retorna datos pre-procesados desde la hoja AGENDA
- Calcula y retorna:
  - `byStatus`: conteo por estado (EJECUTADO, RECHAZADO, CANCELADA, PENDIENTE, REAGENDADO)
  - `byProfessional`: por profesional → {total, ejecutadas, rechazadas, canceladas, ingresos}
  - `byDayOfWeek`: por dia de semana → {total, ejecutadas} (detectar dias muertos)
  - `byService`: por servicio → {total, ingresos}
  - `byMonth`: tendencia mensual → {total, ingresos, nuevosClientes}
  - `byHour`: por franja horaria → conteo (detectar horas pico)
  - `kpis`: tasa cumplimiento, ticket promedio, tasa cancelacion, tasa reagendamiento

**2. `crm-webapp/src/index.html` (MODIFICAR)**
- Agregar Chart.js via CDN (libreria ligera de graficas)
- Agregar item "Analisis" en el sidebar de navegacion (seccion "Negocio", con icono chart)
- Agregar funcion `renderAnalisis()` que muestra:

  **Fila 1 - KPIs (4 tarjetas)**
  - Total citas | Tasa de cumplimiento (%) | Ticket promedio ($) | Tasa cancelacion (%)

  **Fila 2 - Graficas principales (2 columnas)**
  - Columna 1: Doughnut chart "Citas por Estado" (5 colores por estado)
  - Columna 2: Bar chart horizontal "Rendimiento por Profesional" (ejecutadas vs rechazadas/canceladas)

  **Fila 3 - Demanda temporal (2 columnas)**
  - Columna 1: Bar chart "Citas por Dia de Semana" (resaltar dias muertos en rojo)
  - Columna 2: Bar chart "Citas por Franja Horaria" (horas pico vs muertas)

  **Fila 4 - Tendencia y servicios (2 columnas)**
  - Columna 1: Line chart "Tendencia Mensual" (citas + ingresos ultimos 6 meses)
  - Columna 2: Bar chart horizontal "Servicios mas Populares" (top 5 por cantidad)

- Agregar filtro de rango de fechas (ultimo mes / ultimos 3 meses / ultimos 6 meses / todo)
- Estilo consistente con el resto del CRM (colores Bootstrap + brand pink #E91E63)

### Datos de la hoja AGENDA que se usan
| Columna | Uso en Analytics |
|---------|-----------------|
| FECHA | Filtro por rango, tendencia mensual, dia de semana |
| TIPO_DIA | Citas por dia de semana |
| INICIO | Citas por franja horaria |
| SERVICIO | Servicios mas populares |
| PRECIO | Ingresos, ticket promedio |
| PROFESIONAL | Rendimiento por profesional |
| ESTADO | KPIs, distribucion de estados |

### Consideraciones
- Chart.js se carga via CDN (no necesita npm)
- Los datos se calculan en Backend.gs (server-side) para no sobrecargar el frontend con iteraciones pesadas
- El filtro de fechas re-invoca `getAnalytics(rango)` y redibuja los charts
- Los colores de los charts usan el mismo esquema de badges del CRM (EJECUTADO=verde, RECHAZADO=rojo, etc.)
- Los "dias muertos" se resaltan visualmente (color rojo/gris) para que la peluqueria identifique cuando promocionar

---

## Orden de implementacion

1. **Whisper (audios)** — mas rapido, ~3 archivos, impacto inmediato para el demo
2. **Analytics (dashboard)** — mas extenso, Backend.gs + index.html con graficas

## Costos estimados

| Componente | Costo mensual |
|-----------|--------------|
| Whisper API (transcripcion) | ~$0.30 - $1.50/mes |
| Chart.js CDN | $0 (gratuito) |
| Backend.gs analytics | $0 (ya incluido en GAS) |
| **TOTAL** | **~$0.30 - $1.50/mes** |
