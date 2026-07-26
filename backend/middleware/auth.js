import { verifyToken } from '../utils.js';

function bearerToken(req) {
  const header = req.headers['authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Returns the userId from a Bearer token, or null if missing/invalid.
// Deliberately returns null for admin tokens too (they carry no userId) — the two
// token types are separate namespaces, one can't be used in place of the other.
export function getUserId(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const payload = verifyToken(token, process.env.JWT_SECRET);
  return payload ? payload.userId ?? null : null;
}

// Returns true if the request carries a valid admin token, false otherwise.
export function isAdmin(req) {
  const token = bearerToken(req);
  if (!token) return false;
  const payload = verifyToken(token, process.env.JWT_SECRET);
  return !!payload && payload.role === 'admin';
}
