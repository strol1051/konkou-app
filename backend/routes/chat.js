import crypto from 'node:crypto';
import db from '../db.js';
import { otpRequestExists } from '../otp.js';
import { notifyAdmins, notifyUser } from './push.js';

// Tchat interne Admin <-> joueur/agent (juillet 2026) — voir le commentaire sur la table
// chat_messages dans db.js pour le contexte complet (remplace la confirmation par
// WhatsApp après le blocage du numéro opérateur). Trois "purpose" possibles :
// - 'verify_phone'   : remplace l'envoi du code par WhatsApp à l'inscription.
// - 'reset_password' : remplace l'envoi du code par WhatsApp à la réinitialisation.
// - 'support'        : ex-formulaire "Nous contacter" + support en continu pour un
//                       joueur/agent déjà connecté (voir sendAuthedMessage/getAuthedMessages).
// La logique de confirmation elle-même (adminConfirmOtp, phone_verified, etc. — voir
// routes/admin.js) n'est PAS touchée par ce fichier : le tchat ne fait que remplacer le
// CANAL par lequel la personne communique son code à l'admin, pas la vérification.

const PURPOSES = ['verify_phone', 'reset_password', 'support'];
const MESSAGE_MAX_LEN = 1000;
const DISPLAY_NAME_MAX_LEN = 80;

function notifyAdminsSilently(payloadObj) {
  notifyAdmins(payloadObj).catch(() => {});
}

// Best-effort, jamais bloquant (voir la même logique déjà en place pour les notifications
// de transaction dans routes/admin.js) : un joueur/agent qui n'a jamais activé les
// notifications sur cet appareil ne reçoit simplement rien ici, sans que ça n'affecte la
// réponse HTTP de la route appelante.
function notifyUserSilently(userId, payloadObj) {
  notifyUser(userId, payloadObj).catch(() => {});
}

// Preuve d'accès à une conversation AVANT toute connexion (pas de jeton de session) :
// - verify_phone/reset_password : le secret est le code OTP déjà connu du frontend depuis
//   la réponse initiale de /auth/register ou /auth/forgot-password (voir otpRequestExists
//   dans otp.js — même triplet déjà utilisé ailleurs comme "jeton" dans ce projet).
// - support : le secret est un jeton aléatoire propre à la conversation, généré au tout
//   premier message (voir sendAnonymousMessage ci-dessous) — il faut donc qu'AU MOINS un
//   message existe déjà avec ce (phone, secret) pour que l'accès soit valide.
// Ne vérifie jamais la propriété du numéro au-delà de ça — exactement le même niveau de
// preuve que le reste de ce projet pour les flux anonymes (voir /auth/verify-status).
function checkAnonymousAccess(phone, purpose, secret) {
  if (!phone || !PURPOSES.includes(purpose)) return { ok: false, error: 'Requête invalide' };
  if (purpose === 'support') {
    if (!secret) return { ok: false, error: 'Jeton de conversation requis' };
    const exists = db.prepare(
      `SELECT 1 FROM chat_messages WHERE phone = ? AND purpose = 'support' AND secret = ? LIMIT 1`
    ).get(phone, secret);
    return exists ? { ok: true } : { ok: false, error: 'Conversation introuvable — rechargez la page pour recommencer.' };
  }
  if (!secret || !otpRequestExists(phone, purpose, secret)) {
    return { ok: false, error: 'Requête invalide ou expirée — relancez une demande.' };
  }
  return { ok: true };
}

function validateMessageBody(text) {
  const body = String(text || '').trim();
  if (!body) return { error: 'Message requis' };
  if (body.length > MESSAGE_MAX_LEN) return { error: `Le message ne peut pas dépasser ${MESSAGE_MAX_LEN} caractères` };
  return { body };
}

// ---------- Anonyme (avant connexion) ----------

