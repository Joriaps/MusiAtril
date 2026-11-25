/* Atril Local: añadido al principio del worker de PDF.js 2.8.335.
   Reduce imágenes enormes DENTRO del worker, antes de que lleguen al canvas.
   Un iPad con ~1 GB no admite lienzos de más de 16,7 Mpx (un A4 a 600 ppp son 35). */
if (!('globalThis' in self)) self.globalThis = self;
var ATRIL_MAX_PX = 10000000;
function atrilFactor(w, h) {
  var f = 1;
  if (!(w > 0 && h > 0)) return 1;
  while (f < 8 && Math.ceil(w / f) * Math.ceil(h / f) > ATRIL_MAX_PX) f *= 2;
  return f;
}
/* JPEG de referencia (baseline): cada bloque 8x8 se transforma y promedia según se
   lee, así nunca está en memoria la imagen completa. */
function atrilPrepare(frame, component) {
  var f = frame.progressive ? 1 : atrilFactor(frame.samplesPerLine, frame.scanLines);
  component.atrilF = f;
  if (f === 1) return 0;
  component.atrilTmp = new Int16Array(64);
  component.atrilP = new Int16Array(64);
  return f;
}
function atrilFill(a) { for (var i = 0; i < a.length; i++) a[i] = 128; return a; }
function atrilDecode(decode, component, blockOffset, inverse) {
  var f = component.atrilF;
  if (!(f > 1)) { decode(component, blockOffset); return; }
  var store = component.blockData, tmp = component.atrilTmp, i, x, y, sx, sy, sum;
  for (i = 0; i < 64; i++) tmp[i] = 0;
  component.blockData = tmp;
  try {
    decode(component, 0);
    inverse(component, 0, component.atrilP);
  } finally {
    component.blockData = store;
  }
  var n = 8 / f, o = blockOffset / (f * f), half = f * f / 2;
  for (y = 0; y < n; y++) {
    for (x = 0; x < n; x++) {
      sum = half;
      for (sy = 0; sy < f; sy++) for (sx = 0; sx < f; sx++) sum += tmp[(y * f + sy) * 8 + x * f + sx];
      store[o++] = (sum / (f * f)) | 0;
    }
  }
}
/* Devuelve true si ha rellenado el componente; false = usar el código original. */
function atrilLinearize(component, data, first, width, height, numComponents, csx, csy) {
  var f = component.atrilF || 1, out = component.output, off = first, x, y, j, i;
  if (f > 1) {
    var n = 8 / f, n2 = n * n, stride = (component.blocksPerLine + 1) * n2;
    var xs = new Uint32Array(width), maxCol = component.blocksPerLine * n - 1;
    for (x = 0; x < width; x++) {
      j = Math.min((x * csx / f) | 0, maxCol);
      xs[x] = ((j / n) | 0) * n2 + (j % n);
    }
    var maxRow = component.blocksPerColumn * n - 1;
    for (y = 0; y < height; y++) {
      j = Math.min((y * csy / f) | 0, maxRow);
      var base = ((j / n) | 0) * stride + (j % n) * n;
      for (x = 0; x < width; x++) { data[off] = out[base + xs[x]]; off += numComponents; }
    }
    return true;
  }
  var bx = Math.floor(csx), by = Math.floor(csy);
  if (bx < 2 || by < 2) return false;
  var st = (component.blocksPerLine + 1) * 64;
  var mw = component.blocksPerLine * 8 - 1, mh = component.blocksPerColumn * 8 - 1, cnt = bx * by;
  for (y = 0; y < height; y++) {
    for (x = 0; x < width; x++) {
      var s = 0;
      for (j = 0; j < by; j++) {
        var yy = Math.min(((y * csy) | 0) + j, mh), r = (yy >> 3) * st + ((yy & 7) << 3);
        for (i = 0; i < bx; i++) {
          var xx = Math.min(((x * csx) | 0) + i, mw);
          s += out[r + ((xx >> 3) << 6) + (xx & 7)];
        }
      }
      data[off] = s / cnt; off += numComponents;
    }
  }
  return true;
}
/* Cuenta los bits a 0 (negros) de cada celda f×f de una fila reducida. Los bytes blancos,
   que son casi todos, se saltan enteros. missing = valor de los bytes que falten. */
function atrilBlack(src, w, h, row, y, f, W, acc, missing) {
  var x, sy, bx, v, k, sx, i;
  for (x = 0; x < W; x++) acc[x] = 0;
  for (sy = y * f; sy < (y + 1) * f && sy < h; sy++) {
    for (bx = 0; bx < row; bx++) {
      i = sy * row + bx;
      v = i < src.length ? src[i] : missing;
      if (v === 255) continue;
      for (k = 0; k < 8; k++) {
        sx = bx * 8 + k;
        if (sx < w && !(v & (128 >> k))) acc[(sx / f) | 0]++;
      }
    }
  }
}
/* Resto de formatos (Flate, CCITT, JBIG2, JPX): promedia la imagen ya decodificada. */
function atrilShrink(d) {
  var w = d.width, h = d.height, f = atrilFactor(w, h);
  if (f === 1 || !d.data || !d.kind) return d;
  var W = Math.ceil(w / f), H = Math.ceil(h / f), src = d.data, x, y, sx, sy, o = 0, c;
  var out, s, s0, s1, s2, s3, n, p, row = (w + 7) >> 3;
  if (d.kind === 1) {
    out = new Uint8ClampedArray(W * H * 3);
    s = new Uint8Array(W);
    for (y = 0; y < H; y++) {
      atrilBlack(src, w, h, row, y, f, W, s, 0);
      sy = Math.min(f, h - y * f);
      for (x = 0; x < W; x++) {
        c = s[x] ? 255 - s[x] * 255 / (sy * Math.min(f, w - x * f)) : 255;
        out[o++] = c; out[o++] = c; out[o++] = c;
      }
    }
    d.kind = 2;
  } else {
    var ch = d.kind === 2 ? 3 : 4;
    out = new Uint8ClampedArray(W * H * ch);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      n = 0; s0 = 0; s1 = 0; s2 = 0; s3 = 0;
      for (sy = y * f; sy < (y + 1) * f && sy < h; sy++) for (sx = x * f; sx < (x + 1) * f && sx < w; sx++) {
        p = (sy * w + sx) * ch; n++;
        s0 += src[p]; s1 += src[p + 1]; s2 += src[p + 2]; if (ch === 4) s3 += src[p + 3];
      }
      out[o++] = s0 / n; out[o++] = s1 / n; out[o++] = s2 / n; if (ch === 4) out[o++] = s3 / n;
    }
  }
  d.width = W; d.height = H; d.data = out;
  return d;
}
/* Máscaras de 1 bit (bit 0 = pintar). */
function atrilShrinkMask(d) {
  var w = d.width, h = d.height, f = atrilFactor(w, h);
  if (f === 1 || !d.data) return d;
  var W = Math.ceil(w / f), H = Math.ceil(h / f), row = (w + 7) >> 3, R = (W + 7) >> 3;
  var src = d.data, out = new Uint8ClampedArray(R * H), s = new Uint8Array(W), x, y, sy;
  for (y = 0; y < H; y++) {
    atrilBlack(src, w, h, row, y, f, W, s, 255);
    sy = Math.min(f, h - y * f);
    for (x = 0; x < W; x++) if (s[x] < sy * Math.min(f, w - x * f) * 0.4) out[y * R + (x >> 3)] |= 128 >> (x & 7);
  }
  d.width = W; d.height = H; d.data = out;
  return d;
}
