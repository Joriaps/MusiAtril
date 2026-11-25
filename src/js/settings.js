// Copias de seguridad, espacio, límite de tamaño, estado sin conexión y diagnóstico.
import { h, clear, mb, readFile } from './util.js';
import { lib, list, pref, usage } from './lib.js';
import { build, validate, restore, sendToPc, pcBackups, fetchBackup, fetchMissing, utf8, MAX_JSON } from './backup.js';
import { withPc, discard } from './importer.js';
import { openViewerDemo } from './demo.js';
import { pairPen } from './notes.js';
import { confirmar, elegir, modal, oops, pedir, progreso, toast } from './ui.js';
import { runDiagnostics } from './diag.js';
import { offlineCard } from './offline.js';

export function settingsTab(body, root, home) {
  const box = h('div', { class: 'scroll fillrows settings' });
  body.appendChild(box);
  const sec = (t, ...k) => box.appendChild(h('div', { class: 'sec' }, h('h2', { text: t }), ...k));
  const btns = (...k) => h('div', { class: 'tools' }, ...k);

  const last = h('p', { class: 'sub', text: lib.prefs.backup ? 'Última copia: ' + new Date(lib.prefs.backup).toLocaleString('es-ES') : 'Todavía no has hecho ninguna copia.' });
  if (__WEB__) sec('Copia de seguridad',
    h('p', { text: 'iOS puede borrar los datos si el iPad se queda sin espacio. Guarda una copia en Archivos de vez en cuando y siempre antes de un concierto.' }),
    h('p', { text: 'La copia no lleva los PDFs: guárdalos tú (por ejemplo, en Drive). Al volver a añadirlos se unen solos a sus anotaciones.' }),
    last,
    btns(h('button', { class: 'main', click: () => saveFile(home) }, 'Guardar copia en el iPad'), fileButton()),
    btns(h('button', { click: exportText }, 'Copiar como texto'), h('button', { click: importText }, 'Pegar una copia')));
  else sec('Copia de seguridad',
    h('p', { text: 'iOS puede borrar los datos si el iPad se queda sin espacio. Haz una copia en el PC de vez en cuando y siempre antes de un concierto.' }),
    last,
    btns(h('button', { class: 'main', click: () => send(true) }, 'Copia completa al PC (con PDFs)'), h('button', { click: () => send(false) }, 'Copia al PC sin PDFs'), h('button', { click: recover }, 'Recuperar del PC')),
    btns(h('button', { click: exportText }, 'Copiar como texto'), h('button', { click: importText }, 'Pegar una copia'), fileButton()));

  const space = h('div', null);
  sec('Espacio', space);
  usage().then((u) => {
    const n = list('docs').length, lost = list('docs').filter((d) => !d.blob).length;
    space.appendChild(h('p', { text: n + (n === 1 ? ' partitura' : ' partituras') + ' · PDFs ' + mb(u.pdf) + ' · anotaciones ' + mb(u.notes) + (u.partial ? ' · importaciones a medias ' + mb(u.partial) : '') }));
    if (lost) space.appendChild(h('p', { class: 'warnline', text: '⚠ ' + lost + ' sin PDF: recupéralos desde una copia completa o vuelve a importarlos.' }));
    if (u.pdf + u.partial > 400 * 1048576) space.appendChild(h('p', { class: 'warnline', text: '⚠ Ya ocupa bastante para este iPad. Si iOS pide permiso para usar más espacio, acéptalo.' }));
    const b = btns(h('button', {
      click: () => pedir('Tamaño máximo por PDF', [{ k: 'v', label: 'En MB (entre 5 y 300)', type: 'number', value: String(lib.prefs.maxMB), max: 4 }]).then((r) => {
        const v = r ? Math.round(Number(r.v)) : 0;
        if (!r) return null;
        if (!(v >= 5 && v <= 300)) { toast('Escribe un número entre 5 y 300.'); return null; }
        return pref('maxMB', v).then(home);
      }).catch(oops),
    }, 'Máximo por PDF: ' + lib.prefs.maxMB + ' MB'));
    if (u.partials.length) b.appendChild(h('button', { click: () => confirmar('Descartar', 'Se borran los trozos de ' + u.partials.length + ' importación(es) sin terminar.', 'Descartar', true).then((y) => (y ? u.partials.reduce((p, x) => p.then(() => discard(x)), Promise.resolve()).then(home) : null)).catch(oops) }, 'Descartar importaciones a medias'));
    space.appendChild(b);
  }).catch(oops);

  const pen = { finger: 'Se escribe con el dedo o con cualquier lápiz.', cap: 'Lápiz de contacto enlazado: se ignora la palma.', stylus: 'Apple Pencil enlazado: solo escribe el lápiz.' };
  sec('Lápiz', h('p', { text: pen[lib.prefs.hand] || pen.finger }), btns(h('button', { click: () => pairPen(lib.prefs, (hand, r) => { lib.prefs.radius = r; pref('hand', hand).then(home, oops); }) }, 'Enlazar un lápiz')));

  sec('App', offlineCard(), h('p', { class: 'sub', text: 'Versión ' + __VERSION__ + ' · PDF.js ' + __PDFJS__ + (navigator.standalone ? '' : ' · abierta en el navegador: usa siempre el icono') }),
    btns(h('button', { click: () => diagnostics(root, home) }, 'Diagnóstico'), h('button', { click: () => openViewerDemo('prueba/limpio.pdf', 'Prueba: limpio', home) }, 'Guardar PDF de prueba limpio'), h('button', { click: () => openViewerDemo('prueba/mal-escaneo.pdf', 'Prueba: mal escaneo', home) }, 'Guardar PDF de prueba mal escaneado')));

  // --- copias
  function send(full) {
    withPc(() => {
      let stop = false;
      const ui = progreso('Copiando al PC', () => { stop = true; });
      ui.set(0, 'Enviando anotaciones y organización…');
      return sendToPc(full, { stopped: () => stop }, ui.set).then((r) => {
        ui.close();
        return pref('backup', Date.now()).then(() => {
          home();
          modal('Copia guardada en el PC', h('div', null, h('p', { text: r.nombre + (full ? ' · ' + r.pdfs + ' PDFs' : '') }), ...r.errs.map((e) => h('p', { class: 'warnline', text: '⚠ ' + e }))), [{ text: 'Entendido', class: 'main', fn: () => null }]);
        });
      }, (e) => { ui.close(); if (e.cancelled) toast('Copia cancelada.'); else throw e; });
    }).catch(oops);
  }
  function recover() {
    withPc(() => pcBackups().then((l) => {
      if (!l.length) { toast('No hay copias en el PC.'); return null; }
      return elegir('Copias en el PC', l.map((c) => ({ v: c.nombre, text: c.nombre.replace(/^copia-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d).*$/, '$3/$2/$1 · $4:$5') + ' · ' + mb(c.tam) }))).then((n) => (n ? fetchBackup(n).then((t) => apply(t, true)) : null));
    })).catch(oops);
  }
  function apply(text, pc) {
    const o = validate(text);
    return confirmar('Restaurar copia', o.docs.length + ' partituras, ' + o.folders.length + ' carpetas, ' + o.concerts.length + ' conciertos y anotaciones en ' + o.notes.length + ' páginas. Lo que coincida se sustituye por lo de la copia; el resto se conserva.', 'Restaurar').then((y) => {
      if (!y) return null;
      return restore(o).then((r) => {
        if (!r.missing.length || !pc) { done(r, 0, []); return null; }
        let stop = false;
        const ui = progreso('Recuperando PDFs', () => { stop = true; });
        return fetchMissing(r.missing, { stopped: () => stop }, ui.set).then((f) => { ui.close(); done(r, f.got, f.errs); }, (e) => { ui.close(); home(); if (!e.cancelled) throw e; });
      });
    });
  }
  function done(r, got, errs) {
    home();
    const left = list('docs').filter((d) => !d.blob).length;
    modal('Copia restaurada', h('div', null, h('p', { text: r.docs + ' partituras restauradas' + (got ? ' y ' + got + ' PDFs recuperados' : '') + '.' }), left ? h('p', { class: 'warnline', text: '⚠ A ' + left + ' les falta el PDF. Al ' + (__WEB__ ? 'volver a añadirlos' : 'importarlos desde el PC') + ' se unirán solos a sus anotaciones.' }) : null, ...errs.slice(0, 20).map((e) => h('p', { text: e }))), [{ text: 'Entendido', class: 'main', fn: () => null }]);
  }
  function exportText() {
    build().then((o) => {
      const ta = h('textarea', { class: 'paste', readonly: true });
      ta.value = JSON.stringify(o);
      modal('Copia como texto (sin PDFs)', h('div', null, h('p', { text: 'Pulsa Copiar y pégalo en Notas o en un correo.' }), ta), [{
        text: 'Copiar', class: 'main', fn: () => {
          ta.removeAttribute('readonly');
          ta.focus(); ta.setSelectionRange(0, ta.value.length);
          let ok = false;
          try { ok = document.execCommand('copy'); } catch (e) { /* manual */ }
          toast(ok ? 'Copiado.' : 'Mantén pulsado el texto y elige Copiar.');
          return false;
        },
      }]);
    }).catch(oops);
  }
  function importText() {
    const ta = h('textarea', { class: 'paste' });
    modal('Pegar una copia', h('div', null, h('p', { text: 'Pega aquí el texto de una copia.' }), ta), [{ text: 'Cancelar', fn: () => null }, { text: 'Continuar', class: 'main', fn: () => { const v = ta.value.trim(); Promise.resolve().then(() => apply(v, false)).catch(oops); } }]);
  }
  function fileButton() {
    const input = h('input', {
      type: 'file', class: 'file', accept: '.json,application/json,text/plain',
      onchange: () => {
        const f = input.files && input.files[0];
        if (!f) return;
        if (f.size > MAX_JSON) { toast('La copia es demasiado grande.'); return; }
        readFile(f).then(utf8).then((t) => apply(t, false)).catch(oops);
        input.value = '';
      },
    });
    return h('label', { class: 'btn' }, 'Abrir archivo de copia', input);
  }
}