// Envoie un message pour une conversation anonyme. Pour verify_phone/reset_password, le
// secret DOIT déjà exister (voir checkAnonymousAccess) — ces conversations ne peuvent
// démarrer que depuis une vraie demande d'inscription/réinitialisation (otp.js). Pour
// 'support', un secret absent démarre une TOUTE NOUVELLE conversation (jeton généré ici,
// renvoyé au frontend pour les messages/lectures suivants) — c'est la seule façon de créer
// un nouveau fil, on ne peut jamais "choisir" son propre secret depuis le client.
export function sendAnonymousMessage(body) {
  const { phone: rawPhone, purpose, secret, body: text, displayName } = body || {};
  const phone = String(rawPhone || '').trim();
  if (!phone) return { status: 400, data: { error: 'Numéro requis' } };
  if (!PURPOSES.includes(purpose)) return { status: 400, data: { error: 'Requête invalide' } };

  const { body: messageBody, error: bodyError } = validateMessageBody(text);
  if (bodyError) return { status: 400, data: { error: bodyError } };

  let effectiveSecret;
  if (purpose === 'support') {
    if (secret) {
      const check = checkAnonymousAccess(phone, purpose, secret);
      if (!check.ok) return { status: 400, data: { error: check.error } };
      effectiveSecret = secret;
    } else {
      effectiveSecret = crypto.randomBytes(8).toString('hex');
    }
  } else {
    const check = checkAnonymousAccess(phone, purpose, secret);
    if (!check.ok) return { status: 400, data: { error: check.error } };
    effectiveSecret = secret;
  }

  const name = displayName ? String(displayName).trim().slice(0, DISPLAY_NAME_MAX_LEN) : null;
  db.prepare(
    `INSERT INTO chat_messages (purpose, phone, secret, display_name, sender, body) VALUES (?, ?, ?, ?, 'user', ?)`
  ).run(purpose, phone, effectiveSecret, name, messageBody);

  notifyAdminsSilently({
    title: 'Konkou — Nouveau message',
    body: `${name || phone} : ${messageBody.slice(0, 80)}`,
    url: '/admin.html'
  });

  return { status: 200, data: { message: 'Message envoyé.', secret: effectiveSecret } };
}

// Sondé par le frontend toutes les quelques secondes tant que l'écran de tchat concerné
// est ouvert (voir startChatPolling() dans app.js). Portée volontairement par (phone,
// purpose) SANS filtrer par secret — un secret valide prouve juste le DROIT de lire, mais
// une fois ce droit établi, toute la conversation (y compris les messages envoyés sous un
// éventuel ancien code, ex: après un "relancer une demande") reste visible d'un bout à
// l'autre, plutôt que de fragmenter l'historique à chaque nouveau code.
export function getAnonymousMessages(query) {
  const { phone, purpose, secret } = query || {};
  const check = checkAnonymousAccess(phone, purpose, secret);
  if (!check.ok) return { status: 400, data: { error: check.error } };

  const rows = db.prepare(
    `SELECT id, sender, body, created_at FROM chat_messages WHERE phone = ? AND purpose = ? ORDER BY id ASC`
  ).all(phone, purpose);
  db.prepare(
    `UPDATE chat_messages SET read_by_user = 1 WHERE phone = ? AND purpose = ? AND sender = 'admin' AND read_by_user = 0`
  ).run(phone, purpose);

  return { status: 200, data: { messages: rows } };
}

// ---------- Authentifié (joueur/agent déjà connecté) ----------
// Toujours purpose='support' — un compte déjà connecté n'a jamais besoin du canal
// verify_phone/reset_password (ces deux-là n'existent justement QUE tant qu'on n'est pas
// encore connecté). Identifié par userId (jeton de session, voir server.js), jamais par un
// secret séparé à transporter côté client.

export function sendAuthedMessage(userId, body) {
  const user = db.prepare('SELECT phone, name FROM users WHERE id = ?').get(userId);
  if (!user) return { status: 404, data: { error: 'Compte introuvable' } };

  const { body: messageBody, error: bodyError } = validateMessageBody(body?.body);
  if (bodyError) return { status: 400, data: { error: bodyError } };

  db.prepare(
    `INSERT INTO chat_messages (purpose, phone, display_name, sender, body) VALUES ('support', ?, ?, 'user', ?)`
  ).run(user.phone, user.name, messageBody);

  notifyAdminsSilently({
    title: 'Konkou — Nouveau message',
    body: `${user.name} : ${messageBody.slice(0, 80)}`,
    url: '/admin.html'
  });

  return { status: 200, data: { message: 'Message envoyé.' } };
}

