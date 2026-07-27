import crypto from 'node:crypto';
import db from '../db.js';
import { hashPassword } from '../utils.js';
import { issueOtp } from '../otp.js';

export function getAgentCapitalHtg() { return parseFloat(process.env.AGENT_CAPITAL_HTG || '7500'); }
export function getAgentCapitalFeePercent() { return parseFloat(process.env.AGENT_CAPITAL_FEE_PERCENT || '10'); }
export function getAgentCommissionPercent() { return parseFloat(process.env.AGENT_CASHOUT_COMMISSION_PERCENT || '10'); }
export function getRefillFeePercent() { return parseFloat(process.env.AGENT_REFILL_FEE_PERCENT || '7'); }
export function getRefillMinHtg() { return parseFloat(process.env.AGENT_REFILL_MIN_HTG || '100'); }
export function getRefillGrowthPercent() { return parseFloat(process.env.AGENT_REFILL_GROWTH_PERCENT || '25'); }

const ID_TYPES = ['cin', 'passeport', 'permis'];

// Même format que routes/auth.js register() — voir le commentaire là-bas.
const PHONE_RE = /^509\d{8}$/;

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
    city: a.city,
    address: a.address,
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
  const { lastName, firstName, birthDate, idType, idNumber, city, address } = body || {};
  if (!lastName || !firstName || !birthDate || !idType || !idNumber || !String(idNumber).trim() || !city || !address) {
    return { status: 400, data: { error: "Nom, prénom, date de naissance, type et numéro de pièce d'identité, ville et adresse requis" } };
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
      `UPDATE agents SET last_name=?, first_name=?, birth_date=?, id_type=?, id_number=?, city=?, address=?, agent_code=?,
       status='pending', capital_htg=?, applied_at=datetime('now'), approved_at=NULL WHERE id=?`
    ).run(lastName, firstName, birthDate, idType, String(idNumber).trim(), city, address, agentCode, capital, existing.id);
    agentId = existing.id;
  } else {
    const info = db.prepare(
      `INSERT INTO agents (user_id, last_name, first_name, birth_date, id_type, id_number, city, address, agent_code, capital_htg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, lastName, firstName, birthDate, idType, String(idNumber).trim(), city, address, agentCode, capital);
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

function whatsappMessage(whatsappLink, successText, missingConfigText) {
  return whatsappLink
    ? successText
    : `${missingConfigText} — aucun numéro WhatsApp n'est configuré côté serveur (OPERATOR_WHATSAPP_NUMBER), contactez l'administrateur.`;
}

function makeReferralCode(name) {
  const base = (name || 'agent').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'AGNT';
  return base + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// True si ce compte est lié à une ligne "agents" (peu importe le statut — pending,
// active ou rejected comptent tous comme "numéro enregistré en tant qu'agent"). Utilisé
// par server.js pour bloquer, côté serveur, tout accès aux fonctionnalités joueur
// (jeux, portefeuille, classement...) — un numéro agent n'a plus aucun usage joueur,
// voir registerAgent ci-dessous pour le flux d'inscription dédié.
export function isAgentLinked(userId) {
  return !!db.prepare('SELECT 1 FROM agents WHERE user_id = ?').get(userId);
}

// Inscription agent en une étape, complètement séparée de l'inscription joueur
// (/api/auth/register) — accessible sans être connecté, depuis un lien dédié sur
// l'écran de connexion. Crée le compte (users) ET la candidature agent (agents) en même
// temps, avec 0 point de bienvenue (un compte agent n'a aucun usage joueur). Si ce
// numéro est déjà un compte joueur/agent vérifié, on refuse — un même numéro ne peut
// pas être à la fois joueur et agent : c'est justement ce qui garantit qu'un numéro
// "agent" n'a jamais accès aux fonctionnalités joueur.
export async function registerAgent(body) {
  const { phone, password, lastName, firstName, birthDate, idType, idNumber, city, address } = body || {};
  if (!phone || !password) {
    return { status: 400, data: { error: 'Téléphone et mot de passe requis' } };
  }
  if (!PHONE_RE.test(phone)) {
    return { status: 400, data: { error: 'Numéro de téléphone invalide (8 chiffres attendus après le +509)' } };
  }
  if (String(password).length < 6) {
    return { status: 400, data: { error: 'Le mot de passe doit contenir au moins 6 caractères' } };
  }
  if (!lastName || !firstName || !birthDate || !idType || !idNumber || !String(idNumber).trim() || !city || !address) {
    return { status: 400, data: { error: "Nom, prénom, date de naissance, type et numéro de pièce d'identité, ville et adresse requis" } };
  }
  if (!ID_TYPES.includes(idType)) {
    return { status: 400, data: { error: "Type de pièce d'identité invalide" } };
  }
  const age = calcAge(birthDate);
  if (age === null) return { status: 400, data: { error: 'Date de naissance invalide' } };
  if (age < 18) return { status: 400, data: { error: 'Vous devez avoir au moins 18 ans pour devenir agent' } };

  const existing = db.prepare('SELECT id, phone_verified FROM users WHERE phone = ?').get(phone);
  if (existing && existing.phone_verified) {
    return { status: 409, data: { error: 'Ce numéro est déjà enregistré' } };
  }

  const name = `${firstName} ${lastName}`.trim();
  const hash = hashPassword(password);
  let userId;

  if (existing) {
    // Reprise d'une inscription jamais vérifiée sur ce numéro (même logique que
    // l'inscription joueur classique dans routes/auth.js).
    userId = existing.id;
    db.prepare('UPDATE users SET name = ?, password_hash = ? WHERE id = ?').run(name, hash, userId);
  } else {
    let myCode = makeReferralCode(name);
    while (db.prepare('SELECT id FROM users WHERE referral_code = ?').get(myCode)) {
      myCode = makeReferralCode(name);
    }
    // points = 0, pas de bonus de bienvenue : ce compte ne joue jamais.
    const info = db.prepare(
      'INSERT INTO users (phone, name, password_hash, points, referral_code, phone_verified) VALUES (?, ?, ?, 0, ?, 0)'
    ).run(phone, name, hash, myCode);
    userId = info.lastInsertRowid;
  }

  const agentCode = uniqueAgentCode(lastName, firstName, userId);
  const capital = getAgentCapitalHtg();
  const existingAgent = db.prepare('SELECT id FROM agents WHERE user_id = ?').get(userId);
  if (!existingAgent) {
    db.prepare(
      `INSERT INTO agents (user_id, last_name, first_name, birth_date, id_type, id_number, city, address, agent_code, capital_htg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, lastName, firstName, birthDate, idType, String(idNumber).trim(), city, address, agentCode, capital);
  } else {
    db.prepare(
      `UPDATE agents SET last_name=?, first_name=?, birth_date=?, id_type=?, id_number=?, city=?, address=?, agent_code=?,
       status='pending', capital_htg=?, applied_at=datetime('now'), approved_at=NULL WHERE id=?`
    ).run(lastName, firstName, birthDate, idType, String(idNumber).trim(), city, address, agentCode, capital, existingAgent.id);
  }

  const otp = await issueOtp(phone, 'verify_phone', 'Confirmez la création de mon compte agent Konkou.');
  if (!otp.ok) {
    return { status: 429, data: { error: otp.error } };
  }

  return {
    status: 200,
    data: {
      pendingVerification: true,
      phone,
      purpose: 'verify_phone',
      code: otp.code,
      whatsappLink: otp.whatsappLink,
      message: whatsappMessage(otp.whatsappLink, 'Candidature agent enregistrée. Confirmez via WhatsApp pour l’activer.', 'Candidature enregistrée')
    }
  };
}

