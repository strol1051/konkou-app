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

// Dossier de données persistant — le même que celui de la base SQLite (donc sur le
// disque persistant de Render en production, voir render.yaml). Utilisé par
// routes/theme.js pour stocker l'image de fond personnalisée uploadée par l'admin,
// afin qu'elle survive aux redéploiements (contrairement à frontend/, qui est
// entièrement recréé depuis le dépôt à chaque déploiement).
export const DATA_DIR = path.dirname(dbPath);

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
  -- Date de naissance (juillet 2026, exigée à l'inscription joueur comme elle l'était déjà
  -- pour l'inscription agent) — sert uniquement à vérifier les 18 ans au moment de
  -- l'inscription (voir calcAge() dans utils.js et register() dans routes/auth.js) ; jamais
  -- revalidée après coup, donc un compte créé avant cette exigence garde birth_date à NULL
  -- sans que ça bloque quoi que ce soit (login, jeu...).
  birth_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL, -- verify_phone | reset_password
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  payload TEXT, -- inutilisé depuis la refonte de juillet 2026 de la réinitialisation de
                 -- mot de passe (voir forgotPassword() dans routes/auth.js — la demande ne
                 -- transporte plus de mot de passe) ; conservé au cas où un futur usage
                 -- d'issueOtp() aurait besoin d'un payload générique, comme prévu à l'origine
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
  approved_at TEXT,
  -- Numéros NatCash/MonCash (juillet 2026) — fournis à l'inscription/candidature pour le
  -- SUIVI DES REMBOURSEMENTS DE COMMISSION (voir agent_reimbursements plus bas), pas pour
  -- les opérations de dépôt/retrait des joueurs (qui restent en espèces, voir "Comment
  -- fonctionne le retrait cash" dans README.md). "*_name" est optionnel : par défaut le
  -- compte NatCash/MonCash est au nom de l'agent (first_name/last_name), mais l'agent peut
  -- fournir un nom différent si le compte est à un tiers de confiance — voir
  -- validateAgentReimbursementFields() dans routes/agents.js pour la valeur par défaut.
  natcash_number TEXT,
  natcash_name TEXT,
  moncash_number TEXT,
  moncash_name TEXT,
  -- Cycle de remboursement choisi par l'agent à l'inscription (8, 15 ou 22 jours — voir
  -- REIMBURSEMENT_PERIODS_DAYS dans routes/agents.js) : au bout de ce nombre de jours
  -- depuis le dernier remboursement (ou depuis l'activation du compte s'il n'y en a jamais
  -- eu), l'admin lui doit ses commissions accumulées sur la période — voir
  -- computeReimbursementStatus() dans routes/agents.js. 15 jours par défaut si jamais omis.
  reimbursement_period_days INTEGER NOT NULL DEFAULT 15,
  -- Date du dernier remboursement effectué par l'admin (NULL tant qu'aucun remboursement
  -- n'a encore eu lieu, auquel cas approved_at sert de point de départ du premier cycle —
  -- voir computeReimbursementStatus()). Avance à chaque remboursement confirmé
  -- (confirmAgentReimbursement() dans routes/admin.js), ce qui démarre automatiquement le
  -- cycle suivant.
  last_reimbursed_at TEXT
);

-- Historique des remboursements de commission effectués par l'admin à un agent, par
-- virement NatCash/MonCash (juillet 2026) — voir le commentaire sur reimbursement_period_days
-- ci-dessus. Contrairement aux dépôts/renflouements (initiés par l'agent, puis confirmés par
-- l'admin), c'est ici l'ADMIN qui doit de l'argent à l'AGENT : chaque ligne représente donc
-- un remboursement DÉJÀ effectué (pas une demande "pending" à confirmer plus tard), servant
-- de justificatif/historique consultable. period_start/period_end bornent exactement la
-- fenêtre de retraits couverte (commission_htg = somme de cashouts.commission_htg des
-- retraits payés par cet agent dans cette fenêtre, voir getAgentsGlobalReport pour le même
-- calcul appliqué à une période arbitraire plutôt qu'au cycle propre de l'agent).
CREATE TABLE IF NOT EXISTS agent_reimbursements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  commission_htg REAL NOT NULL,
  withdrawals_count INTEGER NOT NULL DEFAULT 0,
  withdrawals_htg REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL, -- 'natcash' | 'moncash'
  created_at TEXT DEFAULT (datetime('now'))
);

