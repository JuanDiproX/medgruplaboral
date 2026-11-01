# Cambios locales de ausentismo y preparación de la muestra

Fecha: 01/11/2026. Sin commit, push ni despliegue de estos cambios.

## Circuito de carga

El formulario de alta ahora reúne trabajador, domicilio, búsqueda geográfica, vista del mapa, radio, profesional y certificados. «Guardar y continuar» busca el domicilio si hace falta y guarda sus coordenadas junto con el caso; después abre programación si ya se eligió profesional, o asignación en caso contrario.

Un error de dirección conserva los datos en el mismo formulario. Hay ajuste manual de punto y guardado como borrador. Los resultados de búsquedas antiguas no se aplican si cambió la dirección. El mapa externo requiere conexión a Google y solo recibe las coordenadas del punto mostrado, no el nombre del trabajador.

«Nuevo control» de un caso cerrado precarga identidad, empresa, contacto, domicilio y profesional activo, y permite revisar antes de guardar. El motivo del nuevo control se completa de nuevo. Mantiene el vínculo con el anterior y su historial; no copia certificados, firmas, tokens, registros de asistencia ni excepciones de geolocalización. Las excepciones deben autorizarse de nuevo. La creación usa transacción y bloqueo para evitar duplicaciones del mismo control posterior.

## Correcciones funcionales

- Clasificación compartida en acta e informe de inasistencia: ubicación aceptada no equivale a incorporación a la llamada.
- El documento de inasistencia requiere cierre registrado. Un control abierto no se imprime automáticamente como inasistencia.
- La espera se calcula entre primer ingreso médico registrado y último cierre: es una ventana transcurrida, no una certificación de conexión ininterrumpida. No se completan 20 minutos por defecto.
- Tolerancia prevista separada del tiempo real; el cierre explícito por inasistencia exige 20 minutos y no fabrica un inicio al cerrar.
- Primer ingreso, último cierre y presencia de paciente prevalecen sobre la mera verificación geográfica.
- El indicador de inasistencia se conserva en la agenda y sus documentos se descargan con sesión.
- Los enlaces vigentes de invitación se reutilizan cuando SESSION_SECRET está configurado. Tokens recuperables cifrados, hashes para autenticación, bloqueo por turno y revocación. Enlaces anteriores conservan sus condiciones originales de validez.
- Cambiar domicilio/radio/excepción o reprogramar requiere verificar nuevamente el acceso geográfico, manteniendo el acceso documental.
- Roles nuevos en tokens de Daily; invitado separado de paciente; coincidencia exacta para participantes antiguos. La alternativa al webhook firmado consulta a Daily y usa sus metadatos.
- El panel de llamada distingue otro profesional de la presencia del paciente.
- Validación de coordenadas y precisión, incluso en edición administrativa.

## Seguridad y documentos

- Política por recurso antes de las rutas de turno/dictamen; listado de dictámenes filtrado por asignación.
- El listado de turnos para empresas no entrega credenciales de moderación de Daily.
- Contraseñas nuevas con scrypt y sal. Compatibilidad con el formato anterior y migración tras autenticación correcta.
- Sesiones de 12 horas, guardadas con token hash en PostgreSQL y recuperadas al iniciar. Logout persistido. El despliegue inicial requiere volver a entrar porque las sesiones del sistema previo solo existían en memoria.
- Límite de intentos en login/recuperación. La caché de sesiones y el contador de intentos siguen siendo por proceso; no se presenta como arquitectura validada para varias réplicas.
- Edición de dictamen archiva contenido y firmas anteriores en dictamen_revisiones, realiza el cambio en transacción e invalida firmas/PDF firmado vigentes; exige nueva firma. El archivo anterior se conserva en la revisión.
- Escape de varios campos de texto en los principales templates de informe y acta. Esto no constituye una auditoría XSS completa de todas las pantallas históricas.
- Cola local acotada de PDF: admite descargas simultáneas sin rechazar automáticamente la segunda.
- Puppeteer actualizado y dependencias compatibles corregidas. npm audit terminó con cero vulnerabilidades reportadas en esta ejecución; no es garantía de ausencia de fallas.

## Pruebas

Comandos reproducibles con npm ci:

Se declara Node 22 (mínimo 22.12), compatible con la versión actualizada de Puppeteer; la verificación se realizó con Node 22.15.1.

```
npm run test:all
node --check server.js
```

32 pruebas aprobadas: 29 unitarias/de UI/documentos/sitio y 3 de integración SQL/HTTP. Las pruebas de integración usan PGlite, no la base de producción. La prueba de rutas carga las declaraciones reales del servidor sin ejecutar initDB ni registrar webhooks remotos. También comprueba login con migración y conservación de revisión firmada.

El navegador de prueba usa Chrome local (o PUPPETEER_EXECUTABLE_PATH) y datos ficticios. Las capturas están en output/ausentismo-preview/escritorio.png y celular.png. Las pruebas UI bloquean solicitudes externas; no validan el mapa real de Google ni la precisión de un GPS.

El detector de diseño de los dos archivos nuevos de interfaz no reportó hallazgos.

## Antes de la demostración del lunes

- Probar con configuración de prueba propia: PostgreSQL, Daily, Google y, si se muestra redacción, Anthropic. No arrancar una instancia local con las claves de producción: el servidor registra webhooks al iniciar.
- Confirmar SESSION_SECRET persistente; no cambiarlo sin una estrategia para las contraseñas antiguas todavía no migradas. No se cambió ningún secreto de producción.
- Ensayar PC como médico y celular como paciente: permisos, GPS dentro/fuera, ubicación denegada, chat/archivo, dos médicos sin paciente, reconexión, acta e informe.
- Revisar visualmente PDFs completos de muestra, firma y paginación.
- Usar una instalación y datos ficticios separados. No se ha creado todavía la instalación de otra prestadora ni una integración con el software de Laboral Salud.
- Confirmar backup/restauración, políticas de conservación, medición de consumo y condiciones de servicio antes de ofrecer operación comercial.
- La expiración de salas a 30 días desde la creación sigue requiriendo una política de renovación para turnos lejanos; no se crean nuevas salas ni se alteran enlaces de producción en este trabajo.

Se preservó la modificación previa del usuario en docs/publicacion-railway.md y los demás archivos auxiliares existentes.
