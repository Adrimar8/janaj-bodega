// Service worker: guarda la app en el equipo para que abra sin internet.
const VERSION = 'janaj-v1.4.0';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/db.js', 'js/ui.js', 'js/store.js', 'js/scanner.js', 'js/sync.js', 'js/remote-firebase.js', 'js/firebase-config.js',
  'js/views/pos.js', 'js/views/inventory.js', 'js/views/rates.js', 'js/views/fiado.js',
  'js/views/caja.js', 'js/views/reports.js', 'js/views/settings.js', 'js/views/import.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Archivos propios: primero la copia guardada y en segundo plano se actualiza. APIs externas: siempre red.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    return cached || (await net) || cache.match('index.html');
  }));
});
