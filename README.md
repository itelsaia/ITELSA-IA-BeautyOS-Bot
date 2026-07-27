# BeautyOS by ITELSA IA

Plantilla maestra para preparar demostraciones y desplegar instancias independientes de BeautyOS.

Este repositorio ya no es el CRM comercial de ITELSA IA. Los prospectos, oportunidades, propuestas, cobros y renovaciones de ITELSA IA se administran en el proyecto separado `CRM-ITELSA-IA`.

## Qué contiene

| Ruta | Responsabilidad |
|---|---|
| `crm-webapp/` | CRM operativo de cada negocio, construido en Google Apps Script |
| `agent-bot/` | Agente IA y conexión con WhatsApp mediante Evolution API |
| `beautyos-landing/` | Landing comercial de BeautyOS e integración de leads |
| `local-crm/` | Cliente local opcional con sincronización |
| `docs/` | Arquitectura, demos, onboarding y contrato con el CRM central |

## Regla de aislamiento

Cada cliente real debe tener:

- Google Sheet propio;
- proyecto Apps Script propio;
- despliegue Web App propio;
- instancia de Evolution/WhatsApp propia;
- entrada privada de tenant propia;
- identidad, logo, colores y servicios propios;
- agente IA con el nombre elegido por el cliente;
- registro comercial y facturación en `CRM-ITELSA-IA`.

El demo compartido nunca se convierte directamente en producción. Cuando el prospecto compra, se crea una instancia nueva y limpia.

## Inicio

1. Abrir `BEAUTYOS.code-workspace`.
2. Leer [Índice de documentación](docs/README.md).
3. Consultar [Estado actual](docs/ESTADO-BEAUTYOS.md).
4. Para un demo, seguir [Preparar un demo](docs/PREPARAR-DEMO.md).
5. Para una venta, seguir [Proceso demo a cliente](docs/PROCESO-DEMO-A-CLIENTE.md).

## Seguridad

Las configuraciones reales se guardan en archivos locales ignorados por Git. Solo se versionan plantillas `.example`.

Nunca guardar en este repositorio:

- claves API;
- credenciales de Google;
- IDs o URLs operativas de clientes;
- números de WhatsApp reales;
- PIN reales;
- información comercial privada;
- copias de datos de clientes.
