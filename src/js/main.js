import { h, clear } from './util.js';
import { load, lib } from './lib.js';
import * as db from './db.js';
import { start, home, read } from './library.js';
import { play } from './concerts.js';
import { sweep } from './importer.js';
import { watchOffline } from './offline.js';

const root = document.getElementById('app');

// --- Sin zoom, sin rebote ---
['gesturestart', 'gesturechange', 'gestureend'].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));
document.addEventListener('touchmove', (e) => {
  let el = e.target;
  if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
  while (el && el !== document.body) {
    if (el.classList && (el.classList.contains('scroll') || el.classList.contains('abar')) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) return;
    el = el.parentNode;
  }
  e.preventDefault();
}, { passive: false });
// En los extremos de una lista, iOS arrastra toda la página: se separa 1 px del borde.
document.addEventListener('touchstart', (e) => {
  let el = e.target;
  while (el && el.classList && !el.classList.contains('scroll')) el = el.parentNode;
  if (!el || !el.classList) return;
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return;
  if (el.scrollTop <= 0) el.scrollTop = 1;
  else if (el.scrollTop >= max) el.scrollTop = max - 1;
}, { passive: true });

watchOffline();
start(root);
load().then(() => {
  sweep().catch(() => null);
  return db.get('meta', 'session');
}).then((s) => {
  // Si iOS cerró la app con una partitura abierta, se vuelve a ella.
  if (s && s.concert && lib.concerts[s.concert]) play(root, s.concert, s.index || 0, s.page || 1, home);
  else if (s && lib.docs[s.doc] && lib.docs[s.doc].blob) read(lib.docs[s.doc], s.page);
  else home();
}).catch((e) => {
  clear(root).appendChild(h('div', { class: 'screen' }, h('h1', { text: 'No se pueden abrir los datos' }),
    h('p', { text: e && e.message || String(e) }), h('p', { text: 'Reinicia el iPad y abre Atril otra vez desde el icono. No borres el icono.' }),
    h('button', { click: () => location.reload() }, 'Reintentar')));
});
