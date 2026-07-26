import db from '../db.js';

export function getAgentCapitalHtg() { return parseFloat(process.env.AGENT_CAPITAL_HTG || '7500'); }
export function getAgentCapitalFeePercent() { return parseFloat(process.env.AGENT_CAPITAL_FEE_PERCENT || '10'); }
export function getAgentCommissionPercent() { return parseFloat(process.env.AGENT_CASHOUT_COMMISSION_PERCENT || '10'); }
export function getRefillFeePercent() { return parseFloat(process.env.AGENT_REFILL_FEE_PERCENT || '7'); }
export function getRefillMinHtg() { return parseFloat(process.env.AGENT_REFILL_MIN_HTG || '100'); }
export function getRefillGrowthPercent() { return parseFloat(process.env.AGENT_REFILL_GROWTH_PERCENT || '25'); }

const ID_TYPES = ['cin', 'passeport', 'permis'];

function stripAccents(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function onlyLetters(s) { return stripAccents(s).replace(/[^a-zA-Z]/g, '').toUpperCase(); }

// 3 lettres du nom + 2 lettres du prénom, complété avec "X" si le nom est trop court.
function makeAgentCode(lastName, firstName) {
  const ln = onlyLetters(lastName).padEnd(3, 'X').slice(0, 3);
  const fn = onlyLetters(firstName).padEnd(2, 'X').slice(0, 2);
  return ln + fn;
}

// Appends a 2-digit suffix on collision (kept out of the base 5-letter format so the
// common case — no collision — stays exactly "3 lettres + 2 lettres" as specified).
function uniqueAgentCode(lastName, firstName, forUserId) {
  const base = makeAgentCode(lastName, firstName);
  let code = base;
  let n = 1;
  while (true) {
    const existing = db.prepare('SELECT user_id FROM agents WHERE agent_code = ?').get(code);
    if (!existing || existing.user_id === forUserId) return code;
    code = `${base}${String(n).padStart(2, '0')}`;
    n++;
  }
}

function calcAge(birthDate) {
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

// Sequential agent number — "00001" for the first agent ever to apply, "00002" for the
// next, and so on. Reuses the agents.id primary key (assigned once, at first-ever
// application; a later re-application after a rejection UPDATEs the same row rather
// than inserting a new one, so the original number is kept, not reassigned).
export function formatAgentNumber(id) { return String(id).padStart(5, '0'); }

// Ceiling for the agent's next capital refill: 125% (by default) of their most recent
// confirmed deposit — a growing credit line that rewards agents who keep operating.
function nextRefillCeiling(lastCapitalDepositHtg) {
  const growth = getRefillGrowthPercent();
  return Math.round(lastCapitalDepositHtg * (1 + growth / 100) * 100) / 100;
}

function publicAgent(a) {
  return {
    agentNumber: formatAgentNumber(a.id),
    status: a.status,
    agentCode: a.agent_code,
    lastName: a.last_name,
    firstName: a.first_name,
    idType: a.id_type,
    creditBalance: a.credit_balance,
    commissionEarned: a.commission_earned,
    capitalHtg: a.capital_htg,
    lastCapitalDepositHtg: a.last_capital_deposit_htg,
    nextRefillCeilingHtg: nextRefillCeiling(a.last_capital_deposit_htg),
    appliedAt: a.applied_at,
    approvedAt: a.approved_at
  };
}

// Filled by the user themselves, in-app — becoming an agent is an extra role on top of
// a normal Konkou account, not a separate login system.
export function applyAgent(userId, body) {
  const { lastName, firstName, birthDate, idType, idNumber } = body || {};
  if (!lastName || !firstName || !birthDate || !idType || !idNumber || !String(idNumber).trim()) {
    return { status: 400, data: { error: "Nom, prénom, date de naissance, type et numéro de pièce d'identité requis" } };
  }
  if (!ID_TYPES.includes(idType)) {
    return { status: 400, data: { error: "Type de pièce d'identité invalide" } };
  }
  const age = calcAge(birthDate);
  if (age === null) return { status: 400, data: { error: 'Date de naissance invalide' } };
  if (age < 18) return { status: 400, data: { error: 'Vous devez avoir au moins 18 ans pour devenir agent' } };

  const existing = db.prepare('SELECT * FROM agents WHERE user_id = ?').get(userId);
  if (existing && existing.status !== 'rejected') {
    return {
      status: 409,
      data: { error: `Vous avez déjà une candidature agent (${existing.status === 'pending' ? 'en attente' : 'active'})` }
    };
  }

  const agentCode = uniqueAgentCode(lastName, firstName, userId);
  const capital = getAgentCapitalHtg();
  let agentId;

  if (existing) {
    // A previous application was rejected — let the user try again with fresh info
    // rather than being permanently locked out. Reuses the same row/id, so their
    // agent number (see formatAgentNumber) stays the one from their first-ever application.
    db.prepare(
      `UPDATE agents SET last_name=?, first_name=?, birth_date=?, id_type=?, id_number=?, agent_code=?,
       status='pending', capital_htg=?, applied_at=datetime('now'), approved_at=NULL WHERE id=?`
    ).run(lastName, firstName, birthDate, idType, String(idNumber).trim(), agentCode, capital, existing.id);
    agentId = existing.id;
  } else {
    const info = db.prepare(
      `INSERT INTO agents (user_id, last_name, first_name, birth_date, id_type, id_number, agent_code, capital_htg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, lastName, firstName, birthDate, idType, String(idNumber).trim(), agentCode, capital);
    agentId = info.lastInsertRowid;
  }

  return {
    status: 200,
    data: {
      message: `Candidature enregistrée. Déposez ${capital} HTG à notre bureau pour l'activer.`,
      agentNumber: formatAgentNumber(agentId),
      agentCode,
      capitalHtg: capital,
      status: 'pending'
    }
  };
}

export function getMyAgent(userId) {
  const a = db.prepare('SELECT * FROM agents WHERE user_id = ?').get(userId);
  return { status: 200, data: { agent: a ? publicAgent(a) : null } };
}

// Powers the agent picker shown to players on the deposit/cashout forms, so they choose
// from a list instead of typing a code blind. Only exposes what's needed to recognize
// and select an agent — not their credit balance or commission (business-sensitive).
export function listActiveAgents() {
  const rows = db.prepare(
    `SELECT id, agent_code, first_name, last_name FROM agents WHERE status = 'active' ORDER BY agent_code ASC`
  ).all();
  return {
    status: 200,
    data: {
      agents: rows.map(a => ({
        agentNumber: formatAgentNumber(a.id),
        agentCode: a.agent_code,
        firstName: a.first_name,
        lastName: a.last_name
      }))
    }
  };
}

function requireActiveAgent(userId) {
  return db.prepare("SELECT * FROM agents WHERE user_id = ? AND status = 'active'").get(userId);
}

export function getAgentDashboard(userId) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };

  const pendingDeposits = db.prepare(`
    SELECT d.id, d.htg_amount, d.plays_granted, d.code, d.requested_at, u.name as user_name, u.phone as user_phone
    FROM deposits d JOIN users u ON u.id = d.user_id
    WHERE d.agent_id = ? AND d.status = 'pending' ORDER BY d.requested_at ASC
  `).all(agent.id);

  // net_payout_htg is what the agent must actually hand over in cash — htg_amount
  // (gross, used for their 10% commission) minus the platform's service fee.
  const pendingCashouts = db.prepare(`
    SELECT c.id, c.points, c.htg_amount, c.platform_fee_htg, c.net_payout_htg, c.payout_info, c.requested_at, u.name as user_name, u.phone as user_phone
    FROM cashouts c JOIN users u ON u.id = c.user_id
    WHERE c.agent_id = ? AND c.status = 'pending' ORDER BY c.requested_at ASC
  `).all(agent.id);

  const refills = db.prepare(
    `SELECT id, amount_htg, fee_percent, credited_htg, status, requested_at, processed_at
     FROM agent_refills WHERE agent_id = ? ORDER BY id DESC`
  ).all(agent.id);

  return {
    status: 200,
    data: {
      agentNumber: formatAgentNumber(agent.id),
      agentCode: agent.agent_code,
      creditBalance: agent.credit_balance,
      commissionEarned: agent.commission_earned,
      commissionPercent: getAgentCommissionPercent(),
      lastCapitalDepositHtg: agent.last_capital_deposit_htg,
      nextRefillCeilingHtg: nextRefillCeiling(agent.last_capital_deposit_htg),
      refillFeePercent: getRefillFeePercent(),
      refillMinHtg: getRefillMinHtg(),
      pendingDeposits,
      pendingCashouts,
      refills
    }
  };
}

