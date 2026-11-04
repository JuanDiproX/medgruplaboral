# Simplificación de Ausentismo: notas para Codex

Martes 3 de noviembre de 2026. Encargo: `docs/encargo-claude-simplificar-ausentismo-2026-11-03.md`.

**Base:** `084c934`, la carpeta local limpia en `public/` y `tests/`. Los parches del lunes no se usaron como base.

**Aplicar:** `git apply docs/simplificacion-ausentismo-claude-2026-11-03.patch`.

- Pasa `git apply --check` sobre copias exactas de `public/index.html` (584 834 bytes, CRLF) y `public/claude-demo.css` (27 185 bytes, CRLF). Conserva los finales de línea CRLF.
- Si alguno de esos dos archivos cambia antes de aplicar, puede no entrar limpio: avisame y lo regenero.

Claude no editó archivos de ejecución en la carpeta compartida. No hubo commits, pushes ni despliegues.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `public/index.html` | Marcado de la cabecera de la lista (el selector "Estado" entra en las herramientas), panel nuevo `#au-detalle`, campo `au-documentacion` oculto, ayuda del motivo, paso 4 renombrado "Motivo y certificados". En JS, reemplaza `fichaCaso()` y `renderCasosAusentismo()`, quita `AU_ICONO`/`auIcono` (ya sin uso) y agrega funciones de presentación (detalle abajo). |
| `public/claude-demo.css` | Sección nueva "AUSENTISMO — LISTA COMPACTA", más una regla para que `hidden` le gane a `.form-group{display:flex}`. Las reglas `.au-caso`, `.au-ficha` y `.au-etapa` quedan porque las usa Seguimientos. |

No se tocaron `ausentismo-flow.js`, `server.js`, `lib/`, tests, PDFs, correos ni permisos.

## JS de presentación agregado (en `index.html`, junto a la lista)

Todo es solo presentación. Las operaciones siguen siendo las mismas funciones de siempre.

- `accionesCaso(c)` arma una sola vez las acciones del caso, con **las mismas condiciones y permisos** que el render anterior de `084c934`. La usan la fila, el menú y el detalle:
  - *Asignar profesional*: admin, caso abierto, sin profesional.
  - *Programar entrevista / Reprogramar*: con `profesional_id`, en estado asignado o programado.
  - *Iniciar control ahora*: lo mismo que la anterior, y además sin `turno_id`.
  - *Nuevo control*: admin, caso cerrado.
  - *Reasignar profesional*: admin, caso abierto, con profesional.
  - *Marcar en curso*: programado. *Marcar resuelto*: en curso.
  - *Registrar que no compareció*: con `turno_id`, programado o en curso.
  - *Certificados, Informes, Correos*: siempre. *Domicilio*: admin.
  - *Acta*: con `turno_id`. *Informe de inasistencia*: con `turno_id` y `no_comparecio`.
  - *Cancelar caso*: admin, caso abierto. *Eliminar caso*: admin. Ambas usan su confirmación existente.
- **Acción principal de la fila:** "Asignar profesional" si corresponde; si no, "Programar entrevista" (sin turno); si no, "Ver caso".
- `avisoCaso(c)` muestra un solo aviso, y solo en casos abiertos: "Falta cargar el domicilio" o "Falta confirmar el domicilio" (domicilio sin coordenadas).
- **Menú "Más acciones"** (`abrirMenuCaso`, `cerrarMenuCaso`, `ubicarMenuCaso`):
  - botón con `aria-haspopup="menu"` y `aria-expanded`; ítems `role="menuitem"`;
  - se abre con clic, Enter o Espacio; las flechas, Inicio y Fin recorren los ítems;
  - Escape cierra y devuelve el foco al botón; Tab cierra;
  - se dibuja en `<body>` con posición fija para no recortarse dentro de la lista, se reubica con el scroll y se cierra si el botón sale de la pantalla.
- **Detalle "Ver caso"** (`verCaso`, `pintarDetalleCaso`, `refrescarDetalleCaso`):
  - usa el panel lateral genérico (`abrirPanelLateral('au-detalle')`), con su trampa de foco y Escape;
  - es **independiente de `#au-panel-alta`**: abrir un detalle no resetea ni pisa un alta en preparación (verificado);
  - el foco entra al título y al cerrar vuelve al "Ver caso" de la misma fila, también si la lista se redibujó con el panel abierto;
  - si `renderCasosAusentismo()` corre con el detalle abierto, el detalle se repinta con los datos nuevos.

## Decisiones

- **Fila cerrada:** nombre (16 px, semibold, admite nombres largos sin tapar acciones) y estado. En la segunda línea, discreta: empresa, "Control dd/mm/aaaa hh:mm" si hay turno, "Nº control" si hay anteriores, y el tipo si no es ausentismo.
- **"No compareció" aparece como resultado aparte** del estado. "Resuelto" se muestra como "Resuelto": nunca se presenta como asistencia, ni se deduce asistencia de la ubicación, la firma o el estado.
- **Salieron de la fila:**
  - los tres recuadros (Domicilio, Profesional, Entrevista);
  - dirección, radio, DNI, fecha de apertura y motivo completo;
  - la hilera de Correos, Certificados, Informes, Domicilio, Acta e Informe de inasistencia;
  - "Eliminar" como acción permanente.

  Todo eso sigue en el detalle o en el menú.
