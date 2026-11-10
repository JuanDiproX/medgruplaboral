const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('paneles de alta: acceso, teclado, conservación de datos y móvil',async()=>{
  const browser=await require('puppeteer-core').launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
  try{
    const html=fs.readFileSync('public/index.html','utf8');
    const page=await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request',r=>r.url().startsWith('data:')?r.continue():r.abort());
    await page.setViewport({width:1440,height:1000});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addStyleTag({path:path.resolve('public/claude-demo.css')});
    await page.addStyleTag({content:'body{display:block!important}.app-page{display:block!important}.login-page{display:none!important}.main{margin:0!important}'});
    await page.addScriptTag({content:html.slice(html.indexOf('let panelLateralAbierto ='),html.indexOf('function showSection('))});
    const panels={'pl-reunion':'reuniones','pl-medico':'medicos','pl-admin':'medicos','pl-empresa':'empresas'};
    // Los paneles de presupuestos se retiraron: el catálogo de servicios quedó en su propia sección.
    assert.equal(await page.$('#pl-presupuesto'),null);assert.ok(await page.$('#sec-presupuestos #catalogo-lista'));
    fs.mkdirSync('output/paneles-preview',{recursive:true});
    for(const [id,section] of Object.entries(panels)){
      await page.evaluate(section=>{
        document.querySelectorAll('[id^="sec-"]').forEach(e=>e.style.display='none');
        document.getElementById('sec-'+section).style.display='block';
      },section);
      const trigger=`[onclick="abrirPanelLateral('${id}')"]`;
      await page.click(trigger);
      await page.waitForFunction(id=>getComputedStyle(document.querySelector('#'+id+' .pl-hoja')).transform==='none',{},id);
      assert.equal(await page.$eval('#'+id,e=>e.classList.contains('abierto')),true);
      await page.evaluate(id=>{
        const el=document.querySelector('#'+id+' .card-body input:not([type=hidden])');
        if(el && ['text','email'].includes(el.type))el.value='Demostración';
      },id);
      const before=await page.$eval('#'+id,e=>[...e.querySelectorAll('input')].map(i=>i.value));
      await page.focus('#'+id+' .pl-cerrar');
      await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
      assert.equal(await page.evaluate(id=>document.getElementById(id).contains(document.activeElement),id),true);
      if(id==='pl-empresa')await page.screenshot({path:'output/paneles-preview/escritorio.png'});
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('#'+id,e=>e.classList.contains('abierto')),false);
      await page.click(trigger);
      assert.deepEqual(await page.$eval('#'+id,e=>[...e.querySelectorAll('input')].map(i=>i.value)),before);
      await page.evaluate(()=>cerrarPanelLateral());
    }
    await page.setViewport({width:390,height:844});
    await page.evaluate(()=>abrirPanelLateral('pl-empresa'));
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#pl-empresa .pl-hoja')).transform==='none');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'output/paneles-preview/celular.png'});
  }finally{await browser.close();}
});
