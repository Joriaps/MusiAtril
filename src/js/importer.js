// Importación desde el PC (reanudable) y desde el selector de documentos del iPad.
import { h, clear, isPdf, mb, readFile } from './util.js';
import * as db from './db.js';
import { lib, list, create, change, docByHash, folderFor, usage } from './lib.js';
import { Sha256 } from './sha256.js';
import { pedir, confirmar, progreso, toast, oops, modal, elegir } from './ui.js';

let token = '';

export function connected() { return !!token; }

// Petición a la API del PC. o: {method, body, binary, abort(fn)}
export function api(path, o) {
  o = o || {};
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest();
    x.open(o.method || 'GET', 'api/' + path);
    x.responseType = o.binary ? 'arraybuffer' : 'text';
    x.timeout = o.timeout || 60000;
    if (token) x.setRequestHeader('X-Atril', token);
    x.onload = () => {
      if (x.status === 200) {
        if (o.binary) { ok(x.response); return; }
        try { ok(JSON.parse(x.responseText)); } catch (e) { ko(new Error('Respuesta no válida del PC')); }
        return;
      }
      if (x.status === 401) token = '';
      let m = '';
      try { m = JSON.parse(o.binary ? String.fromCharCode.apply(null, new Uint8Array(x.response)) : x.responseText).error; } catch (e) { /* sin detalle */ }
      const e = new Error(typeof m === 'string' && m ? m.slice(0, 300) : 'Error del PC (' + x.status + ')');
      e.status = x.status;
      ko(e);
    };
    x.onerror = x.ontimeout = () => { const e = new Error('No encuentro el PC. Enciende el servidor («npm run serve») y comprueba que el iPad está en la misma WiFi.'); e.offline = true; ko(e); };
    x.onabort = () => { const e = new Error('Cancelado'); e.cancelled = true; ko(e); };
    x.send(o.body || null);
    if (o.abort) o.abort(() => x.abort());
  });
}

// Pide el código si hace falta y ejecuta fn.
export function withPc(fn) {
  const go = token ? Promise.resolve(true) : pedir('Conectar con el PC', [{ k: 'c', label: 'Código de 6 cifras que sale en la ventana del PC', type: 'tel', max: 9 }], 'Conectar')
    .then((r) => r && api('entrar', { method: 'POST', body: JSON.stringify({ codigo: r.c.replace(/\D/g, '') }) }).then((t) => { token = String(t.token); return true; }));
  return go.then((y) => (y ? fn() : undefined)).catch((e) => {
    if (e.status === 401) { toast('El PC se ha reiniciado: hace falta un código nuevo.'); return withPc(fn); }
    throw e;
  });
}

const maxBytes = () => lib.prefs.maxMB * 1048576;
const cleanName = (n) => (n.replace(/\.pdf$/i, '').trim() || 'Sin nombre').slice(0, 200);

function checkItem(x) {
  return x && typeof x.id === 'string' && /^[0-9a-f]{32}$/.test(x.id) && typeof x.ruta === 'string' && x.ruta.length < 1000
    && typeof x.hash === 'string' && /^[0-9a-f]{64}$/.test(x.hash) && typeof x.tam === 'number' && x.tam > 0;
}

// Estado de un PDF del PC respecto a lo guardado.
function classify(x) {
  const docs = list('docs'), same = docByHash(x.hash);
  if (same && same.blob) return { st: same.src === x.ruta ? 'have' : 'dup', doc: same };
  if (same) return { st: 'fill', doc: same };
  const mod = docs.filter((d) => d.src === x.ruta)[0];
  if (mod) return { st: 'mod', doc: mod };
  return { st: 'new' };
}
const LABEL = { have: 'ya está', dup: 'duplicado', fill: 'falta el PDF', mod: 'modificado', new: 'nuevo' };

