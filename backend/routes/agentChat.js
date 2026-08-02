import db from '../db.js';
import { resolveActiveAgentId, getAgentUserId } from './agents.js';
import { notifyUser } from './push.js';

// Tchat interne Joueur <-> Agent (août 2026) — même motivation et même architecture que
// routes/chat.js (Admin <-> joueur/agent) : WhatsApp a bloqué le numéro opérateur pour
// excès de messages, et le bouton "💬 Contacter cet agent" exposait le numéro WhatsApp
// PERSONNEL de chaque agent au même risque (voir agentContactWhatsappLink() supprimé côté
// app.js). Voir le commentaire complet sur la table agent_chat_messages dans db.js pour le
// contexte détaillé.
//
// Différences volontaires avec routes/chat.js :
// - Les DEUX parties sont TOUJOURS authentifiées ici (joueur connecté ET agent connecté) —
//   jamais de "secret" pour un accès anonyme, puisqu'un joueur non connecté ne peut de toute
//   façon pas choisir d'agent (le choix d'agent n'existe que dans les écrans dépôt/retrait/
//   VIP, tous derrière une session valide).
// - La conversation est scopée par la paire (player_user_id, agent_id), pas par un numéro
//   de téléphone.
// - Un agent ne peut JAMAIS initier une conversation lui-même — seulement répondre à un fil
//   déjà ouvert par le joueur (voir sendAgentMessage ci-dessous). C'est la même logique que
//   l'ancien bouton "Contacter cet agent" : c'est toujours le joueur qui fait le premier pas.

const MESSAGE_MAX_LEN = 1000;

// Best-effort, jamais bloquant — même pattern que notifyAdminsSilently/notifyUserSilently
// dans routes/chat.js et routes/admin.js.
function notifyUserSilently(userId, payloadObj) {
  notifyUser(userId, payloadObj).catch(() => {});
}

function validateMessageBody(text) {
  const body = String(text || '').trim();
  if (!body) return { error: 'Message requis' };
  if (body.length > MESSAGE_MAX_LEN) return { error: `Le message ne peut pas dépasser ${MESSAGE_MAX_LEN} caractères` };
  return { body };
}

// Dupliqué depuis routes/agents.js à l'identique (non exporté là-bas) — même convention
// déjà en place dans ce projet pour ce garde précis (voir aussi le commentaire dans
// getAgentDashboard()).
function requireActiveAgent(userId) {
  return db.prepare("SELECT * FROM agents WHERE user_id = ? AND status = 'active'").get(userId);
}

// ---------- Joueur (toujours connecté — voir server.js, requireAuth) ----------

export function sendPlayerMessage(playerUserId, body) {
  const { agentCode, body: text } = body || {};
  const agentId = resolveActiveAgentId(agentCode);
  if (!agentId) return { status: 404, data: { error: 'Agent introuvable ou inactif' } };

  const { body: messageBody, error: bodyError } = validateMessageBody(text);
  if (bodyError) return { status: 400, data: { error: bodyError } };

  db.prepare(
    `INSERT INTO agent_chat_messages (player_user_id, agent_id, sender, body) VALUES (?, ?, 'player', ?)`
  ).run(playerUserId, agentId, messageBody);

  const agentUserId = getAgentUserId(agentId);
  const player = db.prepare('SELECT name FROM users WHERE id = ?').get(playerUserId);
  if (agentUserId) {
    notifyUserSilently(agentUserId, {
      title: 'Konkou — Nouveau message',
      body: `${player?.name || 'Un joueur'} : ${messageBody.slice(0, 80)}`,
      url: '/'
    });
  }

  return { status: 200, data: { message: 'Message envoyé.' } };
}

