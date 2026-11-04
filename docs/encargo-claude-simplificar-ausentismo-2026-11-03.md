# Encargo para Claude: simplificar Ausentismo para la demostración

Fecha: martes 3 de noviembre de 2026. Reunión: miércoles 4 de noviembre.
Base revisada: commit `084c934`. Leer el estado actual y `git diff` antes de trabajar; no reutilizar los parches del lunes como base.

## Pedido del usuario y prioridad

El usuario encuentra la lista de casos demasiado cargada. Quiere verla de otra forma, más simple y fácil de entender. Le gusta el alta de casos, especialmente el mapa y la carga integrada del domicilio: conservar ese recorrido. En el último bloque quiere un solo campo de texto para el motivo y quitar «Documentación aportada (opcional)», que se parece demasiado. Conservar la carga de certificados.

La tarea es reducir lo que se ve al mismo tiempo, manteniendo las operaciones disponibles. Entregar una propuesta implementada para revisar en local, con datos ficticios. No crear funcionalidades clínicas nuevas para la demo.

## Lista de casos: dirección concreta

Sustituir las fichas extensas y repetidas por un registro compacto y legible. Cada fila cerrada debe permitir responder: quién es, de qué empresa, cómo está el control y qué corresponde hacer.

Mostrar de entrada:

- Nombre del trabajador, con tamaño moderado; permitir nombres largos sin tapar acciones.
- Empresa y, en una segunda línea discreta, la fecha/hora del control cuando exista.
- Estado real y resultado relevante. «No compareció» debe verse sin abrir el caso cuando corresponda. No equiparar «resuelto» con «asistió».
- Una acción principal acorde al estado: asignar, programar, continuar o ver el caso/documentos. Las operaciones y sus permisos deben seguir las condiciones actuales.
- Un acceso explícito «Ver caso» o «Ver detalle», si no es ya la acción principal, y un menú secundario accesible para las otras operaciones.

Al abrir «Ver caso», mostrar el domicilio, radio, profesional, motivo, documentos y antecedentes del control en un panel de detalle ordenado. Mantenerlo separado del formulario «Nuevo caso»; abrir un detalle no debe resetear ni sobrescribir un alta en preparación. Se puede reutilizar el lenguaje de los paneles existentes, con encabezado, cierre y foco de teclado.

Sacar de la fila cerrada:

- Los tres recuadros de Domicilio / Profesional / Entrevista.
- La dirección completa, el radio GPS, DNI, fecha de apertura y texto completo del motivo.
- La hilera de Correos, Certificados, Informes, Domicilio, Acta e Informe de inasistencia.
- «Eliminar» como acción permanente al extremo de cada fila. Llevarla al menú secundario, con su confirmación existente.

Todo lo anterior debe continuar accesible en el detalle o menú. Si falta un dato que impide avanzar, mostrar solo ese aviso concreto en la fila: por ejemplo, «Falta confirmar domicilio». Un caso resuelto no necesita repetir que tiene domicilio y médico cargados.

Mantener buscador y «Nuevo caso» como herramientas visibles. Reemplazar la barra ancha de etapas con flechas y contadores en cero por un selector «Estado» compacto que conserve los valores actuales: Todos, Nuevos, Asignados, Programados, En curso y Resueltos. No ocultar estados con casos ni cambiar su significado. Si es necesario adaptar la interacción del selector, proponer el cambio en el parche para que Codex lo integre.

Conservar la agrupación existente y el acceso al historial de controles anteriores. No inventar otra deduplicación de personas desde el frontend. Hay registros con y sin DNI y nombres con puntuación distinta; fusionarlos requiere revisión funcional de Codex. No presentar el número de filas como número de personas únicas sin esa garantía.

## Alta de caso: cambio pequeño y específico

