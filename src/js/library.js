// Biblioteca: carpetas, etiquetas, búsqueda, orden y selección múltiple.
import { h, clear, mb } from './util.js';
import { lib, list, pref, change, create, removeDocs, removeFolder, children, byName, tree, tags, fold } from './lib.js';
import { pedir, confirmar, acciones, elegir, toast, oops, modal } from './ui.js';
import { importScreen, addFiles } from './importer.js';
import { openReader } from './reader.js';
import { newConcert, concertsTab } from './concerts.js';
import { settingsTab } from './settings.js';

const st = { tab: 'lib', folder: '', q: '', tag: '', sel: null, top: 0 };
let root = null;

export function start(el) { root = el; }
export function setTab(t) { st.tab = t; st.sel = null; st.top = 0; home(); }

export function home() {
  const tab = (t, text) => h('button', { class: 'tab' + (st.tab === t ? ' on' : ''), click: () => setTab(t) }, text);
  const body = h('div', { class: 'tabbody' });
  const warn = /iP(ad|hone|od)/.test(navigator.userAgent) && !navigator.standalone ? h('div', { class: 'card warn' }, h('span', { text: 'Espera al aviso «Lista», pulsa Compartir › «Añadir a pantalla de inicio» y usa Atril siempre desde su icono.' })) : null;
  clear(root).appendChild(h('div', { class: 'screen col' }, h('div', { class: 'tabs' }, tab('lib', 'Partituras'), tab('con', 'Conciertos'), tab('set', 'Copias y opciones')), warn, body));
  if (st.tab === 'con') concertsTab(body, root, home);
  else if (st.tab === 'set') settingsTab(body, root, home);
  else libraryTab(body);
}

const SORT = { name: 'Nombre', composer: 'Compositor', added: 'Fecha de llegada', opened: 'Última vez abierta' };
function sorter() {
  const s = lib.prefs.sort;
  if (s === 'added' || s === 'opened') return (a, b) => (b[s] || 0) - (a[s] || 0) || byName(a, b);
  if (s === 'composer') return (a, b) => (a.composer ? 0 : 1) - (b.composer ? 0 : 1) || a.composer.localeCompare(b.composer, 'es') || byName(a, b);
  return byName;
}

export function filterDocs(q, tag) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return list('docs').filter((d) => {
    if (tag && (d.tags || []).indexOf(tag) < 0) return false;
    const t = fold(d.name + ' ' + d.composer + ' ' + (d.tags || []).join(' '));
    return words.every((w) => t.indexOf(w) >= 0);
  }).sort(sorter());
}

