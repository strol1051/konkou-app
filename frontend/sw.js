// v2 : le cache-first précédent gardait les fichiers de l'app (app.js, styles.css...)
// figés indéfiniment — une fois mis en cache une première fois, les mises à jour ne
// s'affichaient jamais tant que le nom du cache ne changeait pas. Passage en
// network-first pour l'app shell : on sert toujours la version la plus récente quand
// une connexion est disponible, et on ne retombe sur le cache qu'hors-ligne.
// v3 (juillet 2026) : le network-first de v2 appelait fetch() sans préciser d'option de
// cache — ce qui laisse le NAVIGATEUR lui-même décider de servir une réponse depuis SON
// propre cache HTTP local plutôt que d'aller réellement sur le réseau, si le serveur
// n'envoyait aucun en-tête Cache-Control (corrigé côté serveur en même temps, voir
// backend/server.js, NO_CACHE). Un correctif de style.css ne s'affichait donc pas sur un
// appareil qui avait déjà visité l'app, même après une vraie mise à jour serveur. Changer
// CACHE_NAME force ce service worker à repartir d'un cache vide dès sa prochaine
// activation (voir 'activate' ci-dessous, qui supprime tout cache dont le nom diffère).
const CACHE_NAME = 'konkou-shell-v3';
const SHELL_FILES = ['/', '/index.html', '/styles.css', '/app.js', '/push-client.js', '/manifest.json', '/icon.png', '/logo.png', '/logo-watermark.png'];

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

// ---------- Notifications push (voir backend/webpush.js, juillet 2026) ----------
// Le service worker est la SEULE partie de l'app qui reste "vivante" (rappelée par le
// système) même quand aucun onglet Konkou n'est ouvert — c'est pourquoi le protocole Web
// Push exige que ce soit lui, et non app.js/admin.js, qui reçoive l'évènement 'push' et
// affiche la notification système.

// Le navigateur a déjà déchiffré le message (voir backend/webpush.js pour le chiffrement
// correspondant côté serveur) avant de déclencher cet évènement — event.data.json() donne
// directement l'objet { title, body, url } envoyé par notifyAdmins()/notifyUser() (voir
// routes/push.js). Si jamais le payload est absent/invalide (ne devrait jamais arriver vu
// le format contrôlé côté serveur, mais un service worker qui plante sur un évènement
// 'push' peut faire perdre le "budget" de notifications que le navigateur accorde par
// abonnement), on retombe sur un titre générique plutôt que d'échouer silencieusement.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || 'Konkou';
  const options = {
    body: data.body || '',
    icon: '/icon.png', // affichée dans la notification elle-même
    badge: '/icon.png', // petite icône monochrome (barre de notif Android) — même fichier, le navigateur l'adapte
    data: { url: data.url || '/' } // récupéré par 'notificationclick' ci-dessous
  };

  // event.waitUntil garde le service worker actif le temps que showNotification() se
  // termine — sans ça, le navigateur pourrait le stopper avant que la notification soit
  // effectivement créée, surtout sur un appareil qui essaie d'économiser la batterie.
  event.waitUntil(self.registration.showNotification(title, options));
});

// Un tap sur la notification doit amener la personne DANS l'app, sur l'écran pertinent
// (`data.url`, ex: '/' pour un joueur qui doit choisir un nouveau mot de passe, '/admin.html'
// pour un admin qui doit confirmer une vérification) — pas simplement fermer la notification.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      // Si Konkou est déjà ouvert dans un onglet (même sur un autre écran de l'app), on le
      // ramène au premier plan plutôt que d'en ouvrir un second — plus proche du
      // comportement attendu d'une vraie notification d'app native.
      const existing = clientsArr.find((c) => c.url.startsWith(self.location.origin));
      if (existing) {
        return existing.focus().then(() => {
          if ('navigate' in existing) return existing.navigate(targetUrl);
        });
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
