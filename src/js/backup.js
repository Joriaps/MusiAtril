// Copias: se valida todo contra un esquema cerrado antes de escribir nada.
import * as db from './db.js';
import { lib, list, load, docByHash } from './lib.js';
import { api, storePdf } from './importer.js';
import { DEFAULTS } from './geometry.js';
import { MAX_ITEMS, MAX_POINTS } from './notes.js';

export const MAX_JSON = 20 * 1048576;

export function build() {
  return db.tx(['docs', 'folders', 'concerts', 'notes'], 'readonly', (s, set) => {
    const o = { formato: 'atril-copia', version: 1, fecha: new Date().toISOString(), docs: [], folders: [], concerts: [], notes: {} };
    db.each(s.docs, null, (k, v) => { const d = Object.assign({}, v); delete d.blob; o.docs.push(d); });
    db.each(s.folders, null, (k, v) => o.folders.push(v));
    db.each(s.concerts, null, (k, v) => o.concerts.push(v));
    db.each(s.notes, null, (k, v) => { o.notes[k] = v; });
    set(o);
  });
}

// --- esquema. Cada función devuelve el valor limpio o lanza.
const bad = (w) => { throw new Error('La copia no es válida (' + w + ').'); };
const ID = /^[a-z0-9]{6,40}$/, HASH = /^[0-9a-f]{64}$/, COLOR = /^#[0-9a-f]{6}$/;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const obj = (o, w) => (isObj(o) ? o : bad(w));
const arr = (a, n, w) => (Array.isArray(a) && a.length <= n ? a : bad(w));
const str = (s, n, w) => (typeof s === 'string' && s.length <= n ? s : bad(w));
const num = (v, a, b, w) => (typeof v === 'number' && v >= a && v <= b ? v : bad(w));
const int = (v, a, b, w) => (num(v, a, b, w) % 1 === 0 ? v : bad(w));
const id = (s, w) => (ID.test(str(s, 40, w)) ? s : bad(w));
const ref = (s, w) => (s === '' ? '' : id(s, w));
const uniq = (l, w) => { const m = Object.create(null); l.forEach((x) => { if (m[x.id]) bad(w + ' repetida'); m[x.id] = x; }); return m; };

const RANGE = { b: [-60, 60], c: [-60, 100], wh: [0, 100], g: [0, 1], i: [0, 1], rot: [0, 270], skew: [-5, 5], x: [0, 0.9], y: [0, 0.9], w: [0.1, 1], h: [0.1, 1] };
function adj1(a) {
  const o = {};
  obj(a, 'ajustes');
  Object.keys(DEFAULTS).forEach((k) => { if (a[k] !== undefined) o[k] = num(Math.abs(a[k]) < 1e-9 ? 0 : a[k], RANGE[k][0], RANGE[k][1], 'ajuste ' + k); });
  if (o.rot && o.rot % 90) bad('giro');
  if ((o.x || 0) + (o.w === undefined ? 1 : o.w) > 1.001 || (o.y || 0) + (o.h === undefined ? 1 : o.h) > 1.001) bad('recorte');
  return o;
}
function adjs(a) {
  if (a === undefined) return {};
  obj(a, 'ajustes');
  const o = {};
  if (a.all !== undefined) o.all = adj1(a.all);
  if (a.pages !== undefined) {
    const ks = Object.keys(obj(a.pages, 'ajustes'));
    if (ks.length > 5000) bad('ajustes');
    o.pages = {};
    ks.forEach((k) => { if (!/^[1-9]\d{0,4}$/.test(k)) bad('página'); o.pages[k] = adj1(a.pages[k]); });
  }
  return o;
}
function doc(d) {
  obj(d, 'partitura');
  return {
    id: id(d.id, 'partitura'), name: str(d.name, 200, 'nombre') || 'Sin nombre', composer: str(d.composer, 120, 'compositor'), folder: ref(d.folder, 'carpeta'),
    tags: arr(d.tags, 20, 'etiquetas').map((t) => str(t, 40, 'etiqueta')), src: str(d.src, 1000, 'origen'), size: int(d.size, 1, 300 * 1048576, 'tamaño'),
    hash: HASH.test(str(d.hash, 64, 'huella')) ? d.hash : bad('huella'), pages: int(d.pages, 0, 99999, 'páginas'), page: int(d.page, 1, 99999, 'página'),
    added: num(d.added, 0, 1e14, 'fecha'), opened: num(d.opened, 0, 1e14, 'fecha'), adj: adjs(d.adj),
  };
}
function item(n) {
  obj(n, 'anotación');
  if (['pen', 'mark', 'text'].indexOf(n.t) < 0) bad('anotación');
  const p = arr(n.p, MAX_POINTS * 2 + 2, 'trazo');
  if (p.length < 2 || p.length % 2 || (n.t === 'text' && p.length !== 2)) bad('trazo');
  p.forEach((v) => num(v, -0.3, 1.3, 'trazo'));
  const o = { t: n.t, c: COLOR.test(str(n.c, 7, 'color')) ? n.c : bad('color'), w: num(n.w, 0.0005, 0.2, 'grosor'), p: p.slice() };
  if (n.t === 'text') o.s = str(n.s, 60, 'texto');
  return o;
}

