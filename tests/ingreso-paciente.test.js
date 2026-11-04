const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const origin='https://medgrup.example.invalid';
const datos={ok:true,trabajador:'Persona de demostración',fecha:'2026-11-04',hora:'16:00',control:'Control de ausentismo',domicilio:'Dirección de ejemplo 123, Río Grande',tiene_domicilio:true};
async function pagina(browser,{data=datos,response={ok:true,link:'/atencion.html#token=prueba'},geo='ok',network=false}={}){
  const page=await browser.newPage();const posts=[];let fail=network;
  await page.setViewport({width:390,height:844});
  await page.evaluateOnNewDocument(geo=>{
    window.geoCalls=0;Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok,error,options){window.geoCalls++;window.geoOptions=options;setTimeout(()=>geo==='ok'?ok({coords:{latitude:-53.78,longitude:-67.7,accuracy:20}}):error({code:geo==='denied'?1:3}),150);}}});
  },geo);
  await page.setRequestInterception(true);
  page.on('request',async r=>{
    const url=new URL(r.url());
    if(url.origin!==origin)return r.abort();
    if(url.pathname.startsWith('/api/ingreso/')){
      if(fail){fail=false;return r.abort();}
      if(r.method()==='POST'){posts.push(JSON.parse(r.postData()));return r.respond({status:response.ok?200:403,contentType:'application/json',body:JSON.stringify(response)});}
      return r.respond({status:data.ok?200:404,contentType:'application/json',body:JSON.stringify(data)});
    }
    const file=url.pathname.startsWith('/ingreso/')?'ingreso.html':url.pathname.slice(1);
    if(!['ingreso.html','ingreso.css','ingreso.js','logo.png'].includes(file))return r.abort();
    return r.respond({status:200,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html',body:fs.readFileSync(path.join('public',file))});
  });
  await page.goto(origin+'/ingreso/token-ficticio',{waitUntil:'load'});
  await page.waitForFunction(()=>document.getElementById('cargando').hidden);
  return {page,posts};
}

test('ingreso móvil: ubicación concedida/denegada, fuera de rango, excepción y cierres',async()=>{
  const browser=await require('puppeteer-core').launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
  fs.mkdirSync('output/ingreso-paciente',{recursive:true});
  try{
    const normal=await pagina(browser);
    assert.equal(await normal.page.evaluate(()=>window.geoCalls),0,'la ubicación solo se solicita al tocar Validar');
    assert.equal(await normal.page.$eval('#link-llamada',e=>e.hidden),true,'no se ofrece acceso antes de validar');
    for(const width of [320,390,1280]){
      await normal.page.setViewport({width,height:900});
      assert.equal(await normal.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(width!==320)await normal.page.screenshot({path:`output/ingreso-paciente/listo-${width}.png`,fullPage:true});
    }
    await normal.page.evaluate(()=>{document.getElementById('btn').click();document.getElementById('btn').click();});
    await normal.page.waitForFunction(()=>!document.getElementById('link-llamada').hidden);
    assert.equal(normal.posts.length,1);assert.equal(normal.posts[0].precision,20);
    assert.equal(await normal.page.evaluate(()=>window.geoOptions.maximumAge),0);
    assert.equal(await normal.page.$eval('#paso-ingresar',e=>e.getAttribute('aria-current')),'step');
    assert.equal(await normal.page.$eval('#link-llamada',e=>e.getAttribute('href')),'/atencion.html#token=prueba');
    await normal.page.setViewport({width:390,height:844});
    await normal.page.screenshot({path:'output/ingreso-paciente/validado.png',fullPage:true});await normal.page.close();

    for(const [name,geo,response] of [
      ['permiso-denegado','denied',{ok:false,code:'SIN_UBICACION',error:'No se pudo obtener la ubicación'}],
      ['fuera-de-rango','ok',{ok:false,code:'FUERA_DE_RANGO',error:'La ubicación está fuera del radio permitido. Permanecé en el domicilio informado y volvé a intentar.'}],
      ['sin-senal','timeout',{ok:false,code:'SIN_UBICACION'}]
    ]){
      const p=await pagina(browser,{geo,response});await p.page.click('#btn');
      await p.page.waitForFunction(()=>!document.getElementById('btn').hidden&&document.getElementById('aviso').textContent.length>0);
      assert.equal(await p.page.$eval('#link-llamada',e=>e.hidden),true);
      if(geo==='denied'){assert.deepEqual(p.posts,[{}]);assert.match(await p.page.$eval('#aviso',e=>e.textContent),/permiso/);}
      await p.page.screenshot({path:`output/ingreso-paciente/${name}.png`,fullPage:true});await p.page.close();
    }
    const excepcion=await pagina(browser,{data:{...datos,excepcion_geo:true},response:{ok:true,link:'/atencion.html#token=excepcion',excepcion_geo:true}});
    await excepcion.page.click('#btn');await excepcion.page.waitForFunction(()=>!document.getElementById('link-llamada').hidden);
    assert.equal(await excepcion.page.evaluate(()=>window.geoCalls),0);
    assert.match(await excepcion.page.$eval('#aviso',e=>e.textContent),/sin validación geográfica/);await excepcion.page.close();
    for(const data of [{...datos,cerrado:true},{...datos,tiene_domicilio:false},{ok:false,error:'Enlace no válido <prueba>'}]){
      const p=await pagina(browser,{data});assert.equal(await p.page.$eval('#btn',e=>e.hidden),true);assert.equal(await p.page.$eval('#link-llamada',e=>e.hidden),true);
      assert.equal(await p.page.$('#aviso prueba'),null);await p.page.close();
    }
    const p=await pagina(browser,{network:true});assert.equal(await p.page.$eval('#recargar',e=>e.hidden),false);
    await p.page.click('#recargar');await p.page.waitForFunction(()=>!document.getElementById('btn').hidden);await p.page.close();
  }finally{await browser.close();}
});

test('espacio móvil de atención: conserva acceso a validar y chat, sin habilitar la llamada antes de tiempo',async()=>{
 const browser=await require('puppeteer-core').launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.setViewport({width:390,height:844});await page.setRequestInterception(true);
  page.on('request',r=>{
   const url=new URL(r.url());if(url.origin!==origin)return r.abort();
   if(url.pathname==='/api/chat/paciente/sesion')return r.respond({contentType:'application/json',body:JSON.stringify({paciente:'Persona de demostración',ingreso:'/ingreso/token-ficticio',llamada:null})});
   if(url.pathname==='/api/chat/paciente/mensajes')return r.respond({contentType:'application/json',body:'{"mensajes":[]}'});
   const file=url.pathname.slice(1);
   if(!['atencion.html','atencion.css','atencion.js','logo.png'].includes(file))return r.abort();
   return r.respond({contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'text/html',body:fs.readFileSync(path.join('public',file))});
  });
  await page.goto(origin+'/atencion.html#token=ficticio',{waitUntil:'load'});
  await page.waitForFunction(()=>!document.getElementById('ingreso').hidden);
  assert.equal(await page.$eval('#ingreso',e=>e.getAttribute('href')),'/ingreso/token-ficticio');
  assert.equal(await page.$eval('#conectar',e=>e.hidden),true);assert.equal(await page.$eval('#video',e=>e.hidden),true);
  assert.equal(await page.$eval('#enviar',e=>e.disabled),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'output/ingreso-paciente/atencion-celular.png',fullPage:true});
 }finally{await browser.close();}
});
