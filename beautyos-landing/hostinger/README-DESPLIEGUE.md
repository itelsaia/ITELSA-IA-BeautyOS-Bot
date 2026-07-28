# Despliegue de BeautyOS en Hostinger

## Arquitectura

- URL pública: `https://www.itelsaia.com/beautyos/`
- Frontend: HTML y recursos WebP alojados en Hostinger.
- Formulario: `beautyos/api/lead.php` valida la solicitud y la reenvía al backend GAS.
- Backend y CRM: continúan en Google Apps Script y Google Sheets.
- WhatsApp comercial: Nora, asesora comercial integral de ITELSA IA.
- Agente de cada cliente: se configura con el nombre y la identidad elegidos por ese negocio.

## Ubicación en hPanel

1. Abrir `Websites` y entrar al panel del dominio `itelsaia.com`.
2. Abrir `File Manager` y seleccionar el acceso a los archivos del dominio.
3. Entrar en `public_html`.
4. Subir el archivo `beautyos-hostinger-v1.zip`.
5. Extraerlo en `public_html` y confirmar que exista esta ruta:
   `public_html/beautyos/index.html`.

No se debe reemplazar ni borrar el contenido existente de `public_html`; esta
landing vive únicamente dentro de la carpeta `beautyos`.

## Comprobaciones posteriores

1. Abrir `https://www.itelsaia.com/beautyos/` en una ventana privada.
2. Confirmar que carguen el logo, el hero y las cuatro tarjetas de beneficios.
3. Abrir `https://www.itelsaia.com/beautyos/api/lead.php`. Debe responder en JSON
   que el método no está permitido; eso confirma que PHP está funcionando.
4. Enviar un prospecto de prueba desde el formulario y confirmar que aparezca
   en la hoja `LEADS` con fuente `landing-hostinger`, tipo de negocio, cantidad
   de empleados y necesidad principal.
5. Eliminar o marcar claramente el prospecto de prueba en el CRM.
6. Confirmar que HTTPS esté activo y forzado para `itelsaia.com`.

## Archivos importantes

- `beautyos/index.html`: landing independiente.
- `beautyos/assets/`: banco visual optimizado para web.
- `beautyos/api/lead.php`: puente seguro entre Hostinger y GAS.
- `beautyos/api/config.php`: URL del despliegue GAS.
- `beautyos/.htaccess`: HTTPS, caché, compresión y protección básica.

## Actualizaciones futuras

Para actualizar solo el diseño, se reemplazan `index.html` y los recursos que
hayan cambiado. Si cambia el identificador del despliegue de GAS, se actualiza
`api/config.php`. Antes de reemplazar archivos en producción se debe descargar
una copia de la carpeta `public_html/beautyos` desde hPanel.

Para la versión breve orientada a demostraciones:

1. Descargar una copia de `public_html/beautyos/index.html`.
2. Subir únicamente `beautyos/hostinger/beautyos/index.html`.
3. Reemplazar `public_html/beautyos/index.html`.
4. No subir ni reemplazar `api/config.php`.
5. Abrir la landing en una ventana privada y probar navegación, WhatsApp y
   formulario.

La versión `lead-v2` conserva el contrato de datos del formulario. El CRM
presenta el origen como `Landing web` o `Nora · WhatsApp`, lo que permite medir
el rendimiento de cada estrategia sin duplicar campos ni mezclar la información
de calificación dentro de las notas.
