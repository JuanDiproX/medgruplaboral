// Genera las páginas secundarias del sitio público con el sistema de sitio.css
// y sincroniza el encabezado y el pie del inicio (medicina-laboral.html).
// Uso: node scripts/build-public-site.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public');
const EMAIL = 'administracion@medgrup.com.ar';

const sprite = `<svg width="0" height="0" class="sprite" aria-hidden="true" focusable="false">
    <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></symbol>
    <symbol id="i-external" viewBox="0 0 24 24"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
    <symbol id="i-file" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></symbol>
    <symbol id="i-video" viewBox="0 0 24 24"><path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></symbol>
    <symbol id="i-pen" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 2.9 2.9L7 18.8l-4 1 1-4z"/></symbol>
    <symbol id="i-mail" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-9 5.7a2 2 0 0 1-2 0L2 7"/></symbol>
  </svg>`;

const icon = (id, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

function header(current) {
  const link = (href, label, key) => `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="site-header">
    <div class="shell header-row">
      <a class="brand" href="/medicina-laboral.html" aria-label="MEDGRUP, inicio">
        <picture><source srcset="/logo.webp" type="image/webp"><img src="/logo.png" alt="MEDGRUP Servicio Médico" width="190" height="60"></picture>
      </a>
      <nav class="site-nav" aria-label="Navegación principal">
        ${link('/servicios.html', 'Servicios', 'servicios')}
        ${link('/propuesta.html', 'Propuesta', 'propuesta')}
        ${link('/contacto.html', 'Contacto', 'contacto')}
        <a class="nav-portal" href="/empresa.html">Portal<span class="hide-sm"> empresas</span> ${icon('external')}</a>
      </nav>
      <a class="btn btn-small" href="/contacto.html"><span class="hide-sm">Solicitar presupuesto</span><span class="show-sm">Presupuesto</span></a>
    </div>
  </header>`;
}

const footer = `<footer class="site-footer">
    <div class="shell footer-grid">
      <a class="brand" href="/medicina-laboral.html" aria-label="MEDGRUP, inicio">
        <picture><source srcset="/logo.webp" type="image/webp"><img src="/logo.png" alt="MEDGRUP Servicio Médico" width="190" height="60" loading="lazy"></picture>
      </a>
      <nav aria-label="Servicios">
        <h2>Servicios</h2>
        <a href="/servicios/aptos-examenes.html">Aptos y exámenes laborales</a>
        <a href="/servicios/teleconsultas.html">Evaluaciones y teleconsultas</a>
        <a href="/servicios/juntas-medicas.html">Juntas médicas</a>
        <a href="/servicios/ausentismo.html">Control de ausentismo</a>
        <a href="/servicios/informes.html">Informes y documentación</a>
      </nav>
      <nav aria-label="MEDGRUP">
        <h2>MEDGRUP</h2>
        <a href="/propuesta.html">Propuesta</a>
        <a href="/contacto.html">Contacto</a>
        <a href="mailto:${EMAIL}">${EMAIL}</a>
      </nav>
      <nav aria-label="Accesos">
        <h2>Accesos</h2>
        <a href="/empresa.html">Portal empresas ${icon('external')}</a>
        <a href="/index.html">Acceso profesionales ${icon('external')}</a>
      </nav>
    </div>
  </footer>
  <a class="btn mobile-cta" href="/contacto.html">Solicitar presupuesto</a>`;

function page({ title, description, current, body }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="theme-color" content="#fbfaf6">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Display&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/sitio.css">
</head>
<body>
  ${sprite}

  <a class="skip" href="#contenido">Ir al contenido</a>

  ${header(current)}

  <main id="contenido">
${body}
  </main>

  ${current === 'contacto' ? footer.replace(/\n  <a class="btn mobile-cta"[^\n]*<\/a>/, '') : footer}\n  <script src="/public-site.js" defer></script>
</body>
</html>
`;
}

const crumbs = (items) => `    <nav class="crumbs shell" aria-label="Ubicación">${items.map(([href, label]) => href ? `<a href="${href}">${label}</a>` : `<span aria-current="page">${label}</span>`).join('<span aria-hidden="true">/</span>')}</nav>`;

function closing(id, heading, text, extra = '') {
  return `    <section class="closing" aria-labelledby="${id}">
      <div class="shell closing-grid">
        <h2 id="${id}">${heading}</h2>
        <div class="closing-copy">
          <p>${text}</p>
          <ol class="next-steps">
            <li>Nos contás qué necesita tu empresa.</li>
            <li>Definimos juntos el alcance de los servicios.</li>
            <li>Te enviamos una propuesta con su presupuesto.</li>
          </ol>
          <div class="closing-actions">
            <a class="btn" href="/contacto.html">Solicitar presupuesto</a>
            ${extra || `<a class="text-link on-dark" href="mailto:${EMAIL}">${EMAIL}</a>`}
          </div>
        </div>
      </div>
    </section>`;
}

/* Muestras ilustrativas por servicio: lo que la empresa ve o recibe. */

const appFrame = (title, inner) => `<div class="app">
            <div class="app-bar"><span class="app-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="app-title">${title}</span></div>
            <div class="app-body">${inner}</div>
          </div>`;

const samples = {
  'aptos-examenes': {
    label: 'Certificado de aptitud laboral de ejemplo, con resultado apto, sello de MEDGRUP y firma del profesional.',
    html: `<div class="sheet sheet-front sheet-sample">
            <div class="sheet-head"><img src="/logo.webp" alt="" width="600" height="190"><span>Ejemplo</span></div>
            <p class="sheet-title">Certificado de aptitud laboral</p>
            <dl class="sheet-fields">
              <div><dt>Examen</dt><dd>Periódico</dd></div>
              <div><dt>Puesto</dt><dd>Chofer de reparto</dd></div>
              <div><dt>Empresa</dt><dd>Empresa de ejemplo S.A.</dd></div>
              <div><dt>Trabajador</dt><dd>Nombre de ejemplo</dd></div>
            </dl>
            <div class="sheet-result">
              <div><p class="sheet-label">Resultado</p><p class="sheet-verdict">Apto para el puesto</p></div>
              <svg class="stamp" viewBox="0 0 120 120" aria-hidden="true"><defs><path id="stamp-ring-s" d="M60 60m-43 0a43 43 0 1 1 86 0a43 43 0 1 1-86 0"/></defs><circle cx="60" cy="60" r="56"/><circle cx="60" cy="60" r="31"/><text class="stamp-ring"><textPath href="#stamp-ring-s" textLength="268">MEDGRUP · SERVICIO MÉDICO ·</textPath></text><text class="stamp-word" x="60" y="67" text-anchor="middle">APTO</text></svg>
            </div>
            <div class="sheet-sign"><svg viewBox="0 0 160 44" aria-hidden="true"><path d="M4 32c8-20 16-24 19-8s8 14 13-4 10-20 14 2 7 16 12-2 9-14 13 0c2 8 6 9 10 2s8-9 12-1 10 6 18-6c4-6 10-10 22-6"/></svg><p>Firma y sello del profesional</p></div>
          </div>`
  },
  teleconsultas: {
    label: 'Turno de teleconsulta de ejemplo, con profesional, modalidad, documentación previa y enlace de acceso.',
    html: appFrame('Portal de empresas · Turnos', `
              <div class="case-head"><div><p class="case-kind">Teleconsulta</p><p class="case-name">Jueves 18 de septiembre · 10:30</p></div><span class="status">Confirmado</span></div>
              <dl class="sample-fields">
                <div><dt>Profesional</dt><dd>Médico del trabajo</dd></div>
                <div><dt>Modalidad</dt><dd>Videollamada</dd></div>
                <div><dt>Documentación previa</dt><dd>2 archivos vinculados al turno</dd></div>
              </dl>
              <span class="sample-button">${icon('video')} Enlace de acceso</span>
              <ul class="docs">
                <li>${icon('file')}<span>Informe médico</span><span class="doc-state">Al finalizar</span></li>
                <li>${icon('file')}<span>Acta de asistencia</span><span class="doc-state">Al finalizar</span></li>
              </ul>`)
  },
  'juntas-medicas': {
    label: 'Dictamen de junta médica de ejemplo, con dos firmas completas y una pendiente.',
    html: `<div class="sheet sheet-front sheet-sample">
            <div class="sheet-head"><img src="/logo.webp" alt="" width="600" height="190"><span>Ejemplo</span></div>
            <p class="sheet-title">Dictamen de junta médica</p>
            <p class="sheet-label sheet-gap">Conclusiones</p>
            <span class="sheet-line"></span><span class="sheet-line"></span><span class="sheet-line short"></span>
            <ul class="signers">
              <li><span class="dot done-dot">${icon('check')}</span><span>Profesional 1</span><span class="doc-state">Firmado</span></li>
              <li><span class="dot done-dot">${icon('check')}</span><span>Profesional 2</span><span class="doc-state">Firmado</span></li>
              <li><span class="dot current-dot">${icon('pen')}</span><span>Profesional 3</span><span class="doc-state is-pending">Pendiente</span></li>
            </ul>
          </div>`
  },
  ausentismo: {
    label: 'Caso de control de ausentismo de ejemplo, con su línea de tiempo y documentos.',
    html: appFrame('Portal de empresas · Casos', `
              <div class="case-head"><div><p class="case-kind">Control de ausentismo</p><p class="case-name">Caso de ejemplo</p></div><span class="status">En seguimiento</span></div>
              <ol class="timeline">
                <li class="done"><span class="dot">${icon('check')}</span><span class="t-date">14 sep</span><span class="t-text">Certificado recibido</span></li>
                <li class="done"><span class="dot">${icon('check')}</span><span class="t-date">16 sep</span><span class="t-text">Control domiciliario coordinado</span></li>
                <li class="current"><span class="dot">${icon('pen')}</span><span class="t-date">17 sep</span><span class="t-text">Informe de control <em>en firma</em></span></li>
              </ol>
              <ul class="docs">
                <li>${icon('file')}<span>Certificado médico</span><span class="doc-state">Recibido</span></li>
                <li>${icon('file')}<span>Informe de control</span><span class="doc-state is-pending">En firma</span></li>
              </ul>`)
  },
  informes: {
    label: 'Lista de documentos de ejemplo con su estado: disponibles, en firma y en elaboración.',
    html: appFrame('Portal de empresas · Informes', `
              <div class="case-head"><div><p class="case-kind">Documentación del caso</p><p class="case-name">Caso de ejemplo</p></div></div>
              <ul class="docs docs-roomy">
                <li>${icon('file')}<span>Informe médico <small>PDF</small></span><span class="doc-state is-done">Disponible</span></li>
                <li>${icon('file')}<span>Acta de asistencia <small>PDF</small></span><span class="doc-state is-done">Disponible</span></li>
                <li>${icon('file')}<span>Dictamen de junta <small>PDF</small></span><span class="doc-state is-pending">En firma</span></li>
                <li>${icon('file')}<span>Informe de control</span><span class="doc-state">En elaboración</span></li>
              </ul>`)
  }
};

const services = [
  {
    slug: 'aptos-examenes', name: 'Aptos y exámenes laborales', option: 'Aptos médicos',
    task: 'Incorporar o controlar a un trabajador',
    headline: 'La aptitud de cada trabajador, evaluada y documentada.',
    intro: 'Aptos médicos y exámenes preocupacionales y periódicos, definidos según las tareas del puesto y los riesgos de cada actividad.',
    copy: 'Acordamos con tu empresa los estudios de cada examen según el puesto. El profesional evalúa al trabajador y el resultado queda documentado en la constancia de aptitud correspondiente.',
    items: ['Aptos médicos según las tareas del puesto', 'Exámenes preocupacionales previos al ingreso', 'Exámenes periódicos durante la actividad laboral'],
    stepsTitle: 'Cómo coordinamos el servicio',
    steps: [['La solicitud', 'La empresa informa el puesto, sus tareas y los trabajadores a evaluar.'], ['La evaluación', 'Se realizan el examen y los estudios definidos para el puesto.'], ['El resultado', 'El profesional emite la constancia de aptitud correspondiente.']],
    note: 'Los estudios de cada examen y la modalidad de atención se acuerdan con tu empresa, según las tareas del puesto y los riesgos de la actividad.',
    question: '¿Qué estudios incluye un examen preocupacional?',
    answer: 'Depende de las tareas del puesto y de los riesgos a los que estará expuesto el trabajador. Los definimos junto con tu empresa al armar la propuesta.',
    closing: 'Hablemos de los exámenes que necesita tu empresa.'
  },
  {
    slug: 'teleconsultas', name: 'Evaluaciones y teleconsultas', option: 'Evaluaciones y teleconsultas',
    task: 'Evaluar a un trabajador',
    headline: 'La atención médica, más cerca.',
    intro: 'Consultas con un profesional para evaluar la salud del trabajador y acompañar su evolución, teniendo en cuenta su actividad laboral.',
    copy: 'Coordinamos la consulta y reunimos la documentación necesaria para evaluar el caso. Durante la videollamada, el profesional realiza la evaluación y registra sus conclusiones.',
    items: ['Videoconsulta con el profesional', 'Documentación previa vinculada al turno', 'Informe médico y acta de asistencia'],
    stepsTitle: 'Cómo coordinamos el servicio',
    steps: [['La solicitud', 'Coordinamos el turno y el enlace de acceso.'], ['La atención', 'El profesional realiza la evaluación médica.'], ['El seguimiento', 'La documentación disponible queda asociada a la atención.']],
    note: 'La modalidad de atención y la necesidad de una evaluación presencial se definen según el caso y el criterio profesional.',
    question: '¿Qué necesito para coordinar una consulta?',
    answer: 'Necesitamos conocer el motivo de la evaluación y contar con los datos para coordinar el turno. El equipo te indicará qué documentación presentar y cómo hacerlo.',
    closing: 'Hablemos de la atención que necesitás.'
  },
  {
    slug: 'juntas-medicas', name: 'Juntas médicas', option: 'Juntas médicas',
    task: 'Coordinar una junta médica',
    headline: 'Una mirada compartida sobre cada caso.',
    intro: 'Encuentros entre profesionales para evaluar cada caso, compartir criterios y documentar las conclusiones.',
    copy: 'Coordinamos la participación de los profesionales y el encuentro por videollamada. El dictamen y las firmas quedan vinculados al proceso de atención en la plataforma.',
    items: ['Coordinación de los participantes', 'Encuentro por videollamada', 'Dictamen y firmas de profesionales'],
    stepsTitle: 'Cómo coordinamos el servicio',
    steps: [['La solicitud', 'Reunimos los antecedentes y coordinamos la participación de los profesionales.'], ['La atención', 'Los profesionales se reúnen y evalúan el caso.'], ['El seguimiento', 'Se registran las conclusiones en el dictamen y se gestionan las firmas.']],
    note: 'El alcance de la junta, sus participantes y la documentación necesaria se acuerdan antes del encuentro, según las necesidades de evaluación.',
    question: '¿Cómo se organiza la participación?',
    answer: 'El equipo acuerda el turno con los participantes y les facilita los enlaces de acceso. Consultanos para coordinar la evaluación.',
    closing: 'Hablemos de la atención que necesitás.'
  },
  {
    slug: 'ausentismo', name: 'Control de ausentismo', option: 'Control de ausentismo',
    task: 'Seguir una ausencia',
    headline: 'Cada ausencia, con un seguimiento claro.',
    intro: 'Organizamos los casos, los certificados y los controles para que tu empresa pueda consultar el seguimiento en el portal.',
    copy: 'Reunimos la información del caso y la documentación presentada. Coordinamos el control correspondiente y registramos el seguimiento del trabajador.',
    items: ['Registro y seguimiento de casos', 'Certificados y documentación asociada', 'Coordinación de controles domiciliarios'],
    stepsTitle: 'Cómo coordinamos el servicio',
    steps: [['La solicitud', 'La empresa informa el caso y sus antecedentes.'], ['La atención', 'Se coordinan el control y la evaluación correspondientes.'], ['El seguimiento', 'La empresa consulta el seguimiento del caso y los documentos disponibles en el portal.']],
    note: 'La disponibilidad y la modalidad de los controles se acuerdan con el equipo, según la ubicación y las características del caso.',
    question: '¿Dónde consulto el seguimiento?',
    answer: 'Desde el portal de tu empresa, podés consultar los casos y acceder a la documentación disponible, según los permisos de tu cuenta.',
    closing: 'Hablemos de la atención que necesitás.'
  },
  {
    slug: 'informes', name: 'Informes y documentación', option: 'Informes y documentación',
    task: 'Contar con la documentación',
    headline: 'La documentación de cada atención, organizada.',
    intro: 'Informes, dictámenes y actas vinculados a cada atención, organizados para facilitar su consulta.',
    copy: 'La plataforma reúne los documentos generados durante el proceso de atención. Cada archivo se vincula con el caso o el turno correspondiente para facilitar su consulta posterior.',
    items: ['Informes y dictámenes en PDF', 'Firmas de profesionales', 'Actas de asistencia e historial de atenciones'],
    stepsTitle: 'Cómo se prepara la documentación',
    steps: [['Elaboración', 'Se elaboran los documentos con las conclusiones de la atención.'], ['Firma', 'Los profesionales completan las firmas correspondientes.'], ['Consulta', 'Los archivos disponibles se consultan desde el portal.']],
    note: 'La disponibilidad de los documentos depende del servicio realizado y de su estado de elaboración y firma.',
    question: '¿Los informes se pueden descargar?',
    answer: 'La plataforma ofrece documentos en PDF. Su disponibilidad depende del estado de la atención y de los permisos de acceso de cada usuario.',
    closing: 'Hablemos de tu documentación.'
  }
];

const quoteHref = (option) => `/contacto.html?servicio=${encodeURIComponent(option)}`;

const offerings = [
  ['Aptos médicos', 'Evaluación de la aptitud médica en relación con las tareas y las necesidades del puesto.'],
  ['Exámenes preocupacionales', 'Evaluación médica previa al ingreso, con estudios definidos según las tareas del puesto y los riesgos a los que estará expuesto el trabajador.'],
  ['Exámenes periódicos', 'Controles de salud para acompañar al trabajador durante su actividad laboral.'],
  ['Auditorías psiquiátricas', 'Evaluación especializada de casos de salud mental en el contexto laboral.']
];

const write = (file, html) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
};

/* Catálogo */

write('servicios.html', page({
  title: 'Servicios de medicina laboral | MEDGRUP',
  description: 'Evaluaciones y teleconsultas, juntas médicas, control de ausentismo e informes para empresas de toda Argentina, con seguimiento en el portal de tu empresa.',
  current: 'servicios',
  body: `${crumbs([['/medicina-laboral.html', 'Inicio'], [null, 'Servicios']])}

    <section class="page-head shell" aria-labelledby="page-title">
      <h1 id="page-title">Servicios que acompañan a tu empresa.</h1>
      <p class="lead">Evaluación médica, seguimiento y documentación, coordinados por nuestro equipo y disponibles en el portal de tu empresa.</p>
    </section>

    <section class="split shell" aria-labelledby="catalog-title">
      <div class="split-head">
        <h2 id="catalog-title">Servicios con seguimiento en el portal</h2>
      </div>
      <ol class="service-rows split-body">
${services.map((s) => `        <li>
          <a class="service-row" href="/servicios/${s.slug}.html">
            <span class="service-row-name">${s.name}</span>
            <span class="service-row-copy">${s.intro}<span class="service-row-items">${s.items.join(' · ')}</span></span>
            ${icon('arrow', 'icon need-arrow')}
          </a>
        </li>`).join('\n')}
      </ol>
    </section>

    <section class="split shell" aria-labelledby="more-title">
      <div class="split-head">
        <h2 id="more-title">También acompañamos a tu empresa con</h2>
      </div>
      <div class="split-body">
        <dl class="offer-rows">
${offerings.filter(([n]) => n === 'Auditorías psiquiátricas').map(([n, d]) => `          <div><dt>${n}</dt><dd>${d}</dd></div>`).join('\n')}
        </dl>
        <a class="text-link" href="/propuesta.html">Ver la propuesta completa ${icon('arrow')}</a>
      </div>
    </section>

${closing('closing-title', '¿Por dónde empezar?', 'Contanos qué necesita tu empresa. Te orientamos sobre los servicios disponibles y cómo coordinar la atención.')}`
}));

/* Páginas de servicio */

for (const s of services) {
  const sample = samples[s.slug];
  const others = services.filter((x) => x !== s);
  write(`servicios/${s.slug}.html`, page({
    title: `${s.name} | MEDGRUP`,
    description: `${s.intro} Medicina laboral para empresas de toda Argentina.`,
    current: 'servicios',
    body: `${crumbs([['/medicina-laboral.html', 'Inicio'], ['/servicios.html', 'Servicios'], [null, s.name]])}

    <section class="service-head shell" aria-labelledby="page-title">
      <div class="service-head-main">
        <h1 id="page-title">${s.headline}</h1>
        <p class="lead">${s.intro}</p>
        <div class="hero-actions">
          <a class="btn" href="${quoteHref(s.option)}">Solicitar presupuesto</a>
          <a class="text-link" href="/empresa.html">Acceder al portal ${icon('external')}</a>
        </div>
      </div>
      <figure class="service-sample">
        <div class="sample-frame" role="img" aria-label="${sample.label}">
          ${sample.html}
        </div>
        <figcaption>Vista ilustrativa con datos de ejemplo.</figcaption>
      </figure>
    </section>

    <section class="split shell" aria-labelledby="includes-title">
      <div class="split-head">
        <h2 id="includes-title">Qué incluye</h2>
      </div>
      <div class="split-body">
        <p class="body-lead">${s.copy}</p>
        <ul class="check-list">
${s.items.map((x) => `          <li>${icon('check')}<span>${x}</span></li>`).join('\n')}
        </ul>
        <aside class="note">
          <h3>A tener en cuenta</h3>
          <p>${s.note}</p>
          <a class="text-link" href="/medicina-laboral.html#equipo">Conocer al equipo médico ${icon('arrow')}</a>
        </aside>
      </div>
    </section>

    <section class="split shell" aria-labelledby="steps-title">
      <div class="split-head">
        <h2 id="steps-title">${s.stepsTitle}</h2>
      </div>
      <ol class="steps split-body">
${s.steps.map(([t, d], i) => `        <li><span class="step-n" aria-hidden="true">${i + 1}</span><h3>${t}</h3><p>${d}</p></li>`).join('\n')}
      </ol>
    </section>

    <section class="split shell" aria-labelledby="faq-title">
      <div class="split-head">
        <h2 id="faq-title">Preguntas frecuentes</h2>
      </div>
      <div class="split-body faq">
        <details open>
          <summary>${s.question}</summary>
          <p>${s.answer}</p>
        </details>
      </div>
    </section>

    <section class="split shell" aria-labelledby="related-title">
      <div class="split-head">
        <h2 id="related-title">Otros servicios</h2>
      </div>
      <ul class="link-rows split-body">
${others.map((x) => `        <li><a href="/servicios/${x.slug}.html"><span>${x.name}</span><small>${x.task}</small>${icon('arrow', 'icon need-arrow')}</a></li>`).join('\n')}
      </ul>
    </section>

${closing('closing-title', s.closing, 'Consultanos para coordinar el servicio. En las consultas comerciales, incluí solo información general; el equipo te indicará cómo presentar la documentación médica.')}`
  }));
}

/* Propuesta */

write('propuesta.html', page({
  title: 'Medicina laboral para empresas: propuesta integral | MEDGRUP',
  description: 'Aptos médicos, exámenes preocupacionales y periódicos, auditorías psiquiátricas y seguimiento de casos para empresas de toda Argentina.',
  current: 'propuesta',
  body: `${crumbs([['/medicina-laboral.html', 'Inicio'], [null, 'Propuesta']])}

    <section class="page-head shell" aria-labelledby="page-title">
      <h1 id="page-title">La salud de tu equipo, con una gestión conectada.</h1>
      <p class="lead">Medicina del trabajo, evaluaciones especializadas y un portal para coordinar la atención y seguir cada caso.</p>
      <div class="hero-actions"><a class="btn" href="/contacto.html?servicio=${encodeURIComponent('Propuesta integral de medicina laboral')}">Solicitar una propuesta</a></div>
    </section>

    <section class="split shell" aria-labelledby="stages-title">
      <div class="split-head">
        <h2 id="stages-title">Atención médica para cada etapa</h2>
        <p>Acordamos con tu empresa el alcance de los servicios, según las tareas de los trabajadores y las necesidades de atención.</p>
      </div>
      <div class="split-body">
        <dl class="offer-rows">
${offerings.map(([n, d]) => `          <div><dt>${n}</dt><dd>${d}</dd></div>`).join('\n')}
          <div><dt><a href="/servicios/juntas-medicas.html">Juntas médicas ${icon('arrow')}</a></dt><dd>Coordinación de encuentros entre profesionales para evaluar el caso y documentar las conclusiones.</dd></div>
          <div><dt><a href="/servicios/ausentismo.html">Control de ausentismo ${icon('arrow')}</a></dt><dd>Seguimiento de ausencias, certificados y controles asociados a cada caso.</dd></div>
        </dl>
      </div>
    </section>

    <section class="split shell" aria-labelledby="flow-title">
      <div class="split-head">
        <h2 id="flow-title">De la consulta al seguimiento</h2>
        <p>Coordinamos cada atención y organizamos su documentación para facilitar el seguimiento del caso.</p>
      </div>
      <ul class="link-rows split-body">
        <li><a href="/servicios/teleconsultas.html"><span>Evaluaciones y teleconsultas</span><small>Consultas con un profesional para evaluar al trabajador y acompañar su evolución.</small>${icon('arrow', 'icon need-arrow')}</a></li>
        <li><a href="/servicios/informes.html"><span>Informes, actas y dictámenes</span><small>Documentos que registran las atenciones y las conclusiones profesionales, disponibles según su estado de elaboración y firma.</small>${icon('arrow', 'icon need-arrow')}</a></li>
      </ul>
    </section>

    <section class="portal portal-compact" aria-labelledby="portal-title">
      <div class="shell portal-grid">
        <div class="portal-copy">
          <h2 id="portal-title">Tu empresa, con la información a mano.</h2>
          <p>Un portal para consultar los turnos, seguir los casos y acceder a la documentación de las atenciones.</p>
          <a class="text-link" href="/empresa.html">Acceder al portal ${icon('external')}</a>
        </div>
        <dl class="portal-features portal-features-wide">
          <div><dt>Turnos y encuentros</dt><dd>Fechas programadas y enlaces de acceso a las videollamadas.</dd></div>
          <div><dt>Seguimiento de casos</dt><dd>Información del trabajador, certificados y evolución del caso.</dd></div>
          <div><dt>Documentación por atención</dt><dd>Informes y actas disponibles de cada atención médica.</dd></div>
        </dl>
      </div>
    </section>

${closing('closing-title', 'Armemos la propuesta para tu empresa.', 'Contanos qué servicios necesitás, a qué se dedica tu empresa y cuántos trabajadores integran tu equipo.')}`
}));

/* Contacto */

const optionGroups = [
  [null, ['Propuesta integral de medicina laboral']],
  ['Exámenes y evaluaciones', ['Aptos médicos', 'Exámenes preocupacionales', 'Exámenes periódicos', 'Auditorías psiquiátricas', 'Evaluaciones y teleconsultas']],
  ['Seguimiento y documentación', ['Juntas médicas', 'Control de ausentismo', 'Informes y documentación']]
];

write('contacto.html', page({
  title: 'Presupuesto de medicina laboral en Argentina | MEDGRUP',
  description: 'Solicitá un presupuesto de medicina laboral para tu empresa en Argentina. Contanos qué servicios necesitás y recibí una propuesta de MEDGRUP.',
  current: 'contacto',
  body: `${crumbs([['/medicina-laboral.html', 'Inicio'], [null, 'Contacto']])}

    <section class="contact shell" aria-labelledby="page-title">
      <div class="contact-intro">
        <h1 id="page-title">Hablemos de tu empresa.</h1>
        <p class="lead">Contanos qué necesita tu empresa. A partir de esa información, definimos el alcance de los servicios y preparamos una propuesta.</p>
        <div class="contact-direct">
          <p>También podés escribirnos directamente:</p>
          <a class="contact-email" href="mailto:${EMAIL}">${icon('mail')}<span>${EMAIL}</span></a>
        </div>
      </div>

      <form class="quote-form" id="quote-form" action="/api/contacto" method="post">
        <h2>Solicitá un presupuesto</h2>
        <p class="form-intro">Todos los campos son obligatorios, excepto el teléfono.</p>
        <div class="form-grid">
          <label>Empresa<input name="empresa" autocomplete="organization" required maxlength="120"></label>
          <label>Tu nombre<input name="nombre" autocomplete="name" required maxlength="120"></label>
          <label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="160"></label>
          <label>Teléfono <span class="optional">(opcional)</span><input name="telefono" type="tel" autocomplete="tel" maxlength="40"></label>
        </div>
        <label>¿Qué servicio necesitás?
          <select name="servicio" required>
            <option value="">Seleccioná una opción</option>
${optionGroups.map(([group, opts]) => {
  const o = opts.map((x) => `<option>${x}</option>`).join('');
  return group ? `            <optgroup label="${group}">${o}</optgroup>` : `            ${o}`;
}).join('\n')}
          </select>
        </label>
        <label>Contanos qué necesita tu empresa<textarea name="mensaje" rows="5" maxlength="2500" required placeholder="Por ejemplo: actividad de la empresa, cantidad de trabajadores y servicios que necesitás."></textarea></label>
        <p class="form-hint">Incluí solo información general de la empresa. La documentación médica de los trabajadores se gestiona en el portal.</p>
        <label class="form-trap" aria-hidden="true">Dejá este campo vacío<input name="website" tabindex="-1" autocomplete="off"></label>
        <button class="btn btn-block" type="submit">Enviar solicitud</button>
        <p class="form-hint">La solicitud se envía directamente a nuestro equipo. Te confirmaremos aquí cuando haya sido recibida.</p>
        <p id="quote-status" class="quote-status" role="status"></p>
      </form>
    </section>`
}));

/* Inicio: mismo encabezado, pie y símbolos que el resto del sitio. */

const homeFile = path.join(root, 'medicina-laboral.html');
let home = fs.readFileSync(homeFile, 'utf8');
home = home
  .replace(/<svg width="0" height="0" class="sprite"[\s\S]*?<\/svg>/, sprite)
  .replace(/<header class="site-header">[\s\S]*?<\/header>/, header('inicio'))
  .replace(/<footer class="site-footer">[\s\S]*?<\/footer>(\s*<a class="btn mobile-cta"[^>]*>[^<]*<\/a>)?/, footer);
if (!home.includes('/public-site.js')) home = home.replace('</body>', '  <script src="/public-site.js" defer></script>\n</body>');
fs.writeFileSync(homeFile, home);

console.log('Sitio público generado: servicios, 5 páginas de servicio, propuesta, contacto e inicio sincronizado.');
