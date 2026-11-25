// API temporal: lista y lectura de PDFs, y recepción de copias. Todo exige un token que
// solo se obtiene con el código de un solo uso que sale en la consola.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MB = 1048576;
const TROZO = MB;
const HASH = /^[0-9a-f]{64}$/;
const COPIA = /^copia-\d{8}-\d{6}(-\d)?\.json$/;

export async function sha256(file) {
  const h = crypto.createHash('sha256');
  for await (const c of fs.createReadStream(file)) h.update(c);
  return h.digest('hex');
}

function esPdf(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(1024), n = fs.readSync(fd, b, 0, 1024, 0);
    return b.subarray(0, n).includes('%PDF-');
  } finally { fs.closeSync(fd); }
}

function dentro(base, file) {
  const r = path.relative(base, file);
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
}

export function crearApi(cfg, log = console.log) {
  for (const d of [cfg.carpeta, cfg.copias, path.join(cfg.copias, 'pdfs')]) fs.mkdirSync(d, { recursive: true });
  const base = fs.realpathSync(cfg.carpeta), copias = fs.realpathSync(cfg.copias), pdfs = path.join(copias, 'pdfs');
  const maxPdf = cfg.maxPdfMB * MB, maxCopia = cfg.maxCopiaMB * MB, maxTotal = cfg.maxCopiasMB * MB;
  const tokens = new Map(), cache = new Map(), intentos = new Map(), sanos = new Map();
  let codigo = '', total = 0, lista = new Map();

  function nuevo() {
    codigo = String(crypto.randomInt(1000000)).padStart(6, '0');
    log(`\n  Código para el iPad:   ${codigo.slice(0, 3)} ${codigo.slice(3)}   (sirve una sola vez)\n`);
  }

  class Err extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  // Los fallos se cuentan por equipo: uno ajeno no puede bloquear al iPad ni apagar el servidor.
  function entrar(d, ip) {
    const x = intentos.get(ip) || { n: 0, hasta: 0 };
    intentos.set(ip, x);
    if (x.n >= 20) throw new Err(429, 'Demasiados intentos: reinicia el servidor en el PC');
    if (Date.now() < x.hasta) throw new Err(429, 'Demasiados intentos: espera medio minuto');
    const c = typeof d.codigo === 'string' ? d.codigo.replace(/\s/g, '') : '';
    if (!/^\d{6}$/.test(c) || !crypto.timingSafeEqual(Buffer.from(c), Buffer.from(codigo))) {
      if (++x.n % 5 === 0) { x.hasta = Date.now() + 30000; log(`  Aviso: ${x.n} códigos incorrectos desde ${ip}`); }
      if (++total % 100 === 0) nuevo();
      throw new Err(403, 'Código incorrecto');
    }
    const t = crypto.randomBytes(32).toString('hex');
    tokens.set(t, ip);
    x.n = 0;
    log('  iPad conectado.');
    nuevo();
    return { token: t };
  }

  // Recorre la carpeta sin seguir enlaces. La lista que resulta es cerrada.
  async function listar() {
    const m = new Map(), avisos = [];
    const ver = async (dir, rel, prof) => {
      if (prof > 12) return;
      let es;
      try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { avisos.push((rel || 'la carpeta') + ': no se puede leer'); return; }
      for (const e of es.sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
        const f = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
        if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
        if (e.isDirectory()) { await ver(f, r, prof + 1); continue; }
        if (!e.isFile() || !/\.pdf$/i.test(e.name)) continue;
        if (m.size >= 5000) { avisos.push('Hay más de 5000 PDFs: solo se muestran los primeros'); return; }
        try {
          const s = fs.statSync(f);
          if (!dentro(base, fs.realpathSync(f))) continue;
          if (s.size > maxPdf) { avisos.push(r + ': supera ' + cfg.maxPdfMB + ' MB'); continue; }
          if (!esPdf(f)) { avisos.push(r + ': no es un PDF'); continue; }
          let c = cache.get(f);
          if (!c || c.size !== s.size || c.mtime !== s.mtimeMs) { c = { size: s.size, mtime: s.mtimeMs, hash: await sha256(f) }; cache.set(f, c); }
          m.set(crypto.createHash('sha256').update(r).digest('hex').slice(0, 32), { f, r, ...c });
        } catch { avisos.push(r + ': no se puede leer'); }
      }
    };
    await ver(base, '', 0);
    lista = m;
    return { archivos: [...m].map(([id, x]) => ({ id, ruta: x.r, tam: x.size, hash: x.hash })), avisos };
  }

  function rango(q) {
    const d = q.get('desde') || '', n = q.get('cuanto') || '';
    if (!/^\d{1,12}$/.test(d) || !/^\d{1,9}$/.test(n)) throw new Err(400, 'Rango no válido');
    return [Number(d), Math.min(Number(n), TROZO)];
  }
  function leer(file, [desde, cuanto], size) {
    const fd = fs.openSync(file, 'r');
    try {
      const s = fs.fstatSync(fd);
      if (size !== undefined && s.size !== size) throw new Err(409, 'El archivo ha cambiado en el PC: vuelve a cargar la lista');
      const b = Buffer.alloc(Math.max(0, Math.min(cuanto, s.size - desde)));
      const n = b.length ? fs.readSync(fd, b, 0, b.length, desde) : 0;
      return b.subarray(0, n);
    } finally { fs.closeSync(fd); }
  }
  function archivo(q) {
    const x = lista.get(q.get('id') || '');
    if (!x) throw new Err(404, 'Ese archivo no está en la lista');
    const s = fs.lstatSync(x.f, { throwIfNoEntry: false });
    if (!s || !s.isFile() || s.mtimeMs !== x.mtime || !dentro(base, fs.realpathSync(x.f))) throw new Err(409, 'El archivo ha cambiado en el PC: vuelve a cargar la lista');
    return leer(x.f, rango(q), x.size);
  }

  const ocupado = () => [copias, pdfs].flatMap((d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => fs.statSync(path.join(d, e.name)).size)).reduce((a, b) => a + b, 0);

  function guardarCopia(body) {
    let d;
    try { d = JSON.parse(body.toString('utf8')); } catch { throw new Err(400, 'La copia no es JSON'); }
    if (!d || d.formato !== 'atril-copia' || d.version !== 1) throw new Err(400, 'No es una copia de Atril');
    if (ocupado() + body.length > maxTotal) throw new Err(507, 'La carpeta de copias está llena');
    const t = new Date(), z = (n) => String(n).padStart(2, '0');
    const b = `copia-${t.getFullYear()}${z(t.getMonth() + 1)}${z(t.getDate())}-${z(t.getHours())}${z(t.getMinutes())}${z(t.getSeconds())}`;
    for (let i = 0; i < 10; i++) {
      const n = b + (i ? '-' + i : '') + '.json';
      const fin = path.join(copias, n);
      if (fs.existsSync(fin)) continue;
      // Escribir y renombrar: un corte no deja una copia a medias con nombre válido.
      fs.writeFileSync(fin + '.tmp', body);
      fs.renameSync(fin + '.tmp', fin);
      log('  Copia recibida: ' + n);
      return { nombre: n };
    }
    throw new Err(429, 'Demasiadas copias seguidas');
  }
  const listarCopias = () => ({
    copias: fs.readdirSync(copias).filter((n) => COPIA.test(n)).sort().reverse().slice(0, 100)
      .map((n) => ({ nombre: n, tam: fs.statSync(path.join(copias, n)).size })),
  });
  function leerCopia(q) {
    const n = q.get('nombre') || '';
    const f = path.join(copias, n);
    if (!COPIA.test(n) || !fs.existsSync(f)) throw new Err(404, 'No existe esa copia');
    if (fs.statSync(f).size > maxCopia) throw new Err(413, 'Copia demasiado grande');
    return fs.readFileSync(f);
  }
  function rutaPdf(q) {
    const h = q.get('hash') || '';
    if (!HASH.test(h)) throw new Err(400, 'Huella no válida');
    return [path.join(pdfs, h + '.pdf'), path.join(pdfs, h + '.parte'), h];
  }
  // Un PDF de la copia que se haya dañado en el disco se vuelve a pedir.
  async function estadoPdf(q) {
    const [fin, parte, h] = rutaPdf(q);
    if (fs.existsSync(fin)) {
      const s = fs.statSync(fin), k = s.size + '/' + s.mtimeMs;
      if (sanos.get(h) !== k && await sha256(fin) === h) sanos.set(h, k);
      if (sanos.get(h) === k) return { completo: true, tam: s.size };
      fs.rmSync(fin, { force: true });
    }
    return { completo: false, tam: fs.existsSync(parte) ? fs.statSync(parte).size : 0 };
  }
  async function guardarPdf(q, body) {
    const [fin, parte, h] = rutaPdf(q);
    const d = q.get('desde') || '', t = q.get('total') || '';
    if (!/^\d{1,12}$/.test(d) || !/^\d{1,12}$/.test(t) || !body.length) throw new Err(400, 'Datos no válidos');
    const desde = Number(d), tot = Number(t);
    if (tot > maxPdf || desde + body.length > tot) throw new Err(413, 'PDF demasiado grande');
    if (fs.existsSync(fin)) return { completo: true, tam: tot };
    const hay = fs.existsSync(parte) ? fs.statSync(parte).size : 0;
    if (desde < hay) fs.truncateSync(parte, desde);
    if (desde > hay) throw new Err(409, 'El trozo no encaja');
    if (!desde && !body.subarray(0, 1024).includes('%PDF-')) throw new Err(400, 'No es un PDF');
    if (ocupado() + body.length > maxTotal) throw new Err(507, 'La carpeta de copias está llena');
    fs.appendFileSync(parte, body);
    if (desde + body.length < tot) return { completo: false, tam: desde + body.length };
    if (await sha256(parte) !== h) { fs.rmSync(parte, { force: true }); throw new Err(422, 'El PDF ha llegado dañado'); }
    fs.renameSync(parte, fin);
    return { completo: true, tam: tot };
  }

  function cuerpo(req, max) {
    return new Promise((ok, ko) => {
      const n = Number(req.headers['content-length']);
      if (!Number.isInteger(n) || n < 0) { ko(new Err(411, 'Falta el tamaño')); return; }
      if (n > max) { ko(new Err(413, 'Demasiado grande')); return; }
      const l = []; let got = 0;
      req.on('data', (c) => { got += c.length; if (got > max) { ko(new Err(413, 'Demasiado grande')); req.destroy(); } else l.push(c); });
      req.on('end', () => ok(Buffer.concat(l)));
      req.on('error', ko);
      req.on('aborted', () => ko(new Err(400, 'Cortado')));
    });
  }

  // Devuelve {code, type, body}.
  async function atender(req) {
    const json = (o, code = 200) => ({ code, type: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify(o)) });
    const bin = (b) => ({ code: 200, type: 'application/octet-stream', body: b });
    try {
      const u = new URL(req.url, 'http://x'), q = u.searchParams, ruta = req.method + ' ' + u.pathname;
      const o = req.headers.origin;
      if (o && o !== 'http://' + req.headers.host) throw new Err(403, 'Origen no válido');
      if (ruta === 'POST /api/entrar') {
        let d; const b = await cuerpo(req, 200);
        try { d = JSON.parse(b.toString()) || {}; } catch { throw new Err(400, 'Petición no válida'); }
        return json(entrar(d, req.socket.remoteAddress));
      }
      if (tokens.get(String(req.headers['x-atril'] || '')) !== req.socket.remoteAddress) throw new Err(401, 'Hace falta el código del PC');
      switch (ruta) {
        case 'GET /api/lista': return json(await listar());
        case 'GET /api/pdf': return bin(archivo(q));
        case 'GET /api/copias': return json(listarCopias());
        case 'GET /api/copia': return bin(leerCopia(q));
        case 'POST /api/copia': return json(guardarCopia(await cuerpo(req, maxCopia)));
        case 'GET /api/copia-estado': return json(await estadoPdf(q));
        case 'GET /api/copia-pdf': { const [f] = rutaPdf(q); if (!fs.existsSync(f)) throw new Err(404, 'Ese PDF no está en la copia'); return bin(leer(f, rango(q))); }
        case 'POST /api/copia-pdf': return json(await guardarPdf(q, await cuerpo(req, TROZO)));
        default: throw new Err(404, 'No existe');
      }
    } catch (e) {
      if (!(e instanceof Err)) console.error(e);
      return json({ error: e instanceof Err ? e.message : 'Error del servidor' }, e instanceof Err ? e.code : 500);
    }
  }
  return { atender, nuevo };
}
