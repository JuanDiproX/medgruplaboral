// Botón fijo de presupuesto en celular: desde el índice de servicios hasta el cierre.
const mobileCta=document.querySelector('.mobile-cta');
const ctaStart=document.querySelector('#necesidades,.split');
const ctaEnd=document.querySelector('.closing,.site-footer');
if(mobileCta&&ctaStart&&ctaEnd){
  let shown=null;
  const update=()=>{
    const vh=window.innerHeight;
    const show=ctaStart.getBoundingClientRect().top<vh*0.75&&ctaEnd.getBoundingClientRect().top>vh;
    if(show===shown)return;
    shown=show;
    document.body.classList.toggle('cta-visible',show);
    mobileCta.inert=!show;
  };
  window.addEventListener('scroll',update,{passive:true});
  window.addEventListener('resize',update);
  update();
}
const quoteForm=document.querySelector('#quote-form');
if(quoteForm){
  // Las páginas de servicio enlazan con ?servicio=<opción> para dejarla elegida.
  const requested=new URLSearchParams(location.search).get('servicio');
  const serviceSelect=quoteForm.querySelector('select[name="servicio"]');
  if(requested&&serviceSelect){
    const match=[...serviceSelect.options].find((option)=>option.text===requested);
    if(match)serviceSelect.value=match.value;
  }
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
