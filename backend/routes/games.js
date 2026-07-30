import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db from '../db.js';
import { getActiveThemeKey } from './theme.js';
import { isVipActive, getVipExtraDailyPlays } from './vip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allQuestions = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/questions.json'), 'utf-8'));
// Banque dédiée et nettement plus difficile, réservée exclusivement au Défi du jour (voir
// plus bas) — jamais piochée pour une partie de quiz normale. Pas de filtrage par thème
// saisonnier ici (contrairement à questionPool()) : ces questions sont volontairement
// intemporelles.
const dailyChallengeQuestions = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/daily-challenge-questions.json'), 'utf-8'));

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
// _PERCENT ci-dessous pour la pénalité de mise associée). Même durée pour les deux jeux
// normaux — initialement 60s pour le quiz, ramenée à 45s pour rester cohérente avec le
// sprint de calcul, resserrée à 30s, puis 25s, puis remontée à 35s (juillet 2026).
const TRIVIA_TIME_LIMIT_SECONDS = 35;
const PUZZLE_TIME_LIMIT_SECONDS = 35;
// Le Défi du jour (voir getDailyChallengeTrivia/Puzzle plus bas) a toujours utilisé la
// même durée que les jeux normaux jusqu'ici — mais ses questions/calculs sont volontairement
// beaucoup plus difficiles (banque dédiée, voir dailyChallengeQuestions/HARD_PUZZLE_SPACE),
// donc une constante SÉPARÉE lui est désormais dédiée plutôt que de réutiliser
// TRIVIA_TIME_LIMIT_SECONDS/PUZZLE_TIME_LIMIT_SECONDS — les deux peuvent évoluer
// indépendamment à l'avenir sans affecter l'autre.
const DAILY_CHALLENGE_TIME_LIMIT_SECONDS = 60;
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

// ---------- Défi du jour — mode "tout ou rien" (refonte juillet 2026) ----------
// Une tentative explicite et distincte des parties normales — voir renderDailyChallengeChoice
// côté frontend, qui affiche désormais un écran d'avertissement avant de laisser
// commencer : questions/calculs nettement plus difficiles que le jeu normal (banque
// dédiée dailyChallengeQuestions / HARD_PUZZLE_SPACE ci-dessous), AUCUNE mise, AUCUN
// point gagné au fil des bonnes réponses. Un seul résultat net par jour civil :
// - réussite (>= DAILY_CHALLENGE_PERCENT% de bonnes réponses) : +DAILY_CHALLENGE_REWARD_POINTS
// - échec (score insuffisant OU temps écoulé) : -DAILY_CHALLENGE_LOSS_PERCENT% du solde
// Un échec consomme la tentative du jour tout autant qu'une réussite (voir la contrainte
// UNIQUE(user_id, claim_date) sur daily_challenge_claims) : impossible de retenter après
// un échec pour "rejouer sa perte" le même jour — sinon un joueur pourrait reperdre 75% de
// son solde en boucle jusqu'à réussir, ce qui viderait un compte en 2-3 tentatives.
const DAILY_CHALLENGE_PERCENT = 90;
const DAILY_CHALLENGE_REWARD_POINTS = 150;
const DAILY_CHALLENGE_LOSS_PERCENT = 75;
const DAILY_CHALLENGE_QUESTIONS_PER_ROUND = 5; // même nombre que le quiz normal
const DAILY_CHALLENGE_PROBLEMS_PER_ROUND = 8; // même nombre que le sprint normal

