# Integración del listado compacto de Ausentismo

Integrado el parche de Claude del 3 de noviembre sobre `084c934`.

La lista muestra identidad, estado, resultado y acción principal. El detalle y los documentos se abren aparte; el selector Estado conserva los valores anteriores. Se conservan la agrupación de controles, el mapa y los archivos del alta.

Ajustes de integración de Codex:

- Retirados `au-documentacion` y sus referencias en los dos caminos de alta del frontend. Las nuevas solicitudes omiten ese campo; el servidor ya admite su ausencia y guarda vacío. No se alteró el esquema ni la documentación histórica, que se sigue mostrando en el detalle.
- El selector de estado conserva su elemento y foco al filtrar. El detalle conserva el foco de la acción y el desplazamiento cuando se actualiza la lista, y devuelve el foco a la fila al cerrar.
- Fecha y hora se escapan antes de insertarse en el HTML del listado y del detalle.

Validación: `node --check server.js`, `node --check public/ausentismo-flow.js` y `npm run test:all`: 36 pruebas aprobadas (31 generales y 5 de integración). Las dos pruebas del sitio público pasaron en este entorno, donde existe su paquete de prueba en `output/railway-site`; el fallo de Claude se debía a que ese artefacto no estaba en su entorno, según sus notas. No se modificaron ni omitieron esas pruebas.

La prueba nueva cubre menú con teclado, detalle, documentación histórica escapada, enlaces del control anterior, foco tras actualizar, filtros, acciones según rol y vista de 390 px. La prueba de alta comprueba que ya no se envía un segundo campo narrativo y conserva el circuito de geocodificación simulada y doble envío.

Capturas locales con datos ficticios en `output/ausentismo-compacto/`. No se usaron datos de pacientes reales ni se hicieron llamadas, pruebas reales de GPS o envíos de correo para esta integración.

El archivo temporal de empaquetado señalado por Claude se dejó en `tmp/_to_delete/`; no forma parte del cambio ni del paquete publicado.
