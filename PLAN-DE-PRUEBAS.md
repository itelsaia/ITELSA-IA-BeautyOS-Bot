# BeautyOS - Plan de Pruebas Pre-Produccion

> **Proyecto:** BeautyOS SaaS para Peluquerias y SPAs
> **Version:** 2.0 (Evolution API)
> **Fecha:** Marzo 2026
> **Objetivo:** Validar TODAS las funcionalidades antes de ofrecer la herramienta a clientes

---

## Como Usar Este Documento

- Cada prueba tiene un checkbox `[ ]` — marcalo como `[x]` cuando pase
- **Prioridad:** CRITICA > ALTA > MEDIA > BAJA
- Si una prueba falla, documenta el error en la columna "Notas"
- Ejecuta las pruebas en el orden de las secciones (dependencias van primero)
- Usa el entorno **DEMO_BEAUTYOS** para pruebas, NO produccion

---

## Requisitos Previos

- [ ] Google Sheet DEMO tiene todas las hojas creadas (Setup.gs ejecutado)
- [ ] Evolution API corriendo (local o servidor)
- [ ] Bot conectado a WhatsApp (QR escaneado)
- [ ] CRM Web App desplegado y accesible
- [ ] Al menos 1 colaborador ADMIN y 1 STAFF en hoja COLABORADORES
- [ ] Al menos 2 servicios configurados en hoja SERVICIOS
- [ ] Horarios base configurados en hoja DISPONIBILIDAD
- [ ] Al menos 1 promocion activa configurada

---

## MODULO 1: Autenticacion y Acceso (CRITICA)

### 1.1 Login con PIN

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ingresar PIN correcto de ADMIN | Login exitoso, mensaje de bienvenida animado, redirige a Dashboard | |
| [ ] | Ingresar PIN correcto de STAFF | Login exitoso, mensaje de bienvenida, redirige a Mi Agenda | |
| [ ] | Ingresar PIN incorrecto | Dots se ponen rojos, shake animation, mensaje "PIN incorrecto" | |
| [ ] | Verificar que el saludo sea correcto segun hora (Buenos dias/tardes/noches) | Saludo corresponde a la hora actual | |
| [ ] | Verificar frase motivadora aleatoria en bienvenida | Aparece una frase diferente cada vez | |
| [ ] | Refrescar pagina con sesion activa | No muestra bienvenida, va directo al dashboard/miagenda | |
| [ ] | Cerrar sesion y volver a entrar | Muestra login con numpad | |

### 1.2 Control de Roles

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | ADMIN: Ve sidebar completo | Dashboard, Novedades, Solicitudes, Agenda, Clientes, Equipo, Servicios, Promociones, Horarios, Analisis, Config | |
| [ ] | ADMIN: NO ve "Mi Agenda" en sidebar | Link oculto para admin | |
| [ ] | STAFF: Solo ve Mi Agenda, Novedades, Solicitudes | Demas opciones ocultas | |
| [ ] | STAFF: Intentar navegar a pagina admin (URL directa) | Redirige a Mi Agenda | |

---

## MODULO 2: Bot WhatsApp - Onboarding (CRITICA)

### 2.1 Registro de Cliente Nuevo

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Enviar mensaje desde numero nuevo | Bot pide nombre completo | |
| [ ] | Enviar nombre | Bot pide correo electronico | |
| [ ] | Enviar correo valido | Bot pide fecha de cumpleanos | |
| [ ] | Enviar cumpleanos formato DD/MM | Bot pide direccion/barrio | |
| [ ] | Enviar cumpleanos formato "15 de marzo" | Bot acepta formato texto | |
| [ ] | Enviar direccion | Bot confirma registro y saluda con menu de opciones | |
| [ ] | Verificar en Google Sheet CLIENTES | Cliente aparece con todos los datos correctos | |
| [ ] | Enviar nuevo mensaje desde mismo numero | Bot reconoce como cliente registrado, NO pide datos otra vez | |

