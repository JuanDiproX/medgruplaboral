(() => {
 'use strict';
 const token=location.pathname.split('/').filter(Boolean).pop(),$=id=>document.getElementById(id);
 let excepcionGeo=false,verificando=false,listo=false,geoError=null,radio=300;
 const ua=navigator.userAgent||'',esIphone=/iPhone|iPad|iPod/i.test(ua),esAndroid=/Android/i.test(ua);
 // Instagram, Facebook y otras apps abren los enlaces en un navegador propio que suele negar la ubicación.
 const navegadorEmbebido=/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|; wv\)/i.test(ua);
 function aviso(tipo,texto){$('aviso').replaceChildren();if(texto){const p=document.createElement('p');p.className='aviso aviso-'+tipo;p.textContent=texto;$('aviso').append(p);}}
 function dato(label,value,wide=false){const group=document.createElement('div');group.className='dato'+(wide?' ancho':'');const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;group.append(dt,dd);$('datos').append(group);}
 function dial(estado,distancia){
  const el=$('dial');if(!el)return;el.dataset.estado=estado;
  // El punto muestra qué tan lejos quedó la lectura respecto del radio permitido; no indica dirección.
  const k=estado==='fuera'?Math.min(1.5,Math.max(1.22,(distancia||radio*1.3)/radio)):.42;
  $('dial-punto').setAttribute('transform',`translate(${60+34*k*.72} ${60-34*k*.7})`);
 }
 function turno(fecha,hora){
  if(!fecha&&!hora)return;
  const dia=String(fecha||'').split('T')[0];
  $('turno-hora').textContent=hora||'';
  if(dia){
   const d=new Date(dia+'T12:00:00');
   const hoy=new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'});
   const texto=d.toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'});
   $('turno-fecha').textContent=(dia===hoy?'Hoy, ':'')+texto;
   if(dia===hoy&&/^\d{1,2}:\d{2}/.test(hora||'')){
    const ahora=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Argentina/Buenos_Aires'}));
    const [h,m]=hora.split(':').map(Number),min=h*60+m-(ahora.getHours()*60+ahora.getMinutes());
    const falta=$('turno-falta');
    if(min>0&&min<=180){falta.textContent=min>=60?`Falta ${Math.floor(min/60)} h ${min%60} min`:`Faltan ${min} min`;falta.hidden=false;}
    else if(min<=0&&min>-45){falta.textContent='Es ahora';falta.classList.add('ahora');falta.hidden=false;}
   }
  }
  $('turno').hidden=false;
 }
 async function cargar(){
  listo=false;$('btn').hidden=true;$('link-llamada').hidden=true;$('recargar').hidden=true;$('preparacion').hidden=true;$('ayuda').hidden=true;$('navegador').hidden=true;
  $('cargando').hidden=false;$('cargando-txt').textContent='Consultando la entrevista…';aviso('','');
  try{
   const r=await fetch('/api/ingreso/'+encodeURIComponent(token),{cache:'no-store'}),d=await r.json();
   if(!d.ok){$('titulo').textContent='No encontramos tu entrevista';$('subtitulo').textContent='Revisá el enlace que te enviaron o consultá a quien coordinó la entrevista.';aviso('error',d.error||'Este enlace no es válido.');return;}
   $('titulo').textContent=d.control||'Tu entrevista médica';$('saludo').textContent='Hola '+d.trabajador+'.';$('saludo').hidden=false;$('datos').replaceChildren();
   if(Number(d.radio)>0)radio=Number(d.radio);
   turno(d.fecha,d.hora);
   if(d.domicilio)dato('Domicilio informado',d.domicilio,true);$('datos').hidden=!$('datos').children.length;
   if(d.cerrado){$('subtitulo').textContent='Este control ya finalizó.';aviso('alerta','Esta entrevista ya está cerrada.');$('pie').textContent='Si necesitás una nueva entrevista, contactá a quien coordinó el control.';return;}
   excepcionGeo=d.excepcion_geo===true;
   if(excepcionGeo){
    $('subtitulo').textContent='Revisá los datos y continuá a tu entrevista.';$('paso-validar-texto').textContent='Confirmar acceso';$('btn').textContent='Continuar a la entrevista';
    aviso('info','MEDGRUP autorizó el ingreso sin validación geográfica para esta entrevista.');$('pie').textContent='El domicilio mostrado es el informado, sin verificación geográfica.';
   }else if(!d.tiene_domicilio){$('subtitulo').textContent='Falta confirmar el domicilio de este control.';aviso('alerta','Tu domicilio todavía no está verificado en el sistema. Avisale a tu empresa antes de la entrevista.');return;}
   else{
    $('subtitulo').textContent='Antes de entrar, vamos a confirmar que estás en tu domicilio.';
    $('preparacion-texto').replaceChildren('Tenés que estar a menos de '+radio+' m del domicilio informado. Cuando el teléfono pregunte por la ubicación, tocá ',Object.assign(document.createElement('strong'),{textContent:'Permitir'}),'.');
    $('ayuda-sistema').textContent=esIphone?'En iPhone: Ajustes › Privacidad y seguridad › Localización, activala y elegí “Al usar la app” para Safari.':esAndroid?'En Android: deslizá la barra superior y activá Ubicación. Después, en Chrome, tocá el candado junto a la dirección y permití la ubicación.':'';
    $('ayuda-sistema').hidden=!$('ayuda-sistema').textContent;
    dial('esperando');$('preparacion').hidden=false;$('ayuda').hidden=false;$('navegador').hidden=!navegadorEmbebido;$('btn').textContent='Validar mi ubicación';
   }
   listo=true;$('btn').hidden=false;$('btn').disabled=false;
  }catch{$('subtitulo').textContent='No pudimos consultar los datos de tu entrevista.';aviso('error','Revisá tu conexión a internet y volvé a cargar la entrevista.');$('recargar').hidden=false;}
  finally{$('cargando').hidden=true;}
 }
 // La primera lectura del teléfono suele ser aproximada (antenas o wifi). Si llega con mucho
 // margen de error se espera unos segundos a que el GPS afine, en vez de rechazar al paciente.
 function afinar(primera){
  return new Promise(resolve=>{
   if(!navigator.geolocation.watchPosition)return resolve(primera);
   let mejor=primera,id=null;const fin=()=>{if(id!==null)navigator.geolocation.clearWatch(id);resolve(mejor);};
   const limite=setTimeout(fin,9000);
   id=navigator.geolocation.watchPosition(p=>{
    if(p.coords.accuracy<mejor.precision)mejor={lat:p.coords.latitude,lng:p.coords.longitude,precision:p.coords.accuracy};
    if(mejor.precision<=60){clearTimeout(limite);fin();}
   },()=>{clearTimeout(limite);fin();},{enableHighAccuracy:true,maximumAge:0,timeout:9000});
  });
 }
 function ubicacionActual(){
  geoError=null;return new Promise(resolve=>{
   if(!navigator.geolocation){geoError='no_disponible';return resolve(null);}
   navigator.geolocation.getCurrentPosition(async p=>{
    const lectura={lat:p.coords.latitude,lng:p.coords.longitude,precision:p.coords.accuracy};
    if(lectura.precision>120){$('cargando-txt').textContent='Mejorando la señal de ubicación…';resolve(await afinar(lectura));}
    else resolve(lectura);
   },e=>{geoError=e.code===1?'permiso':e.code===3?'tiempo':'senal';resolve(null);},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
  });
 }
 async function verificar(){
  if(verificando||!listo)return;
  verificando=true;$('btn').disabled=true;$('btn').hidden=true;$('cargando').hidden=false;
  if(!excepcionGeo)dial('buscando');
  $('cargando-txt').textContent=excepcionGeo?'Confirmando el acceso…':'Buscando tu ubicación…';$('acciones-ingreso').setAttribute('aria-busy','true');aviso('','');
  try{
   const pos=excepcionGeo?null:await ubicacionActual();$('cargando-txt').textContent='Validando el ingreso…';
   const r=await fetch('/api/ingreso/'+encodeURIComponent(token)+'/verificar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pos||{})}),d=await r.json();
   if(d.ok){
    listo=false;dial('dentro');$('titulo').textContent='Ingresando a tu entrevista';$('subtitulo').textContent='Estamos abriendo la videollamada. Permití el uso de la cámara y el micrófono si el navegador te lo pide.';
    aviso('ok',d.excepcion_geo?'Tu ingreso está autorizado, sin validación geográfica.':'Ubicación validada. Te estamos conectando con el equipo médico.');
    $('paso-validar').removeAttribute('aria-current');$('paso-validar').classList.add('listo');$('paso-ingresar').setAttribute('aria-current','step');
    $('link-llamada').href=d.link;$('link-llamada').hidden=false;$('ayuda').hidden=true;$('navegador').hidden=true;
    $('pie').textContent=d.excepcion_geo?'El acceso se abrirá automáticamente.':'Permanecé en el domicilio informado durante la entrevista.';
    location.replace(d.link);return;
   }
   let mensaje=d.error||'No pudimos verificar tu ubicación.';
   if(d.code==='SIN_UBICACION'&&geoError==='permiso')mensaje='El navegador no tiene permiso para acceder a tu ubicación. Habilitalo en los permisos del sitio y volvé a intentar.';
   else if(d.code==='SIN_UBICACION'&&geoError==='tiempo')mensaje='La ubicación está tardando más de lo esperado. Comprobá que esté activada, acercate a una ventana y volvé a intentar.';
   if(d.code==='DEMASIADOS_INTENTOS')mensaje='Hiciste muchos intentos seguidos. Esperá unos minutos y volvé a probar.';
   dial(d.code==='FUERA_DE_RANGO'?'fuera':'esperando',d.distancia);
   aviso(d.code==='FUERA_DE_RANGO'||d.code==='PRECISION_BAJA'?'alerta':'error',mensaje);
   // En el celular el mensaje puede quedar tapado por la barra de acciones: se lo trae a la vista.
   setTimeout(()=>{try{$('preparacion').hidden?$('aviso').scrollIntoView({block:'center',behavior:'smooth'}):$('preparacion').scrollIntoView({block:'start',behavior:'smooth'});}catch{}},60);
   if(['CASO_CERRADO','LINK_INVALIDO','SIN_ENTREVISTA','SIN_DOMICILIO'].includes(d.code)){listo=false;$('preparacion').hidden=true;$('pie').textContent='Contactá a quien coordinó la entrevista para revisar el acceso.';}
   else{$('btn').textContent='Volver a validar mi ubicación';$('btn').hidden=false;if(!excepcionGeo){$('ayuda').hidden=false;if(geoError)$('ayuda').open=true;}}
  }catch{dial('esperando');aviso('error','No pudimos conectarnos. Revisá tu internet y volvé a intentar.');$('btn').textContent='Volver a intentar';$('btn').hidden=false;}
  finally{verificando=false;$('cargando').hidden=true;$('btn').disabled=false;$('acciones-ingreso').removeAttribute('aria-busy');}
 }
 $('btn').addEventListener('click',verificar);$('recargar').addEventListener('click',cargar);cargar();
})();
