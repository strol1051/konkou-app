import crypto from 'node:crypto';
import db from './db.js';

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;

function generateCode() {
  return String(crypto.randomInt(100000, 1000000)); // 6 digits, never starts stripped-zero issue since randomInt range fixed to 6-digit span
}

// Konkou has no SMS provider set up yet, so phone confirmation is done by a human: the
// app builds a pre-filled WhatsApp message (phone + code) that the user sends to the
// operator's WhatsApp number, and an admin later confirms the match in /admin.html.
// Requires OPERATOR_WHATSAPP_NUMBER (E.164 digits, no "+") to be configured — without
// it, registration/reset requests can still be created but there's no way to complete
// them, so the frontend should surface a clear error if this comes back null.
//
// OPERATOR_NUMBER_RE guards against the most common real-world misconfiguration: an
// admin deploys via render.yaml (see DEPLOY.md étape 3) and forgets to replace its
// literal placeholder value "REMPLACER_PAR_VOTRE_NUMERO" with a real number. Without this
// check, that placeholder string would sail straight through into a wa.me link
// (https://wa.me/REMPLACER_PAR_VOTRE_NUMERO?text=...) that neither WhatsApp nor the
// browser can open, leaving every new signup/reset stuck behind a confusing dead link —
// this exact scenario happened in production (July 2026) before this check was added.
// Rejecting anything that isn't plain E.164 digits makes buildWhatsappLink() return null
// the same way it already does for a genuinely empty value, which the frontend already
// renders as a clear "contactez l'administrateur" message (see renderAwaitingConfirm()
// dans app.js) instead of a broken button.
const OPERATOR_NUMBER_RE = /^\d{8,15}$/;
function buildWhatsappLink(phone, code, message) {
  const operatorNumber = process.env.OPERATOR_WHATSAPP_NUMBER;
  if (!operatorNumber || !OPERATOR_NUMBER_RE.test(operatorNumber)) return null;
  const text = `Konkou — ${message} Mon numéro : ${phone}. Mon code : ${code}`;
  return `https://wa.me/${operatorNumber}?text=${encodeURIComponent(text)}`;
}

// Sens inverse de buildWhatsappLink() ci-dessus : celui-là construit un lien qui part du
// téléphone du joueur/agent vers l'opérateur (pour la demande initiale) ; celui-ci construit
// un lien qui part du panneau admin vers le téléphone du joueur/agent (pour que l'opérateur,
// une fois une demande approuvée, puisse prévenir la personne par un simple tap — toujours
// sans API WhatsApp Business, juste un lien wa.me pré-rempli que l'admin envoie lui-même
// depuis son propre WhatsApp). Les numéros Konkou sont déjà stockés au format "509XXXXXXXX"
// (E.164 sans le +), exactement ce que wa.me attend comme destinataire — pas de reformatage
// nécessaire ici, contrairement à OPERATOR_WHATSAPP_NUMBER qui est une variable d'env séparée.
export function buildWhatsappLinkToPhone(phone, message) {
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

// Creates a fresh OTP for (phone, purpose), invalidating any earlier unused code for the same
// pair. `payload` is an optional string stashed alongside the code (used by password reset to
// hold the new hashed password until an admin confirms). Returns { ok, error, code, whatsappLink }.
export async function issueOtp(phone, purpose, message, payload = null) {
  const recent = db.prepare(
    `SELECT created_at FROM otp_codes WHERE phone = ? AND purpose = ? ORDER BY id DESC LIMIT 1`
  ).get(phone, purpose);
  if (recent) {
    const elapsedMs = Date.now() - new Date(recent.created_at.replace(' ', 'T') + 'Z').getTime();
    if (elapsedMs < RESEND_COOLDOWN_SECONDS * 1000) {
      const waitSec = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000);
      return { ok: false, error: `Veuillez patienter ${waitSec}s avant de redemander un code` };
    }
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO otp_codes (phone, code, purpose, expires_at, payload) VALUES (?, ?, ?, ?, ?)')
    .run(phone, code, purpose, expiresAt, payload);

  return { ok: true, code, whatsappLink: buildWhatsappLink(phone, code, message) };
}

// Reserved for a possible manual/typed-code fallback later; not currently wired to any
// route (see routes/auth.js — confirmation now happens via the admin panel instead,
// since the code is returned in the API response and typing it back proves nothing on
// its own). Kept here because the validate+consume logic is identical to what the
// admin-side confirmation needs.
export function consumeOtp(phone, purpose, code) {
  const row = db.prepare(
    `SELECT id, expires_at FROM otp_codes WHERE phone = ? AND purpose = ? AND code = ? AND used = 0 ORDER BY id DESC LIMIT 1`
  ).get(phone, purpose, String(code || ''));

  if (!row) return { ok: false, error: 'Code invalide' };

  const expired = Date.now() > new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime();
  if (expired) return { ok: false, error: 'Ce code a expiré, redemandez-en un nouveau' };

  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);
  return { ok: true };
}

