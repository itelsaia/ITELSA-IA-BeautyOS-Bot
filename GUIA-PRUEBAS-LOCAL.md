# Guia de Pruebas Locales - BeautyOS

## Requisitos del Entorno

- **PC**: Mac con Bootcamp (Windows 10) - Docker NO funciona
- **Node.js**: Instalado
- **Evolution API**: Instalada localmente (standalone, sin Docker)
- **ngrok**: Solo si necesitas exponer el bot a internet (opcional para pruebas locales)

---

## Servicios y Puertos

| Servicio | Puerto | Descripcion |
|----------|--------|-------------|
| Evolution API | 8080 | Motor de WhatsApp (Baileys) |
| Bot (Express) | 3000 | Agente IA que procesa mensajes |
| ngrok | variable | Tunel publico (opcional) |

---

## Paso 1: Iniciar Evolution API

Abrir una terminal (CMD o PowerShell) y ejecutar:

```bash
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\evolution-api"
npm start
```

Esperar a que muestre:
```
[SERVER] HTTP - ON: 8080
```

### Verificar que funciona:
- Navegador: `http://localhost:8080` (debe mostrar JSON con "Welcome to the Evolution API")
- Manager: `http://localhost:8080/manager` (interfaz grafica)

---

## Paso 2: Iniciar el Bot (Agente IA)

Abrir **otra terminal** y ejecutar:

```bash
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\agent-bot"
npm start
```

Esperar a que muestre:
```
[peluqueria-valentina] Estado de conexion WhatsApp: open
Servidor HTTP escuchando en puerto 3000
```

### Verificar que funciona:
- Navegador: `http://localhost:3000/health` (debe mostrar JSON con status "ok")

---

## Paso 3: Configurar Webhook en Evolution API

El webhook conecta Evolution API con el Bot. Cada vez que llega un mensaje de WhatsApp, Evolution API lo envia al bot.

1. Abrir `http://localhost:8080/manager` en el navegador
2. Hacer clic en la instancia **peluqueria-valentina**
3. En el menu izquierdo: **Events > Webhook**
4. Configurar:
   - **Enabled**: ON (activar el toggle)
   - **URL**: `http://localhost:3000/webhook/evolution`
   - **Webhook by Events**: OFF
   - **Webhook Base64**: OFF
5. Bajar y hacer clic en **Save**

> IMPORTANTE: Este paso solo se hace la primera vez o si se borra la configuracion de Evolution API. Si la instancia ya tiene el webhook guardado, no necesitas repetirlo.

---

## Paso 4 (Opcional): Iniciar ngrok

Solo necesario si quieres exponer el bot a internet (ej: para pruebas desde otro dispositivo fuera de tu red local).

Abrir **otra terminal** y ejecutar:

```bash
C:\Users\Critian\Documents\ngrok.exe http 3000
```

Esto genera una URL publica tipo `https://xxxx.ngrok-free.app`. Si usas ngrok, el webhook en Evolution API debe apuntar a esa URL en vez de localhost:

```
https://TU-URL-NGROK.ngrok-free.app/webhook/evolution
```

> Para pruebas locales NO necesitas ngrok. Solo usa `http://localhost:3000/webhook/evolution`

---

## Paso 5: Conectar WhatsApp (solo la primera vez)

Si la instancia `peluqueria-valentina` no esta conectada:

1. Abrir `http://localhost:8080/manager`
2. Si aparece un codigo QR, escanealo con WhatsApp (como WhatsApp Web)
3. Esperar a que muestre **"Connected"**

Si ya estaba conectada previamente, se reconecta automaticamente.

---

## Orden Correcto para Encender Todo

```
1. Iniciar Evolution API    (terminal 1)
2. Iniciar el Bot           (terminal 2)
3. Verificar webhook        (navegador - solo si es primera vez)
4. ngrok                    (terminal 3 - opcional)
```

> El Bot DEBE iniciarse DESPUES de Evolution API, porque al iniciar verifica la conexion de WhatsApp.

---

## Orden para Apagar Todo

```
1. Ctrl+C en terminal del Bot
2. Ctrl+C en terminal de ngrok (si lo usaste)
3. Ctrl+C en terminal de Evolution API
```

---

## Verificacion Rapida (Checklist)

| Que verificar | Como | Resultado esperado |
|---------------|------|-------------------|
| Evolution API corriendo | `http://localhost:8080` | JSON con "Welcome to Evolution API" |
| Manager accesible | `http://localhost:8080/manager` | Interfaz grafica |
| WhatsApp conectado | Manager > Dashboard | Badge verde "Connected" |
| Bot corriendo | `http://localhost:3000/health` | JSON con status "ok" |
| Webhook configurado | Manager > Events > Webhook | URL: `http://localhost:3000/webhook/evolution`, Enabled: ON |
| Bot responde | Enviar mensaje de WhatsApp al numero | El bot responde con IA |

---

## Solucion de Problemas

### "Estado de conexion WhatsApp: unknown"
- Evolution API no esta corriendo. Inicia Evolution API primero y reinicia el bot.

### "Error 404 en webhook"
- La URL del webhook es incorrecta o apunta a un ngrok viejo.
- Abrir Manager > Events > Webhook y cambiar a `http://localhost:3000/webhook/evolution`

### "El bot no responde mensajes"
1. Verificar que Evolution API esta corriendo (puerto 8080)
2. Verificar que el Bot esta corriendo (puerto 3000)
3. Verificar webhook en Manager (debe estar Enabled con URL correcta)
4. Verificar WhatsApp conectado (debe decir "Connected" en Manager)

### "Evolution API se cerro"
- Volver a ejecutar `npm start` en la carpeta de evolution-api
- El webhook se mantiene guardado, no necesitas reconfigurarlo

### "ngrok cambio la URL"
- Cada vez que reinicias ngrok genera una URL nueva
- Si usas ngrok, actualiza la URL en Manager > Events > Webhook
- Para evitar esto, usa `http://localhost:3000/webhook/evolution` (no necesita ngrok)

---

## Rutas Importantes

| Recurso | Ruta |
|---------|------|
| Proyecto BeautyOS | `C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA` |
| Evolution API | `C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\evolution-api` |
| Bot (agent-bot) | `C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\agent-bot` |
| ngrok | `C:\Users\Critian\Documents\ngrok.exe` |
| Credenciales Google | `C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\credenciales-google.json` |
| Config tenants | `C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\tenants.json` |
| Config bot (.env) | `C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\.env` |

---

## CRM Web App (Google Apps Script)

El CRM se accede desde la URL de la Web App de Google Apps Script. No necesita levantar nada local.

### Desplegar cambios al CRM:
```bash
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\crm-webapp"
npx clasp push --force
```

Despues de hacer push, crear nueva version del deployment:
1. Ir a Google Apps Script (script.google.com)
2. Deploy > Manage deployments > Editar (lapiz)
3. Seleccionar "New version"
4. Guardar
