import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db from '../db.js';
import { getActiveThemeKey } from './theme.js';
import { isVipActive, getVipExtraDailyPlays } from './vip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allQuestions = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/questions.json'), 'utf-8'));

// Questions saisonnières (voir "Banque de questions" dans README.md) : une question sans
// champ "theme" est générale et toujours piochable ; une question avec un "theme" (ex.
// "noel") ne rejoint le pool que lorsque ce thème est le thème actif de l'app (choisi par
// l'admin dans /admin.html → Réglages — voir routes/theme.js). Les questions saisonnières
// s'ajoutent donc au pool général sans jamais le remplacer : un joueur voit toujours
// principalement des questions générales, avec quelques questions de saison mélangées
// dedans pendant la période concernée.
function questionPool() {
  const activeTheme = getActiveThemeKey();
  return allQuestions.filter(q => !q.theme || q.theme === activeTheme);
}

const activeSessions = new Map(); // sessionToken -> { userId, gameType, correctAnswers, createdAt }
// Corrigé (juillet 2026, revue de rentabilité) : relevée de 5 à 30 en juillet 2026 pour
// rendre le jeu plus attractif, puis redescendue à 15 — 30 exposait la plateforme à un
// passif de paiement trop élevé par joueur très actif (jusqu'à ~2940 points/jour possibles
// avec un score parfait aux deux jeux, soit ~235 HTG/jour de valeur retirable pour un seul
// joueur). Redescendue une seconde fois à 10 (toujours juillet 2026) pour réduire encore
// ce plafond — voir "Comment Konkou génère du revenu" dans README.md.
const DAILY_LIMIT = 10;
const POINTS_PER_CORRECT_TRIVIA = 10;
const POINTS_PER_CORRECT_PUZZLE = 6;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min: a game started but never submitted is abandoned

// Limite de temps visible par partie (juillet 2026) : un compte à rebours s'affiche
// côté joueur (voir frontend/app.js) et soumet automatiquement les réponses déjà données
// à l'expiration (les questions restantes comptent comme fausses, voir STAKE_TIMEOUT_LOSS
// _PERCENT ci-dessous pour la pénalité de mise associée). Même durée pour les deux jeux,
// à la demande explicite — initialement 60s pour le quiz, ramenée à 45s pour rester
// cohérente avec le sprint de calcul, puis resserrée une seconde fois à 30s.
const TRIVIA_TIME_LIMIT_SECONDS = 30;
const PUZZLE_TIME_LIMIT_SECONDS = 30;
// Marge de tolérance côté serveur entre la fin du compte à rebours et la réception de la
// soumission automatique (latence réseau, onglet mis en arrière-plan par le navigateur...).
// Au-delà de limite + marge depuis le début de la partie, la soumission est refusée — ça
// empêche un joueur de manipuler son navigateur (pause du timer, appel direct à l'API bien
// après le compte à rebours affiché) pour gagner plus de temps que prévu.
const SUBMIT_TIME_MARGIN_MS = 10 * 1000;

// Mise optionnelle : le joueur engage entre STAKE_MIN et STAKE_MAX points (dans la limite
// de son solde) avant de jouer. Le résultat de la partie fait varier cette mise selon le
// score, de façon continue (pas de seuil de réussite/échec net) :
//   ratio = bonnes réponses / total   →   multiplicateur = 0.25 + 0.85 × ratio
// Un score de 0% renvoie 25% de la mise (perte de 75%), un score de 100% renvoie 110% de
// la mise (gain de 10%). Ce mécanisme est distinct et s'ajoute aux points normaux gagnés
// par bonne réponse (POINTS_PER_CORRECT_*), qui ne changent pas — voir "Mise sur sa
// performance" dans README.md pour l'avertissement légal : contrairement au reste de
// l'app, ceci met réellement des points (donc de la valeur HTG retirable) en jeu selon un
// résultat, ce qui s'apparente à un pari.
// Corrigé (juillet 2026, revue de rentabilité) : la fourchette était ±30% (0.7 à 1.3), puis
// resserrée à ±15% (0.85 à 1.15, point d'équilibre à 50% de bonnes réponses). Rendue
// volontairement asymétrique ensuite (-75% à +10%, ce commentaire) — le point d'équilibre
// (où la mise ne change pas) n'est donc plus à 50% mais à ratio = 0.75/0.85 ≈ 88.2% de
// bonnes réponses : sous ce score, la mise est perdante, même si le score reste honorable.
// C'est un choix délibéré qui alourdit nettement le risque du côté du joueur — à surveiller
// si le taux de mise chute après ce changement (les joueurs pourraient arrêter de miser).
const STAKE_MIN = 100;
const STAKE_MAX = 2500;

