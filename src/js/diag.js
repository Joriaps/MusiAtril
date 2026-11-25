// Diagnóstico de la fase 1: dice en el propio iPad qué funciona antes de construir encima.
import { getBuffer, mb, now } from './util.js';
import { openData, realWorker } from './engine.js';
import { DEFAULTS } from './geometry.js';

const DB = 'atril-diagnostico';
const CHUNK = 1048576;

function idb(chunks) {
  return new Promise((ok, ko) => {
    const kill = indexedDB.deleteDatabase(DB);
    kill.onblocked = () => ko(new Error('base de datos bloqueada: cierra otras pestañas de Atril'));
    kill.onsuccess = kill.onerror = () => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('t');
      r.onerror = () => ko(r.error || new Error('IndexedDB no disponible'));
      r.onsuccess = () => {
        const db = r.result, start = now();
        let i = 0;
        const fail = (e) => { db.close(); indexedDB.deleteDatabase(DB); ko(e || new Error('error de IndexedDB')); };
        const write = () => {
          if (i === chunks) { read(); return; }
          const b = new Uint8Array(CHUNK);
          b[0] = i; b[CHUNK - 1] = 255 - i;
          const tx = db.transaction('t', 'readwrite');
          tx.objectStore('t').put(b.buffer, i);
          tx.oncomplete = () => { i++; write(); };
          tx.onabort = tx.onerror = () => fail(tx.error);
        };
        const read = () => {
          const mid = now();
          const g = db.transaction('t').objectStore('t').get(chunks - 1);
          g.onerror = () => fail(g.error);
          g.onsuccess = () => {
            const b = new Uint8Array(g.result || 0);
            const good = b.length === CHUNK && b[0] === chunks - 1 && b[CHUNK - 1] === 255 - (chunks - 1);
            db.close();
            indexedDB.deleteDatabase(DB);
            if (good) ok(chunks + ' MB escritos en ' + Math.round(mid - start) + ' ms y releídos bien');
            else ko(new Error('lo leído no coincide con lo escrito'));
          };
        };
        write();
      };
    };
  });
}

function canvasTest() {
  const c = document.createElement('canvas');
  c.width = 3508; c.height = 2480;
  const x = c.getContext('2d');
  x.fillStyle = '#f00';
  x.fillRect(3500, 2470, 8, 10);
  const d = x.getImageData(3505, 2475, 1, 1).data;
  const ok = d[0] === 255;
  c.width = 0; c.height = 0;
  if (!ok) throw new Error('un lienzo de 8,7 Mpx sale vacío');
  return 'lienzo de 8,7 Mpx correcto';
}

// Proporción de tinta y de fondo: detecta páginas en blanco o negras.
function inspect(c) {
  const s = document.createElement('canvas');
  s.width = 200; s.height = 280;
  const x = s.getContext('2d');
  x.drawImage(c, 0, 0, 200, 280);
  const d = x.getImageData(0, 0, 200, 280).data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
  s.width = 0; s.height = 0;
  if (hi - lo < 60) throw new Error('la página sale lisa (' + lo + '–' + hi + ')');
}

function pdfTest(url, add) {
  return getBuffer(url).then((b) => openData(b)).then((doc) => {
    let p = Promise.resolve();
    for (let n = 1; n <= doc.pages; n++) {
      p = p.then(() => {
        const t = now();
        return doc.render(n, { w: 768, h: 1024, fit: 'page', adj: DEFAULTS }).then((r) => {
          const c = r.canvas;
          const dim = c.width + '×' + c.height;
          const ms = Math.round(now() - t);
          try { inspect(c); } finally { c.width = 0; c.height = 0; }
          add(url + ' pág. ' + n, true, ms + ' ms, ' + dim);
        });
      }).catch((e) => add(url + ' pág. ' + n, false, e && e.message || String(e)));
    }
    return p.then(() => doc.close());
  }).catch((e) => add(url, false, e && e.message || String(e)));
}

export function runDiagnostics(add) {
  const step = (name, fn) => Promise.resolve().then(fn).then((t) => add(name, true, t), (e) => add(name, false, e && e.message || String(e)));
  const c = window.applicationCache;
  add('Versión', true, __VERSION__ + ' · PDF.js ' + __PDFJS__);
  add('Navegador', true, navigator.userAgent);
  add('Pantalla', true, window.innerWidth + '×' + window.innerHeight + ' ×' + (window.devicePixelRatio || 1));
  add('Abierta desde el icono', !!navigator.standalone, navigator.standalone ? 'sí' : 'no (estás en el navegador)');
  if (__WEB__) {
    const sw = navigator.serviceWorker;
    add('Sin conexión (service worker)', !!(sw && sw.controller), !sw ? 'no existe' : sw.controller ? 'guardada' : 'sin guardar');
  } else add('AppCache', !!c && c.status !== 0, c ? ['sin guardar', 'guardada', 'comprobando', 'descargando', 'versión nueva lista', 'obsoleta'][c.status] : 'no existe');
  return step('Worker de PDF.js', () => realWorker().then((r) => { if (!r) throw new Error('modo sin worker: funciona, pero más lento'); return 'hilo aparte'; }))
    .then(() => step('Canvas', canvasTest))
    .then(() => step('IndexedDB', () => idb(30)))
    .then(() => step('Lectura de archivos', () => {
      if (!window.FileReader) throw new Error('sin FileReader');
      const b = new Blob([new Uint8Array(CHUNK)]);
      return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(mb(r.result.byteLength)); r.onerror = ko; r.readAsArrayBuffer(b); });
    }))
    .then(() => pdfTest('prueba/limpio.pdf', add))
    .then(() => pdfTest('prueba/mal-escaneo.pdf', add));
}
