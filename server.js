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

// Crear sala de Daily para una consulta
app.post('/api/crear-sala', async (req, res) => {
  try {
    const { paciente, medico } = req.body;
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
          exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24), // expira en 24hs
          eject_at_room_exp: true,
          max_participants: 5
        }
      })
    });

    const sala = await response.json();

    if (!response.ok) {
      console.error('Error Daily:', sala);
      return res.status(500).json({ error: 'No se pudo crear la sala', detalle: sala });
    }

    const ahora = new Date().toISOString();

    res.json({
      ok: true,
      sala: sala.name,
      url: sala.url,
      url_medico: sala.url + '?t=owner',
      creada_en: ahora,
      paciente: paciente || 'No especificado',
      medico: medico || 'Dr. Barboza'
    });

  } catch (err) {
    console.error('Error servidor:', err);
    res.status(500).json({ error: err.message });
  }
});

// Obtener salas existentes
app.get('/api/salas', async (req, res) => {
  try {
    const response = await fetch('https://api.daily.co/v1/rooms', {
      headers: { 'Authorization': `Bearer ${DAILY_API_KEY}` }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Todas las rutas no-API van al frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MEDGRUP corriendo en puerto ${PORT}`);
});
