import crypto from 'node:crypto';
import db from '../db.js';
import { hashPassword, verifyPassword, signToken, PASSWORD_RE, PASSWORD_REQUIREMENTS_MESSAGE, calcAge } from '../utils.js';
import { issueOtp, consumeOtp, consumeConfirmedOtp } from '../otp.js';
import { notifyAdmins } from './push.js';

// Envoie une notification push à tous les admins abonnés, sans jamais faire échouer ni
// ralentir la réponse HTTP de la route appelante — voir notifyAdmins() dans routes/push.js
// pour le détail (best-effort : réseau indisponible, VAPID non configuré, ou aucun admin
// abonné sont tous des cas silencieusement ignorés ici, jamais une erreur remontée au
// joueur/agent qui vient de s'inscrire ou de demander une réinitialisation).
function notifyAdminsSilently(payloadObj) {
  notifyAdmins(payloadObj).catch(() => {});
}

function makeReferralCode(name) {
  const base = (name || 'user').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'USER';
  return base + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function publicUser(user) {
  return {
    id: user.id, phone: user.phone, name: user.name, points: user.points,
    referralCode: user.referral_code, bonusPlays: user.bonus_plays
  };
}

// Format attendu pour tout NOUVEAU numéro : "509" (indicatif Haïti, fixe — voir
// phoneField() dans frontend/app.js) suivi d'exactement 8 chiffres locaux, qui servent
// de numéro d'identifiant. N'est appliqué qu'à l'inscription (register/registerAgent) —
// pas à login, pour ne jamais bloquer un compte déjà créé avant ce format.
const PHONE_RE = /^509\d{8}$/;

export async function register(body) {
  const { phone, name, password, referralCode, birthDate } = body || {};
  if (!phone || !name || !password || !birthDate) {
    return { status: 400, data: { error: 'Téléphone, nom, date de naissance et mot de passe requis' } };
  }
  if (!PHONE_RE.test(phone)) {
    return { status: 400, data: { error: 'Numéro de téléphone invalide (8 chiffres attendus après le +509)' } };
  }
  if (!PASSWORD_RE.test(password)) {
    return { status: 400, data: { error: PASSWORD_REQUIREMENTS_MESSAGE } };
  }
  // Âge minimum de 18 ans (juillet 2026), même exigence et même calcul que l'inscription
  // agent (voir calcAge() dans utils.js) — évalué par rapport à la date d'inscription (donc
  // "maintenant"), pas figé une fois pour toutes : un joueur ne peut pas s'inscrire la
  // veille de ses 18 ans en espérant que ça reste valide, il doit avoir 18 ans révolus le
  // jour même de la demande.
  const age = calcAge(birthDate);
  if (age === null) return { status: 400, data: { error: 'Date de naissance invalide' } };
  if (age < 18) return { status: 400, data: { error: 'Vous devez avoir au moins 18 ans pour vous inscrire' } };

  const existing = db.prepare('SELECT id, phone_verified FROM users WHERE phone = ?').get(phone);
  if (existing && existing.phone_verified) {
    return { status: 409, data: { error: 'Ce numéro est déjà enregistré' } };
  }

  let referredBy = null;
  if (referralCode) {
    const referrer = db.prepare('SELECT id, referral_code FROM users WHERE referral_code = ?').get(referralCode.toUpperCase());
    if (referrer) referredBy = referrer.referral_code;
  }

  const hash = hashPassword(password);
  // Le bonus de bienvenue ne s'applique qu'à un numéro qui n'a JAMAIS eu de compte
  // auparavant — voir deleted_phones dans db.js et performDelete dans routes/account.js,
  // qui y consigne chaque numéro au moment où son compte est supprimé. Sans ce contrôle,
  // le cycle "s'inscrire → toucher 100 pts → supprimer le compte → réinscrire le même
  // numéro" fabriquerait des points à l'infini sur un seul numéro de téléphone.
  const alreadyUsedPhone = !!db.prepare('SELECT 1 FROM deleted_phones WHERE phone = ? LIMIT 1').get(phone);
  const signupBonus = alreadyUsedPhone ? 0 : 100;
  let userId;

  if (existing) {
    // A previous registration on this phone was never verified (typo, WhatsApp message
    // never sent, user gave up, etc.) — instead of permanently squatting the number, let
    // this new attempt take it over: update the name/password and re-send a fresh code.
    userId = existing.id;
    db.prepare('UPDATE users SET name = ?, password_hash = ?, referred_by = ?, birth_date = ? WHERE id = ?')
      .run(name, hash, referredBy, birthDate, userId);
  } else {
    let myCode = makeReferralCode(name);
    while (db.prepare('SELECT id FROM users WHERE referral_code = ?').get(myCode)) {
      myCode = makeReferralCode(name);
    }
    let info;
    try {
      info = db.prepare(
        'INSERT INTO users (phone, name, password_hash, points, referral_code, referred_by, phone_verified, birth_date) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
      ).run(phone, name, hash, signupBonus, myCode, referredBy, birthDate);
    } catch (e) {
      // Handles the rare race where two requests with the same phone number pass the
      // existence check above at nearly the same time; the UNIQUE constraint catches it here instead.
      return { status: 409, data: { error: 'Ce numéro est déjà enregistré' } };
    }
    userId = info.lastInsertRowid;
    if (signupBonus > 0) {
      db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
        .run(userId, 'bonus_signup', signupBonus, 'Bonus de bienvenue');
    }

    if (referredBy) {
      const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referredBy);
      if (referrer) {
        const bonus = 50;
        db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(bonus, referrer.id);
        db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
          .run(referrer.id, 'earn_referral', bonus, `Parrainage de ${name}`);
      }
    }
  }

  const otp = await issueOtp(phone, 'verify_phone');
  if (!otp.ok) {
    return { status: 429, data: { error: otp.error } };
  }

  notifyAdminsSilently({ title: 'Konkou — Nouvelle inscription', body: `${name} (${phone}) vient de s'inscrire.`, url: '/admin.html' });

  // No auth token yet — the account exists but isn't usable until the code is confirmed.
  // Depuis août 2026 (voir le commentaire en tête de otp.js), cette confirmation se fait
  // directement dans l'app — pas d'intervention admin — via confirmVerifyPhone() ci-dessous,
  // appelée dès que la personne retape le code affiché à l'écran.
  return {
    status: 200,
    data: {
      pendingVerification: true,
      phone,
      purpose: 'verify_phone',
      code: otp.code,
      message: 'Compte créé — entrez le code ci-dessous pour l’activer.'
    }
  };
}