export function importScreen(root, folder, onExit) {
  return withPc(() => api('lista', { timeout: 600000 })).then((r) => {
    if (!r) return;
    const items = (Array.isArray(r.archivos) ? r.archivos : []).filter(checkItem).map((x) => Object.assign({ on: false }, x, classify(x)));
    return db.all('imports').then((l) => {
      l.forEach((p) => items.forEach((x) => { if (x.hash === p.hash && x.st !== 'have' && x.st !== 'dup') x.partial = p.got * db.CHUNK / p.size; }));
      draw(items, Array.isArray(r.avisos) ? r.avisos.slice(0, 50).map(String) : []);
    });
  });

  function draw(items, avisos) {
    const sub = h('input', { type: 'checkbox' }); sub.checked = true;
    const box = h('div', { class: 'rows scroll fillrows' }), sum = h('span', { class: 'grow' });
    const can = (x) => x.st !== 'have' && x.st !== 'dup' && x.tam <= maxBytes();
    const refresh = () => {
      const s = items.filter((x) => x.on);
      sum.textContent = s.length + ' elegidas · ' + mb(s.reduce((a, x) => a + x.tam, 0));
      items.forEach((x) => { x.cb.checked = x.on; });
    };
    const pick = (f) => { items.forEach((x) => { x.on = can(x) && f(x); }); refresh(); };
    items.forEach((x) => {
      x.cb = h('input', { type: 'checkbox', disabled: !can(x), onchange: () => { x.on = x.cb.checked; refresh(); } });
      box.appendChild(h('label', { class: 'item' + (can(x) ? '' : ' dim') }, x.cb,
        h('span', { class: 'grow' }, h('b', { text: x.ruta.split('/').pop() }), h('small', { text: x.ruta.split('/').slice(0, -1).join(' › ') || 'carpeta principal' })),
        h('span', { class: 'tag st-' + x.st, text: x.tam > maxBytes() ? 'supera el límite' : (x.partial ? 'a medias · ' + Math.round(x.partial * 100) + ' %' : LABEL[x.st]) }),
        h('span', { class: 'size', text: mb(x.tam) })));
    });
    if (!items.length) box.appendChild(h('p', { text: 'No hay PDFs en la carpeta del PC.' }));
    avisos.forEach((a) => box.appendChild(h('p', { class: 'warnline', text: '⚠ ' + a })));
    clear(root).appendChild(h('div', { class: 'screen col' },
      h('div', { class: 'head' }, h('button', { click: onExit }, '‹ Volver'), h('h1', { text: 'Importar desde el PC' })),
      h('div', { class: 'tools' },
        h('button', { click: () => pick(() => true) }, 'Seleccionar todo'), h('button', { click: () => pick((x) => x.st === 'new' || x.st === 'fill') }, 'Solo nuevos'),
        h('button', { click: () => pick(() => false) }, 'Ninguno'), h('label', { class: 'check' }, sub, 'Crear las subcarpetas')),
      box,
      h('div', { class: 'tools bottom' }, sum, h('button', { class: 'main', click: () => start(items.filter((x) => x.on), sub.checked) }, 'Importar'))));
    pick((x) => x.st === 'new' || x.st === 'fill');
  }

  function start(sel, mkdirs) {
    if (!sel.length) { toast('Elige al menos una partitura.'); return; }
    const mods = sel.filter((x) => x.st === 'mod').length;
    const q = mods ? confirmar('PDFs modificados', mods + ' partitura(s) han cambiado en el PC. Se sustituirá el PDF y se conservarán anotaciones y ajustes.', 'Actualizar') : Promise.resolve(true);
    q.then((y) => { if (y) run(sel, mkdirs); });
  }

  function run(sel, mkdirs) {
    let stop = false, abort = null, done = 0, good = 0, dups = 0, failed = 0;
    const total = sel.reduce((a, x) => a + x.tam, 0);
    const ui = progreso('Importando', () => { stop = true; if (abort) abort(); });
    const ctl = { stopped: () => stop, setAbort: (f) => { abort = f; } };
    let p = Promise.resolve();
    sel.forEach((x, n) => {
      p = p.then(() => {
        if (stop) return null;
        const name = x.ruta.split('/').pop();
        return one(x, folder, mkdirs, ctl, (b) => ui.set((done + b) / total, (n + 1) + ' de ' + sel.length + ' · ' + name)).then((r) => { if (r === 'dup') dups++; else good++; done += x.tam; }, (e) => {
          if (e.cancelled) { stop = true; return; }
          if (e.quota || e.offline || e.status === 401) throw e;
          failed++; done += x.tam;
          ui.log('✗ ' + name + ': ' + e.message);
        });
      });
    });
    p.then(() => null, (e) => e).then((e) => {
      ui.close();
      onExit();
      const t = good + ' importadas' + (dups ? ', ' + dups + ' duplicadas omitidas' : '') + (failed ? ', ' + failed + ' con error' : '') + (stop ? '. Cancelado: lo que quedó a medias se reanudará al volver a importarlo.' : '.');
      if (e) modal('Importación interrumpida', h('div', null, h('p', { text: e.message }), h('p', { text: t }), h('p', { text: 'Puedes repetirla: continúa donde se quedó.' })), [{ text: 'Entendido', class: 'main', fn: () => null }]);
      else toast(t, true);
    });
  }
}

