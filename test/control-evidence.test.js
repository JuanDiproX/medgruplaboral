const {test} = require('node:test');
const assert = require('node:assert/strict');
const {controlEvidence,validCoordinates} = require('../lib/control-evidence');
const e = (tipo, time) => ({tipo,creado_en:`2026-10-23T${time}-03:00`});
test('espera observada de Prieto no se redondea a veinte minutos',()=>{
  const d=controlEvidence({estado:'completado'},null,[e('union_medico','17:20:53'),e('fin_consulta','17:40:28')]);
  assert.equal(d.resultado,'inasistencia'); assert.equal(d.seconds,1175);
  assert.equal(d.esperaTexto,'19 minutos y 35 segundos'); assert.equal(d.toleranciaCumplida,false);
});
test('ubicación aceptada sin unión no es asistencia; tampoco inventa espera',()=>{
  const d=controlEvidence({estado:'completado'},{estado:'resuelto'},[]);
  assert.equal(d.resultado,'pendiente'); assert.equal(d.seconds,null);
});
test('unión del paciente y presencial prevalecen sobre inasistencia',()=>{
  assert.equal(controlEvidence({estado:'completado'},null,[e('union_paciente','17:21:00')]).resultado,'asistio');
  assert.equal(controlEvidence({paciente_presencial:true},null,[]).resultado,'asistio');
});
test('reconexión conserva primer ingreso y último cierre; eventos desordenados',()=>{
  const d=controlEvidence({estado:'completado'},null,[e('fin_consulta','17:50:00'),e('union_medico','17:30:00'),e('union_medico','17:20:00'),e('fin_consulta','17:35:00')]);
  assert.equal(d.seconds,1800); assert.equal(d.toleranciaCumplida,true);
});
test('un turno abierto no es una inasistencia',()=>{
  assert.equal(controlEvidence({estado:'pendiente'},null,[]).resultado,'pendiente');
});
test('rechaza coordenadas vacías, texto, infinitas, fuera de rango y precisión negativa',()=>{
  for (const values of [[null,null,2],['-53',-67,1],[Infinity,-67,1],[91,0,1],[0,181,1],[0,0,-1],[0,0,null]]) assert.equal(validCoordinates(...values),false);
  assert.equal(validCoordinates(0,0,0),true);
});
