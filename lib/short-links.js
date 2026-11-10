// Enlaces cortos para invitaciones: /i/k7m2xq9fhd en lugar de una dirección con 64 caracteres.
// El enlace corto solo redirige; el permiso sigue estando en el token original, con su
// vencimiento y su revocación. En la base no queda ni el código ni el destino en claro:
// el código se guarda como huella y el destino va cifrado con una clave derivada del código.
const crypto = require('crypto');
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789'; // sin 0/o, 1/l/i: se dictan y se copian sin errores
const LARGO = 10;                                   // 31^10 ≈ 8 × 10^14 combinaciones
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const valido = code => typeof code === 'string' && code.length === LARGO && [...code].every(c => ALFABETO.includes(c));
function nuevoCodigo() {
  let out = '';
  while (out.length < LARGO) { const b = crypto.randomBytes(1)[0]; if (b < 248) out += ALFABETO[b % 31]; }
  return out;
}
function cifrar(texto, clave) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', clave, iv);
  const data = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
function descifrar(valor, clave) {
  const b = Buffer.from(valor, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', clave, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
const claveDe = (material, uso) => crypto.createHash('sha256').update(uso + '|' + material).digest();

function createShortLinks({pool, secret, baseUrl, allowedHosts = []}) {
  let ready = false;
  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS enlaces_cortos(
      codigo_hash TEXT PRIMARY KEY, destino_hash TEXT NOT NULL, destino_cifrado TEXT NOT NULL, codigo_cifrado TEXT,
      vence_en TIMESTAMPTZ NOT NULL, creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(), usos INTEGER NOT NULL DEFAULT 0, ultimo_uso TIMESTAMPTZ)`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_enlaces_destino ON enlaces_cortos (destino_hash)');
    await pool.query('DELETE FROM enlaces_cortos WHERE vence_en < NOW() - INTERVAL \'30 days\'');
    ready = true;
  }
  // Solo se acortan direcciones del propio portal o de los proveedores de videollamada
  // declarados: el acortador no puede usarse para redirigir a cualquier sitio.
  function destinoPermitido(url) {
    if (typeof url !== 'string' || url.length > 4000) return null;
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    try {
      const u = new URL(url), propio = new URL(baseUrl());
      if (u.host === propio.host) return u.pathname + u.search + u.hash;
      if (u.protocol === 'https:' && allowedHosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) return u.href;
    } catch {}
    return null;
  }
  const absoluto = code => new URL('/i/' + code, baseUrl()).href;
  // Devuelve el enlace corto absoluto. Ante cualquier problema devuelve el enlace original:
  // una falla del acortador nunca debe impedir que el paciente reciba su invitación.
  async function shorten(url, {days = 60} = {}) {
    const destino = destinoPermitido(url);
    const original = () => { try { return new URL(url, baseUrl()).href; } catch { return url; } };
    if (!ready || !destino || /^\/i\/[a-z0-9]+$/.test(destino)) return original();
    try {
      const destinoHash = sha(destino);
      if (secret) {
        const prev = (await pool.query(`SELECT codigo_cifrado FROM enlaces_cortos WHERE destino_hash=$1 AND codigo_cifrado IS NOT NULL
          AND vence_en > NOW() + INTERVAL '1 day' ORDER BY vence_en DESC LIMIT 1`, [destinoHash])).rows[0];
        if (prev) { try { const code = descifrar(prev.codigo_cifrado, claveDe(secret, 'codigo')); if (valido(code)) return absoluto(code); } catch {} }
      }
      for (let intento = 0; intento < 4; intento++) {
        const code = nuevoCodigo();
        const r = await pool.query(`INSERT INTO enlaces_cortos(codigo_hash,destino_hash,destino_cifrado,codigo_cifrado,vence_en)
          VALUES($1,$2,$3,$4,NOW() + ($5 || ' days')::interval) ON CONFLICT (codigo_hash) DO NOTHING RETURNING codigo_hash`,
          [sha(code), destinoHash, cifrar(destino, claveDe(code, 'destino')), secret ? cifrar(code, claveDe(secret, 'codigo')) : null, String(days)]);
        if (r.rows.length) return absoluto(code);
      }
    } catch (e) { console.error('enlace_corto_fallo', e.code || e.message); }
    return original();
  }
  async function resolve(code) {
    if (!ready || !valido(code)) return null;
    const row = (await pool.query('SELECT destino_cifrado FROM enlaces_cortos WHERE codigo_hash=$1 AND vence_en > NOW()', [sha(code)])).rows[0];
    if (!row) return null;
    try {
      const destino = descifrar(row.destino_cifrado, claveDe(code, 'destino'));
      pool.query('UPDATE enlaces_cortos SET usos=usos+1, ultimo_uso=NOW() WHERE codigo_hash=$1', [sha(code)]).catch(() => {});
      return destino;
    } catch { return null; }
  }
  function mount(app, notFoundPage) {
    app.get('/i/:code', async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      try {
        const destino = await resolve(String(req.params.code || '').toLowerCase());
        if (destino) return res.redirect(302, destino);
      } catch {}
      res.status(404);
      notFoundPage ? res.sendFile(notFoundPage) : res.send('Este enlace no es válido o ya venció.');
    });
  }
  return {init, shorten, resolve, mount, destinoPermitido};
}
module.exports = {createShortLinks, valido, LARGO};