// Espace des calculs du Défi du jour — nettement plus difficile que NORMAL_PUZZLE_SPACE :
// nombres à deux chiffres (10 à 50, contre 1 à 12) et un quatrième opérateur, la division
// (toujours exacte : b et le quotient sont choisis d'abord, puis a = b × quotient, jamais
// l'inverse). Comme NORMAL_PUZZLE_SPACE, énuméré une seule fois au démarrage pour que
// pickUnique() garantisse l'absence de répétition par joueur au sein de ce pool dédié
// (kind PUZZLE_HARD, totalement séparé du suivi du sprint normal).
function buildHardPuzzleSpace() {
  const problems = [];
  for (let a = 10; a <= 50; a++) {
    for (let b = 10; b <= 50; b++) {
      problems.push({ text: `${a} + ${b}`, answer: a + b });
      if (a >= b) problems.push({ text: `${a} - ${b}`, answer: a - b });
    }
  }
  for (let a = 10; a <= 25; a++) {
    for (let b = 2; b <= 12; b++) {
      problems.push({ text: `${a} × ${b}`, answer: a * b });
    }
  }
  for (let b = 2; b <= 12; b++) {
    for (let q = 2; q <= 20; q++) {
      problems.push({ text: `${b * q} ÷ ${b}`, answer: q });
    }
  }
  return problems;
}
const HARD_PUZZLE_SPACE = buildHardPuzzleSpace();

function hasAttemptedDailyChallengeToday(userId) {
  return !!db.prepare(
    `SELECT 1 FROM daily_challenge_claims WHERE user_id = ? AND claim_date = date('now') LIMIT 1`
  ).get(userId);
}

// Consulté par routes/profile.js pour afficher la carte "Défi du jour" sur l'accueil,
// avant même que le joueur ait lancé une tentative aujourd'hui. outcome distingue une
// réussite d'un échec — les deux verrouillent l'accès au défi jusqu'au lendemain, mais ne
// doivent pas s'afficher pareil côté joueur (voir renderHome() dans app.js).
export function getDailyChallengeStatus(userId) {
  const row = db.prepare(
    `SELECT outcome FROM daily_challenge_claims WHERE user_id = ? AND claim_date = date('now') LIMIT 1`
  ).get(userId);
  return {
    thresholdPercent: DAILY_CHALLENGE_PERCENT,
    rewardPoints: DAILY_CHALLENGE_REWARD_POINTS,
    lossPercent: DAILY_CHALLENGE_LOSS_PERCENT,
    attemptedToday: !!row,
    outcome: row ? row.outcome : null // 'won' | 'lost' | null
  };
}

export function getDailyChallengeTrivia(userId) {
  if (hasAttemptedDailyChallengeToday(userId)) {
    return { status: 409, data: { error: "Défi du jour déjà tenté aujourd'hui — revenez demain." } };
  }
  const picked = pickUnique(userId, SEEN_KIND.TRIVIA_HARD, dailyChallengeQuestions, DAILY_CHALLENGE_QUESTIONS_PER_ROUND, q => q.id);
  const sessionToken = crypto.randomBytes(12).toString('hex');
  // mode: 'daily' (voir aussi getTrivia/getPuzzle, qui posent 'normal') empêche qu'une
  // session de quiz normal soit soumise à submitDailyChallengeTrivia (banque facile,
  // aurait rendu le défi trivial à réussir) ou inversement — vérifié explicitement dans
  // les deux familles de fonctions submit*, pas seulement via gameType.
  activeSessions.set(sessionToken, {
    userId, gameType: 'trivia', mode: 'daily', correctAnswers: picked.map(q => q.answer),
    createdAt: Date.now(), usingBonus: false, stake: 0,
    timeLimitSeconds: DAILY_CHALLENGE_TIME_LIMIT_SECONDS
  });
  return {
    status: 200,
    data: {
      sessionToken,
      questions: picked.map(q => ({ id: q.id, question: q.question, choices: q.choices })),
      timeLimitSeconds: DAILY_CHALLENGE_TIME_LIMIT_SECONDS,
      thresholdPercent: DAILY_CHALLENGE_PERCENT,
      rewardPoints: DAILY_CHALLENGE_REWARD_POINTS,
      lossPercent: DAILY_CHALLENGE_LOSS_PERCENT
    }
  };
}

