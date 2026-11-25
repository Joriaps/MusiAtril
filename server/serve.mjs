// Servidor temporal de Atril: solo red local, se apaga solo.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP } from '../scripts/csp.mjs';
import { crearApi } from './api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const argCfg = process.argv.indexOf('--config');
const cfgFile = argCfg > 0 ? path.resolve(process.argv[argCfg + 1]) : path.join(root, 'atril.config.json');
const cfg = { puerto: 8377, direccion: '', minutosInactivo: 30, carpeta: './partituras', copias: './copias', maxPdfMB: 300, maxCopiaMB: 20, maxCopiasMB: 20000, ...(fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {}) };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.appcache': 'text/cache-manifest' };

const privado = new net.BlockList();
privado.addSubnet('10.0.0.0', 8); privado.addSubnet('172.16.0.0', 12); privado.addSubnet('192.168.0.0', 16);
privado.addSubnet('127.0.0.0', 8); privado.addSubnet('169.254.0.0', 16);
export const esPrivada = (ip) => { const v4 = String(ip || '').replace(/^::ffff:/, ''); return net.isIPv4(v4) && privado.check(v4); };

// Lista cerrada de archivos de dist/ leída al arrancar: una ruta que no esté en ella no
// existe, así que no hay traversal posible.
function leerDist(dir, base = '', m = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base + e.name;
    if (e.isDirectory()) leerDist(path.join(dir, e.name), rel + '/', m);
    else if (e.isFile() && TYPES[path.extname(e.name)]) m.set('/' + rel, { type: TYPES[path.extname(e.name)], data: fs.readFileSync(path.join(dir, e.name)) });
  }
  return m;
}

export function crear(hosts, files, api, alUsar = () => {}) {
  const srv = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const end = (code, type, body, extra) => {
      res.writeHead(code, {
        'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache, must-revalidate',
        'Content-Security-Policy': CSP + "; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', ...extra,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const no = (code, msg) => end(code, 'text/plain; charset=utf-8', msg, code >= 400 ? { Connection: 'close' } : {});
    if (!esPrivada(req.socket.remoteAddress)) return no(403, 'Solo red local');
    if (!hosts.has(String(req.headers.host || '').toLowerCase())) return no(421, 'Host no válido');
    if (api && String(req.url).startsWith('/api/')) {
      api.atender(req).then((r) => {
        if (r.code < 400) alUsar();
        end(r.code, r.type, r.body, { 'Cache-Control': 'no-store', ...(r.code >= 400 ? { Connection: 'close' } : {}) });
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return no(405, 'Solo lectura');
    alUsar();
    let p = String(req.url).split('?')[0];
    if (p === '/') p = '/index.html';
    const f = files.get(p);
    // Un 404 del manifiesto haría que iOS borrase la app: se responde 503, que la conserva.
    if (!f) return p.endsWith('.appcache') ? no(503, 'No disponible') : no(404, 'No existe');
    end(200, f.type, f.data);
  });
  srv.requestTimeout = 60000; srv.headersTimeout = 8000; srv.keepAliveTimeout = 5000; srv.maxConnections = 128;
  // Ningún equipo puede acaparar todas las conexiones.
  const porIp = new Map();
  srv.on('connection', (s) => {
    const ip = s.remoteAddress, n = (porIp.get(ip) || 0) + 1;
    porIp.set(ip, n);
    s.on('close', () => porIp.set(ip, porIp.get(ip) - 1));
    if (n > 12) s.destroy();
  });
  return srv;
}

function direccionesLan() {
  const r = [];
  for (const [n, l] of Object.entries(os.networkInterfaces())) for (const a of l) {
    if (a.family === 'IPv4' && !a.internal && esPrivada(a.address) && !a.address.startsWith('169.254.')) r.push({ n, ip: a.address, virtual: /virtual|vethernet|vmware|hyper|wsl|vpn|tailscale|docker/i.test(n) });
  }
  return r.sort((a, b) => a.virtual - b.virtual);
}

function main() {
  if (!fs.existsSync(path.join(dist, 'atril.appcache'))) { console.error('Falta dist/. Ejecuta antes: npm run build'); process.exit(1); }
  const files = leerDist(dist), lan = direccionesLan();
  const local = process.argv.includes('--local');
  const ip = local ? '127.0.0.1' : (cfg.direccion || (lan[0] && lan[0].ip));
  if (!ip) { console.error('No encuentro ninguna red local. Conecta el PC a la WiFi o al router.'); process.exit(1); }
  if (!local && !lan.some((a) => a.ip === ip)) {
    console.error(`\nEste PC ya no tiene la dirección ${ip} (ahora: ${lan.map((a) => a.ip).join(', ') || 'ninguna'}).\nEl iPad tiene la app y las partituras asociadas a esa dirección: vuelve a asignarla al PC\n(reserva DHCP en el router). Si aún no has instalado la app, cambia "direccion" en atril.config.json.\n`);
    process.exit(1);
  }
  const port = Number(cfg.puerto), hosts = new Set([`${ip}:${port}`]);
  if (local) hosts.add(`localhost:${port}`);
  let timer;
  const alUsar = () => { clearTimeout(timer); timer = setTimeout(() => { console.log('\nSin actividad: servidor apagado.'); process.exit(0); }, Math.max(1, Number(cfg.minutosInactivo) || 30) * 60000); };
  const abs = (p) => path.resolve(path.dirname(cfgFile), String(p));
  const api = crearApi({ ...cfg, carpeta: abs(cfg.carpeta), copias: abs(cfg.copias) });
  const srv = crear(hosts, files, api, alUsar);
  srv.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `El puerto ${port} está ocupado: ¿ya está encendido el servidor?` : e.message); process.exit(1); });
  srv.listen(port, ip, () => {
    if (!local && !cfg.direccion) fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, direccion: ip }, null, 2) + '\n');
    alUsar();
    console.log(`\n  Atril · servidor temporal\n\n  En Safari del iPad abre:   http://${ip}:${port}/\n\n  Se apaga con Ctrl+C o tras ${cfg.minutosInactivo} minutos sin uso.\n  No abras este puerto en el router.\n  Partituras del PC: ${abs(cfg.carpeta)}`);
    api.nuevo();
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
