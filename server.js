const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://medgruplaboral-production.up.railway.app/auth/callback';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// OAuth2 client
function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

// Token en memoria (en producción iría en DB)
let tokenGuardado = null;

// ===== AUTH =====
app.get('/auth/google', (req, res) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events']
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    tokenGuardado = tokens;
    res.redirect('/?auth=ok');
  } catch (err) {
    res.redirect('/?auth=error');
  }
});

app.get('/api/auth-status', (req, res) => {
  res.json({ conectado: !!tokenGuardado });
});

// ===== MÉDICOS =====
let medicos = [
  { id: 1, nombre: 'Dr. Barboza, Raúl', matricula: 'MP 12.847', especialidad: 'Medicina Laboral', activo: true },
  { id: 2, nombre: 'Dr. Muroni, Esteban', matricula: '', especialidad: 'Medicina Laboral', activo: true },
];

app.get('/api/medicos', (req, res) => res.json(medicos.filter(m => m.activo)));

app.post('/api/medicos', (req, res) => {
  const { nombre, matricula, especialidad } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const nuevo = { id: Date.now(), nombre, matricula: matricula||'', especialidad: especialidad||'Medicina Laboral', activo: true };
  medicos.push(nuevo);
  res.json({ ok: true, medico: nuevo });
});

app.delete('/api/medicos/:id', (req, res) => {
  const m = medicos.find(m => m.id === parseInt(req.params.id));
  if (!m) return res.status(404).json({ error: 'No encontrado' });
  m.activo = false;
  res.json({ ok: true });
});

// ===== CREAR TURNO CON GOOGLE MEET =====
app.post('/api/crear-turno', async (req, res) => {
  if (!tokenGuardado) {
    return res.status(401).json({ error: 'No autenticado con Google', needsAuth: true });
  }

  try {
    const { paciente, medicos: medicosList, tipo, fecha, hora, motivo } = req.body;

    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials(tokenGuardado);

    // Refrescar token si expiró
    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) tokenGuardado = { ...tokenGuardado, ...tokens };
      else tokenGuardado = { ...tokenGuardado, access_token: tokens.access_token };
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Construir fecha/hora
    const [anio, mes, dia] = fecha.split('-');
    const [horaNum, minNum] = hora.split(':');
    const startDateTime = new Date(parseInt(anio), parseInt(mes)-1, parseInt(dia), parseInt(horaNum), parseInt(minNum));
    const endDateTime = new Date(startDateTime.getTime() + 60*60*1000); // 1 hora

    const event = {
      summary: `Junta médica MEDGRUP — ${paciente}`,
      description: `${tipo}\nPaciente: ${paciente}\nMédicos: ${medicosList.join(', ')}\n${motivo ? 'Motivo: '+motivo : ''}\n\nGenerado por MEDGRUP Medicina Laboral`,
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Argentina/Buenos_Aires' },
      end:   { dateTime: endDateTime.toISOString(),   timeZone: 'America/Argentina/Buenos_Aires' },
      conferenceData: {
        createRequest: {
          requestId: `medgrup-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      },
      // Todos son organizadores/invitados
      attendees: [],
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
      sendUpdates: 'none'
    });

    const eventoCreado = response.data;
    const meetLink = eventoCreado.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || eventoCreado.hangoutLink;

    res.json({
      ok: true,
      meetLink,
      eventoId: eventoCreado.id,
      eventoLink: eventoCreado.htmlLink,
      paciente,
      medicos: medicosList,
      fecha,
      hora
    });

  } catch (err) {
    console.error('Error Google Calendar:', err.message);
    if (err.code === 401) {
      tokenGuardado = null;
      return res.status(401).json({ error: 'Token expirado, re-autenticá', needsAuth: true });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, auth: !!tokenGuardado }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`MEDGRUP en puerto ${PORT}`));