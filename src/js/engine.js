import { geometry, whiten } from './geometry.js';
import { CHUNK, readChunk } from './db.js';
// Única puerta a PDF.js: todas las opciones de seguridad y memoria se fijan aquí.
const lib = window.pdfjsLib;
lib.GlobalWorkerOptions.workerSrc = 'pdf.worker.js';

// Tope de píxeles por lienzo (iPad 4: 1536×2048 = 3,1 Mpx).
export const MAX_PIXELS = 3300000;

let worker = null;
function getWorker() {
  if (!worker || worker.destroyed) worker = new lib.PDFWorker({ name: 'atril' });
  return worker;
}

// true = hilo aparte; false = PDF.js ha caído al modo sin worker (más lento).
export function realWorker() {
  const w = getWorker();
  return w.promise.then(() => !!w._webWorker);
}

// El cierre anterior debe terminar antes de abrir otro PDF, para no sumar memoria.
let closing = Promise.resolve();

const OPTS = { isEvalSupported: false, disableFontFace: true, enableXfa: false, stopAtErrors: false, fontExtraProperties: false, verbosity: 0 };

function start(src) {
  const task = lib.getDocument(Object.assign({ worker: getWorker() }, OPTS, src));
  return task.promise.then((pdf) => new Doc(pdf, task));
}

export function openData(buffer) {
  return start({ data: new Uint8Array(buffer) });
}

// Lee de IndexedDB solo los trozos que cada página necesita.
export function openStored(doc) {
  let fail = null;
  const failed = new Promise((ok, ko) => { fail = ko; });
  failed.catch(() => null);
  const range = new lib.PDFDataRangeTransport(doc.size, null);
  range.requestDataRange = (begin, end) => {
    const out = new Uint8Array(end - begin);
    const next = (i) => {
      if (i * CHUNK >= end) { range.onDataRange(begin, out); return null; }
      return readChunk(doc.blob, i).then((b) => {
        const from = Math.max(begin, i * CHUNK), to = Math.min(end, i * CHUNK + b.byteLength);
        if (to > from) out.set(new Uint8Array(b, from - i * CHUNK, to - from), from - begin);
        return next(i + 1);
      });
    };
    next(Math.floor(begin / CHUNK)).catch((e) => { fail(e); });
  };
  const p = closing.then(() => start({ range, length: doc.size, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144 })).then((d) => { d.failed = failed; return d; });
  return Promise.race([p, failed]);
}

class Doc {
  constructor(pdf, task) {
    this.pdf = pdf;
    this.task = task;
    this.pages = pdf.numPages;
    this.chain = Promise.resolve();
    this.current = null;
    this.closed = false;
    this.painted = 0;
  }

  // Dibuja una página en un lienzo nuevo. Se dibuja de una en una para no duplicar el
  // pico de memoria. wanted() permite saltarse trabajos que ya no hacen falta.
  // spec: {w, h, fit, adj}. Devuelve {canvas, geo}.
  render(num, spec, wanted) {
    // Lo que ya no interesa se corta para no hacer esperar a la página pedida.
    if (this.current && this.stale && this.stale()) this.current.cancel();
    const job = () => {
      if (this.closed || (wanted && !wanted())) return null;
      return this.pdf.getPage(num).then((page) => this.paint(page, spec, wanted));
    };
    const p = this.chain.then(job, job);
    if (this.failed) return this.guard(p);
    this.chain = p.catch(() => null);
    return p;
  }

  // Si falta un trozo del PDF, PDF.js esperaría para siempre.
  guard(p) {
    const q = Promise.race([p, this.failed]);
    this.chain = q.catch(() => null);
    return q;
  }

  paint(page, spec, wanted) {
    const done = () => { try { page.cleanup(); } catch (e) { /* aún en uso */ } };
    if (this.closed || (wanted && !wanted())) { done(); return null; }
    const view = page.getViewport({ scale: 1 });
    const adj = spec.adj, geo = geometry(view.width, view.height, adj, spec.w, spec.h, spec.fit);
    let k = Math.min(window.devicePixelRatio || 1, 2);
    k = Math.min(k, Math.sqrt((spec.max || MAX_PIXELS) / (geo.cssW * geo.cssH)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(geo.cssW * k));
    canvas.height = Math.max(1, Math.floor(geo.cssH * k));
    canvas.style.width = geo.cssW + 'px';
    canvas.style.height = geo.cssH + 'px';
    this.stale = wanted && (() => !wanted());
    this.current = page.render({
      canvasContext: canvas.getContext('2d', { alpha: false }),
      viewport: view,
      transform: geo.m.map((v) => v * k),
      renderInteractiveForms: false,
    });
    return this.current.promise.then(() => {
      this.current = null;
      done();
      // Las fuentes se acumulan en el worker en obras largas.
      const post = ++this.painted % 15 === 0 && !this.closed ? this.pdf.cleanup().catch(() => null) : Promise.resolve();
      return post.then(() => whiten(canvas, adj, wanted)).then((c) => c && { canvas: c, geo }, (e) => { canvas.width = 0; canvas.height = 0; throw e; });
    }, (e) => {
      this.current = null;
      canvas.width = 0; canvas.height = 0;
      done();
      throw e;
    });
  }

  close() {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    if (this.current) this.current.cancel();
    const w = getWorker();
    const end = this.chain.then(() => this.task.destroy()).catch(() => null);
    // Si el worker sigue ocupado con una página enorme, se corta y se usará uno nuevo.
    const late = new Promise((ok) => setTimeout(ok, 2500, 'late'));
    closing = Promise.race([end, late]).then((r) => { if (r === 'late') { try { w.destroy(); } catch (e) { /* ya cerrado */ } } });
    return closing;
  }
}
