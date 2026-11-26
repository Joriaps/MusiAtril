// Anotaciones: trazos en coordenadas 0–1 de la página, dibujados en un lienzo transparente.
import { h, now } from './util.js';
import * as db from './db.js';
import { modal } from './ui.js';

export const COLORS = ['#111111', '#d0021b', '#1557c0', '#1a7f37', '#e07b00', '#7b2fb5'];
export const MARKS = ['#ffe100', '#7dff5c', '#5cd6ff', '#ff8ad0'];
// Grosores relativos al ancho de la página.
export const PEN = [0.0015, 0.0026, 0.0042, 0.0075];
export const MARK = [0.012, 0.02, 0.032];
export const TEXT = [0.018, 0.026, 0.038, 0.055];
export const ERASE = [0.008, 0.018, 0.04];
export const MAX_ITEMS = 3000, MAX_POINTS = 4000;

export function loadNotes(id, page) {
  return db.get('notes', id + '/' + page).then((l) => (Array.isArray(l) ? l : []));
}
export function saveNotes(id, page, l) {
  return l.length ? db.put('notes', id + '/' + page, l) : db.del('notes', id + '/' + page);
}

const round = (v) => Math.round(v * 10000) / 10000;
const inRange = (v) => Math.max(-0.2, Math.min(1.2, v));

export function drawItem(x, it, geo, k) {
  const P = (i) => { const r = geo.toCss(it.p[i], it.p[i + 1]); return [r[0] * k, r[1] * k]; };
  const unit = geo.W * geo.s * k;
  x.save();
  if (it.t === 'text') {
    const a = P(0), size = it.w * unit;
    x.fillStyle = it.c;
    x.font = 'bold ' + size + 'px Helvetica, Arial, sans-serif';
    x.textBaseline = 'middle';
    x.fillText(it.s, a[0], a[1]);
  } else {
    x.strokeStyle = it.c;
    x.lineWidth = Math.max(0.6, it.w * unit);
    x.lineJoin = 'round';
    x.lineCap = it.t === 'mark' ? 'butt' : 'round';
    if (it.t === 'mark') x.globalAlpha = 0.4;
    path(x, it.p.length / 2, P);
  }
  x.restore();
}

function path(x, n, P) {
  let a = P(0);
  x.beginPath();
  x.moveTo(a[0], a[1]);
  if (n === 1) x.lineTo(a[0] + 0.1, a[1]);
  for (let i = 1; i < n; i++) {
    const b = P(i * 2);
    if (i === n - 1) x.lineTo(b[0], b[1]); else x.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    a = b;
  }
  x.stroke();
}

const boxes = new WeakMap();
// Distancia de un punto a un trazo, en unidades de ancho de página.
function near(it, u, v, ratio, r) {
  const p = it.p;
  if (it.t === 'text') {
    const w = it.w * it.s.length * 0.6, hh = it.w * 0.7;
    return u > p[0] - r && u < p[0] + w + r && Math.abs(v - p[1]) * ratio < hh + r;
  }
  const R = r + it.w / 2;
  if (!boxes.has(it)) {
    const b = [9, 9, -9, -9];
    for (let i = 0; i < p.length; i += 2) { b[0] = Math.min(b[0], p[i]); b[1] = Math.min(b[1], p[i + 1]); b[2] = Math.max(b[2], p[i]); b[3] = Math.max(b[3], p[i + 1]); }
    boxes.set(it, b);
  }
  const bx = boxes.get(it);
  if (u < bx[0] - R || u > bx[2] + R || (bx[1] - v) * ratio > R || (v - bx[3]) * ratio > R) return false;
  for (let i = 0; i < p.length; i += 2) {
    const j = Math.min(i + 2, p.length - 2);
    const ax = p[i] - u, ay = (p[i + 1] - v) * ratio, dx = p[j] - p[i], dy = (p[j + 1] - p[i + 1]) * ratio, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const X = ax + t * dx, Y = ay + t * dy;
    if (X * X + Y * Y < R * R) return true;
  }
  return false;
}

