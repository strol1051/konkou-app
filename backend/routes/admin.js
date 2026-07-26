import crypto from 'node:crypto';
import db from '../db.js';
import { signToken } from '../utils.js';
import { adminConfirmOtp, listPendingOtps, rejectOtp } from '../otp.js';
import { getAgentCapitalFeePercent, formatAgentNumber } from './agents.js';

// Single shared password for the person(s) running the cash pickup point. Fine for a
// one/few-person operation; if you have several agents who need distinct accountability
// later, swap this for real per-agent accounts.
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function login(body) {
  const { password } = body || {};
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { status: 500, data: { error: "ADMIN_PASSWORD n'est pas configuré côté serveur (voir backend/.env)" } };
  }
  if (!password || !timingSafeStringEqual(password, expected)) {
    return { status: 401, data: { error: 'Mot de passe incorrect' } };
  }
  const token = signToken({ role: 'admin' }, process.env.JWT_SECRET, 12 * 60 * 60); // 12h session
  return { status: 200, data: { token } };
}

export function listCashouts(statusFilter) {
  const status = ['pending', 'paid', 'rejected'].includes(statusFilter) ? statusFilter : 'pending';
  const rows = db.prepare(`
    SELECT c.id, c.points, c.htg_amount, c.platform_fee_htg, c.net_payout_htg, c.method, c.payout_info, c.status, c.requested_at, c.processed_at,
           u.name as user_name, u.phone as user_phone
    FROM cashouts c
    JOIN users u ON u.id = c.user_id
    WHERE c.status = ?
    ORDER BY c.requested_at ASC
  `).all(status);
  return { status: 200, data: { status, cashouts: rows } };
}

