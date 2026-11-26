// Service worker de la versión web (GitHub Pages, iOS 13 o posterior): guarda la app para usarla sin conexión.
// El build pone la versión y la lista de archivos. ES5 escrito a mano: no pasa por Babel.
var REV = "1.0.0-d86ed6df820a4c0d";
var FILES = ["./","app.css","app.js","icon-152.png","icon-180.png","index.html","pdf.js","pdf.worker.js","polyfills.js","prueba/limpio.pdf","prueba/mal-escaneo.pdf"];
var CACHE = 'atril-' + REV;

self.addEventListener('install', function (e) {
  // ?v= salta la caché HTTP de GitHub (10 min): sin él, una versión nueva podría mezclarse con archivos viejos.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(FILES.map(function (f) {
      return fetch(f + '?v=' + REV, { cache: 'no-store' }).then(function (r) {
        if (!r.ok || r.redirected) throw new Error(f + ': ' + r.status);
        return c.put(f, r);
      });
    }));
  }));
});

// La versión vieja sigue sirviendo hasta que se pulsa «Actualizar ahora»; entonces se borra su caché.
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('atril-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  if (e.data === 'activar') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.url.indexOf(self.registration.scope) !== 0) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (r) {
      if (r) return r;
      if (req.mode === 'navigate') return c.match('./');
      return fetch(req);
    });
  }));
});