function stakeMultiplier(correctCount, total) {
  const ratio = total > 0 ? correctCount / total : 0;
  return 0.25 + 0.85 * ratio;
}

// Pénalité sur partie SANS mise (juillet 2026) : jouer gratuitement n'est plus totalement
// sans risque pour le solde — un score perdant (moins de la moitié de bonnes réponses, ou
// un timeout) coûte 30% du solde de points du joueur, en plus de ne rapporter aucun/peu de
// points via POINTS_PER_CORRECT_*. Contrairement à la mise (qui ne fait varier QUE le
// montant engagé volontairement), cette pénalité s'applique au solde entier et n'est pas
// optionnelle — voir scoreOutcome et applyNoStakePenalty ci-dessous. Le seuil "perdant"
// (ratio < 0.5, indépendant de la formule de mise ci-dessus depuis qu'elle est devenue
// asymétrique) : en dessous de la moitié de bonnes réponses, on considère la partie perdue.
const NO_STAKE_LOSS_PERCENT = 30;
// Un solde à ce niveau ou en dessous bloque les parties gratuites (quotidien inclus) : le
// joueur ne peut plus jouer qu'avec une partie bonus (achetée via dépôt chez l'agent, voir
// routes/deposits.js) — voir playAllowance ci-dessous.
const MIN_POINTS_TO_PLAY_FREE = 50;

// Pénalité de temps écoulé (juillet 2026) : contrairement à un score simplement mauvais
// (qui suit la formule continue ±15% ci-dessus), une partie qui expire est traitée comme
// une partie perdue — 0 point gagné quel que soit ce qui avait déjà été répondu
// correctement, et une perte fixe de STAKE_TIMEOUT_LOSS_PERCENT % de la mise (au lieu de la
// formule normale) si une mise était engagée. Cette distinction est volontaire : laisser
// filer le temps ne doit jamais être une stratégie neutre ou avantageuse.
const STAKE_TIMEOUT_LOSS_PERCENT = 50;

// Valide une mise optionnelle fournie en query string (chaîne ou undefined/null).
// Retourne { stake: 0 } si aucune mise n'est demandée, ou { error } si elle est invalide.
function validateStake(rawStake, userId) {
  if (rawStake === undefined || rawStake === null || rawStake === '') return { stake: 0 };
  const stake = parseInt(rawStake, 10);
  if (!Number.isInteger(stake) || String(stake) !== String(rawStake).trim()) {
    return { error: 'Mise invalide' };
  }
  if (stake < STAKE_MIN || stake > STAKE_MAX) {
    return { error: `La mise doit être comprise entre ${STAKE_MIN} et ${STAKE_MAX} points` };
  }
  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  if (!user || stake > user.points) {
    return { error: `Solde insuffisant pour cette mise (solde actuel : ${user ? user.points : 0} points)` };
  }
  return { stake };
}

// Prototype-scope in-memory sessions have no persistence across restarts and would
// otherwise grow unbounded if users start games without finishing them. Sweep periodically.
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions) {
    if (now - session.createdAt > SESSION_TTL_MS) activeSessions.delete(token);
  }
}, 5 * 60 * 1000).unref();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function todayCount(userId, gameType) {
  return db.prepare(
    `SELECT COUNT(*) as c FROM game_sessions WHERE user_id = ? AND game_type = ? AND date(played_at) = date('now')`
  ).get(userId, gameType).c;
}

