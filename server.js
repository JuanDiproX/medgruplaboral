const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DAILY_API_KEY = process.env.DAILY_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Base de médicos en memoria (luego conectamos DB)
let medicos = [
  { id: 1, nombre: 'Dr. Barboza, Raúl', matricula: 'MP 12.847', especialidad: 'Medicina Laboral', activo: true },
  { id: 2, nombre: 'Dr. Muroni, Esteban', matricula: '', especialidad: 'Medicina Laboral', activo: true },
];

// GET médicos
app.get('/api/medicos', (req, res) => {
  res.json(medicos.filter(m => m.activo));
});

// POST agregar médico
app.post('/api/medicos', (req, res) => {
  const { nombre, matricula, especialidad } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
  const nuevo = {
    id: Date.now(),
    nombre,
    matricula: matricula || '',
    especialidad: especialidad || 'Medicina Laboral',
    activo: true
  };
  medicos.push(nuevo);
  res.json({ ok: true, medico: nuevo });
});

// DELETE médico
app.delete('/api/medicos/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const m = medicos.find(m => m.id === id);
  if (!m) return res.status(404).json({ error: 'Médico no encontrado' });
  m.activo = false;
  res.json({ ok: true });
});

// POST crear sala Daily
app.post('/api/crear-sala', async (req, res) => {
  try {
    const { paciente, medico, tipo } = req.body;
    const nombreSala = `medgrup-${Date.now()}`;

    const response = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DAILY_API_KEY}`
      },
      body: JSON.stringify({
        name: nombreSala,
        properties: {
          enable_recording: 'cloud',
          enable_chat: true,
          start_audio_off: false,
          start_video_off: false,
          exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24),
          eject_at_room_exp: true,
          max_participants: 5
        }
      })
    });

    const sala = await response.json();
    if (!response.ok) return res.status(500).json({ error: 'No se pudo crear la sala', detalle: sala });

    res.json({
      ok: true,
      sala: sala.name,
      url: sala.url,
      url_medico: sala.url + '?t=owner',
      creada_en: new Date().toISOString(),
      paciente: paciente || 'No especificado',
      medico: medico || 'Sin asignar'
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`MEDGRUP corriendo en puerto ${PORT}`));