- Conservar panel lateral, mapa, geocodificación, confirmación del punto, profesional, datos de contacto y correos obligatorios.
- Dejar un único textarea visible: «Motivo de la ausencia». Mantener el cambio de etiqueta según el tipo de control que ya existe.
- Ayuda breve propuesta: «Contá el motivo del control y cualquier dato relevante del certificado».
- Quitar el textarea visible «Documentación aportada (opcional)».
- Mantener el selector de archivos «Certificado médico», sus límites, carga múltiple, errores y la posibilidad de adjuntar después.
- Mantener Guardar y continuar / Guardar borrador y el manejo actual de errores y doble envío.

Precaución técnica: `au-documentacion` se consulta al guardar, limpiar y preparar un control nuevo tanto en `public/ausentismo-flow.js` como en funciones heredadas de `public/index.html`. No borrar el elemento sin contemplar esas referencias. Proponer los cambios coordinados; Codex integrará el ajuste del JS funcional. Para una maqueta aislada se puede conservar temporalmente el elemento oculto. No hacer del ocultamiento una supuesta migración.

No borrar la columna `documentacion` ni sus valores históricos. No concatenarlos automáticamente en el motivo ni copiar documentación clínica vieja a un control nuevo. La información ya guardada debe seguir disponible en la lectura del caso.

## Lenguaje visual

Usar la skill Impeccable con enfoque de simplificación y la identidad existente: papel cálido, tinta marino y magenta para urgencia. No basta con reducir la fuente o apretar los márgenes: hay que reducir información simultánea y dar jerarquía a las acciones.

Menos recuadros, etiquetas y colores repetidos. Nombre y estado se leen primero; una sola acción domina. En móvil, una columna clara, controles de al menos 44 px y sin desplazamiento horizontal. Si se añade menú, debe tener texto accesible, abrirse con teclado, cerrarse con Escape y devolver el foco. El detalle debe permitir cerrar y volver a la misma fila.

## Coordinación y entrega

Claude es responsable de la propuesta visual y su implementación aislada. Codex integra lógica, verifica y publica. Esta actualización reemplaza el criterio del lunes que pedía mostrar la ficha de preparación completa en cada fila; el resto del documento anterior queda como contexto histórico.

Entregar:

1. `docs/simplificacion-ausentismo-claude-2026-11-03.patch`, incremental sobre el estado actual, con marcado y CSS necesarios. Incluir cualquier JS de presentación imprescindible claramente identificado. No editar directamente los archivos compartidos de ejecución mientras Codex integra otros cambios.
2. `docs/simplificacion-ausentismo-claude-2026-11-03-notas.md`, con archivos afectados, decisiones y dependencias funcionales que debe resolver Codex. No sobrescribir la propuesta anterior.
3. Capturas de escritorio y móvil, con la lista compacta, un detalle abierto y el alta conservada con un solo campo de motivo, en `output/claude-demo/simplificacion-2026-11-03/`.

No cambiar backend, permisos, firmas, PDFs, correos automáticos, salas, enlaces ni reglas de asistencia o geolocalización. No usar datos clínicos reales en capturas o servicios externos. No hacer commit, push ni deploy desde Claude: la publicación corresponde a Codex después de la integración y pruebas.

## Casos de revisión

- Lista con casos nuevos, sin domicilio, asignados, programados, en curso, resueltos con asistencia y resueltos sin comparecencia.
- Un trabajador con varios controles y acceso a los documentos del control correcto.
- Acciones distintas de administrador y médico: conservar permisos existentes.
- Búsqueda, filtro, apertura/cierre del detalle, foco de teclado y vuelta a la fila.
- Alta con motivo y certificados; borrador; error al geocodificar; cierre y reapertura sin perder datos.
- Textos largos y pantalla de 390 px.
- No afirmar asistencia a partir de geolocalización, firma del médico o estado «completado».

Codex ejecutará las verificaciones de sintaxis, las pruebas funcionales pertinentes y la revisión del diff antes de publicar. La validación visual aislada no equivale a una prueba real de GPS o videollamada.