// Once the free daily limit is reached, a user can still play by spending a bonus play
// (bought by depositing cash at the agent — see routes/deposits.js). VIP (voir vip.js)
// relève ce plafond gratuit de VIP_EXTRA_DAILY_PLAYS parties, sans toucher aux parties
// bonus (les deux avantages se cumulent).
function playAllowance(userId, gameType) {
  const playedToday = todayCount(userId, gameType);
  const effectiveLimit = DAILY_LIMIT + (isVipActive(userId) ? getVipExtraDailyPlays() : 0);
  const user = db.prepare('SELECT points, bonus_plays FROM users WHERE id = ?').get(userId);
  // En dessous du seuil, aucune partie gratuite (même dans le quota quotidien) : il faut
  // dépenser une partie bonus, achetée via dépôt chez l'agent.
  const belowMinPoints = !user || user.points <= MIN_POINTS_TO_PLAY_FREE;

  if (playedToday < effectiveLimit && !belowMinPoints) {
    return { allowed: true, usingBonus: false, playedToday, effectiveLimit };
  }
  if (!user || user.bonus_plays < 1) {
    return {
      allowed: false,
      error: belowMinPoints
        ? `Solde de points trop faible (${user ? user.points : 0} pts, minimum ${MIN_POINTS_TO_PLAY_FREE} requis pour jouer gratuitement) — déposez chez l'agent pour obtenir des parties bonus.`
        : `Limite quotidienne atteinte (${effectiveLimit} parties/jour). Revenez demain, devenez VIP, ou déposez chez l'agent pour des parties bonus.`
    };
  }
  return { allowed: true, usingBonus: true, playedToday, effectiveLimit };
}

export function getTrivia(userId, rawStake) {
  const allowance = playAllowance(userId, 'trivia');
  if (!allowance.allowed) return { status: 429, data: { error: allowance.error } };

  const stakeCheck = validateStake(rawStake, userId);
  if (stakeCheck.error) return { status: 400, data: { error: stakeCheck.error } };

  const picked = shuffle(questionPool()).slice(0, 5);
  const sessionToken = crypto.randomBytes(12).toString('hex');
  activeSessions.set(sessionToken, {
    userId, gameType: 'trivia', correctAnswers: picked.map(q => q.answer),
    createdAt: Date.now(), usingBonus: allowance.usingBonus, stake: stakeCheck.stake,
    timeLimitSeconds: TRIVIA_TIME_LIMIT_SECONDS
  });
  return {
    status: 200,
    data: {
      sessionToken,
      questions: picked.map(q => ({ id: q.id, question: q.question, choices: q.choices })),
      remainingPlaysToday: allowance.usingBonus ? allowance.effectiveLimit - allowance.playedToday : allowance.effectiveLimit - allowance.playedToday - 1,
      usingBonusPlay: allowance.usingBonus,
      stake: stakeCheck.stake,
      timeLimitSeconds: TRIVIA_TIME_LIMIT_SECONDS
    }
  };
}

// Rejette une soumission arrivée trop longtemps après le début de la partie (voir
// SUBMIT_TIME_MARGIN_MS) — anti-triche pour le compte à rebours affiché côté joueur, qui
// n'a de valeur que si le serveur la fait aussi respecter.
function checkNotExpired(session) {
  const allowedMs = session.timeLimitSeconds * 1000 + SUBMIT_TIME_MARGIN_MS;
  return (Date.now() - session.createdAt) <= allowedMs;
}

// Calcule le score/points/mise d'une soumission — partagé par submitTrivia et
// submitPuzzle. timedOutFlag vient du client (envoyé uniquement par l'auto-soumission à
// l'expiration du minuteur, voir frontend/app.js) mais n'est honoré que si le serveur
// confirme indépendamment que le temps annoncé de la session est bien dépassé : un client
// qui mentirait pour ÉVITER la pénalité (en omettant le flag après un vrai timeout) reste
// bloqué par la limite dure de checkNotExpired plus haut ; un flag erroné/prématuré qui
// arriverait alors que le temps n'est pas réellement écoulé est ignoré, sans pénaliser le
// joueur à tort.
function scoreOutcome(session, answers, timedOutFlag, pointsPerCorrect) {
  let correctCount = 0;
  session.correctAnswers.forEach((correct, i) => { if (Number(answers[i]) === correct) correctCount++; });
  const total = session.correctAnswers.length;

  const isTimeout = !!timedOutFlag && (Date.now() - session.createdAt) > session.timeLimitSeconds * 1000;
  const pointsEarned = isTimeout ? 0 : correctCount * pointsPerCorrect;

  let stakeResult = 0, stakeDelta = 0;
  if (session.stake > 0) {
    if (isTimeout) {
      stakeDelta = -Math.round(session.stake * STAKE_TIMEOUT_LOSS_PERCENT / 100);
      stakeResult = session.stake + stakeDelta;
    } else {
      const multiplier = stakeMultiplier(correctCount, total);
      stakeResult = Math.round(session.stake * multiplier);
      stakeDelta = stakeResult - session.stake;
    }
  }

  // "Perdu" pour une partie SANS mise : timeout, ou moins de la moitié de bonnes réponses
  // (même seuil que le point d'équilibre de la formule de mise ci-dessus). N'a d'effet que
  // si session.stake === 0 — voir applyNoStakePenalty, appelé séparément par les routes
  // submit* une fois le solde à jour avec pointsEarned.
  const lostWithoutStake = session.stake === 0 && (isTimeout || (total > 0 && correctCount / total < 0.5));

  return { correctCount, total, pointsEarned, stakeResult, stakeDelta, isTimeout, lostWithoutStake };
}

