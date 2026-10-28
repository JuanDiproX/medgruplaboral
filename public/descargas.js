// Los informes, actas y presupuestos se piden con la sesión (del equipo o de la empresa): un
// link común no la manda, así que se piden por fetch y se entregan como archivo o en una
// pestaña nueva. Lo usan el panel (apiHeaders) y el portal de empresas (empresaHeaders).
function encabezadosDeSesion() {
  if (typeof apiHeaders === 'function') return apiHeaders();
  if (typeof empresaHeaders === 'function') return empresaHeaders();
  return {};
}
function avisarErrorDocumento(texto) {
  if (typeof mostrarError === 'function') mostrarError(texto); else alert(texto);
}

async function pedirPDF(url) {
  const endpoint = new URL(url, location.origin);
  endpoint.searchParams.set('download', '1');
  const response = await fetch(endpoint, {headers: encabezadosDeSesion()});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'No se pudo abrir el documento. Intentá nuevamente.');
  }
  const blob = await response.blob();
  if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error('El servidor no devolvió un PDF válido.');
  return { blob, name: response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'documento-medgrup.pdf' };
}

async function descargarPDF(url, button) {
  if (button?.getAttribute('aria-busy') === 'true') return;
  const previous = button?.innerHTML;
  if (button) { button.setAttribute('aria-busy', 'true'); button.disabled = true; button.textContent = 'Preparando PDF…'; }
  try {
    const { blob, name } = await pedirPDF(url);
    const objectURL = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectURL; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
  } catch (error) { avisarErrorDocumento(error.message); }
  finally {
    if (button) { button.innerHTML = previous; button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

// "Ver" en una pestaña nueva. La pestaña se abre en el mismo click (si no, el navegador la
// bloquea como popup) y se llena cuando llega el PDF.
async function abrirPDF(url, link) {
  if (link?.getAttribute('aria-busy') === 'true') return;
  const pestana = window.open('', '_blank');
  const previous = link?.innerHTML;
  if (link) { link.setAttribute('aria-busy', 'true'); link.textContent = 'Abriendo…'; }
  try {
    const { blob, name } = await pedirPDF(url);
    const objectURL = URL.createObjectURL(blob);
    if (pestana) pestana.location = objectURL;
    else if (!window.open(objectURL, '_blank')) {
      // Pestaña bloqueada (por ejemplo, si se abre después de una confirmación): se descarga
      const a = document.createElement('a');
      a.href = objectURL; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
  } catch (error) {
    if (pestana) pestana.close();
    avisarErrorDocumento(error.message);
  } finally {
    if (link) { link.innerHTML = previous; link.removeAttribute('aria-busy'); }
  }
}

const DOCUMENTO_CON_SESION = /^\/api\/(dictamenes\/\d+\/(pdf|pdf-firmado)|turnos\/[^/]+\/acta|presupuestos\/\d+\/pdf)$/;

document.addEventListener('click', event => {
  const descarga = event.target.closest('[data-descarga-pdf]');
  if (descarga) { event.preventDefault(); descargarPDF(descarga.href, descarga); return; }
  // Cualquier otro link a un informe, acta o presupuesto se abre con la sesión
  const link = event.target.closest('a[href]');
  if (!link) return;
  const url = new URL(link.href, location.origin);
  if (url.origin !== location.origin || !DOCUMENTO_CON_SESION.test(url.pathname)) return;
  event.preventDefault();
  abrirPDF(url.pathname, link);
});
