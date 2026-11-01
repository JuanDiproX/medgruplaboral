# Auditoría de preparación para la demostración de MEDGRUP

Fecha: 30/10/2026. Reunión prevista: lunes 02/11/2026.

## Alcance y conclusión

Revisión estática de backend, frontend de agenda, portal de atención, chat, geolocalización, documentos, autenticación, configuración de despliegue y pruebas disponibles. Ejecución de pruebas locales con datos ficticios. No se inició server.js contra producción ni se modificaron datos, salas, webhooks o configuración remota.

El producto ya reúne un circuito comercial demostrable, pero no debe declararse completamente validado. La fiabilidad documental, los permisos por recurso y un ensayo completo con dispositivos reales son prioridades antes de la reunión. Una licencia para otra prestadora requiere separación de datos e instalación propia o arquitectura por organizaciones.

No se comprobó qué commit está efectivamente ejecutándose en Railway, disponibilidad real de proveedores, backups, facturación, credenciales desplegadas ni apariencia visual del panel autenticado. Las conclusiones sobre comportamiento provienen del código salvo cuando se indica una prueba ejecutada.

## Mapa funcional

| Módulo | Evidencia | Comprobación pendiente |
|---|---|---|
| Acceso de administración, médicos y empresas | Sesiones y middleware distintos; agenda filtra médicos asignados | Permisos uniformes en todas las rutas; reinicio durante sesión |
| Agenda y turnos | Creación, edición, estados, links por profesional | Ensayo completo y reprogramación sin pérdida de acceso |
| Videollamada y juntas | Salas Daily, tokens por participante, panel embebido | Cámara, micrófono, móviles, varios médicos y reconexión |
| Ubicación | Geocodificación de domicilio y distancia a coordenadas del dispositivo | GPS real, precisión, rechazo, reintento y excepción |
| Chat y archivos | Acceso por turno, tokens con hash, límites y autorización de descargas | Usabilidad simultánea a la llamada y móviles |
| Informes e IA | Generación, edición, documentos y firmas | Ejemplo clínico ficticio, demora/error de IA, revisión médica |
| Actas e inasistencia | Rutas y templates existentes | Unificar criterios y tiempos reales antes de mostrar |
| Portal de empresas | Casos, documentos y autenticación propia | Validación entre dos empresas de prueba |
| Seguimientos | Legajos, vínculos y resúmenes | Identidad del paciente, duplicados y revisión de vínculos |
| Operación | Railway, Chromium y endpoint de versión | Backup restaurable, monitoreo, rollback y ensayo de carga |

## Hallazgos prioritarios

### P0 — Inasistencia y espera no tienen una única fuente de verdad

Evidencia: server.js, rutas `/api/turnos/:id/acta`, `/api/turnos/:id/informe-inasistencia` y POST de inasistencia.

- El acta usa 20 minutos como valor por defecto si falta el inicio o el fin. Esto puede presentar como medido un tiempo desconocido.
- El informe suma exactamente 20 minutos al inicio; no consulta el cierre real. Puede contradecir el acta.
- El cierre por inasistencia no exige que hayan transcurrido 20 minutos y puede completar el inicio con NOW() al cerrar.
- El acta prioriza control_iniciado_en frente al ingreso de la médica; son instantes diferentes y no equivalen siempre al tiempo que permaneció conectada.
- Con reconexiones, restar primer inicio y primer fin no demuestra presencia continua. Debe definirse si se informa ventana transcurrida o conexión efectiva.
- La validación de ubicación aceptada o una excepción pueden impedir declarar inasistencia aun sin evento de unión a la videollamada.
- El acta puede entrar en la rama de inasistencia antes de un cierre explícito; falta distinguir pendiente, en espera, asistió y no compareció.

Acción: compartir un cálculo y una clasificación para agenda, acta, informe y portal. Separar hora pactada, inicio operativo, primer ingreso médico, ingreso paciente y cierre. Datos faltantes deben mostrarse como no registrados; no inventar tiempos. La tolerancia prevista debe estar separada de la espera observada.

Criterios: un caso sin paciente, uno con paciente, validación geo sin llamada, reingreso, falta de cierre y cierre antes de tolerancia. Documento y pantalla deben coincidir.

### P0 — Autorización por recurso incompleta

