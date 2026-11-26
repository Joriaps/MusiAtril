// Prueba de la versión web (docs/) en Chrome, servida como la serviría GitHub Pages: bajo /atril-local/ y con caché de 10 min.
// Comprueba service worker, «Añadir desde el iPad», copia a archivo, uso sin conexión y actualización. No sustituye al iPad.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'test', 'capturas');
fs.mkdirSync(shots, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const DOCS = path.join(root, 'docs');
if (!fs.existsSync(path.join(DOCS, 'sw.js'))) { console.error('Falta docs/: ejecuta antes npm run build:web'); process.exit(1); }

// Versión «nueva»: la misma con otra huella en el service worker.
const tmp = path.join(root, 'test', 'tmp-web'), V2 = path.join(tmp, 'v2');
fs.rmSync(tmp, { recursive: true, force: true });
fs.cpSync(DOCS, V2, { recursive: true });
const sw2 = fs.readFileSync(path.join(V2, 'sw.js'), 'utf8').replace(/var REV = "([^"]+)";/, 'var REV = "$1-v2";');
fs.writeFileSync(path.join(V2, 'sw.js'), sw2);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8' };
const BASE = '/atril-local/', port = 8398, URL0 = `http://127.0.0.1:${port}${BASE}`;
let dir = DOCS, up = true;
const srv = http.createServer((q, s) => {
  if (!up) { q.socket.destroy(); return; }
  const u = new URL(q.url, 'http://x');
  const rel = u.pathname.startsWith(BASE) ? decodeURIComponent(u.pathname.slice(BASE.length)) || 'index.html' : null;
  const f = rel === null ? null : path.join(dir, rel);
  if (!f || !f.startsWith(dir + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('404'); return; }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
  s.end(fs.readFileSync(f));
});
await new Promise((ok) => srv.listen(port, '127.0.0.1', ok));

let bad = 0;
const check = (ok, m) => { if (!ok) bad++; console.log((ok ? '  ok  ' : 'FALLO ') + m); };
let browser;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 2, hasTouch: true });
  // Sin caché HTTP: lo que funcione sin conexión tiene que venir del service worker.
  await page.setCacheEnabled(false);
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|ServiceWorker|Failed to (load|fetch)/.test(m.text())) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e.stack || e)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => page.screenshot({ path: path.join(shots, n + '.png') });
  const click = async (t, sel = 'button,.item .tapable') => {
    await page.waitForFunction((t, sel) => [...document.querySelectorAll(sel)].some((x) => x.textContent.includes(t) && !x.disabled), { timeout: 15000 }, t, sel);
    await page.evaluate((t, sel) => { const l = [...document.querySelectorAll(sel)].filter((x) => x.textContent.includes(t)); (l.find((x) => x.textContent === t) || l[l.length - 1]).click(); }, t, sel);
    await sleep(150);
  };
  const text = (t, ms = 15000) => page.waitForFunction((t) => document.body.textContent.includes(t), { timeout: ms }, t);
  const has = (t) => page.evaluate((t) => document.body.textContent.includes(t), t);
  const cacheInfo = () => page.evaluate(async () => { const k = await caches.keys(); const n = k.length === 1 ? (await (await caches.open(k[0])).keys()).length : -1; return { k, n }; });
  const listed = JSON.parse(/var FILES = (\[[^\]]*\]);/.exec(fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8'))[1]);

  // --- instalar
  await page.goto(URL0, { waitUntil: 'networkidle0' });
  await text('Todavía no hay partituras');

  // --- texto con una fuente que el PDF no incluye (títulos y letras de muchas partituras)
  const sinFuente = () => {
    const content = '2 w 50 600 m 550 600 l S 50 620 m 550 620 l S 50 640 m 550 640 l S\nBT /F1 40 Tf 60 700 Td (Allegro moderato) Tj ET';
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
    return [...Buffer.from(out, 'latin1')];
  };
  const ink = await page.evaluate(async (data) => {
    // Mismas opciones que engine.js (disableFontFace incluido).
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true, enableXfa: false, verbosity: 0 }).promise;
    const pg = await doc.getPage(1), vp = pg.getViewport({ scale: 1 }), c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: x, viewport: vp }).promise;
    const d = x.getImageData(0, 50, c.width, 70).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
    await doc.destroy();
    return n;
  }, sinFuente());
  check(ink > 500, 'se ve el texto con una fuente que el PDF no incluye (' + ink + ' píxeles)');
  check(await has('elígelas en Archivos'), 'biblioteca vacía explica cómo añadir partituras');
  check(!(await has('Importar desde el PC')), 'sin «Importar desde el PC»');
  check(await page.evaluate(() => !!document.querySelector('label.btn.main input[type=file][multiple]') && document.querySelector('label.btn.main').textContent.includes('Añadir partituras')), '«＋ Añadir partituras» es el botón principal y admite varios PDF');
  check(await page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.textContent).join('|') === 'Partituras|Conciertos|Opciones|Ayuda'), 'pestañas: Partituras, Conciertos, Opciones y Ayuda');
  await click('Ayuda', '.tab');
  await text('Nada se borra sin preguntarte antes.');
  check(await has('Toca en la parte derecha de la página para pasar'), 'la ayuda explica cómo pasar página');
  await shot('web-ayuda');
  await click('Volver a mis partituras');
  await text('Todavía no hay partituras');
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, { timeout: 30000 });
  check(true, 'el service worker controla la página');
  const c1 = await cacheInfo();
  check(c1.k.length === 1 && c1.n === listed.length, 'caché sin conexión completa (' + c1.n + ' de ' + listed.length + ' archivos)');
  check(!(await page.evaluate(() => document.documentElement.hasAttribute('manifest'))), 'index.html sin AppCache');
  await shot('web-inicio');

  // --- añadir un PDF como desde Archivos
  const input = await page.$('label.btn input[type=file]');
  await input.uploadFile(path.join(root, 'test/pdfs/limpio.pdf'));
  await text('1 partitura añadida.', 30000);
  check(true, 'PDF añadido desde un archivo');

  check(!/\d MB/.test(await page.evaluate(() => document.querySelector('.rows').textContent)), 'sin «MB» en la lista');
  await shot('web-biblioteca');

  // --- lector: guía de dónde tocar y «Más»
  await click('limpio', '.item .tapable');
  await page.waitForSelector('.viewer');
  check(await page.evaluate(() => !!document.querySelector('.hint') && document.querySelector('.hint').textContent.includes('pasar página')), 'la primera vez enseña dónde tocar');
  await sleep(1500); await shot('web-guia');
  await page.touchscreen.tap(410, 600); await sleep(300);
  check(!(await page.evaluate(() => !!document.querySelector('.hint'))), 'la guía se quita al primer toque');
  await page.evaluate(() => document.querySelector('.bar').classList.remove('hidden'));
  check(await page.evaluate(() => [...document.querySelectorAll('.bar button')].map((b) => b.textContent).join('|') === '‹ Volver|✎ Anotar|Ir a página|Más'), 'barra del lector: Volver, Anotar, Ir a página y Más');
  await click('Más', '.bar button');
  check(await has('Mejorar la imagen') && await has('Modo noche'), '«Más» agrupa imagen, vista y modo noche');
  await shot('web-mas');
  await page.evaluate(() => document.querySelector('.modal button[aria-label="Cerrar"]').click());
  await sleep(300);

  // --- toques, zoom y cambio de página
  const atP = (n) => page.waitForFunction((n) => { const s = document.querySelectorAll('.spread'); return s.length === 1 && s[0].getAttribute('data-p') === String(n); }, { timeout: 30000 }, n);
  const tf = () => page.evaluate(() => document.querySelector('.spread').style.transform);
  const barHidden = () => page.evaluate(() => document.querySelector('.bar').classList.contains('hidden'));
  const notesN = () => page.evaluate(() => new Promise((ok) => { const r = indexedDB.open('atril'); r.onsuccess = () => { let n = 0; const c = r.result.transaction('notes').objectStore('notes').openCursor(); c.onsuccess = () => { const k = c.result; if (k) { n += k.value.length; k.continue(); } else { r.result.close(); ok(n); } }; }; }));
  const pinchOut = async (x, y) => { const a = await page.touchscreen.touchStart(x - 60, y), b = await page.touchscreen.touchStart(x + 60, y); for (let i = 1; i <= 6; i++) { await a.move(x - 60 - i * 20, y); await b.move(x + 60 + i * 20, y); } await a.end(); await b.end(); await sleep(200); };
  // Un toque que tiembla 25 px sigue pasando página.
  let th = await page.touchscreen.touchStart(700, 600); await th.move(712, 610); await th.move(725, 615); await th.end();
  await atP(2); check(true, 'un toque con temblor en el borde derecho pasa página');
  check(await barHidden(), 'al pasar página se esconde la barra');
  await sleep(2500);
  const t0 = Date.now(); await page.touchscreen.tap(80, 600); await atP(1);
  const dt = Date.now() - t0; check(dt < 600, 'volver a la página anterior es inmediato (' + dt + ' ms)');
  await pinchOut(410, 600);
  check(/scale\((1\.[6-9]|[2-4])/.test(await tf()), 'dos dedos amplían la página (' + (await tf()) + ')');
  const before = await tf();
  th = await page.touchscreen.touchStart(410, 600); await th.move(380, 560); await th.move(350, 520); await th.end(); await sleep(200);
  check((await tf()) !== before && await page.evaluate(() => document.querySelector('.spread').getAttribute('data-p') === '1'), 'con zoom, arrastrar mueve la página sin pasarla');
  await shot('web-zoom');
  await page.touchscreen.tap(760, 600); await atP(2);
  check(!/scale/.test(await tf()), 'al pasar página vuelve a su tamaño');
  await page.evaluate(() => document.querySelector('.bar').classList.remove('hidden'));
  await click('✎ Anotar', '.bar button'); await sleep(1500);
  const n0 = await notesN();
  await pinchOut(410, 500);
  check(/scale\(/.test(await tf()) && (await notesN()) === n0, 'al anotar, dos dedos amplían y no dibujan');
  await page.evaluate(() => { const d = [...document.querySelectorAll('.abar .dot')]; d[2].click(); });
  check(await page.evaluate(() => document.querySelectorAll('.abar .dot')[2].classList.contains('on')), 'el color cambia al primer toque');
  await click('Listo', '.abar button'); await sleep(500);
  await page.evaluate(() => document.querySelector('.bar').classList.remove('hidden'));
  await click('‹ Volver'); await page.waitForSelector('.tabs');

  // --- copias
  await click('Opciones', '.tab');
  check(!(await has('Recuperar del PC')) && !(await has('Copia completa al PC')), 'sin copias al PC');
  check(await page.evaluate(() => { const d = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Diagnóstico'); return !!document.querySelector('.moreopts.hidden') && !!d && !d.offsetParent; }), 'lo técnico (diagnóstico, espacio…) está plegado en «Más opciones»');
  await shot('web-opciones');
  await text('Lista', 15000);
  check(true, 'estado sin conexión: «Lista»');
  await click('Guardar copia en el iPad');
  await text('Copia preparada (sin PDFs)');
  check(await has('1 partituras, 0 carpetas'), 'la copia cuenta lo que hay');
  await shot('web-copias');
  await page.evaluate(() => document.querySelector('.modal button[aria-label="Cerrar"]').click());
  await sleep(200);

  // --- sin conexión
  up = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tabs', { timeout: 15000 });
  await click('Partituras', '.tab');
  await click('limpio', '.item .tapable');
  await page.waitForFunction(() => document.querySelector('.spread') && document.querySelector('.bar .grow') && /· \d+\//.test(document.querySelector('.bar .grow').textContent) && !document.querySelector('.msg').textContent, { timeout: 60000 });
  check(true, 'sin conexión se abre la app y se lee la partitura');
  await shot('web-sin-conexion');
  await click('‹ Volver');
  await page.waitForSelector('.tabs');

  // --- versión nueva
  dir = V2; up = true;
  await page.reload({ waitUntil: 'networkidle0' });
  await click('Opciones', '.tab');
  await text('Versión nueva descargada', 30000);
  check(true, 'detecta la versión nueva al abrir');
  await Promise.all([page.waitForNavigation({ timeout: 30000 }), click('Actualizar ahora')]);
  await page.waitForSelector('.tabs', { timeout: 15000 });
  const c2 = await cacheInfo();
  check(c2.k.length === 1 && /-v2$/.test(c2.k[0]) && c2.n === listed.length, '«Actualizar ahora» cambia a la versión nueva y borra la vieja');
  await click('Partituras', '.tab');
  await text('limpio');
  check(true, 'la partitura sigue ahí tras actualizar');
  await shot('web-actualizada');

  check(!errs.length, 'sin errores en la consola' + (errs.length ? ' → ' + errs.join(' | ') : ''));
} catch (e) {
  bad++;
  console.log('FALLO ' + (e && e.message || e));
} finally {
  try { if (bad && browser) await (await browser.pages()).pop().screenshot({ path: path.join(shots, 'web-fallo.png') }); } catch { /* nada */ }
  if (browser) await browser.close();
  srv.close();
}
console.log(bad ? `\n${bad} fallo(s)` : '\nPruebas correctas');
process.exit(bad ? 1 : 0);
