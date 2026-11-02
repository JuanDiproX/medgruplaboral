# Integración de diseño de Claude y correos de ausentismo

Alcance autorizado: solicitud a la empresa e invitación al paciente. Dos destinatarios obligatorios en el alta de un control; correo del paciente obligatorio antes de programar o iniciar un control antiguo. No se agregan destinatarios a turnos históricos ni se disparan invitaciones al desplegar.

## Diseño

Se revisó docs/propuesta-diseno-claude.md y se aplicó docs/rediseno-ausentismo-claude.patch a sus tres archivos versionados. public/claude-demo.css ya existía y se comprobó que su contenido coincidía con el patch; se incorporó sin sobrescribirlo. Registro de casos a todo el ancho, filtros, búsqueda y alta lateral por pasos. Se sumó contención de foco y bloqueo de cierre durante el guardado. Los cambios futuros de otras vistas de Claude se revisan aparte.

## Destinatarios y eventos

- Nueva solicitud de administración o empresa: confirmación al correo de la empresa, sin diagnósticos ni documentación clínica.
- Programación, reprogramación o inicio inmediato: invitación al paciente con su acceso personal a MEDGRUP. La geolocalización sigue siendo condición del acceso domiciliario; no se envía un enlace directo de moderador.
- Nuevo control: reutiliza los correos cargados, con revisión en el formulario antes de guardar.
- Casos anteriores: el correo se pide al programar; no se recrean las salas ni los tokens de ingreso existentes.

## Fiabilidad

cola persistente caso_correos en PostgreSQL. La confirmación de solicitud se agrega en la misma transacción que el caso. Cada notificación tiene una clave única. Repetir la misma programación reutiliza la notificación; cambiar el horario y luego volver al original genera una revisión nueva. Una invitación pendiente de un horario reemplazado no se envía después de reprogramar.

El intento inicial se ejecuta tras guardar. Si falla SMTP, el caso/visita siguen creados y el correo queda pendiente. El proceso revisa cada minuto las tareas vencidas, con cinco minutos entre intentos y un máximo de cuatro intentos automáticos. Luego puede reintentarse manualmente desde Correos. Los mensajes aceptados no se vuelven a enviar por el mismo evento.

Con SMTP no puede garantizarse exactamente un envío frente a una caída entre la aceptación remota y la confirmación en la base. Enviado significa aceptado por el proveedor, no entrega garantizada ni lectura. No se implementaron seguimiento de aperturas ni recepción de rebotes.

## Configuración

El usuario autorizó usar la casilla corporativa ya usada por la web pública. Se copiaron variables SMTP al servicio clínico sin mostrarlas. La contraseña anterior fue rechazada; tras la actualización explícitamente indicada por el usuario, la conexión y autenticación SMTP se verificaron correctamente. No se envió un correo real de prueba ni se guardó la clave en archivos del repositorio.

Variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD y SMTP_FROM. STARTTLS obligatorio en puerto 587; TLS implícito en 465. Los cambios de variables se hicieron con skip-deploys para que se apliquen junto con la versión revisada. No se modificó la configuración del servicio de web pública.

## Comprobaciones

Las pruebas usan datos ficticios y un proveedor simulado. Cubren correos válidos/obligatorios, separación de destinatarios, escape HTML, ausencia de diagnóstico en las confirmaciones, fallo/reintento, deduplicación y sustitución de horario. Las rutas reales de programación se prueban sin Daily, verificando que sala y token existentes se conserven. Se verificaron conexión y autenticación SMTP por separado, sin enviar mensajes.

Comando: npm run test:all. Se revisaron capturas de escritorio/celular de la hoja lateral y se conserva prueba de ausencia de desbordamiento horizontal. No se considera probada la llegada a bandeja de entrada hasta el primer envío real autorizado a un destinatario confirmado.
