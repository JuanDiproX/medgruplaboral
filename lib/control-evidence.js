const TOLERANCIA_MS = 20 * 60 * 1000;
const validDate = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
function controlEvidence(turno, caso, eventos = []) {
  const ordered = [...eventos].sort((a,b) => new Date(a.creado_en) - new Date(b.creado_en));
  const medical = ordered.find(e => e.tipo === 'union_medico');
  const started = ordered.find(e => e.tipo === 'inicio_medico');
  const desde = validDate(medical?.creado_en || started?.creado_en);
  const until = ordered.filter(e => ['fin_consulta','cierre_inasistencia'].includes(e.tipo)).at(-1);
  const hasta = validDate(until?.creado_en);
  const seconds = desde && hasta && hasta >= desde ? Math.floor((hasta - desde) / 1000) : null;
  const asistio = turno.paciente_presencial === true || ordered.some(e => e.tipo === 'union_paciente');
  const cerrado = turno.estado === 'completado' || caso?.estado === 'resuelto';
  const resultado = asistio ? 'asistio' : cerrado && hasta ? 'inasistencia' : 'pendiente';
  const esperaTexto = seconds == null ? 'No registrada' : `${Math.floor(seconds/60)} minutos${seconds%60 ? ` y ${seconds%60} segundos` : ''}`;
  return { resultado, desde, hasta, seconds, esperaTexto, toleranciaMinutos:20,
    // This is an elapsed window, not proof of uninterrupted presence.
    toleranciaCumplida: seconds != null && seconds * 1000 >= TOLERANCIA_MS };
}
function validCoordinates(lat, lng, precision) {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180 &&
    typeof precision === 'number' && Number.isFinite(precision) && precision >= 0;
}
const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
module.exports = {controlEvidence, validCoordinates, escapeHtml, TOLERANCIA_MS};
