// v2 : le cache-first précédent gardait les fichiers de l'app (app.js, styles.css...)
// figés indéfiniment — une fois mis en cache une première fois, les mises à jour ne
// s'affichaient jamais tant que le nom du cache ne changeait pas. Passage en
// network-first pour l'app shell : on sert toujours la version la plus récente quand
// une connexion est disponible, et on ne retombe sur le cache qu'hors-ligne.
const CACHE_NAME = 'konkou-shell-v2';
const SHELL_FILES = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icon.svg', '/logo.png', '/logo-watermark.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ error: 'Hors ligne' }), {
      headers: { 'Content-Type': 'application/json' }, status: 503
    })));
    return;
  }

  // App shell : réseau d'abord (toujours la dernière version tant qu'on est en ligne),
  // on met à jour le cache au passage, et on ne sert le cache que si le réseau échoue
  // (hors-ligne) — au lieu de cache-first qui figeait la version pour toujours.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