export function getDailyChallengePuzzle(userId) {
  if (hasAttemptedDailyChallengeToday(userId)) {
    return { status: 409, data: { error: "Défi du jour déjà tenté aujourd'hui — revenez demain." } };
  }
  const picked = pickUnique(userId, SEEN_KIND.PUZZLE_HARD, HARD_PUZZLE_SPACE, DAILY_CHALLENGE_PROBLEMS_PER_ROUND, p => p.text);
  const problems = picked.map((p, i) => ({ id: i, text: p.text }));
  const correctAnswers = picked.map(p => p.answer);
  const sessionToken = crypto.randomBytes(12).toString('hex');
  activeSessions.set(sessionToken, {
    userId, gameType: 'puzzle', mode: 'daily', correctAnswers,
    createdAt: Date.now(), usingBonus: false, stake: 0,
    timeLimitSeconds: DAILY_CHALLENGE_TIME_LIMIT_SECONDS
  });
  return {
    status: 200,
    data: {
      sessionToken, problems,
      timeLimitSeconds: DAILY_CHALLENGE_TIME_LIMIT_SECONDS,
      thresholdPercent: DAILY_CHALLENGE_PERCENT,
      rewardPoints: DAILY_CHALLENGE_REWARD_POINTS,
      lossPercent: DAILY_CHALLENGE_LOSS_PERCENT
    }
  };
}

// Corrige les réponses d'une tentative de Défi du jour — pas de mise, pas de points au fil
// des bonnes réponses, un seul résultat net (voir le commentaire en tête de section).
// isTimeout compte TOUJOURS comme un échec, même si de bonnes réponses avaient déjà été
// données : laisser filer le temps ne doit jamais être un moyen d'éviter la perte (même
// principe que scoreOutcome() pour les parties normales).
function scoreDailyChallenge(session, answers, timedOutFlag) {
  let correctCount = 0;
  session.correctAnswers.forEach((correct, i) => { if (Number(answers[i]) === correct) correctCount++; });
  const total = session.correctAnswers.length;
  const isTimeout = !!timedOutFlag && (Date.now() - session.createdAt) > session.timeLimitSeconds * 1000;
  const won = !isTimeout && total > 0 && (correctCount / total) * 100 >= DAILY_CHALLENGE_PERCENT;
  return { correctCount, total, isTimeout, won };
}

// Enregistre la tentative UNIQUE du jour (gagnée ou perdue) et applique son résultat au
// solde. Retourne null si une tentative existe déjà pour aujourd'hui (contrainte
// UNIQUE(user_id, claim_date) sur daily_challenge_claims) — filet de sécurité contre une
// double soumission concurrente, en plus du contrôle déjà fait par
// getDailyChallengeTrivia/Puzzle avant même de démarrer la tentative.
function recordDailyChallengeAttempt(userId, gameType, correctCount, total, won) {
  let pointsDelta;
  if (won) {
    pointsDelta = DAILY_CHALLENGE_REWARD_POINTS;
  } else {
    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
    pointsDelta = -Math.round((user?.points || 0) * DAILY_CHALLENGE_LOSS_PERCENT / 100);
  }

  try {
    db.prepare(
      `INSERT INTO daily_challenge_claims (user_id, claim_date, game_type, score, total, reward_points, outcome, points_delta)
       VALUES (?, date('now'), ?, ?, ?, ?, ?, ?)`
    ).run(userId, gameType, correctCount, total, won ? DAILY_CHALLENGE_REWARD_POINTS : 0, won ? 'won' : 'lost', pointsDelta);
  } catch {
    return null; // Déjà tenté aujourd'hui (concurrence) — voir le commentaire ci-dessus.
  }

  db.prepare('UPDATE users SET points = max(0, points + ?) WHERE id = ?').run(pointsDelta, userId);
  db.prepare('INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)')
    .run(userId, won ? 'daily_challenge_win' : 'daily_challenge_loss', pointsDelta,
      won
        ? `Défi du jour réussi (${correctCount}/${total} à ${gameType === 'trivia' ? 'Quiz difficile' : 'Sprint difficile'}) — +${DAILY_CHALLENGE_REWARD_POINTS} pts`
        : `Défi du jour échoué (${correctCount}/${total} à ${gameType === 'trivia' ? 'Quiz difficile' : 'Sprint difficile'}) — -${DAILY_CHALLENGE_LOSS_PERCENT}% du solde (${pointsDelta} pts)`);

  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  return { won, pointsDelta, newBalance: user.points };
}