// Descarga un PDF por trozos; cada trozo queda guardado junto con su contador.
function one(x, folder, mkdirs, ctl, onBytes) {
  const n = Math.ceil(x.tam / db.CHUNK), sha = new Sha256();
  // Otro archivo idéntico puede haber entrado en esta misma tanda.
  const st0 = classify(x).st;
  if (st0 === 'have' || st0 === 'dup') return Promise.resolve('dup');
  return db.all('imports').then((l) => {
    const old = l.filter((i) => i.hash === x.hash && i.size === x.tam)[0];
    const rec = old || { blob: db.newId(), hash: x.hash, size: x.tam, got: 0, name: x.ruta.split('/').pop().slice(0, 200) };
    let i = 0;
    const stopped = () => { const e = new Error('Cancelado'); e.cancelled = true; return e; };
    const rehash = () => {
      if (i >= rec.got) return Promise.resolve();
      if (ctl.stopped()) return Promise.reject(stopped());
      return db.readChunk(rec.blob, i).then((b) => { sha.update(b); i++; onBytes(Math.min(x.tam, i * db.CHUNK)); return rehash(); }, () => { rec.got = i; });
    };
    const next = () => {
      if (i >= n) return Promise.resolve();
      if (ctl.stopped()) return Promise.reject(stopped());
      const want = Math.min(db.CHUNK, x.tam - i * db.CHUNK);
      return api('pdf?id=' + x.id + '&desde=' + i * db.CHUNK + '&cuanto=' + want, { binary: true, abort: ctl.setAbort }).then((b) => {
        if (b.byteLength !== want) throw new Error('el PC ha enviado un trozo incompleto');
        if (i === 0 && !isPdf(b)) throw new Error('no es un PDF');
        sha.update(b);
        const upd = Object.assign({}, rec, { got: i + 1 });
        return db.tx(['chunks', 'imports'], 'readwrite', (s) => { s.chunks.put(b, db.chunkKey(rec.blob, i)); s.imports.put(upd, rec.blob); }).then(() => {
          rec.got = ++i;
          onBytes(Math.min(x.tam, i * db.CHUNK));
          return next();
        });
      });
    };
    return rehash().then(next).then(() => {
      if (sha.hex() !== x.hash) return discard(rec).then(() => { throw new Error('ha llegado dañado; vuelve a importarlo'); });
      const cur = classify(x);
      const parts = x.ruta.split('/');
      const where = mkdirs && cur.st === 'new' ? folderFor(parts.slice(0, -1), folder) : Promise.resolve(folder);
      return where.then((f) => commit(rec, { name: cleanName(parts[parts.length - 1]), src: x.ruta, folder: f }, cur.doc));
    });
  });
}

export function discard(rec) {
  return db.tx(['chunks', 'imports'], 'readwrite', (s) => { s.chunks.delete(db.prefix(rec.blob)); s.imports.delete(rec.blob); });
}

// Todo o nada: la ficha apunta al PDF nuevo y el viejo se borra en la misma transacción.
function commit(rec, info, old) {
  const doc = old ? Object.assign({}, old, { blob: rec.blob, size: rec.size, hash: rec.hash, src: info.src || old.src, pages: 0 })
    : { id: db.newId(), name: info.name, composer: '', folder: info.folder || '', tags: [], src: info.src || '', size: rec.size, hash: rec.hash, blob: rec.blob, pages: 0, page: 1, added: Date.now(), opened: 0, adj: {} };
  return db.tx(['docs', 'chunks', 'imports'], 'readwrite', (s) => {
    s.docs.put(doc, doc.id);
    s.imports.delete(rec.blob);
    if (old && old.blob && old.blob !== rec.blob) s.chunks.delete(db.prefix(old.blob));
  }).then(() => { lib.docs[doc.id] = doc; return doc; });
}

// --- «Añadir desde el iPad»
export function addFiles(files, folder) {
  let stop = false, good = 0;
  const l = [].slice.call(files), notes = [];
  const ui = progreso('Añadiendo', () => { stop = true; });
  let p = Promise.resolve();
  l.forEach((f, n) => {
    p = p.then(() => (stop ? null : oneFile(f, folder, () => stop, (b) => ui.set(b / f.size, (n + 1) + ' de ' + l.length + ' · ' + f.name))
      .then((m) => { if (m) notes.push(f.name + ': ' + m); else good++; }, (e) => {
        if (e.quota) throw e;
        if (!e.cancelled) notes.push(f.name + ': ' + e.message);
      })));
  });
  return p.then(() => null, (e) => { notes.push(e.message); }).then(() => {
    ui.close();
    if (notes.length) modal(good + ' añadidas', h('div', null, ...notes.map((t) => h('p', { text: t }))), [{ text: 'Entendido', class: 'main', fn: () => null }]);
    else toast(good + (good === 1 ? ' partitura añadida.' : ' partituras añadidas.'));
  });
}

