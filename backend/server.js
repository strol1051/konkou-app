import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv, sendJson, readJsonBody, clientIp, rateLimit, SECURITY_HEADERS } from './utils.js';
import { getUserId, isAdmin } from './middleware/auth.js';
import * as authRoutes from './routes/auth.js';
import * as gamesRoutes from './routes/games.js';
import * as walletRoutes from './routes/wallet.js';
import * as leaderboardRoutes from './routes/leaderboard.js';
import * as profileRoutes from './routes/profile.js';
import * as adminRoutes from './routes/admin.js';
import * as depositsRoutes from './routes/deposits.js';
import * as agentsRoutes from './routes/agents.js';
import * as accountRoutes from './routes/account.js';
import * as contactRoutes from './routes/contact.js';
import * as themeRoutes from './routes/theme.js';
import * as adsRoutes from './routes/ads.js';
import * as vipRoutes from './routes/vip.js';
import * as pushRoutes from './routes/push.js';
import * as chatRoutes from './routes/chat.js';
import * as agentChatRoutes from './routes/agentChat.js';

loadEnv();

// Valeurs de démo livrées dans backend/.env (voir ce fichier) — jamais à utiliser telles
// quelles pour un déploiement réel puisqu'elles sont publiques (visibles dans ce dépôt).
const DEMO_JWT_SECRET = 'konkou_dev_secret_change_in_production';
const DEMO_ADMIN_PASSWORD = 'changeme_admin_password';

if (!process.env.JWT_SECRET) {
  // Ancien comportement : retomber silencieusement sur une chaîne fixe codée en dur ici.
  // C'était dangereux dès lors que JWT_SECRET n'est configuré nulle part (ni variable
  // d'environnement réelle, ni backend/.env présent) : n'importe qui lisant ce fichier
  // sur le dépôt pouvait alors forger des tokens valides, y compris admin. On génère
  // désormais un secret aléatoire propre à ce process — les sessions ne survivront pas à
  // un redémarrage tant que JWT_SECRET n'est pas explicitement configuré, mais c'est un
  // compromis délibéré : "tout le monde est déconnecté" est un mode d'échec sûr, "un
  // secret de signature public" ne l'est pas.
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  JWT_SECRET non configuré — secret aléatoire généré pour cette session uniquement (déconnexion de tous les comptes au prochain redémarrage). Configurez JWT_SECRET (voir render.yaml / README.md) pour un déploiement réel.');
} else if (process.env.JWT_SECRET === DEMO_JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET utilise encore la valeur de démo de backend/.env, publique sur ce dépôt — changez-la avant tout usage réel (voir README.md).');
}

if (process.env.ADMIN_PASSWORD === DEMO_ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD utilise encore la valeur de démo de backend/.env, publique sur ce dépôt — changez-la avant tout usage réel (voir README.md).');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

// Sert les fichiers uploadés par l'admin (ex: photo de fond, voir routes/theme.js) —
// stockés sur le disque persistant (themeRoutes.UPLOADS_DIR), donc en dehors de
// FRONTEND_DIR qui lui est recréé à neuf à chaque déploiement. Pas de repli SPA ici
// (contrairement à serveStatic) : un fichier manquant est une vraie 404.
function serveUpload(req, res, pathname) {
  const relative = pathname.slice('/uploads/'.length);
  const filePath = path.join(themeRoutes.UPLOADS_DIR, relative);
  if (!filePath.startsWith(themeRoutes.UPLOADS_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...SECURITY_HEADERS });
    res.end(content);
  });
}

// Aucun 'Cache-Control' n'était envoyé pour ces fichiers avant juillet 2026 — sans en-tête
// explicite, un navigateur applique ses propres heuristiques et peut continuer à servir une
// version LOCALE mise en cache d'un fichier (styles.css, app.js...) même après un
// déploiement qui l'a changé côté serveur, y compris malgré le service worker "network
// first" (sw.js) : celui-ci appelle fetch() normalement, qui passe lui-même par le cache
// HTTP du navigateur si rien ne l'en empêche. 'no-cache' (PAS 'no-store') force une
// revalidation avec le serveur à chaque requête (le navigateur redemande toujours, quitte à
// obtenir un 304 rapide s'il connaissait déjà le contenu) — supprime cette classe de bug
// "le correctif est déployé mais l'appareil du joueur affiche encore l'ancienne version"
// pour toute mise à jour future, sans configurer de versioning de fichiers plus complexe.
const NO_CACHE = { 'Cache-Control': 'no-cache' };

