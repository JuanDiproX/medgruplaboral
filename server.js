// Forzar zona horaria argentina para todas las fechas/horas del servidor
// (Railway corre en UTC — sin esto, las actas muestran horarios corridos 3 hs)
process.env.TZ = 'America/Argentina/Buenos_Aires';

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const DAILY_API_KEY = process.env.DAILY_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'MEDGRUP <onboarding@resend.dev>';
const SESSION_SECRET = process.env.SESSION_SECRET || 'medgrup-secret-2026';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function hashPassword(p) { return crypto.createHmac('sha256', SESSION_SECRET).update(p).digest('hex'); }
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

// Envío de emails transaccionales vía Resend (REST simple, sin SDK — mismo patrón que Daily/Anthropic)
async function enviarEmail(to, subject, html) {
  if (!RESEND_API_KEY) { console.error('⚠ RESEND_API_KEY no configurada: no se pudo enviar email a', to); return false; }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html })
    });
    if (!resp.ok) { console.error('Error enviando email:', await resp.text()); return false; }
    return true;
  } catch (err) { console.error('Error enviando email:', err.message); return false; }
}

// QR de verificación pública embebido en los PDFs (informes y presupuestos)
async function generarQRDataUrl(numero) {
  try {
    const url = `${baseUrlApp()}/verificar/${encodeURIComponent(numero)}`;
    return await QRCode.toDataURL(url, { width: 140, margin: 1, color: { dark: '#1a2433', light: '#ffffff' } });
  } catch (err) { console.error('Error generando QR:', err.message); return null; }
}

const sessions = {};
const empresaSessions = {};

function authMiddleware(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || !sessions[token]) return res.status(401).json({ error: 'No autorizado', needsLogin: true });
  req.usuario = sessions[token];
  next();
}

function adminMiddleware(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || !sessions[token]) return res.status(401).json({ error: 'No autorizado', needsLogin: true });
  if (sessions[token].rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  req.usuario = sessions[token];
  next();
}

