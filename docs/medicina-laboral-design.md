# Sitio público de medicina laboral

## Empresas, equipo ampliado y accesos por necesidad

Logos aportados por el usuario: Clínica C.E.Me.P., Huinoil, Grupo L y Logant. Franja animada CSS en lugar del bloque de consultas, con botón de pausa/reanudación y alternativa estática para movimiento reducido. Recursos originales en `public/images/empresas/`; Grupo L se encuadra por CSS sin modificar el archivo.

Equipo de cuatro profesionales: Dr. Raúl Barboza, Dra. Paula Barboza, Dra. María Isabel Zapata y Dr. Agustín Barboza. Los dos últimos tienen fotografía pendiente. Grilla de cuatro columnas en escritorio amplio y dos en tamaños menores.

El selector inicial conserva cuatro necesidades y enlaces, ahora en grilla 2×2 con SVG, color y flechas. Contacto comercial sigue disponible en el inicio y el pie. `public/public-site.js` controla la pausa y se incluye en el paquete Netlify.

## Fotografías de servicios y publicación

Cuatro imágenes ilustrativas generadas con la herramienta integrada image_gen. Archivos: `public/images/teleconsultas.png`, `juntas-medicas.png`, `ausentismo.png`, `informes.png`. Prompts exactos y origen registrados en `docs/service-image-prompts.json`. No representan al equipo real; Paula conserva su foto aportada por el usuario.

Publicación estática preparada con `node scripts/package-netlify.js` en `output/netlify-site` y ZIP `output/medgrup-netlify.zip`. Se incluyen exclusivamente páginas públicas y recursos. Los accesos a empresa/profesionales apuntan a la aplicación existente `https://medicinalaboral.medgrup.com.ar/`; no se traslada el servidor ni la base de datos a Netlify.

## Revisión de navegación compacta

Se reemplazó el hero de tres líneas y el ejemplo ilustrativo por un título horizontal, una descripción breve y cuatro accesos a páginas de servicio. Se eliminaron el catálogo repetido en inicio, la franja de eslóganes y el recorrido genérico repetido. La plataforma queda en una franja de acceso; equipo y contacto se compactaron. El catálogo usa introducción y tarjetas breves. Los detalles completos permanecen en las cuatro páginas de servicio.

Verificación: inicio sin desbordamiento horizontal en 968px y 351px CSS; cuatro accesos a servicios presentes. Capturas parciales en `output/landing-review/compact-home.png` y `compact-catalog.png`. La portada mide 1421px de alto en el viewport de escritorio inspeccionado.

## Actualización de identidad y arquitectura

El usuario reemplazó expresamente la paleta verde por los colores del logo MEDGRUP: azul `#4d83bd`, celeste `#acdcec` y magenta `#b5185b`. Se conserva la tipografía editorial y el lenguaje de botones redondos. CTA azul oscuro `#294f79`; texto pequeño azul `#356ba4` para contraste.

El sitio ahora incluye `/servicios.html` y páginas estáticas propias en `/servicios/teleconsultas.html`, `/servicios/juntas-medicas.html`, `/servicios/ausentismo.html` y `/servicios/informes.html`. Cada servicio explica alcance, coordinación, documentación, pregunta frecuente y contacto. Medical Service es referencia de organización, no fuente de servicios o promesas de MEDGRUP.

Foto de Paula aportada por el usuario: `public/images/paula-barboza.png`. Original conservado; encuadre CSS con object-fit. Pendiente foto de Raúl. Iconos SVG propios para catálogo y páginas de detalle.

Generación de páginas: `node scripts/build-public-services.js`. Vista estática: `node scripts/preview-public.js`, puerto 4174. No requiere instalar dependencias. Portal operativo requiere el servidor habitual.

Las notas siguientes documentan la primera versión; la paleta, arquitectura y foto indicadas arriba reemplazan las decisiones originales.

Ruta: `/medicina-laboral.html`. Primera versión local, independiente de las pantallas operativas existentes.

## Dirección

Página editorial para empresas: entender el servicio, el recorrido de atención y la plataforma; luego consultar por correo o entrar al portal. Referencias aportadas: Tiano para organización del contenido y Grove para lenguaje visual. Sin cifras, testimonios ni credenciales inventadas.

## Sistema de esta página

- Blanco de fondo, tinta `#1c1c1e`, texto secundario `#626266`, superficie agrupada `#eff1f6`.
- Verde `#0b835c` limitado a nombre de marca en título serif, etiquetas y acentos direccionales.
- Libre Caslon Text en títulos: hero de 92px en escritorio, 76px intermedio, 64px en móvil. Geist en interfaz y lectura.
- Etiquetas de sección: 12px y tracking de 0.1em.
- CTA principal oscuro y secundario delineado; radio 9999px y altura mínima 48px.
- Tarjetas de 20/24px, sin sombras. Columna de lectura máxima de 520px.
- Grilla doble en escritorio, una columna en móvil; contenido visible sin animación. Respeta movimiento reducido.
- Servicios desplegables nativos, foco visible y enlace para saltar al contenido.

## Contenido y pendientes

Servicios derivados de la implementación: teleconsultas, juntas médicas, ausentismo, informes y actas. Contacto tomado del índice existente: administracion@medgrup.com.ar.

Equipo confirmado por el usuario: Dr. Raúl Barboza y Dra. Paula Barboza. Pendientes fotos, biografías, matrículas y confirmación final de textos/catálogo comercial. El recorrido del hero es ilustrativo y está rotulado; no muestra datos reales.

## Ejecutar

El servidor habitual sirve los archivos de `public`. Con la app iniciada, visitar `http://localhost:3000/medicina-laboral.html`. La vista estática de esta sesión usa `http://127.0.0.1:4173/medicina-laboral.html`; las funciones del portal requieren el servidor habitual.