export function login(body) {
  const { phone, password } = body || {};
  if (!phone || !password) return { status: 400, data: { error: 'Téléphone et mot de passe requis' } };

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return { status: 401, data: { error: 'Numéro ou mot de passe incorrect' } };
  }

  if (!user.phone_verified) {
    return {
      status: 403,
      data: { error: 'Numéro non vérifié', code: 'PHONE_NOT_VERIFIED', phone: user.phone }
    };
  }

  const token = signToken({ userId: user.id }, process.env.JWT_SECRET);
  return { status: 200, data: { token, user: publicUser(user) } };
}

export async function resendOtp(body) {
  const { phone, purpose } = body || {};
  if (!phone || !['verify_phone', 'reset_password'].includes(purpose)) {
    return { status: 400, data: { error: 'Requête invalide' } };
  }
  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (!user) return { status: 404, data: { error: 'Compte introuvable' } };

  // Depuis la refonte de juillet 2026, une demande de réinitialisation ne transporte plus
  // de mot de passe (voir forgotPassword ci-dessous) — il n'y a donc plus de payload à
  // préserver d'une demande à l'autre, contrairement à l'ancien comportement. Un simple
  // nouvel OTP "vide" suffit dans les deux cas (inscription comme réinitialisation).
  const otp = await issueOtp(phone, purpose);
  if (!otp.ok) return { status: 429, data: { error: otp.error } };

  return { status: 200, data: { message: 'Nouveau code envoyé.', code: otp.code } };
}