// Sondé par le frontend tant que l'écran de tchat agent est ouvert (voir
// startAgentChatPolling() dans app.js) — même mécanisme que getAnonymousMessages/
// getAuthedMessages dans routes/chat.js.
export function getPlayerMessages(playerUserId, query) {
  const { agentCode } = query || {};
  const agentId = resolveActiveAgentId(agentCode);
  if (!agentId) return { status: 404, data: { error: 'Agent introuvable ou inactif' } };

  const rows = db.prepare(
    `SELECT id, sender, body, created_at FROM agent_chat_messages WHERE player_user_id = ? AND agent_id = ? ORDER BY id ASC`
  ).all(playerUserId, agentId);
  db.prepare(
    `UPDATE agent_chat_messages SET read_by_player = 1 WHERE player_user_id = ? AND agent_id = ? AND sender = 'agent' AND read_by_player = 0`
  ).run(playerUserId, agentId);

  return { status: 200, data: { messages: rows } };
}

// ---------- Agent (toujours connecté — voir server.js, requireAuth) ----------

// Liste groupée par joueur — une "conversation" du point de vue de l'agent, quel que soit
// le nombre de messages échangés. Ne peut par construction contenir que des joueurs ayant
// DÉJÀ écrit au moins un message (chaque ligne vient d'un INSERT dans agent_chat_messages,
// et la toute première pour une paire donnée est nécessairement sender='player' — voir la
// règle "l'agent ne peut jamais initier" appliquée dans sendAgentMessage ci-dessous).
export function listAgentThreads(userId) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };

  const rows = db.prepare(`
    SELECT m.player_user_id, u.name as player_name, u.phone as player_phone,
      MAX(m.created_at) as last_message_at,
      SUM(CASE WHEN m.sender = 'player' AND m.read_by_agent = 0 THEN 1 ELSE 0 END) as unread_count
    FROM agent_chat_messages m JOIN users u ON u.id = m.player_user_id
    WHERE m.agent_id = ?
    GROUP BY m.player_user_id
    ORDER BY last_message_at DESC
  `).all(agent.id);

  return { status: 200, data: { threads: rows } };
}

export function getAgentThreadMessages(userId, query) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };

  const playerUserId = parseInt(query?.playerUserId, 10);
  if (!playerUserId) return { status: 400, data: { error: 'Requête invalide' } };

  const rows = db.prepare(
    `SELECT id, sender, body, created_at FROM agent_chat_messages WHERE player_user_id = ? AND agent_id = ? ORDER BY id ASC`
  ).all(playerUserId, agent.id);
  db.prepare(
    `UPDATE agent_chat_messages SET read_by_agent = 1 WHERE player_user_id = ? AND agent_id = ? AND sender = 'player' AND read_by_agent = 0`
  ).run(playerUserId, agent.id);

  return { status: 200, data: { messages: rows } };
}

export function sendAgentMessage(userId, body) {
  const agent = requireActiveAgent(userId);
  if (!agent) return { status: 403, data: { error: 'Compte agent introuvable ou non actif' } };

  const { playerUserId: rawPlayerUserId, body: text } = body || {};
  const playerUserId = parseInt(rawPlayerUserId, 10);
  if (!playerUserId) return { status: 400, data: { error: 'Requête invalide' } };

  // Règle volontaire (voir le commentaire en tête de fichier et sur la table
  // agent_chat_messages dans db.js) : un agent ne peut RÉPONDRE qu'à un fil déjà ouvert par
  // le joueur, jamais en démarrer un lui-même. On exige donc qu'au moins un message
  // sender='player' existe déjà pour cette paire avant d'accepter la réponse.
  const existing = db.prepare(
    `SELECT 1 FROM agent_chat_messages WHERE player_user_id = ? AND agent_id = ? AND sender = 'player' LIMIT 1`
  ).get(playerUserId, agent.id);
  if (!existing) return { status: 400, data: { error: 'Ce joueur ne vous a pas encore écrit.' } };

  const { body: messageBody, error: bodyError } = validateMessageBody(text);
  if (bodyError) return { status: 400, data: { error: bodyError } };

  db.prepare(
    `INSERT INTO agent_chat_messages (player_user_id, agent_id, sender, body, read_by_agent) VALUES (?, ?, 'agent', ?, 1)`
  ).run(playerUserId, agent.id, messageBody);

  notifyUserSilently(playerUserId, {
    title: 'Konkou — Nouveau message de votre agent',
    body: messageBody.slice(0, 120),
    url: '/'
  });

  return { status: 200, data: { message: 'Réponse envoyée.' } };
}
