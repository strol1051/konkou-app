import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In production, set DB_PATH to a file on a persistent disk (e.g. Render's disk is
// mounted at /var/data) so the database survives deploys/restarts. Defaults to a file
// next to this script, which is fine for local development.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'konkou.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 100,
  referral_code TEXT UNIQUE NOT NULL,
  referred_by TEXT,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  bonus_plays INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL, -- verify_phone | reset_password
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  payload TEXT, -- reset_password stashes the new (hashed) password here until an admin confirms
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  game_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  points_earned INTEGER NOT NULL,
  played_at TEXT DEFAULT (datetime('now'))
);

-- "method" makes the payout channel pluggable: cash_pickup today, natcash/moncash
-- can be re-enabled later (once an API access is sorted out) without changing this
-- schema — they'd just populate payout_info with a phone number instead of a code.
-- "htg_amount" stays the gross value of the points cashed out (what the agent's 10%
-- commission is calculated on, unchanged). "platform_fee_htg" is the new tiered
-- service fee (5/6/8% by amount) taken on top, as pure platform revenue — it reduces
-- "net_payout_htg" (what the agent actually hands the user in cash) without touching
-- the agent's commission or the points deducted from the user's balance.
CREATE TABLE IF NOT EXISTS cashouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  points INTEGER NOT NULL,
  htg_amount REAL NOT NULL,
  platform_fee_htg REAL NOT NULL DEFAULT 0,
  net_payout_htg REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'cash_pickup', -- cash_pickup | natcash | moncash
  payout_info TEXT NOT NULL, -- pickup code for cash_pickup, phone number for natcash/moncash
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | rejected
  requested_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT
);

-- Cash deposited in person at an agent. This is a ONE-WAY purchase of bonus plays
-- (credited to users.bonus_plays once the assigned agent confirms) — deposited money
-- is never convertible back to withdrawable points/cash. Only performance-earned
-- points can be cashed out via the "cashouts" table above. "agent_id" is set from the
-- agent code the user typed in, and determines whose credit_balance gets debited.
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  agent_id INTEGER,
  htg_amount REAL NOT NULL,
  plays_granted INTEGER NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | rejected
  requested_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT
);

-- Agents: regular Konkou users (see "user_id") who applied in-app to also run a cash
-- point. "credit_balance" is the resellable inventory bought with their 7500 HTG
-- capital deposit (minus the platform's cut), spent down as they confirm deposits.
-- "commission_earned" is a running, informational-only tally of the 10% they've earned
-- on cashouts they've paid — settled with them outside the app for now.
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  id_type TEXT NOT NULL, -- cin | passeport | permis
  id_number TEXT,        -- optionnel
  agent_code TEXT UNIQUE NOT NULL, -- 3 lettres du nom + 2 du prénom (+ suffixe si collision)
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active | rejected
  credit_balance REAL NOT NULL DEFAULT 0,
  commission_earned REAL NOT NULL DEFAULT 0,
  capital_htg REAL NOT NULL DEFAULT 7500,
  -- Gross amount of the agent's most recent (confirmed) capital deposit — the initial
  -- capital_htg at first approval, then updated to each refill's requested amount once
  -- confirmed. Drives the "+25% max per refill" ceiling in routes/agents.js.
  last_capital_deposit_htg REAL NOT NULL DEFAULT 0,
  -- Platform fee collected at approval (capital_htg * AGENT_CAPITAL_FEE_PERCENT / 100),
  -- snapshotted here (not recomputed later) so it stays correct even if the fee % env
  -- var changes afterward. Powers the revenue summary in /admin.html.
  platform_fee_htg REAL NOT NULL DEFAULT 0,
  applied_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT
);

-- Additional capital an already-active agent brings in later to grow their resellable
-- credit ("renflouement"). Each refill's ceiling is 125% of the agent's previous
-- deposit (see agents.last_capital_deposit_htg) — a growing credit line that rewards
-- agents who keep operating, while the fee (7% by default) is new recurring platform
-- revenue on top of the one-time fee taken at initial approval.
CREATE TABLE IF NOT EXISTS agent_refills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  amount_htg REAL NOT NULL,
  fee_percent REAL NOT NULL,
  platform_fee_htg REAL NOT NULL,
  credited_htg REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | rejected
  requested_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT
);

-- Petite table clé/valeur pour les réglages modifiables par l'admin sans redéploiement
-- (contrairement aux variables d'environnement comme OPERATOR_WHATSAPP_NUMBER, qui
-- nécessitent de changer la config Render). Utilisée pour l'instant uniquement pour le
-- numéro WhatsApp qui reçoit les messages de "Nous contacter" (voir routes/contact.js).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

// Lightweight migrations for databases created before these columns existed.
// SQLite's ALTER TABLE ADD COLUMN is a no-op-safe operation to retry; ignore the
// "duplicate column" error when it's already been applied.
for (const stmt of [
  "ALTER TABLE users ADD COLUMN bonus_plays INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE otp_codes ADD COLUMN payload TEXT",
  "ALTER TABLE deposits ADD COLUMN agent_id INTEGER",
  "ALTER TABLE cashouts ADD COLUMN agent_id INTEGER",
  "ALTER TABLE cashouts ADD COLUMN platform_fee_htg REAL NOT NULL DEFAULT 0",
  "ALTER TABLE cashouts ADD COLUMN net_payout_htg REAL NOT NULL DEFAULT 0",
  "ALTER TABLE agents ADD COLUMN last_capital_deposit_htg REAL NOT NULL DEFAULT 0",
  "ALTER TABLE agents ADD COLUMN platform_fee_htg REAL NOT NULL DEFAULT 0"
]) {
  try { db.exec(stmt); } catch { /* column already exists */ }
}

export default db;