function empresaAuthMiddleware(req, res, next) {
  const token = req.headers['x-empresa-token'];
  if (!token || !empresaSessions[token]) return res.status(401).json({ error: 'No autorizado' });
  req.empresa = empresaSessions[token];
  next();
}

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY, nombre VARCHAR(200) NOT NULL,
        email VARCHAR(200) UNIQUE NOT NULL, password_hash VARCHAR(200) NOT NULL,
        rol VARCHAR(50) DEFAULT 'medico', activo BOOLEAN DEFAULT true, creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS medicos (
        id SERIAL PRIMARY KEY, nombre VARCHAR(200) NOT NULL,
        matricula VARCHAR(100), especialidad VARCHAR(100) DEFAULT 'Medicina Laboral',
        activo BOOLEAN DEFAULT true, creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS turnos (
        id VARCHAR(50) PRIMARY KEY, paciente VARCHAR(200) NOT NULL,
        fecha DATE NOT NULL, hora VARCHAR(20) NOT NULL, tipo VARCHAR(100),
        empresa VARCHAR(200), estado VARCHAR(50) DEFAULT 'pendiente',
        sala VARCHAR(200), link_paciente TEXT, link_medico TEXT,
        links_medicos JSONB, motivo TEXT, creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dictamenes (
        id SERIAL PRIMARY KEY, numero VARCHAR(20) NOT NULL,
        turno_id VARCHAR(50) REFERENCES turnos(id), paciente VARCHAR(200),
        medico VARCHAR(200), empresa VARCHAR(200), fecha_consulta DATE,
        hora_inicio VARCHAR(100), duracion VARCHAR(100), diagnostico VARCHAR(100),
        diagnostico_desc VARCHAR(500), aptitud VARCHAR(50), dias_reposo INTEGER DEFAULT 0,
        derivacion VARCHAR(200), indicaciones TEXT, sala VARCHAR(200),
        paciente_dni VARCHAR(50), edad VARCHAR(20), obra_social VARCHAR(200),
        profesion VARCHAR(200), antecedentes TEXT, hallazgos TEXT, conclusion TEXT,
        matricula VARCHAR(100), especialidad VARCHAR(200), creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS turno_medicos (
        turno_id VARCHAR(50) REFERENCES turnos(id),
        medico_nombre VARCHAR(200), PRIMARY KEY (turno_id, medico_nombre)
      );
      CREATE TABLE IF NOT EXISTS eventos_turno (
        id SERIAL PRIMARY KEY, turno_id VARCHAR(50) REFERENCES turnos(id),
        tipo VARCHAR(50) NOT NULL, participante VARCHAR(200), creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS firmas_dictamen (
        id SERIAL PRIMARY KEY,
        dictamen_id INTEGER REFERENCES dictamenes(id),
        medico_nombre VARCHAR(200) NOT NULL,
        matricula VARCHAR(100),
        especialidad VARCHAR(200),
        firma_base64 TEXT,
        hash_contenido VARCHAR(100),
        ip VARCHAR(100),
        firmado_en TIMESTAMP DEFAULT NOW(),
        UNIQUE (dictamen_id, medico_nombre)
      );
      CREATE TABLE IF NOT EXISTS empresas_clientes (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(200) UNIQUE NOT NULL,
        email VARCHAR(200) UNIQUE NOT NULL,
        password_hash VARCHAR(200) NOT NULL,
        contacto VARCHAR(200),
        activo BOOLEAN DEFAULT true,
        creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS pacientes_empresa (
        id SERIAL PRIMARY KEY,
        empresa VARCHAR(200) NOT NULL,
        nombre VARCHAR(200) NOT NULL,
        telefono VARCHAR(50),
        activo BOOLEAN DEFAULT true,
        creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS reset_tokens (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(20) NOT NULL,
        email VARCHAR(200) NOT NULL,
        token VARCHAR(100) UNIQUE NOT NULL,
        expira_en TIMESTAMP NOT NULL,
        usado BOOLEAN DEFAULT false,
        creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS servicios_catalogo (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(200) NOT NULL,
        precio NUMERIC(12,2) DEFAULT 0,
        activo BOOLEAN DEFAULT true,
        creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS presupuestos (
        id SERIAL PRIMARY KEY,
        numero VARCHAR(20) NOT NULL,
        empresa VARCHAR(200) NOT NULL,
        contacto VARCHAR(200),
        fecha DATE NOT NULL DEFAULT CURRENT_DATE,
        validez_dias INTEGER DEFAULT 15,
        items JSONB NOT NULL DEFAULT '[]',
        subtotal NUMERIC(12,2) DEFAULT 0,
        total NUMERIC(12,2) DEFAULT 0,
        notas TEXT,
        estado VARCHAR(20) DEFAULT 'enviado',
        creado_por VARCHAR(200),
        creado_en TIMESTAMP DEFAULT NOW()
      );
    `);

    const adminHash = hashPassword('medgrup2026');
    const barbozaHash = hashPassword('barboza2026');
    const muroniHash = hashPassword('muroni2026');
    await client.query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
        ('Administrador','adm.medgrup@gmail.com',$1,'admin'),
        ('Dr. Barboza, Raúl','barboza@medgrup.com',$2,'medico'),
        ('Dr. Muroni, Esteban','muroni@medgrup.com',$3,'medico')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash, barbozaHash, muroniHash]);

    await client.query(`
      INSERT INTO medicos (nombre, matricula, especialidad)
      SELECT 'Dr. Barboza, Raúl','MN 102128 / MP 603','Psiquiatra Forense y Médico del Trabajo'
      WHERE NOT EXISTS (SELECT 1 FROM medicos WHERE nombre='Dr. Barboza, Raúl');
      INSERT INTO medicos (nombre, matricula, especialidad)
      SELECT 'Dr. Muroni, Esteban','MP 5558','Medicina Laboral'
      WHERE NOT EXISTS (SELECT 1 FROM medicos WHERE nombre='Dr. Muroni, Esteban');
    `);
    await client.query(`UPDATE medicos SET matricula='MP 5558' WHERE nombre='Dr. Muroni, Esteban' AND (matricula IS NULL OR matricula='')`).catch(()=>{});
    // Fix matrículas correctas si fueron cargadas mal inicialmente
    await client.query(`UPDATE medicos SET matricula='MN 102128 / MP 603', especialidad='Psiquiatra Forense y Médico del Trabajo' WHERE nombre='Dr. Barboza, Raúl' AND matricula='MP 12.847'`).catch(()=>{});

    // Columnas extendidas para informe IA (estructura 6 secciones)
    for (const q2 of [
      `ALTER TABLE IF EXISTS turnos ADD COLUMN IF NOT EXISTS diagnostico_previo TEXT`,
      `ALTER TABLE IF EXISTS turnos ADD COLUMN IF NOT EXISTS dias_reposo_previo INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS turnos ADD COLUMN IF NOT EXISTS medico_tratante VARCHAR(300)`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS apellido_nombre VARCHAR(300)`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS fecha_nacimiento VARCHAR(50)`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS lugar_nacimiento VARCHAR(200)`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS estado_civil VARCHAR(200)`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS estudios VARCHAR(200)`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS puesto VARCHAR(200)`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS antiguedad VARCHAR(100)`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS situacion_licencia TEXT`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS metodologia TEXT`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS analisis TEXT`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS diagnostico_cie VARCHAR(200)`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS firma_doctor TEXT`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS informe_completo TEXT`,
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS aptitud_texto VARCHAR(500)`,
      `ALTER TABLE IF EXISTS turnos ADD COLUMN IF NOT EXISTS telefono VARCHAR(50)`,
      `ALTER TABLE IF EXISTS medicos ADD COLUMN IF NOT EXISTS telefono VARCHAR(50)`,
    ]) await client.query(q2).catch(()=>{});

    // Fix columnas
    for (const q of [
      `ALTER TABLE IF EXISTS dictamenes ALTER COLUMN hora_inicio TYPE VARCHAR(100)`,
      `ALTER TABLE IF EXISTS dictamenes ALTER COLUMN duracion TYPE VARCHAR(100)`,
      `ALTER TABLE IF EXISTS dictamenes ALTER COLUMN derivacion TYPE VARCHAR(200)`,
      `ALTER TABLE IF EXISTS turnos ALTER COLUMN hora TYPE VARCHAR(20)`,
    ]) await client.query(q).catch(()=>{});

    console.log('✓ Base de datos lista');
  } catch (err) { console.error('Error DB:', err.message); } finally { client.release(); }
}

// ===== AUTH MEDGRUP =====
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE LOWER(email)=LOWER($1) AND password_hash=$2 AND activo=true', [email.trim(), hashPassword(password.trim())]);
    if (!r.rows.length) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const u = r.rows[0];
    const token = generateToken();
    sessions[token] = { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol };
    res.json({ ok: true, token, usuario: { nombre: u.nombre, email: u.email, rol: u.rol } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/logout', (req, res) => { const t = req.headers['x-session-token']; if (t) delete sessions[t]; res.json({ ok: true }); });
app.get('/api/me', authMiddleware, (req, res) => res.json({ ok: true, usuario: req.usuario }));

// ===== AUTH EMPRESAS =====
app.post('/api/empresa/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });
  try {
    const r = await pool.query('SELECT * FROM empresas_clientes WHERE LOWER(email)=LOWER($1) AND password_hash=$2 AND activo=true', [email.trim(), hashPassword(password.trim())]);
    if (!r.rows.length) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const e = r.rows[0];
    const token = generateToken();
    empresaSessions[token] = { id: e.id, nombre: e.nombre, email: e.email };
    res.json({ ok: true, token, empresa: { nombre: e.nombre, email: e.email } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/empresa/logout', (req, res) => { const t = req.headers['x-empresa-token']; if (t) delete empresaSessions[t]; res.json({ ok: true }); });

// ===== RECUPERAR CONTRASEÑA (médicos/admin y empresas comparten la misma tabla de tokens) =====
function baseUrlApp() {
  return process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:' + PORT;
}

async function iniciarResetPassword(tipo, tabla, email) {
  const r = await pool.query(`SELECT nombre, email FROM ${tabla} WHERE LOWER(email)=LOWER($1) AND activo=true`, [email.trim()]);
  if (!r.rows.length) return; // no revelamos si el email existe o no
  const u = r.rows[0];
  const token = generateToken();
  const expira = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
  await pool.query('INSERT INTO reset_tokens (tipo,email,token,expira_en) VALUES ($1,$2,$3,$4)', [tipo, u.email, token, expira]);
  const link = `${baseUrlApp()}/?reset_token=${token}`;
  await enviarEmail(u.email, 'Recuperar contraseña — MEDGRUP', `
    <div style="font-family:sans-serif;color:#1a2433;">
      <p>Hola ${u.nombre},</p>
      <p>Recibimos un pedido para restablecer tu contraseña en MEDGRUP. Hacé clic en el siguiente link para elegir una nueva (válido por 1 hora):</p>
      <p><a href="${link}" style="background:#3a6ea8;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Elegir nueva contraseña</a></p>
      <p style="font-size:12px;color:#5a6575;">Si no fuiste vos, ignorá este email — tu contraseña actual sigue funcionando.</p>
    </div>`);
}

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Falta el email' });
  try { await iniciarResetPassword('usuario', 'usuarios', email); }
  catch (err) { console.error('Error en forgot-password:', err.message); }
  res.json({ ok: true, mensaje: 'Si el email existe en nuestro sistema, te enviamos un link para recuperar tu contraseña.' });
});

app.post('/api/empresa/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Falta el email' });
  try { await iniciarResetPassword('empresa', 'empresas_clientes', email); }
  catch (err) { console.error('Error en empresa/forgot-password:', err.message); }
  res.json({ ok: true, mensaje: 'Si el email existe en nuestro sistema, te enviamos un link para recuperar tu contraseña.' });
});

app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 6) return res.status(400).json({ error: 'Completá una contraseña de al menos 6 caracteres' });
  try {
    const r = await pool.query(`SELECT * FROM reset_tokens WHERE token=$1 AND usado=false AND expira_en > NOW()`, [token]);
    if (!r.rows.length) return res.status(400).json({ error: 'El link expiró o ya fue usado. Pedí uno nuevo.' });
    const row = r.rows[0];
    const tabla = row.tipo === 'empresa' ? 'empresas_clientes' : 'usuarios';
    await pool.query(`UPDATE ${tabla} SET password_hash=$1 WHERE LOWER(email)=LOWER($2)`, [hashPassword(password), row.email]);
    await pool.query('UPDATE reset_tokens SET usado=true WHERE id=$1', [row.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Turnos de la empresa (por nombre que ya está en el campo empresa del turno)
app.get('/api/empresa/mis-turnos', empresaAuthMiddleware, async (req, res) => {
  try {
    const nombre = req.empresa.nombre;
    const r = await pool.query(`
      SELECT t.*,
        COALESCE(array_agg(tm.medico_nombre) FILTER (WHERE tm.medico_nombre IS NOT NULL), '{}') as medicos,
        (SELECT json_agg(d.*) FROM dictamenes d WHERE d.turno_id=t.id) as dictamenes_data
      FROM turnos t
      LEFT JOIN turno_medicos tm ON t.id=tm.turno_id
      WHERE t.empresa=$1
      GROUP BY t.id
      ORDER BY t.fecha DESC, t.hora DESC
    `, [nombre]);
    res.json({ ok: true, turnos: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lista simple de nombres de empresas activas (para selects, accesible a cualquier usuario logueado)
app.get('/api/empresas-nombres', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT nombre FROM empresas_clientes WHERE activo=true ORDER BY nombre');
    res.json({ ok: true, empresas: r.rows.map(x => x.nombre) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== PACIENTES / TRABAJADORES POR EMPRESA =====
// Lectura: cualquier usuario logueado (se usa para autocompletar al crear un turno).
// Escritura: solo admin.
app.get('/api/pacientes-empresa', authMiddleware, async (req, res) => {
  const empresa = (req.query.empresa || '').trim();
  if (!empresa) return res.status(400).json({ error: 'Falta la empresa' });
  try {
    const r = await pool.query('SELECT * FROM pacientes_empresa WHERE empresa=$1 AND activo=true ORDER BY nombre', [empresa]);
    res.json({ ok: true, pacientes: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/pacientes-empresa', adminMiddleware, async (req, res) => {
  const { empresa, nombre, telefono } = req.body;
  if (!empresa || !nombre) return res.status(400).json({ error: 'Empresa y nombre son obligatorios' });
  try {
    const r = await pool.query(
      'INSERT INTO pacientes_empresa (empresa,nombre,telefono) VALUES ($1,$2,$3) RETURNING *',
      [empresa.trim(), nombre.trim(), (telefono||'').trim()]
    );
    res.json({ ok: true, paciente: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/admin/pacientes-empresa/:id', adminMiddleware, async (req, res) => {
  const { nombre, telefono } = req.body;
  try {
    await pool.query(
      'UPDATE pacientes_empresa SET nombre=COALESCE($1,nombre), telefono=COALESCE($2,telefono) WHERE id=$3',
      [nombre||null, telefono!==undefined?telefono:null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/pacientes-empresa/:id', adminMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE pacientes_empresa SET activo=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CATÁLOGO DE SERVICIOS (para armar presupuestos) =====
app.get('/api/servicios-catalogo', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM servicios_catalogo WHERE activo=true ORDER BY nombre');
    res.json({ ok: true, servicios: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin/servicios-catalogo', adminMiddleware, async (req, res) => {
  const { nombre, precio } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre del servicio' });
  try {
    const r = await pool.query('INSERT INTO servicios_catalogo (nombre,precio) VALUES ($1,$2) RETURNING *', [nombre.trim(), parseFloat(precio)||0]);
    res.json({ ok: true, servicio: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/admin/servicios-catalogo/:id', adminMiddleware, async (req, res) => {
  const { nombre, precio } = req.body;
  try {
    await pool.query('UPDATE servicios_catalogo SET nombre=COALESCE($1,nombre), precio=COALESCE($2,precio) WHERE id=$3', [nombre||null, precio!==undefined?parseFloat(precio):null, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/admin/servicios-catalogo/:id', adminMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE servicios_catalogo SET activo=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== PRESUPUESTOS =====
app.get('/api/presupuestos', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM presupuestos ORDER BY creado_en DESC');
    res.json({ ok: true, presupuestos: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/presupuestos/:id/datos', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM presupuestos WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true, presupuesto: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/presupuestos', authMiddleware, async (req, res) => {
  const { empresa, contacto, validez_dias, items, notas } = req.body;
  if (!empresa) return res.status(400).json({ error: 'Falta la empresa' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Agregá al menos un ítem' });
  try {
    const itemsCalc = items.map(it => {
      const cantidad = parseFloat(it.cantidad) || 0;
      const precio_unitario = parseFloat(it.precio_unitario) || 0;
      return { concepto: (it.concepto||'').trim(), cantidad, precio_unitario, subtotal: +(cantidad*precio_unitario).toFixed(2) };
    });
    const total = +itemsCalc.reduce((acc, it) => acc + it.subtotal, 0).toFixed(2);

    const count = await pool.query('SELECT COUNT(*) FROM presupuestos');
    const numero = `PRES-${new Date().getFullYear()}-` + String(parseInt(count.rows[0].count)+1).padStart(4,'0');

    const r = await pool.query(`INSERT INTO presupuestos
      (numero,empresa,contacto,validez_dias,items,subtotal,total,notas,creado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [numero, empresa, contacto||'', parseInt(validez_dias)||15, JSON.stringify(itemsCalc), total, total, notas||'', req.usuario.nombre]);
    res.json({ ok: true, presupuesto: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/presupuestos/:id/estado', authMiddleware, async (req, res) => {
  const { estado } = req.body;
  if (!['enviado','aprobado','rechazado'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    await pool.query('UPDATE presupuestos SET estado=$1 WHERE id=$2', [estado, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/presupuestos/:id', adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM presupuestos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PDF del presupuesto (público, igual que los informes — para que se pueda mandar el link directo a la empresa)
app.get('/api/presupuestos/:id/pdf', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM presupuestos WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const p = r.rows[0];
    const items = Array.isArray(p.items) ? p.items : JSON.parse(p.items || '[]');
    const fechaEmision = new Date(p.fecha).toLocaleDateString('es-AR', { year:'numeric', month:'long', day:'numeric', timeZone:'America/Argentina/Buenos_Aires' });
    const fechaVencimiento = new Date(new Date(p.fecha).getTime() + p.validez_dias*24*60*60*1000).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', timeZone:'America/Argentina/Buenos_Aires' });
    const fmtMoneda = n => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 });
    const qrVerificacion = await generarQRDataUrl(p.numero);

    const filasHtml = items.map(it => `<tr>
      <td>${it.concepto}</td>
      <td style="text-align:center;">${it.cantidad}</td>
      <td style="text-align:right;">${fmtMoneda(it.precio_unitario)}</td>
      <td style="text-align:right;">${fmtMoneda(it.subtotal)}</td>
    </tr>`).join('');

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<title>Presupuesto ${p.numero}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'DM Sans',sans-serif;color:#1a1916;background:white;padding:38px 46px;font-size:12.5px;line-height:1.7;}
.header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #3a6ea8;margin-bottom:6px;}
.logo-img{height:40px;width:auto;object-fit:contain;}
.doc-ref{text-align:right;font-size:10.5px;color:#5a5750;line-height:1.7;}
.doc-numero{font-family:'DM Mono',sans-serif;font-size:12.5px;font-weight:600;color:#3a6ea8;}
.titulo-doc{margin:12px 0 4px;text-align:center;}
.titulo-doc h1{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#1a1916;}
.titulo-doc .subtitulo{font-size:11px;color:#5a5750;text-transform:uppercase;letter-spacing:0.3px;margin-top:2px;}
.destinatario{background:#f4f7fb;border-left:3px solid #3a6ea8;padding:8px 12px;margin:10px 0 16px;font-size:11.5px;}
.destinatario strong{color:#2a5080;}
table.items{width:100%;border-collapse:collapse;margin:14px 0;}
table.items th{background:#3a6ea8;color:white;font-size:10.5px;text-transform:uppercase;letter-spacing:0.3px;padding:8px 10px;text-align:left;}
table.items th:nth-child(2),table.items th:nth-child(3),table.items th:nth-child(4){text-align:right;}
table.items th:nth-child(2){text-align:center;}
table.items td{padding:8px 10px;border-bottom:1px solid #e8e4de;font-size:12px;}
.total-row{display:flex;justify-content:flex-end;margin-top:10px;}
.total-box{background:#f4f7fb;border:1.5px solid #3a6ea8;border-radius:8px;padding:10px 20px;text-align:right;min-width:220px;}
.total-label{font-size:10.5px;color:#5a5750;text-transform:uppercase;letter-spacing:0.5px;}
.total-val{font-size:19px;font-weight:700;color:#3a6ea8;}
.validez-box{margin-top:16px;background:#fdf5e8;border:1px solid #e8c988;border-radius:8px;padding:10px 14px;font-size:11.5px;color:#8f5000;}
.notas{margin-top:14px;font-size:11.5px;color:#5a5750;white-space:pre-wrap;}
.firmas-row{display:flex;gap:30px;flex-wrap:wrap;margin-top:50px;padding-top:16px;border-top:1.5px solid #e8e4de;}
.firma-item{text-align:center;flex:1;min-width:160px;}
.firma-linea{width:160px;border-bottom:1.5px solid #1a1916;margin:0 auto 6px;height:28px;}
.firma-nombre{font-size:11.5px;font-weight:700;}
.wm{margin-top:20px;text-align:center;font-size:9px;color:#c8c4be;font-family:'DM Mono',sans-serif;border-top:1px solid #eee;padding-top:8px;}
@media print{body{padding:20px 28px;}table.items th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>

<div class="header">
  <div style="display:flex;align-items:center;gap:11px;">
    <img src="/logo.png" alt="MEDGRUP" class="logo-img"/>
    <div>
      <div style="font-size:17px;font-weight:700;color:#3a6ea8;letter-spacing:-0.3px;">MEDGRUP</div>
      <div style="font-size:9px;color:#c0365a;letter-spacing:1.2px;text-transform:uppercase;font-family:'DM Mono',sans-serif;">Servicio Médico Laboral Integral</div>
    </div>
  </div>
  <div style="display:flex;align-items:flex-start;gap:12px;">
    <div class="doc-ref">
      <div class="doc-numero">${p.numero}</div>
      <div>Tierra del Fuego, ${fechaEmision}</div>
    </div>
    ${qrVerificacion ? `<div style="text-align:center;flex-shrink:0;"><img src="${qrVerificacion}" alt="QR de verificación" style="width:56px;height:56px;"/><div style="font-size:6.5px;color:#9a9790;font-family:'DM Mono',sans-serif;margin-top:2px;">Verificar</div></div>` : ''}
  </div>
</div>

<div class="titulo-doc">
  <h1>Presupuesto de Servicios</h1>
  <div class="subtitulo">Medicina del Trabajo · Psiquiatría Forense</div>
</div>

<div class="destinatario">
  <strong>Para:</strong> ${p.empresa}${p.contacto ? ' — At.: '+p.contacto : ''}<br/>
  <strong>N° de presupuesto:</strong> ${p.numero}
</div>

<table class="items">
  <thead><tr><th>Concepto</th><th>Cant.</th><th>Precio unitario</th><th>Subtotal</th></tr></thead>
  <tbody>${filasHtml}</tbody>
</table>

<div class="total-row">
  <div class="total-box">
    <div class="total-label">Total</div>
    <div class="total-val">${fmtMoneda(p.total)}</div>
  </div>
</div>

<div class="validez-box">⏳ Presupuesto válido hasta el ${fechaVencimiento} (${p.validez_dias} días desde su emisión).</div>
${p.notas ? `<div class="notas">${p.notas}</div>` : ''}

<div class="firmas-row">
  <div class="firma-item"><div class="firma-linea"></div><div class="firma-nombre">MEDGRUP Servicio Médico</div></div>
</div>

<div class="wm">MEDGRUP Servicio Médico Laboral · Presupuesto · ${p.numero} · medgruplaboral.com.ar</div>
<script>window.onload=function(){window.print();}</script>
</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CRUD EMPRESAS (solo admin) =====
app.get('/api/admin/empresas', adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,nombre,email,contacto,activo,creado_en FROM empresas_clientes ORDER BY nombre');
    res.json({ ok: true, empresas: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/empresas', adminMiddleware, async (req, res) => {
  const { nombre, email, password, contacto } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
  try {
    const r = await pool.query(
      'INSERT INTO empresas_clientes (nombre,email,password_hash,contacto) VALUES ($1,$2,$3,$4) RETURNING id,nombre,email,contacto,creado_en',
      [nombre.trim(), email.trim().toLowerCase(), hashPassword(password.trim()), contacto||'']
    );
    res.json({ ok: true, empresa: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una empresa con ese nombre o email' });
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/empresas/:id', adminMiddleware, async (req, res) => {
  const { password, contacto, activo } = req.body;
  try {
    if (password) await pool.query('UPDATE empresas_clientes SET password_hash=$1 WHERE id=$2', [hashPassword(password), req.params.id]);
    if (contacto !== undefined) await pool.query('UPDATE empresas_clientes SET contacto=$1 WHERE id=$2', [contacto, req.params.id]);
    if (activo !== undefined) await pool.query('UPDATE empresas_clientes SET activo=$1 WHERE id=$2', [activo, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/empresas/:id', adminMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE empresas_clientes SET activo=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== MÉDICOS =====
app.get('/api/medicos', authMiddleware, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM medicos WHERE activo=true ORDER BY id'); res.json(r.rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/medicos', authMiddleware, async (req, res) => {
  const { nombre, matricula, especialidad, email, password, telefono } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const r = await pool.query('INSERT INTO medicos (nombre,matricula,especialidad,telefono) VALUES ($1,$2,$3,$4) RETURNING *', [nombre, matricula||'', especialidad||'Medicina Laboral', telefono||'']);
    // Si mandaron email + password, crear también el usuario para que el médico
    // pueda loguearse y firmar juntas médicas
    let accesoCreado = false;
    if (email && password) {
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      await pool.query(
        `INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ($1,$2,$3,'medico')
         ON CONFLICT (email) DO UPDATE SET nombre=$1, password_hash=$3`,
        [nombre, email.toLowerCase().trim(), hash]);
      accesoCreado = true;
    }
    res.json({ ok: true, medico: r.rows[0], accesoCreado });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== FIRMA EXPRESS PARA JUNTAS MÉDICAS =====

// Hash del contenido del dictamen al momento de firmar (integridad / trazabilidad)
function hashDictamen(d){
  const contenido = JSON.stringify({
    numero: d.numero, paciente: d.paciente, apellido_nombre: d.apellido_nombre,
    antecedentes: d.antecedentes, hallazgos: d.hallazgos, analisis: d.analisis,
    conclusion: d.conclusion, aptitud: d.aptitud, dias_reposo: d.dias_reposo,
    diagnostico_cie: d.diagnostico_cie, indicaciones: d.indicaciones
  });
  return crypto.createHash('sha256').update(contenido).digest('hex');
}

// Dictámenes que el médico logueado tiene pendientes de firma:
// - está asignado al turno (turno_medicos)
// - NO es el autor del dictamen
// - todavía no firmó
app.get('/api/firmas/pendientes', authMiddleware, async (req, res) => {
  try {
    const nombre = req.usuario.nombre;
    const r = await pool.query(`
      SELECT d.id, d.numero, d.paciente, d.apellido_nombre, d.empresa, d.medico AS autor,
             d.conclusion, d.aptitud, d.dias_reposo, d.diagnostico_cie, d.creado_en,
             t.fecha, t.hora, t.tipo
      FROM dictamenes d
      JOIN turnos t ON d.turno_id = t.id
      JOIN turno_medicos tm ON tm.turno_id = t.id
      WHERE tm.medico_nombre = $1
        AND d.medico != $1
        AND NOT EXISTS (SELECT 1 FROM firmas_dictamen f WHERE f.dictamen_id = d.id AND f.medico_nombre = $1)
      ORDER BY d.creado_en DESC`, [nombre]);
    res.json({ ok: true, pendientes: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Firmar un dictamen (junta médica)
app.post('/api/dictamenes/:id/firmar', authMiddleware, async (req, res) => {
  try {
    const nombre = req.usuario.nombre;
    const { firma } = req.body;
    if (!firma) return res.status(400).json({ error: 'Falta la firma' });

    const dRes = await pool.query('SELECT * FROM dictamenes WHERE id=$1', [req.params.id]);
    if (!dRes.rows.length) return res.status(404).json({ error: 'Dictamen no encontrado' });
    const d = dRes.rows[0];

    // Verificar que el médico esté asignado al turno de este dictamen
    const asignado = await pool.query(
      'SELECT 1 FROM turno_medicos WHERE turno_id=$1 AND medico_nombre=$2', [d.turno_id, nombre]);
    if (!asignado.rows.length) return res.status(403).json({ error: 'No estás asignado a este turno' });

    // Evitar doble firma
    const yaFirmo = await pool.query(
      'SELECT 1 FROM firmas_dictamen WHERE dictamen_id=$1 AND medico_nombre=$2', [req.params.id, nombre]);
    if (yaFirmo.rows.length) return res.status(409).json({ error: 'Ya firmaste este dictamen' });

    // Tomar matrícula y especialidad del perfil del médico
    const perfil = await pool.query(
      'SELECT matricula, especialidad FROM medicos WHERE nombre=$1 AND activo=true LIMIT 1', [nombre]);
    const matricula = perfil.rows[0]?.matricula || '';
    const especialidad = perfil.rows[0]?.especialidad || 'Medicina Laboral';

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';

    await pool.query(`INSERT INTO firmas_dictamen
      (dictamen_id, medico_nombre, matricula, especialidad, firma_base64, hash_contenido, ip)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.params.id, nombre, matricula, especialidad, firma, hashDictamen(d), ip]);

    // ¿Cuántas firmas faltan? (médicos del turno excepto el autor)
    const faltan = await pool.query(`
      SELECT tm.medico_nombre FROM turno_medicos tm
      WHERE tm.turno_id = $1 AND tm.medico_nombre != $2
        AND NOT EXISTS (SELECT 1 FROM firmas_dictamen f WHERE f.dictamen_id = $3 AND f.medico_nombre = tm.medico_nombre)`,
      [d.turno_id, d.medico, req.params.id]);

    res.json({ ok: true, firmasFaltantes: faltan.rows.map(x=>x.medico_nombre) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/medicos/:id', authMiddleware, async (req, res) => {
  try { await pool.query('UPDATE medicos SET activo=false WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
// Editar médico (nombre, matrícula, especialidad)
app.patch('/api/medicos/:id', authMiddleware, async (req, res) => {
  const { nombre, matricula, especialidad, telefono } = req.body;
  try {
    await pool.query(`UPDATE medicos SET
      nombre=COALESCE($1,nombre), matricula=COALESCE($2,matricula), especialidad=COALESCE($3,especialidad), telefono=COALESCE($4,telefono)
      WHERE id=$5`, [nombre||null, matricula||null, especialidad||null, telefono!==undefined?telefono:null, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== TURNOS =====
app.get('/api/turnos', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT t.*, COALESCE(array_agg(tm.medico_nombre) FILTER (WHERE tm.medico_nombre IS NOT NULL),'{}') as medicos
      FROM turnos t LEFT JOIN turno_medicos tm ON t.id=tm.turno_id
      GROUP BY t.id ORDER BY t.fecha ASC, t.hora ASC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/turnos/:id/estado', authMiddleware, async (req, res) => {
  try { await pool.query('UPDATE turnos SET estado=$1 WHERE id=$2', [req.body.estado, req.params.id]); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== EDITAR TURNO (solo admin) =====
// Actualiza paciente, fecha, hora, tipo, empresa, motivo y la lista de médicos.
// La sala Daily y los links NO se tocan (se mantienen exactamente iguales).
app.patch('/api/turnos/:id', adminMiddleware, async (req, res) => {
  const { paciente, fecha, hora, tipo, empresa, motivo, medicos, diagnostico_previo, dias_reposo_previo, medico_tratante, telefono } = req.body;
  try {
    const chk = await pool.query('SELECT id FROM turnos WHERE id=$1', [req.params.id]);
    if (!chk.rows.length) return res.status(404).json({ error: 'Turno no encontrado' });

    await pool.query(`UPDATE turnos SET
      paciente = COALESCE($1, paciente),
      fecha    = COALESCE($2, fecha),
      hora     = COALESCE($3, hora),
      tipo     = COALESCE($4, tipo),
      empresa  = COALESCE($5, empresa),
      motivo   = COALESCE($6, motivo),
      diagnostico_previo = COALESCE($7, diagnostico_previo),
      dias_reposo_previo = COALESCE($8, dias_reposo_previo),
      medico_tratante    = COALESCE($9, medico_tratante),
      telefono           = COALESCE($10, telefono)
      WHERE id=$11`,
      [paciente || null, fecha || null, hora || null, tipo || null, empresa || null, motivo || null,
       diagnostico_previo !== undefined ? diagnostico_previo : null,
       dias_reposo_previo !== undefined ? (parseInt(dias_reposo_previo)||0) : null,
       medico_tratante !== undefined ? medico_tratante : null,
       telefono !== undefined ? telefono : null,
       req.params.id]);

    // Si vinieron médicos en el body, reemplazar la lista completa
    if (Array.isArray(medicos)) {
      await pool.query('DELETE FROM turno_medicos WHERE turno_id=$1', [req.params.id]);
      for (const m of medicos) {
        await pool.query(
          'INSERT INTO turno_medicos (turno_id,medico_nombre) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [req.params.id, m]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ELIMINAR TURNO (solo admin) =====
// Borra en cascada: eventos, dictámenes, médicos asignados y el turno.
// La sala Daily se deja intacta (expira sola por su exp property).
app.delete('/api/turnos/:id', adminMiddleware, async (req, res) => {
  try {
    const chk = await pool.query('SELECT paciente FROM turnos WHERE id=$1', [req.params.id]);
    if (!chk.rows.length) return res.status(404).json({ error: 'Turno no encontrado' });

    await pool.query('DELETE FROM eventos_turno WHERE turno_id=$1', [req.params.id]);
    await pool.query('DELETE FROM dictamenes    WHERE turno_id=$1', [req.params.id]);
    await pool.query('DELETE FROM turno_medicos WHERE turno_id=$1', [req.params.id]);
    await pool.query('DELETE FROM turnos        WHERE id=$1',       [req.params.id]);

    res.json({ ok: true, paciente: chk.rows[0].paciente });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CREAR SALA =====
app.post('/api/crear-sala', authMiddleware, async (req, res) => {
  try {
    const { paciente, medicos: ml, tipo, fecha, hora, empresa, motivo, diagnostico_previo, dias_reposo_previo, medico_tratante, telefono } = req.body;
    const nombreSala = `medgrup-${Date.now()}`;
    const resp = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DAILY_API_KEY}` },
      body: JSON.stringify({
        name: nombreSala,
        properties: {
          enable_recording: 'cloud',
          enable_chat: true,
          exp: Math.floor(Date.now()/1000)+(60*60*24*30),
          max_participants: 10,
          enable_prejoin_ui: false, // salta la pantalla que pide el nombre
          lang: 'es' // interfaz de la videollamada (botones, chat, config) en español
        }
      })
    });
    const sala = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: 'No se pudo crear la sala', detalle: sala });

    // Cada médico obtiene un link con su nombre precargado como owner
    const linksMedicos = (ml||[]).map(n => ({
      nombre: n,
      link: `${sala.url}?t=owner&userName=${encodeURIComponent(n)}`
    }));
    // El paciente obtiene un link con su nombre precargado como participante
    const linkPaciente = `${sala.url}?userName=${encodeURIComponent(paciente)}`;

    const turnoId = `turno-${Date.now()}`;
    await pool.query(`INSERT INTO turnos (id,paciente,fecha,hora,tipo,empresa,estado,sala,link_paciente,link_medico,links_medicos,motivo,diagnostico_previo,dias_reposo_previo,medico_tratante,telefono)
      VALUES ($1,$2,$3,$4,$5,$6,'pendiente',$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [turnoId, paciente, fecha||new Date().toISOString().split('T')[0], hora||'', tipo||'Consulta', empresa||'',
       sala.name, linkPaciente, sala.url+'?t=owner', JSON.stringify(linksMedicos), motivo||'',
       diagnostico_previo||'', parseInt(dias_reposo_previo)||0, medico_tratante||'', telefono||'']);
    for (const m of (ml||[])) await pool.query('INSERT INTO turno_medicos (turno_id,medico_nombre) VALUES ($1,$2) ON CONFLICT DO NOTHING', [turnoId, m]);
    res.json({ ok: true, sala: sala.name, url: sala.url, url_medico: sala.url+'?t=owner', links_medicos: linksMedicos, turno_id: turnoId, paciente });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CAMBIAR PASSWORD =====
app.post('/api/cambiar-password', authMiddleware, async (req, res) => {
  const { passwordActual, passwordNueva } = req.body;
  if (!passwordActual || !passwordNueva) return res.status(400).json({ error: 'Faltan datos' });
  if (passwordNueva.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });
  try {
    const u = await pool.query('SELECT * FROM usuarios WHERE id=$1 AND password_hash=$2', [req.usuario.id, hashPassword(passwordActual)]);
    if (!u.rows.length) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    await pool.query('UPDATE usuarios SET password_hash=$1 WHERE id=$2', [hashPassword(passwordNueva), req.usuario.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== EVENTOS =====
app.post('/api/turnos/:id/eventos', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO eventos_turno (turno_id,tipo,participante) VALUES ($1,$2,$3) RETURNING *', [req.params.id, req.body.tipo, req.body.participante||'']);
    res.json({ ok: true, evento: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/turnos/:id/eventos', authMiddleware, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM eventos_turno WHERE turno_id=$1 ORDER BY creado_en ASC', [req.params.id]); res.json({ ok: true, eventos: r.rows }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Editar hora/participante de un evento (solo admin)
app.patch('/api/eventos/:id', adminMiddleware, async (req, res) => {
  try {
    const { hora_arg, participante } = req.body;
    // hora_arg viene como "HH:MM:SS" en hora argentina — la convertimos a timestamp UTC para guardar
    if (hora_arg) {
      // Tomamos la fecha del evento original y le ponemos la hora argentina nueva
      const ev = await pool.query('SELECT creado_en FROM eventos_turno WHERE id=$1', [req.params.id]);
      if (!ev.rows.length) return res.status(404).json({ error: 'No encontrado' });
      const fechaOriginal = new Date(ev.rows[0].creado_en);
      // Fecha en Argentina (año/mes/día)
      const fechaARG = fechaOriginal.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }); // YYYY-MM-DD
      // Construir el nuevo timestamp combinando la fecha ARG con la hora ARG nueva
      const nuevoTimestamp = new Date(`${fechaARG}T${hora_arg}-03:00`); // -03:00 = Argentina
      await pool.query('UPDATE eventos_turno SET creado_en=$1 WHERE id=$2', [nuevoTimestamp.toISOString(), req.params.id]);
    }
    if (participante !== undefined) {
      await pool.query('UPDATE eventos_turno SET participante=$1 WHERE id=$2', [participante, req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eliminar un evento del acta (solo admin)
app.delete('/api/eventos/:id', adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM eventos_turno WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== DICTÁMENES =====
app.get('/api/dictamenes', authMiddleware, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM dictamenes ORDER BY creado_en DESC LIMIT 50'); res.json(r.rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/dictamenes/turno/:turnoId', authMiddleware, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM dictamenes WHERE turno_id=$1 ORDER BY creado_en DESC', [req.params.turnoId]); res.json({ ok: true, dictamenes: r.rows }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/dictamenes/turno/:turnoId/medico', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM dictamenes WHERE turno_id=$1 AND medico=$2 ORDER BY creado_en DESC LIMIT 1', [req.params.turnoId, req.query.medico||'']);
    res.json({ ok: !r.rows.length?false:true, dictamen: r.rows[0]||null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/dictamenes', authMiddleware, async (req, res) => {
  try {
    const { turno_id,paciente,medico,empresa,fecha_consulta,hora_inicio,duracion,paciente_dni,edad,obra_social,profesion,antecedentes,hallazgos,conclusion,aptitud,dias_reposo,derivacion,indicaciones,sala,matricula,especialidad,
      apellido_nombre,fecha_nacimiento,lugar_nacimiento,estado_civil,estudios,puesto,antiguedad,situacion_licencia,metodologia,analisis,diagnostico_cie } = req.body;
    const count = await pool.query('SELECT COUNT(*) FROM dictamenes');
    const numero = 'DICT-2026-' + String(parseInt(count.rows[0].count)+1).padStart(4,'0');
    const r = await pool.query(`INSERT INTO dictamenes
      (numero,turno_id,paciente,medico,empresa,fecha_consulta,hora_inicio,duracion,aptitud,dias_reposo,derivacion,indicaciones,sala,
       paciente_dni,edad,obra_social,profesion,antecedentes,hallazgos,conclusion,matricula,especialidad,
       apellido_nombre,fecha_nacimiento,lugar_nacimiento,estado_civil,estudios,puesto,antiguedad,situacion_licencia,metodologia,analisis,diagnostico_cie)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33) RETURNING *`,
      [numero,turno_id,paciente,medico,empresa,fecha_consulta,hora_inicio,duracion,aptitud,dias_reposo||0,
       derivacion||'Sin derivación',indicaciones||'',sala||'',paciente_dni||'',edad||'',obra_social||'',profesion||'',
       antecedentes||'',hallazgos||'',conclusion||'',matricula||'',especialidad||'Medicina Laboral',
       apellido_nombre||'',fecha_nacimiento||'',lugar_nacimiento||'',estado_civil||'',estudios||'',
       puesto||'',antiguedad||'',situacion_licencia||'',metodologia||'',analisis||'',diagnostico_cie||'']);
    res.json({ ok: true, dictamen: r.rows[0], numero });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/dictamenes/:id', authMiddleware, async (req, res) => {
  try {
    const chk = await pool.query('SELECT creado_en FROM dictamenes WHERE id=$1', [req.params.id]);
    if (!chk.rows.length) return res.status(404).json({ error: 'No encontrado' });

    // Admin puede editar sin límite de tiempo. Médico solo dentro de las primeras 5 horas.
    const esAdmin = req.usuario.rol === 'admin';
    const horasPasadas = (Date.now()-new Date(chk.rows[0].creado_en).getTime())/(1000*60*60);
    if (!esAdmin && horasPasadas > 5) return res.status(403).json({ error: 'No editable: pasaron más de 5 horas' });

    const {
      aptitud, dias_reposo, derivacion, indicaciones,
      paciente_dni, edad, obra_social, profesion,
      antecedentes, hallazgos, conclusion,
      apellido_nombre, fecha_nacimiento, lugar_nacimiento, estado_civil,
      estudios, puesto, antiguedad, situacion_licencia,
      metodologia, analisis, diagnostico_cie,
      // Campos extra editables solo por admin
      medico, matricula, especialidad, paciente, empresa
    } = req.body;

    if (esAdmin) {
      // Admin: actualiza todos los campos incluidos médico, matrícula, especialidad, nombre paciente
      await pool.query(`UPDATE dictamenes SET
        aptitud=COALESCE($1,aptitud), dias_reposo=COALESCE($2,dias_reposo),
        derivacion=COALESCE($3,derivacion), indicaciones=COALESCE($4,indicaciones),
        paciente_dni=COALESCE($5,paciente_dni), edad=COALESCE($6,edad),
        obra_social=COALESCE($7,obra_social), profesion=COALESCE($8,profesion),
        antecedentes=COALESCE($9,antecedentes), hallazgos=COALESCE($10,hallazgos),
        conclusion=COALESCE($11,conclusion),
        apellido_nombre=COALESCE($12,apellido_nombre), fecha_nacimiento=COALESCE($13,fecha_nacimiento),
        lugar_nacimiento=COALESCE($14,lugar_nacimiento), estado_civil=COALESCE($15,estado_civil),
        estudios=COALESCE($16,estudios), puesto=COALESCE($17,puesto),
        antiguedad=COALESCE($18,antiguedad), situacion_licencia=COALESCE($19,situacion_licencia),
        metodologia=COALESCE($20,metodologia), analisis=COALESCE($21,analisis),
        diagnostico_cie=COALESCE($22,diagnostico_cie),
        medico=COALESCE($23,medico), matricula=COALESCE($24,matricula),
        especialidad=COALESCE($25,especialidad), paciente=COALESCE($26,paciente),
        empresa=COALESCE($27,empresa)
        WHERE id=$28`,
        [aptitud, dias_reposo, derivacion, indicaciones, paciente_dni, edad,
         obra_social, profesion, antecedentes, hallazgos, conclusion,
         apellido_nombre, fecha_nacimiento, lugar_nacimiento, estado_civil,
         estudios, puesto, antiguedad, situacion_licencia, metodologia, analisis, diagnostico_cie,
         medico||null, matricula||null, especialidad||null, paciente||null, empresa||null,
         req.params.id]);
    } else {
      await pool.query(`UPDATE dictamenes SET
        aptitud=COALESCE($1,aptitud), dias_reposo=COALESCE($2,dias_reposo),
        derivacion=COALESCE($3,derivacion), indicaciones=COALESCE($4,indicaciones),
        paciente_dni=COALESCE($5,paciente_dni), edad=COALESCE($6,edad),
        obra_social=COALESCE($7,obra_social), profesion=COALESCE($8,profesion),
        antecedentes=COALESCE($9,antecedentes), hallazgos=COALESCE($10,hallazgos),
        conclusion=COALESCE($11,conclusion),
        apellido_nombre=COALESCE($12,apellido_nombre), fecha_nacimiento=COALESCE($13,fecha_nacimiento),
        lugar_nacimiento=COALESCE($14,lugar_nacimiento), estado_civil=COALESCE($15,estado_civil),
        estudios=COALESCE($16,estudios), puesto=COALESCE($17,puesto),
        antiguedad=COALESCE($18,antiguedad), situacion_licencia=COALESCE($19,situacion_licencia),
        metodologia=COALESCE($20,metodologia), analisis=COALESCE($21,analisis),
        diagnostico_cie=COALESCE($22,diagnostico_cie)
        WHERE id=$23`,
        [aptitud, dias_reposo, derivacion, indicaciones, paciente_dni, edad,
         obra_social, profesion, antecedentes, hallazgos, conclusion,
         apellido_nombre, fecha_nacimiento, lugar_nacimiento, estado_civil,
         estudios, puesto, antiguedad, situacion_licencia, metodologia, analisis, diagnostico_cie,
         req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Traer un dictamen individual por id (para el modal de edición admin)
app.get('/api/dictamenes/:id/datos', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM dictamenes WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true, dictamen: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== VERIFICACIÓN PÚBLICA DE DOCUMENTOS (QR en los PDFs) =====
// No expone datos médicos ni el paciente — solo confirma autenticidad, emisor y destinatario.
app.get('/verificar/:numero', async (req, res) => {
  const numero = req.params.numero;
  try {
    let info = null;
    if (numero.startsWith('DICT-')) {
      const r = await pool.query('SELECT numero, medico, empresa, especialidad, matricula, creado_en FROM dictamenes WHERE numero=$1', [numero]);
      if (r.rows.length) {
        const d = r.rows[0];
        info = {
          tipo: 'Informe médico-laboral',
          emitidoPor: d.medico + (d.especialidad ? ' — ' + d.especialidad : '') + (d.matricula ? ' (MN/MP ' + d.matricula + ')' : ''),
          empresa: d.empresa,
          fecha: d.creado_en
        };
      }
    } else if (numero.startsWith('PRES-')) {
      const r = await pool.query('SELECT numero, empresa, creado_en FROM presupuestos WHERE numero=$1', [numero]);
      if (r.rows.length) {
        const p = r.rows[0];
        info = { tipo: 'Presupuesto de servicios', emitidoPor: 'MEDGRUP Servicio Médico', empresa: p.empresa, fecha: p.creado_en };
      }
    }
    const fechaFmt = info ? new Date(info.fecha).toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric', timeZone:'America/Argentina/Buenos_Aires' }) : '';
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Verificación de documento — MEDGRUP</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'DM Sans',sans-serif;background:#eef3f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
.card{background:white;border-radius:20px;padding:2.5rem;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(42,80,128,0.15);text-align:center;}
.logo{height:44px;margin-bottom:1.5rem;}
.icono{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;}
.icono.ok{background:#eaf5f0;}
.icono.error{background:#fdf0f0;}
h1{font-size:18px;margin-bottom:8px;}
h1.ok{color:#1e6640;}
h1.error{color:#b02a2a;}
.numero{font-family:'DM Mono',monospace;font-size:13px;color:#3a6ea8;background:#f4f7fb;padding:4px 12px;border-radius:20px;display:inline-block;margin-bottom:1.25rem;}
.datos{text-align:left;background:#f4f7fb;border-radius:12px;padding:16px 18px;font-size:13.5px;line-height:1.5;color:#1a2433;}
.datos > div{margin-bottom:10px;}
.datos > div:last-child{margin-bottom:0;}
.datos strong{color:#5a6575;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;display:block;margin-bottom:2px;}
.footer{margin-top:1.75rem;font-size:11px;color:#97a3b4;}
</style></head><body>
<div class="card">
  <img src="/logo.png" alt="MEDGRUP" class="logo"/>
  ${info ? `
    <div class="icono ok"><svg viewBox="0 0 24 24" fill="none" stroke="#1e6640" stroke-width="2" width="30" height="30"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg></div>
    <h1 class="ok">Documento auténtico</h1>
    <div class="numero">${numero}</div>
    <div class="datos">
      <div><strong>Tipo de documento</strong>${info.tipo}</div>
      <div><strong>Emitido por</strong>${info.emitidoPor}</div>
      <div><strong>Para</strong>${info.empresa}</div>
      <div><strong>Fecha de emisión</strong>${fechaFmt}</div>
    </div>
  ` : `
    <div class="icono error"><svg viewBox="0 0 24 24" fill="none" stroke="#b02a2a" stroke-width="2" width="30" height="30"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
    <h1 class="error">Documento no encontrado</h1>
    <div style="font-size:13.5px;color:#5a6575;">El número <strong>${numero}</strong> no corresponde a ningún documento emitido por MEDGRUP, o fue dado de baja.</div>
  `}
  <div class="footer">MEDGRUP Servicio Médico Laboral · Verificación de autenticidad</div>
</div>
</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) { res.status(500).send('Error interno del servidor'); }
});

// ===== PDF INFORME =====
app.get('/api/dictamenes/:id/pdf', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM dictamenes WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const d = r.rows[0];
    const otros = d.turno_id ? (await pool.query('SELECT * FROM dictamenes WHERE turno_id=$1 AND id!=$2 ORDER BY creado_en ASC', [d.turno_id, d.id])).rows : [];
    const todos = [d, ...otros];

    // Firmas de junta médica (médicos que firmaron este dictamen desde su propia sesión)
    const firmasJunta = (await pool.query(
      'SELECT * FROM firmas_dictamen WHERE dictamen_id=$1 ORDER BY firmado_en ASC', [d.id])).rows;

    const fechaEmision = new Date(d.creado_en).toLocaleDateString('es-AR', { year:'numeric',month:'long',day:'numeric',timeZone:'America/Argentina/Buenos_Aires' });
    const fechaConsulta = d.fecha_consulta ? new Date(d.fecha_consulta).toLocaleDateString('es-AR', { day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Argentina/Buenos_Aires' }) : '—';
    const qrVerificacion = await generarQRDataUrl(d.numero);
    const aptitudMap = { apto:'Aptitud Laboral Total', restricc:'Apto con restricciones', 'no-apto':'No apto / Reposo indicado' };
    const integrantesHtml = todos.map(m => `<li style="margin-bottom:6px;"><strong>${m.medico}</strong>${m.especialidad?': '+m.especialidad:''}${m.matricula?' (MN/MP: '+m.matricula+')':''} — Evaluación remota vía MEDGRUP Telemedicina.</li>`).join('');

    // Bloque de firmas: autor + otros dictámenes + firmas de junta (sin duplicar)
    const firmantesRender = [];
    for (const m of todos) {
      const esAutor = m.medico === d.medico;
      firmantesRender.push({
        nombre: m.medico,
        especialidad: m.especialidad || 'Medicina Laboral',
        matricula: m.matricula || '',
        img: (esAutor && d.firma_doctor) ? d.firma_doctor : (m.firma_doctor || null)
      });
    }
    for (const f of firmasJunta) {
      if (!firmantesRender.some(x => x.nombre === f.medico_nombre)) {
        firmantesRender.push({
          nombre: f.medico_nombre,
          especialidad: f.especialidad || 'Medicina Laboral',
          matricula: f.matricula || '',
          img: f.firma_base64 || null
        });
      } else {
        // Ya está en la lista (p.ej. médico del turno sin dictamen propio): asignarle su firma
        const idx = firmantesRender.findIndex(x => x.nombre === f.medico_nombre);
        if (idx >= 0 && !firmantesRender[idx].img) firmantesRender[idx].img = f.firma_base64 || null;
      }
    }

    const firmasHtml = firmantesRender.map(m => {
      const firmaImg = m.img
        ? `<img src="data:image/png;base64,${m.img}" alt="firma" style="max-width:170px;max-height:52px;object-fit:contain;margin-bottom:2px;"/>`
        : `<div style="width:170px;border-bottom:1.5px solid #1a1916;margin:0 auto 6px;height:30px;"></div>`;
      return `<div style="text-align:center;flex:1;min-width:180px;">${firmaImg}<div style="font-size:12px;font-weight:600;">${m.nombre}</div><div style="font-size:10px;color:#5a5750;">${m.especialidad}</div><div style="font-size:9.5px;color:#9a9790;">${m.matricula?'MN/MP '+m.matricula:''}</div></div>`;
    }).join('');

    // Trazabilidad de firmas de junta para el pie del documento
    const trazaFirmasHtml = firmasJunta.length
      ? `<div style="margin-top:6px;font-family:'DM Mono',monospace;font-size:8px;color:#9a9790;text-align:right;">` +
        firmasJunta.map(f => {
          const fh = new Date(f.firmado_en).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Buenos_Aires'});
          return `Firmado electrónicamente por ${f.medico_nombre} el ${fh} hs · hash ${String(f.hash_contenido).substring(0,12)}`;
        }).join('<br/>') + `</div>`
      : '';
    const aptColor = d.aptitud==='apto'?'#1e6640':d.aptitud==='restricc'?'#8f5000':'#b02a2a';
    const aptBg = d.aptitud==='apto'?'#eaf5f0':d.aptitud==='restricc'?'#fdf5e8':'#fdf0f0';
    const aptBorder = d.aptitud==='apto'?'#1e6640':d.aptitud==='restricc'?'#8f5000':'#b02a2a';

    // Determinar tipo de informe según el turno
    let turnoInfo = null;
    if (d.turno_id) {
      const tr = await pool.query('SELECT tipo FROM turnos WHERE id=$1', [d.turno_id]);
      if (tr.rows.length) turnoInfo = tr.rows[0];
    }
    const tipoConsulta = turnoInfo?.tipo || 'Evaluación Médico-Laboral';

    // Datos extendidos (pueden venir de la IA o estar vacíos)
    const apellidoNombre = d.apellido_nombre || d.paciente?.toUpperCase() || '—';
    const fechaNac = d.fecha_nacimiento || '—';
    const lugarNac = d.lugar_nacimiento || '—';
    const estadoCivil = d.estado_civil || '—';
    const estudios = d.estudios || '—';
    const puesto = d.puesto || d.profesion || '—';
    const antiguedad = d.antiguedad || '—';
    const sitLicencia = d.situacion_licencia || '—';
    const metodologia = d.metodologia || `Se procedió a la realización de una evaluación pericial semiestructurada por vía telemática el día de la fecha, bajo estricto encuadre profesional. El abordaje comprendió el examen semiológico directo, el rastreo de psicodinamismos, el análisis de factores etiológicos y psicopatológicos preexistentes, así como la compulsa de la documentación médica obrante en el legajo.\n\nSe deja expresa constancia de que el presente dictamen se emite en el marco de la legislación vigente de Medicina del Trabajo, garantizando el resguardo y la protección de los datos personales del examinado.`;
    const analisis = d.analisis || '';
    const diagCIE = d.diagnostico_cie || '';

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<title>Informe ${d.numero}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'DM Sans',sans-serif;color:#1a1916;background:white;padding:38px 46px;font-size:12.5px;line-height:1.7;}
.header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #3a6ea8;margin-bottom:6px;}
.logo-img{height:40px;width:auto;object-fit:contain;}
.doc-ref{text-align:right;font-size:10.5px;color:#5a5750;line-height:1.7;}
.doc-numero{font-family:'DM Mono',sans-serif;font-size:12.5px;font-weight:600;color:#3a6ea8;}
.titulo-doc{margin:12px 0 4px;text-align:center;}
.titulo-doc h1{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#1a1916;}
.titulo-doc .subtitulo{font-size:11px;color:#5a5750;text-transform:uppercase;letter-spacing:0.3px;margin-top:2px;}
.destinatario{background:#f4f7fb;border-left:3px solid #3a6ea8;padding:8px 12px;margin:10px 0 16px;font-size:11.5px;}
.destinatario strong{color:#2a5080;}
h2{font-size:12px;font-weight:700;color:white;background:#3a6ea8;padding:5px 10px;margin:16px 0 8px;letter-spacing:0.3px;text-transform:uppercase;}
p{margin-bottom:8px;text-align:justify;}
ul{margin:4px 0 8px 18px;}
li{margin-bottom:5px;}
.bullet-item{display:flex;gap:6px;margin-bottom:5px;font-size:12.5px;}
.bullet-item::before{content:"●";color:#3a6ea8;flex-shrink:0;}
.conc-box{border-radius:8px;padding:12px 16px;margin:10px 0;background:${aptBg};border:1.5px solid ${aptBorder};}
.conc-label{font-size:14px;font-weight:700;color:${aptColor};margin-bottom:4px;}
.conc-sub{font-size:10.5px;color:#5a5750;}
.firmas-row{display:flex;gap:30px;flex-wrap:wrap;margin-top:40px;padding-top:16px;border-top:1.5px solid #e8e4de;}
.firma-item{text-align:center;flex:1;min-width:160px;}
.firma-linea{width:160px;border-bottom:1.5px solid #1a1916;margin:0 auto 6px;height:28px;}
.firma-nombre{font-size:11.5px;font-weight:700;}
.firma-esp{font-size:10px;color:#5a5750;}
.firma-mat{font-size:9.5px;color:#9a9790;font-family:'DM Mono',sans-serif;}
.hash{margin-top:20px;text-align:right;font-size:8px;color:#9a9790;font-family:'DM Mono',sans-serif;}
.wm{margin-top:12px;text-align:center;font-size:9px;color:#c8c4be;font-family:'DM Mono',sans-serif;border-top:1px solid #eee;padding-top:8px;}
@media print{body{padding:20px 28px;}h2{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>

<div class="header">
  <div style="display:flex;align-items:center;gap:11px;">
    <img src="/logo.png" alt="MEDGRUP" class="logo-img"/>
    <div>
      <div style="font-size:17px;font-weight:700;color:#3a6ea8;letter-spacing:-0.3px;">MEDGRUP</div>
      <div style="font-size:9px;color:#c0365a;letter-spacing:1.2px;text-transform:uppercase;font-family:'DM Mono',sans-serif;">Servicio Médico Laboral Integral</div>
    </div>
  </div>
  <div style="display:flex;align-items:flex-start;gap:12px;">
    <div class="doc-ref">
      <div class="doc-numero">${d.numero}</div>
      <div>Tierra del Fuego, ${fechaEmision}</div>
      <div style="margin-top:2px;">RESERVADO Y CONFIDENCIAL</div>
    </div>
    ${qrVerificacion ? `<div style="text-align:center;flex-shrink:0;"><img src="${qrVerificacion}" alt="QR de verificación" style="width:56px;height:56px;"/><div style="font-size:6.5px;color:#9a9790;font-family:'DM Mono',sans-serif;margin-top:2px;">Verificar</div></div>` : ''}
  </div>
</div>

<div class="titulo-doc">
  <h1>Informe de Evaluación ${tipoConsulta}</h1>
  <div class="subtitulo">Medicina del Trabajo · Psiquiatría Forense</div>
</div>

<div class="destinatario">
  <strong>A:</strong> Dirección de Recursos Humanos – ${d.empresa||'—'}<br/>
  <strong>REFERENCIA:</strong> ${tipoConsulta} – ${d.paciente}<br/>
  <strong>FECHA DE EMISIÓN:</strong> ${fechaEmision.toUpperCase()}
</div>

<h2>I. Datos personales del evaluado</h2>
<div style="padding:4px 0;">
  <div class="bullet-item">Apellidos y Nombres: <strong>${apellidoNombre}</strong></div>
  <div class="bullet-item">Documento Nacional de Identidad: DNI ${d.paciente_dni||'—'}</div>
  ${fechaNac!=='—'?`<div class="bullet-item">Fecha de Nacimiento: ${fechaNac}</div>`:''}
  ${lugarNac!=='—'?`<div class="bullet-item">Lugar de Nacimiento: ${lugarNac}</div>`:''}
  ${estadoCivil!=='—'?`<div class="bullet-item">Estado Civil: ${estadoCivil}</div>`:''}
  ${estudios!=='—'?`<div class="bullet-item">Estudios cursados: ${estudios}</div>`:''}
  <div class="bullet-item">Empresa: ${d.empresa||'—'}</div>
  ${puesto!=='—'?`<div class="bullet-item">Puesto de Trabajo: ${puesto}</div>`:''}
  ${antiguedad!=='—'?`<div class="bullet-item">Antigüedad: ${antiguedad}</div>`:''}
  ${d.obra_social?`<div class="bullet-item">Obra Social: ${d.obra_social}</div>`:''}
  ${sitLicencia!=='—'?`<div class="bullet-item">Situación de Licencia: ${sitLicencia}</div>`:''}
</div>

<h2>II. Metodología adoptada</h2>
<p style="white-space:pre-wrap;">${metodologia}</p>
<ul>${integrantesHtml}</ul>

${d.antecedentes?`<h2>III. Antecedentes médicos y clínicos generales</h2><p style="white-space:pre-wrap;">${d.antecedentes}</p>`:''}

${d.hallazgos?`<h2>IV. Examen semiológico (estado actual)</h2><p style="white-space:pre-wrap;">${d.hallazgos}</p>`:''}

${analisis?`<h2>V. Análisis médico-legal de la documentación</h2><p style="white-space:pre-wrap;">${analisis}</p>`:''}

<h2>VI. Conclusiones médico-legales</h2>
${d.conclusion?`<p style="white-space:pre-wrap;">${d.conclusion}</p>`:''}
${diagCIE?`<p><strong>Encuadre diagnóstico:</strong> ${diagCIE}</p>`:''}
<div class="conc-box">
  <div class="conc-label">${aptitudMap[d.aptitud]||d.aptitud}</div>
  ${d.aptitud_texto ? `<div style="font-size:12px;color:${aptColor};margin:4px 0 2px;font-style:italic;">${d.aptitud_texto}</div>` : ''}
  <div class="conc-sub">${d.dias_reposo>0?d.dias_reposo+' día(s) de reposo indicado':'Sin reposo indicado'}${d.derivacion&&d.derivacion!=='Sin derivación'?' · Derivación a: '+d.derivacion:''}</div>
</div>
${d.indicaciones?`<p style="margin-top:10px;white-space:pre-wrap;"><strong>Indicaciones:</strong> ${d.indicaciones}</p>`:''}

<p style="margin-top:14px;font-style:italic;font-size:12px;">Es todo cuanto puedo afirmar en base al saber médico-legal y mi leal saber y entender.</p>

<div class="firmas-row">
  ${firmasHtml}
</div>

<div class="hash">Cód. verificación: ${d.numero}-${Buffer.from(d.numero+d.paciente+d.creado_en).toString('base64').substring(0,28)}</div>
${trazaFirmasHtml}
<div class="wm">MEDGRUP Servicio Médico Laboral · Documento oficial · ${d.numero} · medgruplaboral.com.ar</div>
<script>window.onload=function(){window.print();}</script>
</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ACTA =====
app.get('/api/turnos/:id/acta', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM turnos WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const t = r.rows[0];
    const eventos = (await pool.query('SELECT * FROM eventos_turno WHERE turno_id=$1 ORDER BY creado_en ASC', [req.params.id])).rows;
    const fecha = new Date(t.fecha).toLocaleDateString('es-AR', { day:'2-digit',month:'long',year:'numeric',timeZone:'America/Argentina/Buenos_Aires' });
    const fechaEmision = new Date().toLocaleDateString('es-AR', { day:'2-digit',month:'long',year:'numeric',timeZone:'America/Argentina/Buenos_Aires' });
    const tipoLabel = { inicio_medico:'Inicio de videoconsulta', union_medico:'Médico se incorporó a la consulta', union_paciente:'Paciente se incorporó a la consulta', fin_consulta:'Finalización de la consulta' };
    const tipoIcon = { inicio_medico:'▶', union_medico:'＋', union_paciente:'＋', fin_consulta:'■' };
    const eventosHtml = eventos.length ? eventos.map(e => {
      const hora = new Date(e.creado_en).toLocaleTimeString('es-AR', { hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'America/Argentina/Buenos_Aires' });
      return `<div class="ev-row"><div class="ev-hora">${hora}</div><div class="ev-icon">${tipoIcon[e.tipo]||'•'}</div><div class="ev-desc"><strong>${tipoLabel[e.tipo]||e.tipo}</strong>${e.participante?' — '+e.participante:''}</div></div>`;
    }).join('') : `<div style="color:#9a9790;font-size:12.5px;padding:12px 0;">Sin eventos de asistencia registrados.</div>`;

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><title>Acta - ${t.paciente}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'DM Sans',sans-serif;color:#1a1916;background:white;padding:46px 52px;font-size:13px;line-height:1.7;}
.header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:16px;border-bottom:2px solid #3a6ea8;margin-bottom:18px;}
.logo-img{height:42px;width:auto;object-fit:contain;}h1{font-size:17px;font-weight:700;margin-bottom:6px;}
.subt{font-size:11px;color:#5a5750;margin-bottom:18px;}p{text-align:justify;margin-bottom:10px;}
.datos-box{background:#f4f7fb;border:1px solid #e6edf5;border-radius:9px;padding:12px 15px;margin:14px 0 20px;display:grid;grid-template-columns:1fr 1fr;gap:7px 18px;}
.dato-label{color:#9a9790;font-family:'DM Mono',sans-serif;font-size:9.5px;text-transform:uppercase;letter-spacing:0.5px;}.dato-value{font-weight:600;}
h2{font-size:12.5px;font-weight:700;color:#2a5080;margin:18px 0 10px;}
.ev-row{display:flex;align-items:center;gap:14px;padding:10px 14px;border-bottom:1px solid #ecebe7;}.ev-row:last-child{border-bottom:none;}
.ev-hora{font-family:'DM Mono',sans-serif;font-size:11.5px;color:#3a6ea8;font-weight:500;width:64px;flex-shrink:0;}
.ev-icon{width:22px;height:22px;border-radius:50%;background:#e8f0f8;color:#3a6ea8;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;}
.ev-desc{font-size:12.5px;}
.eventos-box{border:1px solid #e8e4de;border-radius:9px;overflow:hidden;}
.verif{margin-top:24px;background:#faedf1;border:1px solid #f0b8c8;border-radius:9px;padding:11px 15px;font-size:11px;color:#9a2847;}
.wm{margin-top:28px;text-align:center;font-size:9px;color:#c8c4be;font-family:'DM Mono',sans-serif;}
@media print{body{padding:26px 32px;}}</style></head><body>
<div class="header">
  <div style="display:flex;align-items:center;gap:11px;">
    <img src="/logo.png" alt="MEDGRUP" class="logo-img"/>
    <div><div style="font-size:18px;font-weight:700;color:#3a6ea8;">MEDGRUP</div><div style="font-size:9.5px;color:#c0365a;letter-spacing:1.2px;text-transform:uppercase;font-family:'DM Mono',sans-serif;">Salud Ocupacional, Seguridad e Higiene del Trabajo</div></div>
  </div>
  <div style="text-align:right;font-size:10.5px;color:#5a5750;">Tierra del Fuego<br>${fechaEmision}</div>
</div>
<h1>Acta de Asistencia — ${t.tipo||'Consulta Médica'}</h1>
<div class="subt">Constancia de asistencia mediante registro de eventos de la videoconsulta</div>
<p>Se deja constancia de que en el día de la fecha se realizó, a solicitud de <strong>${t.empresa||'—'}</strong>, una evaluación médica en modalidad de telemedicina a través de la plataforma MEDGRUP, correspondiente a la categoría <strong>${t.tipo||'Consulta médica'}</strong>. El/la evaluado/a fue el/la Sr./Sra. <strong>${t.paciente}</strong>.</p>
<div class="datos-box">
  <div><div class="dato-label">Paciente</div><div class="dato-value">${t.paciente}</div></div>
  <div><div class="dato-label">Empresa</div><div class="dato-value">${t.empresa||'—'}</div></div>
  <div><div class="dato-label">Fecha del turno</div><div class="dato-value">${fecha}</div></div>
  <div><div class="dato-label">Tipo de consulta</div><div class="dato-value">${t.tipo||'—'}</div></div>
</div>
<h2>Registro cronológico de asistencia</h2>
<div class="eventos-box">${eventosHtml}</div>
<div class="verif">Este documento certifica la asistencia mediante el registro automático de eventos del sistema MEDGRUP, generado por la plataforma sin intervención manual.</div>
<div class="wm">MEDGRUP Servicio Médico Laboral · Acta de asistencia · ${t.id}</div>
<script>window.onload=function(){window.print();}</script></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== WEBHOOK DAILY =====
app.post('/api/webhooks/daily', async (req, res) => {
  try {
    const { type, payload={} } = req.body;
    const sala = payload.room||payload.room_name||'';
    const nombreRaw = payload.user_name||payload.userName||'Participante';
    const nombre = decodeURIComponent(nombreRaw).replace(/\+/g,' ').trim();

    if (type==='participant.joined' && sala) {
      const t = await pool.query('SELECT id FROM turnos WHERE sala=$1 LIMIT 1', [sala]);
      if (t.rows.length) {
        const turnoId = t.rows[0].id;
        // Determinar si es médico: por flag owner O por coincidencia de nombre con turno_medicos
        let esMedico = payload.owner === true;
        if (!esMedico) {
          const medicos = await pool.query('SELECT medico_nombre FROM turno_medicos WHERE turno_id=$1', [turnoId]);
          esMedico = medicos.rows.some(m => {
            const apellido = m.medico_nombre.toLowerCase().split(',')[0].trim();
            return nombre.toLowerCase().includes(apellido) || apellido.includes(nombre.toLowerCase().split(/[\s%]+/)[0]);
          });
        }
        const tipo = esMedico ? 'union_medico' : 'union_paciente';
        await pool.query('INSERT INTO eventos_turno (turno_id,tipo,participante) VALUES ($1,$2,$3)', [turnoId, tipo, nombre]);
      }
    }
    res.json({ ok: true });
  } catch (err) { res.json({ ok: true }); }
});

async function registrarWebhookDaily() {
  if (!DAILY_API_KEY) return;
  try {
    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://medgruplaboral-production.up.railway.app';
    const webhookUrl = `${baseUrl}/api/webhooks/daily`;
    const existing = await fetch('https://api.daily.co/v1/webhooks', { headers: { 'Authorization': `Bearer ${DAILY_API_KEY}` } }).then(r=>r.json()).catch(()=>({data:[]}));
    if ((existing.data||[]).some(w=>w.url===webhookUrl)) { console.log('✓ Webhook Daily ya registrado'); return; }
    await fetch('https://api.daily.co/v1/webhooks', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${DAILY_API_KEY}`}, body: JSON.stringify({ url: webhookUrl, eventTypes: ['participant.joined'] }) });
    console.log('✓ Webhook Daily registrado:', webhookUrl);
  } catch (err) { console.log('⚠ Webhook Daily no registrado:', err.message); }
}

// ===== FIRMA DIGITAL DEL DOCTOR =====
app.post('/api/dictamenes/:id/firma', authMiddleware, async (req, res) => {
  try {
    const { firma_base64 } = req.body;
    if (!firma_base64) return res.status(400).json({ error: 'Falta la firma' });
    const limpia = firma_base64.replace(/^data:image\/[a-z]+;base64,/, '');
    await pool.query('UPDATE dictamenes SET firma_doctor=$1 WHERE id=$2', [limpia, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== INFORME COMPLETO EDITADO =====
app.post('/api/dictamenes/:id/informe-completo', authMiddleware, async (req, res) => {
  try {
    const { informe_texto } = req.body;
    if (!informe_texto) return res.status(400).json({ error: 'Falta el texto' });
    await pool.query('UPDATE dictamenes SET informe_completo=$1 WHERE id=$2', [informe_texto, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== PROXY ANTHROPIC =====
app.post('/api/ia/generar-informe', authMiddleware, async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key de IA no configurada. Agregá ANTHROPIC_API_KEY en las variables de entorno de Railway.' });
    const { system, messages, max_tokens } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: max_tokens || 3000,
        system,
        messages
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic API error:', JSON.stringify(data));
      return res.status(response.status).json({ error: data.error?.message || 'Error de la IA', detalle: data });
    }
    // Log del texto devuelto para debug
    const texto = (data.content||[]).map(b=>b.text||'').join('');
    console.log('IA response preview:', texto.substring(0,300));
    res.json(data);
  } catch (err) {
    console.error('Proxy IA error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, anthropic: !!ANTHROPIC_API_KEY, daily: !!DAILY_API_KEY }));
// ===== SUBIR PDF FIRMADO =====
app.post('/api/dictamenes/:id/pdf-firmado', authMiddleware, async (req, res) => {
  try {
    const { pdf_base64, nombre } = req.body;
    if (!pdf_base64) return res.status(400).json({ error: 'Falta el archivo' });
    // Validar que sea un PDF (base64 de PDF empieza con JVBERi)
    if (!pdf_base64.includes('JVBERi') && !pdf_base64.startsWith('data:application/pdf')) {
      return res.status(400).json({ error: 'El archivo debe ser un PDF' });
    }
    // Guardar solo el base64 puro sin el prefijo data:...
    const base64puro = pdf_base64.replace(/^data:application\/pdf;base64,/, '');
    await pool.query(
      'UPDATE dictamenes SET pdf_firmado=$1, pdf_firmado_nombre=$2, pdf_firmado_fecha=NOW() WHERE id=$3',
      [base64puro, nombre||'informe-firmado.pdf', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Servir el PDF firmado (si existe) o el generado
app.get('/api/dictamenes/:id/pdf-firmado', async (req, res) => {
  try {
    const r = await pool.query('SELECT pdf_firmado, pdf_firmado_nombre FROM dictamenes WHERE id=$1', [req.params.id]);
    if (!r.rows.length || !r.rows[0].pdf_firmado) return res.status(404).json({ error: 'No hay PDF firmado' });
    const buf = Buffer.from(r.rows[0].pdf_firmado, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.rows[0].pdf_firmado_nombre||'informe-firmado.pdf'}"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/empresa', (req, res) => res.sendFile(path.join(__dirname, 'public', 'empresa.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDB().then(() => { app.listen(PORT, () => console.log(`MEDGRUP en puerto ${PORT}`)); registrarWebhookDaily(); });