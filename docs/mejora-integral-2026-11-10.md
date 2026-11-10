# Mejora integral del portal — 10 de noviembre de 2026

Rama: `claude/mejora-integral`, creada desde `6f94504` (igual a `origin/main`). Sin push ni despliegue.
Todo se probó en local con base embebida y datos ficticios; no se tocó producción, Railway, Daily ni datos reales.

## Qué cambió

### 1. Seguridad

| Antes | Ahora |
|---|---|
| Sin cabeceras de seguridad | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS en producción, `Permissions-Policy` y CSP. La parte que no puede romper nada (`frame-ancestors`, `base-uri`, `form-action`, `object-src`) se aplica; la política completa de scripts va en modo informe y registra en el log (`csp_informe`) lo que bloquearía. |
| `cors()` abierto a cualquier origen | Solo el propio origen, más los declarados en `ORIGENES_PERMITIDOS` |
| Límite de intentos solo por email | Además por IP en login, recuperación de clave, ingreso del paciente, verificación y enlaces cortos |
| IP tomada de `X-Forwarded-For` (falsificable) en los registros de ubicación y firma | `trust proxy` + `req.ip` |
| 113 respuestas devolvían `err.message` (nombres de tablas, consultas) | `fallo()`: los errores de base o de código devuelven un mensaje genérico con código de referencia y se registran en el log; los mensajes propios de la aplicación se siguen mostrando |
| Contraseñas de 6 caracteres | 10 caracteres con letras y números (solo para claves nuevas; las actuales siguen entrando) |
| Token de recuperación en claro en la base | Se guarda su huella; pedir uno nuevo invalida el anterior; al cambiar o recuperar la clave se cierran las demás sesiones |
| **XSS almacenado**: nombres de archivo, de médicos, empresas, pacientes y títulos se insertaban sin escapar en el panel y en el portal de empresas. Una empresa podía subir un certificado con un nombre de archivo malicioso y ejecutar código en la sesión de administración. | 34 puntos escapados en `index.html` y 8 en `empresa.html`; el servidor además limpia los nombres de archivo |
| Sin registro de quién hizo qué | Tabla `auditoria`: altas, cambios, bajas, ingresos y descargas de documentos, con actor, ruta, resultado e IP. Consulta: `GET /api/admin/auditoria` |
| Correos de reunión y recuperación interpolaban texto sin escapar | Escapados |

### 2. Enlaces cortos

`https://medicinalaboral.medgrup.com.ar/i/k7m2xq9fhd` en lugar de `…/atencion.html#token=<64 caracteres>`.

- `lib/short-links.js`, tabla `enlaces_cortos`. El enlace corto solo redirige: el permiso, el vencimiento y la revocación siguen en el token original.
- En la base no queda el código ni el destino en claro (huella + cifrado con clave derivada del código).
- Solo se acortan direcciones del propio portal o de `daily.co`; no sirve como redirector abierto.
- El mismo destino conserva su enlace corto. Si el acortador falla, se entrega el enlace largo.
- **Los enlaces ya emitidos siguen funcionando igual.** No se modifican salas, tokens ni invitaciones existentes.
- Se usa en: invitación del paciente, accesos personales de profesionales, correo de visita, invitados y reuniones.
- Mensajes de WhatsApp unificados (`mensajeInvitacion` en `index.html`): saludo por nombre de pila, tipo de consulta, fecha, enlace en su propia línea e indicación domiciliaria cuando corresponde.

### 3. Paciente en el celular y geolocalización

- `ingreso.html/css/js` rediseñado para una mano: hora del turno como dato principal, pasos reales, acción fija abajo.
- Dial de radio domiciliario: late mientras busca señal, verde al validar, muestra el punto afuera cuando la lectura quedó lejos (sin revelar dirección).
- **Afinado de GPS**: si la primera lectura llega con más de 120 m de margen, se espera hasta 9 s a que mejore antes de enviarla. Reduce rechazos por "señal débil" que no eran culpa del paciente.
- Ayuda específica para iPhone y Android; aviso cuando el enlace se abrió dentro de Instagram/Facebook, que suelen bloquear la ubicación.
- El mensaje de error se trae a la vista (antes podía quedar debajo del pliegue).
- `atencion.css`: en celular la videollamada ocupa el ancho completo y el chat queda debajo.
- `enlace-vencido.html`: página propia para enlaces cortos inválidos.
- El circuito es el mismo para ausentismo, seguimiento médico y examen periódico (los tres usan `casos_ausentismo` + `/ingreso`). Las reglas del servidor (radio, precisión máxima, registro de intentos, excepción) no cambiaron.

