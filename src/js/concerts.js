// Conciertos: listas ordenadas de obras (solo guardan el identificador, no copian el PDF).
import { h, clear } from './util.js';
import { lib, list, create, change } from './lib.js';
import * as db from './db.js';
import { pedir, confirmar, acciones, toast, oops, modal } from './ui.js';
import { openReader } from './reader.js';
import { filterDocs } from './library.js';

const FIELDS = (c) => [{ k: 'name', label: 'Nombre', value: c.name }, { k: 'date', label: 'Fecha', type: 'date', value: c.date, hint: 'aaaa-mm-dd' }, { k: 'place', label: 'Lugar', value: c.place }];
const day = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };

export function newConcert(items, name, done) {
  pedir('Concierto nuevo', FIELDS({ name }), 'Crear').then((r) => {
    if (!r || !r.name) return null;
    return create('concerts', { name: r.name, date: day(r.date) ? r.date : '', place: r.place, items }).then((c) => { toast('Concierto «' + c.name + '» creado.'); done(c); });
  }).catch(oops);
}

export function concertsTab(body, root, home) {
  const rows = h('div', { class: 'rows scroll fillrows' });
  body.appendChild(h('div', { class: 'tools' }, h('button', { class: 'main', click: () => newConcert([], '', (c) => detail(root, c.id, home)) }, '＋ Concierto nuevo')));
  body.appendChild(rows);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  // Primero los próximos por fecha, luego los que no tienen fecha y al final los pasados.
  const rank = (c) => (!c.date ? 1 : c.date >= today ? 0 : 2);
  list('concerts').sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.name.localeCompare(b.name, 'es')).forEach((c) => {
    rows.appendChild(h('div', { class: 'item' + (rank(c) === 2 ? ' dim' : '') }, h('span', { class: 'ico', text: '🎼' }),
      h('span', { class: 'grow tapable', click: () => detail(root, c.id, home) }, h('b', { text: c.name }), h('small', { text: [day(c.date), c.place, c.items.length + (c.items.length === 1 ? ' obra' : ' obras')].filter(Boolean).join(' · ') })),
      h('button', { class: 'main', disabled: !c.items.length, click: () => play(root, c.id, 0, 1, home) }, 'Tocar'),
      h('button', { class: 'more', 'aria-label': 'Opciones del concierto', click: () => menu(c, root, home) }, 'Más')));
  });
  if (!rows.firstChild) rows.appendChild(h('p', { class: 'empty', text: 'Todavía no hay conciertos. Pulsa «Concierto nuevo» para preparar uno.' }));
}

export function play(root, id, index, page, home) {
  const c = lib.concerts[id], items = c ? c.items.filter((i) => lib.docs[i]) : [];
  if (!items.length) { home(); return; }
  openReader(root, { list: items, index: Math.min(index, items.length - 1), page, concert: id, onExit: home });
}

function menu(c, root, home) {
  acciones(c.name, [
    { text: 'Editar nombre, fecha y lugar', fn: () => edit(c, home) },
    { text: 'Duplicar', fn: () => create('concerts', { name: (c.name + ' (copia)').slice(0, 120), date: c.date, place: c.place, items: c.items.slice() }).then(home, oops) },
    { text: 'Borrar concierto', danger: true, fn: () => confirmar('Borrar concierto', 'Se borra «' + c.name + '». Las partituras no se borran.', 'Borrar', true).then((y) => (y ? db.del('concerts', c.id).then(() => { delete lib.concerts[c.id]; home(); }) : null)).catch(oops) },
  ]);
}
function edit(c, done) {
  pedir('Editar concierto', FIELDS(c)).then((r) => (r ? change('concerts', c.id, { name: r.name || c.name, date: day(r.date) ? r.date : '', place: r.place }).then(done) : null)).catch(oops);
}

