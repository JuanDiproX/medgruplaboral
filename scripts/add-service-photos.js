const fs=require('fs'),path=require('path');
const file=path.join(__dirname,'build-public-services.js');
let s=fs.readFileSync(file,'utf8');
s=s.replace('<div class="service-art"><svg class="service-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[s.slug]}</svg><span class="art-caption">${s.tag}</span>','<div class="service-art service-photo"><img src="/images/${s.slug}.png" alt="" width="1536" height="1024" loading="lazy">');
s=s.replace('<div class="service-art detail-art"><svg class="service-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[s.slug]}</svg><span class="art-caption">${s.name}</span></div>','<figure class="service-art detail-art service-photo"><img src="/images/${s.slug}.png" alt="Imagen ilustrativa de ${s.name.toLowerCase()}" width="1536" height="1024"><figcaption>Imagen ilustrativa</figcaption></figure>');
fs.writeFileSync(file,s);
