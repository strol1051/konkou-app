import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allQuestions = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/questions.json'), 'utf-8'));

const activeSessions = new Map(); // sessionToken -> { userId, gameType, correctAnswers, createdAt }
const DAILY_LIMIT = 30;
const POINTS_PER_CORRECT_TRIVIA = 10;
const POINTS_PER_CORRECT_PUZZLE = 6;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min: a game started but never submitted is abandoned

// Mise optionnelle : le joueur engage entre STAKE_MIN et STAKE_MAX points (dans la limite
// de son solde) avant de jouer. Le résultat de la partie fait varier cette mise de ±30%
// selon le score, de façon continue (pas de seuil de réussite/échec net) :
//   ratio = bonnes réponses / total   →   multiplicateur = 0.7 + 0.6 × ratio
// Un score de 0% renvoie 70% de la mise (perte de 30%), un score de 100% renvoie 130% de
// la mise (gain de 30%), un score de 50% rend la mise inchangée. Ce mécanisme est distinct
// et s'ajoute aux points normaux gagnés par bonne réponse (POINTS_PER_CORRECT_*), qui ne
// changent pas — voir "Mise sur sa performance" dans README.md pour l'avertissement légal :
// contrairement au reste de l'app, ceci met réellement des points (donc de la valeur HTG
// retirable) en jeu selon un résultat, ce qui s'apparente à un pari.
const STAKE_MIN = 100;
const STAKE_MAX = 2500;

function stakeMultiplier(correctCount, total) {
  const ratio = total > 0 ? correctCount / total : 0;
  return 0.7 + 0.6 * ratio;
}

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
// (bought by depositing cash at the agent — see routes/deposits.js).
function playAllowance(userId, gameType) {
  const playedToday = todayCount(userId, gameType);
  if (playedToday < DAILY_LIMIT) return { allowed: true, usingBonus: false, playedToday };
  const user = db.prepare('SELECT bonus_plays FROM users WHERE id = ?').get(userId);
  if (!user || user.bonus_plays < 1) {
    return {
      allowed: false,
      error: `Limite quotidienne atteinte (${DAILY_LIMIT} parties/jour). Revenez demain, ou déposez chez l'agent pour des parties bonus.`
    };
  }
  return { allowed: true, usingBonus: true, playedToday };
}

export function getTrivia(userId, rawStake) {
  const allowance = playAllowance(userId, 'trivia');
  if (!allowance.allowed) return { status: 429, data: { error: allowance.error } };

  const stakeCheck = validateStake(rawStake, userId);
  if (stakeCheck.error) return { status: 400, data: { error: stakeCheck.error } };

  const picked = shuffle(allQuestions).slice(0, 5);
  const sessionToken = crypto.randomBytes(12).toString('hex');
  activeSessions.set(sessionToken, {
    userId, gameType: 'trivia', correctAnswers: picked.map(q => q.answer),
    createdAt: Date.now(), usingBonus: allowance.usingBonus, stake: stakeCheck.stake
  });
  return {
    status: 200,
    data: {
      sessionToken,
      questions: picked.map(q => ({ id: q.id, question: q.question, choices: q.choices })),
      remainingPlaysToday: allowance.usingBonus ? DAILY_LIMIT - allowance.playedToday : DAILY_LIMIT - allowance.playedToday - 1,
      usingBonusPlay: allowance.usingBonus,
      stake: stakeCheck.stake
    }
  };
}

