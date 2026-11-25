// PDFs de prueba propios: uno limpio (vectorial) y uno que imita un mal escaneo pesado.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/pdfs');
fs.mkdirSync(dir, { recursive: true });

class Pdf {
  objs = [];
  add(head, data) {
    this.objs.push(data === undefined ? Buffer.from(head)
      : Buffer.concat([Buffer.from(`<< ${head} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]));
    return this.objs.length;
  }
  save(file, pages) {
    const pid = this.objs.length + pages.length + 1;
    const kids = pages.map((p) => this.add(`<< /Type /Page /Parent ${pid} 0 R /MediaBox [0 0 595 842] /Resources << ${p.res} >> /Contents ${p.c} 0 R >>`));
    this.add(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] >>`);
    const cat = this.add(`<< /Type /Catalog /Pages ${pid} 0 R >>`);
    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')], off = [];
    let o = parts[0].length;
    this.objs.forEach((b, i) => {
      off.push(o);
      const x = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), b, Buffer.from('\nendobj\n')]);
      parts.push(x); o += x.length;
    });
    parts.push(Buffer.from(`xref\n0 ${off.length + 1}\n0000000000 65535 f \n` + off.map((v) => String(v).padStart(10, '0') + ' 00000 n \n').join('')
      + `trailer << /Size ${off.length + 1} /Root ${cat} 0 R >>\nstartxref\n${o}\n%%EOF`));
    const b = Buffer.concat(parts);
    fs.writeFileSync(path.join(dir, file), b);
    console.log(file, (b.length / 1048576).toFixed(2), 'MB');
  }
}

function clean() {
  const p = new Pdf(), f = p.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'), pages = [], k = .5523;
  const ell = (x, y, a, b) => `${x + a} ${y} m ${x + a} ${y + b * k} ${x + a * k} ${y + b} ${x} ${y + b} c ${x - a * k} ${y + b} ${x - a} ${y + b * k} ${x - a} ${y} c ${x - a} ${y - b * k} ${x - a * k} ${y - b} ${x} ${y - b} c ${x + a * k} ${y - b} ${x + a} ${y - b * k} ${x + a} ${y} c f\n`;
  for (let n = 1; n <= 4; n++) {
    let s = `BT /F 22 Tf 150 790 Td (Estudio de prueba, pagina ${n}) Tj ET\n0.8 w\n`;
    for (let sys = 0; sys < 8; sys++) {
      const y = 720 - sys * 88;
      for (let i = 0; i < 5; i++) s += `50 ${y - i * 8} m 545 ${y - i * 8} l S\n`;
      for (let b = 0; b <= 4; b++) s += `${50 + b * 123.75} ${y} m ${50 + b * 123.75} ${y - 32} l S\n`;
      for (let q = 0; q < 16; q++) {
        const x = 66 + q * 30.6, ny = y - 32 + ((q * 5 + sys * 3 + n) % 9) * 4;
        s += ell(x, ny, 4.8, 3.6) + `${x + 4.6} ${ny} m ${x + 4.6} ${ny + 26} l S\n`;
      }
    }
    pages.push({ res: `/Font << /F ${f} 0 R >>`, c: p.add('', Buffer.from(s)) });
  }
  p.save('limpio.pdf', pages);
}

// Página gris, torcida y con ruido, a la resolución pedida.
function scan(W, H, ang) {
  const g = new Uint8Array(W * H), c = Math.cos(ang), s = Math.sin(ang), sc = W / 2480;
  let seed = 7;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    const bg = 176 + 26 * (x / W) - 22 * Math.abs(y / H - .5) + ((seed >> 16) & 15);
    const u = (c * (x - W / 2) + s * (y - H / 2)) / sc + 1240, v = (-s * (x - W / 2) + c * (y - H / 2)) / sc + 1754;
    let ink = false;
    if (u > 190 && u < 2290 && v > 400 && v < 3300) {
      const t = (v - 400) % 360, sys = ((v - 400) / 360) | 0;
      for (let i = 0; i < 5; i++) if (Math.abs(t - 60 - i * 33) < 2.2) ink = true;
      if (u > 260 && u < 2260) {
        const q = ((u - 260) / 125) | 0, cu = 260 + q * 125 + 62, cv = 192 - ((q * 5 + sys * 3) % 9) * 16.5;
        const a = (u - cu) / 21, b = (t - cv) / 15;
        if (a * a + b * b < 1 || (Math.abs(u - cu - 19) < 2.6 && t < cv && t > cv - 110)) ink = true;
      }
      if (t > 58 && t < 194 && Math.abs((u - 190) % 525) < 3) ink = true;
    }
    g[y * W + x] = ink ? 52 + ((seed >> 18) & 15) : bg;
  }
  return g;
}

function bad() {
  const p = new Pdf(), pages = [];
  const page = (w, h, head, data, mask) => {
    const im = p.add(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} ${head}`, data);
    const c = p.add('', Buffer.from(`q ${mask ? '0.1 0.1 0.4 rg ' : ''}595 0 0 842 0 0 cm /I Do Q`));
    pages.push({ res: `/XObject << /I ${im} 0 R >>`, c });
  };
  const jpg = (g, w, h, q) => {
    const d = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) { d[i * 4] = g[i]; d[i * 4 + 1] = g[i] - 6; d[i * 4 + 2] = Math.max(0, g[i] - 20); d[i * 4 + 3] = 255; }
    return jpeg.encode({ data: d, width: w, height: h }, q).data;
  };
  const bits = (g, w, h) => {
    const r = (w + 7) >> 3, d = Buffer.alloc(r * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g[y * w + x] > 120) d[y * r + (x >> 3)] |= 128 >> (x & 7);
    return zlib.deflateSync(d, { level: 9 });
  };
  const a = scan(2480, 3508, .04), b = scan(4961, 7016, -.03);
  const jpgB = jpg(b, 4961, 7016, 30);
  const DCT = '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode';
  page(2480, 3508, DCT, jpg(a, 2480, 3508, 45));                                                     // 300 ppp color
  page(4961, 7016, DCT, jpgB);                                                     // 600 ppp color
  page(4961, 7016, '/ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode', bits(b, 4961, 7016)); // 600 ppp 1 bit
  page(4961, 7016, '/ImageMask true /BitsPerComponent 1 /Filter /FlateDecode', bits(b, 4961, 7016), true);   // máscara
  page(4961, 7016, '/ColorSpace [/CalRGB << /WhitePoint [0.95 1 1.09] >>] /BitsPerComponent 8 /Filter /DCTDecode', jpgB); // CalRGB
  p.save('mal-escaneo.pdf', pages);
}
clean();
bad();
