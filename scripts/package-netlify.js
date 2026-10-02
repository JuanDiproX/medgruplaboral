const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),source=path.join(root,'public'),dest=path.join(root,'output/netlify-site');
fs.mkdirSync(dest,{recursive:true});
const pages=['medicina-laboral.html','servicios.html','propuesta.html','contacto.html',...fs.readdirSync(path.join(source,'servicios')).filter(x=>x.endsWith('.html')).map(x=>'servicios/'+x)];
for(const name of pages){let html=fs.readFileSync(path.join(source,name),'utf8');html=html.replaceAll('href="/empresa.html"','href="https://medicinalaboral.medgrup.com.ar/empresa.html"').replaceAll('href="/index.html"','href="https://medicinalaboral.medgrup.com.ar/"');const target=path.join(dest,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,html);}
fs.copyFileSync(path.join(dest,'medicina-laboral.html'),path.join(dest,'index.html'));
const origin='https://laboral.medgrup.com.ar';
for(const name of [...pages,'index.html']){
  const target=path.join(dest,name);
  let html=fs.readFileSync(target,'utf8');
  const url=origin+(name==='index.html'||name==='medicina-laboral.html'?'/':'/'+name);
  const title=html.match(/<title>(.*?)<\/title>/s)?.[1]||'MEDGRUP';
  const description=html.match(/<meta name="description" content="([^"]*)"/s)?.[1]||'';
  html=html.replaceAll('href="/medicina-laboral.html','href="/');
  const organization={'@context':'https://schema.org','@type':'Organization','@id':origin+'/#organizacion',name:'MEDGRUP',url:origin+'/',logo:origin+'/logo.png',email:'administracion@medgrup.com.ar',areaServed:{'@type':'Country',name:'Argentina'}};
  html=html.replace('</head>',`<script type="application/ld+json">${JSON.stringify(organization)}</script></head>`);
  html=html.replace('</head>',`<link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:locale" content="es_AR"><meta property="og:site_name" content="MEDGRUP"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${url}"></head>`);
  fs.writeFileSync(target,html);
}
const urls=pages.map(name=>origin+(name==='medicina-laboral.html'?'/':'/'+name));
fs.writeFileSync(path.join(dest,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls.map(url=>`  <url><loc>${url}</loc></url>`).join('\n')+'\n</urlset>\n');
fs.writeFileSync(path.join(dest,'robots.txt'),`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
fs.writeFileSync(path.join(dest,'sitemap-index.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>'+origin+'/sitemap.xml</loc></sitemap></sitemapindex>\n');
fs.writeFileSync(path.join(dest,'.htaccess'),`Options -Indexes\nDirectoryIndex index.html\nErrorDocument 404 /404.html\nRewriteEngine On\nRewriteCond %{HTTPS} !=on\nRewriteRule ^ https://laboral.medgrup.com.ar%{REQUEST_URI} [R=301,L]\nRewriteRule ^medicina-laboral\\.html$ / [R=301,L]\nRewriteCond %{THE_REQUEST} \\s/+index\\.html[\\s?] [NC]\nRewriteRule ^index\\.html$ / [R=301,L]\n`);
for(const name of ['medicina-laboral.css','sitio.css','public-site.js','logo.png','logo.webp','favicon.ico'])fs.copyFileSync(path.join(source,name),path.join(dest,name));
for(const name of fs.readdirSync(source).filter(name=>/^google[a-f0-9]+\.html$/.test(name)))fs.copyFileSync(path.join(source,name),path.join(dest,name));
fs.cpSync(path.join(source,'images'),path.join(dest,'images'),{recursive:true});
fs.cpSync(path.join(source,'icons'),path.join(dest,'icons'),{recursive:true});
fs.writeFileSync(path.join(dest,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');
fs.writeFileSync(path.join(dest,'404.html'),'<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Página no encontrada — MEDGRUP</title><link rel="stylesheet" href="/medicina-laboral.css"><main class="wrap section"><h1>Página no encontrada</h1><p>Volvé al inicio para consultar nuestros servicios.</p><a class="button dark" href="/">Ir al inicio</a></main></html>');
// A content version prevents old CSS/JS from mixing with updated HTML.
const crypto=require('node:crypto');
for(const asset of ['medicina-laboral.css','sitio.css','public-site.js']){
  const version=crypto.createHash('sha256').update(fs.readFileSync(path.join(source,asset))).digest('hex').slice(0,12);
  for(const name of [...pages,'index.html','404.html']){
    const file=path.join(dest,name);
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll(`/${asset}"`,`/${asset}?v=${version}"`));
  }
}
console.log('Public site packaged at '+dest);