export function validate(text) {
  if (typeof text !== 'string' || text.length > MAX_JSON) bad('demasiado grande');
  let j;
  try { j = JSON.parse(text); } catch (e) { bad('no es un archivo de copia'); }
  obj(j, 'formato');
  if (j.formato !== 'atril-copia' || j.version !== 1) bad('formato o versión');
  const o = {
    docs: arr(j.docs, 20000, 'partituras').map(doc),
    folders: arr(j.folders, 5000, 'carpetas').map((f) => { obj(f, 'carpeta'); return { id: id(f.id, 'carpeta'), name: str(f.name, 120, 'carpeta'), parent: ref(f.parent, 'carpeta') }; }),
    concerts: arr(j.concerts, 2000, 'conciertos').map((c) => {
      obj(c, 'concierto');
      const date = str(c.date, 10, 'fecha');
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) bad('fecha');
      return { id: id(c.id, 'concierto'), name: str(c.name, 120, 'concierto'), date, place: str(c.place, 120, 'lugar'), items: arr(c.items, 2000, 'obras').map((x) => id(x, 'obra')) };
    }),
    notes: [],
  };
  const docs = uniq(o.docs, 'partitura'), fs = uniq(o.folders, 'carpeta');
  uniq(o.concerts, 'concierto');
  const hs = Object.create(null);
  o.docs.forEach((d) => { if (hs[d.hash]) bad('PDF repetido'); hs[d.hash] = 1; if (d.folder && !fs[d.folder]) d.folder = ''; });
  o.folders.forEach((f) => {
    if (f.parent && !fs[f.parent]) f.parent = '';
    let n = 0;
    for (let x = f; x && x.parent; x = fs[x.parent]) if (++n > 50) bad('carpetas en bucle');
  });
  o.concerts.forEach((c) => { c.items = c.items.filter((x) => docs[x]); });
  let points = 0;
  const keys = Object.keys(obj(j.notes, 'anotaciones'));
  if (keys.length > 50000) bad('anotaciones');
  keys.forEach((k) => {
    const m = /^([a-z0-9]{6,40})\/([1-9]\d{0,4})$/.exec(k);
    if (!m) bad('anotaciones');
    const l = arr(j.notes[k], MAX_ITEMS, 'anotaciones').map(item);
    l.forEach((n) => { points += n.p.length; });
    if (points > 3000000) bad('demasiadas anotaciones');
    if (docs[m[1]] && l.length) o.notes.push({ id: m[1], page: m[2], l });
  });
  return o;
}

// Une la copia con lo que hay: lo de la copia manda, lo demás se conserva.
export function restore(o) {
  const map = Object.create(null), puts = [], local = list('docs');
  const hashes = Object.create(null);
  o.docs.forEach((d) => { hashes[d.hash] = 1; });
  o.docs.forEach((d) => {
    // Una ficha local solo puede recibir una de la copia: gana la del mismo PDF.
    const same = docByHash(d.hash), at = same ? null : lib.docs[d.id];
    const mine = at && !hashes[at.hash] ? at : null;
    // La misma partitura con otro PDF más nuevo en el iPad: se conserva su PDF.
    const keep = same || mine;
    const nid = same ? same.id : at && !mine ? db.newId() : d.id;
    map[d.id] = nid;
    puts.push(Object.assign({}, d, { id: nid }, keep ? { blob: keep.blob, hash: keep.hash, size: keep.size, pages: keep.pages } : { blob: '' }));
  });
  // Un bucle también podría salir de mezclar carpetas de aquí y de la copia.
  const merged = Object.assign({}, lib.folders);
  o.folders.forEach((f) => { merged[f.id] = f; });
  o.folders.forEach((f) => { let n = 0; for (let x = f; x && x.parent; x = merged[x.parent]) if (++n > 100) { f.parent = ''; break; } });
  return db.tx(['docs', 'folders', 'concerts', 'notes'], 'readwrite', (s) => {
    // Se sustituyen solo las páginas que trae la copia: lo anotado en otras se conserva.
    puts.forEach((d) => s.docs.put(d, d.id));
    o.folders.forEach((f) => s.folders.put(f, f.id));
    o.concerts.forEach((c) => s.concerts.put(Object.assign({}, c, { items: c.items.map((x) => map[x]) }), c.id));
    o.notes.forEach((n) => s.notes.put(n.l, map[n.id] + '/' + n.page));
  }).then(load).then(() => ({ docs: puts.length, missing: list('docs').filter((d) => !d.blob), had: local.length }));
}

