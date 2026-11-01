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
  locationGroup.after(clinician);
  const submit=panel.querySelector('button[onclick="crearCasoAusentismo()"]');
  submit.id='au-guardar';submit.innerHTML='Guardar y continuar';
  const buttons=document.createElement('div');buttons.className='au-flow-actions';
  const draft=document.createElement('button');draft.type='button';draft.className='btn btn-ghost';draft.textContent='Guardar borrador';draft.onclick=()=>save(true);
  submit.before(buttons);buttons.append(submit,draft);
  const reset=document.createElement('button');reset.type='button';reset.className='btn btn-ghost';reset.textContent='Cancelar nuevo control';reset.hidden=true;reset.onclick=clearSource;buttons.append(reset);
  const summary=document.createElement('div');summary.id='au-flow-summary';summary.className='au-flow-summary';summary.hidden=true;buttons.before(summary);
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
    $('au-empresa').disabled=true;$('au-dni').readOnly=!!c.trabajador_dni;
    $('au-tipo-control').value=c.tipo_control||'ausentismo';onTipoControlChange();
    address.value=c.domicilio||'';invalidate();$('au-radio').value=c.radio_metros||300;
    if(c.domicilio_lat!=null&&c.domicilio_lng!=null)showPoint(Number(c.domicilio_lat),Number(c.domicilio_lng),'Domicilio del control anterior');
    $('au-motivo').value='';$('au-documentacion').value='';$('au-certificados').value='';
    summary.textContent=`Se conservarán los datos de ${c.trabajador_nombre}. El control anterior y sus documentos seguirán en el historial. Cargá el motivo actual y confirmá el domicilio; las autorizaciones excepcionales no se copian.`;
    summary.hidden=false;reset.hidden=false;professionalsLoaded=true;await loadClinicians(c.profesional_id);
    panel.scrollIntoView({behavior:'smooth',block:'start'});$('au-motivo').focus({preventScroll:true});
  };
  async function save(draftOnly=false){
    if(busy)return;const err=$('au-error');err.style.display='none';
    const empresa=$('au-empresa').value,trabajador=$('au-trabajador').value.trim(),motivo=$('au-motivo').value.trim();
    if(!empresa||!trabajador){err.textContent='Completá empresa y trabajador.';err.style.display='block';return;}
    if(!draftOnly&&!motivo&&$('au-tipo-control').value==='ausentismo'){err.textContent='Completá el motivo de este control.';err.style.display='block';return;}
    busy=true;submit.disabled=true;draft.disabled=true;reset.disabled=true;submit.textContent='Preparando control…';
    try{
      if(!draftOnly&&(!point||point.address!==address.value.trim()))await locate();
      const body={empresa_nombre:empresa,trabajador_nombre:trabajador,trabajador_dni:$('au-dni').value.trim(),trabajador_telefono:$('au-telefono').value.trim(),
        motivo,documentacion:$('au-documentacion').value.trim(),tipo_control:$('au-tipo-control').value,domicilio:address.value.trim(),
        radio_metros:Number($('au-radio').value),profesional_id:$('au-profesional').value?Number($('au-profesional').value):null,validar_domicilio:!draftOnly};
      if(point&&point.address===body.domicilio){body.domicilio_lat=point.lat;body.domicilio_lng=point.lng;}
      const r=await fetch(sourceId?`/api/ausentismo/casos/${sourceId}/nuevo-control`:'/api/ausentismo/casos',{method:'POST',headers:apiHeaders(),body:JSON.stringify(body)});
      const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'No se pudo guardar el control.');
      let warning='';const files=[...$('au-certificados').files];
      if(files.length&&!d.ya_existia){try{await subirCertificados(d.id,files);}catch(e){warning='El control se guardó, pero un certificado no se adjuntó: '+e.message;}}
      for(const id of ['au-trabajador','au-dni','au-telefono','au-domicilio','au-motivo','au-documentacion','au-certificados'])$(id).value='';
      invalidate();clearSource();$('au-profesional').value='';
      await cargarCasosAusentismo();mostrarToast(d.ya_existia?'Ya existía un control abierto para este caso':'Control guardado','#205a40');
      if(warning){err.textContent=warning;err.style.display='block';}
      if(!draftOnly){const c=casosAusentismo.find(x=>x.id===d.id);if(c?.profesional_id)abrirProgramarCaso(d.id);else if(c)abrirAsignarCaso(d.id);}
    }catch(e){err.textContent=e.message;err.style.display='block';}
    finally{busy=false;submit.disabled=false;draft.disabled=false;reset.disabled=false;submit.textContent='Guardar y continuar';}
  }
  window.crearCasoAusentismo=()=>save(false);
})();
