# Seguridad y aislamiento

## Controles obligatorios

- Una instancia por cliente.
- Un Sheet y GAS por cliente.
- Configuración privada fuera de Git.
- Datos de demo ficticios o mínimos.
- Secretos en `.env` o Script Properties.
- Respaldo antes de cambios de esquema.
- Acceso mínimo necesario.

## Archivos privados

- `.env`
- `credenciales-google.json`
- `tenants.json`
- `crm-webapp/.clasp.prod.json`
- `.clasp.json`
- `local-crm/config.json`
- `beautyos-landing/hostinger/beautyos/api/config.php`
- `ops/`
- `_clientes/`

## Claves IA

Las nuevas instalaciones usan `OPENAI_API_KEY` desde el entorno privado del bot. Las funciones GAS que necesiten IA usan Script Properties.

`CLAVE_OPENAI` en Sheets es compatibilidad temporal para instalaciones antiguas. Debe migrarse y eliminarse.

## Acceso al CRM

El Web App necesita recibir llamadas del bot y actualmente puede requerir acceso externo. El PIN de cuatro dígitos no debe considerarse autenticación fuerte.

Antes de escalar:

- separar endpoints públicos y panel administrativo;
- añadir tokens por tenant;
- validar autorización en servidor;
- limitar intentos;
- registrar auditoría sin datos sensibles.

## Datos

No usar datos de un cliente para demostrar a otro. No almacenar historias clínicas, contraseñas, documentos innecesarios ni credenciales bancarias completas.

## Checklist de commit

```powershell
git status
git diff --check
git grep -n -I -E "API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY"
```

Revisar que solo aparezcan nombres de variables o plantillas, nunca valores reales.