// Edita las anotaciones de un hueco del lector. tool() devuelve {t, c, w}.
export class NoteLayer {
  constructor(slot, docId, tool, onChange, onError) {
    this.slot = slot; this.docId = docId; this.tool = tool; this.onChange = onChange; this.onError = onError;
    this.items = slot.notes; this.undoList = []; this.redoList = []; this.cur = null;
  }

  paint() { redraw(this.slot, this.items); }

  set(items, keep) {
    if (!keep) { this.undoList.push(this.items); if (this.undoList.length > 60) this.undoList.shift(); this.redoList = []; }
    this.items = this.slot.notes = items;
    this.paint();
    saveNotes(this.docId, this.slot.n, items).catch(this.onError);
    this.onChange();
  }
  undo() { if (this.undoList.length) { this.redoList.push(this.items); this.set(this.undoList.pop(), true); } }
  redo() { if (this.redoList.length) { this.undoList.push(this.items); this.set(this.redoList.pop(), true); } }

  point(e) {
    // Con zoom la página está escalada: el rectángulo se divide por la escala (offsetWidth no la incluye).
    const r = this.slot.el.getBoundingClientRect(), z = r.width / (this.slot.el.offsetWidth || r.width) || 1;
    const q = this.slot.geo.toPage((e.clientX - r.left) / z, (e.clientY - r.top) / z);
    return [round(inRange(q[0])), round(inRange(q[1]))];
  }

  start(e) {
    const t = this.tool(), p = this.point(e);
    if (this.items.length >= MAX_ITEMS && t.t !== 'erase') { this.onError(new Error('Esta página ya tiene demasiadas anotaciones.')); return; }
    if (t.t === 'erase') { this.cur = { erase: true, before: this.items, w: t.w, last: p }; this.erase(p); return; }
    if (t.t === 'text') { this.cur = { text: true, p }; return; }
    this.cur = { it: { t: t.t, c: t.c, w: t.w, p: p.slice() }, at: now() };
    ensureOverlay(this.slot);
  }

  move(e) {
    const c = this.cur;
    if (!c) return;
    const p = this.point(e);
    if (c.erase) {
      // En gestos rápidos iOS da pocos puntos: se rellena el camino.
      const a = c.last, n = Math.min(40, Math.ceil(Math.max(Math.abs(p[0] - a[0]), Math.abs(p[1] - a[1])) / (c.w * 0.8)) || 1);
      for (let i = 1; i <= n; i++) this.erase([a[0] + (p[0] - a[0]) * i / n, a[1] + (p[1] - a[1]) * i / n]);
      c.last = p;
      return;
    }
    if (c.text) return;
    const q = c.it.p, n = q.length;
    if (n / 2 >= MAX_POINTS) return;
    const dx = p[0] - q[n - 2], dy = p[1] - q[n - 1];
    if (dx * dx + dy * dy < 0.0000008) return;
    q.push(p[0], p[1]);
    // En vivo solo se añade el tramo nuevo; al soltar se redibuja limpio.
    const s = this.slot, x = s.over.getContext('2d'), m = q.length;
    drawItem(x, { t: c.it.t, c: c.it.c, w: c.it.w, p: m >= 6 ? q.slice(m - 6) : q }, s.geo, s.over.width / s.geo.cssW);
  }

  erase(p) {
    const ratio = this.slot.geo.H / this.slot.geo.W, r = this.cur.w;
    const left = this.items.filter((it) => !near(it, p[0], p[1], ratio, r));
    if (left.length !== this.items.length) { this.items = this.slot.notes = left; this.paint(); }
  }

  end() {
    const c = this.cur;
    this.cur = null;
    if (!c) return;
    if (c.erase) {
      if (c.before !== this.items) { const after = this.items; this.items = c.before; this.set(after); }
      return;
    }
    if (c.text) { this.askText(c.p); return; }
    this.set(this.items.concat([c.it]));
  }

  cancel() {
    const c = this.cur;
    this.cur = null;
    if (!c) return;
    if (c.erase) this.items = this.slot.notes = c.before;
    this.paint();
  }

