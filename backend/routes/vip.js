import crypto from 'node:crypto';
import db from '../db.js';
import { resolveActiveAgentId } from './agents.js';

// Même alphabet que les codes de dépôt/retrait — lu à voix haute ou recopié à la main
// chez l'agent, donc pas de caractères ambigus (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateVipCode() {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function getVipPriceHtg() { return parseFloat(process.env.VIP_PRICE_HTG || '300'); }
export function getVipDurationDays() { return parseInt(process.env.VIP_DURATION_DAYS || '30', 10); }
export function getVipExtraDailyPlays() { return parseInt(process.env.VIP_EXTRA_DAILY_PLAYS || '10', 10); }

// True si ce joueur a un abonnement VIP en cours (vip_until dans le futur). Utilisé par
// routes/games.js (playAllowance) pour accorder des parties gratuites supplémentaires.
export function isVipActive(userId) {
  const u = db.prepare('SELECT vip_until FROM users WHERE id = ?').get(userId);
  if (!u || !u.vip_until) return false;
  return new Date(u.vip_until).getTime() > Date.now();
}

export function getVipStatus(userId) {
  const u = db.prepare('SELECT vip_until FROM users WHERE id = ?').get(userId);
  const active = isVipActive(userId);
  const pending = db.prepare(
    `SELECT id, amount_htg, duration_days, code, requested_at FROM vip_purchases WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`
  ).get(userId);
  const history = db.prepare(
    `SELECT id, amount_htg, duration_days, status, requested_at, processed_at FROM vip_purchases WHERE user_id = ? ORDER BY id DESC LIMIT 20`
  ).all(userId);

  return {
    status: 200,
    data: {
      active,
      vipUntil: u?.vip_until || null,
      priceHtg: getVipPriceHtg(),
      durationDays: getVipDurationDays(),
      extraDailyPlays: getVipExtraDailyPlays(),
      pending: pending || null,
      history
    }
  };
}

// Achat VIP en espèces chez un agent, même flux qu'un dépôt (code + confirmation en
// personne) — mais contrairement à un dépôt, le montant n'est PAS déduit du crédit
// revendable de l'agent : c'est un produit propre à la plateforme (voir vip_purchases
// dans db.js), l'agent n'étant qu'un point de collecte du paiement à remettre hors app.
export function requestVip(userId, body) {
  const { agentCode } = body || {};
  const agentId = resolveActiveAgentId(agentCode);
  if (!agentId) return { status: 400, data: { error: "Code agent invalide ou agent non actif" } };

  const existingPending = db.prepare(
    `SELECT id FROM vip_purchases WHERE user_id = ? AND status = 'pending'`
  ).get(userId);
  if (existingPending) {
    return { status: 409, data: { error: 'Vous avez déjà une demande VIP en attente' } };
  }

  const amount = getVipPriceHtg();
  const durationDays = getVipDurationDays();
  const code = generateVipCode();

  const info = db.prepare(
    `INSERT INTO vip_purchases (user_id, agent_id, amount_htg, duration_days, code, status) VALUES (?, ?, ?, ?, ?, 'pending')`
  ).run(userId, agentId, amount, durationDays, code);

  return {
    status: 200,
    data: {
      message: 'Demande VIP enregistrée.',
      vipPurchaseId: info.lastInsertRowid,
      code,
      amountHtg: amount,
      durationDays,
      status: 'pending'
    }
  };
}
