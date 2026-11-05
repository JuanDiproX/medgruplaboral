const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('médica invitada: llamada, identidad y firma de acta/informe sin sesión del panel',async()=>{
 const browser=await require('puppeteer-core').launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),origin='https://medgrup.example.invalid',token='a'.repeat(64),signed=[];let acta=false,reports=false;
  await page.setViewport({width:390,height:900});await page.setRequestInterception(true);
  page.on('request',r=>{
   const url=new URL(r.url());if(url.origin!==origin)return r.abort();
   if(url.pathname.startsWith('/api/acceso-medico/')){
    assert.equal(r.headers()['x-medico-invitacion'],token);assert.equal(r.headers()['x-session-token'],undefined);
    if(r.method()==='POST'){signed.push({url:url.pathname,body:JSON.parse(r.postData())});if(url.pathname.endsWith('/firma')&&!url.pathname.includes('/informes/'))acta=true;return r.respond({contentType:'application/json',body:'{"ok":true}'});}
    const data=url.pathname.endsWith('/sesion')?{ok:true,paciente:'Paciente de ejemplo',nombre:'Doctora de demostración',rol:'medico',llamada:origin+'/sala'}
     :url.pathname.endsWith('/firma')?{ok:true,nombre:'Doctora de demostración',paciente:'Paciente de ejemplo',tipo:'Junta médica',fecha:'2026-11-11',hora:'11:00',eventos:[{tipo:'union_medico',participante:'Doctora de demostración',creado_en:'2026-11-11T14:00:00Z'}],puede_firmar:true,firmada:acta}
     :url.pathname.endsWith('/informes')?{ok:true,informes:reports?[{id:1,contenido:{numero:'DEMO-1',informe_completo:'Texto del informe para revisión de la profesional.'},revision:'revision-prueba',firmado:false}]:[]}
     :{ok:true,mensajes:[]};
    return r.respond({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(url.pathname==='/sala')return r.respond({contentType:'text/html',body:'<p>Videollamada simulada</p>'});
   const file=url.pathname.slice(1);if(!['atencion.html','atencion.css','atencion.js','participant-signature.js','logo.png'].includes(file))return r.abort();
   return r.respond({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html',body:fs.readFileSync(path.join('public',file))});
  });
  await page.goto(origin+'/atencion.html#medico='+token,{waitUntil:'load'});
  await page.waitForFunction(()=>!document.querySelector('.firma-consulta').hidden);
  assert.equal(await page.evaluate(()=>localStorage.getItem('medgrup_token')),null);
  assert.match(await page.$eval('#paciente',e=>e.textContent),/Doctora de demostración/);
  assert.equal(await page.$eval('#video',e=>e.hidden),false);
  await page.$$eval('#firma-documentos button',buttons=>buttons.find(b=>b.textContent==='Leer y firmar el acta').click());
  await page.click('#firma-guardar');assert.match(await page.$eval('#firma-estado',e=>e.textContent),/Dibujá/);
  async function draw(){
   await page.$eval('#firma-lienzo',e=>e.scrollIntoView({block:'center'}));const box=await page.$eval('#firma-lienzo',e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y};});
   await page.mouse.move(box.x+25,box.y+50);await page.mouse.down();await page.mouse.move(box.x+80,box.y+95,{steps:8});await page.mouse.move(box.x+160,box.y+40,{steps:8});await page.mouse.up();await page.click('#firma-aceptar');
  }
  await draw();await page.click('#firma-guardar');await page.waitForFunction(()=>document.getElementById('firma-estado').textContent.includes('quedó registrada'));
  assert.equal(signed.length,1);assert.equal(signed[0].body.consentimiento,true);assert.equal(signed[0].body.nombre,undefined);
  reports=true;await page.click('#firma-actualizar');await page.waitForFunction(()=>document.getElementById('firma-documentos').textContent.includes('DEMO-1'));
  await page.$$eval('#firma-documentos button',buttons=>buttons.find(b=>b.textContent.includes('DEMO-1')).click());
  assert.match(await page.$eval('#firma-preview',e=>e.textContent),/Texto del informe/);
  fs.mkdirSync('output/participante',{recursive:true});await page.screenshot({path:'output/participante/firma-celular.png',fullPage:true});
  await draw();await page.click('#firma-guardar');await page.waitForFunction(()=>document.getElementById('firma-estado').textContent.includes('quedó registrada'));
  assert.equal(signed[1].url,'/api/acceso-medico/informes/1/firma');assert.equal(signed[1].body.revision,'revision-prueba');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }finally{await browser.close();}
});
