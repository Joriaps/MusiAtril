// Ventanas, avisos y listas de acciones.
import { h, clear } from './util.js';

let toastEl = null, toastTimer = 0;
export function toast(text, long) {
  if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
  toastEl = h('div', { class: 'toast', text });
  document.body.appendChild(toastEl);
  clearTimeout(toastTimer);
  const mine = toastEl;
  // Tiempo de sobra para leerlo con calma.
  toastTimer = setTimeout(() => { if (mine.parentNode) mine.parentNode.removeChild(mine); }, long ? 9000 : 4500);
}
export function oops(e) { toast(e && e.message || String(e), true); }

let open = 0;
export function modalOpen() { return open > 0; }

export function modal(title, body, buttons, onClose) {
  let done = false;
  const close = () => {
    if (done) return;
    done = true; open--;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (back.parentNode) back.parentNode.removeChild(back);
  };
  const cancel = () => { if (done) return; close(); if (onClose) onClose(); };
  const foot = h('div', { class: 'foot' });
  (buttons || []).forEach((b) => foot.appendChild(h('button', { class: b.class || '', click: () => { if (b.fn(close) !== false) close(); } }, b.text)));
  const back = h('div', { class: 'back' }, h('div', { class: 'modal' },
    h('div', { class: 'mhead' }, h('b', { class: 'grow', text: title }), h('button', { class: 'flat', 'aria-label': 'Cerrar', click: cancel }, '✕')),
    h('div', { class: 'mbody scroll' }, body), foot));
  back.addEventListener('click', (e) => { if (e.target === back) cancel(); });
  open++;
  document.body.appendChild(back);
  return close;
}

export function confirmar(title, text, yes, danger) {
  return new Promise((ok) => modal(title, h('p', { text }), [
    { text: 'Cancelar', fn: () => ok(false) },
    { text: yes || 'Aceptar', class: danger ? 'danger' : 'main', fn: () => ok(true) },
  ], () => ok(false)));
}

// campos: [{k, label, value, type, max, hint}] → objeto o null
export function pedir(title, fields, yes, extra) {
  return new Promise((ok) => {
    const ins = {}, box = h('div', null);
    fields.forEach((f) => {
      const i = ins[f.k] = h('input', { type: f.type || 'text', maxlength: String(f.max || 120), autocomplete: 'off', autocorrect: f.type ? 'off' : null, pattern: f.pattern, placeholder: f.hint });
      i.value = f.value || '';
      box.appendChild(h('label', { class: 'field' }, h('span', { text: f.label }), i));
    });
    if (extra) box.appendChild(extra(ins));
    const send = () => { const o = {}; fields.forEach((f) => { o[f.k] = ins[f.k].value.trim(); }); ok(o); };
    const close = modal(title, box, [{ text: 'Cancelar', fn: () => ok(null) }, { text: yes || 'Guardar', class: 'main', fn: send }], () => ok(null));
    const first = ins[fields[0].k];
    box.addEventListener('keydown', (e) => { if (e.keyCode === 13) { e.preventDefault(); send(); close(); } });
    try { first.focus(); } catch (e) { /* iOS puede negarse */ }
  });
}

export function acciones(title, list) {
  const box = h('div', { class: 'sheet' });
  const close = modal(title, box, []);
  list.filter(Boolean).forEach((a) => box.appendChild(h('button', { class: a.danger ? 'danger' : '', click: () => { close(); a.fn(); } }, a.text)));
}

// Elegir una opción: [{v, text, depth}] → v, o undefined si se cancela
export function elegir(title, list) {
  return new Promise((ok) => {
    const box = h('div', { class: 'sheet' });
    const close = modal(title, box, [], () => ok(undefined));
    list.forEach((o) => {
      const b = h('button', { class: 'left', click: () => { close(); ok(o.v); } }, o.text);
      if (o.depth) b.style.paddingLeft = (18 + o.depth * 24) + 'px';
      box.appendChild(b);
    });
    if (!list.length) box.appendChild(h('p', { text: 'No hay nada que elegir.' }));
  });
}

export function progreso(title, onCancel) {
  const bar = h('div', { class: 'fill' }), text = h('p', { class: 'ptext' }), log = h('div', { class: 'plog' });
  const close = modal(title, h('div', null, text, h('div', { class: 'pbar' }, bar), log), [{ text: 'Cancelar', fn: () => { text.textContent = 'Cancelando…'; onCancel(); return false; } }], onCancel);
  return {
    set: (f, t) => { bar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; if (t) text.textContent = t; },
    log: (t) => log.appendChild(h('div', { text: t })),
    close,
  };
}
export { clear };
