import db from '../db.js';
import { verifyPassword } from '../utils.js';

// Shared safety check for both self-service and admin-triggered deletion. Points are
// NOT a blocking condition (see performDelete) — a non-zero balance is simply forfeited
// on deletion, by design, so it never traps a user who wants to leave. What DOES still
// block: anything that would silently orphan money the platform or another player is
// still owed (a pending cashout/deposit references this user_id and would become
// unpayable/untraceable once the row is gone), or an active agent role (real credit and
// commissions in play, not just points). Returns a human-readable blocking reason, or
// null if it's safe to delete.
function blockingReason(user) {
  const pendingCashout = db.prepare(`SELECT id FROM cashouts WHERE user_id = ? AND status = 'pending'`).get(user.id);
  if (pendingCashout) return 'Un retrait est en attente sur ce compte — attendez qu\'il soit payé ou rejeté avant de supprimer.';

  const pendingDeposit = db.prepare(`SELECT id FROM deposits WHERE user_id = ? AND status = 'pending'`).get(user.id);
  if (pendingDeposit) return 'Un dépôt est en attente sur ce compte — attendez qu\'il soit confirmé ou rejeté avant de supprimer.';

  const activeAgent = db.prepare(`SELECT id FROM agents WHERE user_id = ? AND status = 'active'`).get(user.id);
  if (activeAgent) {
    return "Ce compte est un agent actif (crédit et commissions en cours) — le rôle agent doit d'abord être clôturé avant de supprimer le compte.";
  }
  return null;
}

// Any agent row still attached to the user at this point is necessarily pending or
// rejected (an 'active' one would have blocked deletion above), meaning it never held
// real credit/commission — safe to remove alongside the user account. Points are not
// explicitly zeroed first: deleting the users row eliminates them along with everything
// else on the account, they are not refunded or transferred anywhere. The phone number
// itself is freed immediately (UNIQUE constraint on users.phone) and can register a
// brand new account right away, starting from zero.
function performDelete(userId) {
  db.prepare('DELETE FROM agents WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// Self-service deletion — requires re-entering the password as a confirmation step for
// this irreversible action, same as most apps do for account deletion. The frontend is
// expected to warn the user beforehand that any remaining points will be lost (see
// app.js) ; this is the actual point of no return once that password is accepted.
export function deleteMyAccount(userId, body) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { status: 404, data: { error: 'Compte introuvable' } };

  const { password } = body || {};
  if (!password || !verifyPassword(password, user.password_hash)) {
    return { status: 401, data: { error: 'Mot de passe incorrect' } };
  }

  const reason = blockingReason(user);
  if (reason) return { status: 409, data: { error: reason } };

  const pointsLost = user.points;
  performDelete(user.id);
  return {
    status: 200,
    data: {
      message: pointsLost > 0
        ? `Compte supprimé. ${pointsLost} points ont été définitivement perdus.`
        : 'Compte supprimé.'
    }
  };
}

// Lets the admin panel show account details (points, agent role/status) before deleting,
// so the admin isn't acting blind on just a phone number.
export function lookupAccount(phone) {
  if (!phone) return { status: 400, data: { error: 'Numéro requis' } };
  const user = db.prepare(
    'SELECT id, phone, name, points, bonus_plays, created_at FROM users WHERE phone = ?'
  ).get(phone);
  if (!user) return { status: 404, data: { error: 'Compte introuvable' } };

  const agent = db.prepare(
    'SELECT status, credit_balance, commission_earned FROM agents WHERE user_id = ?'
  ).get(user.id);

  return { status: 200, data: { user, agent: agent || null } };
}

// Admin-triggered deletion (agent or player). Deliberately enforces the exact same
// guardrails as self-deletion rather than offering a "force" override — if money is
// still owed, the admin resolves it first through the normal pay/reject flows, then
// deletes, so nothing is ever lost by surprise.
export function adminDeleteAccount(body) {
  const { phone } = body || {};
  if (!phone) return { status: 400, data: { error: 'Numéro requis' } };

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) return { status: 404, data: { error: 'Compte introuvable' } };

  const reason = blockingReason(user);
  if (reason) return { status: 409, data: { error: reason } };

  const pointsLost = user.points;
  performDelete(user.id);
  return {
    status: 200,
    data: {
      message: pointsLost > 0
        ? `Compte de ${user.name} (${user.phone}) supprimé. ${pointsLost} points ont été définitivement perdus.`
        : `Compte de ${user.name} (${user.phone}) supprimé.`
    }
  };
}
