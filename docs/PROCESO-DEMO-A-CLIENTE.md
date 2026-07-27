# Proceso demo → cliente activo que factura

## 1. Principio

Una venta no consiste en cambiar el nombre del demo. Consiste en crear una instalación productiva nueva, aceptada por el cliente y vinculada a una suscripción en el CRM central.

## 2. Estados

```text
DEMO_SOLICITADO
      ↓
DEMO_LISTO
      ↓
DEMO_REALIZADO
      ↓
PROPUESTA_ENVIADA
      ↓
GANADO_COMERCIAL
      ↓
PENDIENTE_PAGO/ACEPTACION
      ↓
LISTO_PARA_IMPLEMENTAR
      ↓
EN_CONFIGURACION
      ↓
UAT_CLIENTE
      ↓
ACTIVO_FACTURANDO
      ↓
OPERACION_ESTABLE
```

## 3. Condiciones para iniciar implementación

El CRM debe entregar:

- oportunidad marcada como ganada;
- propuesta o condiciones aceptadas;
- plan contratado;
- valor de implementación;
- mensualidad;
- promoción o descuento autorizado;
- fecha de inicio de cobro;
- día de vencimiento;
- evidencia o condición de primer pago;
- ficha de aprovisionamiento completa.

Si hay implementación gratuita o primer mes gratuito, debe quedar escrito en la oportunidad y suscripción. Nunca asumirlo verbalmente.

## 4. Crear el cliente en CRM-ITELSA-IA

El CRM central crea o actualiza:

- cliente;
- contacto de facturación;
- suscripción BeautyOS;
- concepto de implementación;
- mensualidad;
- fecha de próximo cobro;
- estado de pago;
- responsable de implementación;
- tareas de onboarding.

BeautyOS no reemplaza el sistema fiscal. El comprobante o factura electrónica se emite mediante el proceso contable autorizado y su referencia se guarda en el CRM.

## 5. Provisionar una instancia nueva

### Identidad

1. Definir `clientSlug`.
2. Definir nombre del negocio.
3. Confirmar nombre del agente.
4. Recibir logo y colores.

### Google

5. Crear carpeta privada del cliente.
6. Crear/copy Google Sheet desde plantilla limpia.
7. Crear proyecto Apps Script propio.
8. Configurar `.clasp.json` local temporal.
9. Subir `crm-webapp/src`.
10. Ejecutar `inicializarEntorno()`.
11. Configurar Script Properties privadas.
12. Crear despliegue Web App propio.
13. Registrar IDs y URLs solo en la ficha privada.

### WhatsApp y agente

14. Crear instancia Evolution con el mismo `clientSlug`.
15. Registrar tenant en `tenants.json` local.
16. Vincular el número autorizado del cliente.
17. Configurar nombre, saludo, comportamiento y políticas.
18. Confirmar que la clave IA se toma del entorno privado.

### Datos del negocio

19. Cargar colaboradores y competencias.
20. Cargar servicios, duración, precio y anticipos.
21. Configurar horarios, festivos y bloqueos.
22. Cargar preguntas frecuentes.
23. Configurar promociones únicamente con autorización.

## 6. Prueba de aceptación — UAT

Con el cliente:

- [ ] Acceso al CRM.
- [ ] Nombre y saludo correctos.
- [ ] Logo y color correctos.
- [ ] Servicios y precios aprobados.
- [ ] Colaboradores y competencias correctos.
- [ ] Horarios correctos.
- [ ] Consulta de disponibilidad.
- [ ] Creación de cita.
- [ ] Reprogramación.
- [ ] Cancelación.
- [ ] Política de anticipo.
- [ ] Recordatorio.
- [ ] Datos del propietario.
- [ ] Aislamiento respecto a otros clientes.
- [ ] Procedimiento de soporte explicado.

Registrar fecha, aprobador y observaciones en el CRM central.

## 7. Activación y facturación

Solo pasar a `ACTIVO_FACTURANDO` cuando:

1. La UAT esté aprobada.
2. El acuerdo comercial esté confirmado.
3. El pago inicial o excepción autorizada esté registrado.
4. La fecha de inicio y próximo cobro estén definidas.
5. Exista responsable de soporte.
6. El cliente tenga canales de acceso y capacitación.

En BeautyOS:

- `ESTADO_SERVICIO=ACTIVO`;
- tenant habilitado;
- WhatsApp conectado;
- monitoreo activo.

En CRM-ITELSA-IA:

- suscripción `ACTIVA`;
- valor recurrente;
- siguiente vencimiento;
- documento de cobro;
- estado de cartera;
- tarea de seguimiento.

## 8. Primeros días

- Día 1: verificar conexión, citas y errores.
- Día 3: revisar preguntas no resueltas por el agente.
- Día 7: ajustar conocimiento y mensajes.
- Día 15: revisar adopción.
- Antes del cobro: confirmar renovación y estado de cartera.

## 9. Suspensión o retiro

No borrar datos inmediatamente.

1. Registrar motivo en CRM.
2. Confirmar obligaciones y fecha efectiva.
3. Desactivar `ESTADO_SERVICIO`.
4. Deshabilitar tenant.
5. Desconectar automatizaciones.
6. Exportar o entregar datos según el acuerdo.
7. Conservar respaldo según política.
8. Revocar accesos y credenciales.

## 10. Definición de “cliente real”

Un prospecto se considera cliente activo únicamente cuando:

- existe aceptación comercial;
- existe una instancia productiva independiente;
- la UAT fue aprobada;
- la suscripción está registrada;
- hay fecha de cobro;
- el servicio está operativo.
