import db from '../db.js';
import { verifyPassword } from '../utils.js';

// Shared safety check for both self-service and admin-triggered deletion. Points (for a
// player) and credit/commission balance (for an agent) are NOT blocking conditions (see
// performDelete) — deleting the account simply forfeits/closes them, by design, so it
// never traps someone who wants to leave (the frontend warns about this beforehand, and
// the final message recaps what was lost — see deleteMyAccount/adminDeleteAccount).
// What DOES still block: anything that would silently orphan money someone ELSE is still
// owed — a pending cashout/deposit the user themselves requested as a player, or, for an
// agent account, a pending deposit/cashout/refill currently assigned to them that a
// player or Konkou is waiting on. Returns a human-readable blocking reason, or null if
// it's safe to delete.
function blockingReason(user) {
  // Activité "joueur" du compte — jamais déclenchée pour un compte agent (voir
  // blockIfAgent côté server.js : un agent n'a jamais de retrait/dépôt à son propre nom).
  const pendingCashout = db.prepare(`SELECT id FROM cashouts WHERE user_id = ? AND status = 'pending'`).get(user.id);
  if (pendingCashout) return 'Un retrait est en attente sur ce compte — attendez qu\'il soit payé ou rejeté avant de supprimer.';

  const pendingDeposit = db.prepare(`SELECT id FROM deposits WHERE user_id = ? AND status = 'pending'`).get(user.id);
  if (pendingDeposit) return 'Un dépôt est en attente sur ce compte — attendez qu\'il soit confirmé ou rejeté avant de supprimer.';

  // Ce compte est-il un agent (actif, en attente ou rejeté) ? Un rôle agent actif n'est
  // plus, en soi, un motif de blocage (supprimer le compte ferme le rôle) — seules les
  // transactions de joueurs qui lui sont actuellement assignées et non résolues bloquent,
  // car elles deviendraient orphelines/impayables une fois le compte agent disparu.
  const agent = db.prepare(`SELECT id FROM agents WHERE user_id = ?`).get(user.id);
  if (agent) {
    const pendingAssignedDeposit = db.prepare(`SELECT id FROM deposits WHERE agent_id = ? AND status = 'pending'`).get(agent.id);
    if (pendingAssignedDeposit) return "Ce compte agent a au moins un dépôt en attente qui lui est assigné — attendez qu'il soit confirmé ou rejeté avant de supprimer.";

    const pendingAssignedCashout = db.prepare(`SELECT id FROM cashouts WHERE agent_id = ? AND status = 'pending'`).get(agent.id);
    if (pendingAssignedCashout) return "Ce compte agent a au moins un retrait en attente qui lui est assigné — attendez qu'il soit payé ou rejeté avant de supprimer.";

    const pendingRefill = db.prepare(`SELECT id FROM agent_refills WHERE agent_id = ? AND status = 'pending'`).get(agent.id);
    if (pendingRefill) return "Ce compte agent a une demande de renflouement de capital en attente — attendez qu'elle soit confirmée ou rejetée avant de supprimer.";
  }
  return null;
}

// Message de récapitulatif ajouté à la confirmation de suppression quand le compte est
// un agent avec du crédit revendable et/ou des commissions non nulles — purement
// informatif (à régler avec l'agent en dehors de l'app, comme le reste de la comptabilité
// agent), n'empêche jamais la suppression elle-même.
function agentForfeitureNote(userId) {
  const agent = db.prepare('SELECT credit_balance, commission_earned FROM agents WHERE user_id = ?').get(userId);
  if (!agent) return '';
  const parts = [];
  if (agent.credit_balance > 0) parts.push(`${agent.credit_balance} HTG de crédit revendable`);
  if (agent.commission_earned > 0) parts.push(`${agent.commission_earned} HTG de commissions`);
  if (parts.length === 0) return '';
  return ` Ce compte avait encore ${parts.join(' et ')} — à régler avec l'agent en dehors de l'app, ce n'est pas remboursé ni transféré automatiquement.`;
}

