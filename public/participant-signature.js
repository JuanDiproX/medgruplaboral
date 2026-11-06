(() => {
 const context=window.medgrupParticipant;if(!context||context.staff)return;
 const {base,headers,doctor}=context;
 const section=document.createElement('section');section.className='tarjeta firma-consulta';section.hidden=true;
 section.innerHTML='<h2>Tu firma en esta consulta</h2><p class="hint">El enlace es personal. La firma se registra con tu nombre y la fecha de confirmación.</p><button id="firma-actualizar" class="btn btn-borde" type="button">Actualizar documentos</button><p id="firma-estado" role="status" aria-live="polite"></p><div id="firma-documentos"></div><div id="firma-editor" hidden><h3 id="firma-titulo"></h3><p>Leé el documento antes de confirmar.</p><div id="firma-preview" tabindex="0" aria-label="Contenido del documento"></div><label for="firma-lienzo">Dibujá tu firma con el dedo o el mouse</label><canvas id="firma-lienzo" width="640" height="220" aria-label="Área para dibujar tu firma"></canvas><button id="firma-limpiar" class="btn btn-borde" type="button">Limpiar firma</button><label class="firma-consentimiento"><input id="firma-aceptar" type="checkbox"> Confirmo que leí este documento y autorizo registrar mi firma en él.</label><button id="firma-guardar" class="btn btn-azul" type="button">Confirmar firma</button></div>';
 document.querySelector('main').append(section);
 const shortcut=document.createElement('button');shortcut.type='button';shortcut.className='btn btn-borde';shortcut.textContent='Mi firma y documentos';shortcut.hidden=true;
 shortcut.onclick=()=>section.scrollIntoView({block:'start'});document.querySelector('#llamada .botonera').append(shortcut);
 const $=id=>section.querySelector('#'+id);let target=null,busy=false,drawn=false,drawing=false;
 const canvas=$('firma-lienzo'),ctx=canvas.getContext('2d');ctx.lineWidth=2.5;ctx.lineCap='round';ctx.strokeStyle='#13233a';
 function reset(){ctx.clearRect(0,0,canvas.width,canvas.height);drawn=false;$('firma-aceptar').checked=false;}
 function point(e){const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];}
 canvas.addEventListener('pointerdown',e=>{e.preventDefault();drawing=true;canvas.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(...point(e));});
 canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();ctx.lineTo(...point(e));ctx.stroke();drawn=true;});
 ['pointerup','pointercancel','lostpointercapture'].forEach(name=>canvas.addEventListener(name,()=>drawing=false));
 $('firma-limpiar').onclick=reset;
 async function api(path,options={}){const r=await fetch(base+path,{...options,headers:{...headers(),...(options.headers||{})},cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'No se pudo completar la operación.');return d;}
 function paragraph(parent,text){const p=document.createElement('p');p.textContent=text;parent.append(p);}
 function editor(doc){
  if(busy)return;target=doc;reset();$('firma-preview').replaceChildren();$('firma-editor').hidden=false;
  $('firma-titulo').textContent=doc.id?'Informe '+doc.numero:'Acta de participación';
  if(doc.id){
   const labels={numero:'Número',paciente:'Paciente',apellido_nombre:'Nombre',fecha_consulta:'Fecha de consulta',antecedentes:'Antecedentes',hallazgos:'Hallazgos',analisis:'Análisis',conclusion:'Conclusión',aptitud:'Aptitud',dias_reposo:'Días de reposo',diagnostico:'Diagnóstico',diagnostico_desc:'Descripción del diagnóstico',diagnostico_cie:'Código diagnóstico',indicaciones:'Indicaciones',informe_completo:'Informe'};
   for(const [key,value] of Object.entries(doc.contenido)){if(!['aptitud','dias_reposo'].includes(key)&&value!==null&&value!=='')paragraph($('firma-preview'),`${labels[key]||key.replaceAll('_',' ')}: ${value}`);}
  }
  else{
   paragraph($('firma-preview'),`Consulta: ${doc.tipo||'Consulta médica'}. Paciente: ${doc.paciente}. Firmante: ${doc.nombre}.`);
   paragraph($('firma-preview'),`Fecha: ${String(doc.fecha||'').split('T')[0]} · Hora: ${doc.hora||'No registrada'} (Argentina).`);
   for(const e of doc.eventos)paragraph($('firma-preview'),`${new Date(e.creado_en).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'})} · ${{union_medico:'Ingreso del profesional',union_paciente:'Ingreso del paciente',fin_consulta:'Finalización de consulta',inicio_medico:'Inicio del control'}[e.tipo]||e.tipo} · ${e.participante||''}`);
   paragraph($('firma-preview'),'Confirmo mi participación y firmo su acta. Esta firma no firma ni aprueba un informe médico posterior.');
  }
  $('firma-editor').scrollIntoView({block:'start'});
 }
 function button(text,handler,disabled=false){const b=document.createElement('button');b.type='button';b.className='btn btn-borde';b.textContent=text;b.disabled=disabled;b.onclick=handler;$('firma-documentos').append(b);}
 async function load(){
  if(busy)return;$('firma-actualizar').disabled=true;
  try{
   const acta=await api('/firma');section.hidden=false;shortcut.hidden=false;$('firma-documentos').replaceChildren();
   paragraph($('firma-documentos'),`Firmante: ${acta.nombre}`);
   button(acta.firmada?'Acta firmada':acta.puede_firmar?'Leer y firmar el acta':'Acta: esperando registro de participación',()=>editor(acta),acta.firmada||!acta.puede_firmar);
   if(doctor){const d=await api('/informes');for(const doc of d.informes)button(doc.firmado?`Informe ${doc.contenido.numero}: firmado`:`Leer y firmar informe ${doc.contenido.numero}`,()=>editor({...doc,numero:doc.contenido.numero}),doc.firmado);if(!d.informes.length)paragraph($('firma-documentos'),'El informe aparecerá aquí cuando el equipo médico lo genere. Podés volver a este enlace para revisarlo y firmarlo.');}
   $('firma-estado').textContent='';
  }catch(e){if(!section.hidden)$('firma-estado').textContent=e.message;}finally{$('firma-actualizar').disabled=false;}
 }
 $('firma-guardar').onclick=async()=>{
  if(busy||!target)return;
  if(!drawn||!$('firma-aceptar').checked){$('firma-estado').textContent='Dibujá tu firma y confirmá que leíste el documento.';return;}
  busy=true;$('firma-guardar').disabled=true;$('firma-limpiar').disabled=true;
  try{
   await api(target.id?`/informes/${target.id}/firma`:'/firma',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firma_base64:canvas.toDataURL('image/png'),consentimiento:true,...(target.id?{revision:target.revision}:{})})});
   $('firma-editor').hidden=true;busy=false;await load();$('firma-estado').textContent='Tu firma quedó registrada en esta consulta.';
  }catch(e){$('firma-estado').textContent=e.message;}finally{busy=false;$('firma-guardar').disabled=false;$('firma-limpiar').disabled=false;}
 };
 $('firma-actualizar').onclick=load;load();
})();
