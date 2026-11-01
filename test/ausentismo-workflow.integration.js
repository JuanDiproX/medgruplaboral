const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const express=require('express');
const {registerWorkflow}=require('../lib/ausentismo-workflow');
test('crear con ubicación; repetir sin heredar evidencia; idempotencia y rollback de validación',async()=>{
  const db=new PGlite();let server;let geocodes=0;
  try{
    await db.exec(`CREATE TABLE empresas_clientes(id SERIAL PRIMARY KEY,nombre TEXT); INSERT INTO empresas_clientes(nombre) VALUES('Empresa ficticia');
      CREATE TABLE medicos(id SERIAL PRIMARY KEY,nombre TEXT,activo BOOLEAN);INSERT INTO medicos(nombre,activo) VALUES('Médica de prueba',true);
      CREATE TABLE casos_ausentismo(id SERIAL PRIMARY KEY,empresa_id INT,empresa_nombre TEXT,trabajador_nombre TEXT,trabajador_dni TEXT,
      trabajador_telefono TEXT,motivo TEXT,documentacion TEXT,notas_admin TEXT,domicilio TEXT,domicilio_lat DOUBLE PRECISION,domicilio_lng DOUBLE PRECISION,
      radio_metros INT,tipo_control TEXT,profesional_id INT,estado TEXT,caso_anterior_id INT,excepcion_geo BOOLEAN);`);
    const query=(sql,params)=>sql.startsWith('SELECT pg_advisory')?Promise.resolve({rows:[]}):db.query(sql,params);
    const pool={query,connect:async()=>({query,release(){}})};
    const app=express();app.use(express.json());
    const auth=(req,res,next)=>req.headers['x-admin']==='1'?next():res.status(403).json({error:'Solo administradores'});
    registerWorkflow({app,pool,adminMiddleware:auth,geocodificar:async()=>{geocodes++;return {punto:{lat:-53,lng:-67}};},vincular:async()=>{},TIPOS_CONTROL:{ausentismo:'Control de ausentismo'}});
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base='http://127.0.0.1:'+server.address().port;
    const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'x-admin':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
    let response=await post('/api/ausentismo/casos',{empresa_nombre:'Empresa ficticia',trabajador_nombre:'Persona de prueba',trabajador_dni:'12345678',domicilio:'Dirección de prueba',domicilio_lat:-53,domicilio_lng:-67,radio_metros:300,profesional_id:1,validar_domicilio:true,motivo:'Primer control'});
    assert.equal(response.status,200);const first=await response.json();assert.equal(geocodes,0);
    assert.equal((await db.query('SELECT estado FROM casos_ausentismo WHERE id=$1',[first.id])).rows[0].estado,'asignado');
    response=await post(`/api/ausentismo/casos/${first.id}/nuevo-control`,{});assert.equal(response.status,409);
    await db.query("UPDATE casos_ausentismo SET estado='resuelto',excepcion_geo=true,documentacion='Documento anterior' WHERE id=$1",[first.id]);
    response=await post(`/api/ausentismo/casos/${first.id}/nuevo-control`,{motivo:'Revisión actual'});assert.equal(response.status,200);
    const next=await response.json(),row=(await db.query('SELECT * FROM casos_ausentismo WHERE id=$1',[next.id])).rows[0];
    assert.equal(row.caso_anterior_id,first.id);assert.equal(row.domicilio_lat,-53);assert.equal(row.profesional_id,1);
    assert.equal(row.documentacion,'');assert.equal(row.excepcion_geo,false);assert.equal(row.motivo,'Revisión actual');
    response=await post(`/api/ausentismo/casos/${first.id}/nuevo-control`,{});assert.equal((await response.json()).id,next.id);
    const before=(await db.query('SELECT COUNT(*)::int AS n FROM casos_ausentismo')).rows[0].n;
    response=await post('/api/ausentismo/casos',{empresa_nombre:'Empresa ficticia',trabajador_nombre:'Otro',domicilio_lat:NaN,domicilio_lng:20});assert.equal(response.status,400);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM casos_ausentismo')).rows[0].n,before);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
});
