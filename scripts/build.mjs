import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as babel from '@babel/core';
import { patchMain, patchWorker } from './patch-pdfjs.mjs';
import { icon } from './icons.mjs';
import { CSP } from './csp.mjs';

// --web: versión para GitHub Pages (iOS 13 o posterior) en docs/. Service worker en vez de AppCache y sin PC.
const WEB = process.argv.includes('--web'), OUT = WEB ? 'docs' : 'dist';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (...p) => path.join(root, ...p), D = (...p) => path.join(root, OUT, ...p);
const lf = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(lf(R('package.json')));
const PDFJS = JSON.parse(lf(R('node_modules/pdfjs-dist/package.json'))).version;
if (PDFJS !== '2.8.335') throw new Error('PDF.js debe ser 2.8.335; instalada ' + PDFJS);

const toES5 = (code, name) => babel.transformSync(code, {
  filename: name, babelrc: false, configFile: false, sourceType: 'script', compact: false,
  presets: [[R('node_modules/@babel/preset-env'), { targets: { ios: '10' }, modules: false, forceAllTransforms: true, useBuiltIns: false }]],
}).code;
const min = (code) => esbuild.transformSync(code, { minify: true, target: 'es5', legalComments: 'inline', charset: 'ascii' }).code;

// No se vacía dist/ hasta tener todo construido: un fallo no lo deja a medias.
const out = {};
out['polyfills.js'] = min(lf(R('src/js/polyfills.js')));
const L = R('node_modules/pdfjs-dist/legacy/build');
out['pdf.js'] = min(toES5(patchMain(lf(path.join(L, 'pdf.js'))), 'pdf.js'));
out['pdf.worker.js'] = min(toES5(patchWorker(lf(path.join(L, 'pdf.worker.js')), lf(R('src/vendor-patches/atril-worker.js'))), 'pdf.worker.js'));

const bundle = await esbuild.build({
  entryPoints: [R('src/js/main.js')], bundle: true, format: 'iife', write: false, target: 'es2017', charset: 'utf8',
  define: { __VERSION__: JSON.stringify(pkg.version), __PDFJS__: JSON.stringify(PDFJS), __WEB__: String(WEB) },
});
out['app.js'] = min(toES5(bundle.outputFiles[0].text, 'app.js'));
out['app.css'] = lf(R('src/app.css'));
out['index.html'] = lf(R('src/index.html')).replace('__CSP__', CSP);
if (WEB) {
  // Sin el atributo, un 404 del manifiesto no puede borrar nada en el iPad.
  if (!out['index.html'].includes(' manifest="atril.appcache"')) throw new Error('src/index.html ya no lleva manifest="atril.appcache"');
  out['index.html'] = out['index.html'].replace(' manifest="atril.appcache"', '');
}
out['icon-180.png'] = icon(180);
out['icon-152.png'] = icon(152);
out['LICENSE-pdfjs.txt'] = fs.readFileSync(R('node_modules/pdfjs-dist/LICENSE'));
for (const f of ['limpio.pdf', 'mal-escaneo.pdf']) {
  if (!fs.existsSync(R('test/pdfs', f))) throw new Error('Falta test/pdfs/' + f + ': ejecuta "npm run pruebas"');
  out['prueba/' + f] = fs.readFileSync(R('test/pdfs', f));
}

// La huella cambia con cualquier byte: es lo que hace que AppCache (o el service worker) detecte la actualización.
const h = crypto.createHash('sha256');
const names = Object.keys(out).sort();
for (const n of names) { h.update(n); h.update(out[n]); }
const rev = h.digest('hex').slice(0, 16);
const cached = names.filter((n) => n !== 'LICENSE-pdfjs.txt');
if (WEB) {
  const sw = lf(R('src/sw.js'));
  if (!sw.includes("'__REV__'") || !sw.includes('__FILES__')) throw new Error('src/sw.js no tiene __REV__ o __FILES__');
  out['sw.js'] = sw.replace("'__REV__'", JSON.stringify(pkg.version + '-' + rev)).replace('__FILES__', JSON.stringify(['./', ...cached]));
  out['.nojekyll'] = '';
} else {
  out['atril.appcache'] = ['CACHE MANIFEST', `# ${pkg.version} ${rev}`, 'CACHE:', './', ...cached, '', 'NETWORK:', 'api/', ''].join('\n');
}

fs.mkdirSync(D(), { recursive: true });
for (const n of fs.readdirSync(D())) fs.rmSync(D(n), { recursive: true, force: true });
for (const n of Object.keys(out)) {
  fs.mkdirSync(path.dirname(D(n)), { recursive: true });
  fs.writeFileSync(D(n), out[n]);
}
const total = Object.values(out).reduce((s, v) => s + Buffer.byteLength(v), 0);
console.log(`${OUT}/ listo${WEB ? ' (web)' : ''} · versión ${pkg.version} (${rev}) · ${(total / 1048576).toFixed(1)} MB · PDF.js ${PDFJS}`);
