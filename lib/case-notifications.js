const crypto=require('crypto');
const {escapeHtml}=require('./control-evidence');
function email(value){
  const address=typeof value==='string'?value.trim():'';
  return address.length<=254 && /^[^\s<>@,;"():\r\n]+@[^\s<>@,;"():\r\n]+\.[^\s<>@,;"():\r\n]+$/.test(address)?address:null;
}
function requireEmails(data){
  if(!email(data.solicitante_email)||!email(data.trabajador_email))throw Object.assign(new Error('Completá un correo válido de la empresa y otro del paciente'),{status:400});
}
function createCaseNotifications({pool,send,baseUrl}){
  async function init(){
    await pool.query(`ALTER TABLE casos_ausentismo ADD COLUMN IF NOT EXISTS solicitante_email TEXT;
      ALTER TABLE casos_ausentismo ADD COLUMN IF NOT EXISTS trabajador_email TEXT;
      ALTER TABLE casos_ausentismo ADD COLUMN IF NOT EXISTS visita_mail_version INT NOT NULL DEFAULT 0;
      ALTER TABLE casos_ausentismo ADD COLUMN IF NOT EXISTS visita_mail_fingerprint TEXT;
      CREATE TABLE IF NOT EXISTS caso_correos (
        id BIGSERIAL PRIMARY KEY,caso_id INT NOT NULL REFERENCES casos_ausentismo(id) ON DELETE CASCADE,
        clave TEXT UNIQUE NOT NULL,tipo TEXT NOT NULL,destinatario TEXT NOT NULL,asunto TEXT NOT NULL,html TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente',intentos INT NOT NULL DEFAULT 0,proximo_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),enviado_en TIMESTAMPTZ,ultimo_error TEXT);
      CREATE INDEX IF NOT EXISTS idx_caso_correos_pendientes ON caso_correos(estado,proximo_en);`);
  }
  async function queue(db,{caso,tipo,to,subject,html,key}){
    if(!email(to))throw Object.assign(new Error('Correo del destinatario inválido'),{status:400});
    const r=await db.query(`INSERT INTO caso_correos(caso_id,clave,tipo,destinatario,asunto,html)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(clave) DO UPDATE SET clave=EXCLUDED.clave RETURNING id`,[caso.id,key,tipo,to.trim(),subject,html]);
    return r.rows[0].id;
  }
  async function request(db,caso){
    requireEmails(caso);
    return queue(db,{caso,tipo:'solicitud',to:caso.solicitante_email,key:`solicitud/${caso.id}`,
      subject:'Solicitud de control recibida — MEDGRUP',
      html:`<div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.7;color:#13233a"><h1 style="font-size:22px">Recibimos la solicitud</h1><p>Empresa: ${escapeHtml(caso.empresa_nombre)}.</p><p>Registramos el control de ${escapeHtml(caso.trabajador_nombre)}, referencia ${caso.id}. Nuestro equipo continuará con la asignación y programación.</p><p>La invitación se enviará al correo del paciente cuando se programe la visita.</p><p><a href="${escapeHtml(baseUrl()+'/empresa')}">Consultar solicitudes</a></p><p>MEDGRUP · Servicio Médico Laboral</p></div>`});
  }
  async function visit(db,caso,{fecha,hora,link,ahora=false}){
    const to=email(caso.trabajador_email);if(!to)throw Object.assign(new Error('Cargá el correo del paciente para enviar la invitación'),{status:400});
    const key='visita/'+crypto.createHash('sha256').update(JSON.stringify([caso.id,fecha,hora,to,caso.visita_mail_version||0])).digest('hex');
    // An invitation queued for an earlier schedule must not be sent after reprogramming.
    await db.query("UPDATE caso_correos SET estado='reemplazado' WHERE caso_id=$1 AND tipo='visita' AND clave<>$2 AND estado IN ('pendiente','fallido')",[caso.id,key]);
    const when=ahora?'La visita está disponible ahora.':`La visita fue programada para el ${String(fecha).split('-').reverse().join('/')} a las ${hora} hs (hora argentina).`;
    return queue(db,{caso,tipo:'visita',to,key,subject:ahora?'Ingresá a tu visita médica — MEDGRUP':'Invitación a visita médica — MEDGRUP',
      html:`<div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.7;color:#13233a"><h1 style="font-size:22px">Tu visita médica</h1><p>Hola ${escapeHtml(caso.trabajador_nombre)}.</p><p>${escapeHtml(when)}</p><p><a style="display:inline-block;padding:12px 20px;background:#13233a;color:white;text-decoration:none" href="${escapeHtml(link)}">Ingresar a la visita</a></p><p>No necesitás crear usuario ni contraseña. Usá un dispositivo con cámara, micrófono e internet. Para un control domiciliario, permanecé en el domicilio informado y permití el acceso a la ubicación cuando se solicite.</p><p>Este enlace es personal: no lo compartas. Si tenés dificultades, contactá a quien coordinó la visita.</p><p>MEDGRUP · Servicio Médico Laboral</p></div>`});
  }
  async function deliver(id){
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      const row=(await db.query(`SELECT * FROM caso_correos WHERE id=$1 FOR UPDATE SKIP LOCKED`,[id])).rows[0];
      if(!row){await db.query('COMMIT');return 'pendiente';}
      if(['enviado','reemplazado'].includes(row.estado)){await db.query('COMMIT');return row.estado;}
      if(row.intentos>=4){await db.query('COMMIT');return 'fallido';}
      // Fixed payload + provider idempotency when available; SMTP cannot guarantee
      // exactly-once delivery across a crash after the remote server accepts a message.
      let ok=false;try{ok=await send(row.destinatario,row.asunto,row.html,{idempotencyKey:row.clave});}catch{}
      const state=ok?'enviado':row.intentos>=3?'fallido':'pendiente';
      await db.query(`UPDATE caso_correos SET estado=$2,intentos=intentos+1,enviado_en=CASE WHEN $2='enviado' THEN NOW() ELSE NULL END,
        proximo_en=NOW()+INTERVAL '5 minutes',ultimo_error=$3 WHERE id=$1`,[id,state,ok?null:'El proveedor no confirmó el envío']);
      await db.query('COMMIT');return state;
    }catch(e){await db.query('ROLLBACK');return 'pendiente';}finally{db.release();}
  }
  let processing=false;
  async function processPending(){
    if(processing)return;processing=true;
    try{const rows=(await pool.query("SELECT id FROM caso_correos WHERE estado='pendiente' AND intentos<4 AND proximo_en<=NOW() ORDER BY id LIMIT 5")).rows;for(const row of rows)await deliver(row.id);}finally{processing=false;}
  }
  return {init,request,visit,deliver,processPending};
}
module.exports={email,requireEmails,createCaseNotifications};
