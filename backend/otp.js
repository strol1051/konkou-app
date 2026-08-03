import crypto from 'node:crypto';
import db from './db.js';

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;

function generateCode() {
  return String(crypto.randomInt(100000, 1000000)); // 6 digits, never starts stripped-zero issue since randomInt range fixed to 6-digit span
}

// Historique (juillet 2026) : Konkou n'a pas de fournisseur SMS branché (voir sms.js), donc
// la confirmation du téléphone se faisait via un humain — d'abord un lien WhatsApp pré-rempli
// vers l'opérateur qu'un admin confirmait ensuite dans /admin.html, puis (juillet 2026) un
// tchat interne remplaçant WhatsApp après le blocage du numéro opérateur pour spam. Dans les
// deux cas, l'admin ne faisait en réalité que comparer le code à... lui-même : issueOtp()
// renvoie déjà le code directement dans la réponse API à qui fait la demande, donc rien ne
// prouvait vraiment la possession du numéro au-delà de "cette personne a reçu la réponse de
// l'API". Août 2026 : suppression de cette étape admin devenue purement formelle —
// consumeOtp() ci-dessous, jusqu'ici réservée à un usage futur, devient le mécanisme de
// confirmation principal : la personne retape elle-même le code affiché dans l'app, et le
// serveur le valide directement (voir confirmVerifyPhone()/confirmResetPassword() dans
// routes/auth.js). Si un vrai fournisseur SMS est branché un jour (voir sms.js) — auquel cas
// le code ne serait plus affiché dans l'app mais reçu par SMS séparément — ce même mécanisme
// deviendrait alors une vraie preuve de possession du numéro, sans aucun changement de code.

// Creates a fresh OTP for (phone, purpose), invalidating any earlier unused code for the same
// pair. `payload` is an optional generic string stashed alongside the code — plus utilisé par
// reset_password depuis la refonte de juillet 2026 (voir forgotPassword() dans
// routes/auth.js), conservé pour un futur usage générique. Returns { ok, error, code }.
export async function issueOtp(phone, purpose, payload = null) {
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

  return { ok: true, code };
}

// Mécanisme de confirmation principal depuis août 2026 (voir le commentaire en tête de
// fichier) — appelé directement par confirmVerifyPhone()/confirmResetPassword() dans
// routes/auth.js dès que la personne retape son code dans l'app, sans intervention admin.
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

// Utilisé par la toute dernière étape de la réinitialisation de mot de passe (voir
// completePasswordReset() dans routes/auth.js) : une fois que confirmResetPassword() a
// validé le code (consumeOtp() l'a déjà marquée used=1, voir routes/auth.js), c'est CE
// row-là qui prouve que (a) une demande a bien été faite pour ce téléphone et (b) le code a
// bien été confirmé. On exige used=1 (pas used=0) : si la ligne existe encore mais n'a pas
// été confirmée, c'est que cette étape n'a pas encore eu lieu, et il ne faut surtout pas
// laisser quelqu'un poser un nouveau mot de passe avant ça (ce serait recréer exactement le
// problème que cette refonte corrige). La ligne est supprimée après usage plutôt que "used"
// à nouveau (il n'y a pas de 3e état) — pour empêcher un double-appel de rejouer la même
// confirmation et changer le mot de passe une seconde fois avec un onglet resté ouvert.
export function consumeConfirmedOtp(phone, purpose, code) {
  const row = db.prepare(
    `SELECT id, used FROM otp_codes WHERE phone = ? AND purpose = ? AND code = ? ORDER BY id DESC LIMIT 1`
  ).get(phone, purpose, String(code || ''));
  if (!row) return { ok: false, error: 'Aucune demande en cours pour ce numéro — recommencez depuis "Mot de passe oublié"' };
  if (!row.used) return { ok: false, error: "Cette demande n'a pas encore été confirmée — entrez d'abord le code reçu" };

  db.prepare('DELETE FROM otp_codes WHERE id = ?').run(row.id);
  return { ok: true };
}
