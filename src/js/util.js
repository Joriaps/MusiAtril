// Crea elementos sin innerHTML: el texto siempre entra por textContent.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  Object.keys(props || {}).forEach((k) => {
    const v = props[k];
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'click') tap(el, v);
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  });
  kids.forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return el;
}

// Responde al levantar el dedo, aunque haya otro apoyado (la mano al anotar): con dos dedos iOS no genera "click".
// Se admite que el dedo se mueva un poco. "click" queda para ratón, teclado y pruebas.
export function tap(el, fn) {
  let start = null, fired = 0;
  el.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; start = { x: t.clientX, y: t.clientY }; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0], s = start;
    start = null;
    if (!s || el.disabled || Math.abs(t.clientX - s.x) > 20 || Math.abs(t.clientY - s.y) > 20) return;
    e.preventDefault();
    fired = Date.now();
    fn(e);
  });
  el.addEventListener('touchcancel', () => { start = null; });
  el.addEventListener('click', (e) => { e.preventDefault(); if (Date.now() - fired > 800) fn(e); });
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Devuelve a iOS la memoria del canvas: quitarlo del DOM no basta.
export function freeCanvas(c) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
  if (c.parentNode) c.parentNode.removeChild(c);
}

export function mb(n) {
  return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
}

export function now() {
  return window.performance && performance.now ? performance.now() : Date.now();
}

export function isPdf(buf) {
  // La cabecera puede ir precedida de basura: se admite en el primer KB.
  const b = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  for (let i = 0; i + 4 < b.length; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return true;
  }
  return false;
}

export function getBuffer(url) {
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = 'arraybuffer';
    x.onload = () => {
      if ((x.status === 200 || x.status === 0) && x.response && x.response.byteLength) ok(x.response);
      else ko(new Error('No se pudo leer ' + url + ' (' + x.status + ')'));
    };
    x.onerror = () => ko(new Error('Sin acceso a ' + url));
    x.send();
  });
}

export function readFile(file) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => ko(new Error('No se pudo leer el archivo'));
    r.readAsArrayBuffer(file);
  });
}
