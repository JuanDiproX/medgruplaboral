# Rediseño del panel y del portal de empresa (Claude → Codex)

> Actualización del 3 de noviembre: el nuevo encargo del usuario para simplificar la lista de Ausentismo está en [encargo-claude-simplificar-ausentismo-2026-11-03.md](encargo-claude-simplificar-ausentismo-2026-11-03.md). Leerlo antes de continuar. La ficha extensa visible en cada fila propuesta aquí debe reemplazarse por la lista compacta y detalle a demanda del nuevo encargo. Este documento conserva el contexto de lo ya integrado.

Lunes 2 de noviembre de 2026, 10:45 (hora argentina).

**Usar `docs/rediseno-panel-claude.patch`.** Es **incremental sobre el estado actual de la carpeta**: tu `index.html` y tu `empresa.html` con los cambios de las 10:35 (Ausentismo ya integrado, trampa de foco, correos de empresa y paciente). Trae solo lo nuevo: Agenda, Seguimientos, Médicos, Empresas, Presupuestos, Reuniones y el portal de empresa.

- **Aplicar:** `git apply docs/rediseno-panel-claude.patch`. Pasa `git apply --check` sobre copias exactas de los archivos actuales (`index.html` 577 235 bytes, `empresa.html` 76 966, `claude-demo.css` 17 170).
- **Si Codex vuelve a tocar esos archivos antes de aplicar**, puede no entrar limpio. En ese caso, avisame y lo regenero sobre la versión nueva.
- **Finales de línea:** `index.html` estaba casi todo en CRLF, con 13 líneas en LF. El parche lo deja todo en CRLF, así que esas 13 líneas aparecen en el diff sin cambio de contenido.
- `docs/rediseno-ausentismo-claude.patch` ya está integrado y quedó vacío a propósito: si se aplica por error, falla.
- **No se tocó** `public/claude-demo.css` en la carpeta: la versión nueva viene dentro del parche, para no cambiar la Agenda en vivo antes de que Codex la revise.
- **Calendario:** integrar después del turno de hoy (16 h). Desde las 15:30 no se despliega.

Claude no editó en la carpeta compartida ningún archivo de Codex. No hubo commits, pushes ni despliegues.

## Archivos del parche

| Archivo | Cambio |
|---|---|
| `public/index.html` | Agenda (solo textos en `renderAgenda` y `renderFocoProximo`), Seguimientos (marcado de la lista y `renderSeguimientos`), Médicos, Empresas, Presupuestos y Reuniones (formularios dentro de `div.panel-lateral` y botones en el encabezado de la lista), y funciones genéricas `abrirPanelLateral` / `cerrarPanelLateral` junto a `showSection`. |
| `public/claude-demo.css` | Se agregan las secciones de Agenda, Seguimientos y panel lateral común. La parte de Ausentismo no cambia, salvo que el circuito ahora se desliza completo en el celular. |
| `public/empresa.html` | 2 líneas: las fuentes del sistema y el `<link>` a `claude-portal.css`. |
| `public/claude-portal.css` | Archivo nuevo con los estilos del portal de empresa. |

## Criterio común

- **Identidad MEDGRUP:** tinta marino, papel cálido, Libre Caslon para títulos y nombres, Schibsted Grotesk para la interfaz y radios discretos.
- **Colores con función:**
  - magenta solo para lo que urge o bloquea;
  - ámbar para lo pendiente;
  - verde para lo listo;
  - celeste para la selección.
- **Listas a todo el ancho.** Los formularios de alta y configuración se abren en un **panel lateral**: se cierra con la X, tocando el fondo o con Escape, y no pierde lo cargado. En el celular ocupa la pantalla completa.
- **Fuera:** emojis en estados y acciones, textos encadenados con "·", etiquetas en mayúsculas monoespaciadas y botones con degradé.

## Por sección

**Ausentismo.** Ya integrado por Codex; este parche no lo modifica:

- lista como libro de registro con una ficha de preparación por caso (Domicilio, Profesional y Entrevista, cada uno listo, pendiente o bloquea);
- el circuito del caso funciona como filtro, más una búsqueda;
- alta en panel lateral con 4 pasos y pie fijo;
- mismas acciones y condiciones que antes.

**Agenda.** Sin cambiar su estructura ni el flujo de turnos:

