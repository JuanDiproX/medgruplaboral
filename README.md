# MEDGRUP — Telemedicina

App de telemedicina con videollamada real, grabación automática y log de sesión.

## Deploy en Railway

### Paso 1 — Subir el código
1. Creá un repositorio en GitHub (github.com → New repository → "medgrup")
2. Subí todos estos archivos al repositorio

### Paso 2 — Conectar a Railway
1. Entrá a railway.app
2. New Project → Deploy from GitHub repo
3. Seleccioná el repositorio "medgrup"
4. Railway detecta automáticamente que es Node.js y lo despliega

### Paso 3 — Agregar la variable de entorno
1. En Railway, click en tu servicio → Variables
2. Agregá:
   - Nombre: DAILY_API_KEY
   - Valor: (tu API key de Daily.co)
3. Railway reinicia automáticamente con la variable

### Paso 4 — Obtener la URL pública
1. En Railway → Settings → Networking → Generate Domain
2. Te da una URL tipo: medgrup-production.up.railway.app
3. ¡Listo! Esa URL ya funciona

## Variables de entorno necesarias

| Variable | Descripción |
|---|---|
| DAILY_API_KEY | API key de daily.co |
| GOOGLE_MAPS_API_KEY | Geocoding API de Google. Convierte el domicilio del trabajador en coordenadas para el control domiciliario (ausentismo o seguimiento por examen periódico). Es una clave **de servidor**: nunca se manda al navegador. Sin ella hay que cargar latitud y longitud a mano desde el panel. |
| PORT | Puerto (Railway lo setea automático) |

## Lo que funciona hoy

- Crear sala de videollamada real con un click
- Grabación automática en la nube
- Link para el paciente/junta médica
- Link separado para el médico (con controles de moderador)
- Log de actividad en tiempo real
- Historial de consultas de la sesión
