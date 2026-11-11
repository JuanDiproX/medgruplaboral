(() => {
  const context = window.medgrupParticipant;
  if (!context || context.staff) return;
  const {base, headers, doctor} = context;
  const actions = document.querySelector('#llamada .botonera');
  const shortcut = document.createElement('button');
  shortcut.type = 'button';
  shortcut.className = 'btn btn-borde';
  shortcut.textContent = 'Firmas';
  shortcut.hidden = true;
  actions.append(shortcut);

  const notice = document.createElement('p');
  notice.id = 'firma-aviso';
  notice.className = 'hint';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  actions.after(notice);

  const dialog = document.createElement('dialog');
  dialog.className = 'firma-modal';
  dialog.setAttribute('aria-labelledby', 'firma-titulo');
  dialog.innerHTML = `
    <div class="firma-cabecera">
      <h2 id="firma-titulo" tabindex="-1"></h2>
      <p id="firma-persona"></p>
      <button id="firma-cerrar" type="button" aria-label="Cerrar">Cerrar</button>
    </div>
    <div class="firma-cuerpo">
      <div id="firma-documentos" hidden></div>
      <p id="firma-explicacion"></p>
      <details id="firma-acta-detalle" hidden>
        <summary>Ver datos del acta</summary>
        <div id="firma-acta-contenido"></div>
      </details>
      <div id="firma-preview" tabindex="0" aria-label="Contenido del informe" hidden></div>
      <div id="firma-dibujo" hidden>
        <div class="firma-lienzo-etiqueta">
          <span id="firma-indicacion">Dibujá tu firma</span>
          <button id="firma-limpiar" class="firma-secundaria" type="button" disabled>Borrar</button>
        </div>
        <canvas id="firma-lienzo" width="640" height="220" aria-labelledby="firma-indicacion"></canvas>
      </div>
      <button id="firma-otra" class="firma-secundaria" type="button" hidden>Dibujar otra firma</button>
      <p id="firma-estado" role="status" aria-live="polite" hidden></p>
      <button id="firma-guardar" class="btn btn-azul" type="button" hidden></button>
    </div>`;
  document.body.append(dialog);

  const $ = id => dialog.querySelector('#' + id);
  const canvas = $('firma-lienzo');
  const pen = canvas.getContext('2d');
  pen.lineWidth = 3;
  pen.lineCap = 'round';
  pen.strokeStyle = '#13233a';
  let acta, informes = [], target, loading, saving = false;
  let drawing = false, drawn = false, useSaved = false, offered = false;

  function status(message = '') {
    $('firma-estado').textContent = message;
    $('firma-estado').hidden = !message;
  }

  function clearSignature() {
    pen.clearRect(0, 0, canvas.width, canvas.height);
    drawing = drawn = false;
    $('firma-limpiar').disabled = true;
  }

  function point(event) {
    const r = canvas.getBoundingClientRect();
    return [(event.clientX - r.left) * canvas.width / r.width, (event.clientY - r.top) * canvas.height / r.height];
  }

  canvas.addEventListener('pointerdown', event => {
    if (saving) return;
    event.preventDefault();
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    pen.beginPath();
    pen.moveTo(...point(event));
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing || saving) return;
    event.preventDefault();
    pen.lineTo(...point(event));
    pen.stroke();
    drawn = true;
    $('firma-limpiar').disabled = false;
    status();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(event, () => { drawing = false; });
  }
  $('firma-limpiar').onclick = clearSignature;

  async function api(path, body) {
    const response = await fetch(base + path, {
      cache: 'no-store',
      headers: {...headers(), ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {method: 'POST', body: JSON.stringify(body)} : {})
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'No se pudo completar la operación.');
    return data;
  }

  function paragraph(parent, text) {
    const p = document.createElement('p');
    p.textContent = text;
    parent.append(p);
  }

  function show(title, explanation) {
    $('firma-titulo').textContent = title;
    $('firma-persona').textContent = acta?.nombre || '';
    $('firma-explicacion').textContent = explanation;
    if (!dialog.open) dialog.showModal();
    $('firma-titulo').focus({preventScroll: true});
    dialog.scrollTop = 0;
  }

  function resetDialog() {
    target = null;
    status();
    clearSignature();
    for (const id of ['firma-acta-detalle', 'firma-preview', 'firma-documentos', 'firma-dibujo', 'firma-otra', 'firma-guardar']) {
      $(id).hidden = true;
    }
    $('firma-acta-detalle').open = false;
  }

  function setSignatureMode(saved) {
    useSaved = saved;
    clearSignature();
    $('firma-dibujo').hidden = saved;
    $('firma-otra').hidden = !saved;
    $('firma-guardar').hidden = false;
    $('firma-guardar').textContent = target.id
      ? (saved ? 'Firmar informe con mi firma guardada' : 'Firmar informe')
      : (doctor ? 'Firmar acta y guardar' : 'Firmar acta');
  }
  $('firma-otra').onclick = () => setSignatureMode(false);

  function editDocument(doc) {
    resetDialog();
    target = doc;
    setSignatureMode(!!doc.id && acta.firma_guardada === true);
    if (doc.id) {
      const preview = $('firma-preview');
      preview.replaceChildren();
      const labels = {paciente:'Paciente', apellido_nombre:'Nombre', fecha_consulta:'Fecha', antecedentes:'Antecedentes',
        hallazgos:'Hallazgos', analisis:'Análisis', conclusion:'Conclusión', diagnostico:'Diagnóstico',
        diagnostico_desc:'Descripción del diagnóstico', diagnostico_cie:'Código diagnóstico', indicaciones:'Indicaciones',
        informe_completo:'Informe'};
      for (const [key, label] of Object.entries(labels)) {
        const value = doc.contenido[key];
        if (value !== null && value !== undefined && value !== '') paragraph(preview, label + ': ' + value);
      }
      preview.hidden = false;
      preview.scrollTop = 0;
      show('Informe ' + doc.contenido.numero, 'Revisá el informe. Al firmarlo, confirmás que estás de acuerdo con su contenido.');
      return;
    }
    offered = true;
    const details = $('firma-acta-contenido');
    details.replaceChildren();
    const date = String(acta.fecha || '').split('T')[0].split('-').reverse().join('/');
    paragraph(details, [acta.tipo, acta.paciente, date, acta.hora && acta.hora + ' h'].filter(Boolean).join(' · '));
    const eventLabels = {union_medico:'Ingreso del profesional', union_paciente:'Ingreso del paciente',
      fin_consulta:'Finalización de consulta', inicio_medico:'Inicio del control'};
    for (const event of acta.eventos || []) {
      const time = new Date(event.creado_en).toLocaleTimeString('es-AR', {timeZone:'America/Argentina/Buenos_Aires'});
      paragraph(details, [time, eventLabels[event.tipo] || event.tipo, event.participante].filter(Boolean).join(' · '));
    }
    $('firma-acta-detalle').hidden = false;
    show('Firmá el acta de asistencia', doctor
      ? 'Al confirmar, firmás el acta y guardás tu firma para esta consulta. Podrás usarla si aprobás el informe cuando esté listo.'
      : 'Al confirmar, dejás constancia de tu participación en esta consulta.');
  }

  function openDocuments() {
    if (!acta || saving) return;
    const pending = informes.filter(doc => !doc.firmado);
    if (!acta.firmada && acta.puede_firmar) {
      editDocument(acta);
    } else if (pending.length === 1 && acta.puede_firmar) {
      editDocument(pending[0]);
    } else {
      resetDialog();
      if (pending.length && acta.puede_firmar) {
        const list = $('firma-documentos');
        list.replaceChildren();
        for (const doc of pending) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn btn-borde';
          button.textContent = 'Revisar informe ' + doc.contenido.numero;
          button.onclick = () => editDocument(doc);
          list.append(button);
        }
        list.hidden = false;
        show('Informes para firmar', 'Elegí el informe que querés revisar.');
      } else if (!acta.firmada) {
        show('Firma de asistencia', 'Podés firmar cuando se registre tu ingreso a la videollamada.');
      } else {
        show('Acta firmada', doctor && !informes.length
          ? 'Volvé a este enlace cuando el informe esté disponible para revisarlo y firmarlo.'
          : 'Tus firmas quedaron registradas.');
      }
    }
  }

  function updateShortcut() {
    const hasPending = informes.some(doc => !doc.firmado);
    shortcut.hidden = false;
    notice.hidden = false;
    shortcut.textContent = !acta.firmada ? 'Firmar acta' : hasPending ? 'Revisar informe' : 'Ver firmas';
    notice.textContent = !acta.firmada
      ? (acta.puede_firmar ? 'El acta está lista para firmar.' : 'La firma se habilita después de ingresar a la videollamada.')
      : (doctor && !informes.length ? 'Acta firmada. Volvé a este enlace para revisar el informe cuando esté listo.' : 'Acta firmada.');
  }

  function load() {
    if (loading) return loading;
    loading = (async () => {
      acta = await api('/firma');
      if (doctor) {
        informes = (await api('/informes')).informes;
      }
      updateShortcut();
      if (doctor && !offered && !acta.firmada && acta.puede_firmar && (!dialog.open || !target)) editDocument(acta);
    })().finally(() => { loading = null; });
    return loading;
  }

  function close() {
    if (!saving) dialog.close();
  }
  $('firma-cerrar').onclick = close;
  dialog.addEventListener('close', resetDialog);
  dialog.addEventListener('cancel', event => {
    if (saving) event.preventDefault();
  });

  shortcut.onclick = async () => {
    try {
      await load();
      openDocuments();
    } catch (error) {
      notice.hidden = false;
      notice.textContent = error.message;
    }
  };

  $('firma-guardar').onclick = async () => {
    if (!target || saving) return;
    if (!useSaved && !drawn) {
      status('Dibujá tu firma para continuar.');
      return;
    }
    saving = true;
    $('firma-guardar').disabled = true;
    $('firma-cerrar').disabled = true;
    $('firma-limpiar').disabled = true;
    $('firma-otra').disabled = true;
    const firma = useSaved ? {usar_firma_guardada: true} : {firma_base64: canvas.toDataURL('image/png')};
    const isReport = !!target.id;
    try {
      await api(isReport ? '/informes/' + target.id + '/firma' : '/firma', {
        ...firma, consentimiento:true,
        ...(isReport ? {revision:target.revision} : {guardar_para_informe:doctor})
      });
    } catch (error) {
      status(error.message);
      return;
    } finally {
      saving = false;
      $('firma-guardar').disabled = false;
      $('firma-cerrar').disabled = false;
      $('firma-limpiar').disabled = !drawn;
      $('firma-otra').disabled = false;
    }
    close();
    notice.hidden = false;
    notice.textContent = isReport ? 'Informe firmado.' : 'Acta firmada.';
    try { await load(); } catch {}
    if (isReport) notice.textContent = 'Informe firmado.';
  };

  async function waitForAttendance() {
    try { await load(); } catch {
      shortcut.hidden = false;
    }
    if (doctor && (!acta || (!acta.firmada && !acta.puede_firmar))) {
      setTimeout(waitForAttendance, 8000);
    }
  }
  waitForAttendance();
})();
