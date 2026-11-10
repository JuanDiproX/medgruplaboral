const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const express=require('express');
const {createShortLinks,valido}=require('../lib/short-links');
test('enlaces cortos: estables, cifrados, acotados a destinos propios y con vencimiento',async()=>{
  const db=new PGlite();let http;
  try{
    const pool={query:(sql,p)=>db.query(sql,p)};
    const links=createShortLinks({pool,secret:'clave-ficticia',baseUrl:()=>'https://portal.example.invalid',allowedHosts:['daily.co']});
    await links.init();
    const largo='/atencion.html#token='+'a'.repeat(64);
    const corto=await links.shorten(largo);
    assert.match(corto,/^https:\/\/portal\.example\.invalid\/i\/[a-z2-9]{10}$/);
    assert.ok(corto.length<50,'el enlace corto entra en una línea de WhatsApp');
    assert.equal(await links.shorten(largo),corto,'el mismo destino conserva su enlace corto');
    assert.equal(await links.shorten('https://portal.example.invalid'+largo),corto,'absoluto y relativo son el mismo destino');
    const code=corto.split('/').pop();assert.ok(valido(code));
    assert.equal(await links.resolve(code),largo);
    const fila=(await db.query('SELECT * FROM enlaces_cortos')).rows[0];
    assert.ok(!JSON.stringify(fila).includes('a'.repeat(64)),'el token no queda en claro en la base');
    assert.ok(!JSON.stringify(fila).includes(code),'el código no queda en claro en la base');
    assert.equal(await links.shorten('https://malicioso.example/phishing'),'https://malicioso.example/phishing','un destino ajeno no se acorta');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM enlaces_cortos')).rows[0].n,1);
    assert.match(await links.shorten('https://demo.daily.co/sala?t=abc'),/\/i\/[a-z2-9]{10}$/);
    assert.equal(await links.resolve('zzzzzzzzzz'),null);
    assert.equal(await links.resolve("x' OR 1=1--"),null);
    const app=express();links.mount(app);
    http=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const base='http://127.0.0.1:'+http.address().port;
    let r=await fetch(base+'/i/'+code,{redirect:'manual'});
    assert.equal(r.status,302);assert.equal(r.headers.get('location'),largo);assert.equal(r.headers.get('cache-control'),'no-store');
    r=await fetch(base+'/i/zzzzzzzzzz',{redirect:'manual'});assert.equal(r.status,404);
    await db.query("UPDATE enlaces_cortos SET vence_en=NOW()-INTERVAL '1 minute'");
    assert.equal(await links.resolve(code),null,'vencido no redirige');
  }finally{if(http)await new Promise(r=>http.close(r));await db.close();}
});
