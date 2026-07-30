// Logique d'abonnement aux notifications push (voir backend/webpush.js), partagée entre
// frontend/app.js (joueur/agent) ET frontend/admin.js — les deux sont chargés en
// type="module" (voir index.html/admin.html), donc un vrai import ES est possible ici,
// contrairement au reste de ces deux fichiers qui se contentent chacun de dupliquer leurs
// petits utilitaires (pwdField, phoneField, escapeHtml...) faute de bundler. On fait
// exception à cette habitude pour CE module précis parce qu'il contient une conversion
// binaire (base64url -> Uint8Array) où la moindre divergence entre deux copies serait facile
// à louper et pénible à déboguer si elle finissait par diverger avec le temps.
//
// Chaque fonction ci-dessous prend en paramètre la fonction `api()` propre à l'appelant
// (celle d'app.js ou celle d'admin.js — mêmes signature/comportement : ajoute le bon jeton
// Bearer, lève une erreur avec `.message` en cas d'échec) plutôt que de l'importer, pour ne
// pas créer de dépendance dans l'autre sens et garder ce module totalement autonome.

// Convertit la clé publique VAPID encodée en base64url (voir GET /api/push/vapid-public-key)
// en Uint8Array — c'est le format brut qu'attend PushManager.subscribe({applicationServerKey})
// côté navigateur, et backend/generate-vapid-keys.js produit déjà la clé dans ce même format
// "point EC brut" pour que cette conversion n'ait rien d'autre à faire qu'un simple décodage.
function base64UrlToUint8Array(base64url) {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Vrai si CET appareil/navigateur a déjà un abonnement push actif — interrogé directement
// auprès du PushManager du navigateur (pas du serveur, qui ne connaît que des endpoints déjà
// enregistrés, jamais "cet appareil-ci" avant qu'on lui pose la question) : c'est ce qui
// permet aux écrans (Profil, Espace Agent, Réglages admin) d'afficher "🔔 Activer" ou
// "🔕 Désactiver" sans avoir à mémoriser un état séparé.
export async function isPushSubscribed() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

// Résultats possibles : 'unsupported' (navigateur sans Push API — Safari desktop ancien, ou
// PWA iOS pas encore installée sur l'écran d'accueil, voir la note dans README.md), 'denied'
// (permission explicitement refusée — le navigateur ne redemandera plus tant que la personne
// ne la réinitialise pas elle-même dans ses réglages), 'dismissed' (fenêtre système fermée
// sans choix explicite), 'error' (config serveur manquante ou échec réseau), 'subscribed'
// (succès, abonnement enregistré côté serveur).
export async function subscribeToPush(api) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { status: 'unsupported' };
  }

  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { status: 'unsupported' };
  }
  if (permission !== 'granted') {
    return { status: permission === 'denied' ? 'denied' : 'dismissed' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const keyRes = await fetch('/api/push/vapid-public-key');
    const keyData = await keyRes.json().catch(() => ({}));
    if (!keyRes.ok) return { status: 'error', error: keyData.error || 'Notifications non configurées côté serveur' };

    // Réutilise un abonnement déjà présent côté navigateur s'il y en a un (ex: permission
    // accordée lors d'une session précédente, mais jamais confirmée côté serveur pour une
    // raison ou une autre) plutôt que d'en créer un second pour le même appareil.
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, // exigé par la spec : toute notification reçue doit être visible, jamais de "push silencieux"
        applicationServerKey: base64UrlToUint8Array(keyData.publicKey)
      });
    }

    await api('/push/subscribe', { method: 'POST', body: { subscription: subscription.toJSON() } });
    return { status: 'subscribed' };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

export async function unsubscribeFromPush(api) {
  if (!('serviceWorker' in navigator)) return { status: 'unsupported' };
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return { status: 'unsubscribed' };
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      // Supprime d'abord côté serveur (tant que l'endpoint est encore valide pour
      // s'authentifier auprès de lui), puis côté navigateur — dans cet ordre, un échec
      // réseau laisse l'abonnement actif des deux côtés plutôt que désynchronisé.
      await api('/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } });
      await subscription.unsubscribe();
    }
    return { status: 'unsubscribed' };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

// ---------- Bloc UI partagé (bouton + texte + gestion du clic) ----------
// Réutilisé tel quel par frontend/app.js (Profil, Espace Agent) ET frontend/admin.js
// (Réglages) — volontairement sans dépendance à `state`/`setState` d'aucun des deux
// fichiers : `subscribed` est passé en paramètre (lu depuis le state de l'appelant au
// moment du rendu) et `onResult` est un callback que l'appelant fournit pour traduire le
// résultat en mise à jour de SON propre state (chaque fichier a sa propre fonction
// setState(), pas de state partagé entre app.js et admin.js).
export function notificationsToggleHtml(subscribed, description) {
  return `
    <button class="secondary" id="notifications-toggle-btn" type="button" style="margin-top:10px;">
      ${subscribed ? '🔕 Désactiver les notifications' : '🔔 Activer les notifications'}
    </button>
    <p style="font-size:12px; color:var(--muted); margin:6px 0 0;">${description}</p>
  `;
}

// `onResult(result)` reçoit exactement l'objet renvoyé par subscribeToPush()/
// unsubscribeFromPush() ci-dessus ({ status, error? }) — chaque appelant décide comment
// traduire chaque `status` en message affiché (voir app.js/admin.js), pour garder les
// textes cohérents avec le vocabulaire propre à chaque écran (joueur/agent vs admin)
// plutôt que de figer un message générique ici.
export function bindNotificationsToggleEvents(api, subscribed, onResult) {
  const btn = document.getElementById('notifications-toggle-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const result = subscribed ? await unsubscribeFromPush(api) : await subscribeToPush(api);
    btn.disabled = false;
    onResult(result);
  });
}
