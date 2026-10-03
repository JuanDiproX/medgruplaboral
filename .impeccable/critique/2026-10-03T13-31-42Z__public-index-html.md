---
target: "portal Medgrup Laboral: panel, llamada, atencion e ingreso"
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
target_identity: "file:C:\\Users\\juand\\OneDrive\\Escritorio\\medgrup_app\\public\\index.html"
target_fingerprint: "sha256:b613872759d0ad28a758ca6468c0eeb7221da1b6993a1e84a89bb7651034e4ad"
target_path: "C:\\Users\\juand\\OneDrive\\Escritorio\\medgrup_app\\public\\index.html"
timestamp: 2026-10-03T13-31-42Z
slug: public-index-html
---
Method: dual-agent (A: design review · B: detector + browser)

Targets: public/index.html (panel + video embebido), public/atencion.html, public/ingreso.html

| # | Heurística | Puntaje | Problema clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 2 | "GRABANDO" fijo en el HTML; la sala solo habilita grabación (enable_recording:'cloud'), no la inicia. Sin estados "esperando al paciente"/"conectado". |
| 2 | Lenguaje del mundo real | 3 | Rioplatense y correcto; "Turnos totales" no es un concepto del médico. |
| 3 | Control y libertad | 2 | #notas-panel tapa "Finalizar consulta"; salir desde Daily deja el turno "en curso". |
| 4 | Consistencia | 1 | Tres sistemas visuales: portal, estilos inline heredados, páginas del paciente. |
| 5 | Prevención de errores | 2 | Eliminar/Cancelar al mismo peso que 6–8 botones en filas de ausentismo. |
| 6 | Reconocer antes que recordar | 3 | Acciones con texto; menú ⋮ para admin. |
| 7 | Flexibilidad y eficiencia | 1 | Sin atajos, sin "iniciar el siguiente", sin filtros por día. |
| 8 | Estético y minimalista | 2 | El próximo turno aparece 3 veces; 21 .card + 4 .form-section + ~77 cajas inline. |
| 9 | Recuperación de errores | 2 | Mensajes humanos sin botón de reintento. |
| 10 | Ayuda y documentación | 2 | Ayudas largas en gris chico; consentimiento de ubicación en 11.5px a 3.5:1. |
| Total | | 20/40 | Aceptable (borde inferior) |

Especificidad: shell 7/10 propio de MEDGRUP; contenido 3/10 (plantilla SaaS: card-hdr+ícono+badge en cada bloque, KPI strip, lista|formulario, emojis); páginas del paciente 2/10 (otra marca).

Detector: 19 hallazgos CLI (index 9, atencion 6, ingreso 4). Reales: botón IA vuelve a violeta por JS (línea ~2427, CSSOM reescribe el style y el override no matchea); "Recordar" #1e9d5a 3.5:1; WhatsApp #25D366 2.0:1; atencion/ingreso --text3 #8a8780 3.3–3.6:1, 11.5px, verde #2d8a5a 4.3:1; .rec-dot titilando. Falsos positivos: dark-glow, cramped-padding de tabs, violeta inline (overrideado).

Prioridades:
- [P0] #notas-panel (fixed, 440px) tapa "Redactar informe" y "Finalizar consulta" en desktop y toda la barra en mobile. Fix: columna acoplada dentro del video (grid 1fr 400px) / hoja inferior que no pise la barra.
- [P0] "GRABANDO" siempre visible aunque no se grabe. Fix: estado real desde eventos de Daily (recording-started/stopped); estados Esperando / En consulta / Grabando / No se graba.
- [P1] Barra de la llamada sin jerarquía: "Redactar informe" queda tinta sobre tinta (invisible). Fix: secundarios a la izquierda, Informe (toggle celeste) + Finalizar (magenta) a la derecha.
- [P1] Agenda: próximo turno dicho 3 veces; primer turno en y=534 (desktop) / Iniciar en y=677 (mobile). Fix: quitar avisos, métricas → una línea, quitar card-hdr y franja de filtros; primer turno a ~y=200.
- [P1] Ausentismo: 8–11 botones por fila con dos primarios. Fix: un primario según estado, resto en ⋮ y links en la línea de datos.

Auditoría de cajas: quitar #metrics-row, #turnos-card+card-hdr, .agenda-filtros, avisos, #links-box, cajas del dictamen (dejar solo el lienzo de firma), .form-section de modales, cards lista|formulario de cada sección, cajas de perfil, cajas ok/error inline (→ toast / línea), cajas anidadas de ingreso y tarjetas de atencion.

Personas: Alex (sin atajos, 5 botones por fila), Sam (nav en div sin foco, tabs sin role, contraste #c8a800 ~2:1, emojis leídos), Casey (580px de cromo antes de Iniciar; notas tapan Finalizar; en atencion ~1100px entre video y enviar).

Preguntas: ¿Agenda o vista "Ahora"? ¿Para quién es "GRABANDO" y debería verlo el paciente y quedar en el acta? ¿Los 5 minutos más sensibles deben pasar en la UI de Daily?
