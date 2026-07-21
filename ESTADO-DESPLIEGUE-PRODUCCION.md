# BeautyOS — estado operativo de producción

> Documento de continuidad. Actualizado el 17 de julio de 2026.
> Este archivo es la referencia para retomar el proyecto sin depender de una sesión de Cloud Shell o de una conversación anterior.

## Estado actual

La plataforma está operativa y los dos servicios principales están administrados por PM2 en la máquina virtual de Google Cloud:

| Componente | Estado confirmado | Ubicación / identificador |
|---|---|---|
| Evolution API | En línea | VM, proceso PM2: evolution-api |
| Bot BeautyOS | En línea | VM, proceso PM2: beautyos-bot |
| Agente comercial | Vinculado a WhatsApp y responde | Tenant: beautyos-comercial |
| CRM y landing | Publicados mediante Google Apps Script | Proyecto: CRM_BEAUTY_OS |
| Sincronización CRM | Funcionando | Google Sheets mediante cuenta de servicio |

El tenant demo-beautyos es el agente destinado a clientes. Si aparece desconectado durante estas pruebas, no afecta al agente comercial.

## Infraestructura y rutas importantes

- Proyecto de Google Cloud: itelsa-beautyos
- Máquina virtual: beautyos-server
- Zona: us-central1-a
- Usuario de la VM: iaitelsa
- Repositorio en la VM: /home/iaitelsa/beautyos
- Bot en la VM: /home/iaitelsa/beautyos/agent-bot
- Evolution API en la VM: /home/iaitelsa/evolution-api
- Repositorio fuente: https://github.com/itelsaia/ITELSA-IA-BeautyOS-Bot.git

El proyecto de Apps Script CRM_BEAUTY_OS se administra localmente desde beautyos-landing mediante clasp. Su configuración local está en beautyos-landing/.clasp.json y no se versiona.

## Secretos y archivos protegidos

Estos valores ya están configurados y funcionando, pero nunca deben escribirse en Git, este documento, capturas públicas ni conversaciones:

- Archivo .env del bot en la raíz del repositorio de la VM.
- credenciales-google.json en la raíz del repositorio de la VM.
- Claves de Evolution API y del bot.
- Claves o contraseñas de base de datos.
- BEAUTYOS_DELETE_LEAD_KEY, guardada como Propiedad de secuencia de comandos de Apps Script.
- BEAUTYOS_CRM_INTEGRATION_KEY, guardada como Propiedad de secuencia de comandos de Apps Script para validar las actualizaciones del bot al CRM.

Los archivos .env y credenciales-google.json están excluidos de Git. Antes de cualquier cambio, verificar que sigan con permisos privados.

## Recuperación tras reiniciar Cloud Shell

Un reinicio de Cloud Shell no borra nada de la VM ni de los servicios. Desde una terminal nueva:

    gcloud config set project itelsa-beautyos
    gcloud compute ssh beautyos-server --zone=us-central1-a

Ya dentro de la VM, comprobar los servicios:

    pm2 status
    pm2 logs beautyos-bot --lines 100
    pm2 logs evolution-api --lines 100

La señal correcta es que evolution-api y beautyos-bot aparezcan como online. Si el bot no está en línea:

    cd /home/iaitelsa/beautyos/agent-bot
    pm2 restart beautyos-bot --update-env
    pm2 save

## Despliegue normal del bot en la VM

Después de enviar cambios al repositorio principal, ejecutar:

    cd /home/iaitelsa/beautyos
    git pull --ff-only origin main
    cd agent-bot
    pm2 restart beautyos-bot --update-env
    pm2 save
    pm2 status

No usar comandos destructivos de Git para “arreglar” una actualización. Si git pull informa un conflicto o cambios locales inesperados, detenerse e investigar antes de continuar.

## Despliegue de Google Apps Script con clasp

Todos los cambios futuros del CRM y landing se hacen desde el proyecto local, no editando por partes en el navegador de Apps Script.

    cd beautyos-landing
    npx --no-install clasp status
    npx --no-install clasp push
    npx --no-install clasp deployments

Después de push, se debe crear una nueva versión sobre el mismo despliegue web principal:

    npx --no-install clasp deploy -i ID_DEL_DESPLIEGUE_PRINCIPAL -d "descripción clara del cambio"

Importante: clasp push actualiza el código remoto, pero no publica por sí solo la nueva versión de la web app. El paso deploy mantiene la URL pública existente y aplica el cambio en producción.

## Ajuste de conversación comercial — 17 de julio de 2026

Se afinó el agente comercial Sofi para que la captura de un prospecto sea clara, respetuosa y verificable. El cambio está en el commit `f0bfb6e` y el CRM de Apps Script se publicó como versión `83` en el despliegue web existente.

El flujo de conversación ahora es:

