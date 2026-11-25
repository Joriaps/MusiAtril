// Lector: página visible + siguiente, toques, pedal, anotaciones, ajustes y modo concierto.
import { h, clear, freeCanvas } from './util.js';
import { openStored } from './engine.js';
import { adjust, cssFilter } from './geometry.js';
import { lib, pref, setPage, change } from './lib.js';
import * as db from './db.js';
import { loadNotes, redraw, NoteLayer, COLORS, MARKS, PEN, MARK, TEXT, ERASE, penTouch } from './notes.js';
import { adjustPanel } from './adjust.js';
import { toast, oops, modalOpen, elegir, acciones } from './ui.js';

// o: {list: [idDoc], index, concert, title, page, onExit}
export function openReader(root, o) {
  let index = o.index || 0, docId = o.list[index], pdf = null, page = 1, token = 0, dead = false, busy = false;
  let shown = null, next = null, offset = 0, annot = false, panel = null, layers = [], crop = false, wantEnd = false, navTimer = 0;
  let tool = Object.assign({ t: 'pen', pen: 0, mark: 0, pw: 1, mw: 1, tw: 1, ew: 1 }, lib.prefs.pen || {});

  const stage = h('div', { class: 'stage' }), msg = h('div', { class: 'msg' }), info = h('span', { class: 'grow' });
  const bar = h('div', { class: 'bar' }), bottom = h('div', { class: 'abar hidden' }), count = h('div', { class: 'count' });
  const view = h('div', { class: 'viewer' + (lib.prefs.night ? ' night' : '') }, stage, msg, count, bar, bottom);
  clear(root).appendChild(view);

  const doc = () => lib.docs[docId];
  const size = () => [stage.clientWidth || window.innerWidth, stage.clientHeight || window.innerHeight];
  const two = () => { const s = size(); return lib.prefs.fit === 'two' && s[0] > s[1]; };
  const step = () => (two() ? 2 : 1);

  // --- barra: a la vista solo lo de cada día; lo demás, en «Más» con nombres que dicen qué hace.
  function buildBar() {
    clear(bar);
    bar.appendChild(h('button', { click: exit }, '‹ Volver'));
    bar.appendChild(info);
    if (o.concert) { bar.appendChild(h('button', { click: pickWork }, 'Obras')); return; }
    bar.appendChild(h('button', { class: annot ? 'on' : '', click: toggleAnnot }, '✎ Anotar'));
    bar.appendChild(h('button', { click: pickPage }, 'Ir a página'));
    bar.appendChild(h('button', { click: moreMenu }, 'Más'));
  }
  function moreMenu() {
    acciones('Más opciones', [
      { text: 'Mejorar la imagen (brillo, recortar, girar)', fn: openAdjust },
      { text: 'Cambiar la vista (página entera, al ancho, dos páginas)', fn: pickFit },
      { text: lib.prefs.night ? 'Quitar el modo noche' : 'Modo noche (fondo negro)', fn: night },
    ]);
  }

  // Las tres primeras veces se enseña dónde tocar. No recibe toques: se quita con el primero o a los 10 s.
  function showHint() {
    if ((lib.prefs.hints || 0) >= 3) return;
    pref('hints', (lib.prefs.hints || 0) + 1).catch(oops);
    const el = h('div', { class: 'hint' },
      h('div', { class: 'hz' }, h('b', { text: '‹' }), h('span', { text: 'Toca aquí para volver a la página anterior' })),
      h('div', { class: 'hz mid' }, h('span', { text: 'Toca aquí para ver u ocultar los botones' })),
      h('div', { class: 'hz' }, h('b', { text: '›' }), h('span', { text: 'Toca aquí para pasar página' })));
    view.appendChild(el);
    const off = () => {
      clearTimeout(t);
      if (el.parentNode) el.parentNode.removeChild(el);
      stage.removeEventListener('touchstart', off);
      stage.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', off);
    };
    const t = setTimeout(off, 10000);
    stage.addEventListener('touchstart', off);
    stage.addEventListener('mousedown', off);
    document.addEventListener('keydown', off);
  }
  function label() {
    const d = doc(), t = d ? d.name : '', last = Math.min(page + step() - 1, pdf ? pdf.pages : page);
    const n = pdf ? (last > page ? page + '–' + last : page) + '/' + pdf.pages : '';
    info.textContent = (o.concert ? (index + 1) + ' de ' + o.list.length + ' · ' : '') + t + (n ? ' · ' + n : '');
    count.textContent = n;
  }
  function night() {
    pref('night', lib.prefs.night ? 0 : 1).catch(oops);
    view.className = 'viewer' + (lib.prefs.night ? ' night' : '');
    buildBar();
  }
  function pickFit() {
    elegir('Vista', [{ v: 'page', text: 'Página entera' }, { v: 'width', text: 'Ajustar al ancho (avanza por pantallas)' }, { v: 'two', text: 'Dos páginas en horizontal' }]).then((v) => {
      if (!v || dead) return;
      pref('fit', v).catch(oops);
      offset = 0; show(true);
    });
  }
  function pickPage() {
    if (!pdf) return;
    const l = [];
    for (let i = 1; i <= pdf.pages; i++) l.push({ v: i, text: 'Página ' + i });
    elegir('Ir a la página', l).then((v) => { if (v && !dead) { page = v; offset = 0; show(); } });
  }
  function pickWork() {
    elegir('Obras del concierto', o.list.map((id, i) => ({ v: i, text: (i + 1) + '. ' + (lib.docs[id] ? lib.docs[id].name : '—') }))).then((v) => { if (v !== undefined && v !== index) goWork(v, 1); });
  }

  // --- páginas
  function dropSpread(s) {
    if (!s) return;
    s.slots.forEach((t) => { freeCanvas(t.canvas); freeCanvas(t.over); });
    if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
  }
  function specKey(n) {
    const s = size(), d = doc();
    return [docId, n, s[0], s[1], lib.prefs.fit, crop, JSON.stringify(d.adj || {})].join('|');
  }
  // Dibuja las 1 o 2 páginas a partir de n, fuera de pantalla.
  function build(n, wanted) {
    const s = size(), d = doc(), fit = lib.prefs.fit === 'width' && !crop ? 'width' : 'page', k = step(), key = specKey(n);
    const nums = [n];
    if (k === 2 && n + 1 <= pdf.pages) nums.push(n + 1);
    const out = { n, key, slots: [], el: h('div', { class: 'spread', 'data-p': String(n) }) }, cur = pdf;
    let p = Promise.resolve(true);
    nums.forEach((num) => {
      p = p.then((go) => {
        if (!go || !wanted()) return false;
        const adj = adjust(d, num);
        if (crop) { adj.x = 0; adj.y = 0; adj.w = 1; adj.h = 1; }
        return cur.render(num, { w: s[0] / k, h: s[1], fit, adj, max: 3300000 / k }, wanted).then((r) => {
          if (!r) return false;
          const slot = { n: num, canvas: r.canvas, geo: r.geo, adj, over: null, notes: [] };
          slot.el = h('div', { class: 'page' }, r.canvas);
          slot.el.style.width = r.geo.cssW + 'px';
          slot.el.style.height = r.geo.cssH + 'px';
          filter(slot, adj);
          out.slots.push(slot);
          out.el.appendChild(slot.el);
          return loadNotes(d.id, num).then((l) => { slot.notes = l; redraw(slot, l); }, oops).then(() => true);
        });
      });
    });
    const fail = (e) => { dropSpread(out); throw e; };
    return p.then((go) => { if (!go || !wanted()) { dropSpread(out); return null; } return out; }, fail);
  }
  function filter(slot, adj) { slot.canvas.style.webkitFilter = slot.canvas.style.filter = cssFilter(adj); }

  function show(refresh) {
    if (!pdf || dead) return;
    const t = ++token, wanted = () => t === token && !dead;
    page = Math.max(1, Math.min(pdf.pages, page));
    label();
    save();
    msg.textContent = '';
    if (!refresh && next && next.key === specKey(page)) {
      const n = next; next = null;
      place(n);
      ahead(t);
      return;
    }
    dropSpread(next); next = null;
    const wait = setTimeout(() => { if (wanted()) msg.textContent = 'Cargando…'; }, 250);
    build(page, wanted).then((s) => {
      clearTimeout(wait);
      if (!s) return;
      msg.textContent = '';
      place(s);
      ahead(t);
    }, (e) => {
      clearTimeout(wait);
      if (!wanted()) return;
      dropSpread(shown); shown = null; layers = [];
      msg.textContent = 'No se puede mostrar esta página: ' + (e && e.message || e);
    });
  }
  function place(s) {
    const old = shown;
    shown = s;
    stage.appendChild(s.el);
    dropSpread(old);
    layers = s.slots.map((slot) => { const l = new NoteLayer(slot, docId, currentTool, refreshUndo, oops); return l; });
    if (annot) s.slots.forEach((x) => redraw(x, x.notes));
    const room = overflow();
    if (wantEnd) { offset = room; wantEnd = false; }
    offset = Math.max(0, Math.min(room, offset));
    scroll();
    refreshUndo();
    if (panel) panel.refresh();
  }
  function overflow() { return shown && lib.prefs.fit === 'width' && shown.slots[0] ? Math.max(0, shown.slots[0].geo.cssH - size()[1]) : 0; }
  function scroll() {
    if (!shown) return;
    const room = overflow(), s = size(), hh = shown.slots[0] ? shown.slots[0].geo.cssH : 0;
    shown.el.style.top = room ? '0' : Math.max(0, Math.floor((s[1] - hh) / 2)) + 'px';
    shown.el.style.webkitTransform = shown.el.style.transform = 'translate3d(0,' + -Math.round(offset) + 'px,0)';
  }
  function ahead(t) {
    const n = page + step();
    if (crop || n > pdf.pages || (next && next.key === specKey(n))) return;
    dropSpread(next); next = null;
    build(n, () => t === token && !dead).then((s) => { if (s) next = s; }, () => null);
  }
  // iOS 10 reinicia la app al volver a ella: se guarda la posición en cada cambio.
  let saved = '';
  function save() {
    const key = docId + page + index;
    if (key === saved || !doc()) return;
    saved = key;
    setPage(docId, page, pdf && pdf.pages).catch(oops);
    db.put('meta', 'session', { doc: docId, page, concert: o.concert || '', index }).catch(() => null);
  }

  function go(d) {
    if (busy || !pdf || crop) return;
    const room = overflow(), hh = size()[1] * 0.88;
    if (d > 0 && offset < room - 2) { offset = Math.min(room, offset + hh); scroll(); return; }
    if (d < 0 && offset > 2) { offset = Math.max(0, offset - hh); scroll(); return; }
    const p = page + d * step();
    if (p > pdf.pages) {
      if (o.concert && index < o.list.length - 1) goWork(index + 1, 1);
      else toast(o.concert ? 'Fin del concierto' : 'Última página');
      return;
    }
    if (p < 1 && page === 1) {
      if (o.concert && index > 0) goWork(index - 1, -1);
      return;
    }
    page = Math.max(1, p);
    if (d < 0 && lib.prefs.fit === 'width') { wantEnd = true; offset = 0; } else offset = 0;
    show();
  }
  function goWork(i, at) {
    if (busy || dead) return;
    index = i; docId = o.list[i];
    load(at);
  }

  function load(at) {
    busy = true; token++;
    dropSpread(next); next = null; layers = [];
    const old = pdf, mine = docId;
    pdf = null;
    msg.textContent = 'Abriendo…';
    label();
    const d = doc();
    (old ? old.close() : Promise.resolve()).then(() => {
      if (!d) throw new Error('esta partitura ya no existe');
      if (!d.blob) throw new Error(__WEB__ ? 'falta el archivo. Vuelve a añadirla con «Añadir partituras»' : 'falta el PDF. Vuelve a importarlo desde el PC');
      return openStored(d);
    }).then((p) => {
      if (dead) { p.close(); return; }
      pdf = p; busy = false; offset = 0;
      page = at === -1 ? p.pages : Math.max(1, Math.min(p.pages, at || d.page || 1));
      show();
    }).catch((e) => {
      busy = false;
      if (dead || mine !== docId) return;
      dropSpread(shown); shown = null;
      msg.textContent = 'No se puede abrir: ' + (e && e.name === 'PasswordException' ? 'el PDF tiene contraseña' : e && e.message || e);
      bar.classList.remove('hidden');
    });
  }

  // --- anotar
  function currentTool() {
    const t = tool.t;
    return t === 'pen' ? { t, c: COLORS[tool.pen], w: PEN[tool.pw] } : t === 'mark' ? { t, c: MARKS[tool.mark], w: MARK[tool.mw] }
      : t === 'text' ? { t, c: COLORS[tool.pen], w: TEXT[tool.tw] } : { t: 'erase', w: ERASE[tool.ew] };
  }
  function keepTool(p) {
    tool = Object.assign({}, tool, p);
    pref('pen', tool).catch(oops);
    buildTools();
  }
  function toggleAnnot() {
    annot = !annot;
    closePanel();
    bottom.classList.toggle('hidden', !annot);
    view.classList.toggle('annotating', annot);
    bar.classList.toggle('hidden', annot);
    buildBar(); buildTools();
    fitStage();
    offset = 0;
    show(true);
  }
  let stageH = 0;
  function fitStage() {
    // La página se encoge para que la barra de lápices no tape los últimos pentagramas.
    stage.style.bottom = annot ? bottom.offsetHeight + 'px' : '0';
    stage.style.top = annot ? '20px' : '0';
    stageH = annot ? bottom.offsetHeight : 0;
  }
  let last = null;
  function refreshUndo() { if (annot) buildTools(); }
  function active() { return last && layers.indexOf(last) >= 0 ? last : layers[0]; }
  function buildTools() {
    clear(bottom);
    if (!annot) return;
    const T = (t, text) => bottom.appendChild(h('button', { class: tool.t === t ? 'on' : '', click: () => keepTool({ t }) }, text));
    T('pen', 'Lápiz'); T('mark', 'Resaltar'); T('text', 'Texto'); T('erase', 'Goma');
    const isMark = tool.t === 'mark', cols = isMark ? MARKS : tool.t === 'erase' ? [] : COLORS, ci = isMark ? 'mark' : 'pen';
    if (cols.length) bottom.appendChild(h('span', { class: 'sep' }));
    cols.forEach((c, i) => {
      const dot = h('i', null);
      dot.style.background = c;
      bottom.appendChild(h('button', { class: 'dot' + (tool[ci] === i ? ' on' : ''), 'aria-label': 'Color ' + (i + 1), click: () => keepTool({ [ci]: i }) }, dot));
    });
    const wk = { pen: 'pw', mark: 'mw', text: 'tw', erase: 'ew' }[tool.t], ws = { pen: PEN, mark: MARK, text: TEXT, erase: ERASE }[tool.t];
    bottom.appendChild(h('span', { class: 'sep' }));
    ws.forEach((w, i) => {
      const d = h('i', null), px = tool.t === 'text' ? 0 : Math.min(26, 4 + i * (tool.t === 'pen' ? 5 : 8));
      if (tool.t === 'text') { d.className = 'letter'; d.textContent = 'A'; d.style.fontSize = (13 + i * 6) + 'px'; } else { d.style.width = d.style.height = px + 'px'; d.style.background = '#1c2b3a'; }
      bottom.appendChild(h('button', { class: 'dot' + (tool[wk] === i ? ' on' : ''), 'aria-label': 'Tamaño ' + (i + 1), click: () => keepTool({ [wk]: i }) }, d));
    });
    bottom.appendChild(h('span', { class: 'sep' }));
    const a = active(), B = (text, ok, fn) => bottom.appendChild(h('button', { disabled: !ok, click: fn }, text));
    B('↶ Deshacer', a && a.undoList.length, () => active().undo());
    B('↷ Rehacer', a && a.redoList.length, () => active().redo());
    // «Enlazar un lápiz» está en Opciones: aquí solo lo que se usa al escribir.
    bottom.appendChild(h('button', { 'aria-label': 'Página anterior', click: () => go(-1) }, '◀'));
    bottom.appendChild(h('button', { 'aria-label': 'Página siguiente', click: () => go(1) }, '▶'));
    bottom.appendChild(h('button', { class: 'main', click: toggleAnnot }, '✓ Listo'));
    if (stageH && bottom.offsetHeight > stageH) { fitStage(); show(true); }
  }

  // --- ajustes de escaneo
  function openAdjust() {
    if (panel) { closePanel(); return; }
    if (!shown) return;
    if (annot) toggleAnnot();
    panel = adjustPanel(view, {
      doc, page: () => page, slot: () => (shown ? shown.slots[0] : null), night: () => lib.prefs.night,
      save: (adj) => change('docs', docId, { adj }),
      preview: (adj, all) => { if (shown) shown.slots.forEach((s, i) => { const own = doc().adj && doc().adj.pages && doc().adj.pages[s.n]; if (!i || (all && !own)) filter(s, adj); }); },
      redraw: () => show(true),
      crop: (on) => { crop = on; bar.classList.toggle('hidden', on); show(true); },
      close: closePanel,
    });
  }
  function closePanel() {
    if (!panel) return;
    const p = panel;
    panel = null;
    p.destroy();
    if (crop) { crop = false; show(true); }
    bar.classList.remove('hidden');
  }

  // --- toques. Un único recorrido: toque = página; arrastre horizontal = página; vertical = desplazar.
  let g = null, lastTouch = 0;
  function layerAt(e) {
    let el = e.target;
    while (el && el !== stage) {
      for (let i = 0; i < layers.length; i++) if (layers[i].slot.el === el) return layers[i];
      el = el.parentNode;
    }
    return null;
  }
  function down(e, id, draws) {
    if (crop) return;
    g = { id, x: e.clientX, y: e.clientY, off: offset, at: Date.now(), layer: null, moved: false };
    if (annot && draws) {
      const l = layerAt(e);
      if (l) { g.layer = l; last = l; l.start(e); }
    }
  }
  function moveTo(e) {
    if (!g) return;
    if (g.layer) { g.layer.move(e); return; }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) g.moved = true;
    if (overflow() && Math.abs(dy) > 8) { offset = Math.max(0, Math.min(overflow(), g.off - dy)); scroll(); }
  }
  function up(e) {
    const s = g;
    g = null;
    if (!s) return;
    if (s.layer) { s.layer.end(); return; }
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.moved) { if (!annot && Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1); return; }
    // Al anotar, el dedo solo pasa página si está reconocido un Apple Pencil.
    if (annot && lib.prefs.hand !== 'stylus') return;
    if (Date.now() - s.at > 900) return;
    const x = e.clientX / (view.clientWidth || 1);
    if (x < 1 / 3) go(-1);
    else if (x > 2 / 3) go(1);
    else if (!annot && !panel) { bar.classList.toggle('hidden'); count.classList.toggle('hidden', false); }
  }
  function abort() { if (g && g.layer) g.layer.cancel(); g = null; }
  const find = (l, id) => { for (let i = 0; i < l.length; i++) if (l[i].identifier === id) return l[i]; return null; };
  stage.addEventListener('touchstart', (e) => {
    e.preventDefault();
    lastTouch = Date.now();
    if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) document.activeElement.blur();
    // iOS puede perder el final de un toque (gestos del sistema): no debe bloquear el lector.
    if (g && g.id !== 'm' && !find(e.touches, g.id)) abort();
    const t = e.changedTouches[0], pen = penTouch(t, lib.prefs);
    if (g) {
      // Con Apple Pencil, la mano apoyada antes no impide escribir.
      if (annot && pen && !g.layer && lib.prefs.hand !== 'finger') { down(t, t.identifier, true); return; }
      if (!annot) abort();
      return;
    }
    down(t, t.identifier, pen);
  }, { passive: false });
  stage.addEventListener('touchmove', (e) => { e.preventDefault(); const t = g && find(e.changedTouches, g.id); if (t) moveTo(t); }, { passive: false });
  stage.addEventListener('touchend', (e) => { e.preventDefault(); lastTouch = Date.now(); const t = g && find(e.changedTouches, g.id); if (t) up(t); }, { passive: false });
  stage.addEventListener('touchcancel', (e) => { if (g && find(e.changedTouches, g.id)) abort(); });
  stage.addEventListener('mousedown', (e) => { if (e.button === 0 && Date.now() - lastTouch > 800) { down(e, 'm', true); e.preventDefault(); } });
  const mm = (e) => { if (g && g.id === 'm') moveTo(e); }, mu = (e) => { if (g && g.id === 'm') up(e); };
  document.addEventListener('mousemove', mm);
  document.addEventListener('mouseup', mu);

  // --- pedal. iOS 10 nombra algunas teclas como UIKeyInput…
  const FWD = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'Right', 'Down', 'UIKeyInputRightArrow', 'UIKeyInputDownArrow', 'UIKeyInputPageDown'];
  const BACK = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Left', 'Up', 'UIKeyInputLeftArrow', 'UIKeyInputUpArrow', 'UIKeyInputPageUp'];
  function onKey(e) {
    if (modalOpen() || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range')) return;
    const k = e.key || '', c = e.keyCode, f = FWD.indexOf(k) >= 0 || [39, 40, 34, 32].indexOf(c) >= 0, b = BACK.indexOf(k) >= 0 || [37, 38, 33].indexOf(c) >= 0;
    if (!f && !b) return;
    e.preventDefault();
    const t = Date.now();
    if (e.repeat || t - navTimer < 150) return;
    navTimer = t;
    go(f ? 1 : -1);
  }
  let timer = 0;
  function onResize() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (annot) fitStage(); if (shown && specKey(page) !== shown.key) { abort(); offset = 0; show(true); } else scroll(); }, 250);
  }

  function exit() {
    if (dead) return;
    closePanel();
    dead = true; token++;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousemove', mm);
    document.removeEventListener('mouseup', mu);
    window.removeEventListener('resize', onResize);
    dropSpread(shown); dropSpread(next);
    shown = next = null;
    db.del('meta', 'session').catch(() => null);
    if (pdf) pdf.close();
    o.onExit();
  }

  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  buildBar();
  if (o.concert) { bar.classList.add('hidden'); view.classList.add('concert'); }
  showHint();
  load(o.page || (o.concert ? 1 : 0));
}
