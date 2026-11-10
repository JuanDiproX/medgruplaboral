const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const seguridad=require('../lib/security');
test('seguridad: cabeceras, CORS por origen, límite por IP, errores sin detalle y contraseñas',async()=>{
  const app=express();app.set('trust proxy',1);
  app.use(seguridad.headers({production:true}));
  app.use(require('cors')(seguridad.corsOptions('https://permitido.example')));
  app.get('/api/dato',(req,res)=>res.json({ok:true}));
  app.get('/api/limitado',seguridad.rateLimit({name:'t',windowMs:60000,max:2}),(req,res)=>res.json({ok:true}));
  app.get('/api/falla-interna',(req,res)=>seguridad.fallo(res,Object.assign(new Error('relation "usuarios" does not exist'),{code:'42P01'})));
  app.get('/api/falla-propia',(req,res)=>seguridad.fallo(res,new Error('No se pudo crear la sala de videollamada')));
  const http=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+http.address().port;
  try{
    let r=await fetch(base+'/api/dato');
    assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('x-frame-options'),'SAMEORIGIN');
    assert.match(r.headers.get('strict-transport-security'),/max-age=31536000/);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);
    assert.equal(r.headers.get('cache-control'),'no-store');
    assert.equal(r.headers.get('access-control-allow-origin'),null);
    r=await fetch(base+'/api/dato',{headers:{origin:'https://atacante.example'}});assert.equal(r.headers.get('access-control-allow-origin'),null,'otro origen no recibe permiso CORS');
    r=await fetch(base+'/api/dato',{headers:{origin:'https://permitido.example'}});assert.equal(r.headers.get('access-control-allow-origin'),'https://permitido.example');
    assert.equal((await fetch(base+'/api/limitado')).status,200);assert.equal((await fetch(base+'/api/limitado')).status,200);
    r=await fetch(base+'/api/limitado');assert.equal(r.status,429);assert.ok(Number(r.headers.get('retry-after'))>0);
    r=await (await fetch(base+'/api/falla-interna')).json();assert.ok(!/usuarios|relation/.test(r.error),'no expone el error de la base');assert.match(r.ref,/^[a-f0-9]{8}$/);
    r=await (await fetch(base+'/api/falla-propia')).json();assert.equal(r.error,'No se pudo crear la sala de videollamada');
    assert.match(seguridad.claveDebil('corta1'),/al menos 10/);assert.match(seguridad.claveDebil('solamenteletras'),/letras y números/);
    assert.match(seguridad.claveDebil('medgrup2026'),/menos predecible/);assert.equal(seguridad.claveDebil('Ushuaia-nevada-48'),null);
  }finally{await new Promise(r=>http.close(r));}
});
