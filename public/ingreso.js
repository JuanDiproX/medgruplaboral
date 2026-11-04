(() => {
 'use strict';
 const token=location.pathname.split('/').filter(Boolean).pop(),$=id=>document.getElementById(id);
 let excepcionGeo=false,verificando=false,listo=false,geoError=null;
 function aviso(tipo,texto){$('aviso').replaceChildren();if(texto){const p=document.createElement('p');p.className='aviso aviso-'+tipo;p.textContent=texto;$('aviso').append(p);}}
 function dato(label,value,wide=false){const group=document.createElement('div');group.className='dato'+(wide?' ancho':'');const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;group.append(dt,dd);$('datos').append(group);}
 async function cargar(){
  listo=false;$('btn').hidden=true;$('link-llamada').hidden=true;$('recargar').hidden=true;$('preparacion').hidden=true;$('ayuda').hidden=true;
  $('cargando').hidden=false;$('cargando-txt').textContent='Consultando la entrevista…';aviso('','');
  try{
   const r=await fetch('/api/ingreso/'+encodeURIComponent(token),{cache:'no-store'}),d=await r.json();
   if(!d.ok){$('subtitulo').textContent='Revisá el enlace que te enviaron o consultá a quien coordinó la entrevista.';aviso('error',d.error||'Este enlace no es válido.');return;}
   $('titulo').textContent=d.control||'Tu entrevista médica';$('saludo').textContent='Hola '+d.trabajador+'.';$('saludo').hidden=false;$('datos').replaceChildren();
   if(d.fecha)dato('Fecha',String(d.fecha).split('T')[0].split('-').reverse().join('/'));if(d.hora)dato('Hora',d.hora+' hs · Argentina');if(d.domicilio)dato('Domicilio informado',d.domicilio,true);$('datos').hidden=!$('datos').children.length;
   if(d.cerrado){$('subtitulo').textContent='Este control ya finalizó.';aviso('alerta','Esta entrevista ya está cerrada.');$('pie').textContent='Si necesitás una nueva entrevista, contactá a quien coordinó el control.';return;}
   excepcionGeo=d.excepcion_geo===true;
   if(excepcionGeo){
    $('subtitulo').textContent='Revisá los datos y continuá a tu entrevista.';$('paso-validar-texto').textContent='Confirmar acceso';$('btn').textContent='Continuar a la entrevista';
    aviso('info','MEDGRUP autorizó el ingreso sin validación geográfica para esta entrevista.');$('pie').textContent='El domicilio mostrado es el informado, sin verificación geográfica.';
   }else if(!d.tiene_domicilio){$('subtitulo').textContent='Falta confirmar el domicilio de este control.';aviso('alerta','Tu domicilio todavía no está verificado en el sistema. Avisale a tu empresa antes de la entrevista.');return;}
   else{$('subtitulo').textContent='Antes de entrar, vamos a confirmar tu ubicación.';$('preparacion').hidden=false;$('ayuda').hidden=false;$('btn').textContent='Validar mi ubicación';}
   listo=true;$('btn').hidden=false;$('btn').disabled=false;
  }catch{$('subtitulo').textContent='No pudimos consultar los datos de tu entrevista.';aviso('error','Revisá tu conexión a internet y volvé a cargar la entrevista.');$('recargar').hidden=false;}
  finally{$('cargando').hidden=true;}
 }
 function ubicacionActual(){
  geoError=null;return new Promise(resolve=>{
   if(!navigator.geolocation){geoError='no_disponible';return resolve(null);}
   navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,precision:p.coords.accuracy}),e=>{geoError=e.code===1?'permiso':e.code===3?'tiempo':'senal';resolve(null);},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
  });
 }
 async function verificar(){
  if(verificando||!listo)return;
  verificando=true;$('btn').disabled=true;$('btn').hidden=true;$('preparacion').hidden=true;$('cargando').hidden=false;
  $('cargando-txt').textContent=excepcionGeo?'Confirmando el acceso…':'Buscando tu ubicación…';$('acciones-ingreso').setAttribute('aria-busy','true');aviso('','');
  try{
   const pos=excepcionGeo?null:await ubicacionActual();$('cargando-txt').textContent='Validando el ingreso…';
   const r=await fetch('/api/ingreso/'+encodeURIComponent(token)+'/verificar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pos||{})}),d=await r.json();
   if(d.ok){
    listo=false;$('titulo').textContent='Ingresando a tu entrevista';$('subtitulo').textContent='Estamos abriendo la videollamada. Permití el uso de la cámara y el micrófono si el navegador te lo pide.';
    aviso('ok',d.excepcion_geo?'Tu ingreso está autorizado, sin validación geográfica.':'Ubicación validada. Te estamos conectando con el equipo médico.');
    $('paso-validar').removeAttribute('aria-current');$('paso-validar').classList.add('listo');$('paso-ingresar').setAttribute('aria-current','step');
    $('link-llamada').href=d.link;$('link-llamada').hidden=false;$('ayuda').hidden=true;
    $('pie').textContent=d.excepcion_geo?'El acceso se abrirá automáticamente.':'Permanecé en el domicilio informado durante la entrevista.';
    location.replace(d.link);return;
   }
   let mensaje=d.error||'No pudimos verificar tu ubicación.';
   if(d.code==='SIN_UBICACION'&&geoError==='permiso')mensaje='El navegador no tiene permiso para acceder a tu ubicación. Habilitalo en los permisos del sitio y volvé a intentar.';
   else if(d.code==='SIN_UBICACION'&&geoError==='tiempo')mensaje='La ubicación está tardando más de lo esperado. Comprobá que esté activada, acercate a una ventana y volvé a intentar.';
   aviso(d.code==='FUERA_DE_RANGO'||d.code==='PRECISION_BAJA'?'alerta':'error',mensaje);
   if(['CASO_CERRADO','LINK_INVALIDO','SIN_ENTREVISTA','SIN_DOMICILIO'].includes(d.code)){listo=false;$('pie').textContent='Contactá a quien coordinó la entrevista para revisar el acceso.';}
   else{$('btn').textContent='Volver a validar mi ubicación';$('btn').hidden=false;if(!excepcionGeo){$('ayuda').hidden=false;if(geoError)$('ayuda').open=true;}}
  }catch{aviso('error','No pudimos conectarnos. Revisá tu internet y volvé a intentar.');$('btn').textContent='Volver a intentar';$('btn').hidden=false;}
  finally{verificando=false;$('cargando').hidden=true;$('btn').disabled=false;$('acciones-ingreso').removeAttribute('aria-busy');}
 }
 $('btn').addEventListener('click',verificar);$('recargar').addEventListener('click',cargar);cargar();
})();
