// Datos ficticios para ver todas las pantallas en local. Nunca se ejecuta en producción:
// solo lo llama scripts/dev-local.cjs sobre la base embebida.
const {hashPassword} = require('../lib/passwords');
const crypto = require('crypto');
const dia = n => { const d = new Date(Date.now() + n * 864e5); return d.toLocaleDateString('en-CA', {timeZone: 'America/Argentina/Buenos_Aires'}); };
module.exports = async run => {
  if ((await run("SELECT 1 FROM usuarios WHERE email='admin@demo.local'")).rows.length) return;
  const clave = hashPassword('demo-local-2026');
  await run("INSERT INTO usuarios(nombre,email,password_hash,rol) VALUES('Administración Demo','admin@demo.local',$1,'admin'),('Dra. Ficticia, Ana','medica@demo.local',$1,'medico')", [clave]);
  await run("INSERT INTO medicos(nombre,matricula,especialidad,telefono) VALUES('Dra. Ficticia, Ana','MP 0000','Medicina Laboral','2964000000')");
  await run("INSERT INTO empresas_clientes(nombre,email,password_hash,contacto) VALUES('Empresa Demo S.A.','empresa@demo.local',$1,'RR.HH. Demo'),('Logística Austral Demo','logistica@demo.local',$1,'Personal')", [clave]);
  const medica = (await run("SELECT id FROM medicos WHERE nombre='Dra. Ficticia, Ana'")).rows[0].id;
  const turno = async (id, paciente, f, hora, tipo, estado, empresa = 'Empresa Demo S.A.', modalidad = 'telemedicina') => {
    await run(`INSERT INTO turnos(id,paciente,fecha,hora,tipo,empresa,estado,sala,link_paciente,link_medico,links_medicos,motivo,telefono,modalidad)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'2964555000',$13)`, [id, paciente, f, hora, tipo, empresa, estado, 'sala-demo-' + id,
      'https://demo.daily.co/sala-demo-' + id + '?t=paciente', 'https://demo.daily.co/sala-demo-' + id + '?t=medico',
      JSON.stringify([{nombre: 'Dra. Ficticia, Ana', link: 'https://demo.daily.co/sala-demo-' + id + '?t=medico'}]), 'Motivo ficticio de demostración', modalidad]);
    await run("INSERT INTO turno_medicos(turno_id,medico_nombre) VALUES($1,'Dra. Ficticia, Ana')", [id]);
  };
  await turno('demo-1', 'Pérez, Juan (ficticio)', dia(0), '10:30', 'Junta médica', 'pendiente');
  await turno('demo-2', 'Gómez, María (ficticia)', dia(0), '15:00', 'Seguimiento médico', 'pendiente');
  await turno('demo-3', 'Sosa, Carla (ficticia)', dia(1), '09:00', 'Auditoría psiquiátrica', 'pendiente', 'Logística Austral Demo');
  await turno('demo-4', 'Ruiz, Pedro (ficticio)', dia(-3), '11:00', 'Examen ocupacional', 'completado', 'Empresa Demo S.A.', 'presencial');
  await turno('demo-5', 'López, Ana (ficticia)', dia(0), '12:15', 'Control de ausentismo', 'pendiente');
  const caso = async (nombre, estado, extra = {}) => (await run(`INSERT INTO casos_ausentismo(empresa_id,empresa_nombre,trabajador_nombre,trabajador_dni,trabajador_telefono,motivo,estado,
      profesional_id,turno_id,domicilio,domicilio_lat,domicilio_lng,radio_metros,token_ingreso,tipo_control,solicitante_email,trabajador_email,resuelto_en,excepcion_geo)
      VALUES(1,'Empresa Demo S.A.',$1,$2,'2964555000',$3,$4,$5,$6,$7,$8,$9,300,$10,$11,'rrhh@demo.local','paciente@demo.local',$12,$13) RETURNING id`,
    [nombre, extra.dni || '30000000', extra.motivo || 'Lumbalgia. Certificado por 5 días (dato ficticio).', estado, extra.prof ?? medica, extra.turno || null,
      extra.domicilio ?? 'Av. San Martín 100, Río Grande, Tierra del Fuego', extra.lat ?? -53.7877, extra.lng ?? -67.7095,
      extra.token || crypto.randomBytes(24).toString('hex'), extra.tipo || 'ausentismo', estado === 'resuelto' ? new Date() : null, extra.excepcion || false])).rows[0].id;
  await caso('López, Ana (ficticia)', 'programado', {turno: 'demo-5', token: 'demo'.padEnd(48, '0')});
  await caso('Gómez, María (ficticia)', 'programado', {turno: 'demo-2', tipo: 'seguimiento_medico', dni: '28111222', token: 'segui'.padEnd(48, '0')});
  await caso('Díaz, Raúl (ficticio)', 'nuevo', {prof: null, dni: '31222333', domicilio: '', lat: null, lng: null});
  await caso('Ortiz, Lucía (ficticia)', 'asignado', {dni: '33444555'});
  await caso('Ruiz, Pedro (ficticio)', 'resuelto', {dni: '25666777'});
  const seg = (await run(`INSERT INTO seguimientos(paciente_nombre,paciente_dni,empresa,diagnostico,notas,estado,creado_por)
    VALUES('Gómez, María (ficticia)','28111222','Empresa Demo S.A.','Trastorno adaptativo (dato ficticio)','Control mensual.','en_seguimiento','Administración Demo') RETURNING id`)).rows[0].id;
  await run("INSERT INTO seguimiento_vinculos(seguimiento_id,turno_id) VALUES($1,'demo-2')", [seg]);
  await run("INSERT INTO pacientes_empresa(empresa,nombre,telefono) VALUES('Empresa Demo S.A.','Pérez, Juan (ficticio)','2964555001'),('Empresa Demo S.A.','Gómez, María (ficticia)','2964555002')");
  console.log('✓ Datos ficticios: admin@demo.local · medica@demo.local · empresa@demo.local — clave demo-local-2026');
  console.log('  Ingreso de paciente de prueba: /ingreso/' + 'demo'.padEnd(48, '0'));
};