### 2.2 Saludo a Cliente Existente

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Cliente existente escribe "Hola" | Bot saluda con nombre, muestra citas pendientes si hay, muestra promos activas | |
| [ ] | Verificar saludo segun hora del dia | Buenos dias/tardes/noches correcto | |
| [ ] | Cliente con cita pendiente | Saludo muestra detalle de la cita (fecha, hora, servicio) | |

---

## MODULO 3: Bot WhatsApp - Agendamiento (CRITICA)

### 3.1 Agendar Cita Nueva

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Pedir cita para servicio existente | Bot consulta disponibilidad y ofrece horarios | |
| [ ] | Pedir cita con profesional especifico | Bot filtra disponibilidad por competencias del profesional | |
| [ ] | Pedir cita para dia sin disponibilidad | Bot informa que no hay horarios y sugiere otro dia | |
| [ ] | Pedir cita para dia festivo (si esta cerrado) | Bot informa que es festivo | |
| [ ] | Confirmar una cita propuesta | Bot confirma con resumen (fecha, hora, servicio, profesional, precio) | |
| [ ] | Verificar en Google Sheet AGENDA | Cita aparece con estado PENDIENTE y todos los campos correctos | |
| [ ] | Verificar ID auto-generado | Formato AG-XX-001 correcto | |

### 3.2 Anticipo / Pago

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Agendar servicio CON anticipo requerido | Bot pide comprobante de pago | |
| [ ] | Enviar foto de comprobante | Bot analiza con Vision API y confirma | |
| [ ] | Agendar servicio SIN anticipo | Bot confirma cita sin pedir pago | |
| [ ] | Cliente exento de anticipo agenda servicio con anticipo | No pide comprobante | |

### 3.3 Reagendar Cita

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Pedir reagendar cita pendiente | Bot muestra cita actual y pide nueva fecha/hora | |
| [ ] | Reagendar cita con promo DIA FIJO | Bot advierte que pierde el descuento si cambia de dia | |
| [ ] | Confirmar reagendamiento | Cita original → CANCELADA, nueva cita → PENDIENTE | |
| [ ] | Verificar notas en cita cancelada | Nota dice "[Reagendamiento - Antes: fecha/hora]" | |

### 3.4 Cancelar Cita

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Pedir cancelar cita | Bot pide confirmacion | |
| [ ] | Confirmar cancelacion | Estado cambia a CANCELADA en Sheet | |

### 3.5 Promociones via Bot

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Agendar con promo porcentaje activa | Precio con descuento correcto | |
| [ ] | Agendar con promo 2x1 | Bot aplica 2x1 correctamente | |
| [ ] | Agendar con promo de dia fijo en dia incorrecto | Bot informa que la promo es solo para ese dia | |
| [ ] | Verificar limite de uso de promo por cliente | Si llego al limite, no aplica promo | |

---

## MODULO 4: Bot WhatsApp - Mensajes Automaticos (ALTA)

### 4.1 Recordatorios de Cita

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Cita en X minutos (segun MINUTOS_RECORDATORIO) | Bot envia recordatorio con servicio, hora y profesional | |
| [ ] | Verificar que solo envia 1 recordatorio por cita | No duplicados | |
| [ ] | Cambiar MINUTOS_RECORDATORIO en config | Nuevo timing se aplica en siguiente sync (5 min) | |

### 4.2 Cumpleanos

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Cliente cumple hoy | Bot envia felicitacion con promo de cumpleanos | |
| [ ] | Verificar que no envia duplicado al mismo cliente | Solo 1 mensaje por dia | |

### 4.3 Difusion de Promociones

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Promo con difusion activa y horario programado | Bot envia a clientes registrados | |
| [ ] | Verificar respeto de limites anti-bloqueo | Max 50/dia, delays 5-8s, max 20/promo | |

---

## MODULO 5: Bot WhatsApp - Multimedia (MEDIA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Pedir info de un servicio con galeria | Bot envia fotos/videos del servicio | |
| [ ] | Enviar audio al bot | Bot transcribe y responde al contenido del audio | |
| [ ] | Enviar imagen (no comprobante) | Bot analiza imagen segun contexto | |

---

