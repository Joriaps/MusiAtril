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
  let shown = null, next = null, prev = null, offset = 0, annot = false, panel = null, layers = [], crop = false, wantEnd = false, navTimer = 0;
  // Zoom con dos dedos: escala y desplazamiento de la página mostrada. Se vuelve a 1 al cambiar de página.
  let zoom = 1, panX = 0, panY = 0, pinch = null, barTimer = 0;
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
    // En concierto no se edita, pero sí se salta a otra obra o a una página de la obra actual.
    if (o.concert) { bar.appendChild(h('button', { click: pickWork }, 'Otra obra')); bar.appendChild(h('button', { click: pickPage }, 'Ir a página')); return; }
    bar.appendChild(h('button', { class: annot ? 'on' : '', click: toggleAnnot }, '✎ Anotar'));
    bar.appendChild(h('button', { click: pickPage }, 'Ir a página'));
    bar.appendChild(h('button', { click: moreMenu }, 'Más'));
  }
  // La barra tapa el principio de la página: se esconde sola a los 5 s y al pasar página.
  function hideBarLater(ms) {
    clearTimeout(barTimer);
    barTimer = setTimeout(() => {
      if (dead || annot || panel || crop || !pdf) return;
      if (modalOpen()) { hideBarLater(2000); return; }
      bar.classList.add('hidden');
    }, ms || 5000);
  }
  function hideBar() { clearTimeout(barTimer); if (!annot && !panel && !crop) bar.classList.add('hidden'); }
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
    // La siguiente (y en la web también la anterior) ya están dibujadas: el cambio es inmediato.
    const k = specKey(page);
    if (!refresh && next && next.key === k) { const n = next; next = null; place(n); ahead(t); return; }
    if (!refresh && prev && prev.key === k) { const n = prev; prev = null; place(n); ahead(t); return; }
    dropSpread(next); next = null;
    dropSpread(prev); prev = null;
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
    if (old && old !== s) keep(old);
    layers = s.slots.map((slot) => { const l = new NoteLayer(slot, docId, currentTool, refreshUndo, oops); return l; });
    if (annot) s.slots.forEach((x) => redraw(x, x.notes));
    const room = overflow();
    if (wantEnd) { offset = room; wantEnd = false; }
    offset = Math.max(0, Math.min(room, offset));
    zoom = 1; panX = panY = 0;
    scroll();
    refreshUndo();
    if (panel) panel.refresh();
  }
  // La página que se deja no se tira si es la de al lado: volver a ella es inmediato.
  function keep(old) {
    if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    if (old.key === specKey(page + step())) { if (next !== old) dropSpread(next); next = old; return; }
    if (__WEB__ && old.key === specKey(page - step())) { if (prev !== old) dropSpread(prev); prev = old; return; }
    dropSpread(old);
  }
  function overflow() { return shown && lib.prefs.fit === 'width' && shown.slots[0] ? Math.max(0, shown.slots[0].geo.cssH - size()[1]) : 0; }
  function scroll() {
    if (!shown) return;
    const room = overflow(), s = size(), hh = shown.slots[0] ? shown.slots[0].geo.cssH : 0;
    const top = room ? 0 : Math.max(0, Math.floor((s[1] - hh) / 2));
    shown.el.style.top = top + 'px';
    if (zoom <= 1.02) { zoom = 1; panX = panY = 0; } else {
      // Con zoom, la página no puede despegarse de los bordes; si cabe en alto, se centra.
      const base = top - offset, ch = zoom * hh;
      panX = Math.min(0, Math.max(s[0] - zoom * s[0], panX));
      panY = ch >= s[1] ? Math.min(-base, Math.max(s[1] - ch - base, panY)) : (s[1] - ch) / 2 - base;
    }
    shown.el.style.webkitTransform = shown.el.style.transform = 'translate3d(' + Math.round(panX) + 'px,' + Math.round(panY - offset) + 'px,0)' + (zoom > 1 ? ' scale(' + zoom + ')' : '');
  }
  function ahead(t) {
    if (crop) return;
    const want = () => t === token && !dead, n = page + step(), b = page - step();
    let p = Promise.resolve();
    if (n <= pdf.pages && !(next && next.key === specKey(n))) {
      p = p.then(() => { dropSpread(next); next = null; return build(n, want).then((s) => { if (s) next = s; }, () => null); });
    }
    // En la web (iPad con más memoria) también se prepara la anterior.
    if (__WEB__ && b >= 1) {
      p.then(() => {
        if (!want() || (prev && prev.key === specKey(b))) return null;
        dropSpread(prev); prev = null;
        return build(b, want).then((s) => { if (s) prev = s; }, () => null);
      });
    }
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
    // En la última y en la primera página no se avisa: simplemente no pasa nada.
    if (p > pdf.pages) {
      if (o.concert && index < o.list.length - 1) goWork(index + 1, 1);
      return;
    }
    if (p < 1 && page === 1) {
      if (o.concert && index > 0) goWork(index - 1, -1);
      return;
    }
    hideBar();
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
    dropSpread(next); next = null; dropSpread(prev); prev = null; layers = [];
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
      if (!bar.classList.contains('hidden')) hideBarLater();
    }).catch((e) => {
      busy = false;
      if (dead || mine !== docId) return;
      dropSpread(shown); shown = null;
      msg.textContent = 'No se puede abrir: ' + (e && e.name === 'PasswordException' ? 'el PDF tiene contraseña' : e && e.message || e);
      clearTimeout(barTimer);
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
    if (!annot) hideBarLater();
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
  // Tras cada trazo solo cambian Deshacer y Rehacer: rehacer toda la barra se comía el toque en un color.
  let undoBtn = null, redoBtn = null;
  function refreshUndo() {
    if (!annot) return;
    if (!undoBtn || !undoBtn.parentNode) { buildTools(); return; }
    const a = active();
    undoBtn.disabled = !(a && a.undoList.length);
    redoBtn.disabled = !(a && a.redoList.length);
  }
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
    undoBtn = B('↶ Deshacer', a && a.undoList.length, () => active().undo());
    redoBtn = B('↷ Rehacer', a && a.redoList.length, () => active().redo());
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
    hideBarLater();
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
    g = { id, x: e.clientX, y: e.clientY, off: offset, px: panX, py: panY, layer: null, far: false, scrolled: false };
    if (annot && draws) {
      const l = layerAt(e);
      if (l) { g.layer = l; last = l; l.start(e); }
    }
  }
  function moveTo(e) {
    if (!g) return;
    if (g.layer) { g.layer.move(e); return; }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    // El dedo tiembla al pulsar: hasta 40 px sigue siendo un toque.
    if (Math.abs(dx) > 40 || Math.abs(dy) > 40) g.far = true;
    // Con zoom, arrastrar mueve la página en vez de pasarla.
    if (zoom > 1) { if (Math.abs(dx) > 10 || Math.abs(dy) > 10) g.scrolled = true; panX = g.px + dx; panY = g.py + dy; scroll(); return; }
    if (overflow() && Math.abs(dy) > 8) { offset = Math.max(0, Math.min(overflow(), g.off - dy)); g.scrolled = true; scroll(); }
  }
  function up(e) {
    const s = g;
    g = null;
    if (!s) return;
    if (s.layer) { s.layer.end(); return; }
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.scrolled) return;
    if (s.far) { if (!annot && Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1); return; }
    // Al anotar, el dedo solo pasa página si está reconocido un Apple Pencil.
    if (annot && lib.prefs.hand !== 'stylus') return;
    const x = e.clientX / (view.clientWidth || 1);
    if (x < 1 / 3) go(-1);
    else if (x > 2 / 3) go(1);
    else if (!annot && !panel) {
      if (!bar.classList.toggle('hidden')) hideBarLater();
      count.classList.toggle('hidden', false);
    }
  }
  function abort() { if (g && g.layer) g.layer.cancel(); g = null; }

  // --- zoom con dos dedos (de 1 a 4 veces), alrededor del punto entre los dedos.
  const dist = (a, b) => Math.sqrt(Math.pow(a.clientX - b.clientX, 2) + Math.pow(a.clientY - b.clientY, 2));
  function startPinch(l) {
    abort();
    const r = stage.getBoundingClientRect();
    pinch = { d: Math.max(10, dist(l[0], l[1])), mx: (l[0].clientX + l[1].clientX) / 2 - r.left, my: (l[0].clientY + l[1].clientY) / 2 - r.top, z: zoom, px: panX, py: panY };
  }
  function movePinch(l) {
    if (!shown) return;
    const r = stage.getBoundingClientRect(), base = (parseFloat(shown.el.style.top) || 0) - offset;
    const z = Math.max(1, Math.min(4, pinch.z * dist(l[0], l[1]) / pinch.d));
    const mx = (l[0].clientX + l[1].clientX) / 2 - r.left, my = (l[0].clientY + l[1].clientY) / 2 - r.top;
    // El punto de la partitura que estaba entre los dedos sigue entre los dedos.
    panX = mx - z * (pinch.mx - pinch.px) / pinch.z;
    panY = my - base - z * (pinch.my - base - pinch.py) / pinch.z;
    zoom = z;
    scroll();
  }
  const find = (l, id) => { for (let i = 0; i < l.length; i++) if (l[i].identifier === id) return l[i]; return null; };
  stage.addEventListener('touchstart', (e) => {
    e.preventDefault();
    lastTouch = Date.now();
    if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) document.activeElement.blur();
    // Tras un zoom no se hace nada hasta levantar todos los dedos.
    if (pinch) return;
    // iOS puede perder el final de un toque (gestos del sistema): no debe bloquear el lector.
    if (g && g.id !== 'm' && !find(e.touches, g.id)) abort();
    const t = e.changedTouches[0], pen = penTouch(t, lib.prefs);
    // Dos dedos: zoom. Con un lápiz enlazado, el lápiz que llega con la mano apoyada sigue escribiendo.
    if (e.touches.length >= 2 && !crop && shown && !(annot && pen && lib.prefs.hand !== 'finger')) { startPinch(e.touches); return; }
    if (g) {
      // Con Apple Pencil, la mano apoyada antes no impide escribir.
      if (annot && pen && !g.layer && lib.prefs.hand !== 'finger') { down(t, t.identifier, true); return; }
      if (!annot) abort();
      return;
    }
    down(t, t.identifier, pen);
  }, { passive: false });
  stage.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (pinch) { if (e.touches.length >= 2) movePinch(e.touches); return; }
    const t = g && find(e.changedTouches, g.id);
    if (t) moveTo(t);
  }, { passive: false });
  stage.addEventListener('touchend', (e) => {
    e.preventDefault();
    lastTouch = Date.now();
    if (pinch) { if (!e.touches.length) pinch = null; return; }
    const t = g && find(e.changedTouches, g.id);
    if (t) up(t);
  }, { passive: false });
  stage.addEventListener('touchcancel', (e) => { if (pinch && !e.touches.length) pinch = null; if (g && find(e.changedTouches, g.id)) abort(); });
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
    timer = setTimeout(() => { zoom = 1; panX = panY = 0; pinch = null; if (annot) fitStage(); if (shown && specKey(page) !== shown.key) { abort(); offset = 0; show(true); } else scroll(); }, 250);
  }

  function exit() {
    if (dead) return;
    closePanel();
    dead = true; token++;
    clearTimeout(timer); clearTimeout(barTimer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousemove', mm);
    document.removeEventListener('mouseup', mu);
    window.removeEventListener('resize', onResize);
    dropSpread(shown); dropSpread(next); dropSpread(prev);
    shown = next = prev = null;
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