function detail(root, id, home) {
  const c = lib.concerts[id], rows = h('div', { class: 'rows scroll fillrows' }), again = () => detail(root, id, home);
  clear(root).appendChild(h('div', { class: 'screen col' },
    h('div', { class: 'head' }, h('button', { click: home }, '‹ Conciertos'), h('h1', { class: 'grow', text: c.name })),
    h('p', { class: 'sub', text: [day(c.date), c.place].filter(Boolean).join(' · ') || 'Sin fecha ni lugar' }),
    h('div', { class: 'tools' }, h('button', { class: 'main', disabled: !c.items.length, click: () => play(root, id, 0, 1, again) }, '▶ Tocar el concierto'),
      h('button', { click: () => picker(id, again) }, 'Añadir obras'), h('button', { click: () => edit(c, again) }, 'Cambiar nombre o fecha')), rows));
  c.items.forEach((docId, i) => {
    const d = lib.docs[docId], grip = h('span', { class: 'grip', text: '≡' });
    const quitar = () => confirmar('Quitar del concierto', '«' + (d ? d.name : 'Partitura borrada') + '» sale de este concierto. La partitura no se borra.', 'Quitar')
      .then((y) => (y ? change('concerts', id, { items: c.items.filter((x, j) => j !== i) }).then(again) : null)).catch(oops);
    const row = h('div', { class: 'item' }, grip, h('span', { class: 'num', text: String(i + 1) }),
      h('span', { class: 'grow tapable', click: () => play(root, id, i, 1, again) }, h('b', { text: d ? d.name : 'Partitura borrada' }), h('small', { text: d ? d.composer || '' : '' })),
      h('button', { class: 'more', 'aria-label': 'Quitar del concierto', click: quitar }, 'Quitar'));
    sortable(grip, row, rows, i, c.items.length, (to) => {
      const l = c.items.slice();
      l.splice(to, 0, l.splice(i, 1)[0]);
      change('concerts', id, { items: l }).then(again, oops);
    });
    rows.appendChild(row);
  });
  if (c.items.length > 1) rows.appendChild(h('p', { class: 'empty', text: 'Arrastra por ≡ para cambiar el orden.' }));
  if (!c.items.length) rows.appendChild(h('p', { class: 'empty', text: 'Añade obras a este concierto.' }));
}

// Reordenar con el dedo (o el ratón) desde el asa.
function sortable(grip, row, rows, from, n, done) {
  let y0 = 0, top0 = 0, on = false, to = from, lastY = 0, timer = 0;
  const hgt = () => row.offsetHeight + 6;
  const place = () => {
    const dy = lastY - y0 + (rows.scrollTop - top0);
    row.style.webkitTransform = row.style.transform = 'translate3d(0,' + dy + 'px,0)';
    to = Math.max(0, Math.min(n - 1, from + Math.round(dy / hgt())));
    for (let i = 0; i < n; i++) {
      if (i === from) continue;
      const s = i > from && i <= to ? -hgt() : i < from && i >= to ? hgt() : 0, el = rows.children[i];
      el.style.webkitTransform = el.style.transform = s ? 'translate3d(0,' + s + 'px,0)' : '';
    }
  };
  const down = (y) => {
    on = true; y0 = lastY = y; top0 = rows.scrollTop; row.classList.add('drag');
    timer = setInterval(() => {
      const r = rows.getBoundingClientRect(), v = lastY < r.top + 50 ? -8 : lastY > r.bottom - 50 ? 8 : 0;
      if (v) { rows.scrollTop += v; place(); }
    }, 30);
  };
  const move = (y) => { if (on) { lastY = y; place(); } };
  const up = () => {
    if (!on) return;
    on = false;
    clearInterval(timer);
    row.classList.remove('drag');
    if (to !== from) { done(to); return; }
    for (let i = 0; i < n; i++) rows.children[i].style.webkitTransform = rows.children[i].style.transform = '';
  };
  grip.addEventListener('touchstart', (e) => { e.preventDefault(); down(e.touches[0].clientY); });
  grip.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); move(e.touches[0].clientY); });
  grip.addEventListener('touchend', up);
  grip.addEventListener('touchcancel', () => { to = from; up(); });
  grip.addEventListener('mousedown', (e) => {
    e.preventDefault(); down(e.clientY);
    const mv = (x) => move(x.clientY), mu = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', mu); up(); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', mu);
  });
}

function picker(id, done) {
  const sel = [], rows = h('div', { class: 'rows' }), q = h('input', { type: 'text', class: 'search', placeholder: 'Buscar', autocomplete: 'off', autocorrect: 'off' });
  const draw = () => {
    clear(rows);
    filterDocs(q.value, '').forEach((d) => {
      const has = lib.concerts[id].items.indexOf(d.id) >= 0;
      const cb = h('input', { type: 'checkbox', disabled: has, onchange: () => { const i = sel.indexOf(d.id); if (cb.checked && i < 0) sel.push(d.id); else if (!cb.checked && i >= 0) sel.splice(i, 1); } });
      cb.checked = has || sel.indexOf(d.id) >= 0;
      rows.appendChild(h('label', { class: 'item' + (has ? ' dim' : '') }, cb, h('span', { class: 'grow' }, h('b', { text: d.name }), h('small', { text: has ? 'ya está en el concierto' : d.composer || '' }))));
    });
    if (!rows.firstChild) rows.appendChild(h('p', { text: 'No hay partituras.' }));
  };
  q.addEventListener('input', draw);
  draw();
  modal('Añadir obras', h('div', null, q, rows), [{ text: 'Cancelar', fn: () => null }, { text: 'Añadir', class: 'main', fn: () => { change('concerts', id, { items: lib.concerts[id].items.concat(sel) }).then(done, oops); } }]);
}
