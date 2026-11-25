// Guarda en la biblioteca los PDFs de prueba que vienen con la app (funciona sin el PC).
import { getBuffer } from './util.js';
import { addFiles } from './importer.js';
import { oops } from './ui.js';

export function openViewerDemo(url, title, home) {
  getBuffer(url).then((b) => {
    const f = new Blob([b], { type: 'application/pdf' });
    f.name = title + '.pdf';
    return addFiles([f], '');
  }).then(home).catch(oops);
}
