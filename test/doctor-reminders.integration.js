const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createDoctorReminders}=require('../lib/doctor-reminders');

test('recordatorios médicos: hora argentina, destinatario, deduplicación, cancelación y reintento',async()=>{
  const db=new PGlite();const sent=[];let enabled=true;
  try{
    await db.exec(`CREATE TABLE medicos(id SERIAL PRIMARY KEY,nombre TEXT,activo BOOLEAN DEFAULT true);
      CREATE TABLE usuarios(nombre TEXT,email TEXT,rol TEXT,activo BOOLEAN DEFAULT true);
      CREATE TABLE turnos(id VARCHAR(50) PRIMARY KEY,paciente TEXT,fecha DATE,hora TEXT,tipo TEXT,estado TEXT);
      CREATE TABLE turno_medicos(turno_id TEXT,medico_nombre TEXT);
      INSERT INTO medicos(nombre) VALUES('Profesional de prueba');
      INSERT INTO usuarios VALUES('Profesional de prueba','acceso@example.invalid','medico',true);`);
    const query=(s,p)=>!p&&s.includes(';')?db.exec(s):db.query(s,p);
    const pool={query,connect:async()=>({query,release(){}})};
    const n=createDoctorReminders({pool,baseUrl:()=> 'https://example.invalid',send:async(to,subject,html)=>{if(enabled)sent.push({to,subject,html});return enabled;}});
    await n.init();await n.init();
    await db.exec(`UPDATE medicos SET recordatorio_email='recordatorio@example.invalid';
      INSERT INTO turnos SELECT 't1','Persona <prueba>',(NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires'+INTERVAL '50 minutes')::date,
        to_char(NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires'+INTERVAL '50 minutes','HH24:MI'),'Control de ausentismo','pendiente';
      INSERT INTO turno_medicos VALUES('t1','Profesional de prueba');
      INSERT INTO turnos SELECT 'lejano',paciente,fecha,to_char(NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires'+INTERVAL '2 hours','HH24:MI'),tipo,estado FROM turnos WHERE id='t1';
      INSERT INTO turno_medicos VALUES('lejano','Profesional de prueba');`);
    await Promise.all([n.processPending(),n.processPending()]);
    assert.equal(sent.length,1);assert.equal(sent[0].to,'recordatorio@example.invalid');
    assert.match(sent[0].html,/Persona &lt;prueba&gt;/);assert.match(sent[0].html,/hora argentina/);
    await n.processPending();assert.equal(sent.length,1);
    // A failed send remains retryable; cancellation invalidates it immediately.
    await db.exec(`UPDATE turnos SET hora=to_char(NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires'+INTERVAL '40 minutes','HH24:MI') WHERE id='t1'`);
    enabled=false;await n.processPending();
    assert.equal((await db.query("SELECT intentos FROM medico_recordatorios WHERE estado='pendiente'")).rows[0].intentos,1);
    await db.exec("UPDATE turnos SET estado='cancelado' WHERE id='t1';UPDATE medico_recordatorios SET proximo_en=NOW()");
    enabled=true;await n.processPending();assert.equal(sent.length,1);
    await db.exec("UPDATE turnos SET estado='pendiente' WHERE id='t1'");
    await n.processPending();assert.equal(sent.length,2);
    await db.exec("DELETE FROM turno_medicos WHERE turno_id='t1'");
    await n.processPending();assert.equal(sent.length,2);
    const admin=createDoctorReminders({pool,administrationEmail:'adm@example.invalid',baseUrl:()=> 'https://example.invalid',send:async(to,subject,html)=>{sent.push({to,subject,html});return true;}});
    await admin.processPending();
    assert.equal(sent.length,3,'administración recibe incluso sin médico asignado');
    assert.equal(sent[2].to,'adm@example.invalid');assert.match(sent[2].html,/Sin médico asignado/);
    await db.exec(`INSERT INTO medicos(nombre) VALUES('Otra profesional sin correo'),('Tercer profesional sin correo');
      INSERT INTO turnos SELECT 't2',paciente,fecha,hora,'Junta médica',estado FROM turnos WHERE id='t1';
      INSERT INTO turno_medicos VALUES('t2','Otra profesional sin correo'),('t2','Tercer profesional sin correo');`);
    await admin.processPending();await admin.processPending();
    assert.equal(sent.length,4,'un solo aviso administrativo por turno, aunque tenga varios médicos sin correo');
    assert.equal(sent[3].to,'adm@example.invalid');assert.match(sent[3].html,/Junta médica/);
    assert.match(sent[3].html,/Otra profesional sin correo, Tercer profesional sin correo/);
  }finally{await db.close();}
});
