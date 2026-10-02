# Auditoría de la web pública de MEDGRUP

Fecha: 1 de octubre de 2026. Alcance: inicio, catálogo, propuesta de valor, contacto y cuatro páginas de servicios. No incluye la aplicación clínica, la base de datos ni el portal privado.

## Redacción corregida

- Se dividió la frase principal en dos oraciones: «Coordinamos la atención médica de tu equipo. En el portal de tu empresa, podés consultar el seguimiento de cada caso y los informes disponibles». La oración anterior no requería una coma antes de «y»; el problema era su construcción y la repetición.
- Se revisaron puntuación, concordancia, artículos, referencias a trabajadores y términos médicos, sin añadir servicios ni resultados prometidos.
- Se mantuvo el voseo argentino y se unificaron «portal de tu empresa», «Conocer el servicio» y «Acceder al portal».
- En Informes, las etapas ahora son Elaboración, Firma y Consulta; los rótulos anteriores no coincidían con sus descripciones.
- Se aclararon los campos obligatorios, los ejemplos de información solicitada y el funcionamiento real del envío por correo.
- Se agregaron descripciones de página a Propuesta y Contacto.

## Comprobaciones realizadas

- Ocho rutas inspeccionadas en el navegador en anchos efectivos de 1153 y 351 píxeles: sin desborde horizontal.
- Un encabezado principal y un elemento main por página; idioma español declarado y atributos alt en las imágenes.
- Enlaces y archivos locales del paquete comprobados: destinos existentes.
- Sintaxis de public-site.js comprobada con Node.
- Formulario vacío: bloquea el envío y muestra mensajes propios en español. Ninguna solicitud comercial fue enviada durante las pruebas.
- Navegación principal con área de interacción de al menos 44 píxeles de alto; estilos explícitos de foco de teclado en controles.
- El movimiento de logos conserva control de pausa y alternativa para preferencia de movimiento reducido.

## Límites y mejoras pendientes

- El formulario abre la aplicación de correo; no hay recepción automática ni confirmación de entrega. No se comprobó un envío real.
- La foto de Agustín sigue pendiente y está indicada como tal.
- Las fotografías ilustrativas pesan aproximadamente 2 MB cada una. Tienen carga diferida, pero conviene generar formatos web comprimidos si se requiere mejorar el rendimiento en conexiones lentas.
- La hoja de estilos acumula reglas históricas. Una consolidación futura reduciría el riesgo de sobrescrituras y facilitaría el mantenimiento.
- Estas comprobaciones no certifican conformidad WCAG completa, funcionamiento del portal privado ni comportamiento en todos los navegadores o dispositivos físicos.

## Publicación

Destino: Worker muddy-rice-f59c en Cloudflare, con la misma selección de archivos estáticos que el despliegue anterior.
