const attempts=new Map();
const services=new Set(['Propuesta integral de medicina laboral','Aptos médicos','Exámenes preocupacionales','Exámenes periódicos','Auditorías psiquiátricas','Juntas médicas','Control de ausentismo','Evaluaciones y teleconsultas','Informes y documentación']);
const reply=(res,status,message)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({message}));};
module.exports=async function contact(req,res){
  const origin=req.headers.origin;
  const allowed=new Set(['https://laboral.medgrup.com.ar','https://medgrup-web-publica-production.up.railway.app']);
  if(process.env.NODE_ENV!=='production')allowed.add('http://127.0.0.1:4181');
  if(!allowed.has(origin))return reply(res,403,'La solicitud debe enviarse desde nuestro sitio.');
  if(!req.headers['content-type']?.startsWith('application/json'))return reply(res,415,'Formato de solicitud no válido.');
  const now=Date.now();
  for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
  const counter=attempts.get(ip)||{count:0,until:now+900000};
  if(counter.count>=5)return reply(res,429,'Ya recibimos varias solicitudes. Esperá unos minutos antes de volver a enviar.');
  attempts.set(ip,{...counter,count:counter.count+1});
  let body='';
  try{
    for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16000)return reply(res,413,'La solicitud es demasiado extensa.');}
    const data=JSON.parse(body);
    if(data.website)return reply(res,200,'Solicitud recibida.');
    for(const [key,max,required] of [['empresa',120,true],['nombre',120,true],['email',160,true],['telefono',40,false],['servicio',100,true],['mensaje',2500,true]]){
      if(typeof data[key]!=='string'||data[key].trim().length>max||(required&&!data[key].trim()))return reply(res,400,'Revisá los campos obligatorios y su extensión.');
      data[key]=data[key].trim();
    }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)||/[\r\n]/.test(data.email)||!services.has(data.servicio))return reply(res,400,'Revisá el correo electrónico y el servicio elegido.');
    if(!process.env.SMTP_PASSWORD)return reply(res,503,'El envío está temporalmente disponible solo por correo. Escribinos a administracion@medgrup.com.ar.');
    const transport=require('nodemailer').createTransport({host:process.env.SMTP_HOST||'smtp.dreamhost.com',port:Number(process.env.SMTP_PORT)||587,secure:false,requireTLS:true,auth:{user:'administracion@medgrup.com.ar',pass:process.env.SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:20000});
    await transport.sendMail({from:'MEDGRUP Web <administracion@medgrup.com.ar>',to:'administracion@medgrup.com.ar',replyTo:data.email,subject:'Solicitud de presupuesto — '+data.empresa.replace(/[\r\n]/g,' '),text:[`Empresa: ${data.empresa}`,`Contacto: ${data.nombre}`,`Correo: ${data.email}`,`Teléfono: ${data.telefono||'No indicado'}`,`Servicio: ${data.servicio}`,'',data.mensaje].join('\n')});
    return reply(res,200,'Recibimos tu solicitud. Nuestro equipo se pondrá en contacto con vos.');
  }catch(error){
    console.error('contact_send_failed',error.code||'INVALID_REQUEST');
    return reply(res,error instanceof SyntaxError?400:502,'No pudimos enviar la solicitud. Tus datos siguen en el formulario; intentá de nuevo o escribinos a administracion@medgrup.com.ar.');
  }
};
