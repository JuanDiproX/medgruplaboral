// Importar planilla: subir un Excel o CSV, revisar qué columna es cada dato, ver qué va a pasar
// con cada fila y confirmar. Nada se guarda hasta el último paso, y la importación se puede
// deshacer mientras los casos no se hayan empezado a trabajar.
(() => {
  'use strict';
  const raiz = () => document.getElementById('importar-app');
  const h = s => escaparHtml(s);
  const estado = {tipo: 'casos', archivo: null, analisis: null, mapeo: null, empresaFija: '', tipoControl: 'ausentismo', empresas: [], ocupado: false, filtro: 'todas'};
  const ICONO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/></svg>';
  const NOMBRES = {lista: 'Lista', aviso: 'Con aviso', repetida: 'Repetida', error: 'Con error'};
  async function api(ruta, opciones = {}) {
    const r = await fetch(ruta, {...opciones, headers: apiHeaders()});
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo completar la operación.');
    return d;
  }
  const leer = archivo => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => mal(new Error('No se pudo leer el archivo.')); r.readAsDataURL(archivo); });
  const cuerpo = () => ({nombre: estado.archivo.nombre, archivo_base64: estado.archivo.base64, tipo: estado.tipo, hoja: estado.analisis?.hoja,
    mapeo: estado.mapeo || undefined, empresa_fija: estado.empresaFija, tipo_control: estado.tipoControl});

  function pasos(actual) {
    return `<ol class="imp-pasos">${['Subir la planilla', 'Revisar columnas y filas', 'Listo'].map((t, i) =>
      `<li class="${i + 1 < actual ? 'hecho' : i + 1 === actual ? 'actual' : ''}"${i + 1 === actual ? ' aria-current="step"' : ''}><span>${i + 1}</span>${t}</li>`).join('')}</ol>`;
  }
  function error(texto) { const e = raiz().querySelector('.imp-error'); if (e) { e.textContent = texto || ''; e.hidden = !texto; if (texto) e.scrollIntoView({block: 'nearest', behavior: 'smooth'}); } }

  async function pintarInicio() {
    estado.archivo = estado.analisis = estado.mapeo = null; estado.empresaFija = ''; estado.filtro = 'todas';
    raiz().innerHTML = `${pasos(1)}
      <div class="imp-cols">
        <div class="card imp-card">
          <div class="card-body">
            <h2 class="imp-titulo">Traé tus casos desde Excel</h2>
            <p class="imp-texto">Subí la planilla tal como la tenés. Reconocemos las columnas por su título y te mostramos todo antes de guardar.</p>
            <div class="imp-tipo" role="radiogroup" aria-label="Qué contiene la planilla">
              <label><input type="radio" name="imp-tipo" value="casos" ${estado.tipo === 'casos' ? 'checked' : ''}><span><strong>Casos</strong>Ausentismo, seguimientos y controles a realizar</span></label>
              <label><input type="radio" name="imp-tipo" value="trabajadores" ${estado.tipo === 'trabajadores' ? 'checked' : ''}><span><strong>Padrón de trabajadores</strong>La nómina de una empresa, para elegirlos al dar turnos</span></label>
            </div>
            <label class="imp-zona" id="imp-zona">
              <input type="file" id="imp-archivo" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv">
              ${ICONO}
              <strong>Elegí un archivo o arrastralo acá</strong>
              <span>Excel (.xlsx) o CSV, hasta 5 MB y 5000 filas</span>
            </label>
            <p class="imp-error" role="alert" hidden></p>
            <p class="imp-nota">¿Empezás de cero? <button type="button" class="imp-link" id="imp-plantilla">Descargá la plantilla</button> con las columnas sugeridas.</p>
          </div>
        </div>
        <div class="card imp-card">
          <div class="card-hdr"><div class="card-title">Importaciones anteriores</div></div>
          <div id="imp-historial" class="imp-historial"><p class="imp-vacio">Cargando…</p></div>
        </div>
      </div>`;
    raiz().querySelectorAll('input[name=imp-tipo]').forEach(r => r.onchange = () => { estado.tipo = r.value; });
    const zona = document.getElementById('imp-zona'), input = document.getElementById('imp-archivo');
    input.onchange = () => input.files[0] && subir(input.files[0]);
    ['dragenter', 'dragover'].forEach(n => zona.addEventListener(n, e => { e.preventDefault(); zona.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(n => zona.addEventListener(n, e => { e.preventDefault(); zona.classList.remove('sobre'); }));
    zona.addEventListener('drop', e => e.dataTransfer.files[0] && subir(e.dataTransfer.files[0]));
    document.getElementById('imp-plantilla').onclick = plantilla;
    historial();
  }
  async function plantilla() {
    try {
      const r = await fetch('/api/admin/importaciones/plantilla?tipo=' + estado.tipo, {headers: apiHeaders()});
      if (!r.ok) throw new Error('No se pudo descargar la plantilla.');
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
      a.href = url; a.download = `plantilla-${estado.tipo}.xlsx`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { error(e.message); }
  }
  async function historial() {
    const caja = document.getElementById('imp-historial'); if (!caja) return;
    try {
      const {importaciones} = await api('/api/admin/importaciones');
      if (!importaciones.length) { caja.innerHTML = '<p class="imp-vacio">Todavía no se importó ninguna planilla.</p>'; return; }
      caja.innerHTML = importaciones.map(i => {
        const fecha = new Date(i.creado_en).toLocaleString('es-AR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
        const puedeDeshacer = !i.deshecha_en && (i.tipo === 'trabajadores' || i.casos_sin_tocar > 0);
        return `<div class="imp-fila-hist${i.deshecha_en ? ' deshecha' : ''}">
          <div><strong>${h(i.archivo)}</strong><span>${fecha} · ${h(i.usuario || '')}</span>
          <span>${i.filas_importadas} ${i.tipo === 'casos' ? 'casos' : 'trabajadores'} importados${i.filas_omitidas ? `, ${i.filas_omitidas} filas omitidas` : ''}${i.deshecha_en ? ' · deshecha' : ''}</span></div>
          ${puedeDeshacer ? `<button type="button" class="btn btn-ghost" data-deshacer="${i.id}" data-n="${i.tipo === 'casos' ? i.casos_sin_tocar : i.filas_importadas}">Deshacer</button>` : ''}</div>`;
      }).join('');
      caja.querySelectorAll('[data-deshacer]').forEach(b => b.onclick = () => deshacer(b.dataset.deshacer, b.dataset.n));
    } catch (e) { caja.innerHTML = `<p class="imp-vacio">${h(e.message)}</p>`; }
  }
  async function deshacer(id, n) {
    if (!(await confirmar(`Se van a borrar ${n} registros de esta importación que todavía nadie trabajó. Los casos ya asignados o programados se conservan.`, {titulo: 'Deshacer importación', textoConfirmar: 'Deshacer'}))) return;
    try { const r = await api('/api/admin/importaciones/' + id, {method: 'DELETE'}); mostrarToast(`Se borraron ${r.borradas} registros.${r.conservadas ? ` ${r.conservadas} se conservaron porque ya estaban en trabajo.` : ''}`); historial(); }
    catch (e) { mostrarError(e.message); }
  }
  async function subir(archivo) {
    error('');
    if (archivo.size > 5 * 1024 * 1024) return error('El archivo supera los 5 MB. Dividilo en varias planillas.');
    document.getElementById('imp-zona').classList.add('leyendo');
    try { estado.archivo = {nombre: archivo.name, base64: await leer(archivo)}; estado.mapeo = null; await analizar(); }
    catch (e) { document.getElementById('imp-zona')?.classList.remove('leyendo'); error(e.message); }
  }
  async function analizar() {
    if (!estado.empresas.length) { try { estado.empresas = (await api('/api/empresas-nombres')).empresas || []; } catch {} }
    estado.analisis = await api('/api/admin/importaciones/analizar', {method: 'POST', body: JSON.stringify(cuerpo())});
    estado.mapeo = {...estado.analisis.mapeo};
    pintarRevision();
  }
  function pintarRevision() {
    const a = estado.analisis, r = a.resumen, entran = r.listas + r.con_aviso, cosa = a.tipo === 'casos' ? 'casos' : 'trabajadores';
    const opciones = sel => `<option value="">No está en la planilla</option>` + a.encabezados.map((e, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${h(e)}</option>`).join('');
    const ejemplo = i => i == null ? '' : (a.muestra.map(f => f[i]).find(Boolean) || '');
    const campoEmpresa = a.tipo === 'casos' ? 'empresa_nombre' : 'empresa';
    const nombres = estado.empresas.map(e => typeof e === 'string' ? e : e.nombre).filter(Boolean);
    const filas = a.filas.filter(f => estado.filtro === 'todas' || f.estado === estado.filtro);
    const col = a.tipo === 'casos'
      ? [['Trabajador', d => d.trabajador_nombre], ['DNI', d => d.trabajador_dni], ['Empresa', d => d.empresa_nombre], ['Domicilio', d => d.domicilio], ['Motivo', d => d.motivo]]
      : [['Trabajador', d => d.nombre], ['Empresa', d => d.empresa], ['Teléfono', d => d.telefono]];
    raiz().innerHTML = `${pasos(2)}
      <div class="card imp-card">
        <div class="card-hdr"><div class="card-title">${h(estado.archivo.nombre)}</div>
          <div class="imp-cab">${a.hojas.length > 1 ? `<label>Hoja <select id="imp-hoja">${a.hojas.map(x => `<option${x.nombre === a.hoja ? ' selected' : ''} value="${h(x.nombre)}">${h(x.nombre)} (${x.filas})</option>`).join('')}</select></label>` : ''}
          <button type="button" class="btn btn-ghost" id="imp-otro">Cambiar archivo</button></div></div>
        <div class="card-body">
          <h2 class="imp-subtitulo">Qué columna es cada dato</h2>
          <p class="imp-texto">Lo propusimos según los títulos de tu planilla. Corregí lo que no coincida: la vista previa se actualiza sola.</p>
          <div class="imp-mapeo">${a.campos.map(c => `<label class="imp-campo${c.requerido ? ' req' : ''}"><span>${h(c.etiqueta)}${c.requerido ? ' <em>obligatorio</em>' : ''}</span>
            <select data-campo="${c.id}">${opciones(estado.mapeo[c.id])}</select><small>${ejemplo(estado.mapeo[c.id]) ? 'Ej.: ' + h(String(ejemplo(estado.mapeo[c.id])).slice(0, 44)) : '&nbsp;'}</small></label>`).join('')}</div>
          <div class="imp-ajustes">
            ${estado.mapeo[campoEmpresa] == null || a.empresas_faltantes.length ? `<label class="imp-campo"><span>${estado.mapeo[campoEmpresa] == null ? 'Todas las filas son de esta empresa' : 'Empresa para las filas sin empresa'}</span>
              <select id="imp-empresa-fija"><option value="">Elegí una empresa…</option>${nombres.map(n => `<option${n === estado.empresaFija ? ' selected' : ''}>${h(n)}</option>`).join('')}</select><small>&nbsp;</small></label>` : ''}
            ${a.tipo === 'casos' ? `<label class="imp-campo"><span>Tipo de control cuando la planilla no lo dice</span><select id="imp-tipo-control">
              ${[['ausentismo', 'Control de ausentismo'], ['seguimiento_medico', 'Seguimiento médico'], ['examen_periodico', 'Seguimiento por examen periódico']].map(([v, t]) => `<option value="${v}"${v === estado.tipoControl ? ' selected' : ''}>${t}</option>`).join('')}</select><small>&nbsp;</small></label>` : ''}
          </div>
          ${a.empresas_faltantes.length ? `<p class="imp-aviso">Estas empresas de la planilla no están cargadas en el portal: <strong>${a.empresas_faltantes.map(h).join(', ')}</strong>. Creálas en Empresas con el mismo nombre y volvé a subir el archivo, o esas filas quedan afuera.</p>` : ''}
        </div>
      </div>
      <div class="card imp-card">
        <div class="card-hdr"><div class="card-title">Qué va a pasar con cada fila</div></div>
        <div class="imp-resumen" role="tablist">
          ${[['todas', 'Todas', r.total], ['lista', 'Listas', r.listas], ['aviso', 'Con aviso', r.con_aviso], ['repetida', 'Repetidas', r.repetidas], ['error', 'Con error', r.con_error]].map(([id, t, n]) =>
            `<button type="button" role="tab" class="imp-chip e-${id}${estado.filtro === id ? ' activo' : ''}" aria-selected="${estado.filtro === id}" data-filtro="${id}"${n ? '' : ' disabled'}><b>${n}</b>${t}</button>`).join('')}
        </div>
        <div class="imp-tabla-wrap"><table class="imp-tabla"><thead><tr><th>Fila</th><th>Estado</th>${col.map(c => `<th>${c[0]}</th>`).join('')}<th>Observación</th></tr></thead><tbody>
          ${filas.length ? filas.map(f => `<tr class="e-${f.estado}"><td data-label="Fila">${f.numero}</td><td data-label="Estado"><span class="imp-estado e-${f.estado}">${NOMBRES[f.estado]}</span></td>
            ${col.map(c => `<td data-label="${c[0]}">${h(c[1](f.datos) || '—')}</td>`).join('')}<td data-label="Observación">${h([...f.errores, ...f.avisos].join(' · ') || '—')}</td></tr>`).join('')
            : `<tr><td colspan="${col.length + 3}" class="imp-vacio">No hay filas en este grupo.</td></tr>`}
        </tbody></table></div>
        ${a.filas_mostradas < r.total ? `<p class="imp-nota" style="padding:0 1.25rem 1rem;">Se muestran las primeras ${a.filas_mostradas} filas de ${r.total}. Se importan todas las que estén listas.</p>` : ''}
      </div>
      <div class="imp-confirmar">
        <div><strong>${entran ? `Se van a crear ${entran} ${cosa}` : 'No hay filas listas para importar'}</strong>
          <span>${r.repetidas + r.con_error ? `${r.repetidas + r.con_error} filas quedan afuera (repetidas o con error). ` : ''}${entran && a.tipo === 'casos' ? 'Entran como casos nuevos, sin profesional ni turno: después los asignás y programás como siempre.' : ''}</span></div>
        <button type="button" class="btn btn-primary" id="imp-confirmar"${entran ? '' : ' disabled'}>Importar ${entran || ''} ${cosa}</button>
      </div>
      <p class="imp-error" role="alert" hidden></p>`;
    raiz().querySelectorAll('select[data-campo]').forEach(s => s.onchange = () => { estado.mapeo[s.dataset.campo] = s.value === '' ? '' : Number(s.value); reanalizar(); });
    const fija = document.getElementById('imp-empresa-fija'); if (fija) fija.onchange = () => { estado.empresaFija = fija.value; reanalizar(); };
    const tc = document.getElementById('imp-tipo-control'); if (tc) tc.onchange = () => { estado.tipoControl = tc.value; reanalizar(); };
    const hoja = document.getElementById('imp-hoja'); if (hoja) hoja.onchange = () => { estado.analisis.hoja = hoja.value; estado.mapeo = null; reanalizar(true); };
    raiz().querySelectorAll('[data-filtro]').forEach(b => b.onclick = () => { estado.filtro = b.dataset.filtro; pintarRevision(); });
    document.getElementById('imp-otro').onclick = pintarInicio;
    document.getElementById('imp-confirmar').onclick = confirmarImportacion;
  }
  async function reanalizar(nuevaHoja) {
    if (estado.ocupado) return; estado.ocupado = true; raiz().classList.add('imp-ocupado');
    try {
      const mapeo = estado.mapeo;
      estado.analisis = await api('/api/admin/importaciones/analizar', {method: 'POST', body: JSON.stringify(cuerpo())});
      estado.mapeo = nuevaHoja ? {...estado.analisis.mapeo} : Object.fromEntries(Object.entries(mapeo).filter(([, v]) => v !== '' && v != null));
      if (!estado.analisis.filas.some(f => f.estado === estado.filtro)) estado.filtro = 'todas';
      pintarRevision();
    } catch (e) { error(e.message); } finally { estado.ocupado = false; raiz().classList.remove('imp-ocupado'); }
  }
  async function confirmarImportacion() {
    const boton = document.getElementById('imp-confirmar'); boton.disabled = true; error('');
    try {
      const r = await api('/api/admin/importaciones', {method: 'POST', body: JSON.stringify(cuerpo())});
      const casos = estado.tipo === 'casos';
      raiz().innerHTML = `${pasos(3)}<div class="card imp-card imp-listo"><div class="card-body">
        <svg class="imp-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="m15 27 7.5 7.5L38 19"/></svg>
        <h2 class="imp-titulo">${r.importadas} ${casos ? 'casos importados' : 'trabajadores importados'}</h2>
        <p class="imp-texto">${r.omitidas ? `${r.omitidas} filas quedaron afuera por estar repetidas o incompletas. ` : ''}${casos ? 'Ya están en Ausentismo como casos nuevos. El siguiente paso es asignarles un profesional y programar el control.' : 'Ya aparecen al elegir un trabajador de esa empresa.'}</p>
        <div class="imp-acciones">${casos ? '<button type="button" class="btn btn-primary" id="imp-ir">Ver los casos</button>' : ''}<button type="button" class="btn btn-ghost" id="imp-otra">Importar otra planilla</button></div>
      </div></div>`;
      document.getElementById('imp-otra').onclick = pintarInicio;
      const ir = document.getElementById('imp-ir'); if (ir) ir.onclick = () => showSection('ausentismo', document.getElementById('nav-ausentismo'));
    } catch (e) { boton.disabled = false; error(e.message); }
  }
  window.medgrupImportar = {abrir() { if (!estado.analisis) pintarInicio(); }};
})();
