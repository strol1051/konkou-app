import crypto from 'node:crypto';
import db from '../db.js';
import { getMinDeposit, getMaxDeposit, getHtgPerPlay, getDepositInfo } from './deposits.js';
import { resolveActiveAgentId } from './agents.js';

function getRate() { return parseFloat(process.env.POINTS_TO_HTG_RATE || '0.08'); }
function getMinCashoutHtg() { return parseFloat(process.env.MIN_CASHOUT_HTG || '500'); }
function getMaxDailyCashoutHtg() { return parseFloat(process.env.MAX_DAILY_CASHOUT_HTG || '10000'); }
function getPickupInfo() { return process.env.PICKUP_LOCATION_INFO || 'Présentez ce code à notre point de retrait pour recevoir votre argent en espèces.'; }

// Tiered service fee, taken as pure platform revenue on top of the (unchanged) 10%
// agent commission — it reduces what the user receives in cash, not what the agent
// earns or how many points get deducted. Configurable via env so the tiers/rates can
// be tuned without a code change.
function getCashoutFeePercent(htgAmount) {
  const tier1Max = parseFloat(process.env.CASHOUT_FEE_TIER1_MAX_HTG || '2000');
  const tier2Max = parseFloat(process.env.CASHOUT_FEE_TIER2_MAX_HTG || '5000');
  const tier1Percent = parseFloat(process.env.CASHOUT_FEE_TIER1_PERCENT || '5');
  const tier2Percent = parseFloat(process.env.CASHOUT_FEE_TIER2_PERCENT || '6');
  const tier3Percent = parseFloat(process.env.CASHOUT_FEE_TIER3_PERCENT || '8');
  if (htgAmount <= tier1Max) return tier1Percent;
  if (htgAmount <= tier2Max) return tier2Percent;
  return tier3Percent; // covers 5001–10000 HTG, and anything above as a sane fallback
}

// Excludes visually-ambiguous characters (0/O, 1/I/L) since this code is meant to be
// read aloud or copied by hand at a physical pickup point.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generatePickupCode() {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Sum of today's cashout requests that still count against the daily cap. Rejected
// requests are excluded — they never actually paid out, and their points were refunded.
function todayCashoutHtg(userId) {
  return db.prepare(
    `SELECT COALESCE(SUM(htg_amount), 0) as total FROM cashouts
     WHERE user_id = ? AND status != 'rejected' AND date(requested_at) = date('now')`
  ).get(userId).total;
}

export function getWallet(userId) {
  const user = db.prepare('SELECT points, bonus_plays FROM users WHERE id = ?').get(userId);
  const transactions = db.prepare(
    'SELECT id, type, amount, note, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50'
  ).all(userId);
  const cashouts = db.prepare(
    'SELECT id, points, htg_amount, platform_fee_htg, net_payout_htg, method, payout_info, status, requested_at, processed_at FROM cashouts WHERE user_id = ? ORDER BY id DESC'
  ).all(userId);
  const deposits = db.prepare(
    'SELECT id, htg_amount, plays_granted, code, status, requested_at, processed_at FROM deposits WHERE user_id = ? ORDER BY id DESC'
  ).all(userId);
  const rate = getRate();
  const maxDaily = getMaxDailyCashoutHtg();
  const usedToday = todayCashoutHtg(userId);

  return {
    status: 200,
    data: {
      points: user.points,
      htgValue: Math.round(user.points * rate * 100) / 100,
      rate,
      minCashoutHtg: getMinCashoutHtg(),
      maxDailyCashoutHtg: maxDaily,
      dailyCashoutUsedHtg: usedToday,
      dailyCashoutRemainingHtg: Math.max(0, Math.round((maxDaily - usedToday) * 100) / 100),
      pickupInfo: getPickupInfo(),
      transactions,
      cashouts,
      bonusPlays: user.bonus_plays,
      minDepositHtg: getMinDeposit(),
      maxDepositHtg: getMaxDeposit(),
      htgPerBonusPlay: getHtgPerPlay(),
      depositInfo: getDepositInfo(),
      deposits,
      cashoutFeeTiers: [
        { maxHtg: parseFloat(process.env.CASHOUT_FEE_TIER1_MAX_HTG || '2000'), percent: parseFloat(process.env.CASHOUT_FEE_TIER1_PERCENT || '5') },
        { maxHtg: parseFloat(process.env.CASHOUT_FEE_TIER2_MAX_HTG || '5000'), percent: parseFloat(process.env.CASHOUT_FEE_TIER2_PERCENT || '6') },
        { maxHtg: null, percent: parseFloat(process.env.CASHOUT_FEE_TIER3_PERCENT || '8') }
      ]
    }
  };
}

export function postCashout(userId, body) {
  const { points, agentCode } = body || {};
  const agentId = resolveActiveAgentId(agentCode);
  if (!agentId) return { status: 400, data: { error: "Code agent invalide ou agent non actif" } };

  const pts = parseInt(points, 10);
  const rate = getRate();
  const minCashoutHtg = getMinCashoutHtg();
  const maxDailyHtg = getMaxDailyCashoutHtg();

  if (!pts || pts <= 0) return { status: 400, data: { error: 'Montant de points invalide' } };

  const htgAmount = Math.round(pts * rate * 100) / 100;

  if (htgAmount < minCashoutHtg) {
    return { status: 400, data: { error: `Retrait minimum : ${minCashoutHtg} HTG (soit ${Math.ceil(minCashoutHtg / rate)} pts)` } };
  }

  const user = db.prepare('SELECT points, phone_verified FROM users WHERE id = ?').get(userId);
  if (!user.phone_verified) {
    return { status: 403, data: { error: 'Vérifiez votre numéro de téléphone avant de demander un retrait' } };
  }
  if (user.points < pts) return { status: 400, data: { error: 'Solde de points insuffisant' } };

  const usedToday = todayCashoutHtg(userId);
  if (usedToday + htgAmount > maxDailyHtg) {
    const remaining = Math.max(0, Math.round((maxDailyHtg - usedToday) * 100) / 100);
    return {
      status: 400,
      data: { error: `Limite de retrait quotidienne dépassée (max ${maxDailyHtg} HTG/jour chez l'agent). Il vous reste ${remaining} HTG aujourd'hui.` }
    };
  }

  const code = generatePickupCode();
  const feePercent = getCashoutFeePercent(htgAmount);
  const platformFeeHtg = Math.round(htgAmount * feePercent / 100 * 100) / 100;
  const netPayoutHtg = Math.round((htgAmount - platformFeeHtg) * 100) / 100;

  db.prepare('UPDATE users SET points = points - ? WHERE id = ?').run(pts, userId);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(userId, 'cashout_request', -pts, `Demande de retrait — code ${code} (frais de service ${feePercent}%)`);
  const info = db.prepare(
    `INSERT INTO cashouts (user_id, agent_id, points, htg_amount, platform_fee_htg, net_payout_htg, method, payout_info, status)
     VALUES (?, ?, ?, ?, ?, ?, 'cash_pickup', ?, 'pending')`
  ).run(userId, agentId, pts, htgAmount, platformFeeHtg, netPayoutHtg, code);

  return {
    status: 200,
    data: {
      message: 'Demande de retrait enregistrée.',
      cashoutId: info.lastInsertRowid,
      code,
      htgAmount,
      feePercent,
      platformFeeHtg,
      netPayoutHtg,
      pickupInfo: getPickupInfo(),
      status: 'pending'
    }
  };
}