export function getMyAgent(userId) {
  const a = db.prepare('SELECT * FROM agents WHERE user_id = ?').get(userId);
  return { status: 200, data: { agent: a ? publicAgent(a) : null } };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Commission de l'agent, filtrable par jour — dateFilter (optionnel, 'YYYY-MM-DD') ne
// compte que les retraits payés ce jour-là (via cashouts.commission_htg, figée au
// paiement — voir agentPayCashout). Sans date, renvoie le total historique déjà tenu à
// jour dans agents.commission_earned (fiable même pour des paiements antérieurs à
// l'ajout de la colonne commission_htg). activatedDate (agent.approved_at) borne la
// période sélectionnable côté interface : un agent ne peut consulter que depuis
// l'activation de son propre compte, pas avant.
export function getAgentCommissionByDay(userId, dateFilter) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };

  const validDate = dateFilter && ISO_DATE_RE.test(dateFilter) ? dateFilter : null;

  let commissionHtg, cashoutsCount;
  if (validDate) {
    const row = db.prepare(
      `SELECT COALESCE(SUM(commission_htg), 0) as total, COUNT(*) as count
       FROM cashouts WHERE agent_id = ? AND status = 'paid' AND date(processed_at) = ?`
    ).get(agent.id, validDate);
    commissionHtg = Math.round(row.total * 100) / 100;
    cashoutsCount = row.count;
  } else {
    commissionHtg = agent.commission_earned;
    cashoutsCount = db.prepare(
      `SELECT COUNT(*) as count FROM cashouts WHERE agent_id = ? AND status = 'paid'`
    ).get(agent.id).count;
  }

  return {
    status: 200,
    data: {
      date: validDate,
      activatedDate: agent.approved_at ? agent.approved_at.slice(0, 10) : null,
      commissionHtg,
      cashoutsCount
    }
  };
}

