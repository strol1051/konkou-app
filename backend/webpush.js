import crypto from 'node:crypto';

// Notifications push (Web Push) — juillet 2026. Konkou reste zéro-dépendance : plutôt que
// d'installer le paquet npm "web-push" (le choix le plus courant pour ça), ce fichier
// réimplémente à la main les deux briques cryptographiques nécessaires, avec les seules
// primitives déjà natives à Node (node:crypto) :
//   1. VAPID (RFC 8292) — un jeton signé qui prouve au service de push du navigateur
//      (Chrome/Firefox/etc.) que c'est bien LE MÊME serveur Konkou qui avait demandé
//      l'abonnement qui envoie maintenant ce message, sans quoi n'importe qui pourrait
//      spammer les abonnés de n'importe quelle app.
//   2. Le chiffrement du contenu du message (RFC 8291 + RFC 8188 "aes128gcm") — le service
//      de push (Google/Mozilla/etc.) ne fait que relayer des octets opaques : il ne peut
//      JAMAIS lire le contenu de la notification, seul le navigateur du destinataire (qui
//      détient la clé privée correspondant à p256dh/auth) peut la déchiffrer. C'est une
//      exigence du protocole, pas un choix de Konkou.
//
// Ces deux briques sont intentionnellement fidèles à la spec, brique par brique, plutôt que
// simplifiées : un service de push réel (FCM pour Chrome, autopush pour Firefox...) rejette
// silencieusement tout message mal formé, donc il n'y a pas de marge d'approximation ici.

const VAPID_TTL_SECONDS = 12 * 60 * 60; // durée de vie du jeton VAPID (max recommandé par la RFC), pas celle du message lui-même
const PUSH_MESSAGE_TTL_SECONDS = 60 * 60 * 24; // combien de temps le service de push doit réessayer si l'appareil est hors-ligne (1 jour)

function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

// Les clés VAPID sont générées une seule fois (voir backend/generate-vapid-keys.js) et
// stockées dans VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (variables d'environnement, comme
// JWT_SECRET/ADMIN_PASSWORD) — jamais réengendrées au démarrage, sinon tous les
// abonnements existants (liés à l'ancienne clé publique) deviendraient invalides à chaque
// redéploiement. Format choisi : le point EC public brut non compressé (65 octets :
// 0x04 || X(32) || Y(32)) et le scalaire privé brut (32 octets), tous deux encodés en
// base64url — exactement le format que `PushManager.subscribe({applicationServerKey})`
// attend côté navigateur pour la clé publique, ce qui évite toute conversion supplémentaire
// côté frontend (voir subscribeToPush() dans frontend/app.js/admin.js).
export function getVapidKeys() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;

  let pubBuf, privBuf;
  try {
    pubBuf = Buffer.from(pub, 'base64url');
    privBuf = Buffer.from(priv, 'base64url');
  } catch {
    return null;
  }
  if (pubBuf.length !== 65 || pubBuf[0] !== 0x04 || privBuf.length !== 32) return null;

  const x = pubBuf.subarray(1, 33).toString('base64url');
  const y = pubBuf.subarray(33, 65).toString('base64url');
  const d = privBuf.toString('base64url');

  try {
    const privateKey = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d, x, y }, format: 'jwk' });
    return { privateKey, publicKeyRaw: pubBuf, publicKeyBase64url: pub };
  } catch {
    return null;
  }
}

// Construit l'en-tête "Authorization: vapid t=<jwt>, k=<clé publique>" (RFC 8292) attendu
// par le service de push. `aud` doit être l'origine exacte (schéma+hôte) de l'URL
// d'endpoint de CET abonnement précis (ex: "https://fcm.googleapis.com") — pas l'endpoint
// complet, et pas notre propre domaine.
export function buildVapidAuthHeader(endpoint, vapidKeys) {
  const aud = new URL(endpoint).origin;
  const subject = process.env.VAPID_SUBJECT || 'mailto:contact@konkouapp.com';
  const now = Math.floor(Date.now() / 1000);

  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = { aud, exp: now + VAPID_TTL_SECONDS, sub: subject };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  // dsaEncoding: 'ieee-p1363' est ESSENTIEL ici — le format par défaut de Node ('der') ne
  // produit pas la même chose que ce qu'exige un JWS ES256 (RFC 7518 §3.4 : concaténation
  // brute r||s sur 64 octets pour P-256, jamais l'encodage ASN.1/DER standard de OpenSSL).
  // Un jeton signé avec l'encodage par défaut serait rejeté par le service de push comme
  // signature invalide, silencieusement, sans message d'erreur exploitable.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: vapidKeys.privateKey,
    dsaEncoding: 'ieee-p1363'
  });

  const jwt = `${signingInput}.${base64url(signature)}`;
  return `vapid t=${jwt}, k=${vapidKeys.publicKeyBase64url}`;
}

