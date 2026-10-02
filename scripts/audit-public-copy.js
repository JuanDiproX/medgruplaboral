const fs=require('fs');
const replacements=[
 ['Coordinamos la atención de tus trabajadores y reunimos el seguimiento y los informes en el portal de tu empresa.','Coordinamos la atención médica de tu equipo. En el portal de tu empresa, podés consultar el seguimiento de cada caso y los informes disponibles.'],
 ['Un encuentro con el profesional para evaluar la situación del trabajador y acompañar su evolución, sin perder de vista el contexto laboral.','Consultas con un profesional para evaluar la salud del trabajador y acompañar su evolución, teniendo en cuenta su actividad laboral.'],
 ['Coordinación de encuentros con profesionales para evaluar el caso, reunir criterios y documentar las conclusiones.','Encuentros entre profesionales para evaluar cada caso, compartir criterios y documentar las conclusiones.'],
 ['Casos, certificados y controles organizados para que tu empresa pueda consultar el seguimiento desde su portal.','Organizamos los casos, los certificados y los controles para que tu empresa pueda consultar el seguimiento en el portal.'],
 ['Informes, dictámenes y actas asociados a cada atención para consultar la documentación con mayor claridad.','Informes, dictámenes y actas vinculados a cada atención, organizados para facilitar su consulta.'],
 ['Atención médica y gestión en un mismo servicio, con el alcance que necesita tu empresa.','Integramos la atención médica y su gestión en una propuesta adaptada a las necesidades de tu empresa.'],
 ['La atención médica y su gestión están conectadas. Desde la plataforma podés consultar los turnos, seguir los casos y acceder a los documentos disponibles.','Desde el portal de tu empresa, podés consultar los turnos, seguir la evolución de los casos y acceder a la documentación disponible.'],
 ['Fechas programadas y enlaces para las atenciones por videollamada.','Consultá las fechas de atención y los enlaces de acceso a las videollamadas.'],
 ['Información del trabajador, certificados y evolución del caso.','Consultá la información del trabajador, sus certificados y la evolución del caso.'],
 ['Documentación asociada a cada atención, disponible según su estado.','Accedé a los informes y las actas de cada atención, según su estado de elaboración y firma.'],
 ['Contanos qué necesitás y solicitanos un presupuesto.','Contanos qué necesita tu empresa y solicitá un presupuesto.'],
 ['Medicina del trabajo, evaluación especializada y una plataforma para coordinar la atención y consultar su seguimiento.','Medicina del trabajo, evaluaciones especializadas y un portal para coordinar la atención y seguir cada caso.'],
 ['Definimos con tu empresa el alcance de los servicios según las tareas, los casos y las necesidades de tu equipo.','Acordamos con tu empresa el alcance de los servicios, según las tareas de los trabajadores y las necesidades de atención.'],
 ['Evaluación médica previa al ingreso, con estudios definidos según el puesto y su exposición.','Evaluación médica previa al ingreso, con estudios definidos según las tareas del puesto y los riesgos a los que estará expuesto el trabajador.'],
 ['Coordinación de profesionales, evaluación del caso y documentación de las conclusiones.','Coordinación de encuentros entre profesionales para evaluar el caso y documentar las conclusiones.'],
 ['La evaluación médica se integra con la coordinación y la documentación de cada atención.','Coordinamos cada atención y organizamos su documentación para facilitar el seguimiento del caso.'],
 ['Encuentros con el profesional, evaluación del trabajador y seguimiento de su evolución.','Consultas con un profesional para evaluar al trabajador y acompañar su evolución.'],
 ['Documentación asociada a las atenciones y conclusiones profesionales, disponible según su estado.','Documentos que registran las atenciones y las conclusiones profesionales, disponibles según su estado de elaboración y firma.'],
 ['Un portal que reúne la gestión de la atención y facilita la consulta de los casos.','Un portal para consultar los turnos, seguir los casos y acceder a la documentación de las atenciones.'],
 ['Consultar las fechas programadas y los enlaces de atención por videollamada.','Consultá las fechas programadas y los enlaces de acceso a las videollamadas.'],
 ['Consultar la información del trabajador, sus certificados y la evolución del caso.','Consultá la información del trabajador, sus certificados y la evolución del caso.'],
 ['Acceder a los informes y actas disponibles, vinculados con cada encuentro médico.','Accedé a los informes y las actas disponibles de cada atención médica.'],
 ['Contanos qué servicios necesitás y cómo está compuesto tu equipo.','Contanos qué servicios necesitás, a qué se dedica tu empresa y cuántos trabajadores integran tu equipo.'],
 ['Contanos qué necesitás. Con esa información podemos conversar sobre el alcance del servicio y preparar una propuesta.','Contanos qué necesita tu empresa. A partir de esa información, podemos definir el alcance de los servicios y preparar una propuesta.'],
 ['Solicitá presupuesto y propuesta','Solicitá un presupuesto y una propuesta'],
 ['Completá los datos y prepararemos un correo con tu solicitud.','Completá el formulario para preparar tu solicitud por correo. Todos los campos son obligatorios, excepto el teléfono.'],
 ['Contanos sobre tu empresa','Contanos qué necesita tu empresa'],
 ['Cantidad de trabajadores, actividad y servicios que te interesa coordinar.','Por ejemplo: actividad de la empresa, cantidad de trabajadores y servicios que necesitás.'],
 ['Incluí información general de la empresa. Los datos médicos de los trabajadores se gestionan en el portal.','Incluí solo información general de la empresa. La documentación médica de los trabajadores se gestiona en el portal.'],
 ['Se abrirá tu aplicación de correo. Revisá la solicitud y enviala desde allí.','Este formulario no envía la solicitud automáticamente. Se abrirá tu aplicación de correo para que puedas revisarla y enviarla.'],
 ['Evaluación, seguimiento y documentación. Conocé qué incluye cada servicio y cómo podemos coordinarlo con tu empresa.','Conocé nuestros servicios de evaluación médica, seguimiento y documentación, y cómo coordinarlos con tu empresa.'],
 ['Contanos la necesidad de tu empresa y te orientamos sobre el servicio y la coordinación de la atención.','Contanos qué necesita tu empresa. Te orientamos sobre los servicios disponibles y cómo coordinar la atención.'],
 ['Entrar al portal','Acceder al portal'],
 ['Explorar servicio','Conocer el servicio'],
 ['Consultar este servicio','Consultar por este servicio'],
 ['Centralizamos la información del caso y la documentación presentada. Coordinamos el control correspondiente y mantenemos el seguimiento vinculado al trabajador.','Reunimos la información del caso y la documentación presentada. Coordinamos el control correspondiente y registramos el seguimiento del trabajador.'],
 ['La disponibilidad y modalidad de los controles se coordinan con el equipo según la ubicación y las características del caso.','La disponibilidad y la modalidad de los controles se acuerdan con el equipo, según la ubicación y las características del caso.'],
 ['Se coordina el control y la evaluación correspondiente.','Se coordinan el control y la evaluación correspondientes.'],
 ['El seguimiento y los documentos se consultan en el portal.','La empresa consulta el seguimiento del caso y los documentos disponibles en el portal.'],
 ['Desde el portal de empresas podés acceder a los casos y a la documentación disponible, según los permisos de tu cuenta.','Desde el portal de tu empresa, podés consultar los casos y acceder a la documentación disponible, según los permisos de tu cuenta.'],
 ['Coordiná el servicio con nuestro equipo. Para consultas comerciales, no envíes documentación clínica por correo; te indicaremos el canal correspondiente.','Consultanos para coordinar el servicio. En las consultas comerciales, incluí solo información general; el equipo te indicará cómo presentar la documentación médica.'],
 ['La atención termina. La información queda.','La documentación de cada atención, organizada.'],
 ['Cada archivo se vincula con su caso o turno para facilitar su consulta posterior.','Cada archivo se vincula con el caso o el turno correspondiente para facilitar su consulta posterior.'],
 ['Los documentos disponibles dependen del servicio realizado y del estado del proceso de elaboración y firma.','La disponibilidad de los documentos depende del servicio realizado y de su estado de elaboración y firma.'],
 ['Se documentan las conclusiones de la atención.','Se elaboran los documentos con las conclusiones de la atención.'],
 ['Se completan las firmas correspondientes.','Los profesionales completan las firmas correspondientes.'],
 ['Organizamos la participación de los profesionales y el encuentro por videollamada. La plataforma permite vincular el dictamen y las firmas al proceso de atención.','Coordinamos la participación de los profesionales y el encuentro por videollamada. El dictamen y las firmas quedan vinculados al proceso de atención en la plataforma.'],
 ['El alcance de la junta, sus participantes y la documentación requerida se acuerdan previamente según la necesidad de evaluación.','El alcance de la junta, sus participantes y la documentación necesaria se acuerdan antes del encuentro, según las necesidades de evaluación.'],
 ['Reunimos los antecedentes y coordinamos participantes.','Reunimos los antecedentes y coordinamos la participación de los profesionales.'],
 ['Se realiza el encuentro y la evaluación del caso.','Los profesionales se reúnen y evalúan el caso.'],
 ['Se registra el dictamen y se gestionan las firmas.','Se registran las conclusiones en el dictamen y se gestionan las firmas.'],
 ['El equipo coordina el turno y los enlaces de acceso con los participantes definidos para el caso. Consultanos para organizar la evaluación.','El equipo acuerda el turno con los participantes y les facilita los enlaces de acceso. Consultanos para coordinar la evaluación.'],
 ['Coordinamos la consulta y reunimos la documentación necesaria para que el profesional pueda evaluar el caso. La atención a distancia permite conectar a los participantes y registrar sus conclusiones.','Coordinamos la consulta y reunimos la documentación necesaria para evaluar el caso. Durante la videollamada, el profesional realiza la evaluación y registra sus conclusiones.'],
 ['El motivo de la evaluación, los datos necesarios para coordinar el turno y la documentación relevante del caso. Nuestro equipo te orienta sobre cómo reunirlos.','Necesitamos conocer el motivo de la evaluación y contar con los datos para coordinar el turno. El equipo te indicará qué documentación presentar y cómo hacerlo.'],
 ['Así lo coordinamos.','Cómo coordinamos el servicio'],
 ['También podemos acompañarte en','Conocé otros servicios'],
 ['Una pregunta frecuente','Preguntas frecuentes']
];
const files=['public/medicina-laboral.html','public/propuesta.html','public/contacto.html','public/servicios.html',...fs.readdirSync('public/servicios').filter(f=>f.endsWith('.html')).map(f=>'public/servicios/'+f)];
for(const file of files){let h=fs.readFileSync(file,'utf8');for(const [before,after] of replacements)h=h.replaceAll(before,after);
 if(file.endsWith('servicios/informes.html'))h=h.replace('Cómo coordinamos el servicio','Cómo se prepara la documentación').replace('<h3>La solicitud</h3>','<h3>Elaboración</h3>').replace('<h3>La atención</h3>','<h3>Firma</h3>').replace('<h3>El seguimiento</h3>','<h3>Consulta</h3>');
 if(file.endsWith('propuesta.html'))h=h.replace('<title>Nuestra propuesta de valor — MEDGRUP</title>','<title>Nuestra propuesta de valor — MEDGRUP</title><meta name="description" content="Medicina laboral para empresas: aptos médicos, exámenes preocupacionales y periódicos, auditorías psiquiátricas y seguimiento desde un portal.">');
 if(file.endsWith('contacto.html'))h=h.replace('<title>Contacto y presupuestos — MEDGRUP</title>','<title>Contacto y presupuestos — MEDGRUP</title><meta name="description" content="Contactá a MEDGRUP para solicitar un presupuesto y una propuesta de medicina laboral para tu empresa.">');
 fs.writeFileSync(file,h);
}
// Keep shared service text in the generator consistent with published pages.
const generator='scripts/build-public-services.js';let g=fs.readFileSync(generator,'utf8');for(const [a,b]of replacements)g=g.replaceAll(a,b);fs.writeFileSync(generator,g);
console.log('Reviewed copy on '+files.length+' public pages.');
