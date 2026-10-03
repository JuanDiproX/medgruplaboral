// Videollamada embebida del panel.
// El iframe de Daily se envuelve con daily-js para saber qué pasa adentro: si ya entró el
// paciente, si se está grabando de verdad y si el médico salió desde los controles de Daily.
// Antes el cartel decía "GRABANDO" siempre, aunque la sala solo tuviera la grabación habilitada.
// Si daily-js no carga, la llamada abre igual que antes (src directo) y el estado no afirma nada
// sobre la grabación.
(function(){
  const $ = id => document.getElementById(id);
  let call = null;        // un solo objeto de daily-js, reutilizado entre consultas
  let modoDirecto = false; // true cuando se cayó al src directo
  let enSala = false;
  let turno = null;

  function estado(clave, texto){
    const el = $('vc-status');
    if(!el) return;
    el.dataset.estado = clave;
    el.textContent = texto;
  }

  function grabando(si){
    const p = $('rec-pill');
    if(p) p.hidden = !si;
  }

  function otrosEnSala(){
    try{ return Object.keys(call.participants()).filter(k => k !== 'local').length; }
    catch(e){ return 0; }
  }

  function actualizarPresencia(){
    if(!enSala) return;
    const n = otrosEnSala();
    if(n > 0) estado('en-consulta', n > 1 ? `En consulta · ${n + 1} personas` : 'En consulta');
    else estado('esperando', turno?.paciente ? `Esperando a ${turno.paciente}` : 'Esperando al paciente');
  }

  function crearCall(){
    if(call) return call;
    const D = window.DailyIframe || window.Daily;
    if(!D || typeof D.wrap !== 'function') return null;
    try{
      call = D.wrap($('daily-frame'));
      call.on('joined-meeting', () => { enSala = true; actualizarPresencia(); });
      call.on('participant-joined', actualizarPresencia);
      call.on('participant-left', actualizarPresencia);
      call.on('recording-started', () => grabando(true));
      call.on('recording-stopped', () => grabando(false));
      call.on('recording-error', () => {
        grabando(false);
        if(typeof mostrarToast === 'function') mostrarToast('La grabación se interrumpió', '#b5185b');
      });
      call.on('left-meeting', () => {
        // En modo directo daily-js ya no maneja el iframe: sus eventos tardíos no cuentan.
        if(modoDirecto) return;
        enSala = false;
        grabando(false);
        // Si el médico salió desde el botón de Daily, el turno sigue "en curso" hasta que
        // toque Finalizar: se lo decimos en vez de dejar la sala en negro sin explicación.
        if($('video-container')?.classList.contains('active')){
          estado('afuera', 'Saliste de la sala · finalizá la consulta para cargar el informe');
        }
      });
      call.on('error', () => { if(!modoDirecto) estado('afuera', 'Se cortó la conexión con la sala'); });
    }catch(e){
      console.warn('daily-js no pudo envolver el reproductor', e);
      call = null;
    }
    return call;
  }

  function abrirDirecto(link){
    modoDirecto = true;
    $('daily-frame').src = link;
    estado('sin-datos', 'Videollamada');
  }

  window.abrirSalaDaily = async function(link, t){
    turno = t || null;
    enSala = false;
    modoDirecto = false;
    grabando(false);
    $('btn-notas-ninja')?.setAttribute('aria-pressed', 'false');
    estado('conectando', 'Conectando…');

    const c = crearCall();
    if(!c){ abrirDirecto(link); return; }
    try{
      const ms = c.meetingState();
      if(ms === 'joined-meeting' || ms === 'joining-meeting') await c.leave();
      // El token del participante viaja en ?t=; daily-js lo quiere aparte.
      const u = new URL(link);
      const token = u.searchParams.get('t');
      u.searchParams.delete('t');
      await c.join(token ? { url: u.toString(), token } : { url: link });
    }catch(e){
      console.warn('daily-js no pudo unirse; se abre el link directo', e);
      abrirDirecto(link);
    }
  };

  window.cerrarSalaDaily = function(){
    enSala = false;
    turno = null;
    grabando(false);
    estado('conectando', 'Conectando…');
    $('btn-notas-ninja')?.setAttribute('aria-pressed', 'false');
    if(call && !modoDirecto){
      try{
        const ms = call.meetingState();
        if(ms === 'joined-meeting' || ms === 'joining-meeting') call.leave();
      }catch(e){}
    } else {
      $('daily-frame').src = '';
    }
    modoDirecto = false;
  };
})();