// Lets an active agent request additional capital ("renflouement") to grow their
// resellable credit. The ceiling (125% of their previous deposit, by default) is a
// carrot for staying active; the fee is new recurring platform revenue on top of the
// one-time fee taken at initial approval. Requires the same in-person cash handoff +
// admin confirmation as the original capital (see routes/admin.js confirmAgentRefill).
export function postAgentRefill(userId, body) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };

  const amount = parseFloat(body?.amount);
  const min = getRefillMinHtg();
  const ceiling = nextRefillCeiling(agent.last_capital_deposit_htg);
  if (!amount || amount < min) {
    return { status: 400, data: { error: `Le renflouement doit être d'au moins ${min} HTG` } };
  }
  if (amount > ceiling) {
    return { status: 400, data: { error: `Ce renflouement dépasse votre plafond actuel de ${ceiling} HTG (125% de votre dernier dépôt)` } };
  }

  const existingPending = db.prepare(
    `SELECT id FROM agent_refills WHERE agent_id = ? AND status = 'pending'`
  ).get(agent.id);
  if (existingPending) {
    return { status: 409, data: { error: 'Vous avez déjà une demande de renflouement en attente' } };
  }

  const feePercent = getRefillFeePercent();
  const platformFee = Math.round(amount * feePercent / 100 * 100) / 100;
  const credited = Math.round((amount - platformFee) * 100) / 100;

  const info = db.prepare(
    `INSERT INTO agent_refills (agent_id, amount_htg, fee_percent, platform_fee_htg, credited_htg, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  ).run(agent.id, amount, feePercent, platformFee, credited);

  return {
    status: 200,
    data: {
      message: `Demande de renflouement enregistrée. Déposez ${amount} HTG à notre bureau pour la valider.`,
      refillId: info.lastInsertRowid,
      amount,
      feePercent,
      credited,
      status: 'pending'
    }
  };
}

export function agentConfirmDeposit(userId, body) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const dep = db.prepare('SELECT * FROM deposits WHERE id = ?').get(id);
  if (!dep || dep.agent_id !== agent.id) return { status: 404, data: { error: 'Dépôt introuvable' } };
  if (dep.status !== 'pending') return { status: 409, data: { error: `Ce dépôt est déjà "${dep.status}"` } };
  if (agent.credit_balance < dep.htg_amount) {
    return { status: 400, data: { error: `Crédit insuffisant (solde : ${agent.credit_balance} HTG, requis : ${dep.htg_amount} HTG)` } };
  }

  db.prepare("UPDATE deposits SET status = 'confirmed', processed_at = datetime('now') WHERE id = ?").run(id);
  db.prepare('UPDATE agents SET credit_balance = credit_balance - ? WHERE id = ?').run(dep.htg_amount, agent.id);
  db.prepare('UPDATE users SET bonus_plays = bonus_plays + ? WHERE id = ?').run(dep.plays_granted, dep.user_id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(dep.user_id, 'deposit_confirmed', 0, `Dépôt confirmé par l'agent ${agent.agent_code} — ${dep.plays_granted} partie(s) bonus créditée(s) (code ${dep.code})`);

  return { status: 200, data: { message: 'Dépôt confirmé, parties bonus créditées.' } };
}