## MODULO 6: CRM - Dashboard Admin (ALTA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Dashboard muestra KPIs correctos | Total citas, pendientes, ejecutadas, promos activas, clientes | |
| [ ] | Tabla ultimas citas muestra datos reales | Datos coinciden con Sheet AGENDA | |
| [ ] | Badge de agenda muestra conteo pendientes | Numero correcto de citas PENDIENTE + REAGENDADO | |

---

## MODULO 7: CRM - Agenda Admin (CRITICA)

### 7.1 Vista y Filtros

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver todas las citas en tabla | Todas las citas del Sheet se muestran | |
| [ ] | Summary cards muestran conteo correcto | Total, Pendientes, Ejecutadas, Reagendadas, Canceladas, Rechazadas | |
| [ ] | Filtrar por fecha (calendario) | Solo muestra citas de esa fecha | |
| [ ] | Filtrar por profesional | Solo muestra citas del profesional seleccionado | |
| [ ] | Filtrar por estado (click en summary card) | Solo muestra citas de ese estado | |
| [ ] | Buscar por texto | Busca en cliente, servicio, ID, fecha | |
| [ ] | Combinar filtro fecha + profesional + estado | Filtros se aplican en conjunto | |
| [ ] | Limpiar filtro fecha (dejar vacio) | Muestra todas las fechas | |

### 7.2 Acciones sobre Citas

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Cerrar cita (boton verde) | Modal de cierre aparece | |
| [ ] | Confirmar cierre de cita | Estado → EJECUTADO, WhatsApp de agradecimiento enviado | |
| [ ] | Marcar "No asistio" | Modal de confirmacion bonito, Estado → RECHAZADO | |
| [ ] | Eliminar cita CANCELADA | Modal de confirmacion con datos, cita eliminada del Sheet | |
| [ ] | Eliminar cita EJECUTADA | Modal de confirmacion, eliminacion correcta | |
| [ ] | Verificar que NO hay boton eliminar en citas PENDIENTE | Solo Cerrar y No asistio | |

---

## MODULO 8: CRM - Mi Agenda Staff (ALTA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | STAFF ve solo SUS citas | Filtrado por nombre del profesional logueado | |
| [ ] | Cards muestran hora, cliente, celular (click-to-call), servicio, precio | Datos correctos | |
| [ ] | Badge resumen: pendientes, cerradas, canceladas, total, $ del dia | Conteos y suma correctos | |
| [ ] | Mini-cards por servicio | Ej: "Cejas: 3 | Pestanas: 2" | |
| [ ] | Cambiar fecha | Muestra citas de la fecha seleccionada | |
| [ ] | Boton cerrar cita desde Mi Agenda | Funciona igual que en Agenda admin | |
| [ ] | Notas de cita visibles | Si hay notas, aparecen en italica | |

---

## MODULO 9: CRM - Clientes (ALTA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver lista de todos los clientes | Tabla con ID, nombre, celular, correo, cumple, tipo, anticipo | |
| [ ] | Buscar cliente por nombre o celular | Filtro funciona en tiempo real | |
| [ ] | Toggle exento de anticipo | Cambia estado y se refleja en Sheet | |
| [ ] | Clasificacion automatica (Ocasional/Frecuente/VIP) | Segun umbrales en configuracion | |

---

## MODULO 10: CRM - Equipo (ALTA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver lista de colaboradores | Tabla con nombre, celular, rol, PIN, estado, competencias | |
| [ ] | Crear nuevo colaborador | Modal con campos, guarda en Sheet con ID auto | |
| [ ] | Editar colaborador existente | Modal pre-llenado, actualiza Sheet | |
| [ ] | Eliminar colaborador | Confirmacion bonita, elimina de Sheet | |
| [ ] | Asignar competencias multiples | Checkboxes de servicios, se guardan separados por coma | |
| [ ] | Asignar PIN unico | PIN no repetido entre colaboradores | |

---

