// Endurecimiento transversal del servidor: cabeceras, orígenes permitidos, límites por IP,
// errores sin detalle interno y registro de auditoría. No cambia rutas, permisos ni datos.
const crypto = require('crypto');

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 60);
}

// Lo que el navegador necesita cargar hoy: fuentes de Google, Daily (script e iframe de la
// llamada) y datos embebidos. El portal usa scripts y estilos en línea, por eso la política
// completa va en modo informe: avisa lo que bloquearía sin romper una consulta en curso.
const CSP_INFORME = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://*.daily.co",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com https://*.tile.openstreetmap.org",
  "media-src 'self' blob: data:",
  "connect-src 'self' https://*.daily.co wss://*.daily.co https://*.pluot.blue wss://*.pluot.blue",
  "frame-src 'self' blob: data: https://*.daily.co https://www.google.com https://maps.google.com https://www.openstreetmap.org",
  "worker-src 'self' blob:",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
  'report-uri /api/csp-informe'
].join('; ');
// Esta parte sí se aplica: no afecta scripts ni llamadas, solo impide que el portal se
// incruste en otro sitio, que se inyecte <base> o que un formulario envíe datos afuera.
const CSP_APLICADA = "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

function headers({production = false} = {}) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Cámara y micrófono no se restringen acá: los usa la videollamada embebida y una política
    // mal interpretada por un navegador viejo dejaría a un paciente sin poder atenderse.
    res.setHeader('Permissions-Policy', 'geolocation=(self), payment=(), usb=()');
    res.setHeader('Content-Security-Policy', CSP_APLICADA);
    res.setHeader('Content-Security-Policy-Report-Only', CSP_INFORME);
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Las respuestas de la API llevan datos de salud: no deben quedar en cachés intermedios.
    if (req.path.startsWith('/api/') && !res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

// El portal se consume desde su propio origen. Otros orígenes solo si se declaran en
// ORIGENES_PERMITIDOS (separados por coma). Pedidos sin Origin (apps, webhooks, curl) pasan:
// CORS protege navegadores, no reemplaza la autenticación.
function corsOptions(extra = '') {
  const allowed = new Set(String(extra).split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean));
  return (req, callback) => {
    const origin = req.headers.origin;
    if (!origin) return callback(null, {origin: false});
    let same = false;
    try { same = new URL(origin).host === req.headers.host; } catch {}
    callback(null, {origin: same || allowed.has(origin)});
  };
}

// Límite de pedidos por IP en memoria. Sirve para una sola instancia (el despliegue actual);
// con varias réplicas hay que moverlo a la base o a Redis.
function rateLimit({windowMs, max, name = 'general', message = 'Demasiados intentos. Esperá unos minutos antes de volver a intentar.', clock = Date.now}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = clock(), key = name + '|' + clientIp(req);
    let entry = hits.get(key);
    if (!entry || entry.until <= now) { entry = {count: 0, until: now + windowMs}; hits.set(key, entry); }
    if (hits.size > 20000) for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
    if (++entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000));
      return res.status(429).json({error: message, code: 'DEMASIADOS_INTENTOS'});
    }
    next();
  };
}

// Un error de la base o del propio código no debe llegar al navegador: puede mostrar nombres
// de tablas, consultas o rutas internas. Los mensajes que escribe la aplicación sí se muestran.
function esErrorInterno(err) {
  if (!err || err.publico) return false;
  if (err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError || err instanceof RangeError) return true;
  if (typeof err.code === 'string' && (/^[0-9A-Z]{5}$/.test(err.code) || /^E[A-Z_]+$/.test(err.code))) return true;
  return Boolean(err.severity || err.routine || err.syscall);
}
function fallo(res, err, extra = {}) {
  if (res.headersSent) return;
  if (!esErrorInterno(err)) return res.status(500).json({error: err?.message || 'No se pudo completar la operación.', ...extra});
  const ref = crypto.randomBytes(4).toString('hex');
  console.error('error_interno', ref, err.code || err.name, err.message);
  res.status(500).json({error: `No se pudo completar la operación. Si se repite, avisá a soporte con el código ${ref}.`, ref});
}

const CLAVE_MINIMA = 10;
function claveDebil(password) {
  if (typeof password !== 'string' || password.length < CLAVE_MINIMA) return `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`;
  if (password.length > 200) return 'La contraseña es demasiado larga.';
  if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(password) || !/[0-9]/.test(password)) return 'La contraseña debe combinar letras y números.';
  if (/^(.)\1+$/.test(password) || /^(1234567890|0123456789|medgrup\d*|password\d*|contrasena\d*)$/i.test(password)) return 'Elegí una contraseña menos predecible.';
  return null;
}

// Quién hizo qué: altas, cambios, bajas, descargas de documentos e ingresos. No guarda el
// contenido clínico ni contraseñas, solo la acción. Si la escritura falla, la operación sigue.
function createAudit({pool, identify}) {
  let ready = false;
  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS auditoria(
      id BIGSERIAL PRIMARY KEY, creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(), actor_tipo TEXT NOT NULL, actor_id TEXT, actor TEXT,
      accion TEXT NOT NULL, ruta TEXT NOT NULL, estado INTEGER, ip TEXT, detalle JSONB)`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria (creado_en DESC)');
    ready = true;
  }
  function record(entry) {
    if (!ready) return;
    pool.query('INSERT INTO auditoria(actor_tipo,actor_id,actor,accion,ruta,estado,ip,detalle) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [entry.actor_tipo || 'anonimo', entry.actor_id != null ? String(entry.actor_id) : null, entry.actor || null, entry.accion,
        String(entry.ruta || '').slice(0, 300), entry.estado || null, entry.ip || null, entry.detalle ? JSON.stringify(entry.detalle) : null])
      .catch(() => console.error('auditoria_no_registrada'));
  }
  const DOCUMENTO = /\/(pdf|pdf-firmado|acta|informe-inasistencia|archivo|certificados\/\d+|informes\/\d+)(\/|$)/;
  function middleware(req, res, next) {
    if (!req.path.startsWith('/api/')) return next();
    const escritura = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const descarga = req.method === 'GET' && DOCUMENTO.test(req.path);
    if (!escritura && !descarga) return next();
    if (/\/(mensajes|eventos|csp-informe|version)$/.test(req.path) || req.path.startsWith('/api/webhooks/')) return next();
    res.on('finish', () => {
      const who = identify(req) || {};
      const login = /\/(login|forgot-password|reset-password)$/.test(req.path);
      if (!who.tipo && !login) return;
      record({actor_tipo: who.tipo || 'anonimo', actor_id: who.id, actor: who.nombre || (login ? String(req.body?.email || '').slice(0, 200) : null),
        accion: descarga ? 'descarga' : req.method, ruta: req.path, estado: res.statusCode, ip: clientIp(req)});
    });
    next();
  }
  return {init, record, middleware};
}

module.exports = {headers, corsOptions, rateLimit, fallo, esErrorInterno, claveDebil, clientIp, createAudit, CLAVE_MINIMA};
