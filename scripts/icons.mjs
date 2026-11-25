// Dibuja el icono (página con pentagrama) sin dependencias: PNG RGB con zlib.
import zlib from 'node:zlib';

const crcT = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => {
  const b = Buffer.concat([Buffer.from(t), d]), o = Buffer.alloc(b.length + 8);
  o.writeUInt32BE(d.length, 0); b.copy(o, 4); o.writeUInt32BE(crc(b), b.length + 4);
  return o;
};
const DARK = [28, 43, 58];

function color(x, y) {
  const ell = (cx, cy, a, b) => {
    const t = -0.35, dx = x - cx, dy = y - cy;
    const rx = dx * Math.cos(t) - dy * Math.sin(t), ry = dx * Math.sin(t) + dy * Math.cos(t);
    return (rx / a) ** 2 + (ry / b) ** 2 < 1;
  };
  if (!(x > .18 && x < .82 && y > .14 && y < .86)) return DARK;
  if (ell(.40, .665, .085, .06) || ell(.64, .60, .085, .06)) return DARK;
  if ((x > .455 && x < .482 && y > .33 && y < .66) || (x > .695 && x < .722 && y > .27 && y < .6)) return DARK;
  const t = (x - .455) / .267, by = .33 - .06 * t;
  if (t >= 0 && t <= 1 && y > by && y < by + .06) return DARK;
  for (let i = 0; i < 5; i++) if (Math.abs(y - (.36 + i * .085)) < .006) return [178, 140, 84];
  return [251, 247, 238];
}

export function icon(S) {
  const SS = 4, N = S * SS, raw = Buffer.alloc(S * (S * 3 + 1));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const c = color((x * SS + i) / N, (y * SS + j) / N);
      r += c[0]; g += c[1]; b += c[2];
    }
    const o = y * (S * 3 + 1) + 1 + x * 3, n = SS * SS;
    raw[o] = r / n; raw[o + 1] = g / n; raw[o + 2] = b / n;
  }
  const h = Buffer.alloc(13);
  h.writeUInt32BE(S, 0); h.writeUInt32BE(S, 4); h[8] = 8; h[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