export function payCashout(body) {
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const cashout = db.prepare('SELECT * FROM cashouts WHERE id = ?').get(id);
  if (!cashout) return { status: 404, data: { error: 'Demande introuvable' } };
  if (cashout.status !== 'pending') {
    return { status: 409, data: { error: `Cette demande est déjà "${cashout.status}"` } };
  }

  db.prepare("UPDATE cashouts SET status = 'paid', processed_at = datetime('now') WHERE id = ?").run(id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(cashout.user_id, 'cashout_paid', 0, `Retrait payé — code ${cashout.payout_info}`);

  return { status: 200, data: { message: 'Retrait marqué comme payé.' } };
}

export function rejectCashout(body) {
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const cashout = db.prepare('SELECT * FROM cashouts WHERE id = ?').get(id);
  if (!cashout) return { status: 404, data: { error: 'Demande introuvable' } };
  if (cashout.status !== 'pending') {
    return { status: 409, data: { error: `Cette demande est déjà "${cashout.status}"` } };
  }

  // Refund the points — they were deducted up front when the request was made.
  db.prepare("UPDATE cashouts SET status = 'rejected', processed_at = datetime('now') WHERE id = ?").run(id);
  db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(cashout.points, cashout.user_id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(cashout.user_id, 'cashout_rejected', cashout.points, `Retrait rejeté (code ${cashout.payout_info}) — points remboursés`);

  return { status: 200, data: { message: 'Retrait rejeté, points remboursés au joueur.' } };
}

// ---------- Vérifications (WhatsApp) ----------
// The operator receives a WhatsApp message (phone + code, pre-filled by the app) and
// cross-checks it here before confirming — this manual check is the actual proof of
// phone ownership in this design (no automated SMS provider is configured).

export function listVerifications(purposeFilter) {
  const purpose = purposeFilter === 'reset_password' ? 'reset_password' : 'verify_phone';
  const rows = listPendingOtps(purpose).map(r => ({
    phone: r.phone, code: r.code, requestedAt: r.created_at, expiresAt: r.expires_at
  }));
  return { status: 200, data: { purpose, requests: rows } };
}

export function confirmPhoneVerification(body) {
  const { phone } = body || {};
  if (!phone) return { status: 400, data: { error: 'Numéro requis' } };

  const result = adminConfirmOtp(phone, 'verify_phone');
  if (!result.ok) return { status: 400, data: { error: result.error } };

  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (!user) return { status: 404, data: { error: 'Compte introuvable' } };

  db.prepare('UPDATE users SET phone_verified = 1 WHERE id = ?').run(user.id);
  return { status: 200, data: { message: 'Numéro confirmé — le compte est activé.' } };
}

export function confirmPasswordReset(body) {
  const { phone } = body || {};
  if (!phone) return { status: 400, data: { error: 'Numéro requis' } };

  const result = adminConfirmOtp(phone, 'reset_password');
  if (!result.ok) return { status: 400, data: { error: result.error } };

  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (!user) return { status: 404, data: { error: 'Compte introuvable' } };

  let payload = {};
  try { payload = JSON.parse(result.row.payload || '{}'); } catch { /* ignore malformed payload */ }
  if (!payload.passwordHash) {
    return { status: 400, data: { error: 'Données de réinitialisation manquantes pour cette demande' } };
  }

  db.prepare('UPDATE users SET password_hash = ?, phone_verified = 1 WHERE id = ?').run(payload.passwordHash, user.id);
  return { status: 200, data: { message: 'Mot de passe réinitialisé.' } };
}

export function rejectPhoneVerification(body) {
  const { phone } = body || {};
  if (!phone) return { status: 400, data: { error: 'Numéro requis' } };

  const result = rejectOtp(phone, 'verify_phone');
  if (!result.ok) return { status: 400, data: { error: result.error } };

  return { status: 200, data: { message: "Demande rejetée — le compte reste non vérifié, l'utilisateur peut réessayer." } };
}

export function rejectPasswordReset(body) {
  const { phone } = body || {};
  if (!phone) return { status: 400, data: { error: 'Numéro requis' } };

  const result = rejectOtp(phone, 'reset_password');
  if (!result.ok) return { status: 400, data: { error: result.error } };

  return { status: 200, data: { message: "Demande rejetée — le mot de passe n'a pas été modifié, l'utilisateur peut réessayer." } };
}

// ---------- Dépôts (parties bonus) ----------

export function listDeposits(statusFilter) {
  const status = ['pending', 'confirmed', 'rejected'].includes(statusFilter) ? statusFilter : 'pending';
  const rows = db.prepare(`
    SELECT d.id, d.htg_amount, d.plays_granted, d.code, d.status, d.requested_at, d.processed_at,
           u.name as user_name, u.phone as user_phone
    FROM deposits d
    JOIN users u ON u.id = d.user_id
    WHERE d.status = ?
    ORDER BY d.requested_at ASC
  `).all(status);
  return { status: 200, data: { status, deposits: rows } };
}

export function confirmDeposit(body) {
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const deposit = db.prepare('SELECT * FROM deposits WHERE id = ?').get(id);
  if (!deposit) return { status: 404, data: { error: 'Dépôt introuvable' } };
  if (deposit.status !== 'pending') {
    return { status: 409, data: { error: `Ce dépôt est déjà "${deposit.status}"` } };
  }

  db.prepare("UPDATE deposits SET status = 'confirmed', processed_at = datetime('now') WHERE id = ?").run(id);
  db.prepare('UPDATE users SET bonus_plays = bonus_plays + ? WHERE id = ?').run(deposit.plays_granted, deposit.user_id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(deposit.user_id, 'deposit_confirmed', 0, `Dépôt confirmé — ${deposit.plays_granted} partie(s) bonus créditée(s) (code ${deposit.code})`);

  return { status: 200, data: { message: 'Dépôt confirmé, parties bonus créditées.' } };
}

export function rejectDeposit(body) {
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const deposit = db.prepare('SELECT * FROM deposits WHERE id = ?').get(id);
  if (!deposit) return { status: 404, data: { error: 'Dépôt introuvable' } };
  if (deposit.status !== 'pending') {
    return { status: 409, data: { error: `Ce dépôt est déjà "${deposit.status}"` } };
  }

  // No refund needed here (unlike cashouts) — nothing was debited from the user's
  // balance up front, this just means the agent never actually received the cash.
  db.prepare("UPDATE deposits SET status = 'rejected', processed_at = datetime('now') WHERE id = ?").run(id);
  return { status: 200, data: { message: 'Dépôt rejeté.' } };
}

// ---------- Candidatures Agent ----------
// A user applies in-app to become an agent (identity info + a required cash capital
// deposit — see routes/agents.js). Reviewing that identity info and confirming the
// capital was physically received is a central/HQ decision, so it stays here rather
// than in the agent's own dashboard (an agent obviously can't approve themselves).

export function listAgentApplications(statusFilter) {
  const status = ['pending', 'active', 'rejected'].includes(statusFilter) ? statusFilter : 'pending';
  const rows = db.prepare(`
    SELECT a.id, a.agent_code, a.last_name, a.first_name, a.birth_date, a.id_type, a.id_number,
           a.city, a.address, a.status, a.credit_balance, a.commission_earned, a.capital_htg, a.applied_at, a.approved_at,
           u.phone as user_phone
    FROM agents a
    JOIN users u ON u.id = a.user_id
    WHERE a.status = ?
    ORDER BY a.applied_at ASC
  `).all(status);
  const withNumbers = rows.map(r => ({ ...r, agent_number: formatAgentNumber(r.id) }));
  return { status: 200, data: { status, agents: withNumbers } };
}

export function approveAgentApplication(body) {
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  if (!agent) return { status: 404, data: { error: 'Candidature introuvable' } };
  if (agent.status !== 'pending') {
    return { status: 409, data: { error: `Cette candidature est déjà "${agent.status}"` } };
  }

  const feePercent = getAgentCapitalFeePercent();
  const platformFee = Math.round(agent.capital_htg * feePercent / 100 * 100) / 100;
  const credit = Math.round((agent.capital_htg - platformFee) * 100) / 100;

  db.prepare(
    `UPDATE agents SET status = 'active', credit_balance = ?, last_capital_deposit_htg = ?, platform_fee_htg = ?, approved_at = datetime('now') WHERE id = ?`
  ).run(credit, agent.capital_htg, platformFee, id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(agent.user_id, 'agent_activated', 0, `Compte agent activé (code ${agent.agent_code}) — ${credit} HTG de crédit initial`);

  return { status: 200, data: { message: `Agent activé avec ${credit} HTG de crédit.` } };
}

export function rejectAgentApplication(body) {
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  if (!agent) return { status: 404, data: { error: 'Candidature introuvable' } };
  if (agent.status !== 'pending') {
    return { status: 409, data: { error: `Cette candidature est déjà "${agent.status}"` } };
  }

  db.prepare("UPDATE agents SET status = 'rejected' WHERE id = ?").run(id);
  return { status: 200, data: { message: 'Candidature rejetée.' } };
}

// ---------- Renflouements agent ----------
// Same principle as the initial capital: the agent brings cash in person, and this is
// the human confirmation step that it was actually received before crediting anything.

export function listAgentRefills(statusFilter) {
  const status = ['pending', 'confirmed', 'rejected'].includes(statusFilter) ? statusFilter : 'pending';
  const rows = db.prepare(`
    SELECT r.id, r.amount_htg, r.fee_percent, r.platform_fee_htg, r.credited_htg, r.status, r.requested_at, r.processed_at,
           a.agent_code, a.first_name, a.last_name, u.phone as user_phone
    FROM agent_refills r
    JOIN agents a ON a.id = r.agent_id
    JOIN users u ON u.id = a.user_id
    WHERE r.status = ?
    ORDER BY r.requested_at ASC
  `).all(status);
  return { status: 200, data: { status, refills: rows } };
}

export function confirmAgentRefill(body) {
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const refill = db.prepare('SELECT * FROM agent_refills WHERE id = ?').get(id);
  if (!refill) return { status: 404, data: { error: 'Renflouement introuvable' } };
  if (refill.status !== 'pending') {
    return { status: 409, data: { error: `Ce renflouement est déjà "${refill.status}"` } };
  }

  db.prepare("UPDATE agent_refills SET status = 'confirmed', processed_at = datetime('now') WHERE id = ?").run(id);
  // The refill's gross amount becomes the new baseline for the agent's *next* refill
  // ceiling (125% of it), while credited_htg (net of the fee) tops up their resellable credit.
  db.prepare('UPDATE agents SET credit_balance = credit_balance + ?, last_capital_deposit_htg = ? WHERE id = ?')
    .run(refill.credited_htg, refill.amount_htg, refill.agent_id);

  const agent = db.prepare('SELECT user_id, agent_code FROM agents WHERE id = ?').get(refill.agent_id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(agent.user_id, 'agent_refill_confirmed', 0, `Renflouement confirmé (code ${agent.agent_code}) — ${refill.credited_htg} HTG de crédit ajouté`);

  return { status: 200, data: { message: `Renflouement confirmé, ${refill.credited_htg} HTG de crédit ajouté.` } };
}

export function rejectAgentRefill(body) {
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const refill = db.prepare('SELECT * FROM agent_refills WHERE id = ?').get(id);
  if (!refill) return { status: 404, data: { error: 'Renflouement introuvable' } };
  if (refill.status !== 'pending') {
    return { status: 409, data: { error: `Ce renflouement est déjà "${refill.status}"` } };
  }

  db.prepare("UPDATE agent_refills SET status = 'rejected', processed_at = datetime('now') WHERE id = ?").run(id);
  return { status: 200, data: { message: 'Renflouement rejeté.' } };
}

// ---------- Achats VIP ----------
// Même logique de confirmation en personne que les dépôts/renflouements, mais sans
// crédit agent à débiter/créditer — voir routes/agents.js agentConfirmVip pour le détail
// du calcul de la nouvelle date d'expiration (vip_until).

export function listVipPurchases(statusFilter) {
  const status = ['pending', 'confirmed', 'rejected'].includes(statusFilter) ? statusFilter : 'pending';
  const rows = db.prepare(`
    SELECT v.id, v.amount_htg, v.duration_days, v.code, v.status, v.requested_at, v.processed_at,
           u.name as user_name, u.phone as user_phone, a.agent_code
    FROM vip_purchases v
    JOIN users u ON u.id = v.user_id
    LEFT JOIN agents a ON a.id = v.agent_id
    WHERE v.status = ?
    ORDER BY v.requested_at ASC
  `).all(status);
  return { status: 200, data: { status, vipPurchases: rows } };
}

export function confirmVipPurchase(body) {
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const purchase = db.prepare('SELECT * FROM vip_purchases WHERE id = ?').get(id);
  if (!purchase) return { status: 404, data: { error: 'Achat VIP introuvable' } };
  if (purchase.status !== 'pending') {
    return { status: 409, data: { error: `Cet achat VIP est déjà "${purchase.status}"` } };
  }

  const user = db.prepare('SELECT vip_until FROM users WHERE id = ?').get(purchase.user_id);
  const base = user?.vip_until && new Date(user.vip_until).getTime() > Date.now()
    ? new Date(user.vip_until)
    : new Date();
  const newUntilIso = new Date(base.getTime() + purchase.duration_days * 24 * 60 * 60 * 1000).toISOString();

  db.prepare("UPDATE vip_purchases SET status = 'confirmed', processed_at = datetime('now') WHERE id = ?").run(id);
  db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(newUntilIso, purchase.user_id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(purchase.user_id, 'vip_confirmed', 0, `Abonnement VIP confirmé — valide jusqu'au ${newUntilIso.slice(0, 10)} (code ${purchase.code})`);

  return { status: 200, data: { message: 'Achat VIP confirmé.', vipUntil: newUntilIso } };
}

export function rejectVipPurchase(body) {
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const purchase = db.prepare('SELECT * FROM vip_purchases WHERE id = ?').get(id);
  if (!purchase) return { status: 404, data: { error: 'Achat VIP introuvable' } };
  if (purchase.status !== 'pending') {
    return { status: 409, data: { error: `Cet achat VIP est déjà "${purchase.status}"` } };
  }

  db.prepare("UPDATE vip_purchases SET status = 'rejected', processed_at = datetime('now') WHERE id = ?").run(id);
  return { status: 200, data: { message: 'Achat VIP rejeté.' } };
}

// ---------- Résumé des revenus plateforme ----------
// Everything here is derived straight from source tables rather than a separately
// maintained running counter, so it can never drift out of sync: capital fees are
// snapshotted per-agent at approval (immune to the fee % changing later), refill and
// cashout fees are snapshotted per-transaction the same way.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// dateFilter (optionnel) : une date 'YYYY-MM-DD' pour ne compter que les revenus collectés
// ce jour-là (voir "date(...)" ci-dessous, qui compare juste la partie date d'un
// timestamp SQLite) plutôt que tout l'historique. Utilisé par /admin.html pour le
// sélecteur "Revenus par jour" — voir aussi earliestDate, qui donne la première date
// possible (création du tout premier compte, joueur ou agent).
export function getRevenueSummary(dateFilter) {
  const validDate = dateFilter && ISO_DATE_RE.test(dateFilter) ? dateFilter : null;

  const agentCapitalFees = validDate
    ? db.prepare(`SELECT COALESCE(SUM(platform_fee_htg), 0) as total, COUNT(*) as count FROM agents WHERE status = 'active' AND date(approved_at) = ?`).get(validDate)
    : db.prepare(`SELECT COALESCE(SUM(platform_fee_htg), 0) as total, COUNT(*) as count FROM agents WHERE status = 'active'`).get();

  const agentRefillFees = validDate
    ? db.prepare(`SELECT COALESCE(SUM(platform_fee_htg), 0) as total, COUNT(*) as count FROM agent_refills WHERE status = 'confirmed' AND date(processed_at) = ?`).get(validDate)
    : db.prepare(`SELECT COALESCE(SUM(platform_fee_htg), 0) as total, COUNT(*) as count FROM agent_refills WHERE status = 'confirmed'`).get();

  const cashoutFees = validDate
    ? db.prepare(`SELECT COALESCE(SUM(platform_fee_htg), 0) as total, COUNT(*) as count FROM cashouts WHERE status = 'paid' AND date(processed_at) = ?`).get(validDate)
    : db.prepare(`SELECT COALESCE(SUM(platform_fee_htg), 0) as total, COUNT(*) as count FROM cashouts WHERE status = 'paid'`).get();

  const depositFees = validDate
    ? db.prepare(`SELECT COALESCE(SUM(platform_fee_htg), 0) as total, COUNT(*) as count FROM deposits WHERE status = 'confirmed' AND date(processed_at) = ?`).get(validDate)
    : db.prepare(`SELECT COALESCE(SUM(platform_fee_htg), 0) as total, COUNT(*) as count FROM deposits WHERE status = 'confirmed'`).get();

  // amount_htg est ici intégralement le revenu de la plateforme (contrairement aux
  // autres sources, qui ne sont qu'un pourcentage prélevé) — voir vip_purchases dans
  // db.js et le commentaire de agentConfirmVip dans routes/agents.js.
  const vipSales = validDate
    ? db.prepare(`SELECT COALESCE(SUM(amount_htg), 0) as total, COUNT(*) as count FROM vip_purchases WHERE status = 'confirmed' AND date(processed_at) = ?`).get(validDate)
    : db.prepare(`SELECT COALESCE(SUM(amount_htg), 0) as total, COUNT(*) as count FROM vip_purchases WHERE status = 'confirmed'`).get();

  const r2 = (n) => Math.round(n * 100) / 100;
  const totalRevenue = r2(agentCapitalFees.total + agentRefillFees.total + cashoutFees.total + depositFees.total + vipSales.total);

  // Premier compte jamais créé (joueur ou agent, les deux vivent dans "users") — borne
  // min du sélecteur de date côté admin, comme demandé.
  const earliest = db.prepare('SELECT MIN(created_at) as d FROM users').get().d;
  const earliestDate = earliest ? earliest.slice(0, 10) : null;

  return {
    status: 200,
    data: {
      date: validDate, // null = tout l'historique depuis le début
      earliestDate,
      totalRevenueHtg: totalRevenue,
      breakdown: {
        agentCapitalFees: { totalHtg: r2(agentCapitalFees.total), count: agentCapitalFees.count },
        agentRefillFees: { totalHtg: r2(agentRefillFees.total), count: agentRefillFees.count },
        cashoutServiceFees: { totalHtg: r2(cashoutFees.total), count: cashoutFees.count },
        depositServiceFees: { totalHtg: r2(depositFees.total), count: depositFees.count },
        vipSales: { totalHtg: r2(vipSales.total), count: vipSales.count }
      }
    }
  };
}
