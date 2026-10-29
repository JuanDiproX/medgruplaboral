const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve('output/railway-site/public');
test('Paquete comercial: enlaces internos, SEO y nueva página',()=>{
 const pages=fs.readdirSync(root).filter(x=>x.endsWith('.html')).concat(fs.readdirSync(path.join(root,'servicios')).filter(x=>x.endsWith('.html')).map(x=>'servicios/'+x));
 for(const page of pages){const html=fs.readFileSync(path.join(root,page),'utf8');for(const match of html.matchAll(/(?:href|src)="(\/[^"?#]*)(?:[?#][^"]*)?"/g)){const file=decodeURIComponent(match[1]);if(file==='/'||file.startsWith('/api/'))continue;assert.ok(fs.existsSync(path.join(root,file)),`${page}: ${file}`);}}
 const html=fs.readFileSync(path.join(root,'servicios/licencias-psiquiatricas.html'),'utf8');assert.match(html,/<link rel="canonical" href="https:\/\/laboral.medgrup.com.ar\/servicios\/licencias-psiquiatricas.html">/);assert.match(fs.readFileSync(path.join(root,'sitemap.xml'),'utf8'),/licencias-psiquiatricas.html/);
 assert.ok(!fs.existsSync(path.join(root,'llamada.js')));
});
test('Servidor público: métricas limitadas, contacto y páginas',async()=>{
 const child=spawn(process.execPath,['server.cjs'],{cwd:path.resolve('output/railway-site'),env:{...process.env,PORT:'4181',SMTP_PASSWORD:''},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);
 const base='http://127.0.0.1:4181';try{
 for(let i=0;i<30;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal((await fetch(base+'/servicios/licencias-psiquiatricas.html')).status,200);
 assert.equal((await fetch(base+'/no-existe')).status,404);
 const post=(url,data,origin='https://laboral.medgrup.com.ar')=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(data)});
 assert.equal((await post('/api/eventos',{event:'page_view',path:'/'})).status,204);
 assert.equal((await post('/api/eventos',{event:'page_view',path:'/?email=secreto'})).status,400);
 assert.equal((await post('/api/eventos',{event:'page_view',path:'/'},'https://otro.com')).status,403);
 assert.equal((await post('/api/contacto',{website:'bot'})).status,200);
 const response=await post('/api/contacto',{empresa:'Prueba',nombre:'Prueba',email:'prueba@example.com',telefono:'',servicio:'Auditorías psiquiátricas',mensaje:'Consulta comercial'});
 assert.equal(response.status,503);assert.match((await response.json()).message,/correo/);
 await new Promise(r=>setTimeout(r,100));assert.match(output,/commercial_event/);assert.ok(!output.includes('secreto'));
 }finally{child.kill();}
});
