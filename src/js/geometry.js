// Relación página ↔ pantalla con giro, inclinación y recorte. Las anotaciones se guardan en
// coordenadas 0–1 de la página original, así que siguen en su sitio cambien estos ajustes.
export const DEFAULTS = { b: 0, c: 0, wh: 0, g: 0, i: 0, rot: 0, skew: 0, x: 0, y: 0, w: 1, h: 1 };

export function adjust(doc, page) {
  const a = doc.adj || {}, o = {}, s = (a.pages && a.pages[page]) || a.all || {};
  Object.keys(DEFAULTS).forEach((k) => { o[k] = typeof s[k] === 'number' ? s[k] : DEFAULTS[k]; });
  return o;
}

export function geometry(W, H, a, boxW, boxH, fit) {
  const side = a.rot % 180 !== 0, FW = side ? H : W, FH = side ? W : H;
  const cw = FW * a.w, ch = FH * a.h;
  const s = fit === 'width' ? boxW / cw : Math.min(boxW / cw, boxH / ch);
  const t = (a.rot + a.skew) * Math.PI / 180, cos = Math.cos(t) * s, sin = Math.sin(t) * s;
  const e = s * (FW / 2 - a.x * FW) - cos * W / 2 + sin * H / 2;
  const f = s * (FH / 2 - a.y * FH) - sin * W / 2 - cos * H / 2;
  const det = s * s;
  return {
    W, H, s, cssW: Math.max(1, Math.round(cw * s)), cssH: Math.max(1, Math.round(ch * s)), m: [cos, sin, -sin, cos, e, f],
    toCss: (u, v) => [cos * u * W - sin * v * H + e, sin * u * W + cos * v * H + f],
    toPage: (x, y) => [((x - e) * cos + (y - f) * sin) / det / W, (-(x - e) * sin + (y - f) * cos) / det / H],
  };
}

export function cssFilter(a) {
  if (a.wh) return '';
  const l = [];
  if (a.b) l.push('brightness(' + (1 + a.b / 100) + ')');
  if (a.c) l.push('contrast(' + (1 + a.c / 100) + ')');
  if (a.g) l.push('grayscale(1)');
  if (a.i) l.push('invert(1)');
  return l.join(' ');
}

// Blanquear exige tocar píxeles: por franjas y cediendo el paso, para no bloquear los toques.
export function whiten(canvas, a, wanted) {
  if (!a.wh) return Promise.resolve(canvas);
  const lut = new Uint8Array(256), T = 255 - a.wh * 1.5, lo = T * 0.2, B = 1 + a.b / 100, C = 1 + a.c / 100;
  for (let i = 0; i < 256; i++) {
    let v = Math.min(255, i * B);
    v = Math.max(0, Math.min(255, (v - 127.5) * C + 127.5));
    v = Math.max(0, Math.min(255, (v - lo) * 255 / (T - lo)));
    lut[i] = a.i ? 255 - v : v;
  }
  const x = canvas.getContext('2d'), W = canvas.width, H = canvas.height, gray = !!a.g;
  return new Promise((ok, ko) => {
    let y = 0;
    const step = () => {
      try {
        if (wanted && !wanted()) { canvas.width = 0; canvas.height = 0; ok(null); return; }
        const end = Date.now() + 14;
        while (y < H && Date.now() < end) {
          const n = Math.min(48, H - y), img = x.getImageData(0, y, W, n), d = img.data;
          if (gray) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lut[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8];
          else for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
          x.putImageData(img, 0, y);
          y += n;
        }
        if (y < H) setTimeout(step, 0); else ok(canvas);
      } catch (e) { ko(e); }
    };
    step();
  });
}