function libraryTab(body) {
  if (st.folder && !lib.folders[st.folder]) st.folder = '';
  const rows = h('div', { class: 'rows scroll fillrows' });
  const search = h('input', { type: 'text', class: 'search', placeholder: 'Buscar por nombre, compositor o etiqueta', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none' });
  search.value = st.q;
  let t = 0;
  search.addEventListener('input', () => { st.q = search.value; clearTimeout(t); t = setTimeout(draw, 200); });
  const input = h('input', {
    type: 'file', accept: 'application/pdf,.pdf', class: 'file', multiple: true,
    onchange: () => {
      const f = [].slice.call(input.files || []);
      input.value = '';
      if (f.length) addFiles(f, st.folder).then(home, oops);
    },
  });
  body.appendChild(h('div', { class: 'tools' },
    __WEB__ ? null : h('button', { class: 'main', click: () => importScreen(root, st.folder, home).catch(oops) }, 'Importar desde el PC'),
    h('label', { class: __WEB__ ? 'btn main' : 'btn' }, 'Añadir desde el iPad', input),
    h('button', { click: newFolder }, 'Nueva carpeta'),
    h('span', { class: 'grow' }),
    h('button', { class: st.sel ? 'on' : '', click: () => { st.sel = st.sel ? null : {}; home(); } }, st.sel ? 'Terminar' : 'Seleccionar')));
  body.appendChild(h('div', { class: 'tools' }, search, h('button', {
    click: () => elegir('Ordenar por', Object.keys(SORT).map((k) => ({ v: k, text: SORT[k] }))).then((v) => { if (v) { pref('sort', v).catch(oops); home(); } }),
  }, 'Orden: ' + SORT[lib.prefs.sort])));
  const all = tags();
  if (st.tag && all.indexOf(st.tag) < 0) st.tag = '';
  if (all.length) {
    const chips = h('div', { class: 'chips' });
    all.slice(0, 40).forEach((x) => chips.appendChild(h('button', { class: 'chip' + (st.tag === x ? ' on' : ''), click: () => { st.tag = st.tag === x ? '' : x; home(); } }, x)));
    body.appendChild(chips);
  }
  const path = h('div', { class: 'path' });
  body.appendChild(path);
  body.appendChild(rows);
  const foot = h('div', { class: 'tools bottom' });
  if (st.sel) body.appendChild(foot);
  draw();
  rows.scrollTop = st.top;
  rows.addEventListener('scroll', () => { st.top = rows.scrollTop; });

  function crumbs(searching, n) {
    clear(path);
    if (searching) { path.appendChild(h('span', { text: n + (n === 1 ? ' resultado en toda la biblioteca' : ' resultados en toda la biblioteca') })); return; }
    const l = [];
    for (let f = lib.folders[st.folder], i = 0; f && i < 30; f = lib.folders[f.parent], i++) l.unshift(f);
    const go = (id, text) => path.appendChild(h('button', { class: 'crumb', click: () => { st.folder = id; st.top = 0; home(); } }, text));
    go('', 'Todas');
    l.forEach((f) => { path.appendChild(h('span', { text: '›' })); go(f.id, f.name); });
  }

  function draw() {
    const searching = !!(st.q.trim() || st.tag), docs = searching ? filterDocs(st.q, st.tag) : list('docs').filter((d) => (d.folder || '') === st.folder).sort(sorter());
    clear(rows);
    crumbs(searching, docs.length);
    if (!searching) children(st.folder).forEach((f) => {
      const n = list('docs').filter((d) => d.folder === f.id).length + children(f.id).length;
      rows.appendChild(h('div', { class: 'item' }, h('span', { class: 'ico', text: '📁' }),
        h('span', { class: 'grow tapable', click: () => { st.folder = f.id; st.top = 0; home(); } }, h('b', { text: f.name }), h('small', { text: n + (n === 1 ? ' elemento' : ' elementos') })),
        h('button', { class: 'flat', 'aria-label': 'Opciones de la carpeta', click: () => folderMenu(f) }, '⋯')));
    });
    docs.forEach((d) => {
      const cb = st.sel ? h('input', { type: 'checkbox', onchange: () => { if (cb.checked) st.sel[d.id] = 1; else delete st.sel[d.id]; footer(); } }) : null;
      if (cb) cb.checked = !!st.sel[d.id];
      const sub = [d.composer, d.blob ? (d.pages ? d.pages + ' pág.' : '') : 'falta el PDF', (d.tags || []).join(', ')].filter(Boolean).join(' · ');
      const inner = h('span', { class: 'grow tapable' }, h('b', { text: d.name }), h('small', { text: sub || mb(d.size) }));
      const row = h(cb ? 'label' : 'div', { class: 'item' + (d.blob ? '' : ' dim') }, cb || h('span', { class: 'ico', text: '♪' }), inner,
        cb ? null : h('button', { class: 'flat', 'aria-label': 'Opciones de la partitura', click: () => docMenu(d) }, '⋯'));
      if (!cb) inner.addEventListener('click', () => read(d));
      rows.appendChild(row);
    });
    if (!rows.firstChild) rows.appendChild(h('p', { class: 'empty', text: searching ? 'Nada coincide con la búsqueda.' : list('docs').length ? 'Esta carpeta está vacía.' : __WEB__ ? 'Todavía no hay partituras. Pulsa «Añadir desde el iPad» y elígelas en Archivos (por ejemplo, en Descargas).' : 'Todavía no hay partituras. Pulsa «Importar desde el PC» con el servidor encendido.' }));
    footer();
  }

  function footer() {
    if (!st.sel) return;
    clear(foot);
    const ids = Object.keys(st.sel).filter((i) => lib.docs[i]), off = !ids.length, done = () => { st.sel = null; home(); };
    foot.appendChild(h('span', { class: 'grow', text: ids.length + ' elegidas' }));
    foot.appendChild(h('button', { disabled: off, click: () => moveDocs(ids, done) }, 'Mover'));
    foot.appendChild(h('button', { disabled: off, click: () => toConcert(ids, done) }, 'A un concierto'));
    foot.appendChild(h('button', { disabled: off, click: () => addTag(ids, done) }, 'Etiquetar'));
    foot.appendChild(h('button', { class: 'danger', disabled: off, click: () => delDocs(ids, done) }, 'Borrar'));
  }
}

export function read(d, page) {
  openReader(root, { list: [d.id], page, onExit: home });
}

function newFolder() {
  pedir('Nueva carpeta', [{ k: 'name', label: 'Nombre' }], 'Crear').then((r) => {
    if (!r || !r.name) return null;
    if (children(st.folder).some((f) => f.name === r.name)) { toast('Ya hay una carpeta con ese nombre.'); return null; }
    return create('folders', { name: r.name, parent: st.folder }).then(home);
  }).catch(oops);
}

function folderMenu(f) {
  acciones(f.name, [
    { text: 'Cambiar nombre', fn: () => pedir('Cambiar nombre', [{ k: 'name', label: 'Nombre', value: f.name }]).then((r) => (r && r.name ? change('folders', f.id, { name: r.name }).then(home) : null)).catch(oops) },
    { text: 'Mover a…', fn: () => elegir('Mover «' + f.name + '» a', tree(f.id)).then((v) => (v === undefined ? null : change('folders', f.id, { parent: v }).then(home))).catch(oops) },
    { text: 'Crear concierto con sus partituras', fn: () => newConcert(list('docs').filter((d) => d.folder === f.id).sort(byName).map((d) => d.id), f.name, () => setTab('con')) },
    { text: 'Borrar carpeta', danger: true, fn: () => confirmar('Borrar carpeta', 'Se borra «' + f.name + '». Sus partituras y subcarpetas no se borran: suben un nivel.', 'Borrar carpeta', true).then((y) => (y ? removeFolder(f.id).then(home) : null)).catch(oops) },
  ]);
}

function docMenu(d) {
  acciones(d.name, [
    { text: 'Abrir', fn: () => read(d) },
    { text: 'Editar nombre, compositor y etiquetas', fn: () => edit(d) },
    { text: 'Mover a…', fn: () => moveDocs([d.id], home) },
    { text: 'Añadir a un concierto', fn: () => toConcert([d.id], home) },
    { text: 'Información', fn: () => modal(d.name, h('div', null, h('p', { text: 'Tamaño: ' + mb(d.size) }), h('p', { text: 'Páginas: ' + (d.pages || '—') }), h('p', { text: 'Añadida: ' + new Date(d.added).toLocaleDateString('es-ES') }), h('p', { text: 'Origen en el PC: ' + (d.src || '—') })), []) },
    { text: 'Borrar', danger: true, fn: () => delDocs([d.id], home) },
  ]);
}

function edit(d) {
  const chips = (ins) => {
    const box = h('div', { class: 'chips' });
    tags().slice(0, 30).forEach((t) => box.appendChild(h('button', { class: 'chip', click: () => { const l = split(ins.tags.value); if (l.indexOf(t) < 0) ins.tags.value = l.concat([t]).join(', '); } }, t)));
    return box;
  };
  pedir('Editar partitura', [{ k: 'name', label: 'Nombre', value: d.name, max: 200 }, { k: 'composer', label: 'Compositor', value: d.composer }, { k: 'tags', label: 'Etiquetas, separadas por comas', value: (d.tags || []).join(', '), max: 400 }], 'Guardar', chips).then((r) => {
    if (!r) return null;
    return change('docs', d.id, { name: r.name || d.name, composer: r.composer, tags: split(r.tags) }).then(home);
  }).catch(oops);
}
function split(s) {
  const o = [];
  s.split(',').forEach((t) => { const x = t.trim().slice(0, 40); if (x && o.indexOf(x) < 0 && o.length < 20) o.push(x); });
  return o;
}

const chain = (ids, fn) => ids.reduce((p, id) => p.then(() => fn(id)), Promise.resolve());
function moveDocs(ids, done) {
  elegir('Mover a', tree()).then((v) => (v === undefined ? null : chain(ids, (id) => change('docs', id, { folder: v })).then(done))).catch(oops);
}
function addTag(ids, done) {
  pedir('Etiquetar ' + ids.length + (ids.length === 1 ? ' partitura' : ' partituras'), [{ k: 't', label: 'Etiquetas, separadas por comas', max: 200 }], 'Añadir').then((r) => {
    const l = r ? split(r.t) : [];
    return l.length ? chain(ids, (id) => change('docs', id, { tags: split((lib.docs[id].tags || []).concat(l).join(',')) })).then(done) : null;
  }).catch(oops);
}
function toConcert(ids, done) {
  const l = list('concerts').sort(byName).map((c) => ({ v: c.id, text: c.name + (c.date ? ' · ' + c.date : '') }));
  elegir('Añadir a un concierto', [{ v: '+', text: '＋ Concierto nuevo' }].concat(l)).then((v) => {
    if (!v) return null;
    if (v === '+') { newConcert(ids, '', done); return null; }
    const c = lib.concerts[v], add = ids.filter((i) => c.items.indexOf(i) < 0);
    return change('concerts', v, { items: c.items.concat(add) }).then(() => { toast(add.length ? 'Añadido a «' + c.name + '».' : 'Ya estaba en «' + c.name + '».'); done(); });
  }).catch(oops);
}
function delDocs(ids, done) {
  const n = ids.length;
  confirmar(n === 1 ? 'Borrar partitura' : 'Borrar ' + n + ' partituras', (n === 1 ? '«' + lib.docs[ids[0]].name + '» se' : 'Se') + ' borrará del iPad con sus anotaciones y saldrá de los conciertos. No se puede deshacer.', 'Borrar', true)
    .then((y) => (y ? removeDocs(ids).then(done) : null)).catch(oops);
}
