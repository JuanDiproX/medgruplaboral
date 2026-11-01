const {TOLERANCIA_MS}=require('./control-evidence');
const fail=(status,message)=>Object.assign(new Error(message),{status});
async function insertEvent(pool,id,tipo,participante) {
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    await db.query('SELECT id FROM turnos WHERE id=$1 FOR UPDATE',[id]);
    const row=(await db.query('INSERT INTO eventos_turno (turno_id,tipo,participante) VALUES ($1,$2,$3) RETURNING *',[id,tipo,participante])).rows[0];
    await db.query('COMMIT');return row;
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
async function closeNoShow(pool,casoId,user,canSee) {
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const caso=(await db.query('SELECT * FROM casos_ausentismo WHERE id=$1 FOR UPDATE',[casoId])).rows[0];
    if(!caso)throw fail(404,'Caso no encontrado');
    if(!await canSee(caso))throw fail(403,'Este caso no está asignado a vos');
    if(!caso.turno_id)throw fail(409,'Primero debe iniciarse el control');
    if(['resuelto','cancelado'].includes(caso.estado))throw fail(409,'El caso ya está cerrado');
    const turno=(await db.query('SELECT * FROM turnos WHERE id=$1 FOR UPDATE',[caso.turno_id])).rows[0];
    const events=(await db.query('SELECT * FROM eventos_turno WHERE turno_id=$1 ORDER BY creado_en ASC',[caso.turno_id])).rows;
    if(turno?.paciente_presencial || events.some(e=>e.tipo==='union_paciente'))throw fail(409,'El trabajador ingresó al control; no corresponde registrar inasistencia');
    const first=events.find(e=>e.tipo==='union_medico') || events.find(e=>e.tipo==='inicio_medico');
    const started=first&&new Date(first.creado_en);
    if(!started||!Number.isFinite(started.getTime()))throw fail(409,'No hay un inicio médico registrado');
    const lastClose=events.filter(e=>e.tipo==='fin_consulta').at(-1);
    const end=lastClose?new Date(lastClose.creado_en):new Date();
    if(end-started<TOLERANCIA_MS)throw fail(409,'No se cumplieron los 20 minutos de tolerancia. Si finalizaste antes, reanudá el control.');
    // Keep the actual finish if already recorded; never replace it with the time of printing.
    if(!lastClose)await db.query("INSERT INTO eventos_turno (turno_id,tipo,participante) VALUES ($1,'cierre_inasistencia',$2)",[caso.turno_id,user.nombre]);
    await db.query("UPDATE turnos SET estado='completado' WHERE id=$1",[caso.turno_id]);
    await db.query("UPDATE casos_ausentismo SET estado='resuelto',resuelto_en=NOW() WHERE id=$1",[casoId]);
    await db.query('COMMIT');return {ok:true,acta:`/api/turnos/${caso.turno_id}/acta`,informe:`/api/turnos/${caso.turno_id}/informe-inasistencia`};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
module.exports={insertEvent,closeNoShow};
