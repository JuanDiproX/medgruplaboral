(() => {
  'use strict';
  window.chatTurnoDisponible = false;
  let panel, frame, active;
  window.abrirChatTurno = id => {
    if (!window.chatTurnoDisponible || !id) return;
    if (!panel) {
      panel = document.createElement('section');
      panel.setAttribute('aria-label','Chat con el paciente');
      panel.style.cssText = 'position:fixed;right:12px;bottom:12px;width:min(440px,calc(100vw - 24px));height:82vh;background:white;z-index:680;border:1px solid #bfd2e4;border-radius:14px;box-shadow:0 8px 40px #172b4d44;overflow:hidden';
      const close = document.createElement('button');
      close.textContent = 'Cerrar chat';
      close.style.cssText = 'display:block;margin:8px 12px 8px auto;padding:6px 12px;cursor:pointer';
      close.onclick = () => { panel.hidden=true; frame.src='about:blank'; active=null; };
      frame = document.createElement('iframe');
      frame.title = 'Mensajes y estudios del paciente';
      frame.style.cssText = 'border:0;width:100%;height:calc(100% - 48px)';
      panel.append(close,frame);document.body.append(panel);
    }
    if (active !== id) { frame.src='/atencion.html#turno='+encodeURIComponent(id); active=id; }
    panel.hidden=false;
  };
  window.chatTurnoConfig = fetch('/api/chat/config',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{
    if (!d?.enabled) return;
    window.chatTurnoDisponible=true;
    const button=document.getElementById('btn-chat-llamada');if(button){button.hidden=false;button.style.display='inline-flex';}
    if(typeof renderAgenda==='function')renderAgenda();
  }).catch(()=>{});
})();
