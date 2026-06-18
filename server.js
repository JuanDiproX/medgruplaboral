const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DAILY_API_KEY = process.env.DAILY_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || 'medgrup-secret-2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function hashPassword(password) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Sessions en memoria (suficiente para pocos usuarios)
const sessions = {};

function authMiddleware(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || !sessions[token]) {
    return res.status(401).json({ error: 'No autorizado', needsLogin: true });
  }
  req.usuario = sessions[token];
  next();
}

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(200) NOT NULL,
        email VARCHAR(200) UNIQUE NOT NULL,
        password_hash VARCHAR(200) NOT NULL,
        rol VARCHAR(50) DEFAULT 'medico',
        activo BOOLEAN DEFAULT true,
        creado_en TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS medicos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(200) NOT NULL,
        matricula VARCHAR(100),
        especialidad VARCHAR(100) DEFAULT 'Medicina Laboral',
        activo BOOLEAN DEFAULT true,
        creado_en TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS turnos (
        id VARCHAR(50) PRIMARY KEY,
        paciente VARCHAR(200) NOT NULL,
        fecha DATE NOT NULL,
        hora VARCHAR(20) NOT NULL,
        tipo VARCHAR(100),
        empresa VARCHAR(200),
        estado VARCHAR(50) DEFAULT 'pendiente',
        sala VARCHAR(200),
        link_paciente TEXT,
        link_medico TEXT,
        links_medicos JSONB,
        motivo TEXT,
        creado_en TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS dictamenes (
        id SERIAL PRIMARY KEY,
        numero VARCHAR(20) NOT NULL,
        turno_id VARCHAR(50) REFERENCES turnos(id),
        paciente VARCHAR(200),
        medico VARCHAR(200),
        empresa VARCHAR(200),
        fecha_consulta DATE,
        hora_inicio VARCHAR(50),
        duracion VARCHAR(50),
        diagnostico VARCHAR(50),
        diagnostico_desc VARCHAR(200),
        aptitud VARCHAR(50),
        dias_reposo INTEGER DEFAULT 0,
        derivacion VARCHAR(100),
        indicaciones TEXT,
        sala VARCHAR(200),
        creado_en TIMESTAMP DEFAULT NOW()
      );

        turno_id VARCHAR(50) REFERENCES turnos(id),
        medico_nombre VARCHAR(200),
        PRIMARY KEY (turno_id, medico_nombre)
      );
    `);

    // Usuarios iniciales
    const adminHash = hashPassword('medgrup2026');
    const barbozaHash = hashPassword('barboza2026');
    const muroniHash = hashPassword('muroni2026');

    await client.query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol)
      VALUES 
        ('Administrador', 'adm.medgrup@gmail.com', $1, 'admin'),
        ('Dr. Barboza, Raúl', 'barboza@medgrup.com', $2, 'medico'),
        ('Dr. Muroni, Esteban', 'muroni@medgrup.com', $3, 'medico')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash, barbozaHash, muroniHash]);

    // Médicos
    await client.query(`
      INSERT INTO medicos (nombre, matricula, especialidad)
      SELECT 'Dr. Barboza, Raúl', 'MP 12.847', 'Medicina Laboral'
      WHERE NOT EXISTS (SELECT 1 FROM medicos WHERE nombre = 'Dr. Barboza, Raúl');
      INSERT INTO medicos (nombre, matricula, especialidad)
      SELECT 'Dr. Muroni, Esteban', '', 'Medicina Laboral'
      WHERE NOT EXISTS (SELECT 1 FROM medicos WHERE nombre = 'Dr. Muroni, Esteban');
    `);

    // Turno 19/6
    const turnoExiste = await client.query(`SELECT id FROM turnos WHERE id = 'turno-19jun-2026'`);
    if (turnoExiste.rows.length === 0) {
      await client.query(`
        INSERT INTO turnos (id, paciente, fecha, hora, tipo, empresa, estado, sala, link_paciente, link_medico, links_medicos, motivo)
        VALUES (
          'turno-19jun-2026', 'Jorge Álvarez', '2026-06-19', '16:00',
          'Junta médica', 'LOGANT S.A.', 'pendiente',
          'medgrup-1781195880513',
          'https://medgruplaboral.daily.co/medgrup-1781195880513',
          'https://medgruplaboral.daily.co/medgrup-1781195880513?t=owner',
          '[{"nombre":"Dr. Barboza, Raúl","link":"https://medgruplaboral.daily.co/medgrup-1781195880513?t=owner"},{"nombre":"Dr. Muroni, Esteban","link":"https://medgruplaboral.daily.co/medgrup-1781195880513?t=owner"}]',
          'Junta médica programada'
        ) ON CONFLICT (id) DO NOTHING
      `);
      await client.query(`
        INSERT INTO turno_medicos (turno_id, medico_nombre) VALUES
        ('turno-19jun-2026', 'Dr. Barboza, Raúl'),
        ('turno-19jun-2026', 'Dr. Muroni, Esteban')
        ON CONFLICT DO NOTHING
      `);
    }

    // Fix columnas existentes
    await client.query(`ALTER TABLE IF EXISTS dictamenes ALTER COLUMN hora_inicio TYPE VARCHAR(100)`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ALTER COLUMN duracion TYPE VARCHAR(100)`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ALTER COLUMN diagnostico TYPE VARCHAR(100)`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ALTER COLUMN diagnostico_desc TYPE VARCHAR(500)`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ALTER COLUMN derivacion TYPE VARCHAR(200)`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS turnos ALTER COLUMN hora TYPE VARCHAR(20)`).catch(()=>{});

    console.log('✓ Base de datos lista');
  } catch (err) {
    console.error('Error DB:', err.message);
  } finally {
    client.release();
  }
}