// Applique la pénalité de 30% (NO_STAKE_LOSS_PERCENT) au solde de points actuel du joueur
// quand une partie sans mise est perdue — voir la note sur NO_STAKE_LOSS_PERCENT plus haut.
// Appelée après que pointsEarned ait déjà été crédité, donc la pénalité porte bien sur le
// solde "après cette partie", comme le fait la mise sur son propre montant. Retourne le
// montant déduit (0 si aucune pénalité), pour que l'appelant puisse l'inclure dans la
// réponse et la transaction associée.
function applyNoStakePenalty(userId, lostWithoutStake, gameTypeNote) {
  if (!lostWithoutStake) return 0;
  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  const penalty = Math.round((user?.points || 0) * NO_STAKE_LOSS_PERCENT / 100);
  if (penalty <= 0) return 0;
  db.prepare('UPDATE users SET points = max(0, points - ?) WHERE id = ?').run(penalty, userId);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(userId, 'loss_no_stake', -penalty, `Partie ${gameTypeNote} perdue sans mise — -${NO_STAKE_LOSS_PERCENT}% du solde (-${penalty} pts)`);
  return penalty;
}

export function submitTrivia(userId, body) {
  const { sessionToken, answers, timedOut } = body || {};
  const session = activeSessions.get(sessionToken);
  if (!session || session.userId !== userId || session.gameType !== 'trivia') {
    return { status: 400, data: { error: 'Session de jeu invalide ou expirée' } };
  }
  if (!checkNotExpired(session)) {
    activeSessions.delete(sessionToken);
    return { status: 400, data: { error: 'Temps écoulé pour cette partie — trop de temps s\'est écoulé depuis le début.' } };
  }
  if (!Array.isArray(answers) || answers.length !== session.correctAnswers.length) {
    return { status: 400, data: { error: 'Réponses invalides' } };
  }

  const { correctCount, total, pointsEarned, stakeResult, stakeDelta, isTimeout, lostWithoutStake } =
    scoreOutcome(session, answers, timedOut, POINTS_PER_CORRECT_TRIVIA);

  db.prepare('INSERT INTO game_sessions (user_id, game_type, score, points_earned) VALUES (?, ?, ?, ?)')
    .run(userId, 'trivia', correctCount, pointsEarned);
  if (pointsEarned > 0) {
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(pointsEarned, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
      .run(userId, 'earn_trivia', pointsEarned, `${correctCount}/${total} bonnes réponses`);
  }

  if (session.stake > 0) {
    // max(0, ...) : garde-fou pour ne jamais faire passer le solde sous zéro, même en cas
    // de mises concurrentes sur plusieurs sessions dépassant le solde initial validé.
    db.prepare('UPDATE users SET points = max(0, points + ?) WHERE id = ?').run(stakeDelta, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
      .run(userId, 'stake_trivia', stakeDelta, isTimeout
        ? `Mise de ${session.stake} pts perdue à ${STAKE_TIMEOUT_LOSS_PERCENT}% (temps écoulé) → ${stakeResult} pts (${stakeDelta})`
        : `Mise de ${session.stake} pts (${correctCount}/${total}) → ${stakeResult} pts (${stakeDelta >= 0 ? '+' : ''}${stakeDelta})`);
  }

  const noStakePenalty = applyNoStakePenalty(userId, lostWithoutStake, 'de quiz');

  if (session.usingBonus) {
    db.prepare('UPDATE users SET bonus_plays = bonus_plays - 1 WHERE id = ? AND bonus_plays > 0').run(userId);
  }
  activeSessions.delete(sessionToken);
  const user = db.prepare('SELECT points, bonus_plays FROM users WHERE id = ?').get(userId);
  return {
    status: 200,
    data: {
      correctCount, total, pointsEarned, timedOut: isTimeout,
      stake: session.stake, stakeResult, stakeDelta, noStakePenalty,
      newBalance: user.points, bonusPlays: user.bonus_plays
    }
  };
}

export function getPuzzle(userId, rawStake) {
  const allowance = playAllowance(userId, 'puzzle');
  if (!allowance.allowed) return { status: 429, data: { error: allowance.error } };

  const stakeCheck = validateStake(rawStake, userId);
  if (stakeCheck.error) return { status: 400, data: { error: stakeCheck.error } };

  const ops = ['+', '-', '×'];
  const problems = [];
  const correctAnswers = [];
  for (let i = 0; i < 8; i++) {
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a = Math.floor(Math.random() * 12) + 1;
    let b = Math.floor(Math.random() * 12) + 1;
    let answer;
    if (op === '+') answer = a + b;
    else if (op === '-') { if (b > a) [a, b] = [b, a]; answer = a - b; }
    else answer = a * b;
    problems.push({ id: i, text: `${a} ${op} ${b}` });
    correctAnswers.push(answer);
  }
  const sessionToken = crypto.randomBytes(12).toString('hex');
  activeSessions.set(sessionToken, {
    userId, gameType: 'puzzle', correctAnswers, createdAt: Date.now(), usingBonus: allowance.usingBonus, stake: stakeCheck.stake,
    timeLimitSeconds: PUZZLE_TIME_LIMIT_SECONDS
  });
  return {
    status: 200,
    data: {
      sessionToken, problems,
      remainingPlaysToday: allowance.usingBonus ? allowance.effectiveLimit - allowance.playedToday : allowance.effectiveLimit - allowance.playedToday - 1,
      timeLimitSeconds: PUZZLE_TIME_LIMIT_SECONDS,
      usingBonusPlay: allowance.usingBonus,
      stake: stakeCheck.stake
    }
  };
}

export function submitPuzzle(userId, body) {
  const { sessionToken, answers, timedOut } = body || {};
  const session = activeSessions.get(sessionToken);
  if (!session || session.userId !== userId || session.gameType !== 'puzzle') {
    return { status: 400, data: { error: 'Session de jeu invalide ou expirée' } };
  }
  if (!checkNotExpired(session)) {
    activeSessions.delete(sessionToken);
    return { status: 400, data: { error: 'Temps écoulé pour cette partie — trop de temps s\'est écoulé depuis le début.' } };
  }
  if (!Array.isArray(answers) || answers.length !== session.correctAnswers.length) {
    return { status: 400, data: { error: 'Réponses invalides' } };
  }

  const { correctCount, total, pointsEarned, stakeResult, stakeDelta, isTimeout, lostWithoutStake } =
    scoreOutcome(session, answers, timedOut, POINTS_PER_CORRECT_PUZZLE);

  db.prepare('INSERT INTO game_sessions (user_id, game_type, score, points_earned) VALUES (?, ?, ?, ?)')
    .run(userId, 'puzzle', correctCount, pointsEarned);
  if (pointsEarned > 0) {
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(pointsEarned, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
      .run(userId, 'earn_puzzle', pointsEarned, `${correctCount}/${total} calculs corrects`);
  }

  if (session.stake > 0) {
    db.prepare('UPDATE users SET points = max(0, points + ?) WHERE id = ?').run(stakeDelta, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
      .run(userId, 'stake_puzzle', stakeDelta, isTimeout
        ? `Mise de ${session.stake} pts perdue à ${STAKE_TIMEOUT_LOSS_PERCENT}% (temps écoulé) → ${stakeResult} pts (${stakeDelta})`
        : `Mise de ${session.stake} pts (${correctCount}/${total}) → ${stakeResult} pts (${stakeDelta >= 0 ? '+' : ''}${stakeDelta})`);
  }

  const noStakePenalty = applyNoStakePenalty(userId, lostWithoutStake, 'de calcul');

  if (session.usingBonus) {
    db.prepare('UPDATE users SET bonus_plays = bonus_plays - 1 WHERE id = ? AND bonus_plays > 0').run(userId);
  }
  activeSessions.delete(sessionToken);
  const user = db.prepare('SELECT points, bonus_plays FROM users WHERE id = ?').get(userId);
  return {
    status: 200,
    data: {
      correctCount, total, pointsEarned, timedOut: isTimeout,
      stake: session.stake, stakeResult, stakeDelta, noStakePenalty,
      newBalance: user.points, bonusPlays: user.bonus_plays
    }
  };
}
