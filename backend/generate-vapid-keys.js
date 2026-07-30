// Script à lancer UNE SEULE FOIS (localement, ou une seule fois par environnement) pour
// générer la paire de clés VAPID nécessaire aux notifications push (voir webpush.js) :
//
//     node backend/generate-vapid-keys.js
//
// Copiez les deux valeurs affichées dans les variables d'environnement Render
// (Dashboard → votre service → Environment) : VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY.
//
// IMPORTANT : ne relancez PAS ce script après la mise en production, sauf si vous acceptez
// que TOUS les abonnements déjà enregistrés (tous les navigateurs qui ont déjà activé les
// notifications) deviennent invalides — la clé publique qu'ils ont utilisée pour s'abonner
// ne correspondrait plus à la nouvelle clé privée du serveur, et le service de push
// rejetterait tous les envois (erreur "VAPID credential mismatch" ou équivalent). Générez-la
// une fois, gardez-la, exactement comme JWT_SECRET/ADMIN_PASSWORD.
import crypto from 'node:crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubJwk = publicKey.export({ format: 'jwk' });
const privJwk = privateKey.export({ format: 'jwk' });

// Même format que celui attendu par backend/webpush.js (getVapidKeys()) : la clé publique
// au format "point EC brut non compressé" (0x04 || X || Y, 65 octets) encodée en
// base64url — c'est directement ce format que PushManager.subscribe({applicationServerKey})
// attend côté navigateur, donc aucune conversion supplémentaire n'est nécessaire côté
// frontend (voir subscribeToPush() dans frontend/app.js/admin.js).
const rawPublicKey = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(pubJwk.x, 'base64url'),
  Buffer.from(pubJwk.y, 'base64url')
]);
const rawPrivateKey = Buffer.from(privJwk.d, 'base64url');

console.log('Clés VAPID générées — à coller dans les variables d\'environnement Render :\n');
console.log(`VAPID_PUBLIC_KEY=${rawPublicKey.toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${rawPrivateKey.toString('base64url')}`);
console.log('\nOptionnel — VAPID_SUBJECT (identifie votre serveur auprès des services de');
console.log('push type FCM/Mozilla ; un email de contact ou une URL https:// conviennent) :');
console.log('VAPID_SUBJECT=mailto:contact@konkouapp.com');
