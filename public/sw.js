// Service worker minimal : met en cache les fichiers statiques uniquement.
// Jamais les sockets (/socket.io/), ni les pages HTML (toujours servies fraîches par le réseau).
const VERSION = 'av-v1';
const STATIC = [
  '/css/app.css',
  '/js/main.js',
  '/js/dom.js',
  '/js/icons.js',
  '/js/net.js',
  '/js/session.js',
  '/js/comfort.js',
  '/js/qr.js',
  '/js/components.js',
  '/js/views/home.js',
  '/js/views/invite.js',
  '/js/views/lobby.js',
  '/js/views/share.js',
  '/js/views/game.js',
  '/js/views/tv.js',
  '/vendor/qrcode.js',
  '/fonts/inter-400.woff2',
  '/fonts/inter-500.woff2',
  '/fonts/inter-600.woff2',
  '/fonts/inter-700.woff2',
  '/fonts/bricolage-600.woff2',
  '/fonts/bricolage-800.woff2',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/socket.io/')) return; // temps réel : jamais en cache
  const isStatic = /^\/(css|js|fonts|vendor|icons)\//.test(url.pathname);
  if (!isStatic) return; // pages et le reste : réseau

  // Statique : réseau d'abord (pour avoir les mises à jour), cache en secours hors ligne.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