function serveStatic(req, res, pathname) {
  let filePath = path.join(FRONTEND_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      // SPA fallback for unknown routes (client-side navigation)
      fs.readFile(path.join(FRONTEND_DIR, 'index.html'), (err2, indexContent) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'], ...SECURITY_HEADERS, ...NO_CACHE });
        res.end(indexContent);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...SECURITY_HEADERS, ...NO_CACHE });
    res.end(content);
  });
}

function requireAuth(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    sendJson(res, 401, { error: 'Non authentifié' });
    return null;
  }
  return userId;
}

// Returns true and lets the caller proceed if the request carries a valid admin
// token; otherwise sends a 401 and returns false.
function requireAdmin(req, res) {
  if (!isAdmin(req)) {
    sendJson(res, 401, { error: 'Accès administrateur requis' });
    return false;
  }
  return true;
}

// Un numéro enregistré comme agent (voir agentsRoutes.registerAgent) n'a plus aucun
// usage joueur — cette garde, posée après requireAuth() sur les routes jeux/portefeuille/
// classement/dépôts/liste-agents, empêche un tel compte d'y accéder même en appelant
// l'API directement (défense en profondeur ; côté frontend, ces écrans ne sont de toute
// façon jamais montrés à un compte agent — voir app.js, state.isAgent).
function blockIfAgent(req, res, userId) {
  if (agentsRoutes.isAgentLinked(userId)) {
    sendJson(res, 403, { error: 'Ce numéro est enregistré comme agent — réservé aux opérations agent (recharge/retrait), aucun accès aux jeux, au portefeuille ou au classement.' });
    return true;
  }
  return false;
}