-- Abonnements aux notifications push (voir backend/webpush.js et routes/push.js, juillet
-- 2026) : un navigateur qui a accepté de recevoir des notifications enregistre ici son
-- "endpoint" (URL propre au service de push du navigateur — Chrome/Firefox/etc., unique
-- par appareil+navigateur) et les deux clés nécessaires pour chiffrer un message à son
-- intention (p256dh, auth — voir RFC 8291). subject_type distingue deux populations qui ne
-- reçoivent jamais les mêmes notifications : 'admin' (n'importe quel navigateur connecté à
-- /admin.html, pas de user_id — un seul mot de passe admin partagé, voir login() dans
-- routes/admin.js) et 'user' (un joueur/agent précis, identifié par user_id, qui ne reçoit
-- que les notifications qui LE concernent, ex: sa propre demande de réinitialisation
-- autorisée). endpoint est UNIQUE : un même navigateur qui se réabonne (ex: après avoir
-- effacé ses données) remplace simplement son ancienne ligne plutôt que d'en accumuler une
-- par abonnement successif — voir subscribePush() dans routes/push.js (INSERT OR REPLACE).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL, -- 'admin' | 'user'
  user_id INTEGER, -- NULL pour 'admin' ; référence users.id pour 'user'
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
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

-- Abonnement VIP payant (juillet 2026, revue de rentabilité) : un joueur paie
-- VIP_PRICE_HTG en espèces chez un agent (comme un dépôt) pour VIP_DURATION_DAYS jours
-- d'avantages (plus de parties gratuites/jour — voir routes/games.js, playAllowance).
-- Contrairement aux dépôts, ce montant n'est PAS déduit du crédit revendable de
-- l'agent : c'est un produit propre à la plateforme, l'agent n'est qu'un point de
-- collecte du paiement en espèces (à vous remettre intégralement, hors app, comme le
-- reste de la comptabilité agent). "amount_htg" est donc entièrement le revenu de
-- Konkou une fois confirmé, contrairement à platform_fee_htg sur les dépôts/retraits
-- qui n'en représente qu'une partie.
CREATE TABLE IF NOT EXISTS vip_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  agent_id INTEGER,
  amount_htg REAL NOT NULL,
  duration_days INTEGER NOT NULL,
  code TEXT NOT NULL,
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

-- Garde une trace des numéros dont le compte a été supprimé (joueur ou agent), même
-- après que la ligne "users" correspondante a disparu — sert uniquement à empêcher le
-- cycle "s'inscrire → toucher les 100 pts de bienvenue → supprimer le compte →
-- réinscrire le même numéro" de fabriquer des points à l'infini (voir routes/auth.js,
-- register, et routes/account.js, performDelete, qui alimente cette table). Le numéro
-- reste réutilisable pour un nouveau compte — seul le bonus de bienvenue est concerné.
CREATE TABLE IF NOT EXISTS deleted_phones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  deleted_at TEXT DEFAULT (datetime('now'))
);

-- Défi du jour (juillet 2026, refondu ensuite en un mode "tout ou rien" — voir
-- routes/games.js) : une TENTATIVE explicite et distincte des parties normales (questions
-- très difficiles, aucune mise), au plus une par joueur et par jour civil. La contrainte
-- UNIQUE(user_id, claim_date) garantissait à l'origine qu'une seule RÉCOMPENSE ne pouvait
-- être créditée par jour ; elle sert maintenant à garantir qu'une seule TENTATIVE (réussie
-- OU échouée) est possible par jour — un échec consomme la tentative du jour tout autant
-- qu'une réussite, pour empêcher un joueur de reperdre 75% de son solde en boucle jusqu'à
-- réussir. outcome/points_delta (voir migration plus bas) précisent le résultat exact de
-- cette tentative unique.
CREATE TABLE IF NOT EXISTS daily_challenge_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  claim_date TEXT NOT NULL,
  game_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  reward_points INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, claim_date)
);

-- Suivi "déjà vu" par joueur (juillet 2026) : empêche qu'une question de quiz (kind
-- 'trivia'/'trivia_hard', item_key = id de la question) ou qu'un calcul de sprint (kind
-- 'puzzle'/'puzzle_hard', item_key = son texte, ex. "7 + 3") ne soit jamais reproposé au
-- même joueur tant que des éléments non-encore-vus restent disponibles dans le pool
-- concerné — voir pickUnique() dans routes/games.js. last_seen_at sert de file d'attente
-- (les plus anciennement vus sont réutilisés en priorité) une fois le pool épuisé, pour
-- que la reprise soit aussi peu perceptible que possible plutôt qu'une réinitialisation
-- brutale. 'kind' sépare quatre pools indépendants (quiz normal, quiz du défi du jour,
-- sprint normal, sprint du défi du jour) : un joueur peut donc revoir une question du quiz
-- normal au sprint... non, plus précisément, chaque pool a son propre cycle, aucun ne
-- déborde sur un autre.
CREATE TABLE IF NOT EXISTS user_seen_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  item_key TEXT NOT NULL,
  last_seen_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, kind, item_key)
);