### 4. Importar planilla (base para SaaS)

Menú **Importar planilla** (solo administración).

1. Se sube un `.xlsx` o `.csv` tal como lo tiene el cliente (hasta 5 MB y 5000 filas).
2. El sistema reconoce las columnas por su título (acepta "Nro. Documento", "Celular", "Dirección", apellido y nombre separados, CUIL, fechas de Excel) y deja corregir el mapeo.
3. Vista previa fila por fila: lista, con aviso, repetida (ya tiene un caso abierto o está dos veces en el archivo) o con error (sin nombre, empresa no cargada).
4. Al confirmar se crean casos en estado *nuevo*, sin profesional ni turno. Se vinculan a legajos de seguimiento abiertos igual que el alta manual.
5. Cada importación queda registrada y se puede **deshacer** mientras los casos no se hayan asignado, programado ni tengan documentos.

También importa padrones de trabajadores por empresa. Hay plantilla descargable.
`lib/planilla.js` lee solo valores de celdas (sin fórmulas ni macros) con una única dependencia nueva: `fflate`.

### 5. Presupuestos

Fuera del menú y de las pantallas. Se conserva el catálogo de servicios (menú **Servicios**). Las tablas no se tocaron: los presupuestos emitidos se pueden seguir descargando y verificando por QR. `POST /api/presupuestos` responde 410 salvo `PRESUPUESTOS_HABILITADOS=true`.

### 6. Visual

`public/medgrup-ui.css`, cargado al final: radios y superficies coherentes con las pantallas del paciente, respuesta al toque en botones y menú, foco visible, fondo de modales, alturas táctiles en celular. No cambia la identidad acordada (tinta marino, papel cálido, Caslon, magenta para lo urgente) ni IDs, eventos o flujos.

## Antes de publicar

1. `npm ci` (hay una dependencia nueva: `fflate`).
2. Variables: confirmar que `SESSION_SECRET` y `PARTICIPANT_ACCESS_SECRET` estén definidas en Railway. Opcional: `ORIGENES_PERMITIDOS`.
3. Al arrancar se crean solas las tablas `auditoria`, `enlaces_cortos`, `importaciones` y la columna `importacion_id`. No hay migraciones destructivas.
4. Publicar fuera del horario de turnos. Después del despliegue, mirar el log por líneas `csp_informe` durante unos días: indican qué habría que permitir antes de pasar la CSP completa a modo estricto.
5. Ensayo con dispositivos reales: un ingreso domiciliario desde iPhone y otro desde Android (permiso concedido, denegado y fuera de rango), y una invitación por WhatsApp con enlace corto. En local se probó con navegador emulado, no con GPS real.
6. Las claves nuevas piden 10 caracteres: avisar a quien administra usuarios.

## Pendiente y recomendado

- **El repositorio de GitHub figura como público en un comentario del código.** Para un producto que maneja datos de salud y se va a vender, conviene pasarlo a privado.
- La sesión del panel vive en `localStorage`. Con el XSS corregido el riesgo baja, pero el paso siguiente es una cookie `HttpOnly` + CSP estricta (requiere sacar los scripts en línea de `index.html`).
- Segundo factor para administración.
- Archivos (certificados, informes, firmas) guardados como base64 en PostgreSQL: funciona, pero a escala SaaS conviene almacenamiento de objetos cifrado.
- La empresa se identifica por nombre (`turnos.empresa = nombre`): renombrar una empresa desvincula sus turnos. Se resuelve en la etapa 1 del plan multi-organización.
- `pg` con `rejectUnauthorized:false`: aceptable dentro de la red de Railway, a revisar si la base se mueve.
- Las dos pruebas del sitio público (`public-commercial`) fallan en este entorno por rutas locales de Windows/Node; fallaban igual antes de estos cambios.

Plan multi-organización: `docs/saas-multi-organizacion.md`.
