# Chat con adjuntos por turno

Chat habilitado por defecto para todas las consultas médicas con turno. Para desactivarlo, configurar `ENABLE_TURNO_CHAT=false`. Los enlaces antiguos de Daily no se transforman: reenviar la invitación desde MEDGRUP para acceder al chat.

## Demo sin servicios reales

Ejecutar `node scripts/chat-demo.js` y abrir http://127.0.0.1:3499. Desde allí abrir las vistas del médico y del paciente. Permite enviar mensajes y adjuntos usando el mismo módulo de rutas y la misma interfaz, con almacenamiento simulado en memoria. No carga `.env`, no inicia `server.js`, no conecta PostgreSQL ni Daily. Los datos desaparecen al detener el proceso. No compartir datos reales en esta demo.

## Funcionamiento

- Agenda y pantalla de llamada: botón **Chat y estudios**, visible únicamente si la función está habilitada y su inicialización termina correctamente.
- Las invitaciones habituales de turnos y la respuesta al programar/iniciar ausentismo generan el enlace personal a MEDGRUP cuando la función está habilitada. El nombre proviene del turno: la paciente no completa usuario, contraseña ni nombre. Abrir nuevamente las invitaciones genera un enlace nuevo válido hasta 48 horas después del turno, o desde su generación si el turno ya pasó.
- Médico asignado o administrador: también puede generar el enlace desde el chat. No se envían mensajes ni invitaciones automáticamente. El botón Recordar también genera el enlace de MEDGRUP. Los enlaces de Daily ya compartidos conservan su funcionamiento, sin este chat.
- Paciente: ingresa por el enlace sin registrarse; puede enviar mensajes y PDF/JPG/PNG/WEBP de hasta 5 MB. Máximo 50 MB y 1.000 mensajes por turno.
- Los mensajes se actualizan cada tres segundos. Quedan asociados al turno en PostgreSQL; se pueden consultar desde la agenda una vez completado.
- Enlaces personales válidos hasta 48 horas después del horario programado o de su creación (lo que ocurra más tarde), revocables desde el chat. El token se guarda como hash en la base y viaja en el fragmento del enlace, no en su query.
- Los archivos requieren autorización en cada descarga. No se publican enlaces abiertos ni se muestran automáticamente en el portal de la empresa o en el informe médico.
- Ausentismo: se pueden enviar documentos antes del ingreso. La llamada requiere la verificación de ubicación existente o la excepción autorizada del caso. Solo después de esa autorización se entrega el acceso a la videollamada dentro del portal. Si falla la creación del acceso de chat, se mantiene el enlace habitual de Daily.
- Seguimientos: el enlace nuevo abre la llamada y chat dentro de MEDGRUP. Los enlaces antiguos de Daily siguen funcionando, pero no muestran este chat.

## Activación y comprobación

En un entorno de prueba con una **base independiente**, establecer `ENABLE_TURNO_CHAT=true`. Al iniciar se crean `chat_accesos` y `chat_mensajes`. Con `ENABLE_TURNO_CHAT=false` no se crean tablas ni se cambia el enlace de ingreso. Un fallo de inicialización deshabilita el chat y permite el arranque habitual.

No ejecutar `server.js` con credenciales de producción para hacer pruebas: su arranque habitual registra el webhook de Daily. La demo evita ese arranque por completo. La validación SQL/HTTP se ejecutó con PostgreSQL WASM aislado (PGlite) y Express. Verificar cámara/micrófono y audio en una llamada de prueba entre dos dispositivos; las pruebas automatizadas no sustituyen esa comprobación.

## Validación

`node --test test/turno-chat.test.js`

Las pruebas usan un adaptador de base simulado: cubren desactivación, autorización por profesional, geolocalización, caducidad/revocación, adjuntos y aislamiento por turno, cuotas y alternativa de ingreso ante error. No prueban el motor SQL ni servicios externos.

Prueba adicional de SQL real aislado: `npm install --prefix tmp/chat-validation --no-package-lock @electric-sql/pglite express` y `node --test test/chat-postgres.integration.js`. No requiere credenciales ni se conecta a producción.

El chat de documentos corresponde a consultas médicas (ausentismo, seguimiento, junta y demás tipos de turno). El módulo separado de reuniones comerciales mantiene su flujo existente.
