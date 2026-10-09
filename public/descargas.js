async function descargarPDF(url, button) {
  if (button?.getAttribute('aria-busy') === 'true') return;
  const previous = button?.innerHTML;
  if (button) { button.setAttribute('aria-busy', 'true'); button.disabled = true; button.textContent = 'Preparando PDF…'; }
  try {
    const endpoint = new URL(url, location.origin);
    endpoint.searchParams.set('download', '1');
    const response = await fetch(endpoint, {headers: apiHeaders()});
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo descargar el documento. Intentá nuevamente.');
    }
    const blob = await response.blob();
    if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error('El servidor no devolvió un PDF válido.');
    const name = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'documento-medgrup.pdf';
    const objectURL = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectURL; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
  } catch (error) { mostrarError(error.message); }
  finally {
    if (button) { button.innerHTML = previous; button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}
document.addEventListener('click', event => {
  const link = event.target.closest('[data-descarga-pdf]');
  if (!link) return;
  event.preventDefault();
  descargarPDF(link.href, link);
});
