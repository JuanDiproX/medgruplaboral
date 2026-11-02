# Preparación conjunta de la demostración — miércoles 4 de noviembre

Actualización: lunes 2 de noviembre de 2026. Portal: medicinalaboral.medgrup.com.ar. Turno operativo informado por el usuario: hoy a las 16, hora argentina; hora de finalización desconocida.

## Responsabilidades y archivos

Codex: backend, base, permisos, migraciones, geolocalización, enlaces, videollamada, chat, estados, informes, pruebas e integración/despliegue. Archivos: server.js, lib/, document-pdf.js, package*.json, public/*.js, tests/, test/ y scripts de prueba.

Claude: revisión y mejoras visuales del panel, en `public/claude-demo.css` como archivo nuevo. Puede proponer cambios adicionales de HTML en un documento, pero la integración de esos cambios la hará Codex para evitar ediciones simultáneas de public/index.html. No editar public/ausentismo-flow.js ni CSS funcional de llamada o estilos de documentos PDF. No crear HTML de reemplazo que pierda IDs, funciones o atributos del panel.

La separación es una forma de trabajar; puede ampliarse si ambos agentes acuerdan primero un archivo y una tarea. Si Claude ya está trabajando, leer git diff antes de cambiar cualquier archivo. No hacer stash, reset, clean ni sobrescribir trabajo del otro agente.

## Prioridades y criterios

1. Publicar y verificar la versión funcional probada; preservar turno, sala y enlaces existentes. El primer despliegue cambia sesiones en memoria por persistentes y requiere volver a entrar una vez.
2. Validar circuito de ausentismo: datos + domicilio + mapa + profesional + certificados en una carga; borrador; corrección de dirección sin perder datos; nuevo control vinculado al historial.
3. Validar asistencia y no comparecencia por separado. La ubicación aceptada no es ingreso a la videollamada. Documentos con horarios observados, tolerancia prevista de 20 minutos y sin completar tiempos desconocidos.
4. Refinar diseño: jerarquía, etiquetas, espaciado, estados de error/carga, acciones principales, archivos y adaptación móvil.
5. Ensayo completo con datos ficticios: PC médico + teléfono paciente, luego dos médicos; GPS concedido/denegado/fuera de rango; chat y archivo; reingreso y descargas.
6. Revisar PDFs de una y varias páginas; firmas y nombres en el mismo bloque; acta e informe coherentes.
7. Ensayo comercial de 15–20 minutos y material de respaldo. No confundir capacidades simuladas de pruebas locales con integraciones externas verificadas.

## Calendario

- Lunes por la mañana: despliegue funcional y verificaciones de servicio/versión. Claude puede trabajar en diseño en paralelo, sin despliegues propios.
- Antes del turno de hoy: comprobar que médico puede iniciar sesión y que los enlaces ya enviados siguen asociados al mismo turno. No crear/reprogramar ni regenerar salas del turno real para probar.
- Desde las 15:30: evitar despliegues/reinicios hasta comprobar que concluyó la consulta, salvo incidente operativo que lo exija. El margen es una decisión operativa, no prueba de que la consulta finalice a una hora concreta.
- Lunes restante y martes: integración visual y ensayo con usuarios ficticios. Prioridad a fiabilidad sobre nuevas funciones.
- Martes al terminar: versión candidata estable y recorrido ensayado. Miércoles antes de la reunión: solo comprobaciones de salud; no nuevas funcionalidades.

## Revisión técnica antes de publicar

- `node --check server.js` y `npm run test:all`.
- Instalar con Node 22 >=22.12, requerido por Puppeteer actualizado.
- Desplegar un paquete limpio de archivos versionados al servicio `medgruplaboral`, nunca el paquete del sitio público.
- Confirmar despliegue exitoso en Railway y activos nuevos/version en el dominio clínico. Subir a main no equivale a confirmar el despliegue.
- No imprimir variables, tokens de paciente, credenciales ni documentación clínica en mensajes o logs de diagnóstico.
- No cambiar SESSION_SECRET: las cuentas antiguas se migran al autenticar. La reversión a código que solo entiende hashes anteriores dejaría fuera a cuentas ya migradas; conservar compatibilidad scrypt si hay que revertir otra función.

## Prompt para Claude

Trabajamos sobre la app web de medicina laboral MEDGRUP, repositorio actual. La demostración para Laboral Salud es el miércoles 4 de noviembre. Hoy hay un turno real a las 16, hora argentina.

Tu responsabilidad es mejorar el diseño del panel, especialmente el alta y seguimiento de controles de ausentismo: lectura clara, domicilio y mapa integrados, estados de validación y error, profesional, archivos y acción de continuar. Mantener el lenguaje visual existente de MEDGRUP: tinta marino, papel cálido, magenta para urgencia y radios discretos. Usar las skills de diseño disponibles y leer PRODUCT.md y esta coordinación antes de trabajar.

Codex se ocupa de lógica, pruebas y producción. Trabajá en un archivo nuevo `public/claude-demo.css`; dejá las propuestas estructurales en `docs/propuesta-diseno-claude.md`. Por ahora no edites public/index.html, server.js, lib/, document-pdf.js, package*.json ni los JS de public. Codex incorporará el CSS y cualquier ajuste de HTML una vez revisado. No alteres IDs, eventos, rutas, enlaces, permisos, flujo de firma, geolocalización ni estados de asistencia. No regeneres salas ni uses datos de pacientes reales para la demo. No hagas commit/push/deploy ni descargas de credenciales. Presentá qué cambiaste, capturas desktop/móvil y limitaciones reales, sin inventar funciones o beneficios clínicos.

## Estado verificable inicial

Commit funcional preparado: f167d23. La última consulta de Railway a las 9:31 de Argentina del lunes mostró producción en 395c678. Las 32 pruebas locales del cambio funcional pasaron en el trabajo previo; resta confirmar el despliegue y el ensayo externo.

## Publicación confirmada el lunes por la mañana

Despliegue `a0253f6d-7ca5-42eb-8003-b330a2b400d2`: SUCCESS en Railway. Paquete limpio del commit f167d23, servicio medgruplaboral. Las 32 pruebas se ejecutaron nuevamente antes de publicar y pasaron.

Verificación de solo lectura del dominio clínico: salud OK, contenido de los seis recursos de interfaz igual al commit (normalizando CRLF/LF), y versión del servidor `fe8cdc539a53c8f6` consistente con los recursos que entrega. Comando repetible: `node scripts/verify-clinical-deployment.cjs f167d23`.

No se crearon ni reprogramaron turnos ni salas durante estas comprobaciones. No se probó el acceso del médico ni se leyó la ficha del paciente de las 16; la validación autenticada y entre dispositivos sigue pendiente. Recargar e iniciar sesión antes de la consulta por el cambio inicial de sesiones.
