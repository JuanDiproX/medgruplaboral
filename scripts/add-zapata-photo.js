const fs=require('fs');
const file='public/medicina-laboral.html';
let html=fs.readFileSync(file,'utf8');
html=html.replace(/<article><div class="portrait-placeholder pending-portrait">[\s\S]*?<\/div><div class="doctor-info"><h3>Dra\. María Isabel Zapata<\/h3>/,'<article><div class="doctor-portrait zapata-portrait"><img src="/images/maria-isabel-zapata.png" alt="Dra. María Isabel Zapata" width="655" height="1600" loading="lazy"></div><div class="doctor-info"><h3>Dra. María Isabel Zapata</h3>');
fs.writeFileSync(file,html);
