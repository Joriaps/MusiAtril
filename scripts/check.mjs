// Compatibilidad con Safari 10 y reglas de seguridad sobre dist/. Sale con error si algo falla.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// --web: revisa docs/ (versión para GitHub Pages) en vez de dist/.
const WEB = process.argv.includes('--web'), OUT = WEB ? 'docs' : 'dist';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = path.join(root, OUT), read = (f) => fs.readFileSync(path.join(D, f), 'utf8');
let bad = 0;
const check = (ok, msg) => { if (!ok) bad++; console.log((ok ? '  ok  ' : 'FALLO ') + msg); };

const js = fs.readdirSync(D).filter((f) => f.endsWith('.js'));
const r = spawnSync(process.execPath, [path.join(root, 'node_modules/es-check/lib/cli/index.js'), 'es5', ...js.map((f) => OUT + '/' + f)], { cwd: root, encoding: 'utf8' });
check(r.status === 0, 'es-check: sintaxis ES5 en ' + js.join(', '));
if (r.status !== 0) console.log(r.stdout, r.stderr);

// APIs posteriores a Safari 10 en nuestro código.
const API = ['fetch\\(', 'AbortController', 'ResizeObserver', 'IntersectionObserver', 'PointerEvent', 'pointerdown', 'structuredClone', 'replaceChildren', '\\.flat\\(', '\\.flatMap\\(', 'Object\\.fromEntries', 'matchAll', 'replaceAll', '\\.at\\(', 'queueMicrotask', 'allSettled', 'Promise\\.any', 'createImageBitmap', 'OffscreenCanvas', 'toBlob\\(', 'BigInt', 'WeakRef', 'TextEncoder', 'TextDecoder', 'serviceWorker', 'navigator\\.storage', 'getAnimations', 'scrollTo\\(\\{', '\\.append\\(', '\\.prepend\\(', '\\.before\\(', '\\.after\\(', '\\.replaceWith\\(', 'trimStart', 'trimEnd', 'formatToParts', 'indexedDB\\.databases', 'crypto\\.subtle', 'DOMMatrix', 'getTransform', 'new DOMParser', 'requestIdleCallback', '\\.arrayBuffer\\(', 'URLSearchParams', 'regeneratorRuntime'];
for (const f of ['app.js', 'polyfills.js']) {
  // La versión web registra el service worker; el resto sigue valiendo para Safari 10.
  const c = read(f), hit = API.filter((a) => !(WEB && f === 'app.js' && a === 'serviceWorker') && new RegExp(a).test(c));
  check(!hit.length, f + ': sin APIs posteriores a Safari 10' + (hit.length ? ' → ' + hit.join(', ') : ''));
}
const DANGER = [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /\bFunction\(/, /https?:[/][/](?!www\.w3\.org)/];
{
  const c = read('app.js'), hit = DANGER.filter((a) => a.test(c));
  check(!hit.length, 'app.js: sin HTML dinámico, eval ni URLs externas' + (hit.length ? ' → ' + hit.join(', ') : ''));
}
for (const f of ['pdf.js', 'pdf.worker.js']) {
  const c = read(f);
  check(!/\bFunction\(|\beval\(/.test(c), f + ': sin eval ni new Function');
  const re = /(?:=|\(|,|:|return)\s*\/((?:\\.|\[(?:\\.|[^\]\n])*\]|[^\/\n\[])+)\/[gimuy]*/g;
  let m, rx = []; while ((m = re.exec(c))) if (/\(\?<|\\p\{/.test(m[1])) rx.push(m[1].slice(0, 40));
  check(!rx.length, f + ': expresiones regulares compatibles' + (rx.length ? ' → ' + rx.join(' | ') : ''));
  check(!/DOMMatrix\(|WeakRef|FinalizationRegistry|new OffscreenCanvas|createImageBitmap\(|setTransform\(new/.test(c), f + ': sin APIs gráficas ausentes');
}
check(/ReadableStream=/.test(read('pdf.js')) && /ReadableStream=/.test(read('pdf.worker.js')), 'PDF.js lleva su propio ReadableStream');
check(read('pdf.js').includes('2.8.335'), 'PDF.js es la 2.8.335');
check(/isEvalSupported:!1/.test(read('app.js')), 'app.js pide isEvalSupported: false');

check(['polyfills.js', 'pdf.worker.js'].every((f) => /globalThis=(window|self)/.test(read(f))), 'globalThis definido antes de PDF.js');

const css = read('app.css').replace(/\/\*[^]*?\*\//g, '');
const cssBad = ['display:\\s*grid', '(^|[;{\\s])(row-|column-)?gap:', 'env\\(', 'clamp\\(', 'min\\(', 'max\\(', 'aspect-ratio', 'inset:', ':is\\(', ':where\\(', ':focus-visible', 'backdrop-filter', 'position:\\s*sticky', 'overscroll-behavior', '@layer', '@container', 'dvh', '#[0-9a-fA-F]{8}\\b', '#[0-9a-fA-F]{4}\\b', 'url\\('].filter((p) => new RegExp(p).test(css));
check(!cssBad.length, 'app.css: sin CSS posterior a Safari 10' + (cssBad.length ? ' → ' + cssBad.join(', ') : ''));

const html = read('index.html');
check(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html) && !/<style|\sstyle=|\son[a-z]+=/.test(html), 'index.html: nada en línea');
check(/Content-Security-Policy/.test(html) && !/unsafe-/.test(html), 'index.html: CSP sin unsafe-*');
check(!/(src|href)="(https?:)?\/\//.test(html), 'index.html: sin recursos externos');

let listed;
if (WEB) {
  const sw = read('sw.js'), m = /var FILES = (\[[^\]]*\]);/.exec(sw);
  check(!fs.existsSync(path.join(D, 'atril.appcache')) && !/\smanifest=/.test(html), 'web: sin AppCache');
  check(/var REV = "[^"_]+";/.test(sw), 'service worker: versión puesta');
  check(/register\("sw\.js"\)/.test(read('app.js')), 'app.js registra sw.js con ruta relativa');
  listed = m ? JSON.parse(m[1]) : [];
} else {
  const mf = read('atril.appcache').split('\n');
  check(mf[0] === 'CACHE MANIFEST', 'manifiesto: cabecera');
  listed = mf.slice(mf.indexOf('CACHE:') + 1, mf.indexOf('NETWORK:')).filter(Boolean);
}
const missing = listed.filter((f) => f !== './' && !fs.existsSync(path.join(D, f)));
check(!missing.length, 'archivos sin conexión: todos existen' + (missing.length ? ' → ' + missing.join(', ') : ''));
for (const f of ['./', 'index.html', 'app.js', 'app.css', 'pdf.js', 'pdf.worker.js', 'polyfills.js']) check(listed.includes(f), 'sin conexión incluye ' + f);
if (!WEB) check(!/serviceWorker|navigator\.share/.test(read('app.js')), 'app.js del PC: sin código de la versión web');
console.log(bad ? `\n${bad} problema(s)` : '\nTodo correcto');
process.exit(bad ? 1 : 0);
