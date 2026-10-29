// Aggregate commercial counters in Railway logs. No cookies, identity or form values.
const events = new Set(['page_view','whatsapp_click','contact_click','email_click','form_start','form_success','form_error']);
const routes = new Set(['/', '/medicina-laboral.html','/contacto.html','/propuesta.html','/servicios.html',
  '/servicios/juntas-medicas.html','/servicios/ausentismo.html','/servicios/licencias-psiquiatricas.html',
  '/servicios/aptos-examenes.html','/servicios/teleconsultas.html','/servicios/informes.html']);
let windowStart = Date.now(), count = 0;
module.exports = async (req, res) => {
  const end = status => {res.writeHead(status, {'Cache-Control':'no-store'});res.end();};
  if (req.headers.origin !== 'https://laboral.medgrup.com.ar') return end(403);
  if (!req.headers['content-type']?.startsWith('application/json')) return end(415);
  if (Date.now() - windowStart > 60000) {windowStart = Date.now(); count = 0;}
  if (++count > 300) return end(429);
  let body = '';
  try {
    for await (const chunk of req) {body += chunk; if(Buffer.byteLength(body)>512) return end(413);}
    const data = JSON.parse(body);
    if (!events.has(data.event) || !routes.has(data.path)) return end(400);
    console.log(JSON.stringify({type:'commercial_event',event:data.event,path:data.path}));
    return end(204);
  } catch {return end(400);}
};