-- Tchat interne Admin <-> joueur/agent (juillet 2026) — remplace le mécanisme de
-- confirmation par WhatsApp après le blocage du numéro opérateur (trop de messages
-- automatiques envoyés par des inconnus à un même numéro = signal de spam pour WhatsApp,
-- voir routes/chat.js). Trois usages regroupés ici, distingués par "purpose" :
-- 'verify_phone'/'reset_password' (remplace l'envoi du code par WhatsApp — la personne
-- indique son code dans la conversation, l'admin compare avec ce qu'affiche déjà l'onglet
-- Vérifications, la logique de confirmation elle-même dans routes/admin.js est INCHANGÉE)
-- et 'support' (ex-formulaire "Nous contacter", + support en continu pour un joueur/agent
-- déjà connecté). "secret" est le jeton qui prouve le droit de lire/écrire dans une
-- conversation AVANT toute connexion : pour verify_phone/reset_password c'est le même code
-- que otp_codes.code (aucun nouveau secret à gérer, voir otpRequestExists() dans otp.js) ;
-- pour 'support' c'est un jeton aléatoire propre à la conversation, généré au tout premier
-- message (voir sendAnonymousMessage() dans routes/chat.js). NULL pour tout message envoyé
-- par un utilisateur déjà connecté (via /api/chat/send, authentifié par son jeton de
-- session — pas besoin d'un secret séparé dans ce cas).
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose TEXT NOT NULL, -- 'verify_phone' | 'reset_password' | 'support'
  phone TEXT NOT NULL,
  secret TEXT,
  display_name TEXT,
  sender TEXT NOT NULL, -- 'admin' | 'user'
  body TEXT NOT NULL,
  read_by_admin INTEGER NOT NULL DEFAULT 0,
  read_by_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
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
  "ALTER TABLE agents ADD COLUMN platform_fee_htg REAL NOT NULL DEFAULT 0",
  // Ville/adresse du point de service de l'agent — collectées à la candidature,
  // affichées au joueur lors du choix d'un agent pour un dépôt/retrait (voir
  // routes/agents.js, listActiveAgents) pour qu'il sache où se rendre.
  "ALTER TABLE agents ADD COLUMN city TEXT",
  "ALTER TABLE agents ADD COLUMN address TEXT",
  // Commission figée au moment du paiement du retrait (comme platform_fee_htg déjà
  // ci-dessus) — permet un filtre "commission par jour" fiable côté agent même si
  // AGENT_CASHOUT_COMMISSION_PERCENT change plus tard (voir routes/agents.js,
  // getAgentCommissionByDay). Les lignes payées avant cette migration valent 0 ici —
  // le total historique affiché à l'agent reste basé sur agents.commission_earned,
  // qui lui a toujours été correctement incrémenté.
  "ALTER TABLE cashouts ADD COLUMN commission_htg REAL NOT NULL DEFAULT 0",
  // Frais de service sur les dépôts (juillet 2026, revue de rentabilité) — même principe
  // que platform_fee_htg sur les cashouts : figé au moment du dépôt, réduit le nombre de
  // parties bonus accordées (deposits.plays_granted) sans toucher au crédit débité chez
  // l'agent (voir routes/deposits.js, postDeposit).
  "ALTER TABLE deposits ADD COLUMN platform_fee_htg REAL NOT NULL DEFAULT 0",
  // Date jusqu'à laquelle un compte joueur est VIP (NULL = jamais été VIP, ou expiré et
  // pas encore renouvelé) — voir vip_purchases ci-dessus et routes/vip.js.
  "ALTER TABLE users ADD COLUMN vip_until TEXT",
  // Début de la période VIP EN COURS (juillet 2026) — distinct de vip_until : posée une
  // seule fois quand le VIP passe d'inactif/expiré à actif, puis jamais retouchée tant
  // que les renouvellements suivants arrivent avant l'expiration (ils prolongent
  // vip_until sans redémarrer la période). Repasse à une nouvelle valeur seulement si le
  // VIP a expiré puis est réactivé plus tard. Voir routes/agents.js (agentConfirmVip) et
  // routes/admin.js (confirmVipPurchase), qui la posent toutes les deux (deux chemins de
  // confirmation possibles pour un même achat VIP), et routes/vip.js (getVipStatus) qui
  // l'expose au joueur.
  "ALTER TABLE users ADD COLUMN vip_activated_at TEXT",
  // Achat de points chez l'agent (juillet 2026) — voir routes/deposits.js, postDeposit et
  // "Pourquoi les dépôts ne sont pas retirables" plus haut. non_cashable_points suit la
  // portion du solde de points venant d'un achat (et non d'une performance de jeu), pour
  // qu'elle ne puisse jamais être retirée en espèces : routes/wallet.js (postCashout)
  // plafonne tout retrait à max(0, points - non_cashable_points), jamais au solde total.
  // N'est incrémentée QUE lors de la confirmation d'un dépôt de type 'points' (voir
  // agentConfirmDeposit dans routes/agents.js et confirmDeposit dans routes/admin.js) —
  // les points gagnés en jouant, en mise ou en parrainage n'y touchent jamais, donc le
  // solde retirable ne peut qu'augmenter avec ceux-là.
  "ALTER TABLE users ADD COLUMN non_cashable_points INTEGER NOT NULL DEFAULT 0",
  // 'plays' (comportement historique, parties bonus) ou 'points' (nouveau, achat direct
  // de points non retirables) — voir routes/deposits.js, postDeposit.
  "ALTER TABLE deposits ADD COLUMN kind TEXT NOT NULL DEFAULT 'plays'",
  // Rempli uniquement quand kind = 'points' (plays_granted reste à 0 dans ce cas, et
  // inversement) — voir routes/deposits.js, postDeposit.
  "ALTER TABLE deposits ADD COLUMN points_granted INTEGER NOT NULL DEFAULT 0",
  // Résultat de la tentative unique du Défi du jour (juillet 2026, refonte "tout ou
  // rien") — 'won' ou 'lost' (timeout compris, voir routes/games.js). Les lignes créées
  // avant cette migration étaient toutes des réussites (seule une réussite créait une
  // ligne à l'époque), donc DEFAULT 'won' reste exact pour l'historique existant.
  "ALTER TABLE daily_challenge_claims ADD COLUMN outcome TEXT NOT NULL DEFAULT 'won'",
  // Variation nette de points appliquée par cette tentative : +DAILY_CHALLENGE_REWARD_POINTS
  // si outcome='won', -(75% du solde au moment de l'échec) si outcome='lost'. Champ
  // d'affichage/historique uniquement (le solde réel est déjà à jour via users.points et
  // la transaction associée) — les lignes historiques valent 0 ici, sans conséquence.
  "ALTER TABLE daily_challenge_claims ADD COLUMN points_delta INTEGER NOT NULL DEFAULT 0",
  // Voir le commentaire sur la colonne birth_date dans la table users ci-dessus — même
  // logique que pour bonus_plays/vip_until : les bases créées avant cette migration
  // rattrapent la colonne, NULL pour tous les comptes existants.
  "ALTER TABLE users ADD COLUMN birth_date TEXT",
  // Voir les commentaires sur ces colonnes dans la table agents ci-dessus (NatCash/MonCash
  // + plan de remboursement, juillet 2026). Les agents déjà actifs avant cette migration
  // gardent natcash_number/moncash_number à NULL (à compléter manuellement si besoin, hors
  // app) et reimbursement_period_days au défaut de 15 jours, last_reimbursed_at NULL — leur
  // premier cycle démarrera donc depuis leur date d'activation (approved_at), comme pour un
  // agent qui vient tout juste d'être approuvé.
  "ALTER TABLE agents ADD COLUMN natcash_number TEXT",
  "ALTER TABLE agents ADD COLUMN natcash_name TEXT",
  "ALTER TABLE agents ADD COLUMN moncash_number TEXT",
  "ALTER TABLE agents ADD COLUMN moncash_name TEXT",
  "ALTER TABLE agents ADD COLUMN reimbursement_period_days INTEGER NOT NULL DEFAULT 15",
  "ALTER TABLE agents ADD COLUMN last_reimbursed_at TEXT"
]) {
  try { db.exec(stmt); } catch { /* column already exists */ }
}

export default db;
