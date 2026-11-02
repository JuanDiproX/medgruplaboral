const {escapeHtml:esc}=require('./control-evidence');

function reminderEmail({baseUrl,recipient,patient,type,doctors,date,time}){
  const base=new URL(baseUrl);
  if(!['https:','http:'].includes(base.protocol))throw Error('URL de MEDGRUP inválida');
  const agenda=esc(new URL('/',base).href);
  const logo=esc(new URL('/logo.png',base).href);
  const fecha=esc(String(date).split('-').reverse().join('/'));
  const hora=esc(String(time).slice(0,5));
  const detail=(label,value,last=false)=>`<tr><td style="padding:16px 0;${last?'':'border-bottom:1px solid #e4e3da;'}"><p style="margin:0 0 5px;color:#536174;font-size:12px;line-height:18px;">${label}</p><p style="margin:0;color:#13233a;font-size:16px;line-height:24px;font-weight:600;overflow-wrap:anywhere;">${esc(value)}</p></td></tr>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recordatorio de turno — MEDGRUP</title>
<style>@media only screen and (max-width:480px){.mail-shell{padding:16px 8px!important}.mail-pad{padding-left:24px!important;padding-right:24px!important}.mail-title{font-size:29px!important}.mail-button{display:block!important;text-align:center!important}.mail-time{font-size:30px!important}}</style></head>
<body style="margin:0;padding:0;background-color:#f3f2ec;color:#13233a;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">Tu próximo turno: ${fecha}, ${hora} hs. Consultá los detalles en tu agenda MEDGRUP.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f2ec;"><tr><td class="mail-shell" align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="620" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background-color:#ffffff;border:1px solid #e4e3da;border-radius:8px;">
<tr><td class="mail-pad" style="padding:30px 40px 24px;border-bottom:1px solid #e4e3da;"><a href="${agenda}" style="text-decoration:none;"><img src="${logo}" width="180" height="57" alt="MEDGRUP · Servicio Médico" style="display:block;width:180px;max-width:100%;height:auto;border:0;"></a></td></tr>
<tr><td class="mail-pad" style="padding:32px 40px 0;"><h1 class="mail-title" style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:34px;line-height:1.15;color:#13233a;">Tu próximo turno,<br>todo a mano.</h1><p style="margin:0 0 8px;font-size:15px;line-height:24px;">Hola ${esc(recipient)}.</p><p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#536174;">Te recordamos la consulta programada en MEDGRUP. Estos son los datos para organizar tu atención.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#eaf2f7;border-radius:6px;"><tr><td style="padding:20px 22px;vertical-align:middle;"><p style="margin:0 0 5px;font-size:12px;line-height:18px;color:#395877;">Fecha del turno</p><p style="margin:0;font-size:18px;line-height:26px;font-weight:600;color:#13233a;">${fecha}</p></td><td align="right" style="padding:20px 22px 20px 0;vertical-align:middle;white-space:nowrap;"><p class="mail-time" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:40px;color:#13233a;">${hora}</p><p style="margin:3px 0 0;font-size:12px;line-height:18px;color:#395877;">hora argentina</p></td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${detail('Paciente',patient)}${detail('Tipo de consulta',type||'Consulta médica')}${detail('Profesionales',doctors||'Sin médico asignado',true)}</table>
</td></tr>
<tr><td class="mail-pad" style="padding:12px 40px 32px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td align="center" bgcolor="#13233a" style="background-color:#13233a;border-radius:5px;mso-padding-alt:16px 24px;"><a class="mail-button" href="${agenda}" style="display:block;padding:16px 24px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;line-height:20px;text-decoration:none;border-radius:5px;">Abrir mi agenda</a></td></tr></table><p style="margin:14px 0 0;font-size:13px;line-height:21px;color:#536174;">Ingresá con tu cuenta y seleccioná el turno para ver sus detalles.</p></td></tr>
<tr><td class="mail-pad" style="padding:22px 40px;background-color:#fbfaf6;border-top:1px solid #e4e3da;border-radius:0 0 8px 8px;"><p style="margin:0 0 5px;font-size:13px;line-height:20px;font-weight:600;color:#13233a;">MEDGRUP · Medicina Laboral</p><p style="margin:0;font-size:12px;line-height:19px;color:#536174;">Recordatorio automático de tu agenda.<br>Si el botón no funciona, <a href="${agenda}" style="color:#2c5d92;text-decoration:underline;">ingresá a la plataforma</a>.</p></td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
module.exports={reminderEmail};
