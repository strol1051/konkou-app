import crypto from 'node:crypto';
import db from '../db.js';
import { resolveActiveAgentId, getAgentUserId } from './agents.js';
import { notifyUser } from './push.js';

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
// Passé de 50 à 25 HTG/partie (juillet 2026) après une revue de rentabilité — voir le
// changelog dans README.md ("HTG_PER_BONUS_PLAY abaissé...") pour le calcul complet.
// Résumé : le passif potentiel d'une partie bonus (points gagnés, convertibles en HTG
// retirable) reste largement couvert par les 5% de frais de dépôt tant que le taux de
// réussite moyen des joueurs reste sous ~40-47% — au-delà, chaque partie bonus coûte en
// moyenne plus qu'elle ne rapporte de frais.
export function getHtgPerPlay() { return parseFloat(process.env.HTG_PER_BONUS_PLAY || '25'); }
// Combien de points (non retirables — voir postDeposit) 1 HTG net achète (juillet 2026).
// Contrairement à HTG_PER_BONUS_PLAY (HTG requis pour 1 partie), exprimé dans l'autre
// sens car les points s'achètent en petites quantités variables plutôt que par palier fixe.
export function getPointsPerHtgPurchase() { return parseFloat(process.env.POINTS_PER_HTG_PURCHASE || '10'); }
// Frais de service plateforme sur les dépôts (juillet 2026, revue de rentabilité) —
// prélevé sur le montant AVANT de calculer les parties bonus/points accordés ; n'affecte
// pas le crédit débité chez l'agent, qui reçoit toujours le montant brut en espèces.
// Partagé entre les deux types de dépôt (parties bonus et points) — même principe, même
// taux, pas de raison de les traiter différemment.
export function getDepositFeePercent() { return parseFloat(process.env.DEPOSIT_FEE_PERCENT || '5'); }
export function getDepositInfo() {
  return process.env.DEPOSIT_LOCATION_INFO
    || 'Présentez ce code et votre paiement à notre agent pour recevoir vos parties bonus ou vos points.';
}

const r2 = (n) => Math.round(n * 100) / 100;

// Deposited money buys either consumable extra plays OR non-cashable points — in both
// cases it is never convertible back to withdrawable points/cash. This is deliberate:
// cash-in/cash-out on the same balance would make Konkou look like a wagering product,
// which it isn't (see README, "Pourquoi les dépôts ne sont pas retirables"). For points
// specifically: postDeposit itself never touches users.points (crediting only happens on
// confirmation, see agentConfirmDeposit/confirmDeposit) — but whichever code path credits
// it MUST increment users.non_cashable_points by the exact same amount, so that
// routes/wallet.js can permanently exclude purchased points from what a player can cash
// out, no matter how the points balance moves afterward (staking, spending, penalties...).
export function postDeposit(userId, body) {
  const { agentCode } = body || {};
  const agentId = resolveActiveAgentId(agentCode);
  if (!agentId) return { status: 400, data: { error: "Code agent invalide ou agent non actif" } };

  const kind = body?.kind === 'points' ? 'points' : 'plays';

  const amount = parseFloat(body?.htgAmount);
  const min = getMinDeposit();
  const max = getMaxDeposit();
  if (!amount || amount < min || amount > max) {
    return { status: 400, data: { error: `Le dépôt doit être entre ${min} et ${max} HTG` } };
  }

  const feePercent = getDepositFeePercent();
  const platformFeeHtg = r2(amount * feePercent / 100);
  const netHtg = r2(amount - platformFeeHtg);

  let playsGranted = 0;
  let pointsGranted = 0;
  if (kind === 'points') {
    const pointsPerHtg = getPointsPerHtgPurchase();
    pointsGranted = Math.floor(netHtg * pointsPerHtg);
    if (pointsGranted < 1) {
      return { status: 400, data: { error: 'Montant trop faible pour générer des points après frais de service' } };
    }
  } else {
    const htgPerPlay = getHtgPerPlay();
    playsGranted = Math.floor(netHtg / htgPerPlay);
    if (playsGranted < 1) {
      return { status: 400, data: { error: `Montant trop faible pour générer une partie bonus après frais de service (minimum ${htgPerPlay} HTG net par partie)` } };
    }
  }

  const code = generateDepositCode();
  const info = db.prepare(
    "INSERT INTO deposits (user_id, agent_id, htg_amount, plays_granted, points_granted, kind, code, status, platform_fee_htg) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)"
  ).run(userId, agentId, amount, playsGranted, pointsGranted, kind, code, platformFeeHtg);

  // Notifie l'agent assigné (best-effort) — voir le même commentaire dans wallet.js.
  notifyUser(getAgentUserId(agentId), {
    title: 'Konkou — Nouvelle demande de dépôt',
    body: `Un joueur demande un dépôt de ${amount} HTG (code ${code}).`,
    url: '/'
  }).catch(() => {});

  return {
    status: 200,
    data: {
      message: 'Demande de dépôt enregistrée.',
      depositId: info.lastInsertRowid,
      code,
      kind,
      htgAmount: amount,
      feePercent,
      platformFeeHtg,
      netHtg,
      playsGranted,
      pointsGranted,
      depositInfo: getDepositInfo(),
      status: 'pending'
    }
  };
}