// Chiffre `payloadObj` (sera JSON.stringify'é) pour UN abonnement précis, selon RFC 8291
// (dérivation des clés à partir du secret ECDH + du secret d'authentification propre à
// l'abonnement) combiné à RFC 8188 "aes128gcm" (format du message chiffré final). Renvoie
// un Buffer prêt à être envoyé tel quel comme corps de la requête HTTP vers l'endpoint.
// Exportée (en plus d'être utilisée en interne par sendPushNotification ci-dessous)
// uniquement pour permettre un test de bout en bout autonome qui rejoue le déchiffrement
// côté "navigateur" avec les clés privées correspondantes — la seule façon de vérifier
// programmatiquement que cette implémentation respecte vraiment la RFC, en l'absence d'un
// vrai service de push (FCM/Mozilla) accessible depuis un environnement de test.
export function encryptPayload(subscription, payloadObj) {
  const uaPublicRaw = Buffer.from(subscription.p256dh, 'base64url'); // clé publique ECDH du navigateur destinataire
  const authSecret = Buffer.from(subscription.auth, 'base64url'); // secret d'authentification propre à cet abonnement (16 octets)

  // Paire de clés ECDH ÉPHÉMÈRE, générée à neuf pour CE message précis (jamais réutilisée
  // — c'est ce qui garantit qu'intercepter un message ne compromet pas les suivants). La
  // classe legacy ECDH de Node travaille directement avec des Buffers bruts (pas de JWK à
  // manipuler comme pour les clés VAPID ci-dessus), ce qui convient parfaitement ici.
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublicRaw = ecdh.getPublicKey(); // notre clé publique éphémère (65 octets) — transmise en clair dans l'en-tête du message, voir plus bas
  const ecdhSecret = ecdh.computeSecret(uaPublicRaw); // secret partagé (32 octets)

  // Étape 1 (RFC 8291 §3.4) : combine le secret ECDH avec le secret d'authentification de
  // l'abonnement pour obtenir un IKM ("input keying material") que même quelqu'un ayant
  // intercepté l'endpoint/les clés publiques ne peut pas recalculer sans connaître `auth`.
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublicRaw, asPublicRaw]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));

  // Étape 2 (RFC 8188 §2.1) : dérive la clé de chiffrement (CEK) et le nonce à partir de
  // l'IKM ci-dessus et d'un sel ALÉATOIRE propre à ce message (jamais réutilisé non plus).
  const salt = crypto.randomBytes(16);
  const cekInfo = Buffer.from('Content-Encoding: aes128gcm\0');
  const nonceInfo = Buffer.from('Content-Encoding: nonce\0');
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, cekInfo, 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, nonceInfo, 12));

  // 0x02 en fin de texte clair = délimiteur "dernier enregistrement" du format aes128gcm
  // (RFC 8188) — on envoie toujours tout le message en UN seul enregistrement (jamais
  // besoin de fragmenter une notification courte), donc c'est toujours ce délimiteur-là et
  // jamais 0x01 ("d'autres enregistrements suivent").
  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payloadObj), 'utf-8'), Buffer.from([0x02])]);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // En-tête du format aes128gcm (RFC 8188 §2.1) : sel (16o) || taille d'enregistrement
  // (4o, big-endian — on met exactement la taille de CE message, un seul enregistrement)
  // || longueur de keyid (1o) || keyid (notre clé publique éphémère, 65o, pour que le
  // navigateur destinataire sache avec quelle clé refaire l'échange ECDH à la réception).
  const recordSizeBuf = Buffer.alloc(4);
  recordSizeBuf.writeUInt32BE(ciphertext.length, 0);
  const header = Buffer.concat([salt, recordSizeBuf, Buffer.from([asPublicRaw.length]), asPublicRaw]);

  return Buffer.concat([header, ciphertext]);
}

// Envoie une notification à UN abonnement précis. Ne lève jamais d'exception (échec
// réseau/service de push indisponible = simplement pas de notification cette fois, ça ne
// doit jamais faire échouer l'action métier qui déclenche l'envoi — voir les appels
// "fire-and-forget" dans routes/auth.js/admin.js). `expired: true` signale au code appelant
// qu'il doit supprimer cet abonnement de push_subscriptions (le navigateur ne l'a plus,
// le service de push répond alors 404/410 — c'est le mécanisme normal de "désabonnement
// silencieux" du navigateur, pas une erreur à surveiller).
export async function sendPushNotification(subscription, payloadObj) {
  const vapidKeys = getVapidKeys();
  if (!vapidKeys) return { ok: false, expired: false, error: 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY non configurées côté serveur' };

  try {
    const body = encryptPayload(subscription, payloadObj);
    const authHeader = buildVapidAuthHeader(subscription.endpoint, vapidKeys);

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': String(PUSH_MESSAGE_TTL_SECONDS),
        'Authorization': authHeader
      },
      body
    });

    if (res.status === 404 || res.status === 410) {
      return { ok: false, expired: true, error: `Abonnement expiré (HTTP ${res.status})` };
    }
    if (!res.ok) {
      return { ok: false, expired: false, error: `HTTP ${res.status} du service de push` };
    }
    return { ok: true, expired: false };
  } catch (e) {
    return { ok: false, expired: false, error: e.message };
  }
}

// Utilisé par routes/push.js pour exposer la clé publique au frontend (voir
// GET /api/push/vapid-public-key) sans avoir à dupliquer la logique de lecture/validation
// de getVapidKeys() dans le fichier de routes.
export function getVapidPublicKey() {
  const keys = getVapidKeys();
  return keys ? keys.publicKeyBase64url : null;
}