- **Selector "Estado":** reemplaza a la barra de etapas, con los mismos valores (Todos, Nuevos, Asignados, Programados, En curso, Resueltos) y la cantidad de cada uno. Se ven todas las opciones aunque estén en cero. Llama al `filtrarCasos()` existente, así que no hace falta cambiar lógica.
- **Contador:** dice "N en la lista", no "trabajadores". La agrupación (`agruparCasosPorTrabajador`) no se tocó y no garantiza personas únicas.
- **Detalle:** estado y aviso, acciones para avanzar, Trabajador (empresa, DNI, WhatsApp, tipo, fecha de apertura), Control (profesional, entrevista, resultado, domicilio con radio y estado de ubicación), Motivo, **Documentación declarada** (el valor histórico de `documentacion`, solo lectura, si existe), Documentos, Controles anteriores (cada uno abre los documentos de **su propio** id) y, al final, Cancelar y Eliminar.
- **Rótulos que cambiaron:**
  - "Reasignar" → "Reasignar profesional";
  - el botón "No compareció" → "Registrar que no compareció", para no confundir la acción con el resultado;
  - "Eliminar" → "Eliminar caso".

## Alta de caso: dependencia funcional para Codex

En la maqueta, `#au-documentacion` queda **oculto pero presente**: el `form-group` con `hidden` y el textarea con `aria-hidden`. Esto **no es una migración**. Queda así porque el JS actual todavía lo lee y lo limpia, y retirarlo sin tocar esas referencias rompería el guardado. Referencias en `084c934`:

| Archivo | Línea aprox. | Uso |
|---|---|---|
| `public/ausentismo-flow.js` | 110 | `nuevoControlCaso`: lo limpia al preparar un control nuevo. |
| `public/ausentismo-flow.js` | 127 | `save()`: lo envía como `documentacion` en el cuerpo del POST. |
| `public/ausentismo-flow.js` | 135 | Lo limpia después de guardar. |
| `public/index.html` | ~6865 | `crearCasoAusentismo()` heredada (la reemplaza `ausentismo-flow.js`, pero sigue en el archivo): lo lee. |
| `public/index.html` | ~6883 | La misma función: lo limpia. |

**Propuesta para integrar:** quitar el elemento y esas cinco referencias, y dejar de enviar `documentacion` en el alta nueva. Hay que confirmar del lado del servidor que un alta sin ese campo guarda `null` o vacío y no falla.

- **No** borrar la columna `documentacion` ni sus valores.
- **No** concatenar esos valores en `motivo`.
- **No** copiar documentación vieja a un control nuevo. Hoy no se copia: `nuevoControlCaso` limpia el campo.

Lo histórico ya se muestra en el detalle como "Documentación declarada", y también se lee en `index.html` ~4774.

**Se mantiene igual:** panel lateral, mapa, geocodificación, confirmación del punto, profesional, datos de contacto, correos obligatorios, certificados (límites, carga múltiple, errores y adjuntar después), Guardar y continuar / Guardar borrador, manejo de errores y doble envío. La etiqueta del motivo sigue cambiando según el tipo de control. Ayuda nueva: "Contá el motivo del control y cualquier dato relevante del certificado."

## Verificación hecha (aislada, datos ficticios)

- `npm test` sobre `084c934` + parche: 28 de 30. Las 2 que fallan son las de `public-commercial.test.cjs`: necesitan `output/railway-site`, que no está versionado, y fallan igual sin el parche. `ausentismo-ui` y `paneles-ui` pasan.
- **Escenarios** con Playwright, API simulada y recursos externos bloqueados, como admin y como médico, a 1440 px y 390 px:
  - lista con casos nuevos, sin domicilio, con domicilio sin confirmar, asignados, programados, en curso, resueltos con y sin comparecencia, un trabajador con dos controles y nombres y empresas largos;
  - "No compareció" visible en la fila; ninguna fila dice "asistió";
  - avisos solo donde corresponde; un resuelto no repite datos;
  - menú por teclado: Enter, flechas, Escape y vuelta del foco;
  - detalle: abrir, foco en el título, Escape, vuelta a la fila; documentos del control anterior con su propio id; documentación histórica visible;
  - filtro "Estado" con 6 valores y búsqueda sin tildes;
  - alta: motivo, certificado, error al geocodificar; cerrar, abrir un detalle y reabrir conserva lo cargado; documentación oculta, certificados visibles;
  - médico: solo ve sus casos, sin acciones de admin;
  - sin desplazamiento horizontal; en el celular, controles de 44 px o más.
- **Capturas** en `output/claude-demo/simplificacion-2026-11-03/`.

## Pendiente o fuera de alcance

- No se probó con sesión ni datos reales, ni GPS o videollamada reales. La validación visual aislada no equivale a eso.
- Sugerencia: sumar a `tests/` una prueba del menú y del detalle (teclado y foco) con el mismo criterio de `paneles-ui.test.js`. Claude puede escribirla si se acuerda el archivo.
- El portal de empresa (`empresa.html`) conserva su lista de casos actual.
- Seguimientos no cambia.