export function submitDailyChallengeTrivia(userId, body) {
  const { sessionToken, answers, timedOut } = body || {};
  const session = activeSessions.get(sessionToken);
  if (!session || session.userId !== userId || session.gameType !== 'trivia' || session.mode !== 'daily') {
    return { status: 400, data: { error: 'Session de défi invalide ou expirée' } };
  }
  if (!checkNotExpired(session)) {
    activeSessions.delete(sessionToken);
    return { status: 400, data: { error: "Temps écoulé pour cette tentative — trop de temps s'est écoulé depuis le début." } };
  }
  if (!Array.isArray(answers) || answers.length !== session.correctAnswers.length) {
    return { status: 400, data: { error: 'Réponses invalides' } };
  }

  const { correctCount, total, isTimeout, won } = scoreDailyChallenge(session, answers, timedOut);
  activeSessions.delete(sessionToken);
  const result = recordDailyChallengeAttempt(userId, 'trivia', correctCount, total, won);
  if (!result) {
    return { status: 409, data: { error: "Défi du jour déjà tenté aujourd'hui — revenez demain." } };
  }

  return {
    status: 200,
    data: { correctCount, total, timedOut: isTimeout, won: result.won, pointsDelta: result.pointsDelta, newBalance: result.newBalance }
  };
}

