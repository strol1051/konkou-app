import db from '../db.js';
import { getVapidPublicKey, sendPushNotification } from '../webpush.js';

// Public — lu par frontend/app.js et frontend/admin.js avant d'appeler
// PushManager.subscribe({ applicationServerKey }), voir subscribeToPush() dans les deux
// fichiers. Aucune information sensible : c'est une clé PUBLIQUE, censée être connue de
// n'importe quel navigateur qui souhaite s'abonner.
export function getVapidPublicKeyRoute() {
  const key = getVapidPublicKey();
  if (!key) {
    return {
      status: 503,
      data: { error: "Les notifications push ne sont pas configurées côté serveur (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY manquantes — voir backend/generate-vapid-keys.js)." }
    };
  }
  return { status: 200, data: { publicKey: key } };
}

// `subjectType` ('admin' | 'user') est déterminé par server.js à partir du jeton
// d'authentification présenté (jamais depuis le corps de la requête — voir server.js,
// POST /api/push/subscribe : un jeton admin donne subjectType='admin', un jeton joueur/
// agent donne subjectType='user' avec son propre userId). Ça évite qu'un client puisse
// prétendre être admin simplement en le déclarant dans le JSON envoyé.
//
// UPSERT sur `endpoint` (unique) plutôt qu'un INSERT simple : un même navigateur qui se
// réabonne (permission déjà accordée, mais ex. après un changement de compte sur le même
// appareil) doit remplacer son ancienne ligne, jamais en accumuler une par appel — sinon
// notifyUser()/notifyAdmins() enverraient plusieurs notifications identiques au même
// appareil, ou pire, une ligne orpheline resterait rattachée au mauvais user_id après un
// changement de compte sur un appareil partagé.
export function subscribePush(subjectType, userId, body) {
  const sub = body?.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return { status: 400, data: { error: "Abonnement invalide (endpoint/clés manquants)" } };
  }

  db.prepare(`
    INSERT INTO push_subscriptions (subject_type, user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET subject_type = excluded.subject_type, user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(subjectType, subjectType === 'admin' ? null : userId, endpoint, p256dh, auth);

  return { status: 200, data: { message: 'Notifications activées.' } };
}

// Appelé quand l'utilisateur désactive lui-même les notifications (voir bouton
// "🔕 Désactiver" dans Profil/Espace Agent/Réglages admin) — supprime uniquement SA
// propre ligne (par endpoint, qu'il est seul à connaître via son propre PushSubscription
// côté navigateur), jamais besoin de vérifier le propriétaire puisque l'endpoint lui-même
// en tient lieu (comme un secret propre à cet abonnement précis).
export function unsubscribePush(body) {
  const endpoint = body?.endpoint;
  if (!endpoint) return { status: 400, data: { error: 'endpoint requis' } };
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  return { status: 200, data: { message: 'Notifications désactivées.' } };
}

// ---------- Orchestration : envoi effectif des notifications ----------
// Utilisées en "fire-and-forget" par routes/auth.js (nouvelle inscription/réinitialisation
// à confirmer -> tous les admins abonnés) et routes/admin.js (réinitialisation autorisée ->
// le joueur/agent concerné) — voir les commentaires sur chaque appel pour le détail. Jamais
// attendues de façon bloquante par l'appelant : un envoi de notification qui échoue ou qui
// prend du temps ne doit jamais retarder ni faire échouer la réponse HTTP de l'action
// métier réelle (inscription, confirmation...).
//
// Nettoie automatiquement tout abonnement que le service de push signale comme expiré
// (HTTP 404/410, voir sendPushNotification dans webpush.js) — c'est la façon normale dont
// un navigateur "se désabonne silencieusement" (cache vidé, désinstallation, etc.), donc on
// n'a pas besoin d'attendre que l'utilisateur clique un jour sur "désactiver" pour que la
// table push_subscriptions reste à jour.
export async function notifyAdmins(payloadObj) {
  const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE subject_type = 'admin'`).all();
  await Promise.all(subs.map(async (sub) => {
    const result = await sendPushNotification(sub, payloadObj);
    if (result.expired) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
  }));
}

export async function notifyUser(userId, payloadObj) {
  const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE subject_type = 'user' AND user_id = ?`).all(userId);
  await Promise.all(subs.map(async (sub) => {
    const result = await sendPushNotification(sub, payloadObj);
    if (result.expired) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
  }));
}
