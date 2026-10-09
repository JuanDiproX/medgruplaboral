const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const {renderPdf, sendDocument, filename} = require('../document-pdf');

test('La vista previa conserva el HTML sin iniciar Chromium', async () => {
  const res = {type(value) {assert.equal(value, 'html'); return this;}, send(value) {assert.equal(value, '<p>Vista previa</p>');}};
  await sendDocument({query: {}}, res, '<p>Vista previa</p>', 'informe.pdf');
});

test('Genera un PDF multipágina con imágenes locales y sin ejecutar scripts', async () => {
  const logo = fs.readFileSync('public/logo.png').toString('base64');
  const html = `<html><body><img src="/logo.png" width="100"><h1>Informe de prueba</h1><img src="data:image/png;base64,${logo}" width="80"><script>document.body.innerHTML='ERROR';</script><div style="break-before:page">Acta de prueba</div></body></html>`;
  const pdf = await renderPdf(html);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 2);
  assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
  const headers = {};
  const res = {type(value) {headers.type=value; return this;}, set(key,value) {headers[key]=value; return this;}, send(value) {assert.equal(value.subarray(0,5).toString(), '%PDF-');}};
  await sendDocument({query: {download:'1'}}, res, html, 'informe-prueba.pdf');
  assert.equal(headers.type, 'application/pdf');
  assert.equal(headers['Content-Disposition'], 'attachment; filename="informe-prueba.pdf"');
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.ok(!filename('informe\r\n".pdf').includes('\n'));
});

test('Descarga el blob y restablece el botón; rechaza HTML y errores HTTP', async () => {
  let clicked=0, removed=0, error='', mode='pdf';
  const attributes={};
  const button={innerHTML:'Descargar', disabled:false, getAttribute:k=>attributes[k], setAttribute:(k,v)=>attributes[k]=v, removeAttribute:k=>delete attributes[k]};
  const context = {
    URL:class extends URL {static createObjectURL(){return 'blob:prueba';} static revokeObjectURL(){}},
    location:{origin:'http://localhost'}, apiHeaders:()=>({}), setTimeout:()=>{},
    mostrarError:message=>error=message,
    document:{addEventListener(){}, body:{appendChild(){}}, createElement(){return {click(){clicked++;}, remove(){removed++;}};}},
    fetch:async url=>{assert.equal(url.searchParams.get('download'),'1');return {ok:mode!=='error', json:async()=>({error:'Reintentar'}), headers:{get:()=> 'attachment; filename="informe.pdf"'}, blob:async()=>new Blob([mode==='pdf'?'%PDF-1.4':'<html>Error</html>'])};}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/descargas.js','utf8'), context);
  await context.descargarPDF('/api/prueba',button);
  assert.equal(clicked,1); assert.equal(removed,1); assert.equal(button.disabled,false); assert.equal(button.innerHTML,'Descargar');
  mode='html'; await context.descargarPDF('/api/prueba',button);
  assert.match(error,/PDF válido/); assert.equal(clicked,1);
  mode='error'; await context.descargarPDF('/api/prueba',button);
  assert.equal(error,'Reintentar'); assert.equal(button.disabled,false); assert.equal(attributes['aria-busy'],undefined);
});
