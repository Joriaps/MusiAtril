// Biblioteca en memoria (fichas pequeñas) + guardado. Los PDFs nunca pasan por aquí enteros.
import * as db from './db.js';

export const lib = { docs: {}, folders: {}, concerts: {}, prefs: {} };
// hints: veces que el lector ha enseñado dónde tocar (se deja de enseñar a la tercera).
const PREFS = { sort: 'name', fit: 'page', night: 0, maxMB: 300, pen: null, hand: 'finger', radius: 0, backup: 0, hints: 0 };

export function load() {
  return db.tx(['docs', 'folders', 'concerts', 'meta'], 'readonly', (s, set) => {
    const o = { docs: {}, folders: {}, concerts: {}, prefs: {} };
    ['docs', 'folders', 'concerts'].forEach((n) => db.each(s[n], null, (k, v) => { o[n][k] = v; }));
    const r = s.meta.get('prefs');
    r.onsuccess = () => { o.prefs = r.result || {}; };
    set(o);
  }).then((o) => {
    lib.docs = o.docs; lib.folders = o.folders; lib.concerts = o.concerts;
    lib.prefs = {};
    Object.keys(PREFS).forEach((k) => { lib.prefs[k] = k in o.prefs ? o.prefs[k] : PREFS[k]; });
  });
}

export function pref(k, v) {
  lib.prefs[k] = v;
  return db.put('meta', 'prefs', lib.prefs);
}

export function list(name) { return Object.keys(lib[name]).map((k) => lib[name][k]); }

// Guarda y solo entonces actualiza la memoria, para que no digan cosas distintas.
export function change(name, id, patch) {
  // Primero en memoria: otro guardado simultáneo no puede pisarlo con datos viejos.
  const o = lib[name][id], old = {};
  Object.keys(patch).forEach((k) => { old[k] = o[k]; });
  Object.assign(o, patch);
  return db.put(name, id, o).then(() => o, (e) => { Object.assign(o, old); throw e; });
}
export function create(name, obj) {
  obj.id = obj.id || db.newId();
  return db.put(name, obj.id, obj).then(() => { lib[name][obj.id] = obj; return obj; });
}

// Estado del lector: se sobrescribe la ficha en memoria al momento y se guarda sin esperar.
export function setPage(id, page, pages) {
  const d = lib.docs[id];
  if (!d) return Promise.resolve();
  d.page = page; d.opened = Date.now();
  if (pages) d.pages = pages;
  return db.put('docs', id, d);
}

export function docByHash(hash) { return list('docs').filter((d) => d.hash === hash)[0] || null; }

export function removeDocs(ids) {
  const set = {};
  ids.forEach((i) => { set[i] = true; });
  return db.tx(['docs', 'chunks', 'notes', 'concerts'], 'readwrite', (s) => {
    ids.forEach((id) => {
      const d = lib.docs[id];
      s.docs.delete(id);
      s.notes.delete(db.prefix(id));
      if (d && d.blob) s.chunks.delete(db.prefix(d.blob));
    });
    list('concerts').forEach((c) => {
      if (c.items.some((i) => set[i])) s.concerts.put(Object.assign({}, c, { items: c.items.filter((i) => !set[i]) }), c.id);
    });
  }).then(() => {
    ids.forEach((id) => { delete lib.docs[id]; });
    list('concerts').forEach((c) => { c.items = c.items.filter((i) => !set[i]); });
  });
}

export function children(parent) {
  return list('folders').filter((f) => (f.parent || '') === parent).sort(byName);
}
export function byName(a, b) { return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }); }

// [{v, text, depth}] de todo el árbol; skip evita mover una carpeta dentro de sí misma.
export function tree(skip) {
  const out = [{ v: '', text: 'Todas las partituras (raíz)', depth: 0 }];
  const walk = (p, d) => children(p).forEach((f) => {
    if (f.id === skip || d > 12) return;
    out.push({ v: f.id, text: '📁 ' + f.name, depth: d });
    walk(f.id, d + 1);
  });
  walk('', 1);
  return out;
}

// Borrar una carpeta no borra partituras: su contenido sube un nivel.
export function removeFolder(id) {
  const up = lib.folders[id].parent || '';
  const fs = children(id), ds = list('docs').filter((d) => d.folder === id);
  return db.tx(['folders', 'docs'], 'readwrite', (s) => {
    fs.forEach((f) => s.folders.put(Object.assign({}, f, { parent: up }), f.id));
    ds.forEach((d) => s.docs.put(Object.assign({}, d, { folder: up }), d.id));
    s.folders.delete(id);
  }).then(() => {
    fs.forEach((f) => { f.parent = up; });
    ds.forEach((d) => { d.folder = up; });
    delete lib.folders[id];
  });
}

// Carpeta para una ruta del PC, creando las que falten.
export function folderFor(parts, base) {
  return parts.reduce((p, name) => p.then((parent) => {
    const n = name.slice(0, 120), f = children(parent).filter((x) => x.name === n)[0];
    return f ? f.id : create('folders', { name: n, parent }).then((x) => x.id);
  }), Promise.resolve(base || ''));
}

export function tags() {
  const m = {};
  list('docs').forEach((d) => (d.tags || []).forEach((t) => { m[t] = (m[t] || 0) + 1; }));
  return Object.keys(m).sort((a, b) => a.localeCompare(b, 'es'));
}

export function fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

export function usage() {
  return db.tx(['notes', 'imports'], 'readonly', (s, set) => {
    const o = { pdf: 0, notes: 0, partial: 0, partials: [] };
    db.each(s.notes, null, (k, v) => { o.notes += JSON.stringify(v).length; });
    db.each(s.imports, null, (k, v) => { o.partial += v.got * db.CHUNK; o.partials.push(v); });
    set(o);
  }).then((o) => {
    list('docs').forEach((d) => { if (d.blob) o.pdf += d.size; });
    return o;
  });
}
