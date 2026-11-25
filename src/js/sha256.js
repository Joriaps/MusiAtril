// SHA-256 incremental: crypto.subtle no existe en páginas http.
const K = new Int32Array(64);
(function () {
  let n = 0, p = 2;
  while (n < 64) {
    let prime = true;
    for (let i = 2; i * i <= p; i++) if (p % i === 0) { prime = false; break; }
    if (prime) { const c = Math.pow(p, 1 / 3); K[n++] = ((c - Math.floor(c)) * 4294967296) | 0; }
    p++;
  }
})();

export class Sha256 {
  constructor() {
    this.h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.w = new Int32Array(64);
    this.buf = new Uint8Array(64);
    this.n = 0;
    this.len = 0;
  }

  block(d, o) {
    const w = this.w, H = this.h;
    for (let i = 0; i < 16; i++, o += 4) w[i] = (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = (w[i - 16] + w[i - 7] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3))
        + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
    }
    let a = H[0], b = H[1], c = H[2], e = H[4], f = H[5], g = H[6], d4 = H[3], h = H[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d4 + t1) | 0; d4 = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d4) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  update(buffer) {
    const d = new Uint8Array(buffer);
    let i = 0;
    this.len += d.length;
    while (this.n && i < d.length) {
      this.buf[this.n++] = d[i++];
      if (this.n === 64) { this.block(this.buf, 0); this.n = 0; }
    }
    for (; i + 64 <= d.length; i += 64) this.block(d, i);
    while (i < d.length) this.buf[this.n++] = d[i++];
    return this;
  }

  hex() {
    const bits = this.len * 8, pad = new Uint8Array(((this.n < 56 ? 56 : 120) - this.n) + 8);
    pad[0] = 0x80;
    const hi = Math.floor(bits / 4294967296), lo = bits >>> 0, e = pad.length;
    for (let i = 0; i < 4; i++) { pad[e - 1 - i] = lo >>> (8 * i); pad[e - 5 - i] = hi >>> (8 * i); }
    this.update(pad);
    let s = '';
    for (let i = 0; i < 8; i++) s += ('00000000' + (this.h[i] >>> 0).toString(16)).slice(-8);
    return s;
  }
}
