const {email}=require('./case-notifications');
const {escapeHtml}=require('./control-evidence');

function createDoctorReminders({pool,send,baseUrl,administrationEmail=null}){
  const adminEmail=email(administrationEmail);
  async function init(){
    await pool.query(`ALTER TABLE medicos ADD COLUMN IF NOT EXISTS recordatorio_email TEXT;
      CREATE TABLE IF NOT EXISTS medico_recordatorios (
        id BIGSERIAL PRIMARY KEY,turno_id VARCHAR(50) NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
        medico_nombre TEXT NOT NULL,fecha DATE NOT NULL,hora TEXT NOT NULL,destinatario TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente',intentos INT NOT NULL DEFAULT 0,
        proximo_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),enviado_en TIMESTAMPTZ,
        UNIQUE(turno_id,medico_nombre,fecha,hora,destinatario));`);
  }
  // Read the current schedule on each pass: cancellation, reassignment and time
  // changes invalidate old jobs. All times are interpreted in Argentina.
  const schedule=`t.estado='pendiente' AND t.hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      AND ((t.fecha::text||' '||t.hora)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires') > NOW()
      AND ((t.fecha::text||' '||t.hora)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires') <= NOW()+INTERVAL '1 hour'`;
  const eligible=`SELECT t.id,t.paciente,t.tipo,t.fecha::text AS fecha,t.hora,tm.medico_nombre,
      tm.medico_nombre AS medicos_asignados,
      COALESCE(NULLIF(m.recordatorio_email,''),u.email) AS destinatario
    FROM turnos t JOIN turno_medicos tm ON tm.turno_id=t.id
    JOIN medicos m ON m.nombre=tm.medico_nombre AND m.activo=true
    LEFT JOIN usuarios u ON u.nombre=tm.medico_nombre AND u.activo=true AND u.rol IN ('medico','admin')
    WHERE ${schedule}
    UNION ALL
    SELECT t.id,t.paciente,t.tipo,t.fecha::text AS fecha,t.hora,'Administración MEDGRUP' AS medico_nombre,
      COALESCE((SELECT string_agg(tm.medico_nombre,', ' ORDER BY tm.medico_nombre) FROM turno_medicos tm WHERE tm.turno_id=t.id),'Sin médico asignado') AS medicos_asignados,
      $1::text AS destinatario
    FROM turnos t WHERE $1::text IS NOT NULL AND ${schedule}`;
  let processing=false;
  async function processPending(){
    if(processing)return;processing=true;
    try{
      const rows=(await pool.query(eligible,[adminEmail])).rows;
      for(const row of rows){
        const to=email(row.destinatario);if(!to)continue;
        const db=await pool.connect();
        try{
          await db.query('BEGIN');
          await db.query(`INSERT INTO medico_recordatorios(turno_id,medico_nombre,fecha,hora,destinatario)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[row.id,row.medico_nombre,row.fecha,row.hora,to]);
          const job=(await db.query(`SELECT * FROM medico_recordatorios WHERE turno_id=$1 AND medico_nombre=$2
            AND fecha=$3 AND hora=$4 AND destinatario=$5 AND estado='pendiente' AND intentos<4 AND proximo_en<=NOW()
            FOR UPDATE SKIP LOCKED`,[row.id,row.medico_nombre,row.fecha,row.hora,to])).rows[0];
          if(job){
            // Recheck immediately before sending, after obtaining the queue lock.
            const current=(await db.query(`SELECT * FROM (${eligible}) e WHERE e.id=$2 AND e.medico_nombre=$3 AND e.fecha=$4 AND e.hora=$5 AND e.destinatario=$6`,[adminEmail,row.id,row.medico_nombre,row.fecha,row.hora,to])).rows[0];
            if(current){
              let ok=false;
              try{ok=await send(to,'Recordatorio de turno médico — MEDGRUP',
                `<div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.7;color:#13233a"><h1 style="font-size:22px">Tenés un turno próximo</h1><p>Hola ${escapeHtml(row.medico_nombre)}.</p><p>Te recordamos el turno del ${escapeHtml(row.fecha.split('-').reverse().join('/'))} a las <strong>${escapeHtml(row.hora)} hs (hora argentina)</strong>.</p><p>Paciente: ${escapeHtml(row.paciente)}.<br>Tipo de consulta: ${escapeHtml(row.tipo||'Consulta médica')}.<br>Profesionales: ${escapeHtml(current.medicos_asignados)}.</p><p><a href="${escapeHtml(baseUrl()+'/')}">Abrir la agenda de MEDGRUP</a></p><p>Ingresá con tu cuenta y seleccioná el turno. MEDGRUP · Servicio Médico Laboral</p></div>`,{idempotencyKey:`medico-recordatorio/${job.id}`});}catch{}
              await db.query(`UPDATE medico_recordatorios SET intentos=intentos+1,estado=$2,
                enviado_en=CASE WHEN $2='enviado' THEN NOW() ELSE NULL END,proximo_en=NOW()+INTERVAL '5 minutes' WHERE id=$1`,[job.id,ok?'enviado':job.intentos>=3?'fallido':'pendiente']);
            }
          }
          await db.query('COMMIT');
        }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
      }
    }finally{processing=false;}
  }
  return {init,processPending};
}
module.exports={createDoctorReminders};
