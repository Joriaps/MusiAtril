// Panel de ajustes para escaneos malos. No toca el PDF: solo guarda números.
import { h, clear } from './util.js';
import { adjust, DEFAULTS } from './geometry.js';
import { oops, toast, elegir } from './ui.js';

export function adjustPanel(view, o) {
  let shownPage = o.page(), timer = 0, cropUi = null, scope = hasOwn() ? 'page' : 'all', cur = adjust(o.doc(), shownPage);
  const box = h('div', { class: 'panel' });
  view.appendChild(box);

  function hasOwn() { const a = o.doc().adj; return !!(a && a.pages && a.pages[shownPage]); }

  function store() {
    const d = o.doc(), old = d.adj || {}, pages = Object.assign({}, old.pages), clean = {};
    Object.keys(DEFAULTS).forEach((k) => { if (cur[k] !== DEFAULTS[k]) clean[k] = cur[k]; });
    const adj = { all: old.all || {}, pages };
    if (scope === 'page') pages[shownPage] = clean;
    else { adj.all = clean; delete pages[shownPage]; }
    return o.save(adj).catch(oops);
  }
  // Brillo y contraste se ven al instante con filtros; lo demás se vuelve a dibujar al parar.
  function changed(k, v, live) {
    const had = cur.wh;
    cur[k] = v;
    clearTimeout(timer);
    const cheap = ['b', 'c', 'g', 'i'].indexOf(k) >= 0 && !cur.wh && !had;
    if (cheap) o.preview(cur, scope === 'all');
    timer = setTimeout(() => { timer = 0; store().then(() => { if (!cheap) o.redraw(); }); }, live ? 350 : 30);
  }

  function slider(label, k, min, max, stp, unit) {
    const val = h('span', { class: 'val' }), i = h('input', { type: 'range', min: String(min), max: String(max), step: String(stp) });
    i.value = String(cur[k]);
    const t = () => { val.textContent = String(cur[k]).replace('.', ',') + (unit || ''); };
    i.addEventListener('input', () => { changed(k, Number(i.value), true); t(); });
    t();
    return h('div', { class: 'srow' }, h('span', { class: 'slab', text: label }), i, val,
      h('button', { class: 'flat', 'aria-label': 'Poner a cero', click: () => { changed(k, DEFAULTS[k]); draw(); } }, '↺'));
  }
  const toggle = (label, k) => h('button', { class: cur[k] ? 'on' : '', click: () => { changed(k, cur[k] ? 0 : 1); draw(); } }, label);

  function draw() {
    clear(box);
    const setScope = (s) => {
      if (s === scope) return;
      const apply = () => { scope = s; store().then(() => { draw(); o.redraw(); }); };
      if (s === 'page') { apply(); return; }
      elegir('Esta página tiene ajustes propios', [{ v: 1, text: 'Usarlos en toda la partitura' }, { v: 2, text: 'Quitarlos y usar los de toda la partitura' }]).then((v) => {
        if (!v) return;
        if (v === 2) cur = Object.assign({}, DEFAULTS, (o.doc().adj || {}).all);
        apply();
      });
    };
    box.appendChild(h('div', { class: 'tools' },
      h('button', { class: scope === 'all' ? 'on' : '', click: () => setScope('all') }, 'Toda la partitura'),
      h('button', { class: scope === 'page' ? 'on' : '', click: () => setScope('page') }, 'Solo la página ' + o.page()),
      h('span', { class: 'grow' }), h('button', { class: 'main', click: o.close }, 'Listo')));
    box.appendChild(slider('Brillo', 'b', -60, 60, 5));
    box.appendChild(slider('Contraste', 'c', -60, 100, 5));
    box.appendChild(slider('Blanquear fondo', 'wh', 0, 100, 5));
    box.appendChild(slider('Enderezar', 'skew', -5, 5, 0.1, '°'));
    box.appendChild(h('div', { class: 'tools' }, toggle('Grises', 'g'), toggle('Invertir', 'i'),
      h('button', { click: () => rotate(-90) }, '⟲ 90°'), h('button', { click: () => rotate(90) }, '⟳ 90°'),
      h('button', { click: startCrop }, 'Recortar márgenes'),
      h('button', { click: () => { cur = Object.assign({}, DEFAULTS); store().then(() => { draw(); o.redraw(); }); } }, 'Quitar ajustes')));
  }
  // Al girar, el recorte gira con la página.
  function rotate(d) {
    const { x, y, w, h: hh } = cur;
    if (d > 0) { cur.x = 1 - y - hh; cur.y = x; } else { cur.x = y; cur.y = 1 - x - w; }
    cur.w = hh; cur.h = w;
    ['x', 'y'].forEach((k) => { cur[k] = Math.max(0, Math.round(cur[k] * 10000) / 10000); });
    changed('rot', (cur.rot + d + 360) % 360);
  }

  function startCrop() {
    clearTimeout(timer);
    store().then(() => {
      box.classList.add('hidden');
      cropUi = { r: { x: cur.x, y: cur.y, w: cur.w, h: cur.h } };
      o.crop(true);
    });
  }
  // Se llama cuando la página sin recortar ya está dibujada.
  function drawCrop() {
    const slot = o.slot();
    if (!slot) return;
    const W = slot.geo.cssW, H = slot.geo.cssH, r = cropUi.r, page = slot.n;
    if (cropUi.foot && cropUi.foot.parentNode) cropUi.foot.parentNode.removeChild(cropUi.foot);
    const frame = h('div', { class: 'crop' }), hs = {};
    const place = () => {
      frame.style.left = r.x * W + 'px'; frame.style.top = r.y * H + 'px';
      frame.style.width = r.w * W + 'px'; frame.style.height = r.h * H + 'px';
    };
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((k) => { hs[k] = h('div', { class: 'hd hd-' + k }); frame.appendChild(hs[k]); drag(hs[k], k); });
    drag(frame, 'move');
    function drag(el, k) {
      let s = null;
      const start = (e, p) => { e.preventDefault(); e.stopPropagation(); s = { x: p.clientX, y: p.clientY, r: Object.assign({}, r) }; };
      const move = (p) => {
        if (!s) return;
        const dx = (p.clientX - s.x) / W, dy = (p.clientY - s.y) / H, M = 0.15;
        let l = s.r.x, t = s.r.y, R = s.r.x + s.r.w, B = s.r.y + s.r.h;
        if (k === 'move') { const mx = Math.max(-l, Math.min(1 - R, dx)), my = Math.max(-t, Math.min(1 - B, dy)); l += mx; R += mx; t += my; B += my; }
        else {
          if (k.indexOf('w') >= 0) l = Math.max(0, Math.min(R - M, l + dx));
          if (k.indexOf('e') >= 0) R = Math.min(1, Math.max(l + M, R + dx));
          if (k.indexOf('n') >= 0) t = Math.max(0, Math.min(B - M, t + dy));
          if (k.indexOf('s') >= 0) B = Math.min(1, Math.max(t + M, B + dy));
        }
        r.x = l; r.y = t; r.w = R - l; r.h = B - t;
        place();
      };
      el.addEventListener('touchstart', (e) => start(e, e.touches[0]));
      el.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); move(e.touches[0]); });
      el.addEventListener('touchend', (e) => { e.stopPropagation(); s = null; });
      el.addEventListener('touchcancel', () => { s = null; });
      el.addEventListener('mousedown', (e) => {
        start(e, e);
        const mv = (x) => move(x), up = () => { s = null; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
      });
    }
    place();
    slot.el.style.overflow = 'visible';
    slot.el.appendChild(frame);
    const end = (ok) => {
      const f = cropUi.foot;
      if (f.parentNode) f.parentNode.removeChild(f);
      cropUi = null;
      if (ok) { const rr = (v) => Math.round(v * 10000) / 10000; cur.x = rr(r.x); cur.y = rr(r.y); cur.w = Math.min(rr(r.w), rr(1 - rr(r.x))); cur.h = Math.min(rr(r.h), rr(1 - rr(r.y))); }
      store().then(() => { box.classList.remove('hidden'); o.crop(false); if (ok) toast(scope === 'all' ? 'Recorte aplicado a toda la partitura' : 'Recorte aplicado a la página ' + page); });
    };
    cropUi.foot = h('div', { class: 'cropfoot' }, h('button', { click: () => end(false) }, 'Cancelar'),
      h('button', { click: () => { r.x = r.y = 0; r.w = r.h = 1; place(); } }, 'Página completa'), h('button', { class: 'main', click: () => end(true) }, 'Aplicar recorte'));
    view.appendChild(cropUi.foot);
  }

  draw();
  return {
    // La página se ha vuelto a dibujar o se ha cambiado de página.
    refresh: () => {
      if (cropUi) { drawCrop(); return; }
      if (shownPage === o.page()) return;
      if (timer) { clearTimeout(timer); timer = 0; store(); }
      shownPage = o.page();
      scope = hasOwn() ? 'page' : 'all';
      cur = adjust(o.doc(), shownPage);
      draw();
    },
    destroy: () => {
      clearTimeout(timer);
      if (cropUi && cropUi.foot && cropUi.foot.parentNode) cropUi.foot.parentNode.removeChild(cropUi.foot);
      store();
      if (box.parentNode) box.parentNode.removeChild(box);
    },
  };
}
