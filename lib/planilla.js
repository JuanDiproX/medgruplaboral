// Lectura y escritura mínima de planillas: .xlsx (Excel, Google Sheets, LibreOffice) y .csv.
// Solo se leen valores de celdas: no se ejecutan fórmulas, macros ni vínculos externos, y el
// archivo se procesa en memoria con límites de tamaño, hojas, filas y columnas.
const {unzipSync, zipSync, strFromU8, strToU8} = require('fflate');
const LIMITES = {bytes: 5 * 1024 * 1024, descomprimido: 60 * 1024 * 1024, filas: 5000, columnas: 60, hojas: 20};
const fail = m => Object.assign(new Error(m), {status: 400, publico: true});
const xml = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const attr = (tag, name) => (tag.match(new RegExp('\\b' + name + '="([^"]*)"')) || [])[1];
function columna(ref) { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
function letra(i) { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }
// Excel guarda las fechas como días desde 1900; se devuelven como AAAA-MM-DD.
function fechaExcel(serial) {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  return isNaN(d) ? String(serial) : d.toISOString().slice(0, 10);
}
function textos(xmlTexto) { return [...xmlTexto.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => xml(m[1])).join(''); }

function leerXlsx(buffer) {
  let total = 0, archivos;
  try {
    archivos = unzipSync(new Uint8Array(buffer), {filter: f => {
      total += f.originalSize; if (total > LIMITES.descomprimido) throw fail('La planilla es demasiado grande.');
      return /^xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(f.name);
    }});
  } catch (e) { throw e.publico ? e : fail('No pudimos abrir el archivo. Guardalo como Excel (.xlsx) o CSV y volvé a subirlo.'); }
  const leer = n => archivos[n] ? strFromU8(archivos[n]) : '';
  const libro = leer('xl/workbook.xml');
  if (!libro) throw fail('El archivo no parece una planilla de Excel válida.');
  const compartidos = [...leer('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textos(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
  // Qué estilos de celda son fechas: formatos propios de Excel o personalizados con d/m/a.
  const estilos = leer('xl/styles.xml'), formatos = {};
  for (const m of estilos.matchAll(/<numFmt\b[^>]*>/g)) formatos[attr(m[0], 'numFmtId')] = xml(attr(m[0], 'formatCode') || '');
  const xfs = ((estilos.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0].match(/<xf\b[^>]*>/g) || []).map(x => {
    const id = +attr(x, 'numFmtId'), codigo = formatos[id];
    return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (codigo ? /[dmy]/i.test(codigo.replace(/\[[^\]]*\]|"[^"]*"/g, '')) && !/^[#0,.%\s-]+$/.test(codigo) : false);
  });
  const rels = {};
  for (const m of leer('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) rels[attr(m[0], 'Id')] = attr(m[0], 'Target');
  const hojas = [];
  for (const m of [...libro.matchAll(/<sheet\b[^>]*>/g)].slice(0, LIMITES.hojas)) {
    if (attr(m[0], 'state') === 'hidden' || attr(m[0], 'state') === 'veryHidden') continue;
    const destino = String(rels[attr(m[0], 'r:id')] || '').replace(/^\/?xl\//, '').replace(/^\//, '');
    const contenido = leer('xl/' + destino);
    if (!contenido) continue;
    const filas = [];
    for (const f of contenido.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const fila = [];
      for (const c of f[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], 'r'), i = ref ? columna(ref) : fila.length;
        if (i >= LIMITES.columnas) continue;
        const tipo = attr(c[1], 't'), cuerpo = c[2] || '', v = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let valor = '';
        if (tipo === 's') valor = compartidos[+v] ?? '';
        else if (tipo === 'inlineStr') valor = textos(cuerpo);
        else if (tipo === 'b') valor = v === '1' ? 'Sí' : 'No';
        else if (tipo === 'e') valor = '';
        else if (v !== undefined) {
          valor = xml(v);
          if (tipo !== 'str' && xfs[+attr(c[1], 's')] && /^\d+(\.\d+)?$/.test(valor) && +valor > 59 && +valor < 80000) valor = fechaExcel(+valor);
          else if (tipo !== 'str' && /^-?\d+\.\d{8,}$/.test(valor)) valor = String(+(+valor).toFixed(6));
        }
        fila[i] = String(valor).trim();
      }
      filas.push(Array.from(fila, x => x ?? ''));
      if (filas.length > LIMITES.filas + 50) throw fail(`La planilla supera las ${LIMITES.filas} filas. Dividila en varios archivos.`);
    }
    hojas.push({nombre: xml(attr(m[0], 'name') || 'Hoja'), filas});
  }
  if (!hojas.length) throw fail('La planilla no tiene hojas con datos.');
  return hojas;
}

function leerCsv(buffer) {
  let texto = buffer.toString('utf8');
  if (texto.includes('�')) texto = buffer.toString('latin1'); // Excel en Windows suele exportar en ANSI
  texto = texto.replace(/^﻿/, '');
  const primera = texto.split(/\r?\n/, 1)[0];
  const sep = [';', ',', '\t', '|'].map(s => [s, primera.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) { if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += ch; }
    else if (ch === '"' && campo === '') comillas = true;
    else if (ch === sep) { fila.push(campo.trim()); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo.trim()); campo = ''; filas.push(fila.slice(0, LIMITES.columnas)); fila = [];
      if (filas.length > LIMITES.filas + 50) throw fail(`La planilla supera las ${LIMITES.filas} filas. Dividila en varios archivos.`);
    } else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo.trim()); filas.push(fila.slice(0, LIMITES.columnas)); }
  return [{nombre: 'CSV', filas}];
}

// Devuelve las hojas con su fila de títulos detectada: la primera fila con al menos dos celdas
// de texto (las planillas reales suelen traer un título o un logo arriba de la tabla).
function leerPlanilla({nombre = '', base64 = ''}) {
  const limpio = String(base64).replace(/^data:[^,]*,/, '');
  if (!limpio) throw fail('Elegí un archivo.');
  if (limpio.length > LIMITES.bytes * 1.4) throw fail('El archivo supera los 5 MB.');
  const buffer = Buffer.from(limpio, 'base64');
  if (buffer.length > LIMITES.bytes) throw fail('El archivo supera los 5 MB.');
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (!zip && /\.xls$/i.test(nombre)) throw fail('El formato .xls antiguo no está soportado. En Excel elegí Guardar como › Libro de Excel (.xlsx).');
  const hojas = zip ? leerXlsx(buffer) : leerCsv(buffer);
  return hojas.map(h => {
    const filas = h.filas.map(f => f.map(c => String(c ?? '').slice(0, 2000)));
    let inicio = filas.findIndex(f => f.filter(c => c && !/^[\d\s.,/-]+$/.test(c)).length >= 2);
    if (inicio < 0) inicio = 0;
    const encabezados = (filas[inicio] || []).map((c, i) => c || `Columna ${letra(i)}`);
    const datos = filas.slice(inicio + 1).map((f, i) => ({numero: inicio + i + 2, celdas: encabezados.map((_, j) => f[j] ?? '')}))
      .filter(f => f.celdas.some(c => c !== ''));
    return {nombre: h.nombre, encabezados, filas: datos.slice(0, LIMITES.filas)};
  }).filter(h => h.encabezados.length);
}

// Genera un .xlsx simple (una hoja, textos) para las plantillas descargables.
function crearXlsx(nombreHoja, filas, anchos = []) {
  const celdas = filas.map((f, r) => `<row r="${r + 1}">` + f.map((v, c) =>
    `<c r="${letra(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('') + '</row>').join('');
  const cols = anchos.length ? '<cols>' + anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : '';
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(`${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(nombreHoja).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`${X}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF13233A"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(`${X}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${celdas}</sheetData></worksheet>`)
  }));
}
module.exports = {leerPlanilla, crearXlsx, LIMITES};
