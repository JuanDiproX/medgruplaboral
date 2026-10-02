const fs=require('fs');
const home='public/medicina-laboral.html';let html=fs.readFileSync(home,'utf8');
html=html.replace('Medicina laboral<br>para tu <em>empresa.</em>','Medicina laboral,<br><em>cerca de tu equipo.</em>');
html=html.replace('Evaluaciones médicas, juntas y control de ausentismo.','Atención médica, seguimiento y gestión para tu empresa.');
html=html.replace('<h2>Nuestros servicios</h2>','<h2>Atención para cada <em>necesidad.</em></h2>');
html=html.replace('<h2>Equipo médico</h2>','<h2>La atención tiene <em>nombre propio.</em></h2>');
html=html.replace('<h2>Una propuesta para<br>cuidar a tu equipo.</h2>','<h2>Una propuesta para<br><em>cuidar a tu equipo.</em></h2>');
html=html.replace('<h2>Empresas que confiaron<br>en nosotros</h2>','<h2>Empresas que <em>confiaron</em><br>en nosotros</h2>');
html=html.replace('<h2>La propuesta empieza<br>por conocer tu empresa.</h2>','<h2>Conozcamos tu empresa.<br><em>Armemos tu propuesta.</em></h2>');
fs.writeFileSync(home,html);
for(const file of ['public/contacto.html','public/propuesta.html']){
 let h=fs.readFileSync(file,'utf8');
 h=h.replace('Hablemos de<br>tu <em>empresa.</em>','Hablemos de<br><em>tu empresa.</em>');
 fs.writeFileSync(file,h);
}