- la hora y el separador de día en Caslon;
- sin emojis (✓ ● ⏰ 🏥); "Diagnóstico previo" pasa a ser una línea de lectura en lugar de una etiqueta ámbar;
- las filas a menos de 24 horas ya no se tiñen de ámbar: solo el aviso "en 3 h";
- **"Iniciar" en magenta solo para el turno inminente o la consulta en curso**; los demás van delineados en tinta;
- las acciones de documentos (Recordar, Links, Adjuntos, Informe…) quedan como enlaces discretos.

En JS solo cambian textos dentro de `renderAgenda()` y `renderFocoProximo()`. Ninguna condición cambia.

**Seguimientos (lista).**

- Mismo registro que Ausentismo: nombre en Caslon y estado.
- Una ficha con Consultas, Última y Próxima (ámbar si no tiene turno).
- Filtros: Abiertos, luego En seguimiento → Derivados a junta → Cerrados, y Todos.
- Buscador con estilo.
- El legajo (detalle) no se tocó: ya tenía este lenguaje.

**Médicos, Empresas, Presupuestos y Reuniones.**

- La lista ocupa todo el ancho.
- Botones en el encabezado de cada lista:
  - Médicos: "Nuevo médico" y "Acceso de administrador";
  - Empresas: "Nueva empresa";
  - Presupuestos: "Nuevo presupuesto" y "Catálogo de servicios";
  - Reuniones: "Programar reunión".
- Cada formulario existente va dentro de un `div.panel-lateral` con **los mismos IDs, campos y funciones**.
- Editar sigue en los modales de siempre.
- **No se cierra solo al guardar:** los mensajes de éxito y error (y en Reuniones, los links de invitación) quedan visibles dentro del panel.
- El total del presupuesto pasa a Caslon.
- Se arregló la celda de acciones de las tablas, que se descuadraba por un `display:flex` inline.

**Portal de empresa** (`empresa.html` + `claude-portal.css`). Solo CSS sobre el portal existente; no cambia ninguna lógica.

- Papel y tinta en lugar del gris azulado.
- Título de página, tarjetas y modales en Caslon.
- Las tres cifras como una franja sobria con números en Caslon, sin íconos ni filetes de color.
- Pestañas como selector segmentado.
- Encabezados de tabla y etiquetas móviles en voz normal (no MAYÚSCULAS MONO).
- Botones en tinta, sin degradé ni animaciones de rebote.
- Zona de archivos con estilo.

## Cambio transversal a revisar

`.sec-anim` (la entrada de cada sección) ahora anima **solo opacidad**. Antes animaba `transform`, y eso convertía a la sección en el contenedor de los elementos con `position:fixed`, así que los paneles laterales quedaban atrapados dentro. El mismo efecto alcanzaba a `.video-container.active` (videollamada a pantalla completa en el celular) dentro de `#sec-agenda`. **Conviene probar la videollamada en el celular durante el ensayo:** ahora el `fixed` se calcula contra la pantalla, que es lo que pide su CSS.

## Pruebas (sobre la combinación real: archivos actuales de Codex + este parche)

- `npm test`: 27 de 29 pasan, incluido el test de Ausentismo **en su versión actual de Codex**. Las 2 que fallan son las de `public-commercial.test.cjs`: necesitan `output/railway-site`, que no está versionado, y fallan igual sin cambios.
- **No se corrió** `npm run test:integration`: necesita la base, y el parche no toca el servidor.
- **Entorno visual aislado** (Playwright, API simulada, datos inventados, recursos externos bloqueados), a 1440 px y 390 px:
  - las 8 secciones del panel, con rol admin y rol médico, cada panel lateral abierto y cerrado con Escape;
  - el recorrido completo del alta de Ausentismo, sin desplazamiento horizontal;
  - las dos pestañas del portal de empresa, incluidos los campos de correo nuevos;
  - cero errores de consola.
- Capturas en `output/claude-demo/v3/`.

## Limitaciones reales

- No se probó con sesión ni datos reales. El mapa de Google y la videollamada (Daily) no se renderizan en el entorno de prueba.
- Los paneles no atrapan el foco: Tab puede salir hacia la página de atrás.
- Varias reglas usan `:has()` (Chrome/Edge 105+, Safari 15.4+, Firefox 121+). En navegadores más viejos esos detalles no se ven, y el resto funciona.
- En el portal de empresa, la lista de casos de ausentismo conserva su marcado (y sus emojis 📎 ⚠️). Solo cambió el estilo. Llevarla a la misma ficha que el panel requiere tocar su JS.
- No se rediseñaron: el legajo de Seguimientos (ya estaba resuelto), Mi perfil, el login del panel, los modales internos (programar turno, dictamen, firma) ni la sala de videollamada.