const chunksOf = (d) => Math.ceil(d.size / db.CHUNK);
const cancelled = () => { const e = new Error('Cancelado'); e.cancelled = true; return e; };

// Envía la ficha y, si se pide, los PDFs que el PC aún no tenga.
export function sendToPc(withPdfs, ctl, onStep) {
  return build().then((o) => {
    const body = JSON.stringify(o);
    return api('copia', { method: 'POST', body, timeout: 120000 }).then((r) => {
      const docs = withPdfs ? list('docs').filter((d) => d.blob) : [], errs = [];
      let p = Promise.resolve();
      docs.forEach((d, n) => {
        p = p.then(() => {
          if (ctl.stopped()) throw cancelled();
          onStep(n / docs.length, 'PDF ' + (n + 1) + ' de ' + docs.length + ' · ' + d.name);
          return api('copia-estado?hash=' + d.hash).then((e) => {
            if (e.completo) return null;
            const from = Math.min(Math.floor((Number(e.tam) || 0) / db.CHUNK), chunksOf(d) - 1) * db.CHUNK;
            const next = (i) => {
              if (i >= chunksOf(d)) return null;
              if (ctl.stopped()) throw cancelled();
              return db.readChunk(d.blob, i).then((b) => api('copia-pdf?hash=' + d.hash + '&desde=' + i * db.CHUNK + '&total=' + d.size, { method: 'POST', body: b }))
                .then(() => { onStep((n + (i + 1) / chunksOf(d)) / docs.length); return next(i + 1); });
            };
            return next(from / db.CHUNK);
          }).catch((e) => { if (e.cancelled || e.offline || e.status === 401 || e.status === 507) throw e; errs.push(d.name + ': ' + e.message); });
        });
      });
      return p.then(() => ({ nombre: r.nombre, pdfs: docs.length - errs.length, errs }));
    });
  });
}

export function pcBackups() {
  return api('copias').then((r) => (Array.isArray(r.copias) ? r.copias : []).filter((c) => c && typeof c.nombre === 'string' && /^copia-[\d-]+\.json$/.test(c.nombre) && typeof c.tam === 'number'));
}
export function fetchBackup(name) {
  return api('copia?nombre=' + encodeURIComponent(name), { text: true, binary: true, timeout: 120000 }).then(utf8);
}
// Sin TextDecoder en Safari 10.
export function utf8(buf) {
  return new Promise((ok, ko) => {
    if (buf.byteLength > MAX_JSON) { ko(new Error('La copia es demasiado grande.')); return; }
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => ko(new Error('No se puede leer la copia.'));
    r.readAsText(new Blob([buf]), 'utf-8');
  });
}

export function fetchMissing(docs, ctl, onStep) {
  const errs = [];
  let p = Promise.resolve(), got = 0;
  docs.forEach((d, n) => {
    p = p.then(() => {
      if (ctl.stopped()) throw cancelled();
      onStep(n / docs.length, 'PDF ' + (n + 1) + ' de ' + docs.length + ' · ' + d.name);
      return storePdf(d, (from, len) => api('copia-pdf?hash=' + d.hash + '&desde=' + from + '&cuanto=' + len, { binary: true }), ctl)
        .then(() => { got++; }).catch((e) => { if (e.cancelled || e.offline || e.quota || e.status === 401) throw e; errs.push(d.name + ': ' + e.message); });
    });
  });
  return p.then(() => ({ got, errs }));
}
