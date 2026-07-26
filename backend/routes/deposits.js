import crypto from 'node:crypto';
import db from '../db.js';
import { resolveActiveAgentId } from './agents.js';

// Excludes visually-ambiguous characters (0/O, 1/I/L), same alphabet as cash-pickup
// codes since this one is also read aloud/copied by hand at the agent.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateDepositCode() {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function getMinDeposit() { return parseFloat(process.env.MIN_DEPOSIT_HTG || '100'); }
export function getMaxDeposit() { return parseFloat(process.env.MAX_DEPOSIT_HTG || '2500'); }
export function getHtgPerPlay() { return parseFloat(process.env.HTG_PER_BONUS_PLAY || '50'); }
// Frais de service plateforme sur les dépôts (juillet 2026, revue de rentabilité) —
// prélevé sur le montant AVANT de calculer les parties bonus accordées ; n'affecte pas le
// crédit débité chez l'agent, qui reçoit toujours le montant brut en espèces.
export function getDepositFeePercent() { return parseFloat(process.env.DEPOSIT_FEE_PERCENT || '5'); }
export function getDepositInfo() {
  return process.env.DEPOSIT_LOCATION_INFO
    || 'Présentez ce code et votre paiement à notre agent pour recevoir vos parties bonus.';
}

const r2 = (n) => Math.round(n * 100) / 100;

// Deposited money buys consumable extra plays only — it is never convertible back to
// withdrawable points/cash. This is deliberate: cash-in/cash-out on the same balance
// would make Konkou look like a wagering product, which it isn't (see README).
export function postDeposit(userId, body) {
  const { agentCode } = body || {};
  const agentId = resolveActiveAgentId(agentCode);
  if (!agentId) return { status: 400, data: { error: "Code agent invalide ou agent non actif" } };

  const amount = parseFloat(body?.htgAmount);
  const min = getMinDeposit();
  const max = getMaxDeposit();
  if (!amount || amount < min || amount > max) {
    return { status: 400, data: { error: `Le dépôt doit être entre ${min} et ${max} HTG` } };
  }

  const feePercent = getDepositFeePercent();
  const platformFeeHtg = r2(amount * feePercent / 100);
  const netHtg = r2(amount - platformFeeHtg);

  const htgPerPlay = getHtgPerPlay();
  const playsGranted = Math.floor(netHtg / htgPerPlay);
  if (playsGranted < 1) {
    return { status: 400, data: { error: `Montant trop faible pour générer une partie bonus après frais de service (minimum ${htgPerPlay} HTG net par partie)` } };
  }

  const code = generateDepositCode();
  const info = db.prepare(
    "INSERT INTO deposits (user_id, agent_id, htg_amount, plays_granted, code, status, platform_fee_htg) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
  ).run(userId, agentId, amount, playsGranted, code, platformFeeHtg);

  return {
    status: 200,
    data: {
      message: 'Demande de dépôt enregistrée.',
      depositId: info.lastInsertRowid,
      code,
      htgAmount: amount,
      feePercent,
      platformFeeHtg,
      netHtg,
      playsGranted,
      depositInfo: getDepositInfo(),
      status: 'pending'
    }
  };
}
