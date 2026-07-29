import crypto from 'node:crypto';
import db from '../db.js';
import { hashPassword, verifyPassword, signToken, PASSWORD_RE, PASSWORD_REQUIREMENTS_MESSAGE, calcAge } from '../utils.js';
import { issueOtp, checkOtpStatus } from '../otp.js';

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

  const otp = await issueOtp(phone, 'verify_phone', 'Confirmez la création de mon compte Konkou.');
  if (!otp.ok) {
    return { status: 429, data: { error: otp.error } };
  }

  // No auth token yet — the account exists but isn't usable until an admin confirms the
  // WhatsApp message. `code` is not meant to be typed by the user; the frontend keeps it
  // to poll /auth/verify-status once the confirmation happens.
  return {
    status: 200,
    data: {
      pendingVerification: true,
      phone,
      purpose: 'verify_phone',
      code: otp.code,
      whatsappLink: otp.whatsappLink,
      message: whatsappMessage(otp.whatsappLink, 'Compte créé. Confirmez via WhatsApp pour l’activer.', 'Compte créé')
    }
  };
}

function whatsappMessage(whatsappLink, successText, missingConfigText) {
  return whatsappLink
    ? successText
    : `${missingConfigText} — aucun numéro WhatsApp n'est configuré côté serveur (OPERATOR_WHATSAPP_NUMBER), contactez l'administrateur.`;
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

  // A pending password reset carries the user's chosen new (hashed) password as payload —
  // preserve it across a resend, otherwise re-issuing without it would lose that password.
  let payload = null;
  if (purpose === 'reset_password') {
    const prev = db.prepare(
      `SELECT payload FROM otp_codes WHERE phone = ? AND purpose = 'reset_password' ORDER BY id DESC LIMIT 1`
    ).get(phone);
    payload = prev?.payload || null;
    if (!payload) return { status: 400, data: { error: 'Aucune demande de réinitialisation en cours — recommencez depuis "Mot de passe oublié"' } };
  }

  const message = purpose === 'verify_phone'
    ? 'Confirmez la création de mon compte Konkou.'
    : 'Confirmez la réinitialisation de mon mot de passe Konkou.';
  const otp = await issueOtp(phone, purpose, message, payload);
  if (!otp.ok) return { status: 429, data: { error: otp.error } };

  return { status: 200, data: { message: 'Nouvelle demande envoyée.', code: otp.code, whatsappLink: otp.whatsappLink } };
}

export async function forgotPassword(body) {
  const { phone, newPassword } = body || {};
  if (!phone || !newPassword) {
    return { status: 400, data: { error: 'Numéro de téléphone et nouveau mot de passe requis' } };
  }
  if (!PASSWORD_RE.test(newPassword)) {
    return { status: 400, data: { error: PASSWORD_REQUIREMENTS_MESSAGE } };
  }

  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (!user) {
    // No account to confirm later, but respond in roughly the same shape so a missing
    // number doesn't obviously stand out from a real one.
    return { status: 200, data: { message: 'Si ce numéro est enregistré, une demande de réinitialisation a été créée.' } };
  }

  const payload = JSON.stringify({ passwordHash: hashPassword(newPassword) });
  const otp = await issueOtp(phone, 'reset_password', 'Confirmez la réinitialisation de mon mot de passe Konkou.', payload);
  if (!otp.ok) return { status: 429, data: { error: otp.error } };

  return {
    status: 200,
    data: {
      message: whatsappMessage(otp.whatsappLink, 'Confirmez via WhatsApp pour finaliser la réinitialisation.', 'Demande enregistrée'),
      phone,
      purpose: 'reset_password',
      code: otp.code,
      whatsappLink: otp.whatsappLink
    }
  };
}

// Polled by the frontend (no auth — the `code` param is the secret) while it waits for
// an admin to confirm the WhatsApp message. Mints a session token once confirmed.
export function checkVerificationStatus(query) {
  const { phone, purpose, code } = query || {};
  if (!phone || !purpose || !code) return { status: 400, data: { error: 'Requête invalide' } };

  const st = checkOtpStatus(phone, purpose, code);
  if (st === 'invalid') return { status: 200, data: { status: 'invalid' } };
  if (st === 'expired') return { status: 200, data: { status: 'expired' } };
  if (st === 'pending') return { status: 200, data: { status: 'pending' } };

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) return { status: 200, data: { status: 'invalid' } };

  const token = signToken({ userId: user.id }, process.env.JWT_SECRET);
  return { status: 200, data: { status: 'confirmed', token, user: publicUser(user) } };
}