## MODULO 11: CRM - Servicios (ALTA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver catalogo de servicios | Cards con nombre, precio, duracion, estado | |
| [ ] | Crear nuevo servicio | Modal con campos, guarda correctamente | |
| [ ] | Editar servicio | Modal pre-llenado, actualiza | |
| [ ] | Eliminar servicio | Confirmacion, elimina | |
| [ ] | Configurar anticipo (activar/desactivar, %) | Campos visibles segun toggle | |
| [ ] | Galeria multimedia por servicio | Agregar/ver/eliminar fotos y videos | |

---

## MODULO 12: CRM - Promociones (ALTA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver lista de promociones | Cards con nombre, tipo, descuento, estado | |
| [ ] | Crear promo tipo porcentaje | Guarda con descuento correcto | |
| [ ] | Crear promo tipo 2x1 | Guarda correctamente | |
| [ ] | Crear promo tipo dia fijo | Guarda con dia especificado | |
| [ ] | Activar/Desactivar promo | Toggle de estado funciona | |
| [ ] | Promo con fecha de vencimiento | Se desactiva automaticamente si vence | |
| [ ] | Difusion: configurar horario y mensaje | Campos de difusion visibles y guardables | |

---

## MODULO 13: CRM - Horarios y Disponibilidad (ALTA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver horario base por dia | Tabla con dias habilitados y horarios | |
| [ ] | Editar horario de un dia | Cambiar hora inicio/fin, guardar | |
| [ ] | Desactivar un dia completo | Toggle off, dia no disponible para agendamiento | |
| [ ] | Crear bloqueo de horario | Modal con profesional, fecha, hora desde/hasta, motivo | |
| [ ] | Crear bloqueo todo el dia | Toggle "Todo el dia" funciona | |
| [ ] | Crear bloqueo por rango de fechas | Fecha desde y hasta | |
| [ ] | Eliminar bloqueo | Confirmacion bonita, elimina | |
| [ ] | Limpiar bloqueos vencidos (toast) | Toast aparece si hay vencidos, boton limpia correctamente | |
| [ ] | Festivos: ver calendario del ano | Festivos colombianos generados | |
| [ ] | Festivos: marcar como abierto con horario especial | Toggle + horarios personalizados | |

---

## MODULO 14: CRM - Novedades (MEDIA)

### 14.1 Vista STAFF

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver solo MIS novedades | Filtrado por nombre del staff logueado | |
| [ ] | Crear novedad tipo "Insumo" | Modal con dropdown, texto de ayuda cambia segun tipo | |
| [ ] | Crear novedad tipo "Equipo" | Guarda correctamente con estado ABIERTO | |
| [ ] | Ver respuesta del admin en novedad cerrada | Bloque verde con respuesta visible | |
| [ ] | Empty state sin novedades | Mensaje "No has reportado novedades" | |

### 14.2 Vista ADMIN

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver TODAS las novedades de todos | Sin filtro de nombre | |
| [ ] | Filtrar por estado (Abierto/Cerrado) | Filtro funciona | |
| [ ] | Filtrar por profesional | Dropdown con nombres | |
| [ ] | Cerrar novedad con respuesta | Modal con resumen, textarea, estado → CERRADO | |
| [ ] | Eliminar novedad cerrada | Confirmacion bonita con detalle, elimina de Sheet | |
| [ ] | Formato de fechas legible | DD/MM/YYYY y HH:mm, no raw Date | |

---

## MODULO 15: CRM - Solicitudes (MEDIA)

### 15.1 Vista STAFF

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver solo MIS solicitudes | Filtrado por nombre | |
| [ ] | Crear solicitud tipo "Permiso" | Campos fecha desde/hasta y horas aparecen | |
| [ ] | Crear solicitud tipo "Vacaciones" | Campos fecha aparecen | |
| [ ] | Crear solicitud tipo "Cambio Horario" | Sin campos de fecha | |
| [ ] | Verificar estado PENDIENTE inicial | Badge amarillo | |
| [ ] | Ver motivo de rechazo | Si NO APROBADO, muestra motivo en rojo | |
| [ ] | Ver solicitud aprobada | Badge verde "APROBADO" | |

