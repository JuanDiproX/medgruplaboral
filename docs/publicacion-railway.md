# Web pública en Railway

Proyecto: MEDGRUP · Web pública (7b9770e5-91f7-4688-91cc-783cde29dd90).
Servicio: medgrup-web-publica (b264f0ad-207e-4e7f-9406-7782e081539a).
Entorno: production (cd087e5e-1eff-411a-842d-f7c26d2d3f68).
Dominio: https://laboral.medgrup.com.ar/

Generar el paquete con node scripts/package-railway.js. Publicar únicamente desde output/railway-site con la CLI oficial. El paquete usa Node 22, sin dependencias npm y sin base de datos. Las páginas y recursos son una copia permitida de la web pública.

Despliegue confirmado: af797ccb-670b-4821-a16c-3c376d3c89fb, incluido el archivo de verificación de Google.

DNS en DreamHost: CNAME laboral -> uaz3hi5w.up.railway.app y TXT _railway-verify.laboral con el valor indicado en Railway. Ambos registros resuelven públicamente y el dominio funciona con HTTPS válido. Se conservaron los registros existentes de raíz, mail, medicinalaboral y visitas.

SEO incluido: canonical, Open Graph, sitemap de ocho páginas y robots. Search Console verificó https://laboral.medgrup.com.ar/ mediante public/google4517d9b9248d63de.html; conservar ese archivo en próximos despliegues. Sitemap enviado el 2 de octubre de 2026. La primera lectura de Google muestra «No se ha podido obtener»; el endpoint público responde 200 con XML válido y robots permite el rastreo. Se reenvió tras confirmar HTTPS; queda pendiente el procesamiento de Google. El formulario comercial prepara un correo; no tiene envío backend.

Enlace Railway verificado: https://medgrup-web-publica-production.up.railway.app/
Se verificaron en vivo servicios, propuesta, contacto y control de ausentismo, con canonical al dominio definitivo.

Google confirmó la solicitud de indexación de la página principal: URL añadida a una cola de rastreo prioritaria. Esto no confirma indexación ni posicionamiento. Evidencia: output/landing-review/google-indexacion-solicitada.png y railway-domain-live.png.

Actualización 2f98cb74-f03c-4f97-80f8-019a6d72dbc9: breadcrumbs alineados y POST /api/contacto con Nodemailer 10.0.13, STARTTLS obligatorio, destinatario fijo administracion@medgrup.com.ar, validación, honeypot y límite de cinco intentos por IP cada quince minutos (memoria del proceso). Configurar SMTP_PASSWORD en Variables de Railway. Sin contraseña devuelve 503 con alternativa por correo. Pendiente prueba real de recepción tras cargar la contraseña. El servidor público ahora incluye envío SMTP; no incluye base de datos ni APIs clínicas.

SEO local publicado (a62cbf90-fa25-4daf-a75f-0ebffd235024): títulos y descripciones únicos para ocho páginas, cobertura visible Río Grande/Ushuaia en el inicio, Organization JSON-LD con nombre, URL, logo, correo y área atendida. Sin direcciones, horarios ni reseñas inventadas. Índice sitemap-index.xml validado y presentado en Search Console; ambos mapas todavía muestran No se ha podido obtener. DNS consistente en ns1/ns2/ns3 DreamHost y XML accesible por HTTPS. Indexación y posicionamiento pendientes de Google. Envío comercial confirmado funcionando por el usuario tras corregir SMTP_PASSWORD.

El usuario cambió el alcance editorial y SEO a toda Argentina. Se reemplazaron referencias regionales en las ocho páginas públicas (títulos, descripciones, portada y pies). Organization.areaServed ahora es Country Argentina. Esta decisión reemplaza el enfoque SEO local anterior.

Rediseño editorial publicado el 02/10/2026, despliegue 56df6316-ec88-42bf-a5ac-f662a2a6c3fe. Antes de empaquetar se borraron `output/netlify-site` y `output/railway-site/public` para no arrastrar archivos viejos; el vínculo de la CLI con el servicio se conserva. Comando de publicación: `npx @railway/cli up --ci --service b264f0ad-207e-4e7f-9406-7782e081539a`, desde `output/railway-site`. Verificado en el dominio: las 8 páginas, sitio.css, las imágenes WebP, el archivo de Google, el sitemap y /health responden 200. /api/contacto rechaza con 403 las solicitudes de otro origen, que es lo esperado. No se envió una solicitud real.

Indexación, 05/10/2026: títulos y H1 de servicios con palabras de búsqueda ("Juntas médicas laborales para empresas", "Control de ausentismo laboral para empresas", etc.) y sitemap con lastmod. Publicado con el mismo comando desde `output/railway-site` tras borrar `output/netlify-site` y `output/railway-site/public`. En el portal (medicinalaboral, servicio medgruplaboral, despliegue por push a main) las páginas del sitio público redirigen 301 a laboral.medgrup.com.ar, los logins llevan `noindex, follow` y el robots.txt ya no anuncia sitemap. Verificado en vivo: título, H1, canonical y lastmod en laboral; redirección, noindex y robots en medicinalaboral.
