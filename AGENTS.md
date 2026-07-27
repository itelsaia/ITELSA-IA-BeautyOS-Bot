# Instrucciones de trabajo — BeautyOS

## Alcance

- Este repositorio es exclusivamente BeautyOS.
- El CRM comercial central vive en otro repositorio: `CRM-ITELSA-IA`.
- No crear aquí módulos de prospectos, propuestas o facturación central de ITELSA IA.
- La landing puede enviar leads al CRM central mediante el contrato documentado, pero no contiene su implementación.

## Fuente de verdad

- Arquitectura: `docs/ARQUITECTURA-INSTANCIAS.md`.
- Estado actual: `docs/ESTADO-BEAUTYOS.md`.
- Demo: `docs/PREPARAR-DEMO.md`.
- Conversión a cliente: `docs/PROCESO-DEMO-A-CLIENTE.md`.
- Integración con CRM: `docs/CONTRATO-CRM-ITELSA-IA.md`.

## Reglas por cliente

- Nunca reutilizar el Sheet, GAS o WhatsApp de otro cliente.
- Nunca convertir el entorno demo compartido en producción.
- Usar un `clientSlug` estable, sin espacios y en minúsculas.
- Guardar configuraciones reales únicamente en archivos ignorados.
- No crear carpetas de clientes con datos reales dentro de Git.
- No desplegar sin completar el checklist de aceptación.

## Seguridad

- No mostrar ni registrar secretos en consola, documentación, commits o capturas.
- `.env`, `tenants.json`, `.clasp*.json`, credenciales Google y configuraciones Hostinger reales son privados.
- Los secretos de Apps Script se almacenan en Script Properties.
- Las nuevas instalaciones no guardan la clave de IA en Google Sheets.
- Revisar `git status`, `git diff --check` y patrones de secretos antes de cada commit.

## Cambios de código

- Preservar compatibilidad con Google Apps Script V8 y Node.js 18+.
- Actualizar las plantillas y documentos cuando cambie el esquema.
- Ejecutar `npm test` en `agent-bot/` cuando se modifique el agente.
- Actualizar siempre una implementación existente; crear una nueva solo al provisionar un cliente nuevo.
- No modificar una instancia productiva de otro cliente durante una prueba.