### 15.2 Vista ADMIN

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver TODAS las solicitudes | Sin filtro de nombre | |
| [ ] | Filtrar por estado | PENDIENTE/APROBADO/NO APROBADO/Todos | |
| [ ] | Filtrar por profesional | Dropdown funciona | |
| [ ] | Aprobar solicitud | Confirmacion bonita con detalle, estado → APROBADO | |
| [ ] | Rechazar solicitud con motivo | Modal con textarea, estado → NO APROBADO | |
| [ ] | Rechazar solicitud sin motivo (opcional) | Acepta sin motivo | |

---

## MODULO 16: CRM - Analisis (MEDIA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Graficas se renderizan sin errores | 6 graficas visibles: estado, profesional, dias, horas, tendencia, servicios | |
| [ ] | KPIs calculados correctamente | Comparar con datos del Sheet | |
| [ ] | Filtrar por rango de meses | Datos se actualizan | |
| [ ] | Filtrar por profesional | Graficas reflejan solo ese profesional | |
| [ ] | Tabla de rendimiento profesional | Datos coinciden con agendamiento real | |

---

## MODULO 17: CRM - Configuracion (ALTA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Ver configuracion actual | Campos pre-llenados con valores del Sheet | |
| [ ] | Editar nombre del negocio | Guarda y se refleja en header | |
| [ ] | Editar mensaje de agradecimiento | Textarea editable, guarda correctamente | |
| [ ] | Editar mensaje de recordatorio | Textarea editable con variables {cliente}, {servicio}, etc. | |
| [ ] | Editar minutos de recordatorio | Input numerico, guarda en Sheet | |
| [ ] | Editar umbrales de clasificacion | Ocasional/Frecuente/VIP cambian | |
| [ ] | Guardar configuracion | Toast "Configuracion guardada", datos persisten al recargar | |

---

## MODULO 18: Modales de Confirmacion (MEDIA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Todas las confirmaciones usan modal Bootstrap (no alert nativo) | Modal centrado con titulo, mensaje y botones | |
| [ ] | Modal eliminar cita muestra cliente y servicio | Datos correctos en el body | |
| [ ] | Modal "No asistio" muestra detalle de cita | Nombre, servicio, fecha | |
| [ ] | Modal aprobar solicitud muestra resumen | Staff, tipo, descripcion | |
| [ ] | Boton Cancelar cierra modal sin accion | Sin efecto secundario | |
| [ ] | Colores de botones correctos | Rojo=eliminar, Verde=aprobar, Amarillo=advertencia | |

---

## MODULO 19: Multi-Tenant (ALTA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Bot atiende al tenant correcto | Mensajes van al Sheet correcto | |
| [ ] | Sync de datos cada 5 minutos | Cambios en Sheet se reflejan en bot despues de 5 min | |
| [ ] | Configuracion por tenant independiente | Cambiar config en un tenant no afecta otro | |

---

## MODULO 20: Integracion WhatsApp ↔ CRM (CRITICA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | Cita agendada por bot aparece en CRM Agenda | Datos identicos | |
| [ ] | Cita cerrada desde CRM envia WhatsApp | Mensaje de agradecimiento llega al cliente | |
| [ ] | Recordatorio se envia segun minutos configurados | Timing correcto | |
| [ ] | Cambios en servicios/precios se reflejan en bot | Despues del sync (5 min) | |
| [ ] | Cambios en horarios se reflejan en bot | Disponibilidad actualizada | |
| [ ] | Bloqueo creado en CRM impide agendamiento por bot | Bot no ofrece esos horarios | |

---

## MODULO 21: Responsive y UX (BAJA)

| # | Prueba | Resultado Esperado | Notas |
|---|--------|--------------------|-------|
| [ ] | CRM en desktop (1920px) | Layout completo, sidebar visible | |
| [ ] | CRM en tablet (768px) | Sidebar colapsable, tablas con scroll horizontal | |
| [ ] | CRM en movil (375px) | Sidebar oculto, toggle funciona, cards se apilan | |
| [ ] | Click-to-call en celular funciona | Link tel: abre app de llamadas | |
| [ ] | Toast notifications visibles y se auto-cierran | 4 segundos, posicion correcta | |