1. Identificar el tipo de negocio con opciones claras: salón, barbería, spa, uñas, estética o cejas.
2. Preguntar el nombre comercial o marca: por ejemplo, `Corte Fino`; no usar “barbería” o “salón” como si fueran el nombre del negocio.
3. Preguntar ciudad, tamaño del equipo y nombre de contacto, de una pregunta concreta por mensaje.
4. Responder primero cualquier duda real sobre BeautyOS, precio, funciones o implementación; la duda es opcional y no bloquea el registro.
5. Pedir autorización explícita solo cuando los cuatro datos obligatorios ya fueron confirmados.

El bot conserva cuál fue la última pregunta de captura. Así entiende respuestas cortas como `Corte Fino`, `Bogotá`, `3` o `Ana` en el campo correcto, sin usar el nombre de perfil de WhatsApp como nombre del contacto.

También se rechazan nombres genéricos, asentimientos como `sí` o `listo` usados por error como ciudad/marca, y cualquier intento de guardar un lead incompleto. Estas reglas se validan en el bot y nuevamente en Apps Script antes de escribir la hoja `LEADS`.

### Aplicar el ajuste del bot en la VM

El código ya está enviado a GitHub. Para que el agente que está en producción use esta lógica, desde Cloud Shell se debe ejecutar una vez:

    gcloud config set project itelsa-beautyos
    gcloud compute ssh beautyos-server --zone=us-central1-a

Ya dentro de la VM:

    cd /home/iaitelsa/beautyos
    git pull --ff-only origin main
    cd agent-bot
    pm2 restart beautyos-bot --update-env
    pm2 save
    pm2 status

La señal de éxito es `beautyos-bot` en estado `online`. Luego hacer una prueba nueva por WhatsApp con el orden: tipo → marca → ciudad → equipo → nombre → autorización.

## Reparación de leads comerciales incompletos — Apps Script v84 publicado

Una ficha que tenga como nombre de negocio `pendiente`, `N/A`, `salón`, `barbería`, una respuesta como `sí` o cualquier nombre genérico se considera incompleta. Ese texto nunca vuelve a aceptarse como nombre comercial.

Cuando el mismo WhatsApp escriba al agente, Sofi le pedirá de forma directa: `Para actualizar tu registro, ¿cómo se llama tu negocio o marca?` Después solicitará únicamente los datos que aún falten. Al recibir autorización, actualiza la misma fila de `LEADS`; no crea un duplicado y conserva el estado, el asesor asignado y la fecha original.

### Protección obligatoria antes de activar esta reparación

La actualización de una ficha existente requiere una clave privada entre el bot y Apps Script. Antes de probarla en producción, configurar en el proyecto `CRM_BEAUTY_OS` una Propiedad de secuencia de comandos:

| Propiedad | Valor privado |
|---|---|
| `BEAUTYOS_CRM_INTEGRATION_KEY` | La misma clave interna que ya usa el bot: `BOT_API_KEY` de su `.env` en la VM. |

No pegar ni enviar esa clave por chat, Git o capturas. Copiarla de forma privada desde el archivo `.env` del servidor al campo de valor de Apps Script. Más adelante se puede crear una `CRM_GAS_API_KEY` independiente; mientras tanto el bot usa de forma segura la clave interna existente.

Esta protección evita que alguien que conozca la URL pública del CRM pueda simular una actualización de lead. Si la propiedad no existe o no coincide, Apps Script rechaza la reparación sin modificar datos.

### Prueba de aceptación

1. Usar el mismo WhatsApp de un lead cuyo negocio figura como `pendiente`.
2. Confirmar que Sofi pregunta primero el nombre o marca real, por ejemplo `Corte Fino`.
3. Completar solo los datos faltantes y aceptar el uso de datos.
4. Comprobar en CRM que cambia el nombre del negocio en la misma fila, sin duplicado, y que se mantienen el asesor y el estado previo.

### Corrección de carga inicial — pendiente de aplicar en la VM

Se detectó que, tras reiniciar el bot, la lista de leads comerciales se cargaba solo en el siguiente ciclo de sincronización (cada cinco minutos). Durante esa ventana, un lead existente podía recibir el saludo genérico de prospecto nuevo.

El siguiente ajuste del bot carga la caché de `LEADS` antes de abrir la atención de WhatsApp. También reconcilia una sesión que ya hubiera empezado como prospecto: si el CRM identifica una ficha con negocio inválido, la convierte en `LEAD_INCOMPLETO` para que la siguiente respuesta solicite la marca real. No cambia clientes ni leads con nombre comercial válido.

### Blindaje post-registro comercial — pendiente de aplicar junto con la siguiente actualización

Se detectó una situación crítica en una prueba real: después de guardar correctamente un lead, Sofi respondía preguntas sobre el producto, pero un `sí` posterior podía reabrir el flujo de captura y volver a pedir negocio, equipo o autorización.

