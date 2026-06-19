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

      CREATE TABLE IF NOT EXISTS turno_medicos (
        turno_id VARCHAR(50) REFERENCES turnos(id),
        medico_nombre VARCHAR(200),
        PRIMARY KEY (turno_id, medico_nombre)
      );

      CREATE TABLE IF NOT EXISTS eventos_turno (
        id SERIAL PRIMARY KEY,
        turno_id VARCHAR(50) REFERENCES turnos(id),
        tipo VARCHAR(50) NOT NULL,
        participante VARCHAR(200),
        creado_en TIMESTAMP DEFAULT NOW()
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

    // Nuevas columnas para informe de junta médica
    await client.query(`ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS paciente_dni VARCHAR(50)`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS edad VARCHAR(20)`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS obra_social VARCHAR(200)`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS profesion VARCHAR(200)`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS antecedentes TEXT`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS hallazgos TEXT`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS conclusion TEXT`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS matricula VARCHAR(100)`).catch(()=>{});
    await client.query(`ALTER TABLE IF EXISTS dictamenes ADD COLUMN IF NOT EXISTS especialidad VARCHAR(200)`).catch(()=>{});

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
            paciente_dni, edad, obra_social, profesion,
            antecedentes, hallazgos, conclusion,
            aptitud, dias_reposo, derivacion, indicaciones, sala,
            matricula, especialidad } = req.body;

    // Generar número correlativo
    const count = await pool.query('SELECT COUNT(*) FROM dictamenes');
    const numero = 'DICT-2026-' + String(parseInt(count.rows[0].count) + 1).padStart(4,'0');

    const result = await pool.query(`
      INSERT INTO dictamenes (numero, turno_id, paciente, medico, empresa, fecha_consulta,
        hora_inicio, duracion, aptitud, dias_reposo, derivacion, indicaciones, sala,
        paciente_dni, edad, obra_social, profesion, antecedentes, hallazgos, conclusion,
        matricula, especialidad)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *
    `, [numero, turno_id, paciente, medico, empresa, fecha_consulta,
        hora_inicio, duracion, aptitud,
        dias_reposo||0, derivacion||'Sin derivación', indicaciones||'', sala||'',
        paciente_dni||'', edad||'', obra_social||'', profesion||'',
        antecedentes||'', hallazgos||'', conclusion||'',
        matricula||'', especialidad||'Medicina Laboral']);

    res.json({ ok: true, dictamen: result.rows[0], numero });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== OBTENER DICTÁMENES =====
// ===== EVENTOS DE ASISTENCIA DEL TURNO (para el Acta) =====
app.post('/api/turnos/:id/eventos', authMiddleware, async (req, res) => {
  try {
    const { tipo, participante } = req.body;
    const result = await pool.query(
      'INSERT INTO eventos_turno (turno_id, tipo, participante) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, tipo, participante || '']
    );
    res.json({ ok: true, evento: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/turnos/:id/eventos', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM eventos_turno WHERE turno_id = $1 ORDER BY creado_en ASC', [req.params.id]);
    res.json({ ok: true, eventos: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dictamenes', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM dictamenes ORDER BY creado_en DESC LIMIT 50');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener TODOS los dictámenes de un turno (uno por médico)
app.get('/api/dictamenes/turno/:turnoId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM dictamenes WHERE turno_id = $1 ORDER BY creado_en DESC', [req.params.turnoId]);
    res.json({ ok: true, dictamenes: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener el dictamen de UN médico específico para un turno
app.get('/api/dictamenes/turno/:turnoId/medico', authMiddleware, async (req, res) => {
  try {
    const medico = req.query.medico || '';
    const result = await pool.query(
      'SELECT * FROM dictamenes WHERE turno_id = $1 AND medico = $2 ORDER BY creado_en DESC LIMIT 1',
      [req.params.turnoId, medico]
    );
    if (!result.rows.length) return res.json({ ok: false, dictamen: null });
    res.json({ ok: true, dictamen: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar dictamen (solo dentro de 5 horas de creado)
app.patch('/api/dictamenes/:id', authMiddleware, async (req, res) => {
  try {
    const check = await pool.query('SELECT creado_en FROM dictamenes WHERE id = $1', [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const horasPasadas = (Date.now() - new Date(check.rows[0].creado_en).getTime()) / (1000*60*60);
    if (horasPasadas > 5) return res.status(403).json({ error: 'No se puede editar: pasaron más de 5 horas desde la emisión' });

    const { aptitud, dias_reposo, derivacion, indicaciones,
            paciente_dni, edad, obra_social, profesion,
            antecedentes, hallazgos, conclusion } = req.body;
    await pool.query(`
      UPDATE dictamenes SET
        aptitud = COALESCE($1, aptitud),
        dias_reposo = COALESCE($2, dias_reposo),
        derivacion = COALESCE($3, derivacion),
        indicaciones = COALESCE($4, indicaciones),
        paciente_dni = COALESCE($5, paciente_dni),
        edad = COALESCE($6, edad),
        obra_social = COALESCE($7, obra_social),
        profesion = COALESCE($8, profesion),
        antecedentes = COALESCE($9, antecedentes),
        hallazgos = COALESCE($10, hallazgos),
        conclusion = COALESCE($11, conclusion)
      WHERE id = $12
    `, [aptitud, dias_reposo, derivacion, indicaciones,
        paciente_dni, edad, obra_social, profesion,
        antecedentes, hallazgos, conclusion, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GENERAR PDF: INFORME DE JUNTA MÉDICA LABORAL (público por URL única) =====
app.get('/api/dictamenes/:id/pdf', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM dictamenes WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Dictamen no encontrado' });
    const d = result.rows[0];

    // Traer todos los dictámenes del mismo turno (otros médicos de la junta)
    let otros = [];
    if (d.turno_id) {
      const r2 = await pool.query('SELECT * FROM dictamenes WHERE turno_id = $1 AND id != $2 ORDER BY creado_en ASC', [d.turno_id, d.id]);
      otros = r2.rows;
    }
    const todos = [d, ...otros];

    const fechaEmision = new Date(d.creado_en).toLocaleDateString('es-AR', {
      year:'numeric', month:'long', day:'numeric'
    });
    const fechaConsulta = d.fecha_consulta ? new Date(d.fecha_consulta).toLocaleDateString('es-AR', {
      day:'2-digit', month:'2-digit', year:'numeric'
    }) : '—';

    const aptitudMap = { apto:'Aptitud Laboral Total', restricc:'Apto con restricciones', 'no-apto':'No apto / Reposo indicado' };
    const aptitudLabel = aptitudMap[d.aptitud] || d.aptitud;

    const integrantesHtml = todos.map(m => `
      <li style="margin-bottom:6px;"><strong>${m.medico}</strong>${m.especialidad?': '+m.especialidad:''}${m.matricula?' (MN/MP: '+m.matricula+')':''} — Evaluación remota vía MEDGRUP Telemedicina.</li>
    `).join('');

    const firmasHtml = todos.map(m => `
      <div style="text-align:center;flex:1;min-width:180px;">
        <div style="width:170px;border-bottom:1.5px solid #1a1916;margin:0 auto 6px;height:30px;"></div>
        <div style="font-size:12px;font-weight:600;color:#1a1916;">${m.medico}</div>
        <div style="font-size:10px;color:#5a5750;">${m.especialidad||'Medicina Laboral'}</div>
        <div style="font-size:9.5px;color:#9a9790;font-family:'DM Mono',sans-serif;">${m.matricula?'MN/MP '+m.matricula:''}</div>
      </div>
    `).join('');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Informe Junta Médica ${d.numero}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'DM Sans',sans-serif;color:#1a1916;background:white;padding:42px 46px;font-size:12.5px;line-height:1.65;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #3a6ea8;margin-bottom:22px;}
  .logo-area{display:flex;align-items:center;gap:11px;}
  .logo-icon{width:44px;height:44px;background:linear-gradient(135deg,#3a6ea8,#7aaed4);border-radius:11px;display:flex;align-items:center;justify-content:center;}
  .logo-icon svg{width:25px;height:25px;fill:white;}
  .logo-text-name{font-size:18px;font-weight:700;color:#3a6ea8;letter-spacing:-0.3px;line-height:1;}
  .logo-text-sub{font-size:9px;color:#c0365a;letter-spacing:1.2px;text-transform:uppercase;margin-top:3px;font-family:'DM Mono',sans-serif;font-weight:500;}
  .doc-meta{text-align:right;}
  .doc-numero{font-family:'DM Mono',sans-serif;font-size:13px;font-weight:500;color:#3a6ea8;}
  .doc-fecha{font-size:10.5px;color:#5a5750;margin-top:4px;}

  h1{font-size:17px;font-weight:700;letter-spacing:-0.3px;margin-bottom:4px;}
  .subt{font-size:11px;color:#5a5750;margin-bottom:18px;text-transform:uppercase;letter-spacing:0.5px;}
  h2{font-size:12.5px;font-weight:700;color:#2a5080;margin:18px 0 8px;letter-spacing:-0.1px;}
  p{margin-bottom:8px;text-align:justify;}
  ul{margin:6px 0 6px 18px;}

  .datos-box{background:#f4f7fb;border:1px solid #e6edf5;border-radius:9px;padding:13px 16px;margin:10px 0 16px;}
  .datos-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;}
  .dato-item{font-size:12px;}
  .dato-label{color:#9a9790;font-family:'DM Mono',sans-serif;font-size:9.5px;text-transform:uppercase;letter-spacing:0.5px;}
  .dato-value{font-weight:600;color:#1a1916;}

  .conclusion-box{
    border-radius:9px;padding:14px 18px;margin-top:8px;
    background:${d.aptitud==='apto'?'#eaf5f0':d.aptitud==='restricc'?'#fdf5e8':'#fdf0f0'};
    border:1.5px solid ${d.aptitud==='apto'?'#1e6640':d.aptitud==='restricc'?'#8f5000':'#b02a2a'};
  }
  .conclusion-label{font-size:15px;font-weight:700;color:${d.aptitud==='apto'?'#1e6640':d.aptitud==='restricc'?'#8f5000':'#b02a2a'};}
  .conclusion-sub{font-size:10.5px;color:#5a5750;margin-top:3px;}

  .firmas-row{display:flex;gap:24px;flex-wrap:wrap;margin-top:36px;padding-top:20px;border-top:1px solid #e8e4de;}
  .footer-hash{margin-top:24px;text-align:right;font-size:8.5px;color:#9a9790;font-family:'DM Mono',sans-serif;}
  .watermark{margin-top:20px;text-align:center;font-size:9px;color:#c8c4be;font-family:'DM Mono',sans-serif;letter-spacing:0.5px;}

  @media print{body{padding:24px 30px;}}
</style>
</head>
<body>
  <div class="header">
    <div class="logo-area">
      <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm1 14h-2v-5H9v-2h2V7h2v2h2v2h-2v5z"/></svg></div>
      <div>
        <div class="logo-text-name">MEDGRUP</div>
        <div class="logo-text-sub">Servicio Médico Laboral Integral</div>
      </div>
    </div>
    <div class="doc-meta">
      <div class="doc-numero">${d.numero}</div>
      <div class="doc-fecha">Tierra del Fuego, ${fechaEmision}</div>
    </div>
  </div>

  <h1>Informe de Junta Médica Laboral</h1>
  <div class="subt">A la Dirección de Recursos Humanos / Asesoría Legal — Empresa: ${d.empresa||'—'}</div>

  <h2>I. Objeto del informe</h2>
  <p>El presente dictamen tiene por objeto documentar los hallazgos y conclusiones de la Junta Médica realizada al/a la evaluado/a <strong>${d.paciente}</strong>, a fin de determinar su aptitud laboral, llevada a cabo en modalidad de telemedicina a través de la plataforma MEDGRUP.</p>

  <h2>II. Integración de la junta médica</h2>
  <ul>${integrantesHtml}</ul>

  <h2>Datos identificatorios del evaluado</h2>
  <div class="datos-box">
    <div class="datos-grid">
      <div class="dato-item"><div class="dato-label">Nombre y apellido</div><div class="dato-value">${d.paciente}</div></div>
      <div class="dato-item"><div class="dato-label">DNI</div><div class="dato-value">${d.paciente_dni||'—'}</div></div>
      <div class="dato-item"><div class="dato-label">Edad</div><div class="dato-value">${d.edad?d.edad+' años':'—'}</div></div>
      <div class="dato-item"><div class="dato-label">Obra social</div><div class="dato-value">${d.obra_social||'—'}</div></div>
      <div class="dato-item"><div class="dato-label">Profesión / Ocupación</div><div class="dato-value">${d.profesion||'—'}</div></div>
      <div class="dato-item"><div class="dato-label">Fecha de evaluación</div><div class="dato-value">${fechaConsulta}</div></div>
    </div>
  </div>

  ${d.antecedentes ? `<h2>III. Antecedentes y cronología de los hechos</h2><p style="white-space:pre-wrap;">${d.antecedentes}</p>` : ''}

  ${d.hallazgos ? `<h2>IV. Hallazgos del examen</h2><p style="white-space:pre-wrap;">${d.hallazgos}</p>` : ''}

  <h2>V. Conclusión médico-legal</h2>
  ${d.conclusion ? `<p style="white-space:pre-wrap;">${d.conclusion}</p>` : ''}
  <div class="conclusion-box">
    <div class="conclusion-label">${aptitudLabel}</div>
    <div class="conclusion-sub">${d.dias_reposo>0 ? d.dias_reposo+' día(s) de reposo indicado' : 'Sin reposo indicado'}${d.derivacion&&d.derivacion!=='Sin derivación' ? ' · Derivación: '+d.derivacion : ''}</div>
  </div>

  ${d.indicaciones ? `<h2>Indicaciones y tratamiento</h2><p style="white-space:pre-wrap;">${d.indicaciones}</p>` : ''}

  <div class="firmas-row">
    ${firmasHtml}
  </div>

  <div class="footer-hash">Código de verificación: ${d.numero}-${Buffer.from(d.numero+d.paciente+d.creado_en).toString('base64').substring(0,28)}</div>
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

// ===== ACTA DE ASISTENCIA (constancia con cronología de eventos reales) =====
app.get('/api/turnos/:id/acta', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM turnos WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Turno no encontrado' });
    const t = result.rows[0];

    const eventosRes = await pool.query('SELECT * FROM eventos_turno WHERE turno_id = $1 ORDER BY creado_en ASC', [req.params.id]);
    const eventos = eventosRes.rows;

    const fecha = new Date(t.fecha).toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });
    const fechaEmision = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });

    const tipoLabel = {
      'inicio_medico': 'Inicio de videoconsulta',
      'union_medico': 'Médico se incorporó a la consulta',
      'union_paciente': 'Paciente se incorporó a la consulta',
      'fin_consulta': 'Finalización de la consulta'
    };
    const tipoIcon = {
      'inicio_medico': '▶',
      'union_medico': '＋',
      'union_paciente': '＋',
      'fin_consulta': '■'
    };

    const eventosHtml = eventos.length ? eventos.map(e => {
      const hora = new Date(e.creado_en).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
      return `<div class="ev-row">
        <div class="ev-hora">${hora}</div>
        <div class="ev-icon">${tipoIcon[e.tipo]||'•'}</div>
        <div class="ev-desc"><strong>${tipoLabel[e.tipo]||e.tipo}</strong>${e.participante?' — '+e.participante:''}</div>
      </div>`;
    }).join('') : `<div style="color:#9a9790;font-size:12.5px;padding:12px 0;">Sin eventos de asistencia registrados.</div>`;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Acta de Asistencia - ${t.paciente}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'DM Sans',sans-serif;color:#1a1916;background:white;padding:46px 52px;font-size:13px;line-height:1.7;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:16px;border-bottom:2px solid #3a6ea8;margin-bottom:18px;}
  .logo-area{display:flex;align-items:center;gap:11px;}
  .logo-icon{width:44px;height:44px;background:linear-gradient(135deg,#3a6ea8,#7aaed4);border-radius:11px;display:flex;align-items:center;justify-content:center;}
  .logo-icon svg{width:25px;height:25px;fill:white;}
  .logo-text-name{font-size:18px;font-weight:700;color:#3a6ea8;letter-spacing:-0.3px;line-height:1;}
  .logo-text-sub{font-size:9.5px;color:#c0365a;letter-spacing:1.2px;text-transform:uppercase;margin-top:3px;font-family:'DM Mono',sans-serif;font-weight:500;}
  .doc-meta{text-align:right;font-size:10.5px;color:#5a5750;}

  h1{font-size:17px;font-weight:700;margin-bottom:6px;letter-spacing:-0.3px;}
  .subt{font-size:11px;color:#5a5750;margin-bottom:18px;}
  p{text-align:justify;margin-bottom:10px;}

  .datos-box{background:#f4f7fb;border:1px solid #e6edf5;border-radius:9px;padding:12px 15px;margin:14px 0 20px;display:grid;grid-template-columns:1fr 1fr;gap:7px 18px;}
  .dato-item{font-size:12px;}
  .dato-label{color:#9a9790;font-family:'DM Mono',sans-serif;font-size:9.5px;text-transform:uppercase;letter-spacing:0.5px;}
  .dato-value{font-weight:600;color:#1a1916;}

  h2{font-size:12.5px;font-weight:700;color:#2a5080;margin:18px 0 10px;}

  .ev-row{display:flex;align-items:center;gap:14px;padding:10px 14px;border-bottom:1px solid #ecebe7;}
  .ev-row:last-child{border-bottom:none;}
  .ev-hora{font-family:'DM Mono',sans-serif;font-size:11.5px;color:#3a6ea8;font-weight:500;width:64px;flex-shrink:0;}
  .ev-icon{width:22px;height:22px;border-radius:50%;background:#e8f0f8;color:#3a6ea8;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;}
  .ev-desc{font-size:12.5px;color:#1a1916;}
  .eventos-box{border:1px solid #e8e4de;border-radius:9px;overflow:hidden;}

  .verif{margin-top:24px;background:#faedf1;border:1px solid #f0b8c8;border-radius:9px;padding:11px 15px;font-size:11px;color:#9a2847;}
  .watermark{margin-top:28px;text-align:center;font-size:9px;color:#c8c4be;font-family:'DM Mono',sans-serif;}
  @media print{body{padding:26px 32px;}}
</style>
</head>
<body>
  <div class="header">
    <div class="logo-area">
      <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm1 14h-2v-5H9v-2h2V7h2v2h2v2h-2v5z"/></svg></div>
      <div>
        <div class="logo-text-name">MEDGRUP</div>
        <div class="logo-text-sub">Salud Ocupacional, Seguridad e Higiene del Trabajo</div>
      </div>
    </div>
    <div class="doc-meta">Tierra del Fuego<br>${fechaEmision}</div>
  </div>

  <h1>Acta de Asistencia — Junta Médica Laboral</h1>
  <div class="subt">Constancia de asistencia mediante registro de eventos de la videoconsulta</div>

  <p>Se deja constancia de que en el día de la fecha se llevó a cabo una junta médica, convocada en virtud de la solicitud de <strong>${t.empresa||'—'}</strong> para evaluar los alcances de la situación laboral del/la Sr./Sra. <strong>${t.paciente}</strong>, realizada en modalidad de telemedicina a través de la plataforma MEDGRUP.</p>

  <div class="datos-box">
    <div class="dato-item"><div class="dato-label">Paciente</div><div class="dato-value">${t.paciente}</div></div>
    <div class="dato-item"><div class="dato-label">Empresa</div><div class="dato-value">${t.empresa||'—'}</div></div>
    <div class="dato-item"><div class="dato-label">Fecha del turno</div><div class="dato-value">${fecha}</div></div>
    <div class="dato-item"><div class="dato-label">Tipo de consulta</div><div class="dato-value">${t.tipo||'—'}</div></div>
  </div>

  <h2>Registro cronológico de asistencia</h2>
  <div class="eventos-box">
    ${eventosHtml}
  </div>

  <div class="verif">
    Este documento certifica la asistencia mediante el registro automático de eventos del sistema MEDGRUP (inicio de sesión, incorporación de participantes y finalización), generado por la plataforma sin intervención manual.
  </div>

  <div class="watermark">MEDGRUP Servicio Médico Laboral · Acta de asistencia · ${t.id}</div>

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