export function getAuthedMessages(userId) {
  const user = db.prepare('SELECT phone FROM users WHERE id = ?').get(userId);
  if (!user) return { status: 404, data: { error: 'Compte introuvable' } };

  const rows = db.prepare(
    `SELECT id, sender, body, created_at FROM chat_messages WHERE phone = ? AND purpose = 'support' ORDER BY id ASC`
  ).all(user.phone);
  db.prepare(
    `UPDATE chat_messages SET read_by_user = 1 WHERE phone = ? AND purpose = 'support' AND sender = 'admin' AND read_by_user = 0`
  ).run(user.phone);

  return { status: 200, data: { messages: rows } };
}

// ---------- Admin ----------

// Liste groupée par (phone, purpose) — une "conversation" au sens de l'admin, quel que
// soit le nombre de messages échangés. Utilisée par l'onglet "Messages" (purpose='support'
// uniquement) ; les conversations verify_phone/reset_password restent affichées directement
// dans l'onglet "Vérifications" existant (voir loadVerificationChats() dans admin.js), pas
// ici, pour ne pas dupliquer deux vues sur les mêmes données.
export function listChatThreads(purposeFilter) {
  const purpose = PURPOSES.includes(purposeFilter) ? purposeFilter : 'support';
  const rows = db.prepare(`
    SELECT phone, purpose,
      MAX(CASE WHEN display_name IS NOT NULL THEN display_name END) as display_name,
      MAX(created_at) as last_message_at,
      SUM(CASE WHEN sender = 'user' AND read_by_admin = 0 THEN 1 ELSE 0 END) as unread_count,
      COUNT(*) as message_count
    FROM chat_messages
    WHERE purpose = ?
    GROUP BY phone
    ORDER BY last_message_at DESC
  `).all(purpose);
  return { status: 200, data: { threads: rows } };
}

// Admin — aucune vérification de secret (déjà authentifié comme admin, voir requireAdmin
// dans server.js) : accès direct par (phone, purpose), comme listChatThreads ci-dessus.
export function getChatThreadMessages(query) {
  const { phone, purpose } = query || {};
  if (!phone || !PURPOSES.includes(purpose)) return { status: 400, data: { error: 'Requête invalide' } };

  const rows = db.prepare(
    `SELECT id, sender, body, created_at, display_name FROM chat_messages WHERE phone = ? AND purpose = ? ORDER BY id ASC`
  ).all(phone, purpose);
  db.prepare(
    `UPDATE chat_messages SET read_by_admin = 1 WHERE phone = ? AND purpose = ? AND sender = 'user' AND read_by_admin = 0`
  ).run(phone, purpose);

  return { status: 200, data: { messages: rows } };
}

export function adminReply(body) {
  const { phone, purpose, body: text } = body || {};
  if (!phone || !PURPOSES.includes(purpose)) return { status: 400, data: { error: 'Requête invalide' } };

  const { body: messageBody, error: bodyError } = validateMessageBody(text);
  if (bodyError) return { status: 400, data: { error: bodyError } };

  db.prepare(
    `INSERT INTO chat_messages (purpose, phone, sender, body, read_by_admin) VALUES (?, ?, 'admin', ?, 1)`
  ).run(purpose, phone, messageBody);

  // Best-effort : si cette personne a déjà un compte (verify_phone crée toujours la ligne
  // users dès l'inscription, même non vérifiée — voir register() dans routes/auth.js) ET a
  // déjà activé les notifications sur un appareil, elle reçoit un vrai "ping" système en
  // plus du tchat lui-même. Silencieusement ignoré si aucun compte ne correspond (ex: un
  // message "support" envoyé depuis le formulaire "Nous contacter" par quelqu'un sans compte).
  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (user) {
    notifyUserSilently(user.id, {
      title: 'Konkou — Nouveau message',
      body: messageBody.slice(0, 120),
      url: '/'
    });
  }

  return { status: 200, data: { message: 'Réponse envoyée.' } };
}
