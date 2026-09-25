(() => {
  'use strict';
  const $=id=>document.getElementById(id), params=new URLSearchParams(location.hash.slice(1));
  const turno=params.get('turno'), staff=Boolean(turno);
  let token=params.get('token');
  if(token){sessionStorage.setItem('medgrup_chat_token',token);history.replaceState(null,'',location.pathname);}
  if(!staff)token=token||sessionStorage.getItem('medgrup_chat_token');
  const base=staff?`/api/turnos/${encodeURIComponent(turno)}/chat`:'/api/chat/paciente';
  const headers=()=>staff?{'x-session-token':localStorage.getItem('medgrup_token')||''}:{'x-chat-token':token||''};
  let cursor='0',busy=false,stopped=false,call=null;
  async function api(path,options={}){
    const r=await fetch(base+path,{...options,headers:{...headers(),...(options.headers||{})},cache:'no-store'});
    if(!r.ok){const d=await r.json().catch(()=>({}));if(r.status===401||r.status===403){stopped=true;$('enviar').disabled=true;}throw Error(d.error||'No se pudo conectar.');}return r;
  }
  async function download(id,name){
    try{const r=await api('/archivos/'+id),blob=await r.blob(),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
    catch(e){$('estado').textContent=e.message;}
  }
  function show(m){
    const div=document.createElement('div');div.className='mensaje '+(m.rol==='medico'?'medico':'');
    const who=document.createElement('small');who.textContent=m.autor+' · '+new Date(m.creado_en).toLocaleString('es-AR');div.append(who);
    const content=document.createElement('div');content.textContent=m.texto;div.append(content);
    if(m.nombre_archivo){const b=document.createElement('button');b.textContent='Descargar '+m.nombre_archivo;b.onclick=()=>download(m.id,m.nombre_archivo);div.append(b);}
    $('mensajes').append(div);
  }
  async function refresh(){
    if(busy||stopped)return;busy=true;
    try{
      const list=$('mensajes'),bottom=list.scrollHeight-list.scrollTop-list.clientHeight<80;
      const d=await(await api('/mensajes?after='+cursor)).json();
      for(const m of d.mensajes){show(m);cursor=String(m.id);}
      if(bottom)list.scrollTop=list.scrollHeight;
      $('estado').textContent='';
    }catch(e){$('estado').textContent=e.message;}finally{busy=false;}
  }
  async function poll(){await refresh();if(!stopped)setTimeout(poll,3000);}
  const read=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('No se pudo leer el archivo.'));r.readAsDataURL(file);});
  $('formulario').onsubmit=async e=>{
    e.preventDefault();if(stopped)return;$('enviar').disabled=true;
    try{
      const file=$('archivo').files[0];if(file&&file.size>5*1024*1024)throw Error('El archivo supera los 5 MB.');
      if(!$('texto').value.trim()&&!file)throw Error('Escribí un mensaje o elegí un archivo.');
      const body={texto:$('texto').value};if(file)body.adjunto={name:file.name,base64:await read(file)};
      await api('/mensajes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      $('texto').value='';$('archivo').value='';await refresh();
    }catch(e){$('estado').textContent=e.message;}finally{$('enviar').disabled=stopped;}
  };
  $('invitar').onclick=async()=>{
    $('invitar').disabled=true;
    try{const d=await(await api('/invitacion',{method:'POST'})).json();$('invitacion').value=new URL(d.link,location.origin).href;$('invitacion').hidden=false;$('invitacion').select();}
    catch(e){$('estado').textContent=e.message;}finally{$('invitar').disabled=false;}
  };
  $('revocar').onclick=async()=>{
    if(!confirm('¿Revocar todos los enlaces de chat de este paciente para este turno?'))return;
    try{await api('/revocar',{method:'POST'});$('invitacion').hidden=true;$('estado').textContent='Enlaces revocados. Podés generar uno nuevo.';}catch(e){$('estado').textContent=e.message;}
  };
  $('conectar').onclick=async()=>{
    try{
      const d=await(await api('/sesion')).json();
      if(!d.llamada)throw Error('La llamada no está habilitada.');
      $('video').src=d.llamada;$('video').hidden=false;$('conectar').hidden=true;
    }catch(e){$('estado').textContent=e.message;}
  };
  async function start(){
    if(staff){document.body.classList.add('staff');$('llamada').hidden=true;$('acciones').hidden=false;}
    try{
      const d=await(await api('/sesion')).json();$('paciente').textContent=d.paciente;
      if(d.llamada){call=d.llamada;$('conectar').hidden=false;}
      else if(d.ingreso){$('ingreso').href=d.ingreso;$('ingreso').hidden=false;$('instruccion').textContent='Podés enviar documentación ahora. Para entrar a la videollamada, primero completá la verificación de ingreso.';}
      else if(!staff)$('instruccion').textContent='El chat está disponible para enviar documentación; la llamada no está habilitada.';
      $('enviar').disabled=false;poll();
    }catch(e){$('estado').textContent=e.message;}
  }
  start();
})();