export function submitDailyChallengePuzzle(userId, body) {
  const { sessionToken, answers, timedOut } = body || {};
  const session = activeSessions.get(sessionToken);
  if (!session || session.userId !== userId || session.gameType !== 'puzzle' || session.mode !== 'daily') {
    return { status: 400, data: { error: 'Session de défi invalide ou expirée' } };
  }
  if (!checkNotExpired(session)) {
    activeSessions.delete(sessionToken);
    return { status: 400, data: { error: "Temps écoulé pour cette tentative — trop de temps s'est écoulé depuis le début." } };
  }
  if (!Array.isArray(answers) || answers.length !== session.correctAnswers.length) {
    return { status: 400, data: { error: 'Réponses invalides' } };
  }

  const { correctCount, total, isTimeout, won } = scoreDailyChallenge(session, answers, timedOut);
  activeSessions.delete(sessionToken);
  const result = recordDailyChallengeAttempt(userId, 'puzzle', correctCount, total, won);
  if (!result) {
    return { status: 409, data: { error: "Défi du jour déjà tenté aujourd'hui — revenez demain." } };
  }

  return {
    status: 200,
    data: { correctCount, total, timedOut: isTimeout, won: result.won, pointsDelta: result.pointsDelta, newBalance: result.newBalance }
  };
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

// ---------- Anti-répétition par joueur (juillet 2026) ----------
// Quatre pools indépendants (voir user_seen_items dans db.js) : le quiz normal et le quiz
// du Défi du jour ne partagent pas leur historique "déjà vu", pareil pour les deux
// variantes du sprint de calcul — chacun a son propre cycle.
const SEEN_KIND = { TRIVIA: 'trivia', TRIVIA_HARD: 'trivia_hard', PUZZLE: 'puzzle', PUZZLE_HARD: 'puzzle_hard' };

function getSeenKeys(userId, kind) {
  return new Set(
    db.prepare(`SELECT item_key FROM user_seen_items WHERE user_id = ? AND kind = ?`).all(userId, kind).map(r => r.item_key)
  );
}

const markSeenStmt = db.prepare(`
  INSERT INTO user_seen_items (user_id, kind, item_key, last_seen_at) VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, kind, item_key) DO UPDATE SET last_seen_at = datetime('now')
`);
function markSeen(userId, kind, keys) {
  for (const key of keys) markSeenStmt.run(userId, kind, String(key));
}

// Éléments déjà vus par ce joueur pour ce pool, du moins récemment vu au plus récemment
// vu, en excluant `excludeKeys` (des éléments déjà choisis dans le même tirage) — sert de
// file d'attente pour compléter un tirage une fois le pool d'éléments "jamais vus" épuisé.
function leastRecentlySeenKeys(userId, kind, excludeKeys, limit) {
  const rows = db.prepare(`SELECT item_key FROM user_seen_items WHERE user_id = ? AND kind = ? ORDER BY last_seen_at ASC`).all(userId, kind);
  const out = [];
  for (const r of rows) {
    if (excludeKeys.has(r.item_key)) continue;
    out.push(r.item_key);
    if (out.length >= limit) break;
  }
  return out;
}

// Choisit `count` éléments dans `items` (via keyOf(item) -> clé stable, ex. l'id d'une
// question ou le texte d'un calcul) sans jamais reproposer à CE joueur un élément déjà vu
// pour ce `kind`, tant que le pool contient encore des éléments non-vus. Une fois ce pool
// épuisé (joueur très actif), complète avec les éléments les MOINS récemment vus plutôt
// que de réinitialiser brutalement tout l'historique — la reprise est donc aussi
// discrète que possible. Met à jour last_seen_at pour tous les éléments choisis (y
// compris un réemploi) avant de retourner.
function pickUnique(userId, kind, items, count, keyOf) {
  const seen = getSeenKeys(userId, kind);
  const unseen = shuffle(items.filter(it => !seen.has(String(keyOf(it)))));
  let picked = unseen.slice(0, count);
  if (picked.length < count) {
    const pickedKeys = new Set(picked.map(it => String(keyOf(it))));
    const need = count - picked.length;
    const lruKeys = leastRecentlySeenKeys(userId, kind, pickedKeys, need);
    const byKey = new Map(items.map(it => [String(keyOf(it)), it]));
    for (const k of lruKeys) {
      const it = byKey.get(k);
      if (it) { picked.push(it); pickedKeys.add(k); }
    }
    // Garde-fou extrême (ne devrait jamais se produire, `items` couvrant toujours tout ce
    // qui a pu être marqué "vu") : complète avec ce qui reste plutôt que de renvoyer moins
    // d'éléments que demandé.
    if (picked.length < count) {
      const rest = shuffle(items.filter(it => !pickedKeys.has(String(keyOf(it)))));
      picked = picked.concat(rest.slice(0, count - picked.length));
    }
  }
  picked = shuffle(picked); // évite que les éléments "jamais vus" soient toujours en tête
  markSeen(userId, kind, picked.map(it => String(keyOf(it))));
  return picked;
}

// Espace complet des calculs du Sprint STANDARD (hors Défi du jour) — mêmes bornes que
// l'ancien générateur purement aléatoire (a et b entre 1 et 12, opérateurs +/-/×,
// soustraction toujours calculée a >= b pour ne jamais afficher de résultat négatif), mais
// énuméré une seule fois au démarrage plutôt que tiré au hasard à chaque partie : ça
// permet à pickUnique() de garantir qu'aucun calcul n'est jamais reproposé au même joueur
// tant que ce pool (366 calculs uniques) n'est pas épuisé. `text` sert de clé stable
// ("7 + 3") pour le suivi anti-répétition.
function buildNormalPuzzleSpace() {
  const problems = [];
  for (let a = 1; a <= 12; a++) {
    for (let b = 1; b <= 12; b++) {
      problems.push({ text: `${a} + ${b}`, answer: a + b });
      problems.push({ text: `${a} × ${b}`, answer: a * b });
      if (a >= b) problems.push({ text: `${a} - ${b}`, answer: a - b });
    }
  }
  return problems;
}
const NORMAL_PUZZLE_SPACE = buildNormalPuzzleSpace();

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

  const picked = pickUnique(userId, SEEN_KIND.TRIVIA, questionPool(), 5, q => q.id);
  const sessionToken = crypto.randomBytes(12).toString('hex');
  // mode: 'normal' distingue explicitement cette session d'une session de Défi du jour
  // (mode: 'daily', voir getDailyChallengeTrivia) — empêche qu'un token de quiz normal
  // (banque facile) soit soumis à submitDailyChallengeTrivia pour contourner la difficulté
  // du défi, vérifié dans submitDailyChallengeTrivia/Puzzle.
  activeSessions.set(sessionToken, {
    userId, gameType: 'trivia', mode: 'normal', correctAnswers: picked.map(q => q.answer),
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

// Feedback immédiat vert/rouge par question (juillet 2026) — le joueur voit tout de suite
// si SA réponse était bonne ou mauvaise, sans attendre la fin de la partie. Fonctionne pour
// les 4 variantes (quiz normal, sprint normal, quiz du Défi du jour, sprint du Défi du
// jour) puisque toutes stockent leur session de la même façon dans activeSessions, avec un
// correctAnswers[] déjà là pour le calcul final — pas besoin de dupliquer cette fonction
// par jeu/mode.
//
// Volontairement "une seule vérification par question, dans l'ordre" : session.checkedCount
// (nouveau compteur posé sur la session, jamais exposé au client) avance d'une unité à
// chaque appel réussi, et l'index vérifié est TOUJOURS ce compteur — jamais un index fourni
// par le client. Sans cette contrainte, un client pourrait interroger cet endpoint en
// boucle avec des valeurs différentes sur LA MÊME question pour deviner la bonne réponse
// par élimination (4 essais suffiraient pour un quiz à 4 choix) ; ici, une question déjà
// vérifiée ne peut plus jamais l'être une seconde fois, exactement comme en jouant
// normalement une question à la fois.
//
// Important : ceci ne remplace PAS la validation finale (submitTrivia/submitPuzzle/
// submitDailyChallengeTrivia/submitDailyChallengePuzzle, qui continuent de noter le
// tableau complet de réponses envoyé par le client à la fin) — cet endpoint est purement
// additif pour l'affichage en direct, sans aucun effet sur les points/la mise/le solde.
export function checkAnswer(userId, body) {
  const { sessionToken, answer } = body || {};
  const session = activeSessions.get(sessionToken);
  if (!session || session.userId !== userId) {
    return { status: 400, data: { error: 'Session de jeu invalide ou expirée' } };
  }
  if (!checkNotExpired(session)) {
    return { status: 400, data: { error: 'Temps écoulé pour cette partie.' } };
  }
  const index = session.checkedCount || 0;
  if (index >= session.correctAnswers.length) {
    return { status: 409, data: { error: 'Toutes les questions de cette partie ont déjà été vérifiées.' } };
  }
  const correct = Number(answer) === session.correctAnswers[index];
  session.checkedCount = index + 1;
  return { status: 200, data: { correct, index, total: session.correctAnswers.length } };
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
  // session.mode === 'daily' est explicitement rejeté ici (et pas seulement accepté par
  // omission) : sans ce contrôle, un joueur pourrait démarrer une tentative de Défi du
  // jour puis soumettre ses réponses à CE endpoint normal plutôt qu'à
  // submitDailyChallengeTrivia, pour éviter la perte de 75% en cas d'échec tout en gardant
  // les points normaux gagnés par bonne réponse — voir getDailyChallengeTrivia.
  if (!session || session.userId !== userId || session.gameType !== 'trivia' || session.mode === 'daily') {
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

  const picked = pickUnique(userId, SEEN_KIND.PUZZLE, NORMAL_PUZZLE_SPACE, 8, p => p.text);
  const problems = picked.map((p, i) => ({ id: i, text: p.text }));
  const correctAnswers = picked.map(p => p.answer);
  const sessionToken = crypto.randomBytes(12).toString('hex');
  activeSessions.set(sessionToken, {
    userId, gameType: 'puzzle', mode: 'normal', correctAnswers, createdAt: Date.now(), usingBonus: allowance.usingBonus, stake: stakeCheck.stake,
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
  // Voir le commentaire équivalent dans submitTrivia : une session de Défi du jour
  // (mode: 'daily') est explicitement rejetée ici pour ne pas permettre d'éviter la perte
  // de 75% en soumettant à ce endpoint normal à la place de submitDailyChallengePuzzle.
  if (!session || session.userId !== userId || session.gameType !== 'puzzle' || session.mode === 'daily') {
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