Evidencia: server.js, GET de dictámenes y sus datos, PATCH de dictamen, PATCH de estado de turno, POST/GET de eventos e informe de inasistencia.

Varias rutas comprueban que el usuario inició sesión, pero no verifican en el handler la asignación al turno o dictamen. El filtro visual de agenda no reemplaza la autorización del servidor. Otras rutas, como el acta, ya usan turnoVisiblePara; el chat verifica asignación.

Acción: aplicar una política compartida a lectura, modificación, eventos, firma y descarga. Probar médico A contra turno de B; empresa A contra documentos de B; usuario no autenticado. No se intentó explotar estas rutas en producción.

### P1 — Botón de inasistencia pierde el indicador al cargar agenda

Evidencia: `/api/turnos` devuelve inasistencia; public/index.html transforma data mediante map sin copiarla y luego evalúa t.inasistencia para mostrar el botón.

Además, el criterio SQL contempla un caso resuelto o tipo Control de licencia, pero no cubre de forma equivalente todos los controles antiguos de ausentismo. El listado de casos ofrece informe a todos los resueltos, incluidos potencialmente asistentes, y el enlace del informe usa apertura directa contra una ruta que exige encabezado de sesión.

Acción: clasificación común y descarga autenticada mediante el mecanismo existente de descargas. Ocultar la acción cuando no corresponda.

### P1 — Invitaciones distintas son válidas para el mismo turno, con condiciones

Evidencia: lib/turno-chat.js, invite() crea un token aleatorio y añade un acceso sin revocar los anteriores. patient() resuelve el turno almacenado; callLink() obtiene su link_paciente.

Conclusión: generar otra invitación no crea otra sala por sí mismo. Los enlaces anteriores siguen asociados al turno hasta vencimiento o revocación; un turno cancelado/completado limita el acceso a la llamada. No corresponde asegurar que cualquier link funciona indefinidamente.

Acción: presentar caducidad, estado y acción explícita de renovación; considerar enlace reutilizable con diseño seguro. Probar dos invitaciones sucesivas, recarga, revocación y reprogramación.

Las salas se crean con expiración a 30 días desde su creación; reprogramar más allá de esa ventana requiere política de renovación. Los tokens Daily no incluyen expiración explícita en crearMeetingToken; revisar ciclo de vida y privacidad de salas en el entorno real.

### P1 — Clasificación de asistentes y estado visual de llamada

Evidencia: webhook Daily clasifica por owner y coincidencias parciales de nombre; no verifica que todo no-médico sea el paciente. public/llamada.js muestra En consulta si hay cualquier participante remoto.

Consecuencia: otro médico o invitado puede disparar un estado que visualmente parezca presencia del paciente; un tercero puede ser registrado como union_paciente. Los eventos de unión tampoco están deduplicados en ese handler.

Acción: identificar rol y paciente con identificador estable, conservar reingresos en auditoría y derivar un resumen sin duplicaciones engañosas. Probar médico+médico, médico+paciente y médico+invitado.

### P1 — Geolocalización: validación de entrada y alcance de la evidencia

Evidencia: POST de verificación valida presencia de lat/lng y precisión máxima, pero no tipos numéricos finitos, rangos geográficos o precisión negativa antes del cálculo. La autorización del chat queda almacenada en el token.

Acción: validar números y rangos, controlar vida útil de la autorización, distinguir error técnico/rechazo/no comparecencia. Google ubica la dirección; el dispositivo informa la ubicación. Eso no constituye por sí solo una verificación infalible de identidad o permanencia en domicilio.

### P1 — Sesiones y credenciales

Evidencia: sessions y empresaSessions son objetos en memoria; no se observa expiración temporal en middleware. Un reinicio elimina sesiones; varias réplicas no compartirían ese estado. hashPassword usa HMAC con secreto global y existe valor de respaldo en código. Hay endpoint administrativo que detecta contraseñas históricas conocidas.

Acción: confirmar configuración real sin publicar secretos; sesiones con duración definida y persistencia; migración planificada a hashes de contraseña con sal y factor de trabajo. Cambiar el secreto actual sin migración puede invalidar accesos. Revisar limitación de intentos de login y recuperación.

### P1 — Datos interpolados en HTML

Evidencia: nombres, empresas y otros campos se interpolan directamente en varios templates del servidor; el HTML de vista previa se entrega al navegador. El renderer PDF deshabilita JS, pero esto no protege la vista previa HTML.

