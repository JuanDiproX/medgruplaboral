---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

Scope: panel autenticado de public/index.html (login + shell + agenda + formularios + modales). Mode: Operate. Solo CSS (más el link de fuentes); HTML y JS intactos.

Task: el médico/admin ve el turno que sigue, entra a la consulta, programa turnos, redacta informes. Constraint: hay turnos en producción; nada se despliega sin aprobación.

## Direction contract

THESIS: el portal es el mismo MEDGRUP que el sitio público, en registro de herramienta: rechaza el SaaS azul con degradés, sombras flotantes y animaciones por todos lados.

OWN-WORLD: riel lateral de tinta marino #13233a con ítem activo celeste #acdcec; suelo papel #fbfaf6, superficies blancas con filete #e4e3da, radios 3–6px, sin degradés. Schibsted Grotesk en todo; Libre Caslon Display solo en títulos de página, login y modales. Magenta #b5185b = urgente/inmediato; azul #2c5d92 = enlace/completo; ámbar = próximo.

STORY: al entrar, el médico lee la hora del próximo turno y su estado antes que nada, y actúa.

FIRST VIEWPORT: riel marino a la izquierda; título de sección en Caslon con fecha tabular y dos acciones (Programar turno en tinta, Inmediata en magenta); debajo, agenda como horario: columna de horas tabulares separada por un filete, filas planas, inminente en tinte magenta.

FORM: horario/timetable dentro del shell estándar (sidebar + contenido); posición 1 de la lista propia. Seed: n/a (dirección fijada por el usuario: "Igual al sitio nuevo").

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
