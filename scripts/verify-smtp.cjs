// Reads only SMTP fields from stdin. Verifies connection/authentication, sends no email.
const fs=require('node:fs');
(async()=>{
  const v=JSON.parse(fs.readFileSync(0,'utf8')),port=Number(v.SMTP_PORT)||587;
  if(!v.SMTP_PASSWORD)throw Error('SMTP_NOT_CONFIGURED');
  const transport=require('nodemailer').createTransport({host:v.SMTP_HOST||'smtp.dreamhost.com',port,secure:port===465,requireTLS:port!==465,
    auth:{user:v.SMTP_USER||'administracion@medgrup.com.ar',pass:v.SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:20000});
  await transport.verify();transport.close();console.log('SMTP: conexión y autenticación verificadas. No se envió ningún correo.');
})().catch(e=>{console.error('SMTP: no se pudo verificar ('+(e.code||'CONFIG_ERROR')+').');process.exitCode=1;});
