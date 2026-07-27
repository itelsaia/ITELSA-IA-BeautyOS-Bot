# Operación y despliegue

## Ruta local

```text
C:\Users\USUARIO\Documents\Proyectos\ITELSA IA\Proyectos_Micro_SaaS\APP_WEB_BEAUTYOS
```

## Preparar configuración

```powershell
Copy-Item .env.example .env
Copy-Item tenants.example.json tenants.json
Copy-Item crm-webapp/.clasp.example.json crm-webapp/.clasp.json
Copy-Item local-crm/config.example.json local-crm/config.json
```

Completar valores de forma privada. No usar los ejemplos en producción.

## Agente

```powershell
Set-Location agent-bot
npm install
npm test
npm start
```

Comprobar:

- `/health`
- `/health/full`
- tenant esperado;
- conexión Evolution;
- sincronización de Sheet.

## Crear GAS para un cliente

1. Crear el Google Sheet.
2. Crear proyecto Apps Script vinculado o independiente según el procedimiento vigente.
3. Copiar `.clasp.example.json` como `.clasp.json`.
4. Completar el Script ID local.
5. Desde `crm-webapp/`, ejecutar:

```powershell
npx clasp status
npx clasp push --force
```

6. Ejecutar `inicializarEntorno()`.
7. Configurar Script Properties privadas:
   - `OPENAI_API_KEY`, si las funciones GAS usarán IA;
   - `BOT_API_KEY`, para llamadas autenticadas al bot.
8. Crear el Web App.
9. Registrar el despliegue solo en la ficha privada.
10. Probar antes de habilitar el tenant.

## Actualizar un cliente existente

No cambiar `.clasp.json` sin verificar el cliente objetivo.

```powershell
npx clasp status
npx clasp push --force
npx clasp deployments
```

Actualizar la implementación existente para conservar su URL. Probar únicamente en el cliente identificado.

## Respaldo

Antes de un cambio material:

- nombrar una versión del Sheet;
- registrar versión GAS activa;
- confirmar commit estable;
- exportar configuración no secreta;
- documentar rollback.

## Prohibiciones

- No copiar el `.clasp.json` de otro cliente.
- No ejecutar setup en un Sheet productivo sin respaldo.
- No apuntar dos clientes al mismo Sheet.
- No usar el demo como producción.
- No publicar identificadores operativos en Git.