// Powers the agent picker shown to players on the deposit/cashout forms, so they choose
// from a list instead of typing a code blind. City/address are included so the player
// knows where they're going before committing to that agent — not their credit balance
// or commission (business-sensitive, stays out of this response).
export function listActiveAgents() {
  const rows = db.prepare(
    `SELECT id, agent_code, first_name, last_name, city, address FROM agents WHERE status = 'active' ORDER BY agent_code ASC`
  ).all();
  return {
    status: 200,
    data: {
      agents: rows.map(a => ({
        agentNumber: formatAgentNumber(a.id),
        agentCode: a.agent_code,
        firstName: a.first_name,
        lastName: a.last_name,
        city: a.city,
        address: a.address
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

  // Achats VIP à confirmer — même flux que pendingDeposits, mais sans crédit agent à
  // vérifier (voir vip.js : le montant n'est jamais déduit du credit_balance de l'agent).
  const pendingVip = db.prepare(`
    SELECT v.id, v.amount_htg, v.duration_days, v.code, v.requested_at, u.name as user_name, u.phone as user_phone
    FROM vip_purchases v JOIN users u ON u.id = v.user_id
    WHERE v.agent_id = ? AND v.status = 'pending' ORDER BY v.requested_at ASC
  `).all(agent.id);

  return {
    status: 200,
    data: {
      agentNumber: formatAgentNumber(agent.id),
      agentCode: agent.agent_code,
      firstName: agent.first_name,
      lastName: agent.last_name,
      city: agent.city,
      address: agent.address,
      activatedDate: agent.approved_at ? agent.approved_at.slice(0, 10) : null,
      creditBalance: agent.credit_balance,
      commissionEarned: agent.commission_earned,
      commissionPercent: getAgentCommissionPercent(),
      lastCapitalDepositHtg: agent.last_capital_deposit_htg,
      nextRefillCeilingHtg: nextRefillCeiling(agent.last_capital_deposit_htg),
      refillFeePercent: getRefillFeePercent(),
      refillMinHtg: getRefillMinHtg(),
      pendingDeposits,
      pendingCashouts,
      pendingVip,
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

// Confirme un achat VIP payé en espèces chez l'agent. Contrairement à
// agentConfirmDeposit, ne touche PAS à agents.credit_balance — l'agent n'est qu'un point
// de collecte, le montant est entièrement le revenu de la plateforme (voir vip.js et
// getRevenueSummary dans admin.js). La nouvelle expiration part du plus tardif entre
// maintenant et l'expiration actuelle, pour que renouveler avant l'échéance ajoute bien
// duration_days de plus au lieu de faire repartir le compteur à zéro.
export function agentConfirmVip(userId, body) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const purchase = db.prepare('SELECT * FROM vip_purchases WHERE id = ?').get(id);
  if (!purchase || purchase.agent_id !== agent.id) return { status: 404, data: { error: 'Achat VIP introuvable' } };
  if (purchase.status !== 'pending') return { status: 409, data: { error: `Cet achat VIP est déjà "${purchase.status}"` } };

  const user = db.prepare('SELECT vip_until FROM users WHERE id = ?').get(purchase.user_id);
  const now = new Date();
  const wasActive = !!(user?.vip_until && new Date(user.vip_until).getTime() > now.getTime());
  const base = wasActive ? new Date(user.vip_until) : now;
  const newUntil = new Date(base.getTime() + purchase.duration_days * 24 * 60 * 60 * 1000);
  const newUntilIso = newUntil.toISOString();

  db.prepare("UPDATE vip_purchases SET status = 'confirmed', processed_at = datetime('now') WHERE id = ?").run(id);
  // vip_activated_at ne bouge que si cette confirmation démarre une NOUVELLE période
  // (VIP expiré ou jamais activé) — un renouvellement avant échéance (wasActive) ne la
  // retouche pas, voir la note sur cette colonne dans db.js.
  if (wasActive) {
    db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(newUntilIso, purchase.user_id);
  } else {
    db.prepare('UPDATE users SET vip_until = ?, vip_activated_at = ? WHERE id = ?').run(newUntilIso, now.toISOString(), purchase.user_id);
  }
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(purchase.user_id, 'vip_confirmed', 0, `Abonnement VIP confirmé par l'agent ${agent.agent_code} — valide jusqu'au ${newUntilIso.slice(0, 10)} (code ${purchase.code})`);

  return { status: 200, data: { message: 'Achat VIP confirmé.', vipUntil: newUntilIso } };
}

export function agentRejectVip(userId, body) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };
  const id = parseInt(body?.id, 10);
  if (!id) return { status: 400, data: { error: 'id requis' } };

  const purchase = db.prepare('SELECT * FROM vip_purchases WHERE id = ?').get(id);
  if (!purchase || purchase.agent_id !== agent.id) return { status: 404, data: { error: 'Achat VIP introuvable' } };
  if (purchase.status !== 'pending') return { status: 409, data: { error: `Cet achat VIP est déjà "${purchase.status}"` } };

  db.prepare("UPDATE vip_purchases SET status = 'rejected', processed_at = datetime('now') WHERE id = ?").run(id);
  return { status: 200, data: { message: 'Achat VIP rejeté.' } };
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
  // commission_htg est figée ici (comme platform_fee_htg déjà ailleurs) pour que le
  // filtre "commission par jour" de l'agent (voir getAgentCommissionByDay) reste exact
  // même si AGENT_CASHOUT_COMMISSION_PERCENT change plus tard.
  db.prepare("UPDATE cashouts SET status = 'paid', processed_at = datetime('now'), commission_htg = ? WHERE id = ?").run(commission, id);
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
