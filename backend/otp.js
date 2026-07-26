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
function buildWhatsappLink(phone, code, message) {
  const operatorNumber = process.env.OPERATOR_WHATSAPP_NUMBER;
  if (!operatorNumber) return null;
  const text = `Konkou — ${message} Mon numéro : ${phone}. Mon code : ${code}`;
  return `https://wa.me/${operatorNumber}?text=${encodeURIComponent(text)}`;
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
// the WhatsApp message. This IS the real proof of phone ownership in this design (the
// operator sees the sender's number in their own WhatsApp app) — marks the OTP used and
// returns the row (including any stashed payload) so the caller can apply the side effect.
export function adminConfirmOtp(phone, purpose) {
  const row = db.prepare(
    `SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1`
  ).get(phone, purpose);
  if (!row) return { ok: false, error: 'Aucune demande en attente pour ce numéro' };

  const expired = Date.now() > new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime();
  if (expired) return { ok: false, error: "Cette demande a expiré côté utilisateur — il doit relancer une demande" };

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