function oneFile(file, folder, stopped, onBytes) {
  if (file.size > maxBytes()) return Promise.reject(new Error('ocupa ' + mb(file.size) + ' y el máximo es ' + lib.prefs.maxMB + ' MB'));
  if (!file.size) return Promise.reject(new Error('está vacío'));
  const sha = new Sha256(), rec = { blob: db.newId(), size: file.size, hash: '', got: 0, name: file.name.slice(0, 200), local: 1 };
  const n = Math.ceil(file.size / db.CHUNK);
  const step = (i) => {
    if (i >= n) return Promise.resolve();
    if (stopped()) { const e = new Error('Cancelado'); e.cancelled = true; return Promise.reject(e); }
    return readFile(file.slice(i * db.CHUNK, (i + 1) * db.CHUNK)).then((b) => {
      if (i === 0 && !isPdf(b)) throw new Error('no es un PDF');
      sha.update(b);
      const upd = Object.assign({}, rec, { got: i + 1 });
      return db.tx(['chunks', 'imports'], 'readwrite', (s) => { s.chunks.put(b, db.chunkKey(rec.blob, i)); s.imports.put(upd, rec.blob); });
    }).then(() => { onBytes(Math.min(file.size, (i + 1) * db.CHUNK)); return step(i + 1); });
  };
  return step(0).then(() => {
    rec.hash = sha.hex();
    const same = docByHash(rec.hash);
    if (same && same.blob) return discard(rec).then(() => 'ya estaba como «' + same.name + '»');
    const name = cleanName(file.name);
    if (same) return commit(rec, { name }, same).then(() => '');
    const twin = list('docs').filter((d) => d.name === name)[0];
    if (!twin) return commit(rec, { name, folder }).then(() => '');
    return elegir('Ya hay otra «' + name + '» con distinto contenido', [{ v: 'u', text: 'Actualizar su PDF y conservar anotaciones y ajustes' }, { v: 'n', text: 'Añadir como partitura nueva' }, { v: '', text: 'No añadir' }]).then((v) => {
      if (v === 'u') return commit(rec, {}, twin).then(() => '');
      if (v === 'n') return commit(rec, { name, folder }).then(() => '');
      return discard(rec).then(() => 'no se ha añadido');
    });
  }).catch((e) => discard(rec).then(() => { throw e; }, () => { throw e; }));
}

// Restos de «Añadir desde el iPad» cortados: esos no se pueden reanudar.
export function sweep() {
  return db.all('imports').then((l) => l.filter((r) => r.local).reduce((p, r) => p.then(() => discard(r)), Promise.resolve()));
}

// Para restaurar copias: guarda un PDF que llega a trozos de una función read(desde, cuanto).
export function storePdf(doc, read, ctl) {
  const rec = { blob: db.newId(), hash: doc.hash, size: doc.size, got: 0, name: doc.name, local: 1 }, sha = new Sha256(), n = Math.ceil(doc.size / db.CHUNK);
  const step = (i) => {
    if (i >= n) return Promise.resolve();
    if (ctl.stopped()) { const e = new Error('Cancelado'); e.cancelled = true; return Promise.reject(e); }
    const want = Math.min(db.CHUNK, doc.size - i * db.CHUNK);
    return read(i * db.CHUNK, want).then((b) => {
      if (b.byteLength !== want || (i === 0 && !isPdf(b))) throw new Error('el PDF de la copia no es válido');
      sha.update(b);
      const upd = Object.assign({}, rec, { got: i + 1 });
      return db.tx(['chunks', 'imports'], 'readwrite', (s) => { s.chunks.put(b, db.chunkKey(rec.blob, i)); s.imports.put(upd, rec.blob); });
    }).then(() => step(i + 1));
  };
  return step(0).then(() => {
    if (sha.hex() !== doc.hash) throw new Error('el PDF de la copia está dañado');
    return commit(rec, {}, doc);
  }).catch((e) => discard(rec).then(() => { throw e; }, () => { throw e; }));
}
export { usage, change, oops };
