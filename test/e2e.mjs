// Prueba en Chrome quitando del navegador (página y worker) las APIs que Safari 10 no tiene.
// No sustituye al iPad: AppCache ya no existe en Chrome y la memoria no se puede imitar.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'test', 'capturas');
fs.mkdirSync(shots, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);

const OLD = `(function(g){
  function rm(o,l){ if(!o) return; l.forEach(function(k){ try{ delete o[k]; }catch(e){} if(k in o) { try{ Object.defineProperty(o,k,{value:undefined,configurable:true,writable:true}); }catch(e){} } }); }
  rm(g,['globalThis','ResizeObserver','IntersectionObserver','AbortController','AbortSignal','OffscreenCanvas','OffscreenCanvasRenderingContext2D','createImageBitmap','ImageBitmap','structuredClone','queueMicrotask','BigInt','WeakRef','FinalizationRegistry','DOMMatrix','PointerEvent','TextEncoder','TextDecoder','ReadableStream','WritableStream','TransformStream','requestIdleCallback','Intl_','BigInt64Array','BigUint64Array','SharedArrayBuffer','Atomics','CompressionStream','DecompressionStream']);
  rm(Promise,['allSettled','any','withResolvers','try']); rm(Promise.prototype,['finally']);
  rm(Object,['fromEntries','hasOwn','groupBy']);
  rm(Array.prototype,['flat','flatMap','at','findLast','findLastIndex','toSorted','toReversed','with','toSpliced']);
  rm(String.prototype,['matchAll','replaceAll','at','trimStart','trimEnd']);
  rm(Object.getPrototypeOf(Uint8Array.prototype),['at','findLast','toSorted','toReversed','with']);
  if(g.Symbol) { try{ delete Symbol.asyncIterator; delete Symbol.matchAll; }catch(e){} }
  if(g.CanvasRenderingContext2D) rm(CanvasRenderingContext2D.prototype,['getTransform','resetTransform','filter','roundRect','reset','createConicGradient']);
  if(g.CanvasPattern) rm(CanvasPattern.prototype,['setTransform']);
  if(g.Element) rm(Element.prototype,['replaceChildren','append','prepend','before','after','replaceWith','toggleAttribute']);
  if(g.IDBObjectStore) rm(IDBObjectStore.prototype,['getAll','getAllKeys','getKey']);
  if(g.HTMLCanvasElement) rm(HTMLCanvasElement.prototype,['toBlob','transferControlToOffscreen']);
  if(g.Blob) rm(Blob.prototype,['arrayBuffer','text','stream']);
  g.__old = true;
})(self);`;

