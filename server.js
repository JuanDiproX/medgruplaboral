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
        hora VARCHAR(10) NOT NULL,
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

      CREATE TABLE IF NOT EXISTS turno_medicos (
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

initDB().then(() => {
  app.listen(PORT, () => console.log(`MEDGRUP en puerto ${PORT}`));
});