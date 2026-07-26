import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, sendJson, readJsonBody } from './utils.js';
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
import * as vipRoutes from './routes/vip.js';

loadEnv();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'konkou_dev_secret_change_in_production';

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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

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
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(indexContent);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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
      const { status, data } = await authRoutes.register(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const { status, data } = authRoutes.login(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/auth/resend-otp' && method === 'POST') {
      const { status, data } = await authRoutes.resendOtp(body);
      return sendJson(res, status, data);
    }

    if (pathname === '/api/auth/forgot-password' && method === 'POST') {
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

    // Thème actif — public, lu par app.js/admin.js avant même une éventuelle connexion.
    if (pathname === '/api/theme' && method === 'GET') {
      const { status, data } = themeRoutes.getTheme();
      return sendJson(res, status, data);
    }

    if (pathname === '/api/admin/login' && method === 'POST') {
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