Acción: escape por contexto para campos de texto y sanitización explícita para contenido enriquecido. Verificar con datos ficticios que símbolos y etiquetas no se ejecuten ni rompan el documento.

### P1 — Firmas y versión del documento

Evidencia: firma de dictamen guarda hashDictamen(d), pero el PATCH permite editar el documento y no invalida firmas en ese handler.

Acción: verificar comparación del hash en todas las salidas, definir revisión/versionado y exigir nueva firma cuando cambia el contenido firmado. No presentar una firma dibujada como una certificación digital de una autoridad sin verificar el mecanismo.

### P2 — PDF, concurrencia y formatos

El generador bloquea una segunda generación concurrente con una variable active. Devuelve HTML salvo download=1; la descarga requiere encabezados de autenticación. Un usuario puede recibir un error al descargar mientras otro PDF se prepara.

Acción: cola acotada o respuesta de reintento clara; probar acta e informe reales ficticios de una y varias páginas, firmas juntas con su identificación y dos descargas simultáneas. La prueba técnica aprobada no valida todos los templates visualmente.

### P2 — Comercialización y mantenimiento

La instalación tiene marca y datos de MEDGRUP, una base global y correcciones históricas específicas dentro del arranque. No se observa separación completa por prestadora. Hay identificaciones por nombre y empresa textual que necesitan revisión para evitar asociaciones incorrectas.

Acción: primer cliente en instalación/base independiente, variables de marca, backups y migraciones controladas. No prometer integración, marca blanca, funcionamiento ilimitado o disponibilidad contractual sin relevamiento.

## Verificación ejecutada

- node --check server.js: aprobado.
- node --test test/turno-chat.test.js: 9 aprobadas.
- node --test tests/document-download.test.js: 3 aprobadas al permitir Chrome fuera del sandbox.
- node --test test/chat-postgres.integration.js: 1 aprobada con Express y PGlite local aislado.
- node --test tests/public-commercial.test.cjs: 2 aprobadas.

Total de suites ejecutadas por separado: 15 pruebas aprobadas. El primer intento combinado encontró restricciones locales de Chrome/HTTP; esas suites pasaron fuera del sandbox. No se usaron credenciales ni información de pacientes reales. Estos resultados no equivalen a una prueba integral del backend, PostgreSQL de producción, GPS, IA o Daily.

## Trabajo propuesto para el fin de semana

### Viernes: fijar entorno y recorrido

- Crear entorno de demostración aislado con usuarios y empresa ficticios, base y configuración de proveedores propias.
- Registrar versión, configuración necesaria y procedimiento de rollback.
- Definir cinco casos: ausentismo que asiste; ausentismo que no asiste; problema de ubicación; seguimiento con estudio adjunto; junta con dos médicos.

### Sábado: corregir fiabilidad funcional

1. Criterio compartido de asistencia, espera e inasistencia y pruebas de regresión.
2. Autorización de recursos y descargas autenticadas.
3. Indicador/botón en agenda y casos.
4. Invitaciones, caducidad y reprogramación.
5. Identificación de participantes y validación de coordenadas.

### Domingo: ensayo y presentación

- Médico desde PC y paciente desde teléfono; repetir en otra conexión y con permisos denegados.
- Dos médicos sin paciente no deben producir asistencia de paciente.
- Reingresar y recuperar chat sin perder documentos.
- Descargar PDF como médico y como empresa autorizada; comprobar bloqueo cruzado.
- Revisar firma, saltos de página y coherencia de datos y horas.
- Probar IA con notas ficticias; revisión médica antes de emitir, tratamiento de demora/error.
- Ensayar recorrido de 15 minutos y preparar capturas o video de respaldo con datos ficticios.
- Dejar una versión estable y volver a comprobar después del despliegue de demo.

## Condición de listo para mostrar

Debe poder repetirse el recorrido sin intervención en base de datos ni cambios de código: crear caso, invitar, verificar ubicación, llamar, compartir archivo, cerrar y descargar documentos coherentes. El camino de inasistencia debe producir datos reales y el de otra empresa debe quedar bloqueado. Si una parte sigue pendiente, presentarla como pendiente, no como capacidad validada.

Esta auditoría no aplica cambios funcionales ni despliega. Es una base verificable para ejecutar las correcciones en orden.
