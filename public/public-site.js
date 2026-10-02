const toggle=document.querySelector('.motion-toggle');
if(toggle){
  const windowEl=document.querySelector('.logo-window');
  toggle.addEventListener('click',()=>{
    const paused=toggle.getAttribute('aria-pressed')!=='true';
    toggle.setAttribute('aria-pressed',String(paused));
    windowEl.classList.toggle('is-paused',paused);
    toggle.textContent=paused?'Reanudar movimiento':'Pausar movimiento';
  });
}
const quoteForm=document.querySelector('#quote-form');
if(quoteForm){
  quoteForm.querySelectorAll('input,select,textarea').forEach((field)=>{
    field.addEventListener('input',()=>field.setCustomValidity(''));
    field.addEventListener('change',()=>field.setCustomValidity(''));
    field.addEventListener('invalid',()=>{
      if(field.validity.valueMissing){
        field.setCustomValidity(field.tagName==='SELECT'?'Seleccioná el servicio que necesitás.':'Completá este campo para preparar tu solicitud.');
      }else if(field.validity.typeMismatch&&field.type==='email'){
        field.setCustomValidity('Ingresá un correo electrónico válido, por ejemplo: nombre@empresa.com.');
      }
    });
  });
  quoteForm.addEventListener('submit',async(event)=>{
    event.preventDefault();
    if(!quoteForm.reportValidity())return;
    const data=Object.fromEntries(new FormData(quoteForm));
    const status=document.querySelector('#quote-status');
    const button=quoteForm.querySelector('[type="submit"]');
    button.disabled=true;quoteForm.setAttribute('aria-busy','true');status.textContent='Enviando tu solicitud…';
    try{
      const response=await fetch('/api/contacto',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
      const result=await response.json();
      status.textContent=result.message;
      if(response.ok)quoteForm.reset();
    }catch{status.textContent='No pudimos confirmar el envío. Conservamos tus datos; escribinos a administracion@medgrup.com.ar si el problema continúa.';}
    finally{button.disabled=false;quoteForm.removeAttribute('aria-busy');}
  });
}