---

## Resumen de Ejecucion

| Modulo | Total Pruebas | Pasaron | Fallaron | Pendientes |
|--------|:---:|:---:|:---:|:---:|
| 1. Autenticacion | 11 | | | |
| 2. Onboarding Bot | 8 | | | |
| 3. Agendamiento Bot | 17 | | | |
| 4. Mensajes Automaticos | 6 | | | |
| 5. Multimedia Bot | 3 | | | |
| 6. Dashboard | 3 | | | |
| 7. Agenda Admin | 14 | | | |
| 8. Mi Agenda Staff | 7 | | | |
| 9. Clientes | 4 | | | |
| 10. Equipo | 6 | | | |
| 11. Servicios | 6 | | | |
| 12. Promociones | 7 | | | |
| 13. Horarios | 10 | | | |
| 14. Novedades | 11 | | | |
| 15. Solicitudes | 13 | | | |
| 16. Analisis | 5 | | | |
| 17. Configuracion | 7 | | | |
| 18. Modales | 6 | | | |
| 19. Multi-Tenant | 3 | | | |
| 20. Integracion | 6 | | | |
| 21. Responsive | 5 | | | |
| **TOTAL** | **158** | | | |

---

## Consejos Para Tu Primera Puesta en Produccion

### Antes de ofrecer a clientes:

1. **Ejecuta TODAS las pruebas CRITICAS primero** — Si alguna falla, no avances. Los modulos 1, 2, 3, 7 y 20 son los que el cliente usara desde el dia 1.

2. **Prueba con datos reales** — Crea servicios, precios y horarios reales del primer cliente. Los datos de prueba a veces ocultan bugs de formato.

3. **Prueba el flujo completo** — Simula ser un cliente real: enviar "Hola" por WhatsApp → agendar → recibir recordatorio → el admin cierra la cita → recibir agradecimiento. Este flujo de punta a punta es el mas importante.

4. **Prueba en horario real** — Los recordatorios y cumpleanos dependen de la hora. Prueba cuando falte 1 hora para una cita real.

5. **Prueba con 2 personas** — Tu como admin en el CRM, otra persona como cliente en WhatsApp. Esto simula el uso real.

### Durante los primeros dias en produccion:

6. **Monitorea los logs** — `pm2 logs beautyos-bot` en el servidor muestra errores en tiempo real.

7. **Revisa el Sheet diariamente** — Verifica que las citas se registren correctamente, que los IDs sean consecutivos, que no haya datos duplicados.

8. **Ten un plan B** — Si el bot falla, el admin puede agendar citas manualmente desde el Sheet. El CRM sigue funcionando independientemente del bot.

9. **Empieza con 1 solo cliente** — No ofrezcas a 5 peluquerias al tiempo. Estabiliza con 1 primero, resuelve lo que salga, y luego escala.

10. **Documenta los bugs** — Cuando algo falle, anota: que paso, a que hora, que hizo el usuario. Esto te ayuda a reproducir y arreglar mas rapido.

### Checklist de lanzamiento:

- [ ] Todas las pruebas CRITICAS pasaron
- [ ] Todas las pruebas ALTA pasaron
- [ ] Servidor GCP corriendo estable (pm2 status ok)
- [ ] Evolution API conectada y estable
- [ ] Google Sheets con datos reales del cliente
- [ ] CRM desplegado con branding del cliente (logo, nombre, colores)
- [ ] PIN de admin configurado y entregado al cliente
- [ ] PIN de cada estilista configurado
- [ ] Horarios base configurados
- [ ] Servicios con precios reales
- [ ] Al menos 1 promo de prueba activa
- [ ] Backup del Sheet (descargar como Excel antes de arrancar)
- [ ] Whatsapp del admin del negocio anotado para soporte

---

> **Nota:** Este documento es un artefacto vivo. Actualizalo cada vez que agregues funcionalidades nuevas o encuentres escenarios que no estaban cubiertos.
