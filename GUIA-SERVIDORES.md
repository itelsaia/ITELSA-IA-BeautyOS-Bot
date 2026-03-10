# BeautyOS - Guia de Servidores

## Servicios Necesarios (en orden de inicio)

| # | Servicio | Puerto | Que hace |
|---|----------|--------|----------|
| 1 | PostgreSQL | 5432 | Base de datos de Evolution API |
| 2 | Evolution API | 8080 | Servidor WhatsApp (recibe/envia mensajes via Baileys) |
| 3 | ngrok | 4040 | Tunel publico para webhooks de WhatsApp |
| 4 | Bot BeautyOS | 3000 | Bot IA multi-tenant (procesa mensajes con OpenAI) |

---

## Mac Boot Camp (SIN Docker)

Necesitas **4 ventanas de CMD** abiertas simultaneamente.

### Ventana 1 - PostgreSQL
Se inicia automaticamente como servicio de Windows. Para verificar:
```
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "SELECT 1"
```

### Ventana 2 - Evolution API
```
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\evolution-api" && npx tsx ./src/main.ts
```
Esperar hasta ver: `HTTP - ON: 8080`

### Ventana 3 - ngrok
```
C:\Users\Critian\Documents\ngrok.exe http 3000
```
Copiar la URL publica (ej: `https://xxxx.ngrok-free.app`)

**IMPORTANTE**: Cada vez que reinicias ngrok la URL cambia. Debes:
1. Abrir el archivo: `C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\evolution-api\.env`
2. Cambiar `WEBHOOK_GLOBAL_URL` con la nueva URL + `/webhook/evolution`
3. Reiniciar Evolution API (Ctrl+C y ejecutar de nuevo)

### Ventana 4 - Bot BeautyOS
```
cd "C:\Users\Critian\Documents\ITELSA IA\PROYECTOS_MICRO_SAS\APP_WEB_PELUQUERIAS_SPA\agent-bot" && npm start
```

### Para apagar todo
- Ctrl+C en cada ventana (Bot, ngrok, Evolution API)
- PostgreSQL sigue corriendo como servicio (no necesitas apagarlo)

---

## PC Windows (CON Docker)

### Ventana 1 - Docker (PostgreSQL + Redis + Evolution API)
```
cd "RUTA_DEL_PROYECTO\APP_WEB_PELUQUERIAS_SPA" && docker compose up -d
```
Esto levanta PostgreSQL + Redis + Evolution API en un solo comando.

### Ventana 2 - ngrok
```
ngrok http 3000
```
Actualizar `WEBHOOK_GLOBAL_URL` en `evolution-api.env` (version Docker) y reiniciar:
```
docker compose restart evolution-api
```

### Ventana 3 - Bot BeautyOS
```
cd "RUTA_DEL_PROYECTO\APP_WEB_PELUQUERIAS_SPA\agent-bot" && npm start
```

### Para apagar todo
- Ctrl+C en Bot y ngrok
- `docker compose down` para apagar los contenedores

---

## Configuracion inicial del PC Windows (Docker)

1. Instalar **Docker Desktop** (https://www.docker.com/products/docker-desktop)
2. Instalar **Node.js** v18+ (https://nodejs.org)
3. Instalar **ngrok** (https://ngrok.com/download) y configurar authtoken
4. Clonar el repo: `git clone TU_REPO_URL`
5. Crear `.env` en la raiz del proyecto (copiar del otro PC)
6. Copiar `credenciales-google.json` (NO se sube a git por seguridad)
7. `docker compose up -d` (levanta infraestructura)
8. `cd agent-bot && npm install && npm start`

---

## Mantener el proyecto alineado entre PCs

### Flujo Git
```
Antes de trabajar:  git pull
Despues de cambios: git add . && git commit -m "descripcion" && git push
Al cambiar de PC:   git pull
```

### Que es igual en ambos PCs (se sincroniza con git)
- `agent-bot/` - Todo el codigo del bot
- `tenants.json` - Configuracion de clientes
- `crm-webapp/` - Google Apps Script
- `.env` del proyecto (PORT, EVOLUTION_API_URL, EVOLUTION_API_KEY)

### Que es diferente por PC (NO se sube a git)
- `evolution-api/` en el Mac (instalacion local, esta fuera del repo)
- `docker-compose.yml` se usa en el PC Windows, no en el Mac
- La URL de ngrok (cambia cada reinicio)
- `credenciales-google.json` (debe copiarse manualmente)

---

## Evolution API Manager (interfaz visual)

- URL: http://localhost:8080/manager
- API Key: `beautyos-global-api-key-change-me`
- Aqui puedes ver instancias conectadas, escanear QR, ver contactos/mensajes

---

## Troubleshooting

### El bot no recibe mensajes
1. Verificar que ngrok esta corriendo (`ngrok http 3000`)
2. Verificar que la URL de ngrok esta actualizada en el `.env` de Evolution API
3. Verificar que Evolution API fue reiniciada despues de cambiar la URL
4. Verificar que el bot esta corriendo en puerto 3000

### Evolution API no arranca (EADDRINUSE)
El puerto 8080 ya esta ocupado. Buscar y cerrar el proceso:
```
netstat -ano | findstr :8080
taskkill /PID NUMERO_PID /F
```

### WhatsApp desconectado
1. Ir a http://localhost:8080/manager
2. Click en la instancia
3. Click "Consigue un codigo QR"
4. Escanear con WhatsApp del celular

### Error de credenciales Google Sheets
Verificar que `credenciales-google.json` existe en la raiz del proyecto y tiene los permisos correctos.