// Called from the admin panel once the operator has actually received and cross-checked
// the WhatsApp message. `code` is what the operator typed in (copied from the WhatsApp
// message they received) — it MUST match the pending row's code, not just the phone
// number. This is the real proof of phone ownership in this design (the operator
// compares the code shown in their own WhatsApp app against this before typing it), so
// requiring it here — rather than trusting a bare "confirm" click on the phone number
// alone — is what actually forces that cross-check instead of making it optional.
// Marks the OTP used and returns the row (including any stashed payload) so the caller
// can apply the side effect.
export function adminConfirmOtp(phone, purpose, code) {
  const row = db.prepare(
    `SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1`
  ).get(phone, purpose);
  if (!row) return { ok: false, error: 'Aucune demande en attente pour ce numéro' };

  const expired = Date.now() > new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime();
  if (expired) return { ok: false, error: "Cette demande a expiré côté utilisateur — il doit relancer une demande" };

  if (String(code || '').trim() !== row.code) {
    return { ok: false, error: 'Code incorrect — comparez avec le message WhatsApp reçu avant de confirmer' };
  }

  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);
  return { ok: true, row };
}

// Called from the admin panel when the operator does NOT receive/recognize the expected
// WhatsApp message (wrong code, no message at all, suspected fraud, etc.). Deletes the
// pending row outright rather than marking it "used" — checkOtpStatus then finds no row
// and reports 'invalid', which the frontend already renders as "Cette demande n'est plus
// valide" with a "Relancer une demande" button, so no new frontend state is needed. The
// user's account (if this was a registration) stays unverified, exactly as if they had
// never confirmed — they can freely retry via the existing "abandoned signup" reuse path
// in routes/auth.js.
export function rejectOtp(phone, purpose) {
  const row = db.prepare(
    `SELECT id FROM otp_codes WHERE phone = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1`
  ).get(phone, purpose);
  if (!row) return { ok: false, error: 'Aucune demande en attente pour ce numéro' };

  db.prepare('DELETE FROM otp_codes WHERE id = ?').run(row.id);
  return { ok: true };
}

// Utilisé par la toute dernière étape de la réinitialisation de mot de passe (voir
// completePasswordReset() dans routes/auth.js) : une fois qu'un admin a approuvé la
// demande (adminConfirmOtp l'a déjà marquée used=1), c'est CE row-là qui prouve que
// (a) une demande a bien été faite pour ce téléphone et (b) un admin l'a authentifiée —
// exactement le même niveau de preuve que pour /auth/verify-status. On exige used=1 (pas
// used=0) : si la ligne existe encore mais n'a pas été confirmée par un admin, c'est que
// l'approbation n'a pas encore eu lieu, et il ne faut surtout pas laisser quelqu'un poser
// un nouveau mot de passe avant cette étape (ce serait recréer exactement le problème que
// cette refonte corrige). La ligne est supprimée après usage — comme rejectOtp(), plutôt
// que "used" à nouveau (il n'y a pas de 3e état) — pour empêcher un double-appel de rejouer
// la même confirmation et changer le mot de passe une seconde fois avec un lien/onglet resté
// ouvert.
export function consumeConfirmedOtp(phone, purpose, code) {
  const row = db.prepare(
    `SELECT id, used FROM otp_codes WHERE phone = ? AND purpose = ? AND code = ? ORDER BY id DESC LIMIT 1`
  ).get(phone, purpose, String(code || ''));
  if (!row) return { ok: false, error: 'Aucune demande en cours pour ce numéro — recommencez depuis "Mot de passe oublié"' };
  if (!row.used) return { ok: false, error: "Cette demande n'a pas encore été approuvée par un administrateur — patientez ou relancez une demande" };

  db.prepare('DELETE FROM otp_codes WHERE id = ?').run(row.id);
  return { ok: true };
}

// Lets the frontend poll silently — no code to type — for whether the operator has
// confirmed yet. The `code` the frontend already holds (received in the original
// register/forgot-password response) is the secret that ties this poll to the session
// that made the original request.
export function checkOtpStatus(phone, purpose, code) {
  const row = db.prepare(
    `SELECT used, expires_at FROM otp_codes WHERE phone = ? AND purpose = ? AND code = ? ORDER BY id DESC LIMIT 1`
  ).get(phone, purpose, String(code || ''));
  if (!row) return 'invalid';
  if (row.used) return 'confirmed';
  const expired = Date.now() > new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime();
  return expired ? 'expired' : 'pending';
}

// For the admin panel's "Vérifications" tab: every still-open request for a given
// purpose, including the code itself so the operator can cross-check it against the
// WhatsApp message they received.
export function listPendingOtps(purpose) {
  return db.prepare(
    `SELECT id, phone, code, created_at, expires_at FROM otp_codes
     WHERE purpose = ? AND used = 0 AND expires_at > datetime('now')
     ORDER BY created_at ASC`
  ).all(purpose);
}