La corrección añade tres defensas complementarias:

1. Cuando el CRM confirma o recibe un lead, la sesión queda marcada como registro finalizado. Para ese contacto, el prompt prohíbe pedir nuevamente nombre, marca, ciudad, equipo o autorización; un `sí` continúa la explicación anterior.
2. La herramienta técnica `capturar_lead` se retira por completo de la conversación de un lead ya registrado. Así, aunque el modelo interpretara mal una respuesta corta, no puede crear ni intentar completar otra ficha.
3. Si un ciclo de sincronización consulta el CRM antes de que aparezca la fila recién guardada, conserva la sesión durante una ventana de confirmación. Solo un lead que ya haya sido visto en CRM puede volver a ser prospecto inmediatamente tras borrarlo de forma intencional.

También se agregaron pruebas automáticas para estos escenarios. Antes del reinicio de producción se ejecutará:

    cd /home/iaitelsa/beautyos/agent-bot
    npm test

No requiere cambios adicionales en Apps Script ni nuevas claves.

### Endurecimiento del flujo crítico y audios — pendiente de aplicar junto con la siguiente actualización

Antes de promocionar el agente se revisó el recorrido completo de captación. Se añadió una segunda capa de protección, independiente del texto que genere la IA:

1. El servidor conserva el paso real pendiente del flujo: `tipo → marca → ciudad → equipo → contacto → autorización`. Si Sofi cambia la redacción de una pregunta, una respuesta corta sigue llegando al campo correcto.
2. Cada mensaje de WhatsApp se deduplica por su identificador y los mensajes del mismo número se procesan en orden. Esto evita respuestas cruzadas o dos registros cuando llegan un audio y un texto seguidos.
3. Apps Script usa un bloqueo transaccional al revisar duplicados, crear la fila y asignar asesor. También queda una única alerta de WhatsApp para los leads creados por el agente; la landing conserva su propia alerta.
4. Los audios y notas de voz se descargan desde Evolution, se transcriben con Whisper en español y luego recorren exactamente el mismo flujo que un texto. Se respeta el tipo de archivo OGG, MP3, M4A, WAV o WebM, se limita el tamaño y los logs ya no muestran el contenido transcrito.

El soporte de audio está implementado, pero debe validarse con un número de prueba antes de usarlo en campaña. La prueba controlada consiste en enviar, esperando respuesta entre cada una, notas de voz cortas con: tipo de negocio, marca, ciudad, equipo, nombre, autorización y una duda sobre una función. Después de estar registrado, responder `sí` por audio a una explicación: Sofi debe continuar la explicación, nunca volver a pedir el formulario.

Las pruebas automáticas del bot cubren guardrails post-registro, caché, deduplicación, orden de mensajes, estado explícito, consentimiento y tipos de audio. Se ejecutan con `npm test`.

## CRM comercial y pruebas

## Actualización lista para desplegar — protección del flujo de Sofi

Esta actualización refuerza el recorrido comercial de Sofi antes de aplicarlo
en la VM. Incluye las siguientes mejoras:

1. Las respuestas de un mismo WhatsApp se procesan en orden y un webhook
   duplicado se ignora mediante su identificador de mensaje.
2. El servidor conserva el paso pendiente de la captura, por lo que Sofi no
   confunde respuestas breves ni reinicia el formulario después de registrar
   un lead.
3. Un prospecto puede corregir explícitamente su ciudad antes de autorizar el
   registro; Sofi actualiza únicamente ese dato y muestra de nuevo el resumen.
4. La autorización acepta respuestas naturales como `de acuerdo`, `dale`,
   `listo`, `listica`, `está bien` u `okay` solo cuando la pregunta de
   autorización está realmente pendiente. Expresiones ambiguas como `hágale`
   o `sisas` siguen requiriendo confirmación explícita.
5. Las notas de voz se transcriben y recorren las mismas validaciones que un
   mensaje escrito.

La validación local se ejecutó con `npm test`: **18 pruebas aprobadas y 0
fallos**. Después de publicar el commit en GitHub, aplicar en la VM:

    cd /home/iaitelsa/beautyos
    git pull --ff-only origin main
    cd agent-bot
    npm test
    pm2 restart beautyos-bot --update-env
    pm2 save
    pm2 status

La confirmación final debe incluir una prueba real por WhatsApp: corregir una
ciudad antes del consentimiento y verificar que, tras un registro completo,
Sofi continúa una conversación sin volver a pedir los datos del formulario.

El agente beautyos-comercial ya está vinculado y puede captar leads comerciales. El flujo actual:

