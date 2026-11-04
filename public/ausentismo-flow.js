/* The absence form is one task: identity, address confirmation, clinician, documents.
   Loaded after the existing panel; all requests keep its established session headers. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel=$('au-panel-alta');
  if(!panel)return;
  let point=null,sourceId=null,busy=false,requestVersion=0;
  const address=$('au-domicilio');
  const hint=panel.querySelector('.card-body > div');
  if(hint)hint.textContent='Cargá los datos, confirmá el domicilio y elegí quién realizará el control. Todo queda listo desde este formulario.';
  address.setAttribute('autocomplete','street-address');
  address.setAttribute('aria-describedby','au-geo-status');
  const locationGroup=address.parentElement;
  const oldHint=locationGroup.querySelector('div');if(oldHint)oldHint.remove();
  const section=document.createElement('div');section.className='au-geo';
  section.innerHTML=`<div class="au-geo-actions"><button type="button" class="btn btn-ghost" id="au-buscar">Ubicar domicilio</button><label for="au-radio">Radio permitido (metros)</label><input id="au-radio" type="number" min="50" max="5000" step="50" value="300" style="max-width:100px"></div>
    <p id="au-geo-status" class="au-geo-status" role="status" aria-live="polite">Escribí calle, número, ciudad y provincia. Buscaremos el domicilio antes de guardar.</p>
    <iframe id="au-mapa" title="Ubicación del domicilio de reposo" loading="lazy" referrerpolicy="no-referrer" hidden></iframe>
    <a id="au-mapa-link" target="_blank" rel="noopener noreferrer" hidden>Revisar ubicación en Google Maps</a>
    <details><summary>La dirección no aparece o necesito ajustar el punto</summary><p class="au-step-hint">Podés pegar las coordenadas de Google Maps. Confirmá que correspondan al domicilio informado.</p><div class="form-grid"><div><label for="au-lat">Latitud</label><input id="au-lat" type="number" step="any" min="-90" max="90"></div><div><label for="au-lng">Longitud</label><input id="au-lng" type="number" step="any" min="-180" max="180"></div></div><button type="button" id="au-punto-manual" class="btn btn-ghost" style="margin-top:10px">Confirmar punto</button></details>`;
  locationGroup.append(section);
  const clinician=document.createElement('div');clinician.className='form-group full';
  clinician.innerHTML='<label class="form-lbl" for="au-profesional">Profesional a cargo</label><select id="au-profesional"><option value="">Asignar después</option></select><p class="au-step-hint">Si lo elegís ahora, al guardar podés programar la entrevista sin volver a cargar datos.</p>';
  const clinicianStep=document.createElement('h3');clinicianStep.className='au-paso';clinicianStep.innerHTML='<span class="au-paso-n">3</span>Profesional';
  locationGroup.after(clinicianStep,clinician);
  const submit=panel.querySelector('button[onclick="crearCasoAusentismo()"]');
  submit.id='au-guardar';submit.innerHTML='Guardar y continuar';
  const buttons=document.createElement('div');buttons.className='au-flow-actions';
  const draft=document.createElement('button');draft.type='button';draft.className='btn btn-ghost';draft.textContent='Guardar borrador';draft.onclick=()=>save(true);
  submit.before(buttons);buttons.append(submit,draft);
  buttons.prepend($('au-error')); // the message stays next to the buttons that produced it
  const reset=document.createElement('button');reset.type='button';reset.className='btn btn-ghost';reset.textContent='Cancelar nuevo control';reset.hidden=true;reset.onclick=clearSource;buttons.append(reset);
  const summary=document.createElement('div');summary.id='au-flow-summary';summary.className='au-flow-summary';summary.hidden=true;buttons.before(summary);
  // The form opens as a side sheet; closing keeps what was typed.
  let opener=null;
  window.abrirAltaCaso=()=>{
    if(panel.classList.contains('abierto'))return;
    $('au-error').style.display='none';
    opener=document.activeElement;panel.classList.add('abierto');document.body.classList.add('au-alta-activa');
    if(!professionalsLoaded){professionalsLoaded=true;loadClinicians();}
    const first=sourceId?$('au-motivo'):$('au-empresa');requestAnimationFrame(()=>first&&first.focus({preventScroll:true}));
  };
  window.cerrarAltaCaso=()=>{
    if(busy)return;
    if(!panel.classList.contains('abierto'))return;
    panel.classList.remove('abierto');document.body.classList.remove('au-alta-activa');
    if(opener&&document.contains(opener))opener.focus({preventScroll:true});opener=null;
  };
  document.addEventListener('keydown',e=>{
    if(!panel.classList.contains('abierto')||document.querySelector('.modal-bg.open'))return;
    if(e.key==='Escape'&&!busy)window.cerrarAltaCaso();
    if(e.key==='Tab'){
      const fields=[...panel.querySelectorAll('button,input,select,textarea,a[href],summary')].filter(el=>!el.disabled&&el.getClientRects().length);
      const first=fields[0],last=fields.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  });
  function status(text,state=''){const el=$('au-geo-status');el.textContent=text;el.dataset.state=state;}
  function invalidate(){requestVersion++;point=null;$('au-mapa').hidden=true;$('au-mapa-link').hidden=true;$('au-lat').value='';$('au-lng').value='';status('Dirección actualizada. Se buscará el nuevo domicilio al guardar.');}
  address.addEventListener('input',invalidate);
  function showPoint(lat,lng,label){
    point={lat,lng,address:address.value.trim()};$('au-lat').value=lat;$('au-lng').value=lng;
    $('au-mapa').src=`https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`;$('au-mapa').hidden=false;
    $('au-mapa-link').href=`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;$('au-mapa-link').hidden=false;
    status(`Ubicación encontrada: ${label || point.address}. Revisá el punto del mapa antes de continuar.`,'ok');
  }
  async function locate(){
    const direccion=address.value.trim();if(!direccion)throw Error('Escribí el domicilio, con ciudad y provincia.');
    const version=++requestVersion;status('Buscando el domicilio…');$('au-buscar').disabled=true;
    try{
      const r=await fetch('/api/geocode',{method:'POST',headers:apiHeaders(),body:JSON.stringify({direccion})});
      const d=await r.json();if(version!==requestVersion)throw Error('La dirección cambió durante la búsqueda. Volvé a verificarla.');
      if(!r.ok||!d.ok)throw Error(d.error||'No se encontró la dirección. Corregila o usá un punto manual.');
      showPoint(d.lat,d.lng,d.direccion_normalizada);return point;
    }catch(e){status(e.message,'error');throw e;}finally{$('au-buscar').disabled=false;}
  }
  $('au-buscar').onclick=()=>locate().catch(()=>{});
  $('au-punto-manual').onclick=()=>{
    if(!$('au-lat').value||!$('au-lng').value||!address.value.trim())return status('Completá dirección, latitud y longitud.','error');
    const lat=Number($('au-lat').value),lng=Number($('au-lng').value);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return status('Revisá las coordenadas.','error');
    requestVersion++;showPoint(lat,lng,'Punto indicado manualmente');
  };
  const clearPoint=()=>{point=null;status('Coordenadas modificadas. Presioná Confirmar punto para aplicarlas.');};
  $('au-lat').addEventListener('input',clearPoint);$('au-lng').addEventListener('input',clearPoint);
  async function loadClinicians(selected){
    try{const r=await fetch('/api/medicos',{headers:apiHeaders()}),d=await r.json();
      const list=Array.isArray(d)?d:(d.medicos||[]),select=$('au-profesional');select.replaceChildren(new Option('Asignar después',''));
      for(const m of list.filter(x=>x.activo!==false))select.add(new Option(m.nombre,m.id));
      if(selected)select.value=String(selected);
    }catch{status('No pudimos cargar profesionales. Podés asignarlo después.','error');}
  }
  let professionalsLoaded=false;
  // Refresh lazily when the form is used, avoiding unauthenticated startup requests.
  panel.addEventListener('focusin',()=>{if(!professionalsLoaded){professionalsLoaded=true;loadClinicians();}},{once:true});
  function clearSource(){sourceId=null;summary.hidden=true;reset.hidden=true;$('au-empresa').disabled=false;$('au-dni').readOnly=false;panel.querySelector('.card-title').textContent='Nuevo caso';}
  window.nuevoControlCaso=async id=>{
    if(busy)return;
    const c=casosAusentismo.find(x=>x.id===id);if(!c)return;
    if(!['resuelto','cancelado'].includes(c.estado))return mostrarError('Este trabajador ya tiene un control abierto. Continuá ese control.');
    sourceId=id;panel.querySelector('.card-title').textContent='Nuevo control del mismo trabajador';
    $('au-empresa').value=c.empresa_nombre;$('au-trabajador').value=c.trabajador_nombre;$('au-dni').value=c.trabajador_dni||'';$('au-telefono').value=c.trabajador_telefono||'';
    $('au-solicitante-email').value=c.solicitante_email||'';$('au-trabajador-email').value=c.trabajador_email||'';
    $('au-empresa').disabled=true;$('au-dni').readOnly=!!c.trabajador_dni;
    $('au-tipo-control').value=c.tipo_control||'ausentismo';onTipoControlChange();
    address.value=c.domicilio||'';invalidate();$('au-radio').value=c.radio_metros||300;
    if(c.domicilio_lat!=null&&c.domicilio_lng!=null)showPoint(Number(c.domicilio_lat),Number(c.domicilio_lng),'Domicilio del control anterior');
    $('au-motivo').value='';$('au-certificados').value='';
    summary.textContent=`Se conservarán los datos de ${c.trabajador_nombre}. El control anterior y sus documentos seguirán en el historial. Cargá el motivo actual y confirmá el domicilio; las autorizaciones excepcionales no se copian.`;
    summary.hidden=false;reset.hidden=false;professionalsLoaded=true;await loadClinicians(c.profesional_id);
    window.abrirAltaCaso();$('au-motivo').focus({preventScroll:true});
  };
  async function save(draftOnly=false){
    if(busy)return;const err=$('au-error');err.style.display='none';
    const empresa=$('au-empresa').value,trabajador=$('au-trabajador').value.trim(),motivo=$('au-motivo').value.trim();
    if(!empresa||!trabajador){err.textContent='Completá empresa y trabajador.';err.style.display='block';return;}
    if(!$('au-solicitante-email').value.trim()||!$('au-trabajador-email').value.trim()||!$('au-solicitante-email').checkValidity()||!$('au-trabajador-email').checkValidity()){
      err.textContent='Completá un correo válido de la empresa y otro del paciente.';err.style.display='block';return;
    }
    if(!draftOnly&&!motivo&&$('au-tipo-control').value==='ausentismo'){err.textContent='Completá el motivo de este control.';err.style.display='block';return;}
    busy=true;submit.disabled=true;draft.disabled=true;reset.disabled=true;submit.textContent='Preparando control…';
    try{
      if(!draftOnly&&(!point||point.address!==address.value.trim()))await locate();
      const body={empresa_nombre:empresa,trabajador_nombre:trabajador,trabajador_dni:$('au-dni').value.trim(),trabajador_telefono:$('au-telefono').value.trim(),
        motivo,tipo_control:$('au-tipo-control').value,domicilio:address.value.trim(),
        solicitante_email:$('au-solicitante-email').value.trim(),trabajador_email:$('au-trabajador-email').value.trim(),
        radio_metros:Number($('au-radio').value),profesional_id:$('au-profesional').value?Number($('au-profesional').value):null,validar_domicilio:!draftOnly};
      if(point&&point.address===body.domicilio){body.domicilio_lat=point.lat;body.domicilio_lng=point.lng;}
      const r=await fetch(sourceId?`/api/ausentismo/casos/${sourceId}/nuevo-control`:'/api/ausentismo/casos',{method:'POST',headers:apiHeaders(),body:JSON.stringify(body)});
      const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'No se pudo guardar el control.');
      let warning=d.correo_solicitud==='enviado'?'':d.ya_existia?'':'El control se guardó. La confirmación por correo quedó pendiente; podés revisar su estado desde Correos.';const files=[...$('au-certificados').files];
      if(files.length&&!d.ya_existia){try{await subirCertificados(d.id,files);}catch(e){warning='El control se guardó, pero un certificado no se adjuntó: '+e.message;}}
      for(const id of ['au-trabajador','au-dni','au-telefono','au-domicilio','au-motivo','au-certificados','au-solicitante-email','au-trabajador-email'])$(id).value='';
      invalidate();clearSource();$('au-profesional').value='';
      if(!warning){busy=false;window.cerrarAltaCaso();busy=true;}
      await cargarCasosAusentismo();mostrarToast(d.ya_existia?'Ya existía un control abierto para este caso':'Control guardado','#205a40');
      if(warning){err.textContent=warning;err.style.display='block';}
      if(!draftOnly){const c=casosAusentismo.find(x=>x.id===d.id);if(c?.profesional_id)abrirProgramarCaso(d.id);else if(c)abrirAsignarCaso(d.id);}
    }catch(e){err.textContent=e.message;err.style.display='block';}
    finally{busy=false;submit.disabled=false;draft.disabled=false;reset.disabled=false;submit.textContent='Guardar y continuar';}
  }
  window.crearCasoAusentismo=()=>save(false);
  window.abrirCorreosCaso=async id=>{
    let modal=$('modal-correos-caso');
    if(!modal){
      modal=document.createElement('div');modal.id='modal-correos-caso';modal.className='modal-bg';
      const content=document.createElement('div');content.className='modal';
      const title=document.createElement('h2');title.textContent='Correos del control';title.className='modal-title';
      const body=document.createElement('div');body.id='correos-caso-lista';body.setAttribute('aria-live','polite');
      const note=document.createElement('p');note.className='au-ayuda';note.textContent='Enviado significa que el servidor de correo aceptó el mensaje; no confirma que haya sido leído ni su llegada a la bandeja de entrada.';
      const close=document.createElement('button');close.className='btn btn-ghost';close.textContent='Cerrar';close.onclick=()=>modal.classList.remove('open');
      content.append(title,body,note,close);modal.append(content);document.body.append(modal);
    }
    modal.classList.add('open');const list=$('correos-caso-lista');list.textContent='Consultando envíos…';
    try{
      const r=await fetch(`/api/ausentismo/casos/${id}/correos`,{headers:apiHeaders()}),d=await r.json();if(!r.ok)throw Error(d.error||'No se pudieron consultar los correos');
      list.replaceChildren();if(!d.correos.length){list.textContent='Este control todavía no tiene correos registrados.';return;}
      for(const mail of d.correos){
        const row=document.createElement('div');row.style.cssText='padding:14px 0;border-bottom:1px solid var(--rule);overflow-wrap:anywhere';
        const description=document.createElement('p');description.textContent=`${mail.tipo==='solicitud'?'Confirmación a la empresa':'Invitación al paciente'} · ${mail.destinatario}`;
        const state=document.createElement('p');state.textContent=`Estado: ${mail.estado}. Intentos: ${mail.intentos}.`;
        row.append(description,state);
        if(['pendiente','fallido'].includes(mail.estado)){
          const retry=document.createElement('button');retry.className='btn btn-ghost';retry.textContent='Reintentar envío';
          retry.onclick=async()=>{retry.disabled=true;try{const result=await fetch(`/api/ausentismo/casos/${id}/correos/${mail.id}/reintentar`,{method:'POST',headers:apiHeaders()});const body=await result.json();if(!result.ok)throw Error(body.error);await window.abrirCorreosCaso(id);}catch(e){state.textContent=e.message;retry.disabled=false;}};
          row.append(retry);
        }
        list.append(row);
      }
    }catch(e){list.textContent=e.message;}
  };
})();