// ===== AUTH =====
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  try {
    const hash = hashPassword(password);
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1 AND password_hash = $2 AND activo = true',
      [email, hash]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const usuario = result.rows[0];
    const token = generateToken();
    sessions[token] = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol };
    res.json({ ok: true, token, usuario: { nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) delete sessions[token];
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ ok: true, usuario: req.usuario });
});

// ===== MÉDICOS =====
app.get('/api/medicos', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM medicos WHERE activo = true ORDER BY id');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/medicos', authMiddleware, async (req, res) => {
  const { nombre, matricula, especialidad } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = await pool.query(
      'INSERT INTO medicos (nombre, matricula, especialidad) VALUES ($1, $2, $3) RETURNING *',
      [nombre, matricula || '', especialidad || 'Medicina Laboral']
    );
    res.json({ ok: true, medico: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/medicos/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE medicos SET activo = false WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== TURNOS =====
app.get('/api/turnos', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, 
        COALESCE(array_agg(tm.medico_nombre) FILTER (WHERE tm.medico_nombre IS NOT NULL), '{}') as medicos
      FROM turnos t
      LEFT JOIN turno_medicos tm ON t.id = tm.turno_id
      GROUP BY t.id
      ORDER BY t.fecha ASC, t.hora ASC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/turnos/:id/estado', authMiddleware, async (req, res) => {
  const { estado } = req.body;
  try {
    await pool.query('UPDATE turnos SET estado = $1 WHERE id = $2', [estado, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CREAR SALA =====
app.post('/api/crear-sala', authMiddleware, async (req, res) => {
  try {
    const { paciente, medicos: medicosList, tipo, fecha, hora, empresa, motivo } = req.body;
    const nombreSala = `medgrup-${Date.now()}`;

    const response = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DAILY_API_KEY}` },
      body: JSON.stringify({
        name: nombreSala,
        properties: {
          enable_recording: 'cloud',
          enable_chat: true,
          exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 30),
          eject_at_room_exp: true,
          max_participants: 10,
          enable_knocking: false,
          enable_prejoin_ui: false
        }
      })
    });

    const sala = await response.json();
    if (!response.ok) return res.status(500).json({ error: 'No se pudo crear la sala', detalle: sala });

    const linksMedicos = (medicosList || []).map(nombre => ({ nombre, link: sala.url + '?t=owner' }));
    const turnoId = `turno-${Date.now()}`;

    await pool.query(`
      INSERT INTO turnos (id, paciente, fecha, hora, tipo, empresa, estado, sala, link_paciente, link_medico, links_medicos, motivo)
      VALUES ($1,$2,$3,$4,$5,$6,'pendiente',$7,$8,$9,$10,$11)
    `, [turnoId, paciente,
      fecha || new Date().toISOString().split('T')[0],
      hora || new Date().toLocaleTimeString('es-AR', {hour:'2-digit',minute:'2-digit'}),
      tipo || 'Consulta', empresa || 'LOGANT S.A.',
      sala.name, sala.url, sala.url + '?t=owner',
      JSON.stringify(linksMedicos), motivo || ''
    ]);

    for (const medico of (medicosList || [])) {
      await pool.query('INSERT INTO turno_medicos (turno_id, medico_nombre) VALUES ($1,$2) ON CONFLICT DO NOTHING', [turnoId, medico]);
    }

    res.json({ ok: true, sala: sala.name, url: sala.url, url_medico: sala.url + '?t=owner', links_medicos: linksMedicos, turno_id: turnoId, paciente });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));


// ===== CAMBIAR CONTRASEÑA =====
app.post('/api/cambiar-password', authMiddleware, async (req, res) => {
  const { passwordActual, passwordNueva } = req.body;
  if (!passwordActual || !passwordNueva) return res.status(400).json({ error: 'Faltan datos' });
  if (passwordNueva.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  try {
    const hashActual = hashPassword(passwordActual);
    const usuario = await pool.query(
      'SELECT * FROM usuarios WHERE id = $1 AND password_hash = $2',
      [req.usuario.id, hashActual]
    );
    if (!usuario.rows.length) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    const hashNueva = hashPassword(passwordNueva);
    await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hashNueva, req.usuario.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GUARDAR DICTAMEN =====
app.post('/api/dictamenes', authMiddleware, async (req, res) => {
  try {
    const { turno_id, paciente, medico, empresa, fecha_consulta, hora_inicio, duracion,
            diagnostico, diagnostico_desc, aptitud, dias_reposo, derivacion, indicaciones, sala } = req.body;

    // Generar número correlativo
    const count = await pool.query('SELECT COUNT(*) FROM dictamenes');
    const numero = 'DICT-2026-' + String(parseInt(count.rows[0].count) + 1).padStart(4,'0');

    const result = await pool.query(`
      INSERT INTO dictamenes (numero, turno_id, paciente, medico, empresa, fecha_consulta,
        hora_inicio, duracion, diagnostico, diagnostico_desc, aptitud, dias_reposo, derivacion, indicaciones, sala)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *
    `, [numero, turno_id, paciente, medico, empresa, fecha_consulta,
        hora_inicio, duracion, diagnostico, diagnostico_desc, aptitud,
        dias_reposo||0, derivacion||'Sin derivación', indicaciones||'', sala||'']);

    res.json({ ok: true, dictamen: result.rows[0], numero });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== OBTENER DICTÁMENES =====
app.get('/api/dictamenes', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM dictamenes ORDER BY creado_en DESC LIMIT 50');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GENERAR PDF DEL DICTAMEN =====
app.get('/api/dictamenes/:id/pdf', async (req, res) => {
  const token = req.headers['x-session-token'] || req.query.token;
  if (!token || !sessions[token]) return res.status(401).send('No autorizado');
  try {
    const result = await pool.query('SELECT * FROM dictamenes WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Dictamen no encontrado' });
    const d = result.rows[0];

    const fecha = new Date(d.fecha_consulta).toLocaleDateString('es-AR', {
      weekday:'long', year:'numeric', month:'long', day:'numeric'
    });
    const emitido = new Date(d.creado_en).toLocaleDateString('es-AR', {
      year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'
    });

    const aptitudMap = { apto:'APTO', restricc:'APTO CON RESTRICCIONES', 'no-apto':'NO APTO' };
    const aptitudLabel = aptitudMap[d.aptitud] || d.aptitud;
    const aptitudColor = d.aptitud === 'apto' ? '#1e6640' : d.aptitud === 'restricc' ? '#8f5000' : '#b02a2a';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Dictamen ${d.numero}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'DM Sans',sans-serif;color:#1a1916;background:white;padding:40px;font-size:13px;line-height:1.6;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:3px solid #3a6ea8;margin-bottom:24px;}
  .logo-area{display:flex;align-items:center;gap:12px;}
  .logo-icon{width:48px;height:48px;background:linear-gradient(135deg,#3a6ea8,#7aaed4);border-radius:12px;display:flex;align-items:center;justify-content:center;}
  .logo-icon svg{width:28px;height:28px;fill:white;}
  .logo-text-name{font-size:22px;font-weight:700;color:#3a6ea8;letter-spacing:-0.5px;line-height:1;}
  .logo-text-sub{font-size:10px;color:#c0365a;letter-spacing:1.5px;text-transform:uppercase;margin-top:3px;font-family:'DM Mono',sans-serif;font-weight:500;}
  .doc-meta{text-align:right;}
  .doc-numero{font-family:'DM Mono',sans-serif;font-size:16px;font-weight:500;color:#3a6ea8;}
  .doc-tipo{font-size:11px;color:#9a9790;margin-top:2px;text-transform:uppercase;letter-spacing:0.8px;}
  .doc-fecha{font-size:11px;color:#5a5750;margin-top:6px;}

  .section{margin-bottom:20px;}
  .section-title{font-size:9px;text-transform:uppercase;letter-spacing:1.2px;color:#9a9790;font-family:'DM Mono',sans-serif;font-weight:500;padding-bottom:6px;border-bottom:1px solid #e8e4de;margin-bottom:12px;}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
  .field{display:flex;flex-direction:column;gap:2px;}
  .field-label{font-size:10px;color:#9a9790;font-family:'DM Mono',sans-serif;text-transform:uppercase;letter-spacing:0.5px;}
  .field-value{font-size:13px;color:#1a1916;font-weight:500;}

  .aptitud-box{
    border-radius:8px;padding:14px 18px;
    background:${d.aptitud==='apto'?'#eaf5f0':d.aptitud==='restricc'?'#fdf5e8':'#fdf0f0'};
    border:1.5px solid ${aptitudColor};
    display:flex;align-items:center;gap:12px;
  }
  .aptitud-label{font-size:18px;font-weight:700;color:${aptitudColor};letter-spacing:-0.3px;}
  .aptitud-sub{font-size:11px;color:#5a5750;margin-top:2px;}

  .indicaciones-box{background:#f4f2ef;border-radius:8px;padding:14px;border:1px solid #e8e4de;font-size:13px;color:#1a1916;line-height:1.7;white-space:pre-wrap;}

  .footer{margin-top:32px;padding-top:20px;border-top:1px solid #e8e4de;display:flex;justify-content:space-between;align-items:flex-end;}
  .firma-area{text-align:center;}
  .firma-line{width:160px;border-bottom:1.5px solid #1a1916;margin-bottom:6px;}
  .firma-nombre{font-size:12px;font-weight:600;color:#1a1916;}
  .firma-sub{font-size:10px;color:#9a9790;font-family:'DM Mono',sans-serif;}
  .hash-area{text-align:right;max-width:280px;}
  .hash-label{font-size:9px;color:#9a9790;font-family:'DM Mono',sans-serif;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;}
  .hash-val{font-family:'DM Mono',sans-serif;font-size:9px;color:#c0365a;word-break:break-all;}
  .watermark{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);font-size:10px;color:#c8c4be;font-family:'DM Mono',sans-serif;letter-spacing:0.5px;}

  @media print{body{padding:20px;}.watermark{position:fixed;}}
</style>
</head>
<body>
  <div class="header">
    <div class="logo-area">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm1 14h-2v-5H9v-2h2V7h2v2h2v2h-2v5z"/></svg>
      </div>
      <div>
        <div class="logo-text-name">MEDGRUP</div>
        <div class="logo-text-sub">Servicio Médico Laboral</div>
      </div>
    </div>
    <div class="doc-meta">
      <div class="doc-numero">${d.numero}</div>
      <div class="doc-tipo">Dictamen Médico · Telemedicina</div>
      <div class="doc-fecha">Emitido: ${emitido}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Datos de la consulta</div>
    <div class="grid-3">
      <div class="field"><div class="field-label">Fecha</div><div class="field-value">${fecha}</div></div>
      <div class="field"><div class="field-label">Hora de inicio</div><div class="field-value">${d.hora_inicio||'—'}</div></div>
      <div class="field"><div class="field-label">Duración</div><div class="field-value">${d.duracion||'—'}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Paciente y médico</div>
    <div class="grid-2">
      <div class="field"><div class="field-label">Paciente</div><div class="field-value">${d.paciente}</div></div>
      <div class="field"><div class="field-label">Empresa</div><div class="field-value">${d.empresa||'—'}</div></div>
      <div class="field"><div class="field-label">Médico responsable</div><div class="field-value">${d.medico}</div></div>
      <div class="field"><div class="field-label">Modalidad</div><div class="field-value">Telemedicina · Daily.co</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Diagnóstico y aptitud</div>
    <div class="grid-2" style="margin-bottom:14px;">
      <div class="field"><div class="field-label">Diagnóstico CIE-10</div><div class="field-value">${d.diagnostico||'—'}</div></div>
      <div class="field"><div class="field-label">Descripción</div><div class="field-value">${d.diagnostico_desc||'—'}</div></div>
      <div class="field"><div class="field-label">Días de reposo</div><div class="field-value">${d.dias_reposo > 0 ? d.dias_reposo+' días' : 'Sin reposo indicado'}</div></div>
      <div class="field"><div class="field-label">Derivación</div><div class="field-value">${d.derivacion||'Sin derivación'}</div></div>
    </div>
    <div class="aptitud-box">
      <div>
        <div class="aptitud-label">${aptitudLabel}</div>
        <div class="aptitud-sub">Resultado de aptitud laboral</div>
      </div>
    </div>
  </div>

  ${d.indicaciones ? `<div class="section">
    <div class="section-title">Indicaciones y tratamiento</div>
    <div class="indicaciones-box">${d.indicaciones}</div>
  </div>` : ''}

  <div class="footer">
    <div class="firma-area">
      <div class="firma-line"></div>
      <div class="firma-nombre">${d.medico}</div>
      <div class="firma-sub">MEDGRUP · Medicina Laboral</div>
    </div>
    <div class="hash-area">
      <div class="hash-label">Código de verificación</div>
      <div class="hash-val">${d.numero}-${Buffer.from(d.numero+d.paciente+d.creado_en).toString('base64').substring(0,32)}</div>
    </div>
  </div>

  <div class="watermark">MEDGRUP Servicio Médico Laboral · Documento oficial · ${d.numero}</div>

  <script>window.onload=function(){window.print();}</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDB().then(() => {
  app.listen(PORT, () => console.log(`MEDGRUP en puerto ${PORT}`));
});