// Importación de casos y padrones desde planillas. Pensado para que una prestadora nueva pueda
// traer lo que ya tiene en Excel: se sube el archivo, el sistema propone qué columna es cada
// dato, muestra qué va a pasar con cada fila y recién entonces se confirma. Cada importación
// queda registrada y se puede deshacer mientras los casos no se hayan empezado a trabajar.
const {leerPlanilla, crearXlsx} = require('./planilla');
const fail = (status, message) => Object.assign(new Error(message), {status, publico: true});
const llano = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Cada campo con los títulos de columna que suelen usarse para nombrarlo.
const CAMPOS = {
  casos: [
    {id: 'trabajador_nombre', etiqueta: 'Apellido y nombre', requerido: true, alias: ['apellido y nombre', 'nombre y apellido', 'apellido nombre', 'nombre completo', 'trabajador', 'empleado', 'paciente', 'agente', 'colaborador', 'nombre']},
    {id: 'apellido', etiqueta: 'Apellido (si viene separado)', alias: ['apellido', 'apellidos']},
    {id: 'trabajador_dni', etiqueta: 'DNI', alias: ['dni', 'documento', 'nro documento', 'numero de documento', 'nro doc', 'doc', 'cuil', 'cuit', 'legajo dni']},
    {id: 'empresa_nombre', etiqueta: 'Empresa', alias: ['empresa', 'razon social', 'cliente', 'empleador', 'organismo', 'compania']},
    {id: 'trabajador_telefono', etiqueta: 'Teléfono', alias: ['telefono', 'celular', 'cel', 'movil', 'whatsapp', 'tel', 'contacto']},
    {id: 'trabajador_email', etiqueta: 'Correo del trabajador', alias: ['email', 'e mail', 'mail', 'correo', 'correo electronico', 'correo del trabajador']},
    {id: 'domicilio', etiqueta: 'Domicilio', alias: ['domicilio', 'direccion', 'domicilio de reposo', 'calle', 'domicilio real', 'direccion de reposo']},
    {id: 'localidad', etiqueta: 'Localidad', alias: ['localidad', 'ciudad', 'partido', 'municipio']},
    {id: 'provincia', etiqueta: 'Provincia', alias: ['provincia', 'pcia']},
    {id: 'motivo', etiqueta: 'Motivo o diagnóstico', alias: ['motivo', 'diagnostico', 'motivo de ausencia', 'causa', 'patologia', 'motivo de la ausencia', 'detalle']},
    {id: 'fecha_inicio', etiqueta: 'Fecha de inicio de la ausencia', alias: ['fecha de inicio', 'inicio', 'desde', 'fecha inicio', 'fecha de ausencia', 'fecha', 'inicio licencia']},
    {id: 'dias', etiqueta: 'Días de licencia', alias: ['dias', 'dias de licencia', 'cantidad de dias', 'dias de reposo', 'dias otorgados']},
    {id: 'tipo_control', etiqueta: 'Tipo de control', alias: ['tipo', 'tipo de control', 'servicio', 'prestacion']},
    {id: 'solicitante_email', etiqueta: 'Correo de quien solicita', alias: ['correo solicitante', 'email solicitante', 'correo empresa', 'email rrhh', 'solicitante']},
    {id: 'notas_admin', etiqueta: 'Observaciones', alias: ['observaciones', 'notas', 'comentarios', 'obs', 'observacion']}
  ],
  trabajadores: [
    {id: 'nombre', etiqueta: 'Apellido y nombre', requerido: true, alias: ['apellido y nombre', 'nombre y apellido', 'nombre completo', 'trabajador', 'empleado', 'agente', 'nombre']},
    {id: 'apellido', etiqueta: 'Apellido (si viene separado)', alias: ['apellido', 'apellidos']},
    {id: 'empresa', etiqueta: 'Empresa', alias: ['empresa', 'razon social', 'cliente', 'empleador']},
    {id: 'telefono', etiqueta: 'Teléfono', alias: ['telefono', 'celular', 'cel', 'movil', 'whatsapp', 'tel']}
  ]
};
const TIPOS_CONTROL = [['examen_periodico', /examen|periodic/], ['seguimiento_medico', /seguim|cronic|psiq|audit/], ['ausentismo', /ausent|licenc|domicil|control/]];

