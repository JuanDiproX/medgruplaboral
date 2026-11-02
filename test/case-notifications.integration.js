const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createCaseNotifications,email}=require('../lib/case-notifications');
test('correos: destinatarios separados, deduplicación, reintento y reprogramación sin envíos reales',async()=>{
  const db=new PGlite();const sent=[];let enabled=false;
  try{
    await db.exec('CREATE TABLE casos_ausentismo(id SERIAL PRIMARY KEY);INSERT INTO casos_ausentismo DEFAULT VALUES;');
    const query=(s,p)=>!p&&s.includes(';')?db.exec(s):db.query(s,p);
    const pool={query,connect:async()=>({query,release(){}})};
    const n=createCaseNotifications({pool,baseUrl:()=> 'https://example.invalid',send:async(to,subject,html)=>{if(enabled)sent.push({to,subject,html});return enabled;}});
    await n.init();await n.init();
    const caso={id:1,empresa_nombre:'Empresa de prueba',trabajador_nombre:'Persona <prueba>',solicitante_email:'empresa@example.invalid',trabajador_email:'paciente@example.invalid',motivo:'diagnóstico privado'};
    const id=await n.request(pool,caso);assert.equal(await n.deliver(id),'pendiente');assert.equal(sent.length,0);
    enabled=true;assert.equal(await n.deliver(id),'enviado');assert.equal(sent[0].to,caso.solicitante_email);assert.ok(!sent[0].html.includes(caso.motivo));assert.ok(sent[0].html.includes('&lt;prueba&gt;'));
    assert.equal(await n.request(pool,caso),id);await n.deliver(id);assert.equal(sent.length,1);
    const old=await n.visit(pool,caso,{fecha:'2026-11-04',hora:'10:00',link:'https://example.invalid/atencion#token=prueba'});
    const newer=await n.visit(pool,caso,{fecha:'2026-11-04',hora:'11:00',link:'https://example.invalid/atencion#token=prueba'});
    assert.equal(await n.deliver(old),'reemplazado');assert.equal(await n.deliver(newer),'enviado');assert.equal(sent[1].to,caso.trabajador_email);assert.ok(sent[1].html.includes('11:00'));
    assert.equal(await n.visit(pool,caso,{fecha:'2026-11-04',hora:'11:00',link:'https://example.invalid/atencion#token=prueba'}),newer);
    const returned=await n.visit(pool,{...caso,visita_mail_version:2},{fecha:'2026-11-04',hora:'10:00',link:'https://example.invalid/atencion#token=prueba'});assert.notEqual(returned,old,'volver a una fecha anterior es una nueva notificación');
    await assert.rejects(n.request(pool,{...caso,trabajador_email:''}),/correo válido/);
    for(const bad of ['bad','a@example.com\r\nBcc:b@example.com','x(a)@example.com','a@example.com,b@example.com'])assert.equal(email(bad),null);
  }finally{await db.close();}
});
