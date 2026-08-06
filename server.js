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
// La firma de actas se sumó este día: no la pedimos retroactivamente para turnos previos ya cerrados
const FIRMA_ACTA_DESDE = '2026-07-31';
// Cuánto esperamos a que la IA arme el informe antes de cortar y avisar. Generar un informe
// completo suele tardar entre 30 y 90 segundos, así que el corte va bastante por encima.
const IA_TIMEOUT_MS = 3 * 60 * 1000;
const DAILY_API_KEY = process.env.DAILY_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Solo para convertir la dirección del domicilio en coordenadas. Nunca se manda al navegador.
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
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
      CREATE TABLE IF NOT EXISTS firmas_acta (
        id SERIAL PRIMARY KEY,
        turno_id VARCHAR(50) REFERENCES turnos(id),
        medico_nombre VARCHAR(200) NOT NULL,
        matricula VARCHAR(100),
        especialidad VARCHAR(200),
        firma_base64 TEXT,
        firmado_en TIMESTAMP DEFAULT NOW(),
        UNIQUE (turno_id, medico_nombre)
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

      -- Control de ausentismo: la empresa abre un caso por cada trabajador ausente, MEDGRUP le
      -- asigna un profesional y termina en una entrevista con su informe. Se cobra por caso
      -- resuelto, por eso resuelto_en es lo que después alimenta la facturación del mes.
      CREATE TABLE IF NOT EXISTS casos_ausentismo (
        id SERIAL PRIMARY KEY,
        empresa_id INTEGER REFERENCES empresas_clientes(id),
        empresa_nombre VARCHAR(200) NOT NULL,
        trabajador_nombre VARCHAR(200) NOT NULL,
        trabajador_dni VARCHAR(50),
        trabajador_telefono VARCHAR(50),
        motivo TEXT,
        documentacion TEXT,
        estado VARCHAR(30) DEFAULT 'nuevo',
        profesional_id INTEGER REFERENCES medicos(id),
        turno_id VARCHAR(50) REFERENCES turnos(id),
        notas_admin TEXT,
        creado_en TIMESTAMP DEFAULT NOW(),
        resuelto_en TIMESTAMP
      );
      -- Registro de cada intento de ingreso a la entrevista con la ubicación reportada.
      -- Se guardan también los rechazados: sirven para auditar después.
      CREATE TABLE IF NOT EXISTS ingresos_ubicacion (
        id SERIAL PRIMARY KEY,
        caso_id INTEGER REFERENCES casos_ausentismo(id) ON DELETE CASCADE,
        turno_id VARCHAR(50),
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        precision_metros DOUBLE PRECISION,
        distancia_metros DOUBLE PRECISION,
        resultado VARCHAR(30) NOT NULL,
        ip VARCHAR(60),
        creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ingresos_caso ON ingresos_ubicacion (caso_id);

      -- Los certificados que presenta el trabajador. Van aparte porque un caso puede tener
      -- varios (certificado inicial, prórrogas, estudios) y se suben en momentos distintos.
      CREATE TABLE IF NOT EXISTS certificados_ausentismo (
        id SERIAL PRIMARY KEY,
        caso_id INTEGER NOT NULL REFERENCES casos_ausentismo(id) ON DELETE CASCADE,
        nombre_archivo VARCHAR(300) NOT NULL,
        tipo_mime VARCHAR(100),
        tamano_bytes INTEGER,
        archivo_base64 TEXT NOT NULL,
        subido_por VARCHAR(200),
        creado_en TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cert_caso ON certificados_ausentismo (caso_id);

      CREATE INDEX IF NOT EXISTS idx_casos_empresa   ON casos_ausentismo (empresa_nombre);
      CREATE INDEX IF NOT EXISTS idx_casos_estado    ON casos_ausentismo (estado);
      CREATE INDEX IF NOT EXISTS idx_casos_prof      ON casos_ausentismo (profesional_id);
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
      // Hay evaluaciones que no incluyen examen del estado mental. Con esto la sección se
      // apaga para ese informe y no vuelve aunque se regenere con la IA.
      `ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS sin_semiologico BOOLEAN DEFAULT false`,
      // Control domiciliario: el reposo es en el domicilio del trabajador, así que el caso
      // guarda esa dirección, sus coordenadas y con cuánto margen se considera "en casa".
      `ALTER TABLE IF EXISTS casos_ausentismo ADD COLUMN IF NOT EXISTS domicilio VARCHAR(400)`,
      `ALTER TABLE IF EXISTS casos_ausentismo ADD COLUMN IF NOT EXISTS domicilio_lat DOUBLE PRECISION`,
      `ALTER TABLE IF EXISTS casos_ausentismo ADD COLUMN IF NOT EXISTS domicilio_lng DOUBLE PRECISION`,
      `ALTER TABLE IF EXISTS casos_ausentismo ADD COLUMN IF NOT EXISTS radio_metros INTEGER DEFAULT 300`,
      // El link que se le manda al trabajador no puede ser adivinable: el id del turno sí lo es
      `ALTER TABLE IF EXISTS casos_ausentismo ADD COLUMN IF NOT EXISTS token_ingreso VARCHAR(64)`,
      `ALTER TABLE IF EXISTS turnos ADD COLUMN IF NOT EXISTS telefono VARCHAR(50)`,
      `ALTER TABLE IF EXISTS turnos ADD COLUMN IF NOT EXISTS modalidad VARCHAR(20) DEFAULT 'telemedicina'`,
      // Independiente de "modalidad" (que solo decide si se crea sala de Daily): esto decide si
      // la paciente estuvo físicamente presente — de eso depende el estilo del acta (declaración
      // jurada vs. registro de eventos) y si hace falta capturarle la firma.
      `ALTER TABLE IF EXISTS turnos ADD COLUMN IF NOT EXISTS paciente_presencial BOOLEAN DEFAULT false`,
      // Independiente de si estuvo presente: hay juntas donde la paciente comparece pero el acta
      // la suscriben solo los profesionales. Con esto se le saca el renglón de firma sin dejar
      // de ser una declaración jurada.
      `ALTER TABLE IF EXISTS turnos ADD COLUMN IF NOT EXISTS firma_paciente BOOLEAN DEFAULT true`,
      `ALTER TABLE IF EXISTS firmas_acta ADD COLUMN IF NOT EXISTS es_paciente BOOLEAN DEFAULT false`,
      `ALTER TABLE IF EXISTS firmas_acta ADD COLUMN IF NOT EXISTS capturada_por VARCHAR(200)`,
      `ALTER TABLE IF EXISTS medicos ADD COLUMN IF NOT EXISTS telefono VARCHAR(50)`,
      `ALTER TABLE IF EXISTS medicos ADD COLUMN IF NOT EXISTS firma_guardada TEXT`,
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
      const hash = hashPassword(password);
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
        -- El autor normalmente firma al generar el informe, así que no se le vuelve a pedir.
        -- La excepción es que le hayan quitado la firma para rehacerla: ahí reaparece acá.
        AND (d.medico != $1 OR d.firma_doctor IS NULL)
        AND NOT EXISTS (SELECT 1 FROM firmas_dictamen f WHERE f.dictamen_id = d.id AND f.medico_nombre = $1)
      ORDER BY d.creado_en DESC`, [nombre]);
    res.json({ ok: true, pendientes: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== FIRMA GUARDADA DEL MÉDICO (se dibuja una sola vez y se reutiliza) =====
app.get('/api/medicos/mi-firma', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT firma_guardada FROM medicos WHERE nombre=$1 AND activo=true LIMIT 1', [req.usuario.nombre]);
    res.json({ ok: true, firma: r.rows[0]?.firma_guardada || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/medicos/mi-firma', authMiddleware, async (req, res) => {
  const { firma_base64 } = req.body;
  if (!firma_base64) return res.status(400).json({ error: 'Falta la firma' });
  try {
    const limpia = firma_base64.replace(/^data:image\/[a-z]+;base64,/, '');
    const r = await pool.query('UPDATE medicos SET firma_guardada=$1 WHERE nombre=$2 AND activo=true', [limpia, req.usuario.nombre]);
    if (!r.rowCount) return res.status(404).json({ error: 'No se encontró tu perfil en el equipo médico' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== FIRMA DEL ACTA DE ASISTENCIA (un clic, usa la firma guardada) =====
app.get('/api/firmas-acta/pendientes', authMiddleware, async (req, res) => {
  try {
    const nombre = req.usuario.nombre;
    // Un acta aparece como pendiente si al médico le falta firmarla, o si —cuando la paciente
    // estuvo presente— todavía falta alguna firma que él puede tomar en el momento (la de ella
    // o la de otro profesional que estuvo ahí). Así el aviso del menú no se apaga a mitad de camino.
    const r = await pool.query(`
      SELECT t.id, t.paciente, t.fecha, t.hora, t.tipo, t.empresa, t.paciente_presencial,
             NOT EXISTS (SELECT 1 FROM firmas_acta fa WHERE fa.turno_id = t.id AND fa.medico_nombre = $1) AS falta_la_mia,
             (SELECT COUNT(*) FROM turno_medicos m2
                WHERE m2.turno_id = t.id
                  AND NOT EXISTS (SELECT 1 FROM firmas_acta f2 WHERE f2.turno_id = t.id AND f2.medico_nombre = m2.medico_nombre))
             + CASE WHEN t.paciente_presencial AND t.firma_paciente
                     AND NOT EXISTS (SELECT 1 FROM firmas_acta f3 WHERE f3.turno_id = t.id AND f3.es_paciente)
                    THEN 1 ELSE 0 END AS faltan
      FROM turnos t
      JOIN turno_medicos tm ON tm.turno_id = t.id
      WHERE tm.medico_nombre = $1 AND t.estado = 'completado'
        AND t.fecha >= $2
        AND (
          NOT EXISTS (SELECT 1 FROM firmas_acta fa WHERE fa.turno_id = t.id AND fa.medico_nombre = $1)
          OR (t.paciente_presencial AND t.firma_paciente AND NOT EXISTS (SELECT 1 FROM firmas_acta f4 WHERE f4.turno_id = t.id AND f4.es_paciente))
        )
      ORDER BY t.fecha DESC, t.hora DESC`, [nombre, FIRMA_ACTA_DESDE]);
    res.json({ ok: true, pendientes: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/turnos/:id/firmar-acta', authMiddleware, async (req, res) => {
  try {
    const nombre = req.usuario.nombre;
    const asignado = await pool.query('SELECT 1 FROM turno_medicos WHERE turno_id=$1 AND medico_nombre=$2', [req.params.id, nombre]);
    if (!asignado.rows.length) return res.status(403).json({ error: 'No estás asignado a este turno' });

    const yaFirmo = await pool.query('SELECT 1 FROM firmas_acta WHERE turno_id=$1 AND medico_nombre=$2', [req.params.id, nombre]);
    if (yaFirmo.rows.length) return res.status(409).json({ error: 'Ya firmaste esta acta' });

    const perfil = await pool.query('SELECT matricula, especialidad, firma_guardada FROM medicos WHERE nombre=$1 AND activo=true LIMIT 1', [nombre]);
    if (!perfil.rows.length) return res.status(400).json({ error: 'No encontramos tu perfil de médico' });
    const { matricula, especialidad, firma_guardada } = perfil.rows[0];

    // Si manda una firma dibujada en el momento, se usa esa y de paso le queda guardada
    // en el perfil, así la próxima vez firma con un clic.
    const dibujada = req.body && req.body.firma_base64
      ? req.body.firma_base64.replace(/^data:image\/[a-z]+;base64,/, '')
      : null;
    const firmaFinal = dibujada || firma_guardada;
    if (!firmaFinal) return res.status(400).json({ error: 'Falta la firma' });

    await pool.query(`INSERT INTO firmas_acta (turno_id,medico_nombre,matricula,especialidad,firma_base64) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, nombre, matricula||'', especialidad||'Medicina Laboral', firmaFinal]);
    if (dibujada && !firma_guardada) {
      await pool.query('UPDATE medicos SET firma_guardada=$1 WHERE nombre=$2', [dibujada, nombre]);
    }
    res.json({ ok: true, firma_guardada_ahora: !!(dibujada && !firma_guardada) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== GESTIÓN DE FIRMAS DEL INFORME (solo admin) =====
// Si un médico firmó mal, hay que poder retirarle la firma sin tocar el informe. El contenido
// vive en la tabla dictamenes y el PDF se arma en el momento, así que quitar una firma solo
// deja ese renglón en blanco hasta que la persona vuelva a firmar.
app.get('/api/dictamenes/:id/firmas', adminMiddleware, async (req, res) => {
  try {
    const dRes = await pool.query('SELECT id, numero, medico, turno_id, firma_doctor FROM dictamenes WHERE id=$1', [req.params.id]);
    if (!dRes.rows.length) return res.status(404).json({ error: 'Dictamen no encontrado' });
    const d = dRes.rows[0];
    const juntas = (await pool.query(
      'SELECT medico_nombre, especialidad, matricula, firmado_en FROM firmas_dictamen WHERE dictamen_id=$1 ORDER BY firmado_en ASC',
      [req.params.id])).rows;
    const medicosTurno = d.turno_id
      ? (await pool.query('SELECT medico_nombre FROM turno_medicos WHERE turno_id=$1 ORDER BY medico_nombre', [d.turno_id])).rows.map(x => x.medico_nombre)
      : [];

    const nombres = [...new Set([d.medico, ...medicosTurno, ...juntas.map(j => j.medico_nombre)])].filter(Boolean);
    const firmantes = nombres.map(n => {
      const junta = juntas.find(j => j.medico_nombre === n);
      const esAutor = n === d.medico;
      return {
        nombre: n,
        es_autor: esAutor,
        // El autor puede tener la firma en el propio dictamen o, si la rehízo, como firma de junta
        firmo: !!(junta || (esAutor && d.firma_doctor)),
        origen: junta ? 'junta' : (esAutor && d.firma_doctor ? 'autor' : null),
        firmado_en: junta ? junta.firmado_en : null,
        especialidad: junta?.especialidad || '',
        matricula: junta?.matricula || ''
      };
    });
    res.json({ ok: true, numero: d.numero, autor: d.medico, firmantes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/dictamenes/:id/firmas/:nombre', adminMiddleware, async (req, res) => {
  try {
    const dRes = await pool.query('SELECT medico FROM dictamenes WHERE id=$1', [req.params.id]);
    if (!dRes.rows.length) return res.status(404).json({ error: 'Dictamen no encontrado' });
    const nombre = req.params.nombre;

    // Una misma persona puede tener la firma en los dos lugares: se limpian ambos
    const borradasJunta = await pool.query('DELETE FROM firmas_dictamen WHERE dictamen_id=$1 AND medico_nombre=$2', [req.params.id, nombre]);
    let borradaAutor = 0;
    if (nombre === dRes.rows[0].medico) {
      const r = await pool.query('UPDATE dictamenes SET firma_doctor=NULL WHERE id=$1 AND firma_doctor IS NOT NULL', [req.params.id]);
      borradaAutor = r.rowCount;
    }
    if (!borradasJunta.rowCount && !borradaAutor) {
      return res.status(404).json({ error: 'Esa persona no tiene firma en este informe' });
    }
    res.json({ ok: true, nombre });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== GESTIÓN DE FIRMAS DEL ACTA (solo admin) =====
// Sirve para corregir un acta ya emitida: quitar una firma equivocada para que esa persona
// vuelva a firmar, o sacarle a la paciente el renglón de firma cuando el acta la suscriben
// únicamente los profesionales.
app.get('/api/turnos/:id/firmas-acta', adminMiddleware, async (req, res) => {
  try {
    const t = await pool.query('SELECT paciente, paciente_presencial, firma_paciente FROM turnos WHERE id=$1', [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Turno no encontrado' });
    const medicos = (await pool.query('SELECT medico_nombre FROM turno_medicos WHERE turno_id=$1 ORDER BY medico_nombre', [req.params.id])).rows.map(x => x.medico_nombre);
    const firmas = (await pool.query(
      'SELECT medico_nombre, especialidad, matricula, es_paciente, capturada_por, firmado_en FROM firmas_acta WHERE turno_id=$1 ORDER BY firmado_en ASC',
      [req.params.id])).rows;
    res.json({
      ok: true,
      paciente: t.rows[0].paciente,
      paciente_presencial: t.rows[0].paciente_presencial,
      firma_paciente: t.rows[0].firma_paciente !== false,
      medicos,
      firmas
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Aplica al acta la firma que el médico ya usó en el informe de este mismo turno (o, si no
// firmó el informe, la que tiene guardada en su perfil). Queda asentado en capturada_por que
// la registró el admin, no el médico en ese momento.
app.post('/api/turnos/:id/firmas-acta/importar', adminMiddleware, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre del médico' });

    const asignado = await pool.query('SELECT 1 FROM turno_medicos WHERE turno_id=$1 AND medico_nombre=$2', [req.params.id, nombre]);
    if (!asignado.rows.length) return res.status(400).json({ error: 'Ese médico no está asignado a este turno' });

    const yaFirmo = await pool.query('SELECT 1 FROM firmas_acta WHERE turno_id=$1 AND medico_nombre=$2', [req.params.id, nombre]);
    if (yaFirmo.rows.length) return res.status(409).json({ error: `${nombre} ya firmó esta acta` });

    // 1) La firma que dejó en el informe de este turno
    let firma = null, origen = null;
    const junta = await pool.query(
      `SELECT f.firma_base64 FROM firmas_dictamen f
       JOIN dictamenes d ON d.id = f.dictamen_id
       WHERE d.turno_id=$1 AND f.medico_nombre=$2 ORDER BY f.firmado_en DESC LIMIT 1`,
      [req.params.id, nombre]);
    if (junta.rows.length) { firma = junta.rows[0].firma_base64; origen = 'informe'; }
    if (!firma) {
      const autor = await pool.query(
        'SELECT firma_doctor FROM dictamenes WHERE turno_id=$1 AND medico=$2 AND firma_doctor IS NOT NULL ORDER BY creado_en DESC LIMIT 1',
        [req.params.id, nombre]);
      if (autor.rows.length) { firma = autor.rows[0].firma_doctor; origen = 'informe'; }
    }
    // 2) Si no firmó el informe, la que tiene guardada en su perfil
    const perfil = await pool.query('SELECT matricula, especialidad, firma_guardada FROM medicos WHERE nombre=$1 AND activo=true LIMIT 1', [nombre]);
    if (!firma && perfil.rows[0]?.firma_guardada) { firma = perfil.rows[0].firma_guardada; origen = 'perfil'; }
    if (!firma) return res.status(404).json({ error: `${nombre} no tiene ninguna firma registrada para copiar` });

    await pool.query(
      `INSERT INTO firmas_acta (turno_id,medico_nombre,matricula,especialidad,firma_base64,es_paciente,capturada_por)
       VALUES ($1,$2,$3,$4,$5,false,$6)`,
      [req.params.id, nombre, perfil.rows[0]?.matricula || '', perfil.rows[0]?.especialidad || '', firma, req.usuario.nombre]);
    res.json({ ok: true, nombre, origen });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/turnos/:id/firmas-acta/:nombre', adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM firmas_acta WHERE turno_id=$1 AND medico_nombre=$2 RETURNING medico_nombre',
      [req.params.id, req.params.nombre]);
    if (!r.rows.length) return res.status(404).json({ error: 'Esa firma no existe en el acta' });
    res.json({ ok: true, nombre: r.rows[0].medico_nombre });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/turnos/:id/firma-paciente', adminMiddleware, async (req, res) => {
  try {
    const pide = !!req.body.firma_paciente;
    const chk = await pool.query('SELECT paciente FROM turnos WHERE id=$1', [req.params.id]);
    if (!chk.rows.length) return res.status(404).json({ error: 'Turno no encontrado' });
    await pool.query('UPDATE turnos SET firma_paciente=$1 WHERE id=$2', [pide, req.params.id]);
    // Si se deja de pedir la firma de la paciente, se retira la que hubiera quedado registrada
    if (!pide) await pool.query('DELETE FROM firmas_acta WHERE turno_id=$1 AND es_paciente=true', [req.params.id]);
    res.json({ ok: true, firma_paciente: pide });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== FIRMA PRESENCIAL EN CADENA =====
// Cuando varios firmantes (médicos y/o la paciente) están físicamente presentes con un solo
// dispositivo logueado, esto permite capturar sus firmas una por una, bien identificadas, sin
// que cada uno necesite su propia cuenta.
async function puedeGestionarFirmasDelTurno(turnoId, usuario) {
  if (usuario.rol === 'admin') return true;
  const r = await pool.query('SELECT 1 FROM turno_medicos WHERE turno_id=$1 AND medico_nombre=$2', [turnoId, usuario.nombre]);
  return r.rows.length > 0;
}

app.get('/api/turnos/:id/firmantes-pendientes', authMiddleware, async (req, res) => {
  try {
    if (!(await puedeGestionarFirmasDelTurno(req.params.id, req.usuario))) {
      return res.status(403).json({ error: 'No estás asignado a este turno' });
    }
    const t = await pool.query('SELECT paciente, paciente_presencial, firma_paciente FROM turnos WHERE id=$1', [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Turno no encontrado' });

    const medicosTurno = (await pool.query('SELECT medico_nombre FROM turno_medicos WHERE turno_id=$1', [req.params.id])).rows.map(x => x.medico_nombre);
    const firmas = (await pool.query('SELECT medico_nombre, es_paciente FROM firmas_acta WHERE turno_id=$1', [req.params.id])).rows;
    const yaFirmoMedico = nombre => firmas.some(f => !f.es_paciente && f.medico_nombre === nombre);
    const yaFirmoPaciente = firmas.some(f => f.es_paciente);

    // Orden: primero quien está pidiendo la lista (si le falta firmar), después el resto de médicos, al final la paciente
    const pendientes = [];
    const propio = medicosTurno.find(n => n === req.usuario.nombre);
    if (propio && !yaFirmoMedico(propio)) pendientes.push({ nombre: propio, es_paciente: false });
    medicosTurno.filter(n => n !== req.usuario.nombre && !yaFirmoMedico(n)).forEach(n => pendientes.push({ nombre: n, es_paciente: false }));
    if (t.rows[0].paciente_presencial && t.rows[0].firma_paciente !== false && !yaFirmoPaciente) pendientes.push({ nombre: t.rows[0].paciente, es_paciente: true });

    res.json({ ok: true, pendientes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/turnos/:id/firmar-acta-presencial', authMiddleware, async (req, res) => {
  try {
    if (!(await puedeGestionarFirmasDelTurno(req.params.id, req.usuario))) {
      return res.status(403).json({ error: 'No estás asignado a este turno' });
    }
    const { nombre_firmante, es_paciente, firma_base64 } = req.body;
    if (!firma_base64) return res.status(400).json({ error: 'Falta la firma' });

    const t = await pool.query('SELECT paciente, paciente_presencial, firma_paciente FROM turnos WHERE id=$1', [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Turno no encontrado' });

    let nombreFinal, matricula = '', especialidad = '';
    if (es_paciente) {
      if (!t.rows[0].paciente_presencial) return res.status(400).json({ error: 'Este turno no tiene a la paciente marcada como presencial' });
      if (t.rows[0].firma_paciente === false) return res.status(400).json({ error: 'Esta acta la firman únicamente los profesionales' });
      nombreFinal = t.rows[0].paciente; // se usa el nombre real de la BD, no lo que mande el cliente
    } else {
      const asignado = await pool.query('SELECT 1 FROM turno_medicos WHERE turno_id=$1 AND medico_nombre=$2', [req.params.id, nombre_firmante]);
      if (!asignado.rows.length) return res.status(400).json({ error: 'Ese médico no está asignado a este turno' });
      nombreFinal = nombre_firmante;
      const perfil = await pool.query('SELECT matricula, especialidad FROM medicos WHERE nombre=$1 AND activo=true LIMIT 1', [nombreFinal]);
      matricula = perfil.rows[0]?.matricula || '';
      especialidad = perfil.rows[0]?.especialidad || '';
    }

    const yaFirmo = await pool.query('SELECT 1 FROM firmas_acta WHERE turno_id=$1 AND medico_nombre=$2', [req.params.id, nombreFinal]);
    if (yaFirmo.rows.length) return res.status(409).json({ error: `${nombreFinal} ya firmó esta acta` });

    const limpia = firma_base64.replace(/^data:image\/[a-z]+;base64,/, '');
    await pool.query(`INSERT INTO firmas_acta (turno_id,medico_nombre,matricula,especialidad,firma_base64,es_paciente,capturada_por) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.params.id, nombreFinal, matricula, especialidad, limpia, !!es_paciente, req.usuario.nombre]);
    res.json({ ok: true, nombre: nombreFinal });
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
    const especialidad = perfil.rows[0]?.especialidad || '';

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
// El nombre del médico funciona como clave: identifica su login, su asignación a turnos, su
// link de videollamada y cada una de sus firmas. Cambiarlo en un solo lado lo deja sin turnos
// y con las firmas huérfanas, así que siempre se arrastra a todas las tablas de una vez.
async function migrarNombreMedico(client, nombreViejo, nombreNuevo) {
  await client.query('UPDATE usuarios        SET nombre=$1        WHERE nombre=$2', [nombreNuevo, nombreViejo]);
  await client.query('UPDATE turno_medicos   SET medico_nombre=$1 WHERE medico_nombre=$2', [nombreNuevo, nombreViejo]);
  await client.query('UPDATE firmas_acta     SET medico_nombre=$1 WHERE medico_nombre=$2', [nombreNuevo, nombreViejo]);
  await client.query('UPDATE firmas_acta     SET capturada_por=$1 WHERE capturada_por=$2', [nombreNuevo, nombreViejo]);
  await client.query('UPDATE firmas_dictamen SET medico_nombre=$1 WHERE medico_nombre=$2', [nombreNuevo, nombreViejo]);
  await client.query('UPDATE dictamenes      SET medico=$1        WHERE medico=$2', [nombreNuevo, nombreViejo]);
  await client.query('UPDATE turnos          SET medico_tratante=$1 WHERE medico_tratante=$2', [nombreNuevo, nombreViejo]);

  // links_medicos es un JSONB [{nombre, link}]: se reescribe en JS para no depender de
  // funciones de JSON del motor, y solo se guardan los turnos que realmente lo tenían.
  const conLinks = await client.query('SELECT id, links_medicos FROM turnos WHERE links_medicos IS NOT NULL');
  for (const fila of conLinks.rows) {
    const links = Array.isArray(fila.links_medicos) ? fila.links_medicos
      : (typeof fila.links_medicos === 'string' ? JSON.parse(fila.links_medicos || '[]') : []);
    if (!links.some(l => l && l.nombre === nombreViejo)) continue;
    const actualizados = links.map(l => l && l.nombre === nombreViejo ? { ...l, nombre: nombreNuevo } : l);
    await client.query('UPDATE turnos SET links_medicos=$1 WHERE id=$2', [JSON.stringify(actualizados), fila.id]);
  }
  // Las sesiones abiertas guardan el nombre viejo: se actualizan para no dejarlo sin turnos
  for (const tok of Object.keys(sessions)) {
    if (sessions[tok].nombre === nombreViejo) sessions[tok].nombre = nombreNuevo;
  }
}

// Compara nombres ignorando título, acentos, puntuación y mayúsculas, para detectar que
// "Scarello Luciano" y "Dr. Scarello Luciano" son la misma persona.
function claveNombre(n) {
  return String(n || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(dr|dra|lic|prof|med)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Nombres con los que quedaron guardados turnos, firmas o el login de este médico y que ya no
// coinciden con el de su perfil. Pasa cuando lo renombraron antes de que el cambio se arrastrara.
// Lo mismo pero para todo el equipo, así el aviso se ve en la lista de médicos sin tener
// que entrar a editar uno por uno.
app.get('/api/medicos-nombres-desincronizados', adminMiddleware, async (req, res) => {
  try {
    const medicos = (await pool.query('SELECT id, nombre FROM medicos WHERE activo=true')).rows;
    const usados = (await pool.query(`
      SELECT medico_nombre AS n FROM turno_medicos
      UNION SELECT medico_nombre FROM firmas_acta
      UNION SELECT medico_nombre FROM firmas_dictamen
      UNION SELECT medico FROM dictamenes
      UNION SELECT nombre FROM usuarios`)).rows.map(r => r.n).filter(Boolean);
    const nombresDeMedicos = medicos.map(m => m.nombre);

    const desincronizados = medicos.map(m => {
      const clave = claveNombre(m.nombre);
      const alternativos = [...new Set(usados)].filter(n =>
        n !== m.nombre && claveNombre(n) === clave && !nombresDeMedicos.includes(n));
      return { id: m.id, nombre: m.nombre, alternativos };
    }).filter(x => x.alternativos.length);

    res.json({ ok: true, desincronizados });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/medicos/:id/nombres-alternativos', adminMiddleware, async (req, res) => {
  try {
    const m = await pool.query('SELECT nombre FROM medicos WHERE id=$1', [req.params.id]);
    if (!m.rows.length) return res.status(404).json({ error: 'Médico no encontrado' });
    const actual = m.rows[0].nombre;
    const clave = claveNombre(actual);

    const usados = (await pool.query(`
      SELECT medico_nombre AS n FROM turno_medicos
      UNION SELECT medico_nombre FROM firmas_acta
      UNION SELECT medico_nombre FROM firmas_dictamen
      UNION SELECT medico FROM dictamenes
      UNION SELECT nombre FROM usuarios`)).rows.map(r => r.n).filter(Boolean);

    // Solo los que son la misma persona escrita distinto, y que no pertenezcan a otro médico
    const otrosMedicos = (await pool.query('SELECT nombre FROM medicos WHERE id!=$1', [req.params.id])).rows.map(r => r.nombre);
    const alternativos = [...new Set(usados)].filter(n =>
      n !== actual && claveNombre(n) === clave && !otrosMedicos.includes(n));

    res.json({ ok: true, nombre: actual, alternativos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Unifica los registros históricos que quedaron con el nombre viejo
app.post('/api/medicos/:id/unificar-nombre', adminMiddleware, async (req, res) => {
  const { nombre_anterior } = req.body;
  if (!nombre_anterior) return res.status(400).json({ error: 'Falta el nombre anterior' });
  const client = await pool.connect();
  try {
    const m = await client.query('SELECT nombre FROM medicos WHERE id=$1', [req.params.id]);
    if (!m.rows.length) return res.status(404).json({ error: 'Médico no encontrado' });
    const actual = m.rows[0].nombre;
    if (nombre_anterior === actual) return res.status(400).json({ error: 'Ese ya es el nombre del médico' });
    if (claveNombre(nombre_anterior) !== claveNombre(actual)) {
      return res.status(400).json({ error: 'Ese nombre corresponde a otra persona: solo se unifican variantes del mismo nombre' });
    }
    await client.query('BEGIN');
    await migrarNombreMedico(client, nombre_anterior, actual);
    await client.query('COMMIT');
    res.json({ ok: true, de: nombre_anterior, a: actual });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.patch('/api/medicos/:id', authMiddleware, async (req, res) => {
  const { nombre, matricula, especialidad, telefono } = req.body;
  const client = await pool.connect();
  try {
    const actual = await client.query('SELECT nombre FROM medicos WHERE id=$1', [req.params.id]);
    if (!actual.rows.length) return res.status(404).json({ error: 'Médico no encontrado' });
    const nombreViejo = actual.rows[0].nombre;
    const nombreNuevo = (nombre || '').trim();
    const renombra = !!nombreNuevo && nombreNuevo !== nombreViejo;

    // El nombre del médico se usa como clave en el login, en la asignación a turnos, en los
    // links de videollamada y en todas sus firmas. Si se cambia, hay que arrastrarlo a todos
    // lados en la misma transacción o el médico pierde sus turnos y sus firmas quedan sueltas.
    await client.query('BEGIN');
    await client.query(`UPDATE medicos SET
      nombre=COALESCE($1,nombre), matricula=COALESCE($2,matricula), especialidad=COALESCE($3,especialidad), telefono=COALESCE($4,telefono)
      WHERE id=$5`, [nombreNuevo || null, matricula||null, especialidad||null, telefono!==undefined?telefono:null, req.params.id]);

    if (renombra) await migrarNombreMedico(client, nombreViejo, nombreNuevo);
    await client.query('COMMIT');
    res.json({ ok: true, renombrado: renombra });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// Dar de alta o restablecer el acceso a la app de un médico ya cargado (login para firmar juntas)
app.post('/api/medicos/:id/acceso', adminMiddleware, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan email y contraseña' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  try {
    const m = await pool.query('SELECT nombre FROM medicos WHERE id=$1', [req.params.id]);
    if (!m.rows.length) return res.status(404).json({ error: 'Médico no encontrado' });
    await pool.query(
      `INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ($1,$2,$3,'medico')
       ON CONFLICT (email) DO UPDATE SET nombre=$1, password_hash=$3`,
      [m.rows[0].nombre, email.toLowerCase().trim(), hashPassword(password)]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== TURNOS =====
app.get('/api/turnos', authMiddleware, async (req, res) => {
  try {
    // El admin ve toda la agenda; cada médico ve únicamente los turnos en los que está
    // asignado. El array de médicos sigue trayendo a todos los del turno (para saber con
    // quién comparte la junta), por eso el filtro va como EXISTS y no sobre el JOIN.
    const esAdmin = req.usuario.rol === 'admin';
    const r = await pool.query(`
      SELECT t.*, COALESCE(array_agg(tm.medico_nombre) FILTER (WHERE tm.medico_nombre IS NOT NULL),'{}') as medicos
      FROM turnos t LEFT JOIN turno_medicos tm ON t.id=tm.turno_id
      ${esAdmin ? '' : 'WHERE EXISTS (SELECT 1 FROM turno_medicos a WHERE a.turno_id=t.id AND a.medico_nombre=$1)'}
      GROUP BY t.id ORDER BY t.fecha ASC, t.hora ASC
    `, esAdmin ? [] : [req.usuario.nombre]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Si el turno viene de un caso de ausentismo, el caso acompaña al turno solo. Siempre avanza,
// nunca retrocede, y no toca los casos ya resueltos o cancelados.
async function avanzarCasoDelTurno(turnoId, estado) {
  if (!turnoId) return;
  try {
    if (estado === 'en-curso') {
      await pool.query(`UPDATE casos_ausentismo SET estado='en-curso'
        WHERE turno_id=$1 AND estado IN ('asignado','programado')`, [turnoId]);
    } else if (estado === 'resuelto') {
      await pool.query(`UPDATE casos_ausentismo SET estado='resuelto', resuelto_en=NOW()
        WHERE turno_id=$1 AND estado IN ('asignado','programado','en-curso')`, [turnoId]);
    }
  } catch (err) { console.error('No se pudo avanzar el caso de ausentismo:', err.message); }
}

app.patch('/api/turnos/:id/estado', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE turnos SET estado=$1 WHERE id=$2', [req.body.estado, req.params.id]);
    if (req.body.estado === 'en-curso') await avanzarCasoDelTurno(req.params.id, 'en-curso');
    res.json({ ok: true });
  }
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
// Un token de reunión real (no un query param suelto) es lo único que hace que Daily complete
// user_name y owner en el webhook — de eso depende que el acta reconozca médico vs. paciente.
async function crearMeetingToken(roomName, userName, isOwner) {
  const resp = await fetch('https://api.daily.co/v1/meeting-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DAILY_API_KEY}` },
    body: JSON.stringify({ properties: { room_name: roomName, user_name: userName, is_owner: isOwner } })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'No se pudo crear el token de acceso');
  return data.token;
}

// Crea la sala de Daily, los links con token a nombre de cada uno y el turno.
// Lo usan tanto el alta de turnos como el módulo de ausentismo al programar la entrevista.
async function crearTurnoConVideollamada({ paciente, medicos: ml, tipo, fecha, hora, empresa, motivo,
  diagnostico_previo, dias_reposo_previo, medico_tratante, telefono, paciente_presencial }) {
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
  if (!resp.ok) { const e = new Error('No se pudo crear la sala de videollamada'); e.detalle = sala; throw e; }

  // Cada médico obtiene un link con un token real de moderador (owner) a su nombre
  const linksMedicos = await Promise.all((ml||[]).map(async n => ({
    nombre: n,
    link: `${sala.url}?t=${await crearMeetingToken(sala.name, n, true)}`
  })));
  // La paciente obtiene un link con un token real (no moderador) a su nombre
  const tokenPaciente = await crearMeetingToken(sala.name, paciente, false);
  const linkPaciente = `${sala.url}?t=${tokenPaciente}`;
  const linkMedicoGenerico = linksMedicos[0]?.link || sala.url;

  const turnoId = `turno-${Date.now()}`;
  await pool.query(`INSERT INTO turnos (id,paciente,fecha,hora,tipo,empresa,estado,sala,link_paciente,link_medico,links_medicos,motivo,diagnostico_previo,dias_reposo_previo,medico_tratante,telefono,paciente_presencial)
    VALUES ($1,$2,$3,$4,$5,$6,'pendiente',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [turnoId, paciente, fecha||new Date().toISOString().split('T')[0], hora||'', tipo||'Consulta', empresa||'',
     sala.name, linkPaciente, linkMedicoGenerico, JSON.stringify(linksMedicos), motivo||'',
     diagnostico_previo||'', parseInt(dias_reposo_previo)||0, medico_tratante||'', telefono||'', !!paciente_presencial]);
  for (const m of (ml||[])) await pool.query('INSERT INTO turno_medicos (turno_id,medico_nombre) VALUES ($1,$2) ON CONFLICT DO NOTHING', [turnoId, m]);

  return { turnoId, sala: sala.name, url: sala.url, linkPaciente, linkMedicoGenerico, linksMedicos };
}

app.post('/api/crear-sala', authMiddleware, async (req, res) => {
  try {
    const r = await crearTurnoConVideollamada(req.body);
    res.json({ ok: true, sala: r.sala, url: r.url, url_medico: r.linkMedicoGenerico,
      links_medicos: r.linksMedicos, turno_id: r.turnoId, paciente: req.body.paciente });
  } catch (err) { res.status(500).json({ error: err.message, detalle: err.detalle }); }
});

// ===== LINK DE VIDEOLLAMADA DEL USUARIO AUTENTICADO =====
// El navegador no tiene que adivinar qué link le toca a cada médico comparando nombres:
// eso hacía que dos médicos cuyos nombres empiezan igual (p. ej. "Dr. ...") terminaran
// entrando con el token del otro, y Daily los reportaba con el nombre equivocado.
// Acá el servidor busca por nombre exacto y, si el médico no tenía link (porque lo
// agregaron al turno después de crearlo), le genera uno a su nombre y lo guarda.
app.get('/api/turnos/:id/mi-link', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT sala, links_medicos, link_paciente, link_medico FROM turnos WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Turno no encontrado' });
    const t = r.rows[0];
    if (!t.sala) return res.status(400).json({ error: 'Este turno no tiene videollamada' });

    const asignado = await pool.query('SELECT 1 FROM turno_medicos WHERE turno_id=$1 AND medico_nombre=$2', [req.params.id, req.usuario.nombre]);
    if (!asignado.rows.length && req.usuario.rol !== 'admin') {
      return res.status(403).json({ error: 'No estás asignado a este turno' });
    }

    const links = Array.isArray(t.links_medicos) ? t.links_medicos
      : (typeof t.links_medicos === 'string' ? JSON.parse(t.links_medicos || '[]') : (t.links_medicos || []));
    const propio = links.find(l => l.nombre === req.usuario.nombre);
    if (propio) return res.json({ ok: true, link: propio.link });

    // Sin link propio: se emite uno a su nombre y queda guardado para las próximas veces.
    // La URL de la sala se saca de un link existente — nunca se arma a mano, porque el
    // dominio de Daily lo define la cuenta y adivinarlo daría un link roto sin avisar.
    const base = t.link_paciente || t.link_medico || links[0]?.link;
    if (!base) return res.status(500).json({ error: 'El turno no tiene la URL de la sala' });
    const urlSala = base.split('?')[0];
    const token = await crearMeetingToken(t.sala, req.usuario.nombre, true);
    const link = `${urlSala}?t=${token}`;
    links.push({ nombre: req.usuario.nombre, link });
    await pool.query('UPDATE turnos SET links_medicos=$1 WHERE id=$2', [JSON.stringify(links), req.params.id]);
    res.json({ ok: true, link, generado: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== TURNO PRESENCIAL (consulta en consultorio, sin videollamada de Daily) =====
app.post('/api/crear-turno-presencial', authMiddleware, async (req, res) => {
  try {
    const { paciente, medicos: ml, tipo, fecha, hora, empresa, motivo, diagnostico_previo, dias_reposo_previo, medico_tratante, telefono } = req.body;
    if (!paciente) return res.status(400).json({ error: 'Falta el paciente' });
    const turnoId = `turno-${Date.now()}`;
    await pool.query(`INSERT INTO turnos (id,paciente,fecha,hora,tipo,empresa,estado,motivo,diagnostico_previo,dias_reposo_previo,medico_tratante,telefono,modalidad,paciente_presencial)
      VALUES ($1,$2,$3,$4,$5,$6,'pendiente',$7,$8,$9,$10,$11,'presencial',true)`,
      [turnoId, paciente, fecha||new Date().toISOString().split('T')[0], hora||'', tipo||'Consulta', empresa||'',
       motivo||'', diagnostico_previo||'', parseInt(dias_reposo_previo)||0, medico_tratante||'', telefono||'']);
    for (const m of (ml||[])) await pool.query('INSERT INTO turno_medicos (turno_id,medico_nombre) VALUES ($1,$2) ON CONFLICT DO NOTHING', [turnoId, m]);
    res.json({ ok: true, turno_id: turnoId, paciente });
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
    // Emitir el informe es lo que cierra un caso de ausentismo: es lo que se factura
    await avanzarCasoDelTurno(turno_id, 'resuelto');
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
      medico, matricula, especialidad, paciente, empresa, sin_semiologico
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
        empresa=COALESCE($27,empresa), sin_semiologico=COALESCE($28,sin_semiologico)
        WHERE id=$29`,
        [aptitud, dias_reposo, derivacion, indicaciones, paciente_dni, edad,
         obra_social, profesion, antecedentes, hallazgos, conclusion,
         apellido_nombre, fecha_nacimiento, lugar_nacimiento, estado_civil,
         estudios, puesto, antiguedad, situacion_licencia, metodologia, analisis, diagnostico_cie,
         medico||null, matricula||null, especialidad||null, paciente||null, empresa||null,
         sin_semiologico === undefined ? null : !!sin_semiologico,
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
        diagnostico_cie=COALESCE($22,diagnostico_cie), sin_semiologico=COALESCE($23,sin_semiologico)
        WHERE id=$24`,
        [aptitud, dias_reposo, derivacion, indicaciones, paciente_dni, edad,
         obra_social, profesion, antecedentes, hallazgos, conclusion,
         apellido_nombre, fecha_nacimiento, lugar_nacimiento, estado_civil,
         estudios, puesto, antiguedad, situacion_licencia, metodologia, analisis, diagnostico_cie,
         sin_semiologico === undefined ? null : !!sin_semiologico,
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
    // Antes se agregaba sola una línea por médico diciendo "Evaluación remota vía MEDGRUP
    // Telemedicina". Sobraba —los profesionales ya constan al pie con su matrícula— y encima
    // era falsa cuando la evaluación fue presencial. La metodología la redacta el médico.
    const integrantesHtml = '';

    // Médicos asignados al turno: se listan al pie aunque todavía no hayan firmado ni
    // cargado dictamen propio, con la especialidad y matrícula de su perfil.
    const medicosDelTurno = d.turno_id
      ? (await pool.query('SELECT medico_nombre FROM turno_medicos WHERE turno_id=$1 ORDER BY medico_nombre', [d.turno_id])).rows.map(x => x.medico_nombre)
      : [];
    const nombresAlPie = [...new Set([...todos.map(m => m.medico), ...firmasJunta.map(f => f.medico_nombre), ...medicosDelTurno])].filter(Boolean);
    const perfilesPie = nombresAlPie.length
      ? (await pool.query('SELECT nombre, matricula, especialidad FROM medicos WHERE nombre = ANY($1::text[])', [nombresAlPie])).rows
      : [];
    const perfilPie = nombre => perfilesPie.find(p => p.nombre === nombre) || {};

    // Bloque de firmas: autor + otros dictámenes + firmas de junta (sin duplicar)
    const firmantesRender = [];
    for (const m of todos) {
      const esAutor = m.medico === d.medico;
      firmantesRender.push({
        nombre: m.medico,
        especialidad: m.especialidad || perfilPie(m.medico).especialidad || 'Medicina Laboral',
        matricula: m.matricula || perfilPie(m.medico).matricula || '',
        img: (esAutor && d.firma_doctor) ? d.firma_doctor : (m.firma_doctor || null)
      });
    }
    for (const f of firmasJunta) {
      if (!firmantesRender.some(x => x.nombre === f.medico_nombre)) {
        // Estos datos no los escribe el médico: son una copia automática de su perfil tomada
        // al firmar. Si en ese momento el perfil no se encontraba, quedó guardado el valor por
        // defecto "Medicina Laboral", así que manda lo que hoy figura en el perfil.
        firmantesRender.push({
          nombre: f.medico_nombre,
          especialidad: perfilPie(f.medico_nombre).especialidad || f.especialidad || 'Medicina Laboral',
          matricula: perfilPie(f.medico_nombre).matricula || f.matricula || '',
          img: f.firma_base64 || null
        });
      } else {
        // Ya está en la lista (p.ej. médico del turno sin dictamen propio): asignarle su firma
        const idx = firmantesRender.findIndex(x => x.nombre === f.medico_nombre);
        if (idx >= 0 && !firmantesRender[idx].img) firmantesRender[idx].img = f.firma_base64 || null;
      }
    }
    for (const nombre of medicosDelTurno) {
      if (firmantesRender.some(x => x.nombre === nombre)) continue;
      const p = perfilPie(nombre);
      firmantesRender.push({
        nombre,
        especialidad: p.especialidad || 'Medicina Laboral',
        matricula: p.matricula || '',
        img: null
      });
    }

    const firmasHtml = firmantesRender.map(m => {
      const firmaImg = m.img
        ? `<img src="data:image/png;base64,${m.img}" alt="firma" style="max-width:170px;max-height:52px;object-fit:contain;margin-bottom:2px;"/>`
        : `<div style="width:170px;border-bottom:1.5px solid #1a1916;margin:0 auto 6px;height:30px;"></div>`;
      return `<div style="text-align:center;flex:1;min-width:180px;">${firmaImg}<div style="font-size:12px;font-weight:600;">${m.nombre}</div><div style="font-size:10px;color:#5a5750;">${m.especialidad}</div><div style="font-size:9.5px;color:#9a9790;">${m.matricula?'MN/MP '+m.matricula:''}</div></div>`;
    }).join('');

    // Trazabilidad de firmas de junta para el pie del documento
    // El detalle de fecha, hora y hash de cada firma queda registrado en la base, pero no se
    // imprime en el documento: al pie alcanza con el código de verificación.
    const trazaFirmasHtml = '';
    // Las secciones vacías no se imprimen. Para que no queden huecos en la numeración
    // (III … V, como si faltara una sección), se numeran a medida que se van armando.
    let seccion = 0;
    const n = () => ++seccion;
    const romano = i => ['I','II','III','IV','V','VI','VII','VIII','IX','X'][i-1] || String(i);

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
    // El texto por defecto solo aplica a informes viejos que nunca tuvieron metodología cargada.
    // Si el médico la borró a propósito (queda como texto vacío), la sección no se imprime:
    // ese texto habla de un examen semiológico y de videollamada, y no siempre corresponde.
    const metodologia = (d.metodologia === null || d.metodologia === undefined)
      ? `Se procedió a la realización de una evaluación pericial semiestructurada por vía telemática el día de la fecha, bajo estricto encuadre profesional. El abordaje comprendió el examen semiológico directo, el rastreo de psicodinamismos, el análisis de factores etiológicos y psicopatológicos preexistentes, así como la compulsa de la documentación médica obrante en el legajo.\n\nSe deja expresa constancia de que el presente dictamen se emite en el marco de la legislación vigente de Medicina del Trabajo, garantizando el resguardo y la protección de los datos personales del examinado.`
      : d.metodologia;
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

<h2>${romano(n())}. Datos personales del evaluado</h2>
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

${metodologia?`<h2>${romano(n())}. Metodología adoptada</h2><p style="white-space:pre-wrap;">${metodologia}</p>${integrantesHtml ? `<ul>${integrantesHtml}</ul>` : ''}`:''}

${d.antecedentes?`<h2>${romano(n())}. Antecedentes médicos y clínicos generales</h2><p style="white-space:pre-wrap;">${d.antecedentes}</p>`:''}

${(d.hallazgos && !d.sin_semiologico)?`<h2>${romano(n())}. Examen semiológico (estado actual)</h2><p style="white-space:pre-wrap;">${d.hallazgos}</p>`:''}

${analisis?`<h2>${romano(n())}. Análisis médico-legal de la documentación</h2><p style="white-space:pre-wrap;">${analisis}</p>`:''}

<h2>${romano(n())}. Conclusiones médico-legales</h2>
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
    const medicosTurno = (await pool.query('SELECT medico_nombre FROM turno_medicos WHERE turno_id=$1 ORDER BY medico_nombre', [req.params.id])).rows.map(x=>x.medico_nombre);
    const firmasActa = (await pool.query('SELECT * FROM firmas_acta WHERE turno_id=$1', [req.params.id])).rows;
    // La fecha del turno es un DATE sin hora: si se la convierte a zona horaria argentina
    // (servidor en UTC) cae en el día anterior, así que se formatea desde sus componentes.
    const fechaISO = t.fecha instanceof Date
      ? `${t.fecha.getFullYear()}-${String(t.fecha.getMonth()+1).padStart(2,'0')}-${String(t.fecha.getDate()).padStart(2,'0')}`
      : String(t.fecha).split('T')[0];
    const fecha = new Date(fechaISO + 'T12:00:00Z').toLocaleDateString('es-AR', { day:'2-digit',month:'long',year:'numeric',timeZone:'UTC' });
    const fechaEmision = new Date().toLocaleDateString('es-AR', { day:'2-digit',month:'long',year:'numeric',timeZone:'America/Argentina/Buenos_Aires' });
    // Especialidad y matrícula salen del perfil del médico, así figuran al pie desde el
    // principio y no recién cuando firma.
    const perfilesMedicos = medicosTurno.length
      ? (await pool.query('SELECT nombre, matricula, especialidad FROM medicos WHERE nombre = ANY($1::text[])', [medicosTurno])).rows
      : [];
    const perfilDeMedico = nombre => perfilesMedicos.find(p => p.nombre === nombre) || {};
    const firmasActaHtml = medicosTurno.map(nombreMedico => {
      const f = firmasActa.find(x => !x.es_paciente && x.medico_nombre === nombreMedico);
      const perfil = perfilDeMedico(nombreMedico);
      // Matrícula y especialidad se copian solas del perfil al firmar: si en ese momento el
      // perfil no se encontraba quedó el valor por defecto, así que manda el perfil actual.
      const especialidad = perfil.especialidad || (f && f.especialidad) || 'Medicina Laboral';
      const matricula = perfil.matricula || (f && f.matricula) || '';
      const firmaImg = f
        ? `<img src="data:image/png;base64,${f.firma_base64}" alt="firma" style="max-width:150px;max-height:46px;object-fit:contain;margin-bottom:2px;"/>`
        : `<div class="firma-linea"></div>`;
      return `<div class="firma-item">${firmaImg}<div class="firma-nombre">${nombreMedico}</div><div class="firma-esp">${especialidad}</div><div class="firma-mat">${matricula?'MN/MP '+matricula:''}</div>${f?'':'<div class="firma-esp" style="color:#c8a800;margin-top:2px;">Firma pendiente</div>'}</div>`;
    }).join('') + (t.paciente_presencial && t.firma_paciente !== false ? (() => {
      const fp = firmasActa.find(x => x.es_paciente);
      const firmaImg = fp
        ? `<img src="data:image/png;base64,${fp.firma_base64}" alt="firma" style="max-width:150px;max-height:46px;object-fit:contain;margin-bottom:2px;"/>`
        : `<div class="firma-linea"></div>`;
      return `<div class="firma-item">${firmaImg}<div class="firma-nombre">${t.paciente}</div>${fp?'<div class="firma-esp">Paciente evaluado/a</div>':'<div class="firma-esp" style="color:#c8a800;">Firma pendiente</div>'}</div>`;
    })() : '');
    const esDeclaracionJurada = t.paciente_presencial === true;
    const tipoLabel = { inicio_medico:'Inicio de videoconsulta', union_medico:'Médico se incorporó a la consulta', union_paciente:'Paciente se incorporó a la consulta', fin_consulta:'Finalización de la consulta' };
    const tipoIcon = { inicio_medico:'▶', union_medico:'＋', union_paciente:'＋', fin_consulta:'■' };
    const eventosHtml = eventos.length ? eventos.map(e => {
      const hora = new Date(e.creado_en).toLocaleTimeString('es-AR', { hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'America/Argentina/Buenos_Aires' });
      return `<div class="ev-row"><div class="ev-hora">${hora}</div><div class="ev-icon">${tipoIcon[e.tipo]||'•'}</div><div class="ev-desc"><strong>${tipoLabel[e.tipo]||e.tipo}</strong>${e.participante?' — '+e.participante:''}</div></div>`;
    }).join('') : `<div style="color:#9a9790;font-size:12.5px;padding:12px 0;">Sin eventos de asistencia registrados.</div>`;

    const subtitulo = esDeclaracionJurada
      ? 'Declaración jurada de asistencia'
      : 'Constancia de asistencia mediante registro de eventos de la videoconsulta';
    // Caso mixto: la paciente estuvo presente pero al menos un profesional participó por videollamada.
    const comparecencia = t.modalidad === 'presencial'
      ? 'quien compareció físicamente ante los profesionales intervinientes'
      : 'quien compareció físicamente en el lugar de la evaluación, habiendo participado los profesionales intervinientes en forma presencial y/o remota mediante videoconferencia por la plataforma MEDGRUP';
    // Si el acta la suscriben solo los profesionales, el texto no puede seguir diciendo que
    // la firma de la evaluada consta al pie: sería afirmar algo que el documento no muestra.
    const firmaDeLaPaciente = esDeclaracionJurada && t.firma_paciente !== false;
    const cierreIntro = firmaDeLaPaciente
      ? 'cuya identidad y firma constan al pie del presente documento.'
      : 'quedando la presente suscripta por los profesionales actuantes, cuya identidad y firma constan al pie del presente documento.';
    const introParrafo = esDeclaracionJurada
      ? `Se deja constancia, en carácter de declaración jurada, de que en el día de la fecha se realizó, a solicitud de <strong>${t.empresa||'—'}</strong>, una evaluación médica correspondiente a la categoría <strong>${t.tipo||'Consulta médica'}</strong>. El/la evaluado/a fue el/la Sr./Sra. <strong>${t.paciente}</strong>, ${comparecencia}, ${cierreIntro}`
      : `Se deja constancia de que en el día de la fecha se realizó, a solicitud de <strong>${t.empresa||'—'}</strong>, una evaluación médica en modalidad de telemedicina a través de la plataforma MEDGRUP, correspondiente a la categoría <strong>${t.tipo||'Consulta médica'}</strong>. El/la evaluado/a fue el/la Sr./Sra. <strong>${t.paciente}</strong>.`;
    const seccionEventosHtml = esDeclaracionJurada ? '' : `<h2>Registro cronológico de asistencia</h2><div class="eventos-box">${eventosHtml}</div>`;
    const verifTexto = esDeclaracionJurada
      ? `Este documento certifica la asistencia en carácter de declaración jurada, suscripta mediante firma digital por los profesionales intervinientes${firmaDeLaPaciente?' y por la persona evaluada':''}.`
      : 'Este documento certifica la asistencia mediante el registro automático de eventos del sistema MEDGRUP, generado por la plataforma sin intervención manual.';

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
.firmas-row{display:flex;gap:30px;flex-wrap:wrap;margin-top:34px;padding-top:16px;border-top:1.5px solid #e8e4de;}
.firma-item{text-align:center;flex:1;min-width:160px;}
.firma-linea{width:160px;border-bottom:1.5px solid #1a1916;margin:0 auto 6px;height:28px;}
.firma-nombre{font-size:11.5px;font-weight:700;}
.firma-esp{font-size:10px;color:#5a5750;}
.firma-mat{font-size:9.5px;color:#9a9790;font-family:'DM Mono',sans-serif;}
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
<div class="subt">${subtitulo}</div>
<p>${introParrafo}</p>
<div class="datos-box">
  <div><div class="dato-label">Paciente</div><div class="dato-value">${t.paciente}</div></div>
  <div><div class="dato-label">Empresa</div><div class="dato-value">${t.empresa||'—'}</div></div>
  <div><div class="dato-label">Fecha del turno</div><div class="dato-value">${fecha}</div></div>
  <div><div class="dato-label">Tipo de consulta</div><div class="dato-value">${t.tipo||'—'}${t.modalidad==='presencial'?' (Presencial)':(t.paciente_presencial?' (Paciente presente)':'')}</div></div>
</div>
${seccionEventosHtml}
${firmasActaHtml ? `<div class="firmas-row">${firmasActaHtml}</div>` : ''}
<div class="verif">${verifTexto}</div>
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
  // Declarado afuera del try para poder cancelarlo en el finally pase lo que pase
  let corte = null;
  try {
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key de IA no configurada. Agregá ANTHROPIC_API_KEY en las variables de entorno de Railway.' });
    const { system, messages, max_tokens } = req.body;

    // Sin límite de tiempo, si la IA no contesta la petición queda colgada para siempre y
    // al médico le queda el botón girando sin decirle nunca qué pasó.
    const control = new AbortController();
    corte = setTimeout(() => control.abort(), IA_TIMEOUT_MS);
    const arranque = Date.now();
    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: control.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: max_tokens || 8000,
          system,
          messages,
          // Pedimos la respuesta por partes: si esperamos callados a que termine, el proxy
          // de Railway corta la conexión por inactividad y devuelve un 502 que no dice nada.
          stream: true
        })
      });
    } catch (err) {
      if (err.name === 'AbortError' || control.signal.aborted) {
        console.error(`IA: sin respuesta tras ${IA_TIMEOUT_MS/1000}s`);
        return res.status(504).json({ error: `La IA no respondió en ${Math.round(IA_TIMEOUT_MS/1000)} segundos. Volvé a intentar; si sigue igual, guardá las notas y avisá.` });
      }
      throw err;
    }
    // Ojo: el reloj NO se cancela acá. Tiene que seguir corriendo durante toda la
    // transmisión, que es donde la generación realmente se puede trabar.

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.error(`Anthropic API error (${response.status}):`, JSON.stringify(data));
      return res.status(response.status).json({ error: data.error?.message || 'Error de la IA' });
    }

    // Le vamos pasando el informe al navegador a medida que llega, una línea JSON por vez.
    // Mientras haya bytes en camino ningún proxy corta la conexión por inactividad.
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const enviar = obj => res.write(JSON.stringify(obj) + '\n');

    let pendiente = '', texto = '', fin = null, tokens = 0;
    try {
      for await (const trozo of response.body) {
        pendiente += trozo.toString('utf8');
        const lineas = pendiente.split('\n');
        pendiente = lineas.pop();
        for (const linea of lineas) {
          if (!linea.startsWith('data:')) continue;
          let ev; try { ev = JSON.parse(linea.slice(5).trim()); } catch { continue; }
          if (ev.type === 'content_block_delta' && ev.delta?.text) {
            texto += ev.delta.text;
            enviar({ t: ev.delta.text });
          } else if (ev.type === 'message_delta') {
            if (ev.delta?.stop_reason) fin = ev.delta.stop_reason;
            if (ev.usage?.output_tokens) tokens = ev.usage.output_tokens;
          } else if (ev.type === 'error') {
            fin = 'error';
            enviar({ error: ev.error?.message || 'Error de la IA durante la generación' });
          }
        }
      }
    } catch (err) {
      const aborto = err.name === 'AbortError' || control.signal.aborted;
      console.error('IA: se cortó la transmisión:', err.message);
      enviar({ error: aborto
        ? `La IA no terminó en ${Math.round(IA_TIMEOUT_MS/1000)} segundos. Volvé a intentar.`
        : 'Se cortó la conexión con la IA antes de terminar el informe.' });
      return res.end();
    }

    const tardo = Math.round((Date.now() - arranque) / 1000);
    if (fin === 'max_tokens') {
      console.error(`IA: respuesta cortada por max_tokens (${tardo}s)`);
      enviar({ error: 'El informe salió más largo de lo que entra en una respuesta y quedó cortado. Probá acortando las notas o generalo en dos partes.' });
    } else if (fin !== 'error') {
      console.log(`IA OK en ${tardo}s · ${tokens||'?'} tokens · ${texto.substring(0,200)}`);
      enviar({ fin: fin || 'end_turn' });
    }
    res.end();
  } catch (err) {
    console.error('Proxy IA error:', err.message);
    if (res.headersSent) { res.write(JSON.stringify({ error: err.message }) + '\n'); return res.end(); }
    res.status(500).json({ error: err.message });
  } finally { clearTimeout(corte); }
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

// ===== CONTROL DE AUSENTISMO =====
// La empresa abre un caso, MEDGRUP le asigna un profesional, el profesional entrevista al
// trabajador y emite el informe. Se cobra por caso resuelto.
const ESTADOS_CASO = ['nuevo', 'asignado', 'programado', 'en-curso', 'resuelto', 'cancelado'];
// Un caso avanza por estos caminos; cancelar se permite desde cualquier estado no terminal.
const TRANSICIONES_CASO = {
  'nuevo':      ['asignado', 'cancelado'],
  'asignado':   ['programado', 'nuevo', 'cancelado'],
  'programado': ['en-curso', 'asignado', 'cancelado'],
  'en-curso':   ['resuelto', 'programado', 'cancelado'],
  'resuelto':   [],
  'cancelado':  ['nuevo']
};

const SELECT_CASO = `
  SELECT c.*, m.nombre AS profesional_nombre, m.matricula AS profesional_matricula,
         m.especialidad AS profesional_especialidad,
         t.fecha AS turno_fecha, t.hora AS turno_hora, t.estado AS turno_estado,
         (SELECT COUNT(*) FROM certificados_ausentismo ce WHERE ce.caso_id = c.id) AS certificados
  FROM casos_ausentismo c
  LEFT JOIN medicos m ON m.id = c.profesional_id
  LEFT JOIN turnos  t ON t.id = c.turno_id`;

// El profesional se identifica por su perfil de médico, no por el nombre suelto
async function medicoDelUsuario(usuario) {
  const r = await pool.query('SELECT id FROM medicos WHERE nombre=$1 AND activo=true LIMIT 1', [usuario.nombre]);
  return r.rows[0]?.id || null;
}

async function puedeVerCaso(caso, req) {
  if (req.usuario.rol === 'admin') return true;
  const miId = await medicoDelUsuario(req.usuario);
  return !!miId && caso.profesional_id === miId;
}

// --- Listado: el admin ve todo, el médico solo lo que tiene asignado ---
app.get('/api/ausentismo/casos', authMiddleware, async (req, res) => {
  try {
    const cond = [], params = [];
    if (req.usuario.rol !== 'admin') {
      const miId = await medicoDelUsuario(req.usuario);
      if (!miId) return res.json({ ok: true, casos: [] });
      params.push(miId); cond.push(`c.profesional_id = $${params.length}`);
    }
    if (req.query.estado)  { params.push(req.query.estado);  cond.push(`c.estado = $${params.length}`); }
    if (req.query.empresa) { params.push(req.query.empresa); cond.push(`c.empresa_nombre = $${params.length}`); }
    if (req.query.mes)     { params.push(req.query.mes);     cond.push(`to_char(c.creado_en,'YYYY-MM') = $${params.length}`); }
    const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';
    const r = await pool.query(`${SELECT_CASO}${where} ORDER BY c.creado_en DESC`, params);
    res.json({ ok: true, casos: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ausentismo/casos/:id', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`${SELECT_CASO} WHERE c.id = $1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Caso no encontrado' });
    if (!(await puedeVerCaso(r.rows[0], req))) return res.status(403).json({ error: 'Este caso no está asignado a vos' });
    res.json({ ok: true, caso: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Alta desde MEDGRUP (la empresa tiene su propio endpoint más abajo) ---
app.post('/api/ausentismo/casos', adminMiddleware, async (req, res) => {
  const { empresa_nombre, trabajador_nombre, trabajador_dni, trabajador_telefono, motivo, documentacion, notas_admin,
          domicilio, domicilio_lat, domicilio_lng, radio_metros } = req.body;
  if (!empresa_nombre) return res.status(400).json({ error: 'Falta la empresa' });
  if (!trabajador_nombre) return res.status(400).json({ error: 'Falta el nombre del trabajador' });
  try {
    const emp = await pool.query('SELECT id FROM empresas_clientes WHERE nombre=$1 LIMIT 1', [empresa_nombre]);
    // Si mandaron la dirección sin coordenadas, se resuelve acá para que el control quede listo
    let lat = domicilio_lat ?? null, lng = domicilio_lng ?? null, motivoGeo = null;
    if (domicilio && lat == null) {
      const g = await geocodificar(domicilio);
      if (g.punto) { lat = g.punto.lat; lng = g.punto.lng; } else { motivoGeo = g.motivo; }
    }
    const r = await pool.query(
      `INSERT INTO casos_ausentismo (empresa_id, empresa_nombre, trabajador_nombre, trabajador_dni, trabajador_telefono, motivo, documentacion, notas_admin,
                                     domicilio, domicilio_lat, domicilio_lng, radio_metros)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [emp.rows[0]?.id || null, empresa_nombre, trabajador_nombre.trim(), trabajador_dni || '', trabajador_telefono || '',
       motivo || '', documentacion || '', notas_admin || '',
       domicilio || '', lat, lng, radio_metros || RADIO_POR_DEFECTO]);
    res.json({ ok: true, id: r.rows[0].id, domicilio_ubicado: lat != null, motivo_geocode: motivoGeo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Edición de datos del caso (no cambia estado ni profesional: eso tiene su propia ruta) ---
app.patch('/api/ausentismo/casos/:id', adminMiddleware, async (req, res) => {
  const { trabajador_nombre, trabajador_dni, trabajador_telefono, motivo, documentacion, notas_admin, empresa_nombre,
          domicilio, domicilio_lat, domicilio_lng, radio_metros } = req.body;
  try {
    const chk = await pool.query('SELECT id, domicilio FROM casos_ausentismo WHERE id=$1', [req.params.id]);
    if (!chk.rows.length) return res.status(404).json({ error: 'Caso no encontrado' });
    let empresaId;
    if (empresa_nombre) {
      const emp = await pool.query('SELECT id FROM empresas_clientes WHERE nombre=$1 LIMIT 1', [empresa_nombre]);
      empresaId = emp.rows[0]?.id || null;
    }
    // Las coordenadas siguen a la dirección: si cambió el texto y no vinieron a mano, se
    // vuelven a resolver, y si la dirección se borra las coordenadas se van con ella.
    let lat = domicilio_lat ?? null, lng = domicilio_lng ?? null, motivoGeo = null;
    let tocaCoords = domicilio_lat !== undefined;
    if (domicilio !== undefined && domicilio !== chk.rows[0].domicilio && domicilio_lat === undefined) {
      tocaCoords = true;
      if (domicilio) {
        const g = await geocodificar(domicilio);
        if (g.punto) { lat = g.punto.lat; lng = g.punto.lng; } else { motivoGeo = g.motivo; }
      }
    }
    await pool.query(
      `UPDATE casos_ausentismo SET
         empresa_nombre      = COALESCE($1, empresa_nombre),
         empresa_id          = CASE WHEN $1::text IS NULL THEN empresa_id ELSE $2 END,
         trabajador_nombre   = COALESCE($3, trabajador_nombre),
         trabajador_dni      = COALESCE($4, trabajador_dni),
         trabajador_telefono = COALESCE($5, trabajador_telefono),
         motivo              = COALESCE($6, motivo),
         documentacion       = COALESCE($7, documentacion),
         notas_admin         = COALESCE($8, notas_admin),
         domicilio           = COALESCE($9, domicilio),
         domicilio_lat       = CASE WHEN $10::boolean THEN $11 ELSE domicilio_lat END,
         domicilio_lng       = CASE WHEN $10::boolean THEN $12 ELSE domicilio_lng END,
         radio_metros        = COALESCE($13, radio_metros)
       WHERE id = $14`,
      [empresa_nombre || null, empresaId ?? null, trabajador_nombre || null, trabajador_dni ?? null,
       trabajador_telefono ?? null, motivo ?? null, documentacion ?? null, notas_admin ?? null,
       domicilio ?? null, tocaCoords, lat, lng, radio_metros || null, req.params.id]);
    res.json({ ok: true, domicilio_ubicado: tocaCoords ? lat != null : undefined, motivo_geocode: motivoGeo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/ausentismo/casos/:id', adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM casos_ausentismo WHERE id=$1 RETURNING trabajador_nombre', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Caso no encontrado' });
    res.json({ ok: true, trabajador: r.rows[0].trabajador_nombre });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Asignar o reasignar el profesional ---
app.post('/api/ausentismo/casos/:id/asignar', adminMiddleware, async (req, res) => {
  const { profesional_id } = req.body;
  try {
    const caso = await pool.query('SELECT estado FROM casos_ausentismo WHERE id=$1', [req.params.id]);
    if (!caso.rows.length) return res.status(404).json({ error: 'Caso no encontrado' });
    if (['resuelto', 'cancelado'].includes(caso.rows[0].estado)) {
      return res.status(400).json({ error: 'El caso ya está cerrado' });
    }
    if (!profesional_id) {
      // Desasignar: vuelve a la bandeja de casos nuevos
      await pool.query(`UPDATE casos_ausentismo SET profesional_id=NULL, estado='nuevo' WHERE id=$1`, [req.params.id]);
      return res.json({ ok: true, estado: 'nuevo' });
    }
    const m = await pool.query('SELECT nombre FROM medicos WHERE id=$1 AND activo=true', [profesional_id]);
    if (!m.rows.length) return res.status(400).json({ error: 'Ese profesional no existe o está inactivo' });
    // Si ya estaba más avanzado, reasignar no lo hace retroceder
    const nuevoEstado = caso.rows[0].estado === 'nuevo' ? 'asignado' : caso.rows[0].estado;
    await pool.query('UPDATE casos_ausentismo SET profesional_id=$1, estado=$2 WHERE id=$3',
      [profesional_id, nuevoEstado, req.params.id]);
    res.json({ ok: true, profesional: m.rows[0].nombre, estado: nuevoEstado });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Cambio de estado, respetando el circuito ---
app.patch('/api/ausentismo/casos/:id/estado', authMiddleware, async (req, res) => {
  const { estado } = req.body;
  if (!ESTADOS_CASO.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    const r = await pool.query('SELECT * FROM casos_ausentismo WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Caso no encontrado' });
    const caso = r.rows[0];
    if (!(await puedeVerCaso(caso, req))) return res.status(403).json({ error: 'Este caso no está asignado a vos' });

    if (estado === caso.estado) return res.json({ ok: true, estado });
    if (!TRANSICIONES_CASO[caso.estado].includes(estado)) {
      return res.status(400).json({ error: `Un caso "${caso.estado}" no puede pasar a "${estado}"` });
    }
    if (estado === 'asignado' && !caso.profesional_id) {
      return res.status(400).json({ error: 'Asigná un profesional antes de avanzar el caso' });
    }
    // resuelto_en es lo que después se factura, así que se sella acá y se limpia si vuelve atrás
    await pool.query(
      `UPDATE casos_ausentismo SET estado=$1, resuelto_en = CASE WHEN $1='resuelto' THEN NOW() ELSE NULL END WHERE id=$2`,
      [estado, req.params.id]);
    res.json({ ok: true, estado });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CONTROL DOMICILIARIO POR UBICACIÓN =====
// El reposo del trabajador es en su domicilio, así que al entrar a la entrevista se compara
// la posición que reporta su dispositivo contra la del domicilio que cargó la empresa.
// La decisión de aceptar o rechazar es SIEMPRE del servidor: el navegador solo aporta el dato.
const RADIO_POR_DEFECTO = 300;   // metros
const PRECISION_MAXIMA = 200;    // si el margen de error supera esto, no es una lectura de GPS

// Distancia sobre la superficie terrestre entre dos coordenadas, en metros (Haversine)
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Un problema de configuración de la clave y una dirección mal escrita fallan igual desde
// afuera, así que se traduce el estado que devuelve Google en algo accionable.
const MOTIVOS_GEOCODE = {
  ZERO_RESULTS:            'No se pudo ubicar esa dirección. Probá agregando la ciudad y la provincia.',
  REQUEST_DENIED:          'Google rechazó la consulta. Suele ser porque la Geocoding API no está habilitada en el proyecto, porque falta activar la facturación, o porque la clave quedó restringida a "Sitios web" (tiene que ser una clave de servidor, sin restricción por URL).',
  OVER_QUERY_LIMIT:        'Se agotó la cuota de Google por hoy. Cargá las coordenadas a mano y revisá la facturación del proyecto.',
  OVER_DAILY_LIMIT:        'Google no está aceptando consultas con esta clave. Revisá que el proyecto tenga la facturación activa.',
  INVALID_REQUEST:         'La dirección quedó vacía o mal formada.',
  UNKNOWN_ERROR:           'Google tuvo un problema momentáneo. Probá de nuevo en unos segundos.'
};

// Convierte una dirección escrita en coordenadas. La clave vive solo en el servidor.
// Devuelve siempre { punto, motivo }: punto en null significa que no se pudo ubicar, y el
// caso igual se guarda, pero sin control por ubicación.
async function geocodificar(direccion) {
  if (!direccion || !direccion.trim()) return { punto: null, motivo: MOTIVOS_GEOCODE.INVALID_REQUEST };
  if (!GOOGLE_MAPS_API_KEY) return { punto: null, motivo: 'Falta configurar GOOGLE_MAPS_API_KEY en Railway.' };
  try {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' +
      encodeURIComponent(direccion.trim()) + '&region=ar&key=' + GOOGLE_MAPS_API_KEY;
    const r = await fetch(url);
    const data = await r.json();
    if (data.status !== 'OK' || !data.results?.length) {
      // El detalle de Google (error_message) solo se loguea: puede filtrar datos del proyecto
      console.error('Geocode falló:', data.status, data.error_message || '');
      return { punto: null, estado: data.status,
        motivo: MOTIVOS_GEOCODE[data.status] || `Google respondió "${data.status}".` };
    }
    const loc = data.results[0].geometry.location;
    return { punto: { lat: loc.lat, lng: loc.lng, normalizada: data.results[0].formatted_address } };
  } catch (err) {
    console.error('Geocode sin respuesta:', err.message);
    return { punto: null, motivo: 'No pudimos comunicarnos con Google. Probá de nuevo.' };
  }
}

app.post('/api/geocode', authMedgrupOEmpresa, async (req, res) => {
  const { direccion } = req.body;
  if (!direccion || !direccion.trim()) return res.status(400).json({ error: 'Escribí la dirección' });
  if (!GOOGLE_MAPS_API_KEY) {
    return res.status(503).json({ code:'SIN_CLAVE', error: 'Falta configurar GOOGLE_MAPS_API_KEY en Railway. Mientras tanto podés pegar las coordenadas a mano.' });
  }
  const { punto, motivo, estado } = await geocodificar(direccion);
  if (!punto) return res.status(400).json({ code: estado === 'ZERO_RESULTS' ? 'NO_ENCONTRADA' : 'GEOCODE_FALLO', error: motivo });
  res.json({ ok: true, lat: punto.lat, lng: punto.lng, direccion_normalizada: punto.normalizada });
});

// Página a la que entra el trabajador. El link lleva un token al azar porque el id del turno
// es adivinable, y sin esto cualquiera podría probar entradas ajenas.
app.get('/ingreso/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ingreso.html')));

app.get('/api/ingreso/:token', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.trabajador_nombre, c.domicilio, c.domicilio_lat, c.estado, t.fecha, t.hora
      FROM casos_ausentismo c LEFT JOIN turnos t ON t.id = c.turno_id
      WHERE c.token_ingreso=$1`, [req.params.token]);
    if (!r.rows.length) return res.status(404).json({ error: 'Este link no es válido o ya venció.' });
    const c = r.rows[0];
    res.json({ ok: true, trabajador: c.trabajador_nombre, fecha: c.fecha, hora: c.hora,
      domicilio: c.domicilio || null, tiene_domicilio: c.domicilio_lat != null,
      cerrado: ['resuelto','cancelado'].includes(c.estado) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ingreso/:token/verificar', async (req, res) => {
  const { lat, lng, precision } = req.body || {};
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
  let caso = null;
  const registrar = (resultado, distancia) => pool.query(
    `INSERT INTO ingresos_ubicacion (caso_id, turno_id, lat, lng, precision_metros, distancia_metros, resultado, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [caso?.id || null, caso?.turno_id || null, lat ?? null, lng ?? null, precision ?? null,
     distancia ?? null, resultado, ip]).catch(()=>{});
  try {
    const r = await pool.query(`
      SELECT c.*, t.link_paciente
      FROM casos_ausentismo c LEFT JOIN turnos t ON t.id = c.turno_id
      WHERE c.token_ingreso=$1`, [req.params.token]);
    if (!r.rows.length) return res.status(404).json({ code:'LINK_INVALIDO', error: 'Este link no es válido o ya venció.' });
    caso = r.rows[0];

    if (['resuelto','cancelado'].includes(caso.estado)) {
      await registrar('caso_cerrado', null);
      return res.status(403).json({ code:'CASO_CERRADO', error: 'Esta entrevista ya está cerrada.' });
    }
    if (!caso.link_paciente) {
      await registrar('sin_entrevista', null);
      return res.status(403).json({ code:'SIN_ENTREVISTA', error: 'Todavía no hay una entrevista programada. Aguardá a que te avisemos.' });
    }
    if (caso.domicilio_lat == null || caso.domicilio_lng == null) {
      await registrar('domicilio_sin_coordenadas', null);
      return res.status(403).json({ code:'SIN_DOMICILIO', error: 'Tu domicilio todavía no está verificado en el sistema. Avisale a tu empresa.' });
    }
    if (lat == null || lng == null) {
      await registrar('sin_ubicacion', null);
      return res.status(403).json({ code:'SIN_UBICACION', error: 'No pudimos obtener tu ubicación. Activá el GPS y permití el acceso a la ubicación para poder ingresar.' });
    }
    if (precision != null && precision > PRECISION_MAXIMA) {
      await registrar('precision_baja', null);
      return res.status(403).json({ code:'PRECISION_BAJA', precision: Math.round(precision),
        error: `La señal de ubicación es muy débil (margen de ${Math.round(precision)} m). Salí al exterior o acercate a una ventana y volvé a intentar.` });
    }

    const radio = caso.radio_metros || RADIO_POR_DEFECTO;
    const distancia = distanciaMetros(lat, lng, caso.domicilio_lat, caso.domicilio_lng);
    if (distancia > radio) {
      await registrar('fuera_de_rango', distancia);
      return res.status(403).json({ code:'FUERA_DE_RANGO', distancia: Math.round(distancia), radio,
        error: `Estás a ${Math.round(distancia)} m de tu domicilio. El control es domiciliario, así que tenés que estar a menos de ${radio} m para ingresar.` });
    }

    await registrar('aceptado', distancia);
    res.json({ ok: true, link: caso.link_paciente, distancia: Math.round(distancia) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Historial de intentos: es la prueba de que el trabajador estaba (o no) en su domicilio,
// así que el profesional que lleva el caso lo tiene a mano al redactar el informe.
app.get('/api/ausentismo/casos/:id/ingresos', authMiddleware, async (req, res) => {
  try {
    const c = await pool.query('SELECT * FROM casos_ausentismo WHERE id=$1', [req.params.id]);
    if (!c.rows.length) return res.status(404).json({ error: 'Caso no encontrado' });
    if (!(await puedeVerCaso(c.rows[0], req))) return res.status(403).json({ error: 'Este caso no está asignado a vos' });
    const r = await pool.query(
      `SELECT id, lat, lng, precision_metros, distancia_metros, resultado, ip, creado_en
       FROM ingresos_ubicacion WHERE caso_id=$1 ORDER BY creado_en DESC`, [req.params.id]);
    res.json({ ok: true, ingresos: r.rows, radio: c.rows[0].radio_metros || RADIO_POR_DEFECTO });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Certificados médicos adjuntos al caso ---
// Los sube tanto la empresa (que es quien los recibe del trabajador) como MEDGRUP, así que
// estos endpoints aceptan las dos sesiones y después se fija quién puede ver ese caso.
const CERT_MAX_BYTES = 5 * 1024 * 1024;
const CERT_TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function authMedgrupOEmpresa(req, res, next) {
  const t = req.headers['x-session-token'];
  const e = req.headers['x-empresa-token'];
  if (t && sessions[t]) { req.usuario = sessions[t]; return next(); }
  if (e && empresaSessions[e]) { req.empresa = empresaSessions[e]; return next(); }
  return res.status(401).json({ error: 'No autorizado', needsLogin: true });
}

// Devuelve el caso si quien pregunta puede verlo, false si no, y null si no existe
async function casoVisiblePara(casoId, req) {
  const r = await pool.query('SELECT id, empresa_nombre, profesional_id, trabajador_nombre FROM casos_ausentismo WHERE id=$1', [casoId]);
  if (!r.rows.length) return null;
  const caso = r.rows[0];
  if (req.empresa) return caso.empresa_nombre === req.empresa.nombre ? caso : false;
  if (req.usuario.rol === 'admin') return caso;
  const miId = await medicoDelUsuario(req.usuario);
  return (miId && caso.profesional_id === miId) ? caso : false;
}

app.post('/api/ausentismo/casos/:id/certificados', authMedgrupOEmpresa, async (req, res) => {
  try {
    const caso = await casoVisiblePara(req.params.id, req);
    if (caso === null) return res.status(404).json({ error: 'Caso no encontrado' });
    if (caso === false) return res.status(403).json({ error: 'No tenés acceso a este caso' });

    const { nombre_archivo, tipo_mime, archivo_base64 } = req.body;
    if (!archivo_base64 || !nombre_archivo) return res.status(400).json({ error: 'Falta el archivo' });
    if (tipo_mime && !CERT_TIPOS.includes(tipo_mime)) {
      return res.status(400).json({ error: 'Solo se aceptan archivos PDF, JPG, PNG o WEBP' });
    }
    const limpio = archivo_base64.replace(/^data:[^;]+;base64,/, '');
    const bytes = Math.round(limpio.length * 3 / 4);
    if (bytes > CERT_MAX_BYTES) {
      return res.status(413).json({ error: `El archivo pesa ${(bytes/1024/1024).toFixed(1)} MB y el máximo es 5 MB. Sacale una foto con menos calidad o comprimí el PDF.` });
    }
    const quien = req.empresa ? `${req.empresa.nombre} (empresa)` : req.usuario.nombre;
    const r = await pool.query(
      `INSERT INTO certificados_ausentismo (caso_id, nombre_archivo, tipo_mime, tamano_bytes, archivo_base64, subido_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, creado_en`,
      [req.params.id, String(nombre_archivo).slice(0, 300), tipo_mime || '', bytes, limpio, quien]);
    res.json({ ok: true, id: r.rows[0].id, creado_en: r.rows[0].creado_en });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ausentismo/casos/:id/certificados', authMedgrupOEmpresa, async (req, res) => {
  try {
    const caso = await casoVisiblePara(req.params.id, req);
    if (caso === null) return res.status(404).json({ error: 'Caso no encontrado' });
    if (caso === false) return res.status(403).json({ error: 'No tenés acceso a este caso' });
    // Sin el archivo: el listado tiene que ser liviano
    const r = await pool.query(
      `SELECT id, nombre_archivo, tipo_mime, tamano_bytes, subido_por, creado_en
       FROM certificados_ausentismo WHERE caso_id=$1 ORDER BY creado_en ASC`, [req.params.id]);
    res.json({ ok: true, certificados: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ausentismo/certificados/:certId', authMedgrupOEmpresa, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM certificados_ausentismo WHERE id=$1', [req.params.certId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Certificado no encontrado' });
    const cert = r.rows[0];
    const caso = await casoVisiblePara(cert.caso_id, req);
    if (!caso) return res.status(403).json({ error: 'No tenés acceso a este certificado' });

    const buf = Buffer.from(cert.archivo_base64, 'base64');
    res.setHeader('Content-Type', cert.tipo_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(cert.nombre_archivo||'certificado').replace(/"/g,'')}"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/ausentismo/certificados/:certId', adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM certificados_ausentismo WHERE id=$1 RETURNING nombre_archivo', [req.params.certId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Certificado no encontrado' });
    res.json({ ok: true, nombre: r.rows[0].nombre_archivo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Programar la entrevista: crea la videollamada y engancha el caso al flujo de turnos ---
// Lo hace el profesional asignado (o el admin). A partir de acá el caso vive como un turno
// normal: videollamada, informe, firma y PDF, sin nada especial.
app.post('/api/ausentismo/casos/:id/programar', authMiddleware, async (req, res) => {
  const { fecha, hora } = req.body;
  if (!fecha || !hora) return res.status(400).json({ error: 'Indicá fecha y hora de la entrevista' });
  try {
    const r = await pool.query(`
      SELECT c.*, m.nombre AS profesional_nombre
      FROM casos_ausentismo c LEFT JOIN medicos m ON m.id = c.profesional_id
      WHERE c.id = $1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Caso no encontrado' });
    const caso = r.rows[0];
    if (!(await puedeVerCaso(caso, req))) return res.status(403).json({ error: 'Este caso no está asignado a vos' });
    if (['resuelto', 'cancelado'].includes(caso.estado)) return res.status(400).json({ error: 'El caso ya está cerrado' });
    if (!caso.profesional_id) return res.status(400).json({ error: 'El caso todavía no tiene profesional asignado' });

    // El trabajador entra por una página nuestra, no directo a la videollamada: ahí se le
    // pide la ubicación. Si tuviera el link de Daily se saltearía el control domiciliario.
    let token = caso.token_ingreso;
    if (!token) {
      token = crypto.randomBytes(24).toString('hex');
      await pool.query('UPDATE casos_ausentismo SET token_ingreso=$1 WHERE id=$2', [token, req.params.id]);
    }
    const linkIngreso = `${req.protocol}://${req.get('host')}/ingreso/${token}`;

    // Reprogramar: si ya tenía entrevista se mueve la fecha, no se crea otra sala
    if (caso.turno_id) {
      await pool.query('UPDATE turnos SET fecha=$1, hora=$2 WHERE id=$3', [fecha, hora, caso.turno_id]);
      return res.json({ ok: true, turno_id: caso.turno_id, link_paciente: linkIngreso, reprogramado: true });
    }

    const creado = await crearTurnoConVideollamada({
      paciente: caso.trabajador_nombre,
      medicos: [caso.profesional_nombre],
      tipo: 'Control de ausentismo',
      fecha, hora,
      empresa: caso.empresa_nombre,
      motivo: caso.motivo || '',
      telefono: caso.trabajador_telefono || ''
    });
    await pool.query(`UPDATE casos_ausentismo SET turno_id=$1, estado='programado' WHERE id=$2`,
      [creado.turnoId, req.params.id]);
    // Se devuelve el link de ingreso, no el de Daily: el de Daily se entrega recién
    // cuando el trabajador confirma que está en su domicilio.
    res.json({ ok: true, turno_id: creado.turnoId, link_paciente: linkIngreso, estado: 'programado' });
  } catch (err) { res.status(500).json({ error: err.message, detalle: err.detalle }); }
});

// --- Facturación: casos resueltos del mes, agrupados por empresa ---
app.get('/api/ausentismo/facturacion', adminMiddleware, async (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7); // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Mes inválido, se espera AAAA-MM' });
  try {
    const r = await pool.query(`
      SELECT c.id, c.empresa_nombre, c.trabajador_nombre, c.trabajador_dni, c.resuelto_en,
             m.nombre AS profesional_nombre
      FROM casos_ausentismo c
      LEFT JOIN medicos m ON m.id = c.profesional_id
      WHERE c.estado = 'resuelto' AND to_char(c.resuelto_en,'YYYY-MM') = $1
      ORDER BY c.empresa_nombre, c.resuelto_en`, [mes]);

    const porEmpresa = {};
    for (const c of r.rows) {
      if (!porEmpresa[c.empresa_nombre]) porEmpresa[c.empresa_nombre] = { empresa: c.empresa_nombre, casos: [], cantidad: 0 };
      porEmpresa[c.empresa_nombre].casos.push(c);
      porEmpresa[c.empresa_nombre].cantidad++;
    }
    res.json({ ok: true, mes, total_casos: r.rows.length, empresas: Object.values(porEmpresa) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Portal de la empresa: abre casos y sigue los suyos ---
app.post('/api/empresa/ausentismo/casos', empresaAuthMiddleware, async (req, res) => {
  const { trabajador_nombre, trabajador_dni, trabajador_telefono, motivo, documentacion, domicilio } = req.body;
  if (!trabajador_nombre || !trabajador_nombre.trim()) return res.status(400).json({ error: 'Falta el nombre del trabajador' });
  if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'Contanos el motivo de la ausencia' });
  try {
    // El reposo es domiciliario, así que la dirección que carga la empresa se resuelve a
    // coordenadas ya en el alta. Si no se puede ubicar, el caso se abre igual y avisamos.
    const g = domicilio ? await geocodificar(domicilio) : { punto: null };
    const r = await pool.query(
      `INSERT INTO casos_ausentismo (empresa_id, empresa_nombre, trabajador_nombre, trabajador_dni, trabajador_telefono, motivo, documentacion,
                                     domicilio, domicilio_lat, domicilio_lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, creado_en`,
      [req.empresa.id, req.empresa.nombre, trabajador_nombre.trim(), trabajador_dni || '',
       trabajador_telefono || '', motivo.trim(), documentacion || '',
       (domicilio || '').trim(), g.punto?.lat ?? null, g.punto?.lng ?? null]);
    res.json({ ok: true, id: r.rows[0].id, creado_en: r.rows[0].creado_en,
      domicilio_ubicado: !!g.punto, domicilio_normalizado: g.punto?.normalizada || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/empresa/ausentismo/casos', empresaAuthMiddleware, async (req, res) => {
  try {
    // La empresa ve el estado y el profesional, pero no las notas internas de MEDGRUP
    const r = await pool.query(`
      SELECT c.id, c.trabajador_nombre, c.trabajador_dni, c.trabajador_telefono, c.motivo,
             c.documentacion, c.estado, c.creado_en, c.resuelto_en, c.turno_id,
             c.domicilio, (c.domicilio_lat IS NOT NULL) AS domicilio_ubicado,
             m.nombre AS profesional_nombre, m.especialidad AS profesional_especialidad,
             t.fecha AS turno_fecha, t.hora AS turno_hora,
             (SELECT d.id FROM dictamenes d WHERE d.turno_id = c.turno_id ORDER BY d.creado_en DESC LIMIT 1) AS dictamen_id
      FROM casos_ausentismo c
      LEFT JOIN medicos m ON m.id = c.profesional_id
      LEFT JOIN turnos  t ON t.id = c.turno_id
      WHERE c.empresa_nombre = $1
      ORDER BY c.creado_en DESC`, [req.empresa.nombre]);
    res.json({ ok: true, casos: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/empresa/ausentismo/casos/:id/cancelar', empresaAuthMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT estado FROM casos_ausentismo WHERE id=$1 AND empresa_nombre=$2',
      [req.params.id, req.empresa.nombre]);
    if (!r.rows.length) return res.status(404).json({ error: 'Caso no encontrado' });
    if (r.rows[0].estado === 'resuelto') return res.status(400).json({ error: 'El caso ya fue resuelto' });
    if (r.rows[0].estado === 'cancelado') return res.json({ ok: true, estado: 'cancelado' });
    await pool.query(`UPDATE casos_ausentismo SET estado='cancelado' WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, estado: 'cancelado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/empresa', (req, res) => res.sendFile(path.join(__dirname, 'public', 'empresa.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDB().then(() => { app.listen(PORT, () => console.log(`MEDGRUP en puerto ${PORT}`)); registrarWebhookDaily(); });