// Versión web: la copia sin PDFs va a un archivo. Compartir tiene que salir de un toque, por eso se prepara antes.
// Fuera de settingsTab para que el build del PC la descarte.
function saveFile(home) {
  build().then((o) => {
    const t = new Date(), z = (n) => (n < 10 ? '0' : '') + n;
    const name = 'copia-' + t.getFullYear() + z(t.getMonth() + 1) + z(t.getDate()) + '-' + z(t.getHours()) + z(t.getMinutes()) + z(t.getSeconds()) + '.json';
    const file = new File([JSON.stringify(o)], name, { type: 'application/json' });
    const saved = () => pref('backup', Date.now()).then(() => { home(); toast('Copia guardada.'); });
    modal('Copia preparada (sin PDFs)', h('div', null,
      h('p', { text: o.docs.length + ' partituras, ' + o.folders.length + ' carpetas, ' + o.concerts.length + ' conciertos y anotaciones en ' + Object.keys(o.notes).length + ' páginas.' }),
      h('p', { text: 'Pulsa Guardar y elige «Guardar en Archivos».' })), [{
      text: 'Guardar', class: 'main', fn: () => {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).then(saved, (e) => { if (!e || e.name !== 'AbortError') oops(e); });
        } else {
          const a = h('a', { href: URL.createObjectURL(file), download: name });
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          saved().catch(oops);
        }
      },
    }]);
  }).catch(oops);
}

function diagnostics(root, home) {
  const l = h('div', { class: 'scroll fillrows' });
  const status = h('p', { text: 'Probando… tarda hasta un minuto. No toques nada.' });
  clear(root).appendChild(h('div', { class: 'screen col' },
    h('div', { class: 'head' }, h('button', { click: home }, '‹ Volver'), h('h1', { text: 'Diagnóstico' })), status, l));
  let n = 0;
  runDiagnostics((name, ok, detail) => {
    if (!ok) n++;
    l.appendChild(h('div', { class: 'row ' + (ok ? 'ok' : 'bad') }, h('b', { text: (ok ? '✓ ' : '✗ ') + name }), h('span', { text: String(detail) })));
  }).then(() => { status.textContent = n ? 'Terminado con ' + n + ' aviso(s). Haz una captura.' : 'Terminado: todo correcto. Haz una captura.'; });
}
