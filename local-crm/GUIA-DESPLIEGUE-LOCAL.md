# BeautyOS CRM Local

Componente opcional para clientes que necesiten operación local.

## Configuración

1. Copiar `config.example.json` como `config.json`.
2. Completar Sheet y Web App del cliente correcto.
3. Mantener `config.json` y credenciales fuera de Git.
4. Instalar dependencias.
5. Ejecutar las pruebas de lectura, escritura, sincronización y modo offline.

## Regla de aislamiento

Cada equipo debe apuntar únicamente al Sheet y GAS de su cliente. Verificar `clientSlug`, nombre del negocio y respaldo antes de sincronizar.

La guía general de despliegue está en [`../docs/OPERACION-Y-DESPLIEGUE.md`](../docs/OPERACION-Y-DESPLIEGUE.md).