export function agentRejectDeposit(userId, body) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const dep = db.prepare('SELECT * FROM deposits WHERE id = ?').get(id);
  if (!dep || dep.agent_id !== agent.id) return { status: 404, data: { error: 'Dépôt introuvable' } };
  if (dep.status !== 'pending') return { status: 409, data: { error: `Ce dépôt est déjà "${dep.status}"` } };

  db.prepare("UPDATE deposits SET status = 'rejected', processed_at = datetime('now') WHERE id = ?").run(id);
  return { status: 200, data: { message: 'Dépôt rejeté.' } };
}

export function agentPayCashout(userId, body) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const co = db.prepare('SELECT * FROM cashouts WHERE id = ?').get(id);
  if (!co || co.agent_id !== agent.id) return { status: 404, data: { error: 'Retrait introuvable' } };
  if (co.status !== 'pending') return { status: 409, data: { error: `Ce retrait est déjà "${co.status}"` } };

  const commission = Math.round(co.htg_amount * getAgentCommissionPercent() / 100 * 100) / 100;
  db.prepare("UPDATE cashouts SET status = 'paid', processed_at = datetime('now') WHERE id = ?").run(id);
  db.prepare('UPDATE agents SET commission_earned = commission_earned + ? WHERE id = ?').run(commission, agent.id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(co.user_id, 'cashout_paid', 0, `Retrait payé par l'agent ${agent.agent_code} — code ${co.payout_info}`);

  return { status: 200, data: { message: `Retrait marqué comme payé. Commission gagnée : ${commission} HTG.` } };
}

export function agentRejectCashout(userId, body) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const co = db.prepare('SELECT * FROM cashouts WHERE id = ?').get(id);
  if (!co || co.agent_id !== agent.id) return { status: 404, data: { error: 'Retrait introuvable' } };
  if (co.status !== 'pending') return { status: 409, data: { error: `Ce retrait est déjà "${co.status}"` } };

  // Refund the points — they were deducted up front when the request was made.
  db.prepare("UPDATE cashouts SET status = 'rejected', processed_at = datetime('now') WHERE id = ?").run(id);
  db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(co.points, co.user_id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(co.user_id, 'cashout_rejected', co.points, `Retrait rejeté par l'agent (code ${co.payout_info}) — points remboursés`);

  return { status: 200, data: { message: 'Retrait rejeté, points remboursés au joueur.' } };
}

// Resolves a user-entered agent code to an active agent's id — used by deposits.js and
// wallet.js when a user creates a new request. Returns null if invalid/not active.
export function resolveActiveAgentId(agentCode) {
  if (!agentCode) return null;
  const agent = db.prepare("SELECT id FROM agents WHERE agent_code = ? AND status = 'active'").get(String(agentCode).toUpperCase());
  return agent ? agent.id : null;
}