// Applique une limite de débit pour une route sensible (login, inscription...), en
// combinant une clé par IP (protège contre un attaquant qui essaie beaucoup de comptes
// depuis une même machine) avec, si fourni, une clé plus stricte par cible (ex: le
// numéro de téléphone visé — protège un compte précis contre le brute-force même si
// l'attaquant change d'IP). Renvoie true (et une réponse 429) si la limite est dépassée.
function tooManyRequests(req, res, routeKey, { ipMax, ipWindowMs, targetKey, targetMax, targetWindowMs }) {
  const ip = clientIp(req);
  const ipCheck = rateLimit(`${routeKey}:ip:${ip}`, ipMax, ipWindowMs);
  const targetCheck = targetKey
    ? rateLimit(`${routeKey}:target:${targetKey}`, targetMax, targetWindowMs)
    : { allowed: true };
  if (!ipCheck.allowed || !targetCheck.allowed) {
    const retryAfterSeconds = Math.max(ipCheck.retryAfterSeconds || 0, targetCheck.retryAfterSeconds || 0);
    sendJson(res, 429, { error: `Trop de tentatives — réessayez dans ${retryAfterSeconds}s.` });
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    sendJson(res, 200, {});
    return;
  }

  if (pathname.startsWith('/uploads/')) {
    serveUpload(req, res, pathname);
    return;
  }

  if (!pathname.startsWith('/api/')) {
    serveStatic(req, res, pathname);
    return;
  }

  // Parse the JSON body once up front for POST requests. A malformed body should
  // produce a clean 400 rather than bubbling up as an unhandled 500.
  let body = {};
  if (method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'Corps de requête JSON invalide' });
    }
  }

  try {
    if (pathname === '/api/health' && method === 'GET') {
      return sendJson(res, 200, { ok: true, name: 'Konkou API' });
    }

    if (pathname === '/api/auth/register' && method === 'POST') {
      // Par IP seulement (pas de "cible" fixe avant création du compte) — limite le
      // spam de comptes/OTP qui, sinon, inonderait la file "Vérifications" de l'admin.
      if (tooManyRequests(req, res, 'register', { ipMax: 10, ipWindowMs: 60 * 60 * 1000 })) return;
      const { status, data } = await authRoutes.register(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      // Par IP (limite un attaquant qui essaie beaucoup de numéros) ET par numéro visé
      // (limite le brute-force d'un compte précis même en changeant d'IP).
      if (tooManyRequests(req, res, 'login', {
        ipMax: 20, ipWindowMs: 5 * 60 * 1000,
        targetKey: body?.phone ? String(body.phone).trim() : null, targetMax: 8, targetWindowMs: 15 * 60 * 1000
      })) return;
      const { status, data } = authRoutes.login(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/auth/resend-otp' && method === 'POST') {
      // Le cooldown de 60s par (téléphone, purpose) dans otp.js empêche déjà le spam
      // d'un même numéro ; cette limite par IP couvre le cas d'un attaquant qui
      // enchaînerait des numéros différents.
      if (tooManyRequests(req, res, 'resend-otp', { ipMax: 20, ipWindowMs: 60 * 60 * 1000 })) return;
      const { status, data } = await authRoutes.resendOtp(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/auth/forgot-password' && method === 'POST') {
      if (tooManyRequests(req, res, 'forgot-password', {
        ipMax: 10, ipWindowMs: 60 * 60 * 1000,
        targetKey: body?.phone ? String(body.phone).trim() : null, targetMax: 5, targetWindowMs: 60 * 60 * 1000
      })) return;
      const { status, data } = await authRoutes.forgotPassword(body);
      return sendJson(res, status, data);
    }

    // Polled by the frontend while it waits for an admin to confirm the WhatsApp
    // message — no auth header, the `code` query param is the secret instead.
    if (pathname === '/api/auth/verify-status' && method === 'GET') {
      const { status, data } = authRoutes.checkVerificationStatus({
        phone: url.searchParams.get('phone'),
        purpose: url.searchParams.get('purpose'),
        code: url.searchParams.get('code')
      });
      return sendJson(res, status, data);
    }

    // Dernière étape de la réinitialisation (voir completePasswordReset dans
    // routes/auth.js) : appelé une fois qu'un admin a autorisé la demande dans
    // "Vérifications" — pas de header d'authentification, le triplet (phone, purpose,
    // code) déjà détenu par le frontend fait office de preuve, comme pour verify-status.
    // Même limite de débit que forgot-password/resend-otp : un compte cible ne peut pas
    // être bombardé de tentatives même si le triplet venait à être deviné.
    if (pathname === '/api/auth/reset-password/complete' && method === 'POST') {
      if (tooManyRequests(req, res, 'reset-password-complete', {
        ipMax: 10, ipWindowMs: 60 * 60 * 1000,
        targetKey: body?.phone ? String(body.phone).trim() : null, targetMax: 5, targetWindowMs: 60 * 60 * 1000
      })) return;
      const { status, data } = await authRoutes.completePasswordReset(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/games/trivia' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = gamesRoutes.getTrivia(userId, url.searchParams.get('stake'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/games/trivia/submit' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = gamesRoutes.submitTrivia(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/games/puzzle' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = gamesRoutes.getPuzzle(userId, url.searchParams.get('stake'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/games/puzzle/submit' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = gamesRoutes.submitPuzzle(userId, body);
      return sendJson(res, status, data);
    }

    // Défi du jour — mode "tout ou rien" distinct des parties normales ci-dessus (voir
    // routes/games.js) : ni mise ni parties bonus/gratuites en jeu, juste une tentative
    // par jour civil.
    if (pathname === '/api/games/daily-challenge/trivia' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = gamesRoutes.getDailyChallengeTrivia(userId);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/games/daily-challenge/trivia/submit' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = gamesRoutes.submitDailyChallengeTrivia(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/games/daily-challenge/puzzle' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = gamesRoutes.getDailyChallengePuzzle(userId);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/games/daily-challenge/puzzle/submit' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = gamesRoutes.submitDailyChallengePuzzle(userId, body);
      return sendJson(res, status, data);
    }

    // Feedback vert/rouge immédiat, question par question (juillet 2026) — un seul
    // endpoint pour les 4 variantes ci-dessus (quiz/sprint, normal/Défi du jour), voir
    // gamesRoutes.checkAnswer. Purement additif pour l'affichage en direct, sans effet sur
    // les points/la mise/le solde — la soumission finale (routes *submit ci-dessus) reste
    // seule responsable de la notation réelle de la partie.
    if (pathname === '/api/games/check-answer' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = gamesRoutes.checkAnswer(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/wallet' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = walletRoutes.getWallet(userId);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/wallet/cashout' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = walletRoutes.postCashout(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/deposits' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = depositsRoutes.postDeposit(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/vip/status' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = vipRoutes.getVipStatus(userId);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/vip/request' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = vipRoutes.requestVip(userId, body);
      return sendJson(res, status, data);
    }

    // Inscription agent dédiée, publique (pas de session requise) — voir
    // agentsRoutes.registerAgent : crée le compte ET la candidature en une étape.
    if (pathname === '/api/agents/register' && method === 'POST') {
      if (tooManyRequests(req, res, 'agent-register', { ipMax: 10, ipWindowMs: 60 * 60 * 1000 })) return;
      const { status, data } = await agentsRoutes.registerAgent(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/apply' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.applyAgent(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/list' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = agentsRoutes.listActiveAgents();
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/me' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.getMyAgent(userId);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/dashboard' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.getAgentDashboard(userId);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/commission-by-day' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.getAgentCommissionByDay(userId, url.searchParams.get('date'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/deposits/confirm' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.agentConfirmDeposit(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/deposits/reject' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.agentRejectDeposit(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/cashouts/pay' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.agentPayCashout(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/cashouts/reject' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.agentRejectCashout(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/refill' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.postAgentRefill(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/vip/confirm' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.agentConfirmVip(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/vip/reject' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentsRoutes.agentRejectVip(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/leaderboard' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = leaderboardRoutes.getLeaderboard(userId, url.searchParams.get('period'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/profile' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = profileRoutes.getProfile(userId);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/account/delete' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = accountRoutes.deleteMyAccount(userId, body);
      return sendJson(res, status, data);
    }

    // Formulaire "Nous contacter" — public, aucune authentification (partenaires et
    // joueurs, connectés ou non, doivent pouvoir l'utiliser).
    if (pathname === '/api/contact' && method === 'POST') {
      const { status, data } = contactRoutes.submitContact(body);
      return sendJson(res, status, data);
    }

    // Numéro affiché publiquement sur le site (juillet 2026) — public, voir
    // contactRoutes.getPublicContactNumber pour le détail (distinct de la route admin
    // /admin/settings/contact-whatsapp qui gère aussi ce même réglage).
    if (pathname === '/api/contact/number' && method === 'GET') {
      const { status, data } = contactRoutes.getPublicContactNumber();
      return sendJson(res, status, data);
    }

    // ---------- Tchat interne (juillet 2026, voir routes/chat.js) ----------
    // Remplace la confirmation par WhatsApp (inscription/réinitialisation) et le
    // formulaire "Nous contacter" depuis le blocage du numéro opérateur par WhatsApp.

    // Anonyme (avant connexion) — le triplet (phone, purpose, secret) fait office de
    // preuve, comme /api/auth/verify-status. Limité par IP ET par numéro ciblé pour éviter
    // qu'un tchat ouvert publiquement ne devienne un vecteur de spam à volume.
    if (pathname === '/api/chat/anonymous/send' && method === 'POST') {
      if (tooManyRequests(req, res, 'chat-anonymous-send', {
        ipMax: 60, ipWindowMs: 60 * 60 * 1000,
        targetKey: body?.phone ? String(body.phone).trim() : null, targetMax: 40, targetWindowMs: 60 * 60 * 1000
      })) return;
      const { status, data } = chatRoutes.sendAnonymousMessage(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/chat/anonymous/messages' && method === 'GET') {
      const { status, data } = chatRoutes.getAnonymousMessages({
        phone: url.searchParams.get('phone'),
        purpose: url.searchParams.get('purpose'),
        secret: url.searchParams.get('secret')
      });
      return sendJson(res, status, data);
    }

    // Authentifié (joueur/agent déjà connecté) — toujours purpose='support', voir
    // routes/chat.js.
    if (pathname === '/api/chat/send' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = chatRoutes.sendAuthedMessage(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/chat/messages' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = chatRoutes.getAuthedMessages(userId);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/chat/threads' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = chatRoutes.listChatThreads(url.searchParams.get('purpose'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/chat/messages' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = chatRoutes.getChatThreadMessages({
        phone: url.searchParams.get('phone'),
        purpose: url.searchParams.get('purpose')
      });
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/chat/reply' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = chatRoutes.adminReply(body);
      return sendJson(res, status, data);
    }

    // ---------- Tchat interne Joueur <-> Agent (août 2026, voir routes/agentChat.js) ----------
    // Même motivation que le bloc /api/chat ci-dessus, appliquée cette fois au bouton
    // "Contacter cet agent" (numéro WhatsApp personnel de chaque agent). Toujours
    // authentifié des deux côtés — voir routes/agentChat.js pour le détail.

    // Joueur (jamais un agent — un agent ne "contacte" pas un autre agent via cet écran).
    if (pathname === '/api/agent-chat/send' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      if (tooManyRequests(req, res, 'agent-chat-send', { ipMax: 60, ipWindowMs: 60 * 60 * 1000 })) return;
      const { status, data } = agentChatRoutes.sendPlayerMessage(userId, body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agent-chat/messages' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      if (blockIfAgent(req, res, userId)) return;
      const { status, data } = agentChatRoutes.getPlayerMessages(userId, { agentCode: url.searchParams.get('agentCode') });
      return sendJson(res, status, data);
    }

    // Agent (identifié comme les autres routes /api/agents/*, voir agentsRoutes.getAgentDashboard).
    if (pathname === '/api/agents/chat/threads' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentChatRoutes.listAgentThreads(userId);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/chat/messages' && method === 'GET') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentChatRoutes.getAgentThreadMessages(userId, { playerUserId: url.searchParams.get('playerUserId') });
      return sendJson(res, status, data);
    }

    if (pathname === '/api/agents/chat/reply' && method === 'POST') {
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = agentChatRoutes.sendAgentMessage(userId, body);
      return sendJson(res, status, data);
    }

    // Thème actif — public, lu par app.js/admin.js avant même une éventuelle connexion.
    if (pathname === '/api/theme' && method === 'GET') {
      const { status, data } = themeRoutes.getTheme();
      return sendJson(res, status, data);
    }

    // Panneau publicitaire — public comme /api/theme (voir routes/ads.js), mais l'image
    // n'est affichée par app.js qu'une fois le joueur/agent connecté.
    if (pathname === '/api/ad' && method === 'GET') {
      const { status, data } = adsRoutes.getAd();
      return sendJson(res, status, data);
    }

    // ---------- Notifications push (voir backend/webpush.js et routes/push.js) ----------

    // Clé publique VAPID — publique par nature (voir routes/push.js), nécessaire côté
    // frontend AVANT même de pouvoir appeler PushManager.subscribe().
    if (pathname === '/api/push/vapid-public-key' && method === 'GET') {
      const { status, data } = pushRoutes.getVapidPublicKeyRoute();
      return sendJson(res, status, data);
    }

    // Le type d'abonnement ('admin' vs 'user') est déterminé ICI, à partir du jeton
    // présenté, jamais depuis le corps de la requête (voir la note sur subscribePush()
    // dans routes/push.js) — vérifie d'abord un jeton admin, sinon retombe sur
    // requireAuth() comme n'importe quelle route joueur/agent authentifiée.
    if (pathname === '/api/push/subscribe' && method === 'POST') {
      if (isAdmin(req)) {
        const { status, data } = pushRoutes.subscribePush('admin', null, body);
        return sendJson(res, status, data);
      }
      const userId = requireAuth(req, res); if (userId == null) return;
      const { status, data } = pushRoutes.subscribePush('user', userId, body);
      return sendJson(res, status, data);
    }

    // Désabonnement — même exigence d'authentification que l'abonnement (admin OU joueur/
    // agent connecté), pour qu'un visiteur anonyme ne puisse pas désabonner n'importe quel
    // endpoint au hasard ; la suppression elle-même ne vérifie pas la propriété au-delà de
    // ça (voir la note dans routes/push.js).
    if (pathname === '/api/push/unsubscribe' && method === 'POST') {
      if (!isAdmin(req)) {
        const userId = requireAuth(req, res); if (userId == null) return;
      }
      const { status, data } = pushRoutes.unsubscribePush(body);
      return sendJson(res, status, data);
    }

    // Diffusion groupée (juillet 2026) — réservée à l'admin, voir broadcastToPlayers/
    // broadcastToAgents dans routes/push.js pour le détail (touche uniquement les
    // appareils déjà abonnés aux notifications, pas la totalité des comptes).
    if (pathname === '/api/admin/broadcast/players' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = await pushRoutes.broadcastToPlayers(body);
      return sendJson(res, status, data);
    }
    if (pathname === '/api/admin/broadcast/agents' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = await pushRoutes.broadcastToAgents(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/login' && method === 'POST') {
      // La route la plus sensible du serveur — limite volontairement plus stricte que
      // le login joueur. Un seul mot de passe partagé (voir routes/admin.js) rend le
      // brute-force particulièrement rentable pour un attaquant sans cette limite.
      if (tooManyRequests(req, res, 'admin-login', { ipMax: 8, ipWindowMs: 15 * 60 * 1000 })) return;
      const { status, data } = adminRoutes.login(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/cashouts' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.listCashouts(url.searchParams.get('status'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/cashouts/pay' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.payCashout(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/cashouts/reject' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.rejectCashout(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/verifications' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.listVerifications(url.searchParams.get('purpose'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/verifications/confirm-phone' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.confirmPhoneVerification(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/verifications/confirm-reset' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.confirmPasswordReset(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/verifications/reject-phone' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.rejectPhoneVerification(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/verifications/reject-reset' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.rejectPasswordReset(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/deposits' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.listDeposits(url.searchParams.get('status'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/deposits/confirm' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.confirmDeposit(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/deposits/reject' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.rejectDeposit(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/agents' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.listAgentApplications(url.searchParams.get('status'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/agents/approve' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.approveAgentApplication(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/agents/reject' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.rejectAgentApplication(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/agent-refills' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.listAgentRefills(url.searchParams.get('status'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/agent-refills/confirm' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.confirmAgentRefill(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/agent-refills/reject' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.rejectAgentRefill(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/agents/report' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.getAgentsGlobalReport({
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to')
      });
      return sendJson(res, status, data);
    }

    // Remboursements de commission agent (NatCash/MonCash, juillet 2026) — voir
    // routes/admin.js pour le détail du cycle 8/15/22 jours choisi par chaque agent.
    if (pathname === '/api/admin/agents/reimbursements' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.listAgentsReimbursementStatus();
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/agents/reimbursements/confirm' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.confirmAgentReimbursement(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/agents/reimbursements/history' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.listRecentAgentReimbursements();
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/vip' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.listVipPurchases(url.searchParams.get('status'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/vip/confirm' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.confirmVipPurchase(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/vip/reject' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.rejectVipPurchase(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/revenue' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.getRevenueSummary(url.searchParams.get('date'));
      return sendJson(res, status, data);
    }

    // Réinitialisation des données de test (avant un vrai lancement) — irréversible, voir
    // adminRoutes.resetTestData pour le détail de ce qui est supprimé/conservé.
    if (pathname === '/api/admin/reset-test-data' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adminRoutes.resetTestData(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/players' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = accountRoutes.listPlayers(url.searchParams.get('search'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/accounts/lookup' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = accountRoutes.lookupAccount(url.searchParams.get('phone'));
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/accounts/delete' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = accountRoutes.adminDeleteAccount(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/contact-whatsapp' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = contactRoutes.getContactSettings();
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/contact-whatsapp' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = contactRoutes.setContactWhatsapp(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/theme' && method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = themeRoutes.getTheme();
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/theme' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = themeRoutes.setTheme(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/bg-color' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = themeRoutes.setBgColor(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/blue-color' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = themeRoutes.setBlueColor(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/card-color' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = themeRoutes.setCardColor(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/ad' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = adsRoutes.setAd(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/bg-image' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = themeRoutes.setBgImage(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/logo' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = themeRoutes.setLogo(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/settings/topbar-bg-image' && method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { status, data } = themeRoutes.setTopbarBgImage(body);
      return sendJson(res, status, data);
    }

    return sendJson(res, 404, { error: 'Route introuvable' });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: 'Erreur serveur' });
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Konkou démarré sur http://localhost:${PORT}`));