// Any agent row still attached to the user at this point (active, pending or rejected)
// is, by blockingReason() above, free of any pending assigned transaction — safe to
// remove alongside the user account. Its remaining credit_balance/commission_earned is
// not settled or transferred anywhere by this call (see agentForfeitureNote — purely
// informational, reconciled with the agent outside the app). Points are not explicitly
// zeroed first either: deleting the users row eliminates them along with everything else
// on the account. The phone number itself is freed immediately (UNIQUE constraint on
// users.phone) and can register a brand new account right away — but see
// deleted_phones below: a fresh registration on this number won't get the 100pt welcome
// bonus a second time.
function performDelete(user) {
  // Enregistré AVANT la suppression (la ligne users va disparaître) — c'est ce que
  // routes/auth.js (register) consulte pour ne pas re-accorder le bonus de bienvenue à
  // un numéro qui l'a déjà touché une fois, même après suppression du compte.
  db.prepare('INSERT INTO deleted_phones (phone) VALUES (?)').run(user.phone);
  db.prepare('DELETE FROM agents WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
}

// Self-service deletion — requires re-entering the password as a confirmation step for
// this irreversible action, same as most apps do for account deletion. The frontend is
// expected to warn the user beforehand that any remaining points (player) or credit/
// commissions (agent) will be lost (see app.js) ; this is the actual point of no return
// once that password is accepted.
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
  const agentNote = agentForfeitureNote(user.id);
  performDelete(user);
  return {
    status: 200,
    data: {
      message: (pointsLost > 0
        ? `Compte supprimé. ${pointsLost} points ont été définitivement perdus.`
        : 'Compte supprimé.') + agentNote
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
    'SELECT status, city, address, credit_balance, commission_earned FROM agents WHERE user_id = ?'
  ).get(user.id);

  return { status: 200, data: { user, agent: agent || null } };
}

// Liste des comptes JOUEUR pour l'onglet "Joueurs" de /admin.html — exclut délibérément
// tout compte lié à une ligne "agents" (peu importe son statut), qui a déjà son propre
// onglet "Agents" avec ses propres informations (crédit, commissions...) non pertinentes
// ici. `search` (optionnel) filtre par correspondance partielle sur le téléphone OU le nom
// (insensible à la casse pour le nom, LIKE gère nativement les deux). Plafonné à
// PLAYERS_LIST_LIMIT résultats, les plus récents en premier — au-delà, la recherche sert à
// affiner plutôt que de renvoyer un payload disproportionné sur une base avec beaucoup de
// comptes ; `truncated` indique au frontend qu'il existe plus de résultats que ceux renvoyés.
const PLAYERS_LIST_LIMIT = 500;

export function listPlayers(search) {
  const term = search && String(search).trim();

  const totalPlayers = db.prepare(
    `SELECT COUNT(*) as c FROM users WHERE id NOT IN (SELECT user_id FROM agents)`
  ).get().c;

  let matching, rows;
  if (term) {
    const like = `%${term}%`;
    matching = db.prepare(
      `SELECT COUNT(*) as c FROM users WHERE id NOT IN (SELECT user_id FROM agents) AND (phone LIKE ? OR name LIKE ?)`
    ).get(like, like).c;
    rows = db.prepare(`
      SELECT id, phone, name, points, non_cashable_points, bonus_plays, vip_until, phone_verified, created_at
      FROM users
      WHERE id NOT IN (SELECT user_id FROM agents) AND (phone LIKE ? OR name LIKE ?)
      ORDER BY created_at DESC
      LIMIT ${PLAYERS_LIST_LIMIT}
    `).all(like, like);
  } else {
    matching = totalPlayers;
    rows = db.prepare(`
      SELECT id, phone, name, points, non_cashable_points, bonus_plays, vip_until, phone_verified, created_at
      FROM users
      WHERE id NOT IN (SELECT user_id FROM agents)
      ORDER BY created_at DESC
      LIMIT ${PLAYERS_LIST_LIMIT}
    `).all();
  }

  return {
    status: 200,
    data: { totalPlayers, matching, truncated: matching > rows.length, players: rows }
  };
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
  const agentNote = agentForfeitureNote(user.id);
  performDelete(user);
  return {
    status: 200,
    data: {
      message: (pointsLost > 0
        ? `Compte de ${user.name} (${user.phone}) supprimé. ${pointsLost} points ont été définitivement perdus.`
        : `Compte de ${user.name} (${user.phone}) supprimé.`) + agentNote
    }
  };
}
