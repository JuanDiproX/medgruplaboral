const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

test('lista compacta: menú, detalle, historial, permisos y foco al actualizar',async()=>{
  const browser=await require('puppeteer-core').launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
  try{
    const html=fs.readFileSync('public/index.html','utf8');
    const page=await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request',r=>r.url().startsWith('data:')?r.continue():r.abort());
    await page.setViewport({width:1440,height:1000});
    const start=html.indexOf('<div id="sec-ausentismo"'),end=html.indexOf('<div id="sec-seguimientos"',start);
    const head=html.slice(html.indexOf('<head>')+6,html.indexOf('</head>'));
    await page.setContent(`<html><head>${head}<style>body{display:block!important}.main{margin:0!important;padding:28px!important}#sec-ausentismo{display:block!important}</style></head><body><main class="main"><h1>Ausentismo</h1>${html.slice(start,end)}</main></body></html>`);
    await page.addStyleTag({path:path.resolve('public/claude-demo.css')});
    await page.addScriptTag({content:html.slice(html.indexOf('function escaparHtml('),html.indexOf('// Mismo saneo que limpiarMarkdown'))});
    await page.addScriptTag({content:html.slice(html.indexOf('let panelLateralAbierto ='),html.indexOf('function showSection('))});
    await page.addScriptTag({content:html.slice(html.indexOf('let casosAusentismo ='),html.indexOf('// ----- Domicilio de reposo y control por ubicación -----'))});
    await page.evaluate(()=>{
      window.usuarioActual={rol:'admin'};
      const base={empresa_nombre:'Empresa de demostración',tipo_control:'ausentismo',domicilio:'Domicilio de ejemplo 123',domicilio_lat:-53.7,domicilio_lng:-67.7,radio_metros:300,profesional_id:1,profesional_nombre:'Profesional de prueba',trabajador_dni:'12345678'};
      casosAusentismo=[
        {...base,id:1,trabajador_nombre:'Persona de demostración',estado:'resuelto',creado_en:'2026-10-01',turno_id:'anterior',turno_fecha:'2026-10-01',turno_hora:'15:00'},
        {...base,id:2,trabajador_nombre:'Persona de demostración',estado:'resuelto',creado_en:'2026-11-01',caso_anterior_id:1,turno_id:'actual',turno_fecha:'2026-11-04',turno_hora:'16:00',no_comparecio:true,documentacion:'Documento histórico <conservado>',motivo:'Motivo de ejemplo'},
        {...base,id:3,trabajador_nombre:'Otra persona con nombre largo para comprobar la adaptación a pantallas pequeñas',trabajador_dni:'12345679',estado:'asignado',creado_en:'2026-11-02',domicilio_lat:null},
        {...base,id:4,trabajador_nombre:'Nuevo caso de demostración',trabajador_dni:'12345670',estado:'nuevo',creado_en:'2026-11-03',profesional_id:null,profesional_nombre:null}
      ];
      renderCasosAusentismo();
    });
    assert.equal(await page.$$eval('.au-fila',els=>els.length),3);
    assert.equal(await page.$('#au-documentacion'),null);
    const row='.au-fila[data-caso-id="2"]';
    const rowText=await page.$eval(row,e=>e.textContent);
    assert.match(rowText,/No compareció/);assert.ok(!rowText.includes('Domicilio de ejemplo'));
    const menu=row+' .au-mas';
    await page.click(menu);assert.equal(await page.$eval(menu,e=>e.getAttribute('aria-expanded')),'true');
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(s=>document.activeElement===document.querySelector(s),menu),true);
    await page.click(row+' .au-ver');
    await page.waitForFunction(()=>document.activeElement.id==='au-detalle-titulo');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#au-detalle .pl-hoja')).transform==='none');
    assert.match(await page.$eval('#au-detalle-cuerpo',e=>e.textContent),/Documento histórico <conservado>/);
    assert.equal(await page.$('#au-detalle-cuerpo conservado'),null);
    assert.equal(await page.$eval('#au-detalle-cuerpo .au-anteriores a',e=>e.getAttribute('href')),'/api/turnos/anterior/acta');
    fs.mkdirSync('output/ausentismo-compacto',{recursive:true});
    await page.screenshot({path:'output/ausentismo-compacto/detalle-escritorio.png',fullPage:true});
    await page.focus('#au-detalle-cuerpo .au-det-doc');
    const action=await page.evaluate(()=>document.activeElement.getAttribute('onclick'));
    await page.evaluate(()=>renderCasosAusentismo());
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('onclick')),action);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(s=>document.activeElement===document.querySelector(s),row+' .au-ver'),true);
    await page.focus('#au-filtro-estado');await page.select('#au-filtro-estado','resuelto');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'au-filtro-estado');
    assert.equal(await page.$$eval('.au-fila',els=>els.length),1);
    await page.select('#au-filtro-estado','');
    fs.mkdirSync('output/ausentismo-compacto',{recursive:true});
    await page.screenshot({path:'output/ausentismo-compacto/escritorio.png',fullPage:true});
    await page.evaluate(()=>{usuarioActual.rol='medico';renderCasosAusentismo();});
    await page.click(menu);
    const actions=await page.$eval('.au-menu',e=>e.textContent);
    assert.ok(!actions.includes('Eliminar caso'));assert.ok(!actions.includes('Nuevo control'));assert.ok(!actions.includes('Domicilio'));
    await page.keyboard.press('Escape');
    await page.setViewport({width:390,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'output/ausentismo-compacto/celular.png',fullPage:true});
    await page.click(row+' .au-ver');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#au-detalle .pl-hoja')).transform==='none');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'output/ausentismo-compacto/detalle-celular.png',fullPage:true});
    await page.$eval('#au-detalle-cuerpo .au-det-doc',e=>e.scrollIntoView({block:'start'}));
    await page.screenshot({path:'output/ausentismo-compacto/documentos-celular.png',fullPage:true});
  }finally{await browser.close();}
});
