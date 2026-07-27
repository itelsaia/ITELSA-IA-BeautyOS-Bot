# Estado actual — BeautyOS

Última actualización: 2026-07-27.

## Proyecto activo

- Repositorio exclusivo de BeautyOS.
- Rama actual: `main`.
- CRM comercial ITELSA IA: repositorio separado.
- Plantilla CRM: `crm-webapp/`.
- Agente: `agent-bot/`.
- Landing comercial: `beautyos-landing/`.
- Cliente local opcional: `local-crm/`.

## Funcionalidades existentes

- CRM operativo en GAS.
- Agenda, clientes y servicios.
- Colaboradores y disponibilidad.
- Agendamiento, reprogramación y cancelación.
- Anticipos y estados de pago operativos.
- Recordatorios.
- Promociones.
- Analítica.
- Agente WhatsApp multi-tenant.
- Integración con Evolution API.
- Personalización de negocio y nombre del agente.
- Healthcheck y cola de reintentos.

## Cambios de plantilla aplicados

- Nombres y colaboradores iniciales neutralizados.
- Nuevas instalaciones toman clave IA del entorno privado.
- Secretos GAS preparados para Script Properties.
- Archivos reales de tenant, clasp y Hostinger excluidos de Git.
- Contrato con CRM central documentado.
- Procedimiento demo → cliente → facturación documentado.

## Pendientes prioritarios

1. Completar migración del administrador de tenants.
2. Crear automatizador de aprovisionamiento.
3. Separar autenticación del panel y endpoints del bot.
4. Crear pruebas de aislamiento entre dos clientes.
5. Eliminar fallback de claves almacenadas en Sheets después de migrar instancias antiguas.
6. Implementar sincronización estructurada con CRM-ITELSA-IA.

## Siguiente paso recomendado

Preparar un demo limpio siguiendo `docs/PREPARAR-DEMO.md`, ejecutar la prueba completa y registrar el resultado en el CRM central.