export function submitTrivia(userId, body) {
  const { sessionToken, answers } = body || {};
  const session = activeSessions.get(sessionToken);
  if (!session || session.userId !== userId || session.gameType !== 'trivia') {
    return { status: 400, data: { error: 'Session de jeu invalide ou expirée' } };
  }
  if (!Array.isArray(answers) || answers.length !== session.correctAnswers.length) {
    return { status: 400, data: { error: 'Réponses invalides' } };
  }
  let correctCount = 0;
  session.correctAnswers.forEach((correct, i) => { if (Number(answers[i]) === correct) correctCount++; });
  const total = session.correctAnswers.length;
  const pointsEarned = correctCount * POINTS_PER_CORRECT_TRIVIA;

  db.prepare('INSERT INTO game_sessions (user_id, game_type, score, points_earned) VALUES (?, ?, ?, ?)')
    .run(userId, 'trivia', correctCount, pointsEarned);
  if (pointsEarned > 0) {
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(pointsEarned, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
      .run(userId, 'earn_trivia', pointsEarned, `${correctCount}/${total} bonnes réponses`);
  }

  let stakeResult = 0, stakeDelta = 0;
  if (session.stake > 0) {
    const multiplier = stakeMultiplier(correctCount, total);
    stakeResult = Math.round(session.stake * multiplier);
    stakeDelta = stakeResult - session.stake;
    // max(0, ...) : garde-fou pour ne jamais faire passer le solde sous zéro, même en cas
    // de mises concurrentes sur plusieurs sessions dépassant le solde initial validé.
    db.prepare('UPDATE users SET points = max(0, points + ?) WHERE id = ?').run(stakeDelta, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
      .run(userId, 'stake_trivia', stakeDelta, `Mise de ${session.stake} pts (${correctCount}/${total}) → ${stakeResult} pts (${stakeDelta >= 0 ? '+' : ''}${stakeDelta})`);
  }

  if (session.usingBonus) {
    db.prepare('UPDATE users SET bonus_plays = bonus_plays - 1 WHERE id = ? AND bonus_plays > 0').run(userId);
  }
  activeSessions.delete(sessionToken);
  const user = db.prepare('SELECT points, bonus_plays FROM users WHERE id = ?').get(userId);
  return {
    status: 200,
    data: {
      correctCount, total, pointsEarned,
      stake: session.stake, stakeResult, stakeDelta,
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
    userId, gameType: 'puzzle', correctAnswers, createdAt: Date.now(), usingBonus: allowance.usingBonus, stake: stakeCheck.stake
  });
  return {
    status: 200,
    data: {
      sessionToken, problems,
      remainingPlaysToday: allowance.usingBonus ? DAILY_LIMIT - allowance.playedToday : DAILY_LIMIT - allowance.playedToday - 1,
      timeLimitSeconds: 45,
      usingBonusPlay: allowance.usingBonus,
      stake: stakeCheck.stake
    }
  };
}

export function submitPuzzle(userId, body) {
  const { sessionToken, answers } = body || {};
  const session = activeSessions.get(sessionToken);
  if (!session || session.userId !== userId || session.gameType !== 'puzzle') {
    return { status: 400, data: { error: 'Session de jeu invalide ou expirée' } };
  }
  if (!Array.isArray(answers) || answers.length !== session.correctAnswers.length) {
    return { status: 400, data: { error: 'Réponses invalides' } };
  }
  let correctCount = 0;
  session.correctAnswers.forEach((correct, i) => { if (Number(answers[i]) === correct) correctCount++; });
  const total = session.correctAnswers.length;
  const pointsEarned = correctCount * POINTS_PER_CORRECT_PUZZLE;

  db.prepare('INSERT INTO game_sessions (user_id, game_type, score, points_earned) VALUES (?, ?, ?, ?)')
    .run(userId, 'puzzle', correctCount, pointsEarned);
  if (pointsEarned > 0) {
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(pointsEarned, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
      .run(userId, 'earn_puzzle', pointsEarned, `${correctCount}/${total} calculs corrects`);
  }

  let stakeResult = 0, stakeDelta = 0;
  if (session.stake > 0) {
    const multiplier = stakeMultiplier(correctCount, total);
    stakeResult = Math.round(session.stake * multiplier);
    stakeDelta = stakeResult - session.stake;
    db.prepare('UPDATE users SET points = max(0, points + ?) WHERE id = ?').run(stakeDelta, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
      .run(userId, 'stake_puzzle', stakeDelta, `Mise de ${session.stake} pts (${correctCount}/${total}) → ${stakeResult} pts (${stakeDelta >= 0 ? '+' : ''}${stakeDelta})`);
  }

  if (session.usingBonus) {
    db.prepare('UPDATE users SET bonus_plays = bonus_plays - 1 WHERE id = ? AND bonus_plays > 0').run(userId);
  }
  activeSessions.delete(sessionToken);
  const user = db.prepare('SELECT points, bonus_plays FROM users WHERE id = ?').get(userId);
  return {
    status: 200,
    data: {
      correctCount, total, pointsEarned,
      stake: session.stake, stakeResult, stakeDelta,
      newBalance: user.points, bonusPlays: user.bonus_plays
    }
  };
}
