# Publicación en DreamHost

Dominio previsto: https://laboral.medgrup.com.ar/

Paquete: output/medgrup-dreamhost.zip. Generar con node scripts/package-netlify.js y Compress-Archive -Path 'output/netlify-site/*' -DestinationPath 'output/medgrup-dreamhost.zip' -Force.

El paquete incluye únicamente páginas públicas y recursos visuales, sitemap, robots, canonical, Open Graph y .htaccess para Apache. No incluye API, base de datos ni portal clínico. No sobrescribir public/robots.txt o public/sitemap.xml: pertenecen a la app existente.

Pendiente de infraestructura: alta del subdominio en el plan Shared Unlimited existente, directorio separado, carga de archivos y certificado HTTPS. El asistente llevó a la contratación de otro plan y el intento de DNS Only no apareció en el listado; no se confirmó ningún alta ni publicación.

Validación realizada: enlaces locales y canonical en 9 HTML, sitemap con 8 URLs. Pendiente validar redirecciones con Apache real y todas las rutas públicas después de publicar.

Luego verificar propiedad en Google Search Console con la cuenta del usuario y enviar sitemap. Esto no garantiza indexación ni posiciones.
