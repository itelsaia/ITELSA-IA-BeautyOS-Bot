# Arquitectura de instancias BeautyOS

## 1. Propósito

BeautyOS es un producto vertical de ITELSA IA para negocios de belleza. Este repositorio es la plantilla maestra desde la cual se preparan demos y nuevas instalaciones.

No es el CRM comercial de ITELSA IA.

## 2. Arquitectura general

```text
Cliente final por WhatsApp
          │
          ▼
Instancia Evolution del negocio
          │
          ▼
Agente BeautyOS ──────── OpenAI
          │
          ├───────────── Google Sheet exclusivo
          │
          └───────────── Web App GAS exclusivo
                              │
                              ├─ CRM operativo
                              ├─ agenda
                              ├─ clientes
                              ├─ servicios
                              ├─ colaboradores
                              ├─ disponibilidad
                              └─ promociones/reportes
```

## 3. Unidad de aislamiento

Una instalación se identifica por `clientSlug`.

Ejemplo neutro:

```text
clientSlug: studio-belleza-demo
Evolution instance: studio-belleza-demo
Sheet: BEAUTYOS_STUDIO_BELLEZA_DEMO
GAS: BeautyOS - Studio Belleza Demo
Agente: nombre elegido por el cliente
```

El `clientSlug` no debe cambiar después de salir a producción.

## 4. Recursos por cliente

| Recurso | Compartido | Exclusivo |
|---|---:|---:|
| Código fuente base | Sí | |
| Google Sheet | | Sí |
| Proyecto GAS | | Sí |
| Web App URL | | Sí |
| Instancia Evolution | | Sí |
| Número de WhatsApp | | Sí |
| Configuración del tenant | | Sí |
| Nombre y prompt del agente | | Sí |
| Datos operativos | | Sí |
| Registro de venta/facturación ITELSA | Central | |
| Servidor del bot | Puede compartirse en MVP | Opcional |
| Cuenta del proveedor IA | Puede compartirse | Opcional |

Aunque el servidor se comparta, el estado, las sesiones, los catálogos y las credenciales de cada tenant deben mantenerse aislados.

## 5. Componentes del repositorio

### `crm-webapp/`

Plantilla del CRM operativo GAS. Para cada cliente se crea un proyecto nuevo, vinculado a un Sheet nuevo.

Hojas principales:

- `CONFIGURACION`
- `CLIENTES`
- `SESIONES`
- `COLABORADORES`
- `DISPONIBILIDAD`
- `AGENDA`
- `CONFIG_SERVICIOS`
- `CONOCIMIENTO`
- `PROMOCIONES`
- `GALERIA_SERVICIOS`
- hojas auxiliares de estados, festivos, soporte y analítica.

### `agent-bot/`

Servicio Node que:

- carga tenants desde `tenants.json`;
- consulta la configuración del Sheet;
- conversa usando IA;
- recibe webhooks de Evolution;
- crea, reprograma y cancela citas;
- envía recordatorios y promociones;
- mantiene estado separado por instancia.

La configuración de cada negocio define `NOMBRE_NEGOCIO`, `NOMBRE_AGENTE`, saludo, servicios, equipo, horarios y políticas.

El tenant comercial antiguo de BeautyOS se conserva temporalmente por compatibilidad, pero no forma parte de una instancia de cliente. La responsabilidad comercial debe migrar progresivamente al agente del proyecto `CRM-ITELSA-IA`.

### `beautyos-landing/`

Landing pública para vender BeautyOS. Puede enviar prospectos al CRM central, pero no contiene el CRM de ITELSA IA.

Una landing propia del cliente solo se provisiona si el plan contratado la incluye.

### `local-crm/`

Componente opcional para operación local/offline. No es obligatorio para el MVP alojado en GAS.

## 6. Demo frente a producción

```text
DEMO COMPARTIDO                         CLIENTE REAL
------------------------------          ------------------------------
Datos ficticios o temporales            Datos reales del negocio
Se reutiliza entre prospectos            No se reutiliza
Sin historial contractual                Vinculado a una venta
Puede usar número de demostración         Usa WhatsApp autorizado
Se limpia antes y después                Tiene respaldos y propietario
No factura                               Tiene suscripción en CRM ITELSA
```

## 7. Integración con CRM-ITELSA-IA

El CRM central decide cuándo una oportunidad está ganada y entrega una ficha de aprovisionamiento. BeautyOS devuelve estados de implementación.

```text
CRM ITELSA IA                         BeautyOS
---------------------------           ---------------------------
Lead y oportunidad                    Demo técnico
Propuesta y aceptación     ────────>  Provisionamiento
Cobro y suscripción                   Configuración y UAT
Estado comercial           <────────  Estado de implementación
Renovación/cartera                     Operación del negocio
```

No se intercambian claves, PIN ni URLs privadas dentro del payload comercial.

## 8. Limitaciones actuales

- El cargador activo de tenants sigue concentrado en `agent-bot/src/services/tenants.js`.
- Existen clases nuevas de tenant, pero la migración al administrador aislado no está terminada.
- El bot usa actualmente una credencial Google compartida para acceder a Sheets autorizados.
- La autenticación del CRM GAS se apoya en PIN y requiere fortalecimiento antes de escalar.
- La generación legal de factura electrónica no ocurre en BeautyOS; el CRM central registra el cobro y el documento fiscal se emite por el mecanismo contable autorizado.

Estas limitaciones no impiden los primeros clientes, pero deben tratarse antes de operar a mayor escala.