  askText(p) {
    const t = this.tool();
    const input = h('input', { type: 'text', maxlength: '60', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off' });
    const keys = h('div', { class: 'keys' });
    ['1', '2', '3', '4', '5', '0', 'p', 'i', 'm', 'a', 'V', '⊓', 'f', 'mf', 'cresc.', 'rit.'].forEach((k) => keys.appendChild(h('button', { click: () => { input.value += k; } }, k)));
    const add = () => {
      const s = input.value.trim();
      if (s) this.set(this.items.concat([{ t: 'text', c: t.c, w: t.w, p, s }]));
    };
    const close = modal('Texto o digitación', h('div', null, h('label', { class: 'field' }, h('span', { text: 'Texto' }), input), keys), [{ text: 'Cancelar', fn: () => null }, { text: 'Poner', class: 'main', fn: add }]);
    input.addEventListener('keydown', (e) => { if (e.keyCode === 13) { e.preventDefault(); add(); close(); } });
  }
}

export function ensureOverlay(slot) {
  if (slot.over) return;
  const g = slot.geo, k = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2200000 / (g.cssW * g.cssH)));
  const c = slot.over = document.createElement('canvas');
  c.className = 'over';
  c.width = Math.max(1, Math.floor(g.cssW * k));
  c.height = Math.max(1, Math.floor(g.cssH * k));
  c.style.width = g.cssW + 'px';
  c.style.height = g.cssH + 'px';
  slot.el.appendChild(c);
}

export function redraw(slot, items) {
  if (!items.length && !slot.over) return;
  ensureOverlay(slot);
  const c = slot.over, x = c.getContext('2d'), k = c.width / slot.geo.cssW;
  x.clearRect(0, 0, c.width, c.height);
  items.forEach((it) => drawItem(x, it, slot.geo, k));
}

// --- Lápiz -------------------------------------------------------------------------------
// Safari no puede emparejar lápices Bluetooth. Sí distingue el Apple Pencil (touchType) y, con
// un lápiz capacitivo, el tamaño del contacto, que es mucho menor que el de la palma.
const radius = (t) => t.radiusX || t.webkitRadiusX || 0;
export function penTouch(t, prefs) {
  if (prefs.hand === 'stylus') return t.touchType === 'stylus';
  if (prefs.hand === 'cap' && prefs.radius) return !(radius(t) > prefs.radius);
  return true;
}

export function pairPen(prefs, save) {
  const pad = h('div', { class: 'pad' }, h('span', { text: 'Toca aquí 5 veces con la punta del lápiz' }));
  const state = h('p', { text: 'Contactos: 0 de 5' });
  let n = 0, r = 0, stylus = 0, seen = false;
  const done = () => {
    if (stylus >= 4) { save('stylus', 0); state.textContent = '✓ Apple Pencil reconocido. Solo escribe el lápiz; con el dedo se pasa de página.'; }
    else if (seen && r > 0) { save('cap', Math.round((r * 1.8 + 4) * 10) / 10); state.textContent = '✓ Lápiz guardado (contacto de ' + r.toFixed(1) + '). Se ignoran los contactos mayores, como la palma.'; }
    else { save('finger', 0); state.textContent = 'Este iPad no informa del tamaño del contacto: se usará cualquier toque, y solo el primero si apoyas la mano.'; }
  };
  pad.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (n >= 5) return;
    const t = e.changedTouches[0];
    n++;
    if (t.touchType === 'stylus') stylus++;
    if (radius(t) > 0) { seen = true; r = Math.max(r, radius(t)); }
    state.textContent = 'Contactos: ' + n + ' de 5';
    if (n === 5) done();
  });
  modal('Enlazar un lápiz', h('div', null,
    h('p', { text: 'Sirven los lápices de punta de goma o disco y, en un iPad Pro, el Apple Pencil. Los lápices Bluetooth de otras marcas escriben, pero sin presión ni botones: Safari no da acceso a ellos.' }),
    pad, state), [
    { text: 'Escribir con el dedo', fn: () => save('finger', 0) }, { text: 'Hecho', class: 'main', fn: () => null }]);
}
