// Base de datos simulada para pruebas y demo local. No usar en producción.
const assert=require('node:assert/strict');
const {createTurnoChat}=require('../lib/turno-chat');
function fixture(enabled=true){
  const routes=new Map(),access=new Map(),messages=[],queries=[];
  const turns={a:{id:'a',paciente:'Paciente de prueba',estado:'pendiente',link_paciente:'https://example.invalid/llamada'},b:{id:'b',paciente:'Otro paciente',estado:'pendiente'}};
  const pool={async query(sql,p=[]){
    queries.push(sql);
    if(sql.startsWith('CREATE')||['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.startsWith('SELECT t.*'))return {rows:turns[p[0]]?[turns[p[0]]]:[]};
    if(sql.startsWith('SELECT 1 FROM turno_medicos'))return {rows:p[1]==='Médico asignado'?[{ok:1}]:[]};
    if(sql.startsWith('INSERT INTO chat_accesos')){access.set(p[0],{turno_id:p[1],geo_autorizada:p[2],vence_en:Date.now()+172800000});return {rows:[]};}
    if(sql.startsWith('SELECT * FROM chat_accesos')){const a=access.get(p[0]);return {rows:a&&!a.revocado&&a.vence_en>Date.now()?[a]:[]};}
    if(sql.startsWith('UPDATE chat_accesos')){for(const a of access.values())if(a.turno_id===p[0])a.revocado=true;return {rows:[]};}
    if(sql.startsWith('SELECT id FROM turnos'))return {rows:[{id:p[0]}]};
    if(sql.startsWith('SELECT COUNT'))return {rows:[{cantidad:messages.filter(m=>m.turno_id===p[0]).length,bytes:messages.filter(m=>m.turno_id===p[0]).reduce((n,m)=>n+(m.archivo?.length||0),0)}]};
    if(sql.startsWith('INSERT INTO chat_mensajes')){const m={id:String(messages.length+1),turno_id:p[0],autor:p[1],rol:p[2],texto:p[3],nombre_archivo:p[4],tipo_mime:p[5],archivo:p[6],creado_en:new Date().toISOString()};messages.push(m);return {rows:[m]};}
    if(sql.startsWith('SELECT archivo'))return {rows:messages.filter(m=>m.id===p[0]&&m.turno_id===p[1]&&m.archivo)};
    if(sql.startsWith('SELECT id,autor'))return {rows:messages.filter(m=>m.turno_id===p[0]&&Number(m.id)>Number(p[1])).map(({archivo,...m})=>m).slice(0,100)};
    throw Error('Unexpected query: '+sql);
  },async connect(){return {query:pool.query,release(){}};}};
  const app={get:(p,...handlers)=>routes.set('GET '+p,handlers),post:(p,...handlers)=>routes.set('POST '+p,handlers)};
  const module=createTurnoChat({app,pool,enabled,authMiddleware:(req,res,next)=>req.usuario?next():res.status(401).json({error:'No autorizado'})});
  async function request(method,path,options={}){
    const req={params:{id:'a',...options.params},query:{},headers:{},body:{},...options};
    const res={code:200,headers:{},status(n){this.code=n;return this;},setHeader(k,v){this.headers[k]=v;},json(d){this.data=d;return this;},send(d){this.data=d;return this;}};
    const handlers=routes.get(method+' '+path);assert.ok(handlers,path);
    async function run(i){if(handlers[i])await handlers[i](req,res,()=>run(i+1));}await run(0);return res;
  }
  const admin={rol:'admin',nombre:'Administración'};
  async function invite(){const r=await request('POST','/api/turnos/:id/chat/invitacion',{usuario:admin});return r.data.link.split('=')[1];}
  const patient=token=>({'x-chat-token':token});
  return {module,pool,request,admin,invite,patient,turns,access,messages,queries,routes};
}

module.exports={fixture};
