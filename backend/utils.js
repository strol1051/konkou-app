import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- tiny .env loader (avoids needing the "dotenv" package) ---
export function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

// --- password hashing (scrypt, no bcrypt dependency needed) ---
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

// --- signed tokens (JWT-like, HMAC-SHA256, no jsonwebtoken dependency needed) ---
function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function signToken(payload, secret, expiresInSeconds = 60 * 60 * 24 * 30) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds };
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token, secret) {
  try {
    const parts = (token || '').split('.');
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sig] = parts;
    const data = `${headerB64}.${bodyB64}`;
    const sigBuf = Buffer.from(sig, 'base64url');
    const expectedBuf = crypto.createHmac('sha256', secret).update(data).digest();
    // timingSafeEqual throws if buffer lengths differ (e.g. a tampered/garbage signature) —
    // treat any mismatch, including length mismatch, as "invalid token" rather than crashing.
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf-8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- HTTP helpers ---

// En-têtes de sécurité de base, appliqués à toute réponse qu'un navigateur peut
// afficher/exécuter (pages HTML, JS/CSS statiques, images uploadées) — voir server.js
// (serveStatic, serveUpload). La CSP correspond à ce que le frontend charge réellement :
// tout en 'self' (aucun CDN externe, voir index.html/admin.html), 'unsafe-inline' pour
// style-src seulement (app.js/admin.js posent beaucoup d'attributs style="" inline sur du
// HTML généré dynamiquement — les retirer serait un refactor bien plus lourd que ce
// correctif), et data: pour img-src (les aperçus d'upload de thème passent par un canvas
// → data URL avant envoi, voir admin.js). script-src reste strict ('self' uniquement,
// pas d'inline) grâce à sw-register.js qui a remplacé le <script> inline de index.html.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY
};

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // Seul nosniff s'applique vraiment à une réponse JSON pure ; le reste de
    // SECURITY_HEADERS (CSP, frame options...) concerne les documents/ressources
    // affichables par le navigateur, voir serveStatic/serveUpload dans server.js.
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

// Limite du corps JSON accepté. Relevée de 1 Mo à 6 Mo pour laisser passer une image de
// fond encodée en base64 (voir routes/theme.js, setBgImage) — le base64 ajoute ~33% par
// rapport au fichier d'origine, et l'image elle-même est déjà limitée à MAX_BG_IMAGE_BYTES
// (3 Mo) côté theme.js, donc 6 Mo laisse une marge confortable sans ouvrir la porte à des
// corps de requête arbitrairement gros.
const MAX_JSON_BODY_BYTES = 6 * 1024 * 1024;

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > MAX_JSON_BODY_BYTES) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

// --- rate limiting (compteur à fenêtre fixe, en mémoire) ---
// Pas de dépendance externe (voir package.json) donc pas d'express-rate-limit — cette
// implémentation maison suffit pour un seul process (voir DEPLOY.md : un seul service
// Render). Si l'app tournait un jour sur plusieurs instances, il faudrait un store
// partagé (Redis, etc.) pour que la limite soit effective across instances.
const rateLimitBuckets = new Map(); // clé (ex: "login:ip:1.2.3.4") -> { count, resetAt }

// Autorise jusqu'à `max` appels par fenêtre de `windowMs` ms pour une clé donnée.
// Retourne { allowed: true } ou { allowed: false, retryAfterSeconds }.
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (bucket.count >= max) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count++;
  return { allowed: true };
}

// Purge périodique des compartiments expirés — évite une fuite mémoire lente puisque
// chaque IP/téléphone distinct crée sa propre clé (voir server.js pour les appelants).
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (now > bucket.resetAt) rateLimitBuckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

// Adresse IP du client, en tenant compte du proxy Render (X-Forwarded-For) — voir
// DEPLOY.md. Non fiable en dehors d'un déploiement derrière un proxy de confiance (un
// client direct pourrait forger cet en-tête), acceptable ici puisque c'est le seul mode
// de déploiement documenté pour cette app.
export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
