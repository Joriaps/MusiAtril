// IndexedDB. Solo callbacks dentro de cada transacción: en Safari 10 las promesas no la
// mantienen abierta. Los PDFs van troceados como ArrayBuffer (los Blob fallan en iOS 10).
export const CHUNK = 524288;
const NAME = 'atril', VERSION = 1;
export const STORES = ['docs', 'folders', 'concerts', 'notes', 'chunks', 'imports', 'meta'];
let opening = null;

export function open() {
  if (opening) return opening;
  opening = new Promise((ok, ko) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); });
    };
    r.onerror = () => { opening = null; ko(new Error('No se puede abrir el almacén de datos: ' + (r.error && r.error.message || ''))); };
    r.onblocked = () => ko(new Error('Cierra las demás pestañas de Atril'));
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      db.onclose = () => { opening = null; };
      ok(db);
    };
  });
  return opening;
}

export function friendly(e) {
  const n = e && e.name || '', m = e && e.message || String(e || '');
  if (n === 'QuotaExceededError' || /quota|espacio|disk/i.test(m)) {
    const x = new Error('No queda espacio en el iPad para Atril. Borra alguna partitura o libera espacio en el iPad y vuelve a intentarlo. Lo que ya estaba guardado sigue intacto.');
    x.quota = true;
    return x;
  }
  return e instanceof Error ? e : new Error(m || 'Error del almacén de datos');
}

// Ejecuta fn(stores, set) en una transacción; resuelve al completarse con lo pasado a set().
export function tx(names, mode, fn) {
  return open().then((db) => new Promise((ok, ko) => {
    let out, err = null, t;
    try { t = db.transaction(names, mode); } catch (e) { opening = null; ko(friendly(e)); return; }
    const st = {};
    names.forEach((n) => { st[n] = t.objectStore(n); });
    t.oncomplete = () => ok(out);
    t.onerror = (e) => { err = err || (e.target && e.target.error) || t.error; };
    t.onabort = () => ko(friendly(err || t.error || new Error('Operación cancelada por el iPad (¿sin espacio?)')));
    try { fn(st, (v) => { out = v; }); } catch (e) { err = e; try { t.abort(); } catch (x) { ko(friendly(e)); } }
  }));
}

export function get(store, key) {
  return tx([store], 'readonly', (s, set) => { const r = s[store].get(key); r.onsuccess = () => set(r.result); });
}
export function put(store, key, value) {
  return tx([store], 'readwrite', (s) => { s[store].put(value, key); });
}
export function del(store, key) {
  return tx([store], 'readwrite', (s) => { s[store].delete(key); });
}
// Recorre con cursor: getAll no es fiable en Safari 10.
export function each(os, range, fn, done) {
  const r = range ? os.openCursor(range) : os.openCursor();
  r.onsuccess = () => { const c = r.result; if (c) { fn(c.key, c.value, c); c.continue(); } else if (done) done(); };
}
export function all(store) {
  return tx([store], 'readonly', (s, set) => { const l = []; each(s[store], null, (k, v) => l.push(v), () => set(l)); });
}
export function prefix(p) { return IDBKeyRange.bound(p + '/', p + '/\uffff'); }
export function chunkKey(blob, i) { return blob + '/' + ('00000' + i).slice(-6); }
export function readChunk(blob, i) {
  return get('chunks', chunkKey(blob, i)).then((b) => {
    if (!b) throw new Error('Falta una parte de este PDF: vuelve a importarlo');
    return b;
  });
}
let seq = 0;
export function newId() {
  const r = new Uint32Array(3);
  crypto.getRandomValues(r);
  return Date.now().toString(36) + (seq++ % 36).toString(36) + r[0].toString(36) + r[1].toString(36);
}
