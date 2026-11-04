const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
test('scripts del panel compilan sin ejecutarlos',()=>{
  for(const file of ['public/index.html','public/empresa.html']){
    const html=fs.readFileSync(file,'utf8');
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
      if(!/\bsrc\s*=/.test(match[1])&&!/application\/ld\+json/.test(match[1]))new vm.Script(match[2]);
    }
  }
});
test('formulario integrado: errores, punto confirmado, doble envío, repetición y móvil',async()=>{
  const puppeteer=require('puppeteer-core');
  const executablePath=process.env.PUPPETEER_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox']});
  try{
    const html=fs.readFileSync('public/index.html','utf8');
    const head=html.slice(html.indexOf('<head>')+6,html.indexOf('</head>'));
    const start=html.indexOf('<div id="sec-ausentismo"');const end=html.indexOf('<div id="sec-seguimientos"',start);
    const section=html.slice(start,end).replace('style="display:none;"','');
    const page=await browser.newPage();await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);await page.setRequestInterception(true);
    page.on('request',req=>req.url().startsWith('data:')?req.continue():req.abort());
    await page.setViewport({width:1440,height:1200});
    await page.setContent(`<html><head>${head}<style>body{display:block!important}.main{margin:0!important;padding:28px!important}#sec-ausentismo{display:block!important}</style></head><body><main class="main"><h1>Control de ausentismo</h1>${section}</main></body></html>`);
    await page.addStyleTag({path:path.resolve('public/ausentismo-flow.css')});
    await page.addStyleTag({path:path.resolve('public/claude-demo.css')});
    await page.evaluate(()=>{
      window.casosAusentismo=[{id:1,estado:'resuelto',trabajador_nombre:'Persona de demostración',empresa_nombre:'Empresa de prueba',trabajador_dni:'12345678',domicilio:'Av. de prueba 123, Río Grande',domicilio_lat:-53.78,domicilio_lng:-67.7,radio_metros:300,profesional_id:1}];
      document.getElementById('au-empresa').replaceChildren(new Option('Empresa de prueba','Empresa de prueba'));
      window.apiHeaders=()=>({});window.onTipoControlChange=()=>{};window.mostrarError=()=>{};window.mostrarToast=()=>{};window.cargarCasosAusentismo=async()=>{};window.abrirProgramarCaso=()=>{};window.abrirAsignarCaso=()=>{};
      window.requests=[];window.fetch=async(url,opts)=>{
        window.requests.push({url,body:opts?.body});
        if(url==='/api/medicos')return {json:async()=>[{id:1,nombre:'Profesional de prueba',activo:true}]};
        if(url==='/api/geocode')return {ok:true,json:async()=>({ok:true,lat:-53.78,lng:-67.7,direccion_normalizada:'Dirección de demostración'})};
        return {ok:true,json:async()=>({ok:true,id:2,correo_solicitud:'enviado'})};
      };
    });
    await page.addScriptTag({path:path.resolve('public/ausentismo-flow.js')});
    await page.waitForFunction(()=>new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#au-panel-alta .au-alta-hoja')).transform).m42>0,{timeout:5000});
    const entrada=await page.$eval('#au-panel-alta .au-alta-hoja',el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return {x:m.m41,y:m.m42};});
    assert.equal(entrada.x,0);assert.ok(entrada.y>0,'el alta entra desde abajo');
    // El alta se abre centrada desde el botón "Nuevo caso".
    await page.evaluate(()=>window.abrirAltaCaso());
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#au-panel-alta .au-alta-hoja')).transform==='none');
    assert.equal(await page.$eval('#au-panel-alta .au-alta-hoja',el=>{const r=el.getBoundingClientRect();return Math.abs(r.left+r.width/2-innerWidth/2)<1&&Math.abs(r.top+r.height/2-innerHeight/2)<1;}),true,'alta centrada en escritorio');
    await page.click('#au-guardar');assert.match(await page.$eval('#au-error',e=>e.textContent),/empresa y trabajador/);
    await page.type('#au-trabajador','Persona de prueba');await page.type('#au-domicilio','Dirección ficticia, Río Grande');await page.type('#au-motivo','Control de demostración');
    await page.type('#au-solicitante-email','empresa@example.invalid');await page.type('#au-trabajador-email','paciente@example.invalid');
    fs.mkdirSync('output/ausentismo-preview',{recursive:true});
    await page.$eval('#au-panel-alta .card-body',el=>el.scrollTop=0);
    await page.screenshot({path:'output/ausentismo-preview/escritorio.png',fullPage:true});
    await page.$eval('#au-buscar',el=>el.scrollIntoView({block:'center',behavior:'instant'}));
    await page.click('#au-buscar');await page.waitForFunction(()=>document.getElementById('au-geo-status').dataset.state==='ok');
    await page.evaluate(()=>Promise.all([window.crearCasoAusentismo(),window.crearCasoAusentismo()]));
    const requests=await page.evaluate(()=>window.requests);
    assert.equal(requests.filter(r=>r.url==='/api/ausentismo/casos').length,1);
    const saved=JSON.parse(requests.find(r=>r.url==='/api/ausentismo/casos').body);assert.equal(saved.domicilio_lat,-53.78);assert.equal(saved.validar_domicilio,true);
    assert.equal('documentacion' in saved,false,'alta con un solo campo narrativo');
    await page.evaluate(()=>window.nuevoControlCaso(1));
    assert.equal(await page.$eval('#au-trabajador',e=>e.value),'Persona de demostración');assert.equal(await page.$eval('#au-motivo',e=>e.value),'');
    assert.match(await page.$eval('#au-flow-summary',e=>e.textContent),/no se copian/);
    // No external map requests in local UI tests. Layout is tested independently of map tiles.
    await page.$eval('#au-mapa',e=>{e.hidden=true;});
    await page.setViewport({width:390,height:1100});
    await page.screenshot({path:'output/ausentismo-preview/celular.png',fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'sin desplazamiento horizontal');
    assert.equal(await page.$eval('#au-panel-alta .au-alta-hoja',el=>Math.abs(el.getBoundingClientRect().bottom-innerHeight)<1),true,'alta alineada al pie en móvil');
    await page.evaluate(()=>cerrarAltaCaso());
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    await page.evaluate(()=>abrirAltaCaso());
    assert.equal(await page.$eval('#au-panel-alta .au-alta-hoja',el=>getComputedStyle(el).transform),'none','respeta movimiento reducido');
  }finally{await browser.close();}
});