const tmp = path.join(root, 'test', 'tmp');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, 'partituras', 'Guitarra', 'Sor'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'cfg.json'), JSON.stringify({ puerto: 8399, carpeta: './partituras', copias: './copias', maxPdfMB: 300 }));
fs.copyFileSync(path.join(root, 'test/pdfs/limpio.pdf'), path.join(tmp, 'partituras', 'Guitarra', 'Sor', 'Estudio ñ.pdf'));
fs.writeFileSync(path.join(tmp, 'partituras', 'Copia del estudio.pdf'), Buffer.concat([fs.readFileSync(path.join(root, 'test/pdfs/limpio.pdf')), Buffer.from('\n%otra\n')]));
fs.copyFileSync(path.join(root, 'test/pdfs/limpio.pdf'), path.join(tmp, 'partituras', 'Z duplicado.pdf'));
fs.copyFileSync(path.join(root, 'test/pdfs/mal-escaneo.pdf'), path.join(tmp, 'partituras', 'Mal escaneo.pdf'));
fs.writeFileSync(path.join(tmp, 'partituras', 'falso.pdf'), 'no soy un pdf');
fs.writeFileSync(path.join(tmp, 'partituras', 'secreto.txt'), 'x');
const srv = spawn(process.execPath, [path.join(root, 'server/serve.mjs'), '--local', '--config', path.join(tmp, 'cfg.json')], { stdio: 'pipe' });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 50 && !log.includes('http://'); i++) await new Promise((r) => setTimeout(r, 100));
const port = 8399;
const URL0 = `http://127.0.0.1:${port}/`;
let bad = 0;
const check = (ok, m) => { if (!ok) bad++; console.log((ok ? '  ok  ' : 'FALLO ') + m); };
let browser;
try {
  // --- servidor
  const get = (p, o = {}) => new Promise((ok, ko) => { const r = http.request({ host: '127.0.0.1', port, path: p, ...o }, (s) => { let b = ''; s.on('data', (d) => (b += d)); s.on('end', () => ok({ code: s.statusCode, h: s.headers, b })); }); r.on('error', ko); r.end(); });
  const raw = (p) => new Promise((ok) => { const s = net.connect(port, '127.0.0.1', () => s.write(`GET ${p} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`)); let b = ''; s.on('data', (d) => (b += d)); s.on('close', () => ok(b)); s.on('error', () => ok('')); });
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json', '/..\\package.json', '//etc/passwd', '/prueba/../../package.json', '/prueba/..%5c..%5cpackage.json', '/__proto__', '/C:/Windows/win.ini']) {
    const r = await raw(p); check(/^HTTP\/1\.1 404/.test(r) && !r.includes('devDependencies'), 'path traversal rechazado: ' + p);
  }
  check((await get('/', { method: 'POST' })).code === 405, 'POST rechazado');
  check((await get('/', { headers: { Host: 'malo.example' } })).code === 421, 'Host ajeno rechazado (DNS rebinding)');
  const man = await get('/atril.appcache');
  check(man.code === 200 && man.h['content-type'] === 'text/cache-manifest', 'manifiesto con su tipo MIME');
  check((await get('/otro.appcache')).code === 503, 'manifiesto ausente responde 503 (no borra la app)');
  check(/default-src 'none'/.test((await get('/')).h['content-security-policy']), 'CSP en cabecera');

  // --- navegador
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--js-flags=--max-old-space-size=512'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2, hasTouch: true });
  const errs = [], ext = []; globalThis.__errs = errs;
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e.stack || e)));
  await page.setRequestInterception(true);
  let workerBody = OLD + '\n' + fs.readFileSync(path.join(root, 'dist/pdf.worker.js'), 'utf8');
  page.on('request', (q) => {
    if (!q.url().startsWith(URL0) && !/^(blob|data):/.test(q.url())) ext.push(q.url());
    if (q.url().endsWith('/pdf.worker.js')) q.respond({ status: 200, contentType: 'application/javascript', body: workerBody });
    else q.continue();
  });
  await page.evaluateOnNewDocument(OLD);
  await page.goto(URL0, { waitUntil: 'networkidle0' });
  check(await page.evaluate(() => window.__old && typeof CanvasRenderingContext2D.prototype.getTransform === 'undefined'), 'APIs modernas retiradas');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => page.screenshot({ path: path.join(shots, n + '.png') });
  const code = () => [...log.matchAll(/(\d{3}) (\d{3})   \(sirve/g)].pop().slice(1).join('');
  const click = async (t, sel = 'button,.item .tapable,label.btn') => {
    await page.waitForFunction((t, sel) => [...document.querySelectorAll(sel)].some((x) => x.textContent.includes(t) && !x.disabled), { timeout: 15000 }, t, sel);
    await page.evaluate((t, sel) => { const l = [...document.querySelectorAll(sel)].filter((x) => x.textContent.includes(t)); (l.find((x) => x.textContent === t) || l[l.length - 1]).click(); }, t, sel);
    await sleep(150);
  };
  const text = (t, ms = 15000) => page.waitForFunction((t) => document.body.textContent.includes(t), { timeout: ms }, t);
  const fill = (v, i = 0) => page.evaluate((v, i) => { const x = document.querySelectorAll('.modal input')[i]; x.value = v; }, v, i);
  const at = (n) => page.waitForFunction((n) => document.querySelector('.bar .grow').textContent.includes('· ' + n + '/') && document.querySelectorAll('.spread').length === 1 && document.querySelector('.spread').getAttribute('data-p') === String(n) && !document.querySelector('.msg').textContent, { timeout: 60000 }, n);
  const idb = (store) => page.evaluate((store) => new Promise((ok) => { const r = indexedDB.open('atril'); r.onsuccess = () => { const o = {}, c = r.result.transaction(store).objectStore(store).openCursor(); c.onsuccess = () => { const k = c.result; if (k) { o[k.key] = store === 'chunks' ? k.value.byteLength : k.value; k.continue(); } else { r.result.close(); ok(o); } }; }; }), store);
  const tap = async (x, y = 500) => { await page.touchscreen.tap(x, y); await sleep(250); };
  const drag = async (pts) => { const t = await page.touchscreen.touchStart(...pts[0]); for (const p of pts.slice(1)) await t.move(...p); await t.end(); await sleep(250); };
  await text('Todavía no hay partituras');
  await shot('inicio');

  // --- API
  const post = (p, body, h = {}) => get(p, { method: 'POST', headers: { 'content-length': Buffer.byteLength(body), ...h } , body });
  const api = (m, p, body, h = {}) => new Promise((ok, ko) => { const r = http.request({ host: '127.0.0.1', port, path: p, method: m, headers: { ...(body !== undefined ? { 'content-length': Buffer.byteLength(body) } : {}), ...h } }, (x) => { let b = ''; x.on('data', (d) => (b += d)); x.on('end', () => ok({ code: x.statusCode, b })); }); r.on('error', ko); r.end(body); });
  check((await api('GET', '/api/lista')).code === 401, 'API sin código: 401');
  check((await api('POST', '/api/entrar', '{"codigo":"abc"}')).code === 403, 'código no numérico rechazado');
  check((await api('POST', '/api/entrar', 'x'.repeat(500))).code === 413, 'cuerpo de login limitado');
  check((await api('POST', '/api/entrar', JSON.stringify({ codigo: code() }), { Origin: 'http://malo.example' })).code === 403, 'origen ajeno rechazado');
  const c0 = code(), tk = JSON.parse((await api('POST', '/api/entrar', JSON.stringify({ codigo: c0 }))).b).token, H = { 'x-atril': tk };
  check(/^[0-9a-f]{64}$/.test(tk), 'código correcto da acceso');
  check((await api('POST', '/api/entrar', JSON.stringify({ codigo: c0 }))).code === 403, 'el código no sirve dos veces');
  const ls = JSON.parse((await api('GET', '/api/lista', undefined, H)).b);
  check(ls.archivos.length === 4 && !JSON.stringify(ls.archivos).includes('secreto'), 'la lista solo tiene PDFs reales');
  for (const q of ['../cfg.json', 'a', ls.archivos[0].id + '/..']) check((await api('GET', '/api/pdf?desde=0&cuanto=10&id=' + encodeURIComponent(q), undefined, H)).code === 404, 'id inventado rechazado: ' + q);
  for (const n of ['../cfg.json', '..%5Ccfg.json', 'copia-20200101-000000.json']) check((await api('GET', '/api/copia?nombre=' + n, undefined, H)).code === 404, 'copia inventada rechazada: ' + n);
  check((await api('POST', '/api/copia', '{"a":1}', H)).code === 400, 'copia sin formato rechazada');
  check((await api('POST', '/api/copia-pdf?hash=../../x&desde=0&total=3', 'abc', H)).code === 400, 'huella con ruta rechazada');
  check((await api('POST', '/api/copia-pdf?hash=' + '0'.repeat(64) + '&desde=0&total=3', 'abc', H)).code === 400, 'PDF sin cabecera rechazado');
  check((await api('GET', '/api/pdf?desde=-1&cuanto=10&id=' + ls.archivos[0].id, undefined, H)).code === 400, 'rango negativo rechazado');

  // --- importar: cancelar, reanudar, duplicados
  await click('Importar desde el PC');
  await fill(code()); await click('Conectar');
  await text('4 elegidas'); await shot('importar');
  await page.evaluate(() => { window.__send = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function (b) { const x = this; let cut = false; x.abort = () => { cut = true; if (x.onabort) x.onabort(); }; setTimeout(() => { if (!cut) window.__send.call(x, b); }, 120); }; });
  await click('Importar', '.tools.bottom button');
  await page.waitForFunction(() => document.querySelector('.fill') && parseFloat(document.querySelector('.fill').style.width) > 8, { timeout: 20000 });
  await page.evaluate(() => { [...document.querySelectorAll('.modal .foot button')].pop().click(); });
  await text('se reanudará');
  const part = await idb('imports'), k0 = Object.keys(part);
  check(k0.length === 1 && part[k0[0]].got > 0, 'cancelar deja una importación a medias (' + (part[k0[0]] || {}).got + ' trozos)');
  await page.evaluate(() => { XMLHttpRequest.prototype.send = window.__send; });
  await sleep(400); await click('Importar desde el PC'); await text('a medias ·'); await click('Importar', '.tools.bottom button');
  await text('1 importadas', 30000); await text('Mal escaneo');
  const docs = Object.values(await idb('docs')), chunks = await idb('chunks');
  check(!Object.keys(await idb('imports')).length && docs.length === 3, 'reanuda y termina: ' + docs.length + ' partituras');
  check(docs.some((d) => d.blob === k0[0]), 'la reanudada conserva sus trozos');
  check(docs.every((d) => Object.keys(chunks).filter((k) => k.startsWith(d.blob + '/')).reduce((a, k) => a + chunks[k], 0) === d.size), 'cada PDF ocupa exactamente su tamaño');
  check(Object.values(await idb('folders')).map((f) => f.name).sort().join() === 'Guitarra,Sor', 'crea las subcarpetas del PC');
  await click('Importar desde el PC'); await text('0 elegidas');
  check(true, 'lo ya importado no se vuelve a ofrecer'); await click('‹ Volver');
  await shot('biblioteca');

  // --- lector
  const d1 = docs.find((d) => d.name === 'Mal escaneo');
  await click('Mal escaneo', '.item .tapable'); await page.waitForSelector('.viewer'); await at(1);
  for (let n = 2; n <= 5; n++) { await sleep(700); await tap(700); await at(n); await shot('mal-' + n); }
  check(true, 'un toque a la derecha avanza (5 páginas pesadas)');
  await tap(60); await at(4); check(true, 'un toque a la izquierda retrocede');
  await page.keyboard.press('PageDown'); await at(5); await sleep(200); await page.keyboard.press('ArrowLeft'); await at(4); await sleep(200);
  await page.keyboard.press('Space'); await at(5); check(true, 'teclas de pedal');
  await page.touchscreen.tap(384, 500); await sleep(150);
  check(await page.evaluate(() => document.querySelector('.bar').classList.contains('hidden')), 'el toque central oculta la barra');
  await page.touchscreen.tap(384, 500); await sleep(150);
  check(await page.evaluate(() => document.querySelectorAll('canvas').length <= 4), 'como mucho 4 lienzos vivos');
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.viewer'); await at(5);
  check(true, 'si la app se reinicia vuelve a la misma página');
  await click('Ir a…'); await click('Página 2', '.sheet button'); await at(2);

  // --- ajustes
  await click('Ajustes');
  const slide = (i, v) => page.evaluate((i, v) => { const x = document.querySelectorAll('.srow input')[i]; x.value = v; x.dispatchEvent(new Event('input')); }, i, v);
  await slide(0, 20); await sleep(700);
  check(/brightness\(1\.2\)/.test(await page.evaluate(() => document.querySelector('.page canvas').style.filter)), 'brillo con filtro CSS');
  const bg = () => page.evaluate(() => { const c = document.querySelector('.page canvas'), d = c.getContext('2d').getImageData(0, 0, 40, 40).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); });
  const b0 = await bg(); await slide(0, 0); await sleep(500); await slide(2, 70); await sleep(600); await at(2); await sleep(1500);
  let b1 = await bg(); for (let i = 0; i < 30 && b1 < 250; i++) { await sleep(300); b1 = await bg(); } check(b0 < 215 && b1 > 250, 'blanquear: fondo ' + Math.round(b0) + ' → ' + Math.round(b1)); await slide(3, 1.7); await sleep(900); await at(2); await sleep(800); await shot('ajustes');
  await click('Listo', '.panel button'); await sleep(300);
  check(Object.keys((await idb('docs'))[d1.id].adj.all).length === 2, 'los ajustes quedan guardados');

  // --- anotaciones y alineación con recorte y giro
  await click('✎ Anotar'); await sleep(5000);
  await drag([[300, 400], [350, 420], [400, 400], [450, 430]]);
  await page.evaluate(() => document.querySelectorAll('.abar .dot')[1].click()); await sleep(100);
  await page.evaluate(() => { const d = [...document.querySelectorAll('.abar .dot')]; d[9].click(); }); await sleep(100);
  await drag([[300, 600], [400, 640], [500, 600]]);
  await click('Resaltar', '.abar button'); await drag([[200, 500], [600, 500]]);
  await click('Texto', '.abar button'); await page.touchscreen.tap(400, 300); await page.waitForSelector('.modal input'); await fill('3 p'); await click('Poner'); await sleep(300);
  const notes = async () => (await idb('notes'))[d1.id + '/2'] || [];
  let N = await notes();
  check(N.length === 4 && N.map((n) => n.t).join() === 'pen,pen,mark,text', 'lápiz, resaltador y texto guardados');
  check(N[0].c !== N[1].c && N[0].w !== N[1].w, 'colores y tamaños distintos');
  await shot('anotaciones');
  await click('↶', '.abar button'); check((await notes()).length === 3, 'deshacer'); await click('↷', '.abar button'); check((await notes()).length === 4, 'rehacer');
  await click('Goma', '.abar button'); await drag([[400, 350], [400, 450]]); check((await notes()).length === 3, 'la goma borra el trazo tocado'); await click('↶', '.abar button');
  await tap(700); check(await page.evaluate(() => document.querySelector('.bar .grow').textContent.includes('2/5')), 'anotando, los toques no pasan página');
  await click('Listo', '.abar button'); await sleep(5000);
  // Centro de la tinta roja proyectado a la página: debe ser el mismo antes y después.
  const red = () => page.evaluate(() => { const c = document.querySelector('.over'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let x = 0, y = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 40 && d[i + 2] < 60 && d[i + 3] > 200) { const p = i / 4; x += p % c.width; y += Math.floor(p / c.width); n++; } return [x / n / c.width, y / n / c.height, n]; });
  const r0 = await red();
  await click('Ajustes'); await slide(3, 0); await sleep(5000);
  await click('Recortar márgenes'); await page.waitForSelector('.crop', { timeout: 15000 });
  const bx = await page.evaluate(() => { const r = document.querySelector('.hd-nw').getBoundingClientRect(); return [r.left + 24, r.top + 24]; });
  await drag([bx, [bx[0] + 50, bx[1] + 60], [bx[0] + 100, bx[1] + 120]]); await shot('recorte'); const rc = await red();
  await click('Aplicar recorte'); await text('Recorte aplicado'); await sleep(5000);
  const ad = (await idb('docs'))[d1.id].adj.all, r1 = await red();
  console.log('  --   ', JSON.stringify([r0, rc, r1, ad]));
  check(ad.x > 0.05 && ad.y > 0.05, 'recorte guardado ' + ad.x + ', ' + ad.y);
  check(r1[2] > 100 && Math.abs(ad.x + r1[0] * ad.w - rc[0]) < 0.006 && Math.abs(ad.y + r1[1] * ad.h - rc[1]) < 0.006, 'las anotaciones siguen en su sitio al recortar');
  await click('⟳ 90°'); await sleep(5000);
  const r2 = await red(), a2 = (await idb('docs'))[d1.id].adj.all; await shot('girada');
  check(a2.rot === 90 && Math.abs(r2[0] - (1 - r1[1])) < 0.006 && Math.abs(r2[1] - r1[0]) < 0.006, 'y al girar 90°');
  await click('⟲ 90°'); await sleep(900); await click('Listo', '.panel button');
  await click('☾'); await sleep(300); await shot('noche'); await click('☾');
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 2, hasTouch: true }); await sleep(1500);
  await click('Vista'); await click('Dos páginas', '.sheet button'); await sleep(5000);
  check(await page.evaluate(() => document.querySelectorAll('.spread .page').length === 2), 'dos páginas en horizontal'); await shot('dos');
  await click('Vista'); await click('Ajustar al ancho', '.sheet button'); await page.waitForFunction(() => document.querySelectorAll('.spread .page').length === 1 && document.querySelector('.page').clientHeight > 900, { timeout: 30000 }); await sleep(200);
  await tap(1000, 400); check(/-\d{2,}px/.test(await page.evaluate(() => document.querySelector('.spread').style.transform)), 'al ancho, el toque baja antes de pasar página');
  await click('Vista'); await click('Página entera', '.sheet button'); await sleep(1500);
  await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2, hasTouch: true }); await sleep(800);
  await click('‹ Salir'); await page.waitForSelector('.tabs');

  // --- organización
  await click('Nueva carpeta'); await fill('Piano'); await click('Crear');
  await click('Seleccionar'); await page.evaluate(() => [...document.querySelectorAll('.item')].find((x) => x.textContent.includes('Copia del')).querySelector('input').click()); await click('Mover', '.tools button'); await click('Piano', '.sheet button');
  const pid = Object.values(await idb('folders')).find((f) => f.name === 'Piano').id;
  check(Object.values(await idb('docs')).find((d) => d.name.startsWith('Copia')).folder === pid, 'mover a una carpeta');
  await page.evaluate(() => [...document.querySelectorAll('.item')].find((x) => x.textContent.includes('Mal esc')).querySelector('button').click()); await click('Editar nombre', '.sheet button'); await sleep(100);
  await fill('Tárrega', 1); await fill('examen, guitarra', 2); await click('Guardar');
  await page.evaluate(() => { const s = document.querySelector('.search'); s.value = 'tarrega EXAM'; s.dispatchEvent(new Event('input')); }); await text('1 resultado');
  check(true, 'busca sin tildes por compositor y etiqueta'); await shot('busqueda');
  await page.evaluate(() => { const s = document.querySelector('.search'); s.value = ''; s.dispatchEvent(new Event('input')); }); await sleep(400);
  await click('Conciertos', '.tab'); await click('Concierto nuevo'); await fill('Audición'); await fill('2026-12-20', 1); await fill('Auditorio', 2); await click('Crear'); await text('Añade obras');
  await click('Añadir obras'); await page.evaluate(() => document.querySelectorAll('.modal .item input').forEach((x) => x.click())); await click('Añadir', '.foot button'); await sleep(400);
  const items = async () => Object.values(await idb('concerts'))[0].items;
  const i0 = await items();
  const gp = await page.evaluate(() => [...document.querySelectorAll('.grip')].map((g) => { const r = g.getBoundingClientRect(); return [r.left + 20, r.top + 20]; }));
  await drag([gp[0], [gp[0][0], gp[1][1]], [gp[2][0], gp[2][1] + 5]]); await sleep(300);
  const i1 = await items(); check(i0.length === 3 && i1.join() === [i0[1], i0[2], i0[0]].join(), 'reordenar arrastrando'); await shot('concierto');
  await click('Modo concierto'); await page.waitForSelector('.viewer.concert'); await at(1);
  check(await page.evaluate(() => ![...document.querySelectorAll('button')].some((b) => /Anotar|Ajustes/.test(b.textContent))), 'modo concierto sin edición');
  for (let i = 0; i < 30; i++) { if (await page.evaluate(() => document.querySelector('.bar .grow').textContent.startsWith('2 de 3'))) break; await tap(720); await sleep(350); }
  await at(1); check(await page.evaluate(() => document.querySelector('.bar .grow').textContent.startsWith('2 de 3')), 'al acabar pasa a la siguiente obra');
  await tap(60); await sleep(800); check(await page.evaluate(() => document.querySelector('.bar .grow').textContent.startsWith('1 de 3')), 'y hacia atrás vuelve a la anterior');
  await page.touchscreen.tap(384, 500); await sleep(200); await click('‹ Salir'); await text('Modo concierto'); await click('‹ Conciertos');

  // --- copias
  await click('Copias y opciones', '.tab'); await sleep(300); await shot('opciones');
  await click('Copia completa'); await page.waitForFunction(() => [...document.querySelectorAll('.modal')].some((m) => /Copia guardada|Conectar con/.test(m.textContent)), { timeout: 60000 });
  if (await page.evaluate(() => /Conectar con/.test(document.body.textContent))) { await fill(code()); await click('Conectar'); await text('Copia guardada', 60000); }
  await click('Entendido');
  check(fs.readdirSync(path.join(tmp, 'copias/pdfs')).filter((n) => n.endsWith('.pdf')).length === 3, 'copia con PDFs en el PC, sin repetir iguales');
  const before = JSON.stringify([await idb('docs'), await idb('notes'), await idb('concerts'), await idb('folders')].map((o) => Object.keys(o).sort()));
  await page.evaluate(() => new Promise((ok) => { const r = indexedDB.open('atril'); r.onsuccess = () => { const t = r.result.transaction(['docs', 'chunks', 'notes', 'folders', 'concerts', 'meta'], 'readwrite'); ['docs', 'chunks', 'notes', 'folders', 'concerts', 'meta'].forEach((s) => t.objectStore(s).clear()); t.oncomplete = () => { r.result.close(); ok(); }; }; }));
  await page.reload({ waitUntil: 'load' }); await text('Todavía no hay partituras');
  await click('Copias y opciones', '.tab'); await click('Recuperar del PC'); await fill(code()); await click('Conectar'); await page.waitForSelector('.sheet button'); await page.evaluate(() => document.querySelector('.sheet button').click());
  await text('Restaurar copia'); await click('Restaurar', '.foot button'); await text('Copia restaurada', 60000); await shot('restaurada'); await click('Entendido');
  const after = JSON.stringify([await idb('docs'), await idb('notes'), await idb('concerts'), await idb('folders')].map((o) => Object.keys(o).sort()));
  console.log('  --   ' + before.length + ' / ' + after.length);
  check(before === after, 'borrado total y recuperación: todo igual');
  check(Object.values(await idb('docs')).every((d) => d.blob), 'con todos sus PDFs');
  const good = fs.readFileSync(path.join(tmp, 'copias', fs.readdirSync(path.join(tmp, 'copias')).find((n) => n.endsWith('.json'))), 'utf8');
  for (const [n, f] of [['__proto__', (j) => { j.docs[0].id = '__proto__'; }], ['nota fuera de rango', (j) => { const k = Object.keys(j.notes)[0]; j.notes[k][0].p[0] = 1e9; }], ['color con código', (j) => { const k = Object.keys(j.notes)[0]; j.notes[k][0].c = 'url(x)'; }], ['carpetas en bucle', (j) => { j.folders[0].parent = j.folders[0].id; }], ['tipo cambiado', (j) => { j.docs = {}; }], ['nombre objeto', (j) => { j.docs[0].name = { a: 1 }; }]]) {
    const j = JSON.parse(good); f(j);
    await click('Pegar una copia'); await page.evaluate((t) => { document.querySelector('textarea').value = t; }, JSON.stringify(j)); await click('Continuar'); await text('La copia no es válida', 5000); check(true, 'copia manipulada rechazada: ' + n);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  }

  // --- PDF modificado en el PC y archivos del iPad
  await click('Partituras', '.tab');
  fs.appendFileSync(path.join(tmp, 'partituras', 'Mal escaneo.pdf'), '\n% cambio\n');
  await click('Importar desde el PC'); await text('modificado'); await click('Seleccionar todo'); await click('Importar', '.tools.bottom button'); await click('Actualizar', '.foot button'); await text('1 importadas', 30000);
  const dm = (await idb('docs'))[d1.id], live = new Set(Object.values(await idb('docs')).map((d) => d.blob));
  check(dm.hash !== d1.hash && dm.composer === 'Tárrega' && (await notes()).length === 4, 'PDF modificado: se actualiza y conserva anotaciones y ajustes');
  check(Object.keys(await idb('chunks')).every((k) => live.has(k.split('/')[0])), 'no quedan trozos huérfanos');
  const up = async (f) => { const i = await page.$('input[type=file]'); await i.uploadFile(f); };
  await up(path.join(tmp, 'partituras', 'falso.pdf')); await text('no es un PDF'); await click('Entendido'); check(true, 'rechaza un archivo sin cabecera %PDF');
  await up(path.join(root, 'test/pdfs/limpio.pdf')); await text('ya estaba como'); await click('Entendido'); check(true, 'detecta duplicados del iPad');

  await click('Copias y opciones', '.tab'); await click('Diagnóstico');
  await page.waitForFunction(() => /Terminado/.test(document.body.textContent), { timeout: 120000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('.row')].map((r) => [r.className.includes('ok'), [...r.children].map((k) => k.textContent).join(' → ')]));
  for (const [ok, t] of rows) if (!ok && !/icono|AppCache/.test(t)) check(false, t);
  check(rows.filter((r) => /pág\./.test(r[1])).length === 9, 'diagnóstico: 9 páginas dibujadas');
  await click('‹ Volver');
  // --- sin servidor
  srv.kill(); await sleep(400);
  await click('Partituras', '.tab'); await click('Mal escaneo', '.item .tapable'); await at(1).catch(() => at(2)); check(true, 'con el servidor apagado se abre y se lee');
  await click('‹ Salir'); await page.waitForSelector('.tabs'); await click('Importar desde el PC'); await text('No encuentro el PC'); check(true, 'y al importar lo explica');
  check(!ext.length, 'ninguna petición fuera del servidor ' + ext.join(' '));
  const real = errs.filter((e) => !/favicon|status of 40|ERR_CONNECTION/.test(e));
  check(!real.length, 'consola sin errores ' + real.slice(0, 5).join(' | '));
} catch (e) { bad++; console.log(globalThis.__errs); console.log('FALLO ' + (e.stack || e)); }
finally { try { if (bad && browser) await (await browser.pages()).pop().screenshot({ path: path.join(shots, 'fallo.png') }); } catch { /* nada */ } if (browser) await browser.close(); srv.kill(); }
console.log(bad ? `\n${bad} fallo(s)` : '\nPruebas correctas');
process.exit(bad ? 1 : 0);
