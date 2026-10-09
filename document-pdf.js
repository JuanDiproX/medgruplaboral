const fs = require('fs');
const path = require('path');
let active = false;

function filename(value) {
  return String(value).normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
}

async function renderPdf(html) {
  if (active) throw new Error('Hay otro PDF preparándose. Intentá nuevamente en unos segundos.');
  active = true;
  let browser;
  try {
    const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      ...(process.env.PATH || '').split(path.delimiter).flatMap(p => [path.join(p, 'chromium'), path.join(p, 'chromium-browser')])];
    const executablePath = candidates.find(p => p && fs.existsSync(p));
    if (!executablePath) throw new Error('El servidor todavía no tiene configurado el generador PDF.');
    browser = await require('puppeteer-core').launch({executablePath, headless: true, timeout: 20000,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking']});
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith('data:') ? request.continue() : request.abort());
    const logo = fs.readFileSync(path.join(__dirname, 'public/logo.png')).toString('base64');
    html = html.replace(/src="\/logo\.png"/g, `src="data:image/png;base64,${logo}"`);
    await page.setContent(html, {waitUntil: 'load', timeout: 20000});
    return Buffer.from(await page.pdf({format: 'A4', printBackground: true, timeout: 20000,
      margin: {top: '10mm', bottom: '10mm', left: '5mm', right: '5mm'}}));
  } finally {
    try { if (browser) await browser.close(); } finally { active = false; }
  }
}

async function sendDocument(req, res, html, name) {
  if (req.query.download !== '1') return res.type('html').send(html);
  const pdf = await renderPdf(html);
  return res.type('application/pdf').set('Content-Disposition', `attachment; filename="${filename(name)}"`)
    .set('Cache-Control', 'private, no-store').send(pdf);
}
module.exports = {renderPdf, sendDocument, filename};
