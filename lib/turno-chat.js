const crypto = require('crypto');
const MAX_FILE = 5 * 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

function attachment(input) {
  if (input == null) return null;
  if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(MAX_FILE / 3) * 4 ||
      input.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(input.base64))
    throw fail(400, 'Archivo inválido o mayor de 5 MB.');
  const data = Buffer.from(input.base64, 'base64');
  if (data.toString('base64') !== input.base64) throw fail(400, 'Archivo inválido.');
  if (!data.length || data.length > MAX_FILE) throw fail(400, 'El archivo debe tener hasta 5 MB.');
  let mime, ext;
  if (data.subarray(0,5).toString() === '%PDF-') [mime,ext] = ['application/pdf','pdf'];
  else if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) [mime,ext] = ['image/png','png'];
  else if (data[0] === 255 && data[1] === 216 && data[2] === 255) [mime,ext] = ['image/jpeg','jpg'];
  else if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP') [mime,ext] = ['image/webp','webp'];
  else throw fail(400, 'Solo se admiten PDF, JPG, PNG o WEBP.');
  const name = String(input.name || 'adjunto').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ._-]/g,'_').slice(0,120).replace(/\.[^.]*$/,'') || 'adjunto';
  return { data, mime, name: `${name}.${ext}` };
}

function createTurnoChat({ app, pool, authMiddleware, enabled = false }) {
  let ready = false;
  const wrap = fn => async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    if (!enabled || !ready) return res.status(503).json({error:'Chat no habilitado.'});
    try { await fn(req,res); }
    catch (e) { res.status(e.status || 500).json({error:e.status ? e.message : 'No se pudo completar la operación del chat.'}); }
  };
  async function init() {
    if (!enabled) return;
    await pool.query(`CREATE TABLE IF NOT EXISTS chat_accesos (
      token_hash TEXT PRIMARY KEY, turno_id VARCHAR(50) NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
      vence_en TIMESTAMPTZ NOT NULL, geo_autorizada BOOLEAN NOT NULL DEFAULT false,
      revocado BOOLEAN NOT NULL DEFAULT false);
      CREATE TABLE IF NOT EXISTS chat_mensajes (
      id BIGSERIAL PRIMARY KEY, turno_id VARCHAR(50) NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
      autor TEXT NOT NULL, rol TEXT NOT NULL, texto TEXT NOT NULL DEFAULT '',
      nombre_archivo TEXT, tipo_mime TEXT, archivo BYTEA, creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS idx_chat_turno ON chat_mensajes(turno_id,id);`);
    ready = true;
  }
  async function turno(id) {
    const r = await pool.query(`SELECT t.*, c.id AS caso_id, c.token_ingreso,
      c.estado AS caso_estado FROM turnos t LEFT JOIN casos_ausentismo c ON c.turno_id=t.id WHERE t.id=$1`,[id]);
    if (!r.rows.length) throw fail(404,'Turno no encontrado.');
    return r.rows[0];
  }
  async function staff(req) {
    const t = await turno(req.params.id);
    if (req.usuario.rol !== 'admin') {
      if (req.usuario.rol !== 'medico') throw fail(403,'Acceso reservado al equipo médico.');
      const r = await pool.query('SELECT 1 FROM turno_medicos WHERE turno_id=$1 AND medico_nombre=$2',[t.id,req.usuario.nombre]);
      if (!r.rows.length) throw fail(403,'No estás asignado a este turno.');
    }
    return { t, author:req.usuario.nombre, role:'medico' };
  }
  async function patient(req) {
    const token = req.headers['x-chat-token'];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fail(401,'Enlace inválido o vencido.');
    const r = await pool.query('SELECT * FROM chat_accesos WHERE token_hash=$1 AND vence_en>NOW() AND revocado=false',[hash(token)]);
    if (!r.rows.length) throw fail(401,'Enlace inválido o vencido. Solicitá uno nuevo a MEDGRUP.');
    const t = await turno(r.rows[0].turno_id);
    if (t.estado === 'cancelado' || t.caso_estado === 'cancelado') throw fail(403,'Atención cancelada.');
    return { t, author:t.paciente, role:'paciente', access:r.rows[0] };
  }
  function callLink(ctx) {
    if (ctx.t.estado === 'completado' || ['resuelto','cancelado'].includes(ctx.t.caso_estado)) return null;
    if (ctx.t.caso_id && !ctx.access?.geo_autorizada) return null;
    return ctx.t.link_paciente || null;
  }
  async function invite(id, geo = false) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO chat_accesos(token_hash,turno_id,vence_en,geo_autorizada)
      SELECT $1,id,GREATEST(NOW(),
        (fecha::date + COALESCE(NULLIF(hora,''),'00:00')::time)
          AT TIME ZONE 'America/Argentina/Buenos_Aires') + INTERVAL '48 hours',$3
      FROM turnos WHERE id=$2`,[hash(token),id,geo]);
    return `/atencion.html#token=${token}`;
  }
  // Only invoked after the existing geolocation endpoint authorizes entry.
  async function verifiedLink(id, fallback) {
    if (!enabled || !ready) return fallback;
    try { return await invite(id,true); }
    catch { return fallback; } // A chat outage must not interrupt the existing consultation.
  }
  async function invitationLink(id, fallback) {
    if (!enabled || !ready) return fallback;
    try { return await invite(id,false); }
    catch { return fallback; }
  }
  app.get('/api/chat/config',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({enabled:enabled && ready});});
  app.get('/api/chat/paciente/sesion',wrap(async(req,res)=>{
    const ctx=await patient(req);
    res.json({ok:true,paciente:ctx.t.paciente,vence_en:ctx.access.vence_en,
      llamada:callLink(ctx), ingreso:ctx.t.caso_id && ctx.t.token_ingreso && !ctx.access.geo_autorizada && ctx.t.estado!=='completado' && !['resuelto','cancelado'].includes(ctx.t.caso_estado)
        ? `/ingreso/${ctx.t.token_ingreso}` : null});
  }));
  app.get('/api/turnos/:id/chat/sesion',authMiddleware,wrap(async(req,res)=>{
    const ctx=await staff(req);res.json({ok:true,paciente:ctx.t.paciente});
  }));
  app.post('/api/turnos/:id/chat/invitacion',authMiddleware,wrap(async(req,res)=>{
    const ctx=await staff(req);
    if(ctx.t.estado==='cancelado' || ctx.t.caso_estado==='cancelado') throw fail(409,'Atención cancelada.');
    res.json({ok:true,link:await invite(ctx.t.id),duracion_horas:48});
  }));
  app.post('/api/turnos/:id/chat/revocar',authMiddleware,wrap(async(req,res)=>{
    const ctx=await staff(req);
    await pool.query('UPDATE chat_accesos SET revocado=true WHERE turno_id=$1',[ctx.t.id]);
    res.json({ok:true});
  }));
  const fields='id,autor,rol,texto,nombre_archivo,tipo_mime,octet_length(archivo) AS bytes,creado_en';
  for (const [path,authorize,middleware] of [
    ['/api/chat/paciente',patient,[]],['/api/turnos/:id/chat',staff,[authMiddleware]]
  ]) {
    app.get(`${path}/mensajes`,...middleware,wrap(async(req,res)=>{
      const ctx=await authorize(req), after=String(req.query.after || '0');
      if(!/^\d{1,18}$/.test(after)) throw fail(400,'Cursor inválido.');
      const r=await pool.query(`SELECT ${fields} FROM chat_mensajes WHERE turno_id=$1 AND id>$2 ORDER BY id LIMIT 100`,[ctx.t.id,after]);
      res.json({ok:true,mensajes:r.rows});
    }));
    app.post(`${path}/mensajes`,...middleware,wrap(async(req,res)=>{
      const ctx=await authorize(req);
      if(ctx.t.estado==='cancelado' || ctx.t.caso_estado==='cancelado') throw fail(409,'Atención cancelada.');
      if(typeof req.body.texto!=='string' || req.body.texto.length>3000) throw fail(400,'El mensaje admite hasta 3000 caracteres.');
      const texto=req.body.texto.trim(), file=attachment(req.body.adjunto);
      if(!texto && !file) throw fail(400,'Escribí un mensaje o adjuntá un archivo.');
      const db=await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('SELECT id FROM turnos WHERE id=$1 FOR UPDATE',[ctx.t.id]);
        const usage=await db.query('SELECT COUNT(*) AS cantidad,COALESCE(SUM(octet_length(archivo)),0) AS bytes FROM chat_mensajes WHERE turno_id=$1',[ctx.t.id]);
        if(Number(usage.rows[0].cantidad)>=1000 || Number(usage.rows[0].bytes)+(file?.data.length||0)>50*1024*1024) throw fail(409,'Se alcanzó el límite del chat de este turno. Contactá a MEDGRUP.');
        const r=await db.query(`INSERT INTO chat_mensajes(turno_id,autor,rol,texto,nombre_archivo,tipo_mime,archivo)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${fields}`,[ctx.t.id,ctx.author,ctx.role,texto,file?.name||null,file?.mime||null,file?.data||null]);
        await db.query('COMMIT');res.status(201).json({ok:true,mensaje:r.rows[0]});
      } catch(e) { await db.query('ROLLBACK');throw e; }
      finally { db.release(); }
    }));
    app.get(`${path}/archivos/:archivoId`,...middleware,wrap(async(req,res)=>{
      const ctx=await authorize(req);
      if(!/^\d{1,18}$/.test(req.params.archivoId)) throw fail(404,'Archivo no encontrado.');
      const r=await pool.query('SELECT archivo,nombre_archivo,tipo_mime FROM chat_mensajes WHERE id=$1 AND turno_id=$2 AND archivo IS NOT NULL',[req.params.archivoId,ctx.t.id]);
      if(!r.rows.length) throw fail(404,'Archivo no encontrado.');
      const f=r.rows[0];
      res.setHeader('Content-Type',f.tipo_mime);
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Disposition',`attachment; filename="adjunto"; filename*=UTF-8''${encodeURIComponent(f.nombre_archivo)}`);
      res.send(f.archivo);
    }));
  }
  return {init,verifiedLink,invitationLink};
}
module.exports={createTurnoChat,attachment};