Las fuentes se cargan desde Google Fonts y cuentan con fallback. Antes de publicar, definir si se alojarán localmente. No se modificó el índice existente ni se publicó la página.

## Revisión tras rechazo de la versión compacta
Se recuperó la estructura amplia de servicios, plataforma, equipo y contacto. El inicio usa texto directo sobre medicina laboral; el ejemplo se reemplazó por enlaces según la necesidad de la empresa. La versión compacta queda descartada como dirección visual.

Netlify: proyecto mellow-snickerdoodle-20850f, https://mellow-snickerdoodle-20850f.netlify.app/. Despliegue confirmado por Netlify Drop. Acceso inicialmente privado; publicación pública pendiente de autorización específica por revisión automática.

Publicación pública autorizada explícitamente por el usuario y confirmada por Netlify. Verificados en producción: portada, catálogo, cuatro imágenes cargadas y navegación a teleconsultas. URL: https://mellow-snickerdoodle-20850f.netlify.app/.

Foto del Dr. Raúl Barboza incorporada desde archivo aportado por el usuario en public/images/raul-barboza.png. Se conserva la foto original y se utiliza el mismo encuadre CSS del equipo médico.

## Propuesta y contacto — 30/09/2026
Se incorporaron iconos oficiales de Lucide con licencia local; propuesta.html detalla aptos, exámenes preocupacionales y periódicos, auditorías psiquiátricas y funciones del portal. contacto.html permite preparar una solicitud por mailto con validación, aclarando que el envío se confirma en la aplicación de correo. El Dr. Raúl Barboza figura como médico psiquiatra y médico del trabajo. Verificado sin desborde en 351 y 1153px y composición del correo mediante ejecución aislada.


## Composición centrada — 30/09/2026
A pedido del usuario: portada centrada con Libre Caslon Text en regular y cursiva, encabezados y fichas médicas centrados, escala y ritmo de lectura uniformes. Datos del formulario y descripciones extensas conservan alineación de lectura. Retrato de Raúl editado con herramienta integrada: traje azul marino, camisa blanca y corbata; original preservado. Archivo: public/images/raul-barboza-traje.png.


## Foto María Isabel Zapata — 01/10/2026
Foto proporcionada por el usuario, encuadrada mediante CSS para mostrar rostro y hombros. Misma altura de ficha y radios que las fotos de Raúl y Paula; acercamiento adaptado a móvil. Original guardado íntegro en public/images/maria-isabel-zapata.png.


## Rediseño editorial del inicio — 02/10/2026
A partir de la crítica de impeccable (20/32; snapshot en `.impeccable/critique/`). Dirección elegida por el usuario: editorial con carácter. Se mantienen las fotos del equipo.

- Hoja nueva `public/sitio.css`, usada solo por el inicio. Las demás páginas siguen con `medicina-laboral.css` hasta migrarlas.
- Tipografías: Libre Caslon Display para títulos y Schibsted Grotesk para la interfaz (antes Libre Caslon Text y Geist).
- Paleta con función: el magenta indica acción y lo pendiente, el azul enlaces y lo completo, y el celeste la superficie del portal. Fondo papel `#fbfaf6` y tinta `#13233a`.
- Composición alineada a la izquierda sobre una grilla de 12 columnas. Se quitaron la etiqueta sobre el título, los remates en cursiva magenta, las tarjetas pastel, las píldoras con ↗ y la marquesina de logos.
- Se reemplazaron el selector por necesidad y la grilla de 4 fotos IA por un único índice de necesidades. Aptos, exámenes y auditorías psiquiátricas enlazan a la propuesta.
- Portal mostrado con una vista ilustrativa en HTML/CSS, rotulada como ejemplo. No contiene datos reales.
- Fotos del equipo en WebP con respaldo PNG. Los encuadres se hacen por CSS: rostro y hombros a escala similar, y en la foto de Raúl el encuadre deja fuera los diplomas del fondo. Agustín aparece con iniciales hasta tener foto.
- Peso del inicio: de unos 11 MB de PNG a unos 250 KB de imágenes.
- `scripts/package-netlify.js` copia y versiona `sitio.css` y `logo.webp`.

## Todo el sitio con el sistema editorial — 02/10/2026
- **Inicio:** a la derecha del título hay un certificado de aptitud ilustrativo hecho en HTML/CSS, con sello SVG de MEDGRUP y firma dibujada. Está rotulado como documento ilustrativo y no usa imágenes generadas.
- **Generador nuevo:** `node scripts/build-public-site.js` genera `servicios.html`, las 4 páginas de servicio, `propuesta.html` y `contacto.html`, y además sincroniza el encabezado, el pie y los íconos del inicio. El resto del contenido del inicio se edita a mano en `medicina-laboral.html`.
- **Páginas de servicio:** cada una muestra una vista ilustrativa de lo que la empresa ve o recibe: turno de teleconsulta, dictamen con firmas, caso de ausentismo y lista de informes. Ya no usan las fotos de IA.
- **Contacto:**
  - El selector de servicios queda agrupado en tres bloques.
  - Las páginas de servicio enlazan con `?servicio=` y el formulario abre con ese servicio ya elegido; lo hace `public-site.js`.
  - Se quitó el código de la marquesina.
- **Hojas de estilo:** todas las páginas públicas usan `sitio.css`, y `medicina-laboral.css` ya no se publica.
- **Scripts viejos:** `build-public-services.js`, `compact-public-site.js`, `expand-public-proposal.js`, `restore-editorial-site.js`, `refine-editorial-type.js`, `update-team-clients.js`, `add-service-photos.js` y `add-zapata-photo.js` quedaron obsoletos. No hay que correrlos porque reescriben las páginas con el diseño anterior.
