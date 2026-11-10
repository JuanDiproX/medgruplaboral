const crypto=require('crypto');
const {attachment}=require('./turno-chat');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const reportFields=['numero','paciente','apellido_nombre','fecha_consulta','antecedentes','hallazgos','analisis','conclusion','aptitud','dias_reposo','diagnostico','diagnostico_desc','diagnostico_cie','indicaciones','informe_completo'];
function reportView(d){return Object.fromEntries(reportFields.map(k=>[k,d[k]??null]));}
const revision=d=>hash(JSON.stringify(reportView(d)));
function createParticipantAccess({app,pool,authMiddleware,secret,patient,hashDictamen}){
 let ready=false;
 const wrap=fn=>async(req,res)=>{res.setHeader('Cache-Control','no-store');try{if(!ready)throw fail(503,'Acceso personal no disponible.');await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'No se pudo completar la operación.'});}};
 async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS medico_accesos(token_hash TEXT PRIMARY KEY,turno_id VARCHAR(50) NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,token_cifrado TEXT NOT NULL,vence_en TIMESTAMPTZ NOT NULL,revocado BOOLEAN NOT NULL DEFAULT false);
    CREATE TABLE IF NOT EXISTS participante_firmas_auditoria(id BIGSERIAL PRIMARY KEY,turno_id VARCHAR(50) NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,rol TEXT NOT NULL,documento TEXT NOT NULL,documento_id TEXT,hash_contenido TEXT NOT NULL,contenido JSONB NOT NULL,ip TEXT,agente TEXT,creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  ready=true;
 }
 function crypt(token,decode=false){
  if(!secret)throw fail(503,'Falta configurar el acceso personal.');
  const key=crypto.createHash('sha256').update(secret).digest();
  if(decode){const b=Buffer.from(token,'base64'),c=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8');}
  const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(token,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64');
 }
 async function authorize(req,db=pool){
  const token=req.headers['x-medico-invitacion'];if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw fail(401,'Enlace personal inválido o vencido.');
  const a=(await db.query('SELECT * FROM medico_accesos WHERE token_hash=$1 AND vence_en>NOW() AND revocado=false',[hash(token)])).rows[0];
  if(!a)throw fail(401,'Enlace personal inválido o vencido.');
  const t=(await db.query('SELECT * FROM turnos WHERE id=$1',[a.turno_id])).rows[0];if(!t||t.estado==='cancelado')throw fail(403,'Consulta cancelada.');
  const m=(await db.query(`SELECT m.* FROM medicos m JOIN turno_medicos tm ON tm.medico_nombre=m.nombre
    WHERE tm.turno_id=$1 AND tm.medico_nombre=$2 AND m.activo=true`,[t.id,a.nombre])).rows[0];
  if(!m)throw fail(403,'El profesional ya no está asignado a esta consulta.');
  return {t,author:a.nombre,role:'medico',profile:m,access:a};
 }
 async function invite(db,id,nombre){
  const old=(await db.query('SELECT * FROM medico_accesos WHERE turno_id=$1 AND nombre=$2 AND vence_en>NOW() AND revocado=false ORDER BY vence_en DESC LIMIT 1',[id,nombre])).rows[0];
  if(old){try{const token=crypt(old.token_cifrado,true);if(hash(token)===old.token_hash)return '/atencion.html#medico='+token;}catch{}}
  const token=crypto.randomBytes(32).toString('hex');
  await db.query(`INSERT INTO medico_accesos(token_hash,turno_id,nombre,token_cifrado,vence_en)
    SELECT $1,id,$3,$4,GREATEST(NOW(),(fecha::text||' '||COALESCE(NULLIF(hora,''),'00:00'))::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')+INTERVAL '30 days' FROM turnos WHERE id=$2`,[hash(token),id,nombre,crypt(token)]);
  return '/atencion.html#medico='+token;
 }
 app.post('/api/turnos/:id/accesos-personales',authMiddleware,wrap(async(req,res)=>{
  const db=await pool.connect();try{
   await db.query('BEGIN');const t=(await db.query('SELECT * FROM turnos WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!t)throw fail(404,'Turno no encontrado.');
   if(t.estado==='cancelado')throw fail(409,'Consulta cancelada.');
   const assigned=(await db.query('SELECT medico_nombre FROM turno_medicos WHERE turno_id=$1',[t.id])).rows.map(x=>x.medico_nombre);
   if(req.usuario.rol!=='admin'&&(req.usuario.rol!=='medico'||!assigned.includes(req.usuario.nombre)))throw fail(403,'No estás asignado a este turno.');
   const links=[];for(const nombre of assigned){if(req.usuario.rol==='admin'||nombre===req.usuario.nombre)links.push({nombre,link:await invite(db,t.id,nombre)});}
   await db.query('COMMIT');res.json({ok:true,links_medicos:links});
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }));
 app.get('/api/acceso-medico/sesion',wrap(async(req,res)=>{
  const ctx=await authorize(req);let links=ctx.t.links_medicos||[];if(typeof links==='string')links=JSON.parse(links);
  const own=links.find(l=>l.nombre===ctx.author);
  res.json({ok:true,paciente:ctx.t.paciente,nombre:ctx.author,rol:'medico',fecha:ctx.t.fecha,hora:ctx.t.hora,tipo:ctx.t.tipo,
    llamada:ctx.t.estado==='completado'?null:own?.link||null,vence_en:ctx.access.vence_en});
 }));
 app.post('/api/turnos/:id/accesos-personales/revocar',authMiddleware,wrap(async(req,res)=>{
  if(req.usuario.rol!=='admin')throw fail(403,'Acceso reservado a administración.');
  await pool.query('UPDATE medico_accesos SET revocado=true WHERE turno_id=$1',[req.params.id]);res.json({ok:true});
 }));
 async function summary(ctx,db=pool){
  const eventos=(await db.query('SELECT tipo,participante,creado_en FROM eventos_turno WHERE turno_id=$1 ORDER BY creado_en',[ctx.t.id])).rows;
  const firma=(await db.query('SELECT firmado_en FROM firmas_acta WHERE turno_id=$1 AND medico_nombre=$2 AND es_paciente=$3',[ctx.t.id,ctx.author,ctx.role==='paciente'])).rows[0];
  const present=eventos.some(e=>e.tipo===(ctx.role==='medico'?'union_medico':'union_paciente')&&e.participante===ctx.author);
  return {paciente:ctx.t.paciente,nombre:ctx.author,rol:ctx.role,fecha:ctx.t.fecha,hora:ctx.t.hora,tipo:ctx.t.tipo,eventos,
    firmada:!!firma,firmado_en:firma?.firmado_en||null,puede_firmar:present&&(ctx.role!=='paciente'||(ctx.t.firma_paciente!==false&&(!ctx.t.caso_id||ctx.access?.geo_autorizada)))};
 }
 async function audit(db,ctx,req,documento,id,content){await db.query(`INSERT INTO participante_firmas_auditoria(turno_id,nombre,rol,documento,documento_id,hash_contenido,contenido,ip,agente)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[ctx.t.id,ctx.author,ctx.role,documento,String(id),hash(JSON.stringify(content)),JSON.stringify(content),String(req.ip||req.socket?.remoteAddress||'').slice(0,100),String(req.headers['user-agent']||'').slice(0,500)]);}
 function signature(req){
  if(req.body.consentimiento!==true)throw fail(400,'Confirmá la firma del documento.');
  const value=String(req.body.firma_base64||'').replace(/^data:image\/png;base64,/,'');
  if(value.length>400000)throw fail(400,'La firma es demasiado grande.');
  const file=attachment({name:'firma.png',base64:value});if(file.mime!=='image/png')throw fail(400,'La firma debe ser PNG.');
  if(file.data.length<24||file.data.subarray(12,16).toString()!=='IHDR'||file.data.readUInt32BE(16)<1||file.data.readUInt32BE(20)<1||file.data.readUInt32BE(16)>2048||file.data.readUInt32BE(20)>1024)throw fail(400,'Las dimensiones de la firma no son válidas.');
  return file.data.toString('base64');
 }
 for(const [base,auth] of [['/api/acceso-medico',authorize],['/api/chat/paciente',patient]]){
  app.get(base+'/firma',wrap(async(req,res)=>res.json({ok:true,...await summary(await auth(req))})));
  app.post(base+'/firma',wrap(async(req,res)=>{
   const drawn=signature(req),db=await pool.connect();try{
    await db.query('BEGIN');let ctx=await auth(req,db);await db.query('SELECT id FROM turnos WHERE id=$1 FOR UPDATE',[ctx.t.id]);ctx=await auth(req,db);
    const state=await summary(ctx,db);if(state.firmada){await db.query('COMMIT');return res.json({ok:true,ya_firmada:true});}
    if(!state.puede_firmar)throw fail(409,'Todavía no hay un ingreso registrado para tu participación o la firma no está habilitada.');
    await db.query(`INSERT INTO firmas_acta(turno_id,medico_nombre,matricula,especialidad,firma_base64,es_paciente,capturada_por)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[ctx.t.id,ctx.author,ctx.profile?.matricula||'',ctx.profile?.especialidad||'',drawn,ctx.role==='paciente','Enlace personal: '+ctx.author]);
    await audit(db,ctx,req,'acta',ctx.t.id,state);await db.query('COMMIT');res.json({ok:true});
   }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  }));
 }
 app.get('/api/acceso-medico/informes',wrap(async(req,res)=>{
  const ctx=await authorize(req);const docs=(await pool.query('SELECT * FROM dictamenes WHERE turno_id=$1 ORDER BY id DESC',[ctx.t.id])).rows;
  const firmas=(await pool.query('SELECT dictamen_id,hash_contenido FROM firmas_dictamen WHERE medico_nombre=$1',[ctx.author])).rows;
  res.json({ok:true,informes:docs.map(d=>({id:d.id,contenido:reportView(d),revision:revision(d),firmado:firmas.some(f=>f.dictamen_id===d.id&&f.hash_contenido===hashDictamen(d))}))});
 }));
 app.post('/api/acceso-medico/informes/:id/firma',wrap(async(req,res)=>{
  const drawn=signature(req),db=await pool.connect();try{
   await db.query('BEGIN');const ctx=await authorize(req,db);const d=(await db.query('SELECT * FROM dictamenes WHERE id=$1 AND turno_id=$2 FOR UPDATE',[req.params.id,ctx.t.id])).rows[0];
   if(!d)throw fail(404,'Informe no encontrado.');if(req.body.revision!==revision(d))throw fail(409,'El informe cambió. Volvé a leer la versión actual antes de firmar.');
   const state=await summary(ctx,db);if(!state.puede_firmar)throw fail(409,'Falta registrar tu participación en la consulta.');
   const exists=(await db.query('SELECT 1 FROM firmas_dictamen WHERE dictamen_id=$1 AND medico_nombre=$2',[d.id,ctx.author])).rows.length;
   if(exists){await db.query('COMMIT');return res.json({ok:true,ya_firmado:true});}
   await db.query(`INSERT INTO firmas_dictamen(dictamen_id,medico_nombre,matricula,especialidad,firma_base64,hash_contenido,ip) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [d.id,ctx.author,ctx.profile.matricula||'',ctx.profile.especialidad||'',drawn,hashDictamen(d),String(req.ip||req.socket?.remoteAddress||'').slice(0,100)]);
   if(d.medico===ctx.author)await db.query('UPDATE dictamenes SET firma_doctor=$1 WHERE id=$2',[drawn,d.id]);
   await audit(db,ctx,req,'informe',d.id,reportView(d));await db.query('COMMIT');res.json({ok:true});
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }));
 return {init,authorize};
}
module.exports={createParticipantAccess,revision};