// Propone una columna para cada campo: coincidencia exacta del título primero, parcial después.
function sugerirMapeo(encabezados, tipo) {
  const titulos = encabezados.map(llano), usados = new Set(), mapeo = {};
  for (const exacto of [true, false]) for (const campo of CAMPOS[tipo]) {
    if (mapeo[campo.id] != null) continue;
    for (const alias of campo.alias) {
      const i = titulos.findIndex((t, j) => !usados.has(j) && t && (exacto ? t === alias : (t.startsWith(alias + ' ') || t.endsWith(' ' + alias) || t.includes(' ' + alias + ' '))));
      if (i >= 0) { mapeo[campo.id] = i; usados.add(i); break; }
    }
  }
  return mapeo;
}
const soloDigitos = s => String(s ?? '').replace(/\D/g, '');
function fechaTexto(v) {
  const s = String(v ?? '').trim(); if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3].length === 2 ? '20' + m[3] : m[3]}`;
  return s;
}
const emailValido = v => /^[^\s<>@,;"():]+@[^\s<>@,;"():]+\.[^\s<>@,;"():]+$/.test(v) && v.length <= 254;

function normalizarCaso(celdas, mapeo, ctx) {
  const v = id => mapeo[id] != null && mapeo[id] !== '' ? String(celdas[mapeo[id]] ?? '').trim() : '';
  const errores = [], avisos = [];
  let nombre = v('trabajador_nombre');
  if (v('apellido')) nombre = nombre ? `${v('apellido')}, ${nombre}` : v('apellido');
  if (!nombre) errores.push('Falta el nombre del trabajador');
  let empresa = v('empresa_nombre') || ctx.empresaFija || '';
  const conocida = ctx.empresas.get(llano(empresa));
  if (!empresa) errores.push('Falta la empresa');
  else if (!conocida) errores.push(`La empresa "${empresa}" no está cargada`);
  else empresa = conocida.nombre;
  let dni = v('trabajador_dni');
  const digitos = soloDigitos(dni);
  if (dni && (digitos.length < 6 || digitos.length > 11)) avisos.push('El DNI no parece válido');
  if (digitos.length === 11) dni = digitos.slice(2, 10); // CUIL -> DNI
  else if (digitos) dni = digitos;
  const telefono = v('trabajador_telefono');
  if (telefono && soloDigitos(telefono).length < 8) avisos.push('El teléfono parece incompleto');
  let email = v('trabajador_email').toLowerCase();
  if (email && !emailValido(email)) { avisos.push('Correo del trabajador inválido: se deja vacío'); email = ''; }
  let solicitante = v('solicitante_email').toLowerCase();
  if (solicitante && !emailValido(solicitante)) solicitante = '';
  const domicilio = [v('domicilio'), v('localidad'), v('provincia')].filter(Boolean).join(', ');
  if (!domicilio) avisos.push('Sin domicilio: habrá que cargarlo antes del control domiciliario');
  const partes = [v('motivo')];
  if (v('fecha_inicio')) partes.push('Inicio: ' + fechaTexto(v('fecha_inicio')));
  if (v('dias')) partes.push('Días: ' + v('dias'));
  const tipoTexto = llano(v('tipo_control'));
  const tipo = (tipoTexto && (TIPOS_CONTROL.find(([, re]) => re.test(tipoTexto)) || [])[0]) || ctx.tipoControl || 'ausentismo';
  const datos = {trabajador_nombre: nombre.slice(0, 200), trabajador_dni: dni.slice(0, 50), empresa_nombre: empresa.slice(0, 200), empresa_id: conocida?.id || null,
    trabajador_telefono: telefono.slice(0, 50), trabajador_email: email || null, solicitante_email: solicitante || conocida?.email || null,
    domicilio: domicilio.slice(0, 300), motivo: partes.filter(Boolean).join(' · ').slice(0, 2000), tipo_control: tipo, notas_admin: v('notas_admin').slice(0, 2000)};
  return {datos, errores, avisos, clave: llano(empresa) + '|' + (dni || llano(nombre))};
}
function normalizarTrabajador(celdas, mapeo, ctx) {
  const v = id => mapeo[id] != null && mapeo[id] !== '' ? String(celdas[mapeo[id]] ?? '').trim() : '';
  const errores = [];
  let nombre = v('nombre'); if (v('apellido')) nombre = nombre ? `${v('apellido')}, ${nombre}` : v('apellido');
  if (!nombre) errores.push('Falta el nombre');
  let empresa = v('empresa') || ctx.empresaFija || '';
  const conocida = ctx.empresas.get(llano(empresa));
  if (!empresa) errores.push('Falta la empresa'); else if (!conocida) errores.push(`La empresa "${empresa}" no está cargada`); else empresa = conocida.nombre;
  return {datos: {nombre: nombre.slice(0, 200), empresa: empresa.slice(0, 200), telefono: v('telefono').slice(0, 50)}, errores, avisos: [], clave: llano(empresa) + '|' + llano(nombre)};
}

function createImportador({app, pool, adminMiddleware, fallo, vincular}) {
  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS importaciones(
      id SERIAL PRIMARY KEY, tipo TEXT NOT NULL, archivo TEXT NOT NULL, hoja TEXT, usuario TEXT, filas_total INT NOT NULL DEFAULT 0,
      filas_importadas INT NOT NULL DEFAULT 0, filas_omitidas INT NOT NULL DEFAULT 0, detalle JSONB, deshecha_en TIMESTAMPTZ, creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW());
      ALTER TABLE casos_ausentismo ADD COLUMN IF NOT EXISTS importacion_id INT;
      ALTER TABLE pacientes_empresa ADD COLUMN IF NOT EXISTS importacion_id INT;
      CREATE INDEX IF NOT EXISTS idx_casos_importacion ON casos_ausentismo (importacion_id)`);
  }
  // Lee el archivo y clasifica cada fila: lista, con aviso, repetida o con error.
  async function analizar(body, db = pool) {
    const tipo = body.tipo === 'trabajadores' ? 'trabajadores' : 'casos';
    const hojas = leerPlanilla({nombre: body.nombre, base64: body.archivo_base64});
    const hoja = hojas.find(h => h.nombre === body.hoja) || hojas.slice().sort((a, b) => b.filas.length - a.filas.length)[0];
    if (!hoja || !hoja.filas.length) throw fail(400, 'No encontramos filas con datos debajo de los títulos de columna.');
    const sugerido = sugerirMapeo(hoja.encabezados, tipo);
    const mapeo = {};
    for (const campo of CAMPOS[tipo]) {
      const pedido = body.mapeo && Object.prototype.hasOwnProperty.call(body.mapeo, campo.id) ? body.mapeo[campo.id] : sugerido[campo.id];
      const i = pedido === '' || pedido == null ? null : Number(pedido);
      if (i != null && Number.isInteger(i) && i >= 0 && i < hoja.encabezados.length) mapeo[campo.id] = i;
    }
    const empresas = new Map((await db.query('SELECT id,nombre,email FROM empresas_clientes WHERE activo=true')).rows.map(e => [llano(e.nombre), e]));
    const empresaFija = body.empresa_fija && empresas.get(llano(body.empresa_fija)) ? empresas.get(llano(body.empresa_fija)).nombre : '';
    const ctx = {empresas, empresaFija, tipoControl: ['ausentismo', 'seguimiento_medico', 'examen_periodico'].includes(body.tipo_control) ? body.tipo_control : 'ausentismo'};
    // Lo que ya existe: casos abiertos del mismo trabajador en la misma empresa, o el mismo nombre en el padrón.
    const existentes = new Set();
    if (tipo === 'casos') for (const c of (await db.query(`SELECT empresa_nombre,trabajador_nombre,trabajador_dni FROM casos_ausentismo WHERE estado NOT IN ('resuelto','cancelado')`)).rows)
      existentes.add(llano(c.empresa_nombre) + '|' + (soloDigitos(c.trabajador_dni) || llano(c.trabajador_nombre)));
    else for (const p of (await db.query('SELECT empresa,nombre FROM pacientes_empresa WHERE activo=true')).rows) existentes.add(llano(p.empresa) + '|' + llano(p.nombre));
    const vistos = new Set(), filas = [], resumen = {total: hoja.filas.length, listas: 0, con_aviso: 0, repetidas: 0, con_error: 0};
    const usadas = Object.values(mapeo);
    for (const f of hoja.filas) {
      // Filas de totales, numeración o separadores: sin ningún dato en las columnas elegidas, se ignoran.
      if (usadas.every(i => !f.celdas[i])) { resumen.total--; continue; }
      const r = (tipo === 'casos' ? normalizarCaso : normalizarTrabajador)(f.celdas, mapeo, ctx);
      let estado = 'lista';
      if (r.errores.length) estado = 'error';
      else if (existentes.has(r.clave)) { estado = 'repetida'; r.avisos.unshift(tipo === 'casos' ? 'Ya tiene un caso abierto en esta empresa' : 'Ya está en el padrón'); }
      else if (vistos.has(r.clave)) { estado = 'repetida'; r.avisos.unshift('Repetida dentro del archivo'); }
      else if (r.avisos.length) estado = 'aviso';
      if (!r.errores.length) vistos.add(r.clave);
      resumen[{lista: 'listas', aviso: 'con_aviso', repetida: 'repetidas', error: 'con_error'}[estado]]++;
      filas.push({numero: f.numero, estado, datos: r.datos, errores: r.errores, avisos: r.avisos});
    }
    const sinEmpresa = [...new Set(filas.flatMap(f => f.errores.filter(e => e.startsWith('La empresa "')).map(e => e.slice(12, e.lastIndexOf('"')))))].slice(0, 30);
    return {tipo, hoja: hoja.nombre, hojas: hojas.map(h => ({nombre: h.nombre, filas: h.filas.length})), encabezados: hoja.encabezados,
      muestra: hoja.filas.slice(0, 3).map(f => f.celdas), campos: CAMPOS[tipo].map(({id, etiqueta, requerido}) => ({id, etiqueta, requerido: !!requerido})),
      mapeo, resumen, filas, empresas_faltantes: sinEmpresa, empresa_fija: empresaFija};
  }
  const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { e.status ? res.status(e.status).json({error: e.message}) : fallo(res, e); } };

  app.post('/api/admin/importaciones/analizar', adminMiddleware, wrap(async (req, res) => {
    const a = await analizar(req.body || {});
    res.json({ok: true, ...a, filas: a.filas.slice(0, 300), filas_mostradas: Math.min(a.filas.length, 300)});
  }));
  app.post('/api/admin/importaciones', adminMiddleware, wrap(async (req, res) => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT pg_advisory_xact_lock(hashtext('importaciones'))");
      const a = await analizar(req.body || {}, db);
      const incluir = a.filas.filter(f => f.estado === 'lista' || f.estado === 'aviso' || (f.estado === 'repetida' && req.body.incluir_repetidas === true && !f.errores.length));
      if (!incluir.length) throw fail(400, 'No hay filas para importar. Revisá los errores marcados en la vista previa.');
      const imp = (await db.query(`INSERT INTO importaciones(tipo,archivo,hoja,usuario,filas_total,filas_importadas,filas_omitidas,detalle) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,creado_en`,
        [a.tipo, String(req.body.nombre || 'planilla').replace(/[<>"'`&\\]/g, '').slice(0, 200), a.hoja, req.usuario.nombre, a.resumen.total, incluir.length, a.resumen.total - incluir.length,
          JSON.stringify({resumen: a.resumen, omitidas: a.filas.filter(f => !incluir.includes(f)).slice(0, 200).map(f => ({fila: f.numero, motivo: [...f.errores, ...f.avisos][0] || ''}))})])).rows[0];
      const ids = [];
      for (const f of incluir) {
        const d = f.datos;
        if (a.tipo === 'casos') ids.push((await db.query(`INSERT INTO casos_ausentismo(empresa_id,empresa_nombre,trabajador_nombre,trabajador_dni,trabajador_telefono,motivo,estado,domicilio,tipo_control,solicitante_email,trabajador_email,notas_admin,importacion_id)
          VALUES($1,$2,$3,$4,$5,$6,'nuevo',$7,$8,$9,$10,$11,$12) RETURNING id`, [d.empresa_id, d.empresa_nombre, d.trabajador_nombre, d.trabajador_dni, d.trabajador_telefono, d.motivo, d.domicilio, d.tipo_control,
          d.solicitante_email, d.trabajador_email, d.notas_admin, imp.id])).rows[0].id);
        else await db.query('INSERT INTO pacientes_empresa(empresa,nombre,telefono,importacion_id) VALUES($1,$2,$3,$4)', [d.empresa, d.nombre, d.telefono, imp.id]);
      }
      await db.query('COMMIT');
      // Los legajos de seguimiento abiertos del mismo paciente se vinculan igual que en el alta manual.
      if (a.tipo === 'casos' && vincular) for (let i = 0; i < ids.length; i++) await vincular({casoId: ids[i], nombre: incluir[i].datos.trabajador_nombre, dni: incluir[i].datos.trabajador_dni}).catch(() => {});
      res.json({ok: true, id: imp.id, importadas: incluir.length, omitidas: a.resumen.total - incluir.length, sin_domicilio: a.tipo === 'casos' ? incluir.filter(f => !f.datos.domicilio).length : 0});
    } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
  }));
  app.get('/api/admin/importaciones', adminMiddleware, wrap(async (req, res) => {
    const r = await pool.query(`SELECT i.id,i.tipo,i.archivo,i.usuario,i.filas_total,i.filas_importadas,i.filas_omitidas,i.creado_en,i.deshecha_en,
      (SELECT COUNT(*)::int FROM casos_ausentismo c WHERE c.importacion_id=i.id AND c.estado='nuevo' AND c.turno_id IS NULL AND c.profesional_id IS NULL) AS casos_sin_tocar
      FROM importaciones i ORDER BY i.id DESC LIMIT 50`);
    res.json({ok: true, importaciones: r.rows});
  }));
  // Deshacer: solo borra lo que nadie tocó todavía. Un caso asignado, programado o con
  // documentos ya es trabajo del equipo y no se elimina desde acá.
  app.delete('/api/admin/importaciones/:id', adminMiddleware, wrap(async (req, res) => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const imp = (await db.query('SELECT * FROM importaciones WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      if (!imp) throw fail(404, 'Importación no encontrada.');
      if (imp.deshecha_en) throw fail(409, 'Esta importación ya se deshizo.');
      let borradas;
      if (imp.tipo === 'casos') borradas = (await db.query(`DELETE FROM casos_ausentismo c WHERE c.importacion_id=$1 AND c.estado='nuevo' AND c.turno_id IS NULL AND c.profesional_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM certificados_ausentismo x WHERE x.caso_id=c.id) AND NOT EXISTS (SELECT 1 FROM informes_ausentismo x WHERE x.caso_id=c.id)
        AND NOT EXISTS (SELECT 1 FROM casos_ausentismo x WHERE x.caso_anterior_id=c.id) RETURNING id`, [imp.id])).rows.length;
      else borradas = (await db.query('DELETE FROM pacientes_empresa WHERE importacion_id=$1 RETURNING id', [imp.id])).rows.length;
      await db.query('UPDATE importaciones SET deshecha_en=NOW() WHERE id=$1', [imp.id]);
      await db.query('COMMIT');
      res.json({ok: true, borradas, conservadas: imp.filas_importadas - borradas});
    } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
  }));
  app.get('/api/admin/importaciones/plantilla', adminMiddleware, wrap(async (req, res) => {
    const casos = req.query.tipo !== 'trabajadores';
    const filas = casos
      ? [['Apellido y nombre', 'DNI', 'Empresa', 'Teléfono', 'Correo', 'Domicilio', 'Localidad', 'Provincia', 'Motivo', 'Fecha de inicio', 'Días', 'Tipo de control', 'Observaciones'],
        ['Ejemplo, Persona', '30111222', 'Nombre de la empresa tal como está cargada', '2964 555000', 'persona@ejemplo.com', 'Av. San Martín 100', 'Río Grande', 'Tierra del Fuego', 'Lumbalgia', '10/11/2026', '5', 'Control de ausentismo', 'Borrá esta fila de ejemplo']]
      : [['Apellido y nombre', 'Empresa', 'Teléfono'], ['Ejemplo, Persona', 'Nombre de la empresa tal como está cargada', '2964 555000']];
    const archivo = crearXlsx(casos ? 'Casos' : 'Trabajadores', filas, filas[0].map(t => Math.max(14, t.length + 6)));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="plantilla-${casos ? 'casos' : 'trabajadores'}.xlsx"`);
    res.send(archivo);
  }));
  return {init, analizar};
}
module.exports = {createImportador, sugerirMapeo, CAMPOS};