// Depuis la refonte de juillet 2026, la réinitialisation de mot de passe suit exactement
// le même principe que l'inscription (voir register() ci-dessus) : une demande ne fait que
// DEMANDER une réinitialisation — elle ne contient plus le nouveau mot de passe. Celui-ci
// n'est saisi que plus tard, une fois le code confirmé (voir confirmResetPassword()
// ci-dessous, depuis août 2026 fait automatiquement par le serveur dès que la personne
// retape son code — plus d'intervention admin, voir le commentaire en tête de otp.js) et
// que le joueur/agent revient dans l'app pour choisir son nouveau mot de passe (voir
// completePasswordReset() ci-dessous). Avant la refonte de juillet 2026, le mot de passe
// était choisi et haché DÈS cette étape-ci, ce qui obligeait à faire confiance à un mot de
// passe déjà posé par n'importe qui prétendant être le titulaire du numéro — la séquence
// (demande → confirmation du code → saisie du mot de passe) ferme cette fenêtre en
// confirmant le code AVANT de laisser qui que ce soit poser un nouveau mot de passe.
export async function forgotPassword(body) {
  const { phone } = body || {};
  if (!phone) {
    return { status: 400, data: { error: 'Numéro de téléphone requis' } };
  }

  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (!user) {
    // No account to confirm later, but respond in roughly the same shape so a missing
    // number doesn't obviously stand out from a real one.
    return { status: 200, data: { message: 'Si ce numéro est enregistré, une demande de réinitialisation a été créée.' } };
  }

  const otp = await issueOtp(phone, 'reset_password');
  if (!otp.ok) return { status: 429, data: { error: otp.error } };

  return {
    status: 200,
    data: {
      message: 'Demande enregistrée — entrez le code ci-dessous pour continuer.',
      phone,
      purpose: 'reset_password',
      code: otp.code
    }
  };
}

// Depuis août 2026, la confirmation se fait directement dans l'app, sans intervention admin
// (voir le commentaire en tête de otp.js) : la personne retape le code affiché à l'écran, et
// cette fonction le valide directement via consumeOtp(). Pour une inscription (verify_phone),
// la confirmation active directement le compte et connecte l'utilisateur. Pour une
// réinitialisation (reset_password), la confirmation ne fait qu'AUTORISER la demande — il
// n'y a pas encore de nouveau mot de passe à ce stade, donc pas de session à ouvrir tout de
// suite (voir completePasswordReset ci-dessous, appelé une fois que le joueur/agent a
// effectivement choisi son nouveau mot de passe).
export function confirmVerifyPhone(body) {
  const { phone, code } = body || {};
  if (!phone || !code) return { status: 400, data: { error: 'Numéro et code requis' } };

  const result = consumeOtp(phone, 'verify_phone', code);
  if (!result.ok) return { status: 400, data: { error: result.error } };

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) return { status: 404, data: { error: 'Compte introuvable' } };

  db.prepare('UPDATE users SET phone_verified = 1 WHERE id = ?').run(user.id);

  const token = signToken({ userId: user.id }, process.env.JWT_SECRET);
  return { status: 200, data: { token, user: publicUser(user) } };
}

export function confirmResetPassword(body) {
  const { phone, code } = body || {};
  if (!phone || !code) return { status: 400, data: { error: 'Numéro et code requis' } };

  const result = consumeOtp(phone, 'reset_password', code);
  if (!result.ok) return { status: 400, data: { error: result.error } };

  return { status: 200, data: { message: 'Code confirmé — choisissez votre nouveau mot de passe.' } };
}

// Dernière étape de la réinitialisation : appelée UNIQUEMENT après que confirmResetPassword()
// ci-dessus a confirmé le code. Le triplet (phone, purpose, code) déjà détenu par le
// frontend depuis la demande initiale sert de preuve, donc pas besoin d'un jeton
// d'authentification séparé ici (l'utilisateur n'est justement pas encore connecté).
// consumeConfirmedOtp() refuse tout appel tant que le code n'a pas été confirmé, et supprime
// la ligne après usage pour empêcher un rejeu (voir otp.js pour le détail des deux garanties).
export async function completePasswordReset(body) {
  const { phone, code, newPassword } = body || {};
  if (!phone || !code || !newPassword) {
    return { status: 400, data: { error: 'Numéro, code et nouveau mot de passe requis' } };
  }
  if (!PASSWORD_RE.test(newPassword)) {
    return { status: 400, data: { error: PASSWORD_REQUIREMENTS_MESSAGE } };
  }

  const result = consumeConfirmedOtp(phone, 'reset_password', code);
  if (!result.ok) return { status: 400, data: { error: result.error } };

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) return { status: 404, data: { error: 'Compte introuvable' } };

  const hash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

  // Connecte directement l'utilisateur avec son nouveau mot de passe, comme le fait déjà
  // confirmVerifyPhone() pour une inscription confirmée — évite un aller-retour inutile vers
  // l'écran de connexion juste après avoir choisi le mot de passe.
  const token = signToken({ userId: user.id }, process.env.JWT_SECRET);
  return { status: 200, data: { message: 'Mot de passe réinitialisé.', token, user: publicUser(user) } };
}
