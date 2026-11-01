const {test}=require('node:test');
const assert=require('node:assert/strict');
const {closeNoShow}=require('../lib/control-events');
const create=(events,permission=true)=>{
  const calls=[];const query=async(sql,p)=>{calls.push(sql);
    if(sql.startsWith('SELECT * FROM casos'))return {rows:[{id:1,turno_id:'t',estado:'en-curso'}]};
    if(sql.startsWith('SELECT * FROM turnos'))return {rows:[{id:'t'}]};
    if(sql.startsWith('SELECT * FROM eventos'))return {rows:events};return {rows:[]};};
  return {calls,run:()=>closeNoShow({connect:async()=>({query,release(){}})},1,{nombre:'Médica'},async()=>permission)};
};
const e=(tipo,minutesAgo)=>({tipo,creado_en:new Date(Date.now()-minutesAgo*60000)});
test('no cierra sin veinte minutos y revierte sin emitir documento',async()=>{
  const f=create([e('union_medico',10)]);await assert.rejects(f.run(),/20 minutos/);assert.ok(f.calls.includes('ROLLBACK'));assert.ok(!f.calls.some(q=>q.startsWith('UPDATE')));
});
test('no cierra si el paciente asistió o el usuario no está autorizado',async()=>{
  await assert.rejects(create([e('union_medico',30),e('union_paciente',25)]).run(),/ingresó/);
  await assert.rejects(create([],false).run(),/asignado/);
});
test('cierra con evento real tras tolerancia; nunca fabrica inicio del control',async()=>{
  const f=create([e('union_medico',25)]);const r=await f.run();assert.match(r.informe,/informe-inasistencia/);assert.ok(f.calls.includes('COMMIT'));
  assert.ok(!f.calls.some(q=>q.includes('control_iniciado_en')));
});
test('respeta el cierre anterior y no sustituye la espera por el momento de imprimir',async()=>{
  const f=create([e('union_medico',60),e('fin_consulta',35)]);await f.run();assert.ok(!f.calls.some(q=>q.startsWith('INSERT INTO eventos')));
});
