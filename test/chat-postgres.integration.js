// npm install --prefix tmp/chat-validation --no-package-lock @electric-sql/pglite express
// node --test test/chat-postgres.integration.js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('../tmp/chat-validation/node_modules/@electric-sql/pglite');
const express=require('../tmp/chat-validation/node_modules/express');
const {createTurnoChat}=require('../lib/turno-chat');

test('HTTP + PostgreSQL aislado: esquema, invitaciones, archivos, permisos y revocación',async()=>{
  const db=new PGlite();
  let server;
  try{
    await db.exec(`CREATE TABLE turnos(id VARCHAR(50) PRIMARY KEY,paciente TEXT,estado TEXT,fecha DATE,hora TEXT,link_paciente TEXT);
      CREATE TABLE casos_ausentismo(id SERIAL PRIMARY KEY,turno_id VARCHAR(50),token_ingreso TEXT,estado TEXT);
      CREATE TABLE turno_medicos(turno_id VARCHAR(50),medico_nombre TEXT);
      INSERT INTO turnos VALUES('prueba','Paciente ficticio','pendiente',CURRENT_DATE+10,'09:45','https://example.invalid/daily');
      INSERT INTO turnos VALUES('otro','Otro paciente','pendiente',CURRENT_DATE,'10:00','https://example.invalid/otro');
      INSERT INTO turno_medicos VALUES('prueba','Profesional asignado');`);
    const query=async(sql,params)=>{
      if(sql.startsWith('CREATE TABLE'))return db.exec(sql);
      const r=await db.query(sql,params);
      // node-postgres devuelve bytea como Buffer; PGlite usa Uint8Array.
      for(const row of r.rows)if(row.archivo instanceof Uint8Array)row.archivo=Buffer.from(row.archivo);
      return r;
    };
    const pool={query,connect:async()=>({query,release(){}})};
    const app=express();app.use(express.json({limit:'10mb'}));
    const authMiddleware=(req,res,next)=>{
      const role=req.headers['x-test-role'];if(!role)return res.status(401).json({error:'No autorizado'});
      req.usuario={rol:role,nombre:req.headers['x-test-name']||'Administrador ficticio'};next();
    };
    const chat=createTurnoChat({app,pool,authMiddleware,enabled:true});await chat.init();await chat.init();
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base='http://127.0.0.1:'+server.address().port;
    const admin={'x-test-role':'admin'};
    const invite=await(await fetch(base+'/api/turnos/prueba/chat/invitacion',{method:'POST',headers:admin})).json();
    const patient={'x-chat-token':invite.link.split('=')[1]};
    let response=await fetch(base+'/api/chat/paciente/sesion',{headers:patient});
    let session=await response.json();assert.equal(session.paciente,'Paciente ficticio');assert.ok(session.llamada);
    assert.ok(new Date(session.vence_en).getTime()>Date.now()+11*86400000,'el turno futuro no vence antes de la atención');
    const content=Buffer.from('%PDF-1.4\nArchivo de prueba sin información personal');
    response=await fetch(base+'/api/chat/paciente/mensajes',{method:'POST',headers:{...patient,'Content-Type':'application/json'},body:JSON.stringify({texto:'Estudio ficticio',adjunto:{name:'estudio.pdf',base64:content.toString('base64')}})});
    assert.equal(response.status,201);const saved=await response.json();
    response=await fetch(base+'/api/turnos/prueba/chat/archivos/'+saved.mensaje.id,{headers:admin});
    assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),content);
    response=await fetch(base+'/api/turnos/otro/chat/archivos/'+saved.mensaje.id,{headers:admin});assert.equal(response.status,404);
    response=await fetch(base+'/api/turnos/prueba/chat/mensajes',{headers:{'x-test-role':'medico','x-test-name':'Profesional asignado'}});assert.equal(response.status,200);
    response=await fetch(base+'/api/turnos/prueba/chat/mensajes',{headers:{'x-test-role':'medico','x-test-name':'No asignado'}});assert.equal(response.status,403);
    await db.query("INSERT INTO casos_ausentismo(turno_id,token_ingreso,estado) VALUES('prueba','ubicacion-prueba','programado')");
    session=await(await fetch(base+'/api/chat/paciente/sesion',{headers:patient})).json();assert.equal(session.llamada,null);assert.equal(session.ingreso,'/ingreso/ubicacion-prueba');
    const verified=await chat.verifiedLink('prueba',null);
    session=await(await fetch(base+'/api/chat/paciente/sesion',{headers:{'x-chat-token':verified.split('=')[1]}})).json();assert.ok(session.llamada);
    await fetch(base+'/api/turnos/prueba/chat/revocar',{method:'POST',headers:admin});
    response=await fetch(base+'/api/chat/paciente/mensajes',{headers:patient});assert.equal(response.status,401);
    await db.query("DELETE FROM turnos WHERE id='prueba'");
    assert.equal((await db.query('SELECT count(*)::int AS n FROM chat_mensajes')).rows[0].n,0);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
});