- Responde de forma breve, cálida y con máximo un emoji de belleza por mensaje.
- Usa solo la información comercial, campaña, planes y FAQs relevantes al mensaje.
- Distingue tipo de negocio de nombre comercial; no pregunta de forma ambigua “¿a qué negocio te dedicas?”.
- Para guardar un lead exige: nombre confirmado, nombre comercial, ciudad, número de empleados y autorización expresa.
- El correo es opcional.
- La ciudad y los demás datos obligatorios se validan también en el servidor y en Apps Script; no solo en el prompt.

El nombre con el que el bot saluda puede venir del nombre de perfil que WhatsApp entrega a Evolution API. No lee la agenda del teléfono. Por eso puede saludar por nombre incluso si el lead fue eliminado del CRM.

### Eliminar un lead de prueba

La pantalla CRM > Leads incluye una papelera roja. El borrado está pensado exclusivamente para pruebas:

1. Pulsar la papelera del lead.
2. Escribir ELIMINAR para confirmar.
3. Ingresar la clave privada configurada en Apps Script.

El sistema valida la clave en servidor, bloquea borrar un cliente convertido, archiva el registro en la hoja LEADS_ELIMINADOS y elimina el lead activo. También ajusta el contador del asesor asignado.

Para repetir inmediatamente una conversación con el mismo WhatsApp después de borrar un lead, la opción más segura es reiniciar el bot:

    pm2 restart beautyos-bot
    pm2 save

Esto limpia la sesión de conversación que el bot tenía en memoria. Con la siguiente sincronización correcta el bot también detecta que el lead ya no existe y lo trata como prospecto.

## Cambios ya incorporados en Git

- 9e7f751 — exige datos comerciales completos antes de crear un lead.
- 713a3c9 — compacta el prompt comercial y reduce consumo de tokens.
- ece58ee — agrega borrado protegido y archivado de leads de prueba.
- 8031813 — sincroniza los archivos reales de landing y Setup de Apps Script al repositorio.
- f0bfb6e — refina la conversación comercial, captura respuestas cortas de forma segura y endurece la validación de leads.

- 4b431c5 — repara de forma segura los leads incompletos, bloquea valores como `pendiente` y conserva la fila, asesor y estado al completarla. Publicado en Apps Script como versión `84` y aplicado al bot de la VM.

- 782751a — blinda la conversación posterior al registro, bloquea recapturas y protege la sesión ante sincronización atrasada del CRM. Incluye pruebas automáticas con `npm test`.

- Pendiente de publicar — convierte el flujo de captura en estado explícito del servidor, serializa mensajes por conversación, deduplica webhooks, protege el CRM contra carreras y endurece transcripción de audios.

El CRM está en la versión 84 y el bot fue reiniciado correctamente con PM2. La siguiente publicación corregirá la carga inicial de la caché de leads comerciales.

## Próximo punto de trabajo

1. Publicar el endurecimiento de flujo y audios en Apps Script y la VM, validando `npm test` antes del reinicio controlado de PM2.
2. Hacer una prueba real de punta a punta: tipo, marca, ciudad, tamaño de equipo, nombre, consentimiento, duda sobre una función y confirmación `sí`; el bot debe explicar la función sin pedir datos otra vez.
3. Repetir la prueba con notas de voz cortas y revisar que exista una sola fila de CRM y una sola alerta de asesor.
4. Verificar que el nuevo registro muestre ciudad, equipo y notas correctas en CRM y que los indicadores se actualicen.
5. Preparar la campaña de lanzamiento y usar el número comercial en redes.
6. Antes de ampliar el acceso al CRM, proteger el panel administrativo con autenticación o una capa de autorización. Hoy la clave de borrado protege la acción destructiva, pero el acceso general al panel requiere un endurecimiento adicional.

## Forma de trabajo y conceptos para aprender

Trabajaremos cada mejora de producción con este ciclo:

1. Objetivo: qué problema de negocio resolvemos.
2. Cambio: qué componente modificamos y por qué.
3. Verificación: cómo confirmamos que funcionó.
4. Despliegue: cómo llega el cambio a producción.
5. Continuidad: qué quedó hecho, qué falta y cómo recuperarlo.

Conceptos clave:

- Cloud Shell es una terminal temporal para administrar Google Cloud; la VM es el servidor persistente.
- PM2 mantiene vivo el bot y permite reiniciarlo, ver sus registros y restaurarlo tras un reinicio.
- Git guarda el historial de código y permite llevar el mismo cambio del computador a la VM de forma controlada.
- clasp conecta la carpeta local con Apps Script; push sube código y deploy publica una versión web.
- Una sesión del bot es información temporal en memoria. Borrar un lead de Sheets no borra automáticamente esa memoria; por eso un reinicio controlado permite repetir una prueba limpia.

Regla permanente: los secretos se configuran una sola vez en lugares protegidos; el código y la documentación sí se versionan. Cada avance relevante debe quedar explicado aquí para que el proyecto sea recuperable y auditable.
