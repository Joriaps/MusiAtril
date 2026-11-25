// Estado sin conexión: AppCache en la versión del PC (iOS 10) y service worker en la web (iOS 13 o posterior).
// En navegadores modernos servidos desde el PC (pruebas) AppCache no existe y se indica.
import { h, clear } from './util.js';
import { toast } from './ui.js';

let state = { state: 'busy', text: '' }, card = null, reloadOnSwap = false;
function paint() {
  if (!card) return;
  clear(card);
  card.className = 'card state-' + state.state;
  card.appendChild(h('span', { class: 'grow', text: state.text }));
  if (state.state === 'update') card.appendChild(h('button', { click: applyUpdate }, 'Actualizar ahora'));
}
export function offlineCard() {
  card = h('div', { class: 'card' });
  paint();
  return card;
}

function set(st, text) {
  state = { state: st, text };
  paint();
  if (st === 'error') toast(text, true);
  if (st === 'update') toast('Hay una versión nueva: «Copias y opciones» › Actualizar ahora.', true);
  if (text.indexOf('Lista: ya') === 0) toast(text, true);
}

export function watchOffline() {
  if (__WEB__) { watchWorker(); return; }
  const c = window.applicationCache;
  if (!c) { set('none', 'Este navegador no tiene AppCache: aquí no se guarda sin conexión.'); return; }
  const ev = (name, fn) => c.addEventListener(name, fn, false);
  ev('checking', () => set('busy', 'Comprobando si hay versión nueva…'));
  ev('downloading', () => set('busy', 'Descargando la app…'));
  ev('progress', (e) => set('busy', e.lengthComputable && e.total
    ? 'Guardando la app: ' + e.loaded + ' de ' + e.total : 'Guardando la app…'));
  ev('cached', () => set('ok', 'Lista: ya funciona sin conexión.'));
  ev('noupdate', () => set('ok', 'Lista sin conexión. No hay versión nueva.'));
  ev('updateready', () => set('update', 'Versión nueva descargada.'));
  ev('obsolete', () => set('error', 'El servidor ha retirado la app de este iPad. No cierres la app: vuelve a encender el servidor correcto y recarga.'));
  ev('error', () => {
    // Con el PC apagado la comprobación falla siempre: si ya hay caché, es lo normal.
    if (c.status === c.UNCACHED) set('error', 'No se ha podido guardar la app. Revisa que el servidor siga encendido y recarga.');
    else set('ok', 'Funcionando sin conexión.');
  });
  // Si el evento llegó antes de ejecutarse este script:
  if (c.status === c.IDLE) set('ok', 'Lista: ya funciona sin conexión.');
  else if (c.status === c.UPDATEREADY) set('update', 'Versión nueva descargada.');
  else if (c.status === c.OBSOLETE) set('error', 'La copia sin conexión ya no es válida.');
  else set('busy', 'Guardando la app para usarla sin conexión…');
}

// Versión web. La versión nueva se descarga sola al abrir con conexión y espera a «Actualizar ahora».
function watchWorker() {
  const sw = navigator.serviceWorker;
  if (!sw) { set('error', 'Este navegador no puede guardar la app sin conexión. Ábrela en Safari.'); return; }
  // La primera instalación también cambia de controlador: solo se recarga si lo pidió el usuario.
  sw.addEventListener('controllerchange', () => { if (reloadOnSwap) window.location.reload(); });
  const follow = (w) => {
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') {
        if (sw.controller) set('update', 'Versión nueva descargada.');
        else set('ok', 'Lista: ya funciona sin conexión.');
      } else if (w.state === 'redundant' && !sw.controller) set('error', 'No se ha podido guardar la app. Revisa la conexión y recarga.');
    });
  };
  set('busy', 'Guardando la app para usarla sin conexión…');
  sw.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      if (sw.controller) set('busy', 'Descargando la versión nueva…');
      follow(reg.installing);
    });
    if (reg.waiting && sw.controller) set('update', 'Versión nueva descargada.');
    else if (reg.installing) follow(reg.installing);
    else if (reg.active) set('ok', 'Lista sin conexión.');
  }, () => {
    if (sw.controller) set('ok', 'Funcionando sin conexión.');
    else set('error', 'No se ha podido guardar la app. Revisa la conexión y recarga.');
  });
}

export function applyUpdate() {
  if (__WEB__) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.waiting) { reloadOnSwap = true; reg.waiting.postMessage('activar'); } else window.location.reload();
    }, () => window.location.reload());
    return;
  }
  try { window.applicationCache.swapCache(); } catch (e) { /* ya aplicada */ }
  window.location.reload();
}
