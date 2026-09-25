const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createTurnoChat,attachment}=require('../lib/turno-chat');

const {fixture}=require('./chat-fixture');

test('desactivado no migra y conserva exactamente el enlace actual',async()=>{
  const f=fixture(false);await f.module.init();assert.equal(f.queries.length,0);
  assert.equal(await f.module.verifiedLink('a','daily-original'),'daily-original');
  assert.equal((await f.request('GET','/api/chat/config')).data.enabled,false);
  assert.equal((await f.request('GET','/api/chat/paciente/sesion')).code,503);
});
test('solo admin o médico asignado pueden acceder',async()=>{
  const f=fixture();await f.module.init();
  for(const [usuario,code] of [[undefined,401],[{rol:'empresa'},403],[{rol:'medico',nombre:'Otro'},403],[{rol:'medico',nombre:'Médico asignado'},200],[f.admin,200]]){
    assert.equal((await f.request('GET','/api/turnos/:id/chat/sesion',{usuario})).code,code);
  }
});
test('ausentismo exige verificación aunque el chat ya esté disponible',async()=>{
  const f=fixture();await f.module.init();Object.assign(f.turns.a,{caso_id:12,token_ingreso:'ingreso-prueba',caso_estado:'programado'});
  const token=await f.invite();
  let r=await f.request('GET','/api/chat/paciente/sesion',{headers:f.patient(token)});
  assert.equal(r.data.llamada,null);assert.equal(r.data.ingreso,'/ingreso/ingreso-prueba');
  const verified=(await f.module.verifiedLink('a','fallback')).split('=')[1];
  r=await f.request('GET','/api/chat/paciente/sesion',{headers:f.patient(verified)});
  assert.equal(r.data.llamada,f.turns.a.link_paciente);
  f.turns.a.estado='completado';
  r=await f.request('GET','/api/chat/paciente/sesion',{headers:f.patient(verified)});
  assert.equal(r.data.llamada,null);assert.equal(r.code,200);
});
test('invitación habitual identifica al paciente sin login y no habilita ubicación',async()=>{
  const f=fixture();await f.module.init();
  Object.assign(f.turns.a,{caso_id:12,token_ingreso:'ingreso-prueba',caso_estado:'programado'});
  const link=await f.module.invitationLink('a','ingreso-original');
  const r=await f.request('GET','/api/chat/paciente/sesion',{headers:f.patient(link.split('=')[1])});
  assert.equal(r.code,200);assert.equal(r.data.paciente,'Paciente de prueba');
  assert.equal(r.data.llamada,null);assert.equal(r.data.ingreso,'/ingreso/ingreso-prueba');
  const disabled=fixture(false);await disabled.module.init();
  assert.equal(await disabled.module.invitationLink('a','ingreso-original'),'ingreso-original');
});
test('tokens vencidos, revocados o inválidos no acceden',async()=>{
  const f=fixture();await f.module.init();const token=await f.invite();
  assert.equal((await f.request('GET','/api/chat/paciente/sesion',{headers:f.patient('incorrecto')})).code,401);
  await f.request('POST','/api/turnos/:id/chat/revocar',{usuario:f.admin});
  assert.equal((await f.request('GET','/api/chat/paciente/sesion',{headers:f.patient(token)})).code,401);
  const fresh=await f.invite();f.access.get(crypto.createHash('sha256').update(fresh).digest('hex')).vence_en=0;
  assert.equal((await f.request('GET','/api/chat/paciente/sesion',{headers:f.patient(fresh)})).code,401);
});
test('adjuntos se guardan y descargan únicamente en el turno autorizado',async()=>{
  const f=fixture();await f.module.init();const token=await f.invite(),headers=f.patient(token);
  const bytes=Buffer.from('%PDF-1.4\nPrueba');
  let r=await f.request('POST','/api/chat/paciente/mensajes',{headers,body:{texto:'Estudio',adjunto:{name:'estudio.pdf',base64:bytes.toString('base64')}}});
  assert.equal(r.code,201);assert.ok(f.queries.includes('COMMIT'));
  r=await f.request('GET','/api/turnos/:id/chat/archivos/:archivoId',{usuario:f.admin,params:{id:'a',archivoId:'1'}});
  assert.deepEqual(r.data,bytes);assert.equal(r.headers['X-Content-Type-Options'],'nosniff');
  r=await f.request('GET','/api/turnos/:id/chat/archivos/:archivoId',{usuario:f.admin,params:{id:'b',archivoId:'1'}});assert.equal(r.code,404);
  r=await f.request('GET','/api/chat/paciente/mensajes',{headers});assert.equal(r.data.mensajes.length,1);assert.equal(r.data.mensajes[0].archivo,undefined);
  r=await f.request('GET','/api/chat/paciente/mensajes',{headers,query:{after:'1'}});assert.equal(r.data.mensajes.length,0);
});
test('rechaza archivos ejecutables, base64 corrupto y archivos mayores de 5 MB',()=>{
  for(const base64 of [Buffer.from('<script>alert(1)</script>').toString('base64'),'AA=A',Buffer.alloc(5*1024*1024+1).toString('base64')])assert.throws(()=>attachment({name:'falso.pdf',base64}),{status:400});
  const valid=Buffer.alloc(5*1024*1024);valid.write('%PDF-');assert.equal(attachment({base64:valid.toString('base64')}).data.length,valid.length);
});
test('cuota de mensajes revierte la transacción sin insertar',async()=>{
  const f=fixture();await f.module.init();f.messages.push(...Array.from({length:1000},()=>({turno_id:'a'})));
  const r=await f.request('POST','/api/turnos/:id/chat/mensajes',{usuario:f.admin,body:{texto:'Exceso'}});
  assert.equal(r.code,409);assert.equal(f.messages.length,1000);assert.ok(f.queries.includes('ROLLBACK'));
});
test('si falla el almacenamiento del enlace se conserva el ingreso a Daily',async()=>{
  const f=fixture();await f.module.init();f.pool.query=async()=>{throw Error('DB indisponible');};
  assert.equal(await f.module.verifiedLink('a','daily-original'),'daily-original');
});
