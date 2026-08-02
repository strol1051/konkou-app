// Konkou - mini interface agent/gestionnaire : payer/rejeter les retraits, confirmer les
// inscriptions/réinitialisations via le tchat interne, confirmer/rejeter les dépôts de
// parties bonus. Page volontairement séparée de l'app principale (pas de lien depuis
// app.js) : ce n'est pas un compte utilisateur, c'est un accès protégé par le mot de passe
// ADMIN_PASSWORD.

import { isPushSubscribed, notificationsToggleHtml, bindNotificationsToggleEvents } from './push-client.js';

const APP = document.getElementById('app');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Tchat interne (juillet 2026, voir routes/chat.js) — mêmes bulles que côté joueur/agent
// (app.js), orientation inversée : le message de l'ADMIN est "le sien" ici (aligné à
// droite), voir .chat-msg-self/.chat-msg-other dans styles.css.
function chatBubbleHtml(m) {
  const isAdmin = m.sender === 'admin';
  return `<div class="chat-msg ${isAdmin ? 'chat-msg-self' : 'chat-msg-other'}">
    <span class="chat-msg-author">${isAdmin ? 'Vous (admin)' : 'Utilisateur'}</span>
    <p>${escapeHtml(m.body)}</p>
  </div>`;
}

// Champ mot de passe avec bouton "œil" — voir app.js pour la même logique côté joueur.
function pwdField(name, placeholder) {
  return `
    <div class="pwd-wrap">
      <input name="${name}" type="password" placeholder="${escapeHtml(placeholder)}" required />
      <button type="button" class="pwd-toggle" aria-label="Afficher le mot de passe">👁</button>
    </div>
  `;
}

APP.addEventListener('click', (e) => {
  const btn = e.target.closest('.pwd-toggle');
  if (!btn) return;
  const input = btn.previousElementSibling;
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.textContent = showing ? '👁' : '🙈';
  btn.setAttribute('aria-label', showing ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
});

// ---------- THÈME SAISONNIER — voir app.js pour la documentation complète, logique
// identique côté admin pour que /admin.html reflète le même thème que l'app joueur. ----------
const THEMES = {
  default: { label: '🇭🇹 Défaut', vars: {}, particle: null },
  noel: {
    label: '🎄 Noël',
    vars: { '--blue': '#7a0c0c', '--blue-2': '#0d3b1e', '--red': '#c9a227', '--bg': '#0d1210', '--card': '#17241c', '--card-2': '#1f3226' },
    particle: '❄️'
  },
  nouvel_an: {
    label: '🎆 Nouvel An',
    vars: { '--blue': '#1a1a1a', '--blue-2': '#3a2f00', '--red': '#f4c542', '--bg': '#0a0a0a', '--card': '#171512', '--card-2': '#221d15' },
    particle: '🎉'
  },
  ete: {
    label: '☀️ Été',
    vars: { '--blue': '#0077b6', '--blue-2': '#00b4d8', '--red': '#ff9f1c', '--bg': '#072a3a', '--card': '#0e3a4d', '--card-2': '#14495f' },
    particle: '☀️'
  },
  paques: {
    label: '🐣 Pâques',
    vars: { '--blue': '#6a4c93', '--blue-2': '#b298dc', '--red': '#ff8fa3', '--bg': '#1c1526', '--card': '#2a1f38', '--card-2': '#362848' },
    particle: '🌸'
  },
  gede: {
    label: '💜 Fèt Gede',
    vars: { '--blue': '#1a1a1a', '--blue-2': '#3d0a4f', '--red': '#9b30ff', '--bg': '#120a17', '--card': '#1e1224', '--card-2': '#2a1830' },
    particle: '🕯️'
  },
  valentin: {
    label: '❤️ Saint-Valentin',
    vars: { '--blue': '#7a0e2b', '--blue-2': '#c9184a', '--red': '#ff4d6d', '--bg': '#1a0a10', '--card': '#2a121c', '--card-2': '#3a1826' },
    particle: '💕'
  },
  rentree: {
    label: '🎒 Rentrée des classes',
    vars: { '--blue': '#0f4c3a', '--blue-2': '#1b6a4f', '--red': '#ffb703', '--bg': '#0a1f18', '--card': '#123527', '--card-2': '#1a4432' },
    particle: '✏️'
  }
};

// Assombrit une couleur hex ("#rrggbb") d'un facteur (0–1) — voir app.js pour la
// documentation complète (même fonction, dupliquée ici car admin.js/app.js ne partagent
// pas de module commun).
function darkenHex(hex, factor) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const channel = (shift) => Math.round(((num >> shift) & 255) * factor).toString(16).padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

function applyThemeVars(themeKey, bgColor, blueColor, cardColor) {
  const theme = THEMES[themeKey] || THEMES.default;
  const root = document.documentElement.style;
  ['--blue', '--blue-2', '--red', '--bg', '--card', '--card-2'].forEach(v => root.removeProperty(v));
  Object.entries(theme.vars).forEach(([k, v]) => root.setProperty(k, v));
  // Couleur de fond personnalisée (indépendante du thème) — surcharge --bg si définie.
  if (bgColor) root.setProperty('--bg', bgColor);
  // Couleur bleu foncé personnalisée (indépendante du thème) — surcharge --blue ; --blue-2
  // est dérivée automatiquement (assombrie) — voir app.js pour la documentation complète.
  if (blueColor) {
    root.setProperty('--blue', blueColor);
    root.setProperty('--blue-2', darkenHex(blueColor, 0.55));
  }
  // Couleur des cartes personnalisée (indépendante du thème) — surcharge --card ; --card-2
  // dérivée automatiquement (léger assombrissement) — voir app.js pour la documentation
  // complète, y compris le calcul du texte adaptatif (--card-text/--card-muted).
  if (cardColor) {
    root.setProperty('--card', cardColor);
    root.setProperty('--card-2', darkenHex(cardColor, 0.9));
  }
  updateCardContrastColor();
}

// Convertit une couleur CSS ("#rgb", "#rrggbb", "rgb(r, g, b)") en triplet [r, g, b], ou
// null — voir app.js pour la documentation complète (même fonction, dupliquée ici).
function parseColorToRgb(str) {
  const s = String(str || '').trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) return m[1].split('').map(c => parseInt(c + c, 16));
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)].map(h => parseInt(h, 16));
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  return null;
}

// Luminance relative standard (WCAG) — voir app.js pour la documentation complète.
function relativeLuminance([r, g, b]) {
  const srgb = [r, g, b].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

// Convertit un hex en "rgba(r, g, b, alpha)" — voir app.js pour la documentation complète.
function hexToRgbaString(hex, alpha) {
  const rgb = parseColorToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

// Texte des cartes adaptatif (--card-text/--card-muted) — voir app.js pour la
// documentation complète (même logique, dupliquée ici).
function updateCardContrastColor() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--card');
  const rgb = parseColorToRgb(raw);
  const root = document.documentElement.style;
  if (!rgb) { root.removeProperty('--card-text'); root.removeProperty('--card-muted'); return; }
  // Choix rouge/bleu basé sur la teinte du fond, pas le ratio de contraste WCAG — voir
  // app.js pour la documentation complète (même logique, dupliquée ici).
  const isLight = relativeLuminance(rgb) > 0.5;
  if (isLight) {
    const pick = rgb[0] >= rgb[2] ? '#00209f' : '#d21034';
    root.setProperty('--card-text', pick);
    root.setProperty('--card-muted', hexToRgbaString(pick, 0.72));
  } else {
    root.setProperty('--card-text', '#ffffff');
    root.setProperty('--card-muted', 'rgba(255, 255, 255, 0.68)');
  }
}
updateCardContrastColor(); // valeur initiale avant même la réponse de /api/theme

function applyThemeParticles(themeKey) {
  const theme = THEMES[themeKey] || THEMES.default;
  let container = document.getElementById('theme-particles');
  if (!container) {
    container = document.createElement('div');
    container.id = 'theme-particles';
    document.body.insertBefore(container, document.body.firstChild);
  }
  container.innerHTML = '';
  if (!theme.particle) return;
  const COUNT = 16;
  for (let i = 0; i < COUNT; i++) {
    const span = document.createElement('span');
    span.className = 'particle';
    span.textContent = theme.particle;
    const left = Math.random() * 100;
    const duration = 10 + Math.random() * 12;
    const delay = Math.random() * -20;
    const size = 14 + Math.random() * 14;
    span.style.left = `${left}vw`;
    span.style.fontSize = `${size}px`;
    span.style.animationDuration = `${duration}s`;
    span.style.animationDelay = `${delay}s`;
    container.appendChild(span);
  }
}

// Logo personnalisé — voir app.js pour la documentation complète.
let logoUrl = 'logo.png';
function applyLogo(url) {
  logoUrl = url || 'logo.png';
  document.querySelectorAll('.topbar-logo, .auth-logo-img').forEach(img => { img.src = logoUrl; });
}

// Photo de fond personnalisée — voir app.js pour la documentation complète.
function applyBgImage(url) {
  const body = document.body.style;
  if (url) {
    body.setProperty('background-image', `url('${url}')`);
    body.setProperty('background-size', 'cover');
    body.setProperty('background-position', 'center');
    body.setProperty('background-attachment', 'fixed');
    body.setProperty('background-repeat', 'no-repeat');
  } else {
    ['background-image', 'background-size', 'background-position', 'background-attachment', 'background-repeat']
      .forEach(p => body.removeProperty(p));
  }
}

// Photo de fond DÉDIÉE à la barre du haut — voir app.js pour la documentation complète.
function applyTopbarBgImage(url) {
  const root = document.documentElement.style;
  if (url) {
    root.setProperty('--topbar-bg-image', `url('${url}')`);
    root.setProperty('--topbar-overlay', 'linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35))');
  } else {
    root.setProperty('--topbar-bg-image', 'none');
    root.setProperty('--topbar-overlay', 'none');
  }
}

async function applyThemeFromServer() {
  try {
    const res = await fetch('/api/theme');
    const data = await res.json();
    applyThemeVars(data.theme, data.bgColor, data.blueColor, data.cardColor);
    applyThemeParticles(data.theme);
    applyBgImage(data.bgImage);
    applyTopbarBgImage(data.topbarBgImage);
    applyLogo(data.logo);
  } catch {
    // Hors ligne ou erreur réseau : on garde les couleurs par défaut de styles.css.
  }
}
applyThemeFromServer();

// Voir la note équivalente sur refreshPushSubscribedState() dans app.js : vérifié une fois
// en tâche de fond, sans écran de chargement — corrige simplement le libellé initial du
// bouton "🔔 Activer les notifications" (section Réglages) le temps que ça se résolve.
async function refreshPushSubscribedState() {
  const subscribed = await isPushSubscribed();
  if (subscribed !== state.pushSubscribed) state.pushSubscribed = subscribed; // pas de render() ici, voir app.js
}
refreshPushSubscribedState();

// Redimensionne/compresse une photo choisie par l'admin avant de l'envoyer au serveur —
// une photo de téléphone fait souvent plusieurs Mo, alors que 1600px de large en JPEG
// qualité 0.82 suffit largement pour un fond d'écran et passe confortablement sous la
// limite de MAX_BG_IMAGE_BYTES (3 Mo) côté backend/routes/theme.js.
function resizeImageForBg(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Ce fichier n'est pas une image valide"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Redimensionne un logo choisi par l'admin — contrairement à resizeImageForBg (photo),
// on garde le PNG (pas de conversion JPEG) pour préserver la transparence du fond,
// habituelle sur un wordmark/logo. On ne recadre/force aucun ratio : juste un plafond de
// largeur raisonnable (le format recommandé est un bandeau large et bas, environ 20:2).
function resizeImageForLogo(file, maxDim = 1000) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Ce fichier n'est pas une image valide"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const state = {
  token: localStorage.getItem('konkou_admin_token') || null,
  section: 'cashouts', // cashouts | verifications | deposits | agents | refills | revenue
  statusFilter: 'pending',
  verifyPurpose: 'verify_phone', // verify_phone | reset_password
  cashouts: [],
  verifications: [],
  // Conversations du tchat interne (juillet 2026, voir routes/chat.js) associées à chaque
  // demande de l'onglet Vérifications, indexées par numéro de téléphone — chargées en
  // parallèle par loadVerificationChats() juste après loadVerifications(), affichées
  // directement dans chaque carte (voir renderVerificationsSection()) pour comparer le
  // code indiqué par la personne avec celui affiché juste au-dessus, sans changer d'onglet.
  verificationChats: {},
  // Onglet "Messages" (juillet 2026) — conversations purpose='support' (ex-formulaire
  // "Nous contacter" + support en continu pour un joueur/agent connecté), distinctes des
  // conversations verify_phone/reset_password gérées directement dans l'onglet
  // Vérifications ci-dessus. messageThreads = liste groupée (voir listChatThreads dans
  // routes/chat.js) ; openMessageThread = numéro de la conversation actuellement ouverte
  // (null = liste) ; messageThreadMessages = messages de cette conversation ouverte.
  messageThreads: [],
  openMessageThread: null,
  messageThreadMessages: [],
  deposits: [],
  agents: [],
  agentsView: 'list', // list | report | reimbursements — sous-onglet de la section "agents" (voir renderAgentsSection)
  agentsReport: null, // résultat de /admin/agents/report (Rapport global, tous agents)
  reportFrom: '', // borne basse (YYYY-MM-DD) du Rapport global ('' = depuis le début)
  reportTo: '', // borne haute (YYYY-MM-DD) du Rapport global ('' = jusqu'à aujourd'hui)
  agentsReimbursements: null, // résultat de /admin/agents/reimbursements (statut du cycle en cours, par agent actif) — null tant que non chargé
  agentsReimbursementsHistory: [], // résultat de /admin/agents/reimbursements/history (remboursements déjà effectués)
  refills: [],
  vip: [],
  revenue: null,
  players: [], // résultat de /admin/players (onglet "Joueurs") — liste, jamais les agents (voir listPlayers)
  playersTotal: 0, // nombre total de comptes joueur (non filtré par la recherche)
  playersMatching: 0, // nombre de comptes correspondant à la recherche actuelle (= playersTotal sans recherche)
  playersTruncated: false, // vrai si plus de résultats existent que ceux renvoyés (voir PLAYERS_LIST_LIMIT côté serveur)
  playersSearch: '', // terme de recherche actuel (nom ou téléphone) pour l'onglet "Joueurs"
  broadcastTarget: 'players', // 'players' | 'agents' — cible actuelle du formulaire "Envoyer une annonce" (Réglages)
  broadcastResult: null, // dernier résultat de /admin/broadcast/... ({ targeted, sent, expired, target }), null tant que rien n'a été envoyé
  accountLookup: null,
  contactWhatsapp: null, // numéro configuré pour "Nous contacter" (null tant que non défini)
  currentTheme: 'default', // thème saisonnier actif (voir THEMES plus haut)
  bgColor: '', // couleur de fond personnalisée ('' = pas de surcharge, fond du thème actif)
  blueColor: '', // couleur bleu foncé personnalisée ('' = pas de surcharge, bleu du thème actif)
  cardColor: '', // couleur des cartes personnalisée ('' = pas de surcharge, couleur du thème actif)
  adImage: '', // URL du panneau publicitaire ('' = aucun panneau affiché côté joueur/agent)
  bgImage: '', // URL de la photo de fond personnalisée ('' = filigrane logo par défaut)
  topbarBgImage: '', // URL de la photo dédiée à la barre du haut ('' = dégradé du thème actif)
  logo: '', // URL du logo personnalisé ('' = frontend/logo.png par défaut)
  revenueDate: '', // date choisie pour le filtre "Revenus par jour" ('' = tout l'historique)
  // Vrai si CE navigateur admin a déjà un abonnement aux notifications push actif (voir
  // push-client.js) — même principe que state.pushSubscribed dans app.js : rafraîchi une
  // fois au chargement (refreshPushSubscribedState() plus bas), sert uniquement à choisir
  // le libellé du bouton dans la section Réglages.
  pushSubscribed: false,
  error: '',
  success: '',
  loading: false
};

function setState(patch) {
  Object.assign(state, patch);
  render();
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Erreur inconnue');
    err.status = res.status;
    throw err;
  }
  return data;
}

function logout() {
  localStorage.removeItem('konkou_admin_token');
  setState({ token: null, cashouts: [], verifications: [], verificationChats: {}, messageThreads: [], openMessageThread: null, messageThreadMessages: [], deposits: [], agents: [], refills: [], vip: [], revenue: null, players: [], playersSearch: '', accountLookup: null, agentsReimbursements: null, agentsReimbursementsHistory: [], error: '', success: '' });
}

function render() {
  APP.innerHTML = state.token ? renderDashboard() : renderLogin();
  bind();
}

function renderLogin() {
  return `
    <div class="auth-screen">
      <div class="auth-logo">
        <img src="${logoUrl}" alt="Konkou" class="auth-logo-img">
        <div class="tagline">Gestion agent/gestionnaire — retraits, vérifications, dépôts</div>
      </div>
      ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
      <div class="card">
        <h2>Connexion</h2>
        <form id="login-form">
          ${pwdField('password', 'Mot de passe administrateur')}
          <button class="primary" type="submit">Se connecter</button>
        </form>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const sections = [['cashouts', '💸 Retraits'], ['verifications', '💬 Vérifications'], ['messages', '📨 Messages'], ['deposits', '🎟️ Dépôts'], ['vip', '👑 VIP'], ['agents', '🧑‍💼 Agents'], ['refills', '💳 Renflouements'], ['revenue', '📊 Revenus'], ['players', '👥 Joueurs'], ['accounts', '🗑️ Comptes'], ['settings', '⚙️ Réglages']];
  return `
    <div class="topbar">
      <img src="${logoUrl}" alt="Konkou" class="topbar-logo">
      <div style="color:#fff; font-size:13px; font-weight:600;">Gestion</div>
    </div>
    <div class="view">
      ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
      ${state.success ? `<div class="success-banner">${escapeHtml(state.success)}</div>` : ''}
      <div class="grid-2" style="grid-template-columns: repeat(3, 1fr);">
        ${sections.map(([key, label]) => `
          <button class="tile" data-section="${key}" style="font-size:12px; padding:10px 4px; ${state.section === key ? 'outline:2px solid var(--red);' : ''}">${label}</button>
        `).join('')}
      </div>
      ${renderSectionBody()}
      <button class="secondary" id="logout-btn" style="margin-top:20px;">Se déconnecter</button>
    </div>
  `;
}

function renderSectionBody() {
  if (state.loading) return '<div class="center-msg">Chargement...</div>';
  if (state.section === 'cashouts') return renderCashoutsSection();
  if (state.section === 'verifications') return renderVerificationsSection();
  if (state.section === 'messages') return renderMessagesSection();
  if (state.section === 'deposits') return renderDepositsSection();
  if (state.section === 'vip') return renderVipSection();
  if (state.section === 'agents') return renderAgentsSection();
  if (state.section === 'refills') return renderRefillsSection();
  if (state.section === 'revenue') return renderRevenueSection();
  if (state.section === 'players') return renderPlayersSection();
  if (state.section === 'accounts') return renderAccountsSection();
  if (state.section === 'settings') return renderSettingsSection();
  return '';
}

// ---------- Retraits ----------
function renderCashoutsSection() {
  const tabs = [['pending', 'En attente'], ['paid', 'Payés'], ['rejected', 'Rejetés']];
  return `
    <div class="grid-2" style="grid-template-columns: repeat(3, 1fr); margin-top:14px;">
      ${tabs.map(([key, label]) => `
        <button class="tile" data-cashout-filter="${key}" style="font-size:13px; ${state.statusFilter === key ? 'outline:2px solid var(--green);' : ''}">${label}</button>
      `).join('')}
    </div>
    ${state.cashouts.length === 0 ? `<div class="card"><p>Aucune demande "${statusLabel(state.statusFilter)}".</p></div>` : state.cashouts.map(c => `
      <div class="card">
        <h2>${escapeHtml(c.user_name)} — ${escapeHtml(c.user_phone)}</h2>
        <p><strong>${c.points} pts → ${c.htg_amount} HTG</strong></p>
        <p style="font-size:24px; font-weight:800; letter-spacing:3px;">${escapeHtml(c.payout_info)}</p>
        <p style="font-size:12px;">Demandé le ${escapeHtml(c.requested_at)}${c.processed_at ? ` · Traité le ${escapeHtml(c.processed_at)}` : ''}</p>
        ${c.status === 'pending' ? `
          <div class="grid-2" style="margin-top:10px;">
            <button class="tile" data-pay="${c.id}" style="background:rgba(34,197,94,0.2);">✅ Payer</button>
            <button class="tile" data-reject="${c.id}" style="background:rgba(210,16,52,0.2);">❌ Rejeter</button>
          </div>
        ` : `<p>${statusLabel(c.status)}</p>`}
      </div>
    `).join('')}
  `;
}

function statusLabel(status) {
  const map = { pending: '⏳ En attente', paid: '💸 Payé', rejected: '❌ Rejeté', confirmed: '✅ Confirmé', active: '✅ Actif' };
  return map[status] || status;
}

// ---------- Vérifications (WhatsApp) ----------
function renderVerificationsSection() {
  const purposes = [['verify_phone', 'Inscriptions'], ['reset_password', 'Réinitialisations']];
  return `
    <div class="grid-2" style="margin-top:14px;">
      ${purposes.map(([key, label]) => `
        <button class="tile" data-verify-purpose="${key}" style="${state.verifyPurpose === key ? 'outline:2px solid var(--green);' : ''}">${label}</button>
      `).join('')}
    </div>
    <p style="color:var(--muted); font-size:13px; padding:6px 4px;">
      Demandez à la personne son code dans la conversation ci-dessous et comparez-le avec celui affiché avant de confirmer.
    </p>
    ${state.verifications.length === 0 ? `<div class="card"><p>Aucune demande en attente.</p></div>` : state.verifications.map(v => `
      <div class="card">
        <h2>${escapeHtml(v.phone)}</h2>
        <p style="font-size:28px; font-weight:800; letter-spacing:4px; text-align:center;">${escapeHtml(v.code)}</p>
        <p style="font-size:12px;">Demandé le ${escapeHtml(v.requestedAt)} · Expire le ${escapeHtml(v.expiresAt)}</p>
        <div class="chat-thread">
          ${(state.verificationChats[v.phone] || []).length === 0 ? `<p class="chat-empty">Aucun message pour l'instant.</p>` : (state.verificationChats[v.phone] || []).map(chatBubbleHtml).join('')}
        </div>
        <form class="chat-send-form" data-verify-reply-form="${escapeHtml(v.phone)}">
          <textarea placeholder="Répondre..." maxlength="1000" rows="2" required></textarea>
          <button class="primary" type="submit">Envoyer</button>
        </form>
        <input type="text" inputmode="numeric" maxlength="6" placeholder="Recopiez le code indiqué par la personne" data-verify-code-input="${escapeHtml(v.phone)}" style="text-align:center; letter-spacing:2px; font-weight:700; margin-top:10px;" />
        <button class="tile" data-confirm-verify="${escapeHtml(v.phone)}" style="background:rgba(37,211,102,0.2); width:100%; margin-bottom:8px;">✅ Confirmer</button>
        <button class="tile" data-reject-verify="${escapeHtml(v.phone)}" style="background:rgba(210,16,52,0.2); width:100%;">❌ Refuser</button>
      </div>
    `).join('')}
  `;
}

// ---------- Messages ("Nous contacter" + support en continu, voir routes/chat.js) ----------
// Distinct de l'onglet Vérifications ci-dessus : purpose='support' uniquement (formulaire
// "Nous contacter" avant connexion, ou message d'un joueur/agent déjà connecté) — les
// conversations verify_phone/reset_password restent gérées directement dans Vérifications,
// à côté du code de référence, plutôt que dupliquées ici.
function renderMessagesSection() {
  if (state.openMessageThread) {
    const phone = state.openMessageThread;
    const thread = state.messageThreads.find(t => t.phone === phone);
    return `
      <div class="card">
        <button class="link-btn" id="messages-back-btn" style="margin-bottom:10px;">← Retour à la liste</button>
        <h2>${escapeHtml(thread?.display_name || phone)}</h2>
        <p style="font-size:12px; color:var(--muted);">${escapeHtml(phone)}</p>
        <div class="chat-thread">
          ${state.messageThreadMessages.length === 0 ? `<p class="chat-empty">Aucun message.</p>` : state.messageThreadMessages.map(chatBubbleHtml).join('')}
        </div>
        <form id="message-reply-form" class="chat-send-form">
          <textarea name="body" placeholder="Répondre..." maxlength="1000" rows="3" required></textarea>
          <button class="primary" type="submit">Envoyer</button>
        </form>
      </div>
    `;
  }
  return `
    ${state.messageThreads.length === 0 ? `<div class="card"><p>Aucun message pour l'instant.</p></div>` : state.messageThreads.map(t => `
      <div class="card" data-open-message-thread="${escapeHtml(t.phone)}" style="cursor:pointer;">
        <h2>${escapeHtml(t.display_name || t.phone)} ${t.unread_count > 0 ? `<span style="background:var(--red); color:#fff; font-size:11px; padding:2px 8px; border-radius:10px; margin-left:6px;">${t.unread_count}</span>` : ''}</h2>
        <p style="font-size:12px; color:var(--muted);">${escapeHtml(t.phone)} · dernier message le ${escapeHtml(t.last_message_at)}</p>
      </div>
    `).join('')}
  `;
}

// ---------- Dépôts ----------
function renderDepositsSection() {
  const tabs = [['pending', 'En attente'], ['confirmed', 'Confirmés'], ['rejected', 'Rejetés']];
  return `
    <div class="grid-2" style="grid-template-columns: repeat(3, 1fr); margin-top:14px;">
      ${tabs.map(([key, label]) => `
        <button class="tile" data-deposit-filter="${key}" style="font-size:13px; ${state.statusFilter === key ? 'outline:2px solid var(--green);' : ''}">${label}</button>
      `).join('')}
    </div>
    ${state.deposits.length === 0 ? `<div class="card"><p>Aucune demande "${statusLabel(state.statusFilter)}".</p></div>` : state.deposits.map(d => `
      <div class="card">
        <h2>${escapeHtml(d.user_name)} — ${escapeHtml(d.user_phone)}</h2>
        <p><strong>${d.htg_amount} HTG → ${d.kind === 'points' ? `${d.points_granted} points` : `${d.plays_granted} partie(s) bonus`}</strong></p>
        <p style="font-size:24px; font-weight:800; letter-spacing:3px;">${escapeHtml(d.code)}</p>
        <p style="font-size:12px;">Demandé le ${escapeHtml(d.requested_at)}${d.processed_at ? ` · Traité le ${escapeHtml(d.processed_at)}` : ''}</p>
        ${d.status === 'pending' ? `
          <div class="grid-2" style="margin-top:10px;">
            <button class="tile" data-deposit-confirm="${d.id}" style="background:rgba(34,197,94,0.2);">✅ Confirmer</button>
            <button class="tile" data-deposit-reject="${d.id}" style="background:rgba(210,16,52,0.2);">❌ Rejeter</button>
          </div>
        ` : `<p>${statusLabel(d.status)}</p>`}
      </div>
    `).join('')}
  `;
}

// ---------- Achats VIP ----------
function renderVipSection() {
  const tabs = [['pending', 'En attente'], ['confirmed', 'Confirmés'], ['rejected', 'Rejetés']];
  return `
    <div class="grid-2" style="grid-template-columns: repeat(3, 1fr); margin-top:14px;">
      ${tabs.map(([key, label]) => `
        <button class="tile" data-vip-filter="${key}" style="font-size:13px; ${state.statusFilter === key ? 'outline:2px solid var(--green);' : ''}">${label}</button>
      `).join('')}
    </div>
    ${state.vip.length === 0 ? `<div class="card"><p>Aucun achat VIP "${statusLabel(state.statusFilter)}".</p></div>` : state.vip.map(v => `
      <div class="card">
        <h2>${escapeHtml(v.user_name)} — ${escapeHtml(v.user_phone)}</h2>
        <p><strong>${v.amount_htg} HTG → ${v.duration_days} jours VIP</strong>${v.agent_code ? ` · agent ${escapeHtml(v.agent_code)}` : ''}</p>
        <p style="font-size:24px; font-weight:800; letter-spacing:3px;">${escapeHtml(v.code)}</p>
        <p style="font-size:12px;">Demandé le ${escapeHtml(v.requested_at)}${v.processed_at ? ` · Traité le ${escapeHtml(v.processed_at)}` : ''}</p>
        ${v.status === 'pending' ? `
          <div class="grid-2" style="margin-top:10px;">
            <button class="tile" data-vip-confirm="${v.id}" style="background:rgba(34,197,94,0.2);">✅ Confirmer</button>
            <button class="tile" data-vip-reject="${v.id}" style="background:rgba(210,16,52,0.2);">❌ Rejeter</button>
          </div>
        ` : `<p>${statusLabel(v.status)}</p>`}
      </div>
    `).join('')}
  `;
}

// ---------- Rapport global Agents (commissions à verser par période) ----------
// Vue imprimable listant tous les agents du système avec leurs commissions générées et
// retraits effectués sur la période choisie (from/to), pour faire les suivis de paiement
// de commission. #agents-report-printable est le seul contenu conservé au moment de
// l'impression (voir la règle @media print dans styles.css).
function renderAgentsReport() {
  const today = new Date().toISOString().slice(0, 10);
  const rep = state.agentsReport;
  return `
    <div class="card no-print">
      <h2>📋 Rapport global — commissions par agent</h2>
      <p style="font-size:13px;">Choisissez une période (facultatif) puis imprimez pour faire le suivi des commissions à verser à chaque agent. Sans période, le rapport couvre tout l'historique.</p>
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <input type="date" id="report-from-input" value="${escapeHtml(state.reportFrom)}" max="${today}" style="margin-bottom:0; flex:1;">
        <input type="date" id="report-to-input" value="${escapeHtml(state.reportTo)}" max="${today}" style="margin-bottom:0; flex:1;">
        <button class="primary" id="report-apply-btn" type="button" style="margin:0;">Appliquer</button>
      </div>
      ${(state.reportFrom || state.reportTo) ? `<button class="secondary" id="report-reset-btn" type="button">Revenir à tout l'historique</button>` : ''}
      ${rep ? `<button class="primary" id="report-print-btn" type="button" style="width:100%; margin-top:10px;">🖨️ Imprimer</button>` : ''}
    </div>
    ${!rep ? '<div class="center-msg">Chargement...</div>' : `
      <div id="agents-report-printable">
        <h2 style="text-align:center;">Rapport global — Agents Konkou</h2>
        <p style="text-align:center; font-size:13px;">Période : ${rep.from ? `du ${rep.from}` : 'depuis le début'} ${rep.to ? `au ${rep.to}` : "jusqu'à aujourd'hui"} · Édité le ${today}</p>
        <table style="width:100%; border-collapse:collapse; font-size:13px; margin-top:10px;">
          <thead>
            <tr style="border-bottom:2px solid #333;">
              <th style="text-align:left; padding:6px;">Code Agent</th>
              <th style="text-align:left; padding:6px;">Nom et Prénom</th>
              <th style="text-align:left; padding:6px;">Téléphone</th>
              <th style="text-align:right; padding:6px;">Commissions générées</th>
              <th style="text-align:right; padding:6px;">Retraits effectués</th>
            </tr>
          </thead>
          <tbody>
            ${rep.agents.map(a => `
              <tr style="border-bottom:1px solid #ccc;">
                <td style="padding:6px;">${escapeHtml(a.fullCode)}</td>
                <td style="padding:6px;">${escapeHtml(a.firstName)} ${escapeHtml(a.lastName)}</td>
                <td style="padding:6px;">${escapeHtml(a.phone)}</td>
                <td style="padding:6px; text-align:right;">${a.commissionHtg} HTG</td>
                <td style="padding:6px; text-align:right;">${a.withdrawalsCount} (${a.withdrawalsHtg} HTG)</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid #333; font-weight:800;">
              <td style="padding:6px;" colspan="3">Total</td>
              <td style="padding:6px; text-align:right;">${rep.totals.commissionHtg} HTG</td>
              <td style="padding:6px; text-align:right;">${rep.totals.withdrawalsCount} (${rep.totals.withdrawalsHtg} HTG)</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `}
  `;
}

// ---------- Remboursements de commission agent (NatCash/MonCash, juillet 2026) ----------
// Chaque agent actif a un cycle de 8/15/22 jours (choisi à l'inscription) au terme duquel
// l'admin lui doit ses commissions accumulées, réglées hors app par NatCash ou MonCash aux
// numéros fournis à l'inscription — voir computeReimbursementStatus() dans
// backend/routes/agents.js. Triés côté serveur par échéance la plus proche/dépassée en
// premier ; un badge rouge signale les cycles déjà échus (isDue).
function renderAgentsReimbursements() {
  const list = state.agentsReimbursements;
  const history = state.agentsReimbursementsHistory;
  if (!list) return '<div class="center-msg">Chargement...</div>';
  return `
    <div class="card">
      <h2>💸 Remboursements de commission</h2>
      <p style="font-size:13px;">Chaque agent choisit un cycle de 8, 15 ou 22 jours à l'inscription. Le montant à rembourser est toujours la commission accumulée depuis le dernier remboursement (ou depuis l'activation du compte s'il n'y en a jamais eu) — jamais un montant libre.</p>
    </div>
    ${list.length === 0 ? '<div class="card"><p>Aucun agent actif.</p></div>' : list.map(a => {
      const r = a.reimbursement;
      return `
      <div class="card" style="${r.isDue ? 'border-left-color: var(--red);' : ''}">
        <h2>${escapeHtml(a.fullCode)} — ${escapeHtml(a.firstName)} ${escapeHtml(a.lastName)}</h2>
        <p>Téléphone : ${escapeHtml(a.phone)} · Plan : tous les ${r.periodDays} jours</p>
        <p>NatCash : <strong>${escapeHtml(a.natcashNumber || '—')}</strong>${a.natcashName ? ` (${escapeHtml(a.natcashName)})` : ''}</p>
        <p>MonCash : <strong>${escapeHtml(a.moncashNumber || '—')}</strong>${a.moncashName ? ` (${escapeHtml(a.moncashName)})` : ''}</p>
        <p>Cycle depuis le ${escapeHtml((r.cycleStartAt || '').slice(0, 10))} · ${r.withdrawalsCount} retrait(s) payé(s) (${r.withdrawalsHtg} HTG)</p>
        <p style="font-size:20px; font-weight:800;">${r.commissionOwedHtg} HTG à rembourser</p>
        <p style="font-size:13px; font-weight:700; color:${r.isDue ? 'var(--red)' : 'var(--muted)'};">${r.isDue ? `⏰ Échu depuis le ${(r.dueAt || '').slice(0, 10)}` : `📅 Échéance le ${(r.dueAt || '').slice(0, 10)} (dans ${r.daysRemaining} jour(s))`}</p>
        <div class="grid-2" style="margin-top:10px;">
          <button class="tile" data-reimburse="${a.id}" data-reimburse-method="natcash" style="background:rgba(34,197,94,0.2); font-size:13px;">✅ Rembourser via NatCash</button>
          <button class="tile" data-reimburse="${a.id}" data-reimburse-method="moncash" style="background:rgba(34,197,94,0.2); font-size:13px;">✅ Rembourser via MonCash</button>
        </div>
      </div>
    `; }).join('')}
    ${history.length > 0 ? `
      <div class="card">
        <h2>Historique récent</h2>
        ${history.map(h => `
          <div class="tx-row">
            <span>${escapeHtml(h.full_code)} — ${escapeHtml(h.first_name)} ${escapeHtml(h.last_name)} · ${h.method === 'natcash' ? 'NatCash' : 'MonCash'}</span>
            <span>${h.commission_htg} HTG (${escapeHtml((h.created_at || '').slice(0, 10))})</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

// ---------- Candidatures Agent ----------
const ID_TYPE_LABELS = { cin: "Carte d'Identification Nationale", passeport: 'Passeport', permis: 'Permis de conduire' };

function renderAgentsSection() {
  const tabs = [['pending', 'En attente'], ['active', 'Actifs'], ['rejected', 'Rejetés']];
  const tabsHtml = `
    <div class="grid-2" style="grid-template-columns: repeat(5, 1fr); margin-top:14px;">
      ${tabs.map(([key, label]) => `
        <button class="tile" data-agent-filter="${key}" style="font-size:13px; ${state.agentsView === 'list' && state.statusFilter === key ? 'outline:2px solid var(--green);' : ''}">${label}</button>
      `).join('')}
      <button class="tile" data-agent-filter="report" style="font-size:13px; ${state.agentsView === 'report' ? 'outline:2px solid var(--green);' : ''}">📋 Rapport global</button>
      <button class="tile" data-agent-filter="reimbursements" style="font-size:13px; ${state.agentsView === 'reimbursements' ? 'outline:2px solid var(--green);' : ''}">💸 Remboursements</button>
    </div>
  `;
  if (state.agentsView === 'report') return tabsHtml + renderAgentsReport();
  if (state.agentsView === 'reimbursements') return tabsHtml + renderAgentsReimbursements();
  return tabsHtml + `
    ${state.agents.length === 0 ? `<div class="card"><p>Aucune candidature "${statusLabel(state.statusFilter)}".</p></div>` : state.agents.map(a => `
      <div class="card">
        <h2>${escapeHtml(a.full_code || a.agent_code)} — ${escapeHtml(a.first_name)} ${escapeHtml(a.last_name)}</h2>
        <p>Téléphone : ${escapeHtml(a.user_phone)} · Né(e) le ${escapeHtml(a.birth_date)}</p>
        <p>Pièce d'identité : ${escapeHtml(ID_TYPE_LABELS[a.id_type] || a.id_type)}${a.id_number ? ` — n° ${escapeHtml(a.id_number)}` : ''}</p>
        ${(a.city || a.address) ? `<p>📍 ${[a.city, a.address].filter(Boolean).map(escapeHtml).join(' — ')}</p>` : ''}
        <p>Capital requis : <strong>${a.capital_htg} HTG</strong>${a.status === 'active' ? ` · Crédit actuel : <strong>${a.credit_balance} HTG</strong> · Commissions : <strong>${a.commission_earned} HTG</strong>` : ''}</p>
        <p style="font-size:12px;">Candidature le ${escapeHtml(a.applied_at)}${a.approved_at ? ` · Activé le ${escapeHtml(a.approved_at)}` : ''}</p>
        ${a.status === 'pending' ? `
          <div class="grid-2" style="margin-top:10px;">
            <button class="tile" data-agent-approve="${a.id}" style="background:rgba(34,197,94,0.2);">✅ Approuver (capital reçu)</button>
            <button class="tile" data-agent-reject="${a.id}" style="background:rgba(210,16,52,0.2);">❌ Rejeter</button>
          </div>
        ` : `<p>${statusLabel(a.status)}</p>`}
      </div>
    `).join('')}
  `;
}

// ---------- Renflouements agent ----------
function renderRefillsSection() {
  const tabs = [['pending', 'En attente'], ['confirmed', 'Confirmés'], ['rejected', 'Rejetés']];
  return `
    <div class="grid-2" style="grid-template-columns: repeat(3, 1fr); margin-top:14px;">
      ${tabs.map(([key, label]) => `
        <button class="tile" data-refill-filter="${key}" style="font-size:13px; ${state.statusFilter === key ? 'outline:2px solid var(--green);' : ''}">${label}</button>
      `).join('')}
    </div>
    ${state.refills.length === 0 ? `<div class="card"><p>Aucun renflouement "${statusLabel(state.statusFilter)}".</p></div>` : state.refills.map(r => `
      <div class="card">
        <h2>${escapeHtml(r.full_code || r.agent_code)} — ${escapeHtml(r.first_name)} ${escapeHtml(r.last_name)}</h2>
        <p>Téléphone : ${escapeHtml(r.user_phone)}</p>
        <p><strong>${r.amount_htg} HTG</strong> déposé · frais ${r.fee_percent}% (${r.platform_fee_htg} HTG) · crédité : <strong>${r.credited_htg} HTG</strong></p>
        <p style="font-size:12px;">Demandé le ${escapeHtml(r.requested_at)}${r.processed_at ? ` · Traité le ${escapeHtml(r.processed_at)}` : ''}</p>
        ${r.status === 'pending' ? `
          <div class="grid-2" style="margin-top:10px;">
            <button class="tile" data-refill-confirm="${r.id}" style="background:rgba(34,197,94,0.2);">✅ Confirmer (dépôt reçu)</button>
            <button class="tile" data-refill-reject="${r.id}" style="background:rgba(210,16,52,0.2);">❌ Rejeter</button>
          </div>
        ` : `<p>${statusLabel(r.status)}</p>`}
      </div>
    `).join('')}
  `;
}

// ---------- Revenus plateforme ----------
function renderRevenueSection() {
  if (!state.revenue) return '<div class="center-msg">Chargement...</div>';
  const b = state.revenue.breakdown;
  const rows = [
    ['Frais de capital agent (inscription)', b.agentCapitalFees],
    ['Frais de renflouement agent', b.agentRefillFees],
    ['Frais de service sur les retraits', b.cashoutServiceFees],
    ['Frais de service sur les dépôts', b.depositServiceFees],
    ['Ventes VIP', b.vipSales]
  ];
  const today = new Date().toISOString().slice(0, 10);
  const min = state.revenue.earliestDate || undefined;
  return `
    <div class="card" style="margin-top:14px;">
      <h2>📅 Revenus par jour</h2>
      <p style="font-size:13px;">Choisissez une date pour voir uniquement les revenus collectés ce jour-là${min ? ` (depuis le ${min}, création du tout premier compte)` : ''}.</p>
      <div style="display:flex; gap:10px; align-items:center;">
        <input type="date" id="revenue-date-input" value="${escapeHtml(state.revenueDate)}" ${min ? `min="${min}"` : ''} max="${today}" style="margin-bottom:0;">
        <button class="primary" id="revenue-date-apply-btn" type="button" style="flex:1; margin:0;">Voir ce jour</button>
      </div>
      ${state.revenueDate ? `<button class="secondary" id="revenue-date-reset-btn" type="button">Revenir à tout l'historique</button>` : ''}
    </div>
    <div class="card">
      <h2>📊 Revenu ${state.revenue.date ? `du ${state.revenue.date}` : 'total de la plateforme (tout l\'historique)'}</h2>
      <p style="font-size:32px; font-weight:800; color:var(--text);">${state.revenue.totalRevenueHtg} HTG</p>
    </div>
    ${rows.map(([label, r]) => `
      <div class="card">
        <h2>${label}</h2>
        <div class="stat-row"><span>Total</span><span><strong>${r.totalHtg} HTG</strong></span></div>
        <div class="stat-row"><span>Nombre de transactions</span><span>${r.count}</span></div>
      </div>
    `).join('')}
  `;
}

// ---------- Joueurs (liste, lecture seule) ----------
// Vue d'ensemble de tous les comptes joueur (jamais les comptes agent, qui ont leur propre
// onglet "Agents" — voir listPlayers dans backend/routes/account.js). Recherche par nom ou
// téléphone côté serveur (LIKE, insensible à la casse) plutôt que côté client, pour rester
// utilisable même avec beaucoup de comptes (voir PLAYERS_LIST_LIMIT côté serveur). Le bouton
// "🗑️ Gérer" par ligne réutilise directement /admin/accounts/lookup (même route que
// l'onglet "Comptes") pour sauter droit sur la fiche de suppression de ce joueur, sans
// dupliquer cette logique ici.
function playerRowHtml(p) {
  const vipActive = p.vip_until && new Date(p.vip_until).getTime() > Date.now();
  return `
    <tr style="border-bottom:1px solid #ccc;">
      <td style="padding:6px;">${escapeHtml(p.name)}</td>
      <td style="padding:6px;">${escapeHtml(p.phone)}</td>
      <td style="padding:6px; text-align:right;">
        ${p.points}${p.non_cashable_points > 0 ? `<div style="font-size:11px; color:var(--muted);">dont ${p.non_cashable_points} non retirables</div>` : ''}
      </td>
      <td style="padding:6px; text-align:right;">${p.bonus_plays}</td>
      <td style="padding:6px; text-align:center;">${vipActive ? '👑' : '—'}</td>
      <td style="padding:6px; text-align:center;">${p.phone_verified ? '✅' : '❌'}</td>
      <td style="padding:6px;">${escapeHtml(p.created_at)}</td>
      <td style="padding:6px; text-align:center;"><button class="tile" data-players-manage="${escapeHtml(p.phone)}" style="font-size:12px; padding:6px 8px;">🗑️ Gérer</button></td>
    </tr>
  `;
}

function renderPlayersSection() {
  return `
    <div class="card" style="margin-top:14px;">
      <h2>👥 Joueurs inscrits</h2>
      <p style="font-size:13px;">
        ${state.playersSearch
          ? `${state.playersMatching} résultat(s) pour "${escapeHtml(state.playersSearch)}" sur ${state.playersTotal} joueur(s) au total.`
          : `${state.playersTotal} joueur(s) inscrit(s) au total.`}
        ${state.playersTruncated ? ' Affichage limité aux comptes les plus récents — affinez la recherche pour voir un compte plus ancien.' : ''}
      </p>
      <form id="players-search-form" style="display:flex; gap:10px;">
        <input name="search" placeholder="Rechercher par nom ou téléphone" value="${escapeHtml(state.playersSearch)}" style="margin-bottom:0; flex:1;" />
        <button class="primary" type="submit" style="margin:0;">Rechercher</button>
      </form>
      ${state.playersSearch ? `<button class="secondary" id="players-search-reset-btn" type="button" style="margin-top:8px;">Réinitialiser</button>` : ''}
    </div>
    <div class="card">
      ${state.players.length === 0 ? `<p>Aucun joueur${state.playersSearch ? ' ne correspond à cette recherche' : ' inscrit pour le moment'}.</p>` : `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid #333;">
                <th style="text-align:left; padding:6px;">Nom</th>
                <th style="text-align:left; padding:6px;">Téléphone</th>
                <th style="text-align:right; padding:6px;">Points</th>
                <th style="text-align:right; padding:6px;">Parties bonus</th>
                <th style="text-align:center; padding:6px;">VIP</th>
                <th style="text-align:center; padding:6px;">Vérifié</th>
                <th style="text-align:left; padding:6px;">Inscrit le</th>
                <th style="padding:6px;"></th>
              </tr>
            </thead>
            <tbody>
              ${state.players.map(playerRowHtml).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// ---------- Comptes (suppression agent/joueur) ----------
function renderAccountsSection() {
  return `
    <div class="card" style="margin-top:14px;">
      <h2>🗑️ Supprimer un compte</h2>
      <p style="font-size:13px;">Recherchez un compte (agent ou joueur) par numéro de téléphone. La suppression est bloquée si le compte a un retrait/dépôt en attente (joueur), ou — pour un agent — un dépôt, retrait ou renflouement qui lui est assigné et encore en attente ; réglez ces éléments d'abord via les autres onglets, puis revenez ici. Un solde de points, un crédit agent ou des commissions non réglées ne bloquent plus la suppression : ils sont simplement perdus/à régler en dehors de l'app.</p>
      <form id="account-lookup-form">
        <input name="phone" placeholder="Numéro de téléphone" required />
        <button class="primary" type="submit">Rechercher</button>
      </form>
    </div>
    ${state.accountLookup ? accountLookupResultHtml(state.accountLookup) : ''}
  `;
}

function accountLookupResultHtml(result) {
  const u = result.user;
  const a = result.agent;
  return `
    <div class="card">
      <h2>${escapeHtml(u.name)} — ${escapeHtml(u.phone)}</h2>
      <div class="stat-row"><span>Points</span><span>${u.points}</span></div>
      <div class="stat-row"><span>Parties bonus</span><span>${u.bonus_plays}</span></div>
      <div class="stat-row"><span>Membre depuis</span><span>${escapeHtml(u.created_at)}</span></div>
      ${a ? `
        <div class="stat-row"><span>Rôle agent</span><span>${statusLabel(a.status)}</span></div>
        ${(a.city || a.address) ? `<div class="stat-row"><span>Ville / Adresse</span><span>${[a.city, a.address].filter(Boolean).map(escapeHtml).join(' — ')}</span></div>` : ''}
        ${a.status === 'active' ? `
          <div class="stat-row"><span>Crédit agent</span><span>${a.credit_balance} HTG</span></div>
          <div class="stat-row"><span>Commissions</span><span>${a.commission_earned} HTG</span></div>
        ` : ''}
      ` : `<p style="font-size:12px; color:var(--muted);">Pas de rôle agent.</p>`}
      ${u.points > 0 ? `<p class="error-banner">⚠️ Ce compte a <strong>${u.points} points</strong> — ils seront définitivement perdus à la suppression.</p>` : ''}
      ${a && (a.credit_balance > 0 || a.commission_earned > 0) ? `<p class="error-banner">⚠️ Ce compte agent a encore <strong>${a.credit_balance} HTG</strong> de crédit et <strong>${a.commission_earned} HTG</strong> de commissions — à régler avec l'agent en dehors de l'app, ce n'est pas remboursé ni transféré automatiquement à la suppression.</p>` : ''}
      <button class="tile" id="account-delete-btn" data-phone="${escapeHtml(u.phone)}" data-points="${u.points}" data-credit="${a ? a.credit_balance : 0}" data-commission="${a ? a.commission_earned : 0}" style="background:rgba(210,16,52,0.2); width:100%; margin-top:10px;">🗑️ Supprimer ce compte définitivement</button>
    </div>
  `;
}

// ---------- Réglages ----------
// Numéro WhatsApp qui reçoit les messages du formulaire "Nous contacter" (voir
// backend/routes/contact.js et app.js). Stocké en base (table settings), donc
// modifiable ici sans redéploiement — contrairement à OPERATOR_WHATSAPP_NUMBER qui
// reste une variable d'environnement pour la confirmation d'inscription/reset.
// ---------- Diffusion groupée (juillet 2026) ----------
// Envoie une notification push identique à tous les joueurs OU tous les agents abonnés
// (jamais les deux à la fois — deux publics différents, deux boutons de cible séparés,
// voir backend/routes/push.js broadcastToPlayers/broadcastToAgents). Ce n'est PAS un vrai
// envoi WhatsApp de masse (techniquement impossible sans intégrer l'API WhatsApp Business
// — voir la discussion avec l'utilisateur) : seuls les appareils déjà abonnés aux
// notifications reçoivent l'annonce, d'où l'avertissement explicite ci-dessous et le
// décompte réel affiché après l'envoi plutôt qu'un message vague de succès.
function renderBroadcastSection() {
  const target = state.broadcastTarget || 'players';
  const result = state.broadcastResult;
  return `
    <div class="card">
      <h2>📢 Envoyer une annonce</h2>
      <p style="font-size:13px;">Envoie une notification push identique à tous les joueurs ou tous les agents. <strong>Ce n'est pas un envoi WhatsApp</strong> — ça ne touche que les appareils ayant déjà activé les notifications sur cet appareil (bouton "🔔 Activer les notifications" côté joueur/agent), pas la totalité des comptes inscrits.</p>
      <div class="grid-2" style="margin-bottom:12px;">
        <button class="tile" data-broadcast-target="players" style="${target === 'players' ? 'outline:2px solid var(--green);' : ''}">👥 Tous les joueurs</button>
        <button class="tile" data-broadcast-target="agents" style="${target === 'agents' ? 'outline:2px solid var(--green);' : ''}">🧑‍💼 Tous les agents</button>
      </div>
      <form id="broadcast-form">
        <input name="title" placeholder="Titre de la notification" maxlength="80" required />
        <textarea name="body" placeholder="Message" maxlength="300" rows="3" required></textarea>
        <button class="primary" type="submit">📢 Envoyer aux ${target === 'players' ? 'joueurs' : 'agents'} abonnés</button>
      </form>
      ${result ? `
        <p style="font-size:13px; margin-top:10px;">
          Envoyé à <strong>${result.sent}</strong> appareil(s) sur <strong>${result.targeted}</strong> ${result.target === 'players' ? 'joueur(s)' : 'agent(s)'} abonné(s) aux notifications.
          ${result.expired > 0 ? ` (${result.expired} abonnement(s) expiré(s) nettoyé(s) au passage.)` : ''}
        </p>
      ` : ''}
    </div>
  `;
}

function renderSettingsSection() {
  const current = state.contactWhatsapp;
  return `
    <div class="card" style="margin-top:14px;">
      <h2>📞 Numéro de contact ("Nous contacter")</h2>
      <p style="font-size:13px;">Les messages envoyés depuis "Nous contacter" (côté joueur) s'ouvriront sur WhatsApp vers ce numéro.</p>
      <p style="font-size:13px; color:var(--muted);">
        ${current ? `Numéro actuel : <strong style="color:var(--text);">${escapeHtml(current)}</strong>` : "Aucun numéro configuré pour l'instant — le formulaire de contact affichera une erreur tant qu'il n'est pas défini."}
      </p>
      <form id="contact-whatsapp-form">
        <input name="whatsappNumber" placeholder="Numéro WhatsApp (ex: 50937123456)" value="${current ? escapeHtml(current) : ''}" required />
        <button class="primary" type="submit">Enregistrer</button>
      </form>
    </div>
    <div class="card">
      <h2>🔔 Notifications</h2>
      <p style="font-size:13px;">Activez les notifications push sur CET appareil/navigateur pour être prévenu·e directement, même l'admin fermé, dès qu'une nouvelle inscription ou une demande de réinitialisation de mot de passe attend une confirmation dans "Vérifications". Nécessite les clés VAPID configurées côté serveur (voir README.md, section "Notifications push") — sans elles, le bouton ci-dessous affichera une erreur explicite.</p>
      ${notificationsToggleHtml(state.pushSubscribed, "Vous recevrez un signal sur cet appareil dès qu'une action attend votre confirmation — même la fenêtre admin fermée.")}
    </div>
    ${renderBroadcastSection()}
    <div class="card">
      <h2>🎨 Thème de l'app</h2>
      <p style="font-size:13px;">Change les couleurs et ajoute un décor animé sur toute l'app (joueur et admin). S'applique immédiatement pour tout le monde au prochain chargement de la page.</p>
      <div class="grid-2" style="grid-template-columns: repeat(2, 1fr);">
        ${Object.entries(THEMES).map(([key, t]) => `
          <button class="tile" data-theme-pick="${key}" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding:14px 8px; ${state.currentTheme === key ? 'outline:2px solid var(--green);' : ''}">
            <span style="font-size:22px;">${t.label.split(' ')[0]}</span>
            <span style="font-size:12px;">${t.label.split(' ').slice(1).join(' ')}</span>
            <span style="display:flex; gap:4px;">
              ${['--blue', '--red', '--bg'].map(v => `<span style="width:12px; height:12px; border-radius:50%; background:${t.vars[v] || `var(${v})`}; border:1px solid rgba(255,255,255,0.2);"></span>`).join('')}
            </span>
          </button>
        `).join('')}
      </div>
    </div>
    <div class="card">
      <h2>🖌️ Couleur de fond personnalisée</h2>
      <p style="font-size:13px;">Indépendante des thèmes ci-dessus — remplace uniquement la couleur de fond du thème actif, sans toucher au reste de ses couleurs ni à son décor animé. S'applique immédiatement pour tout le monde, comme les thèmes.</p>
      <p style="font-size:13px; color:var(--muted);">
        ${state.bgColor ? `Couleur actuelle : <strong style="color:var(--text);">${escapeHtml(state.bgColor)}</strong>` : "Aucune surcharge — l'app utilise le fond par défaut du thème actif."}
      </p>
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:12px;">
        <input type="color" id="bg-color-input" value="${state.bgColor || THEMES[state.currentTheme]?.vars['--bg'] || '#0b1220'}" style="width:56px; height:44px; padding:2px; margin-bottom:0; cursor:pointer;">
        <button class="primary" id="bg-color-apply-btn" type="button" style="flex:1; margin:0;">Appliquer</button>
      </div>
      ${state.bgColor ? `<button class="secondary" id="bg-color-reset-btn" type="button">Réinitialiser (revenir au fond du thème)</button>` : ''}
    </div>
    <div class="card">
      <h2>🔷 Couleur bleu foncé personnalisée</h2>
      <p style="font-size:13px;">Indépendante des thèmes ci-dessus — remplace le bleu utilisé dans la barre du haut (dégradé) et les badges des jeux sur l'accueil, sans toucher au reste des couleurs du thème actif. Une seule couleur à choisir : le second ton du dégradé est calculé automatiquement (version assombrie). S'applique immédiatement pour tout le monde.</p>
      <p style="font-size:13px; color:var(--muted);">
        ${state.blueColor ? `Couleur actuelle : <strong style="color:var(--text);">${escapeHtml(state.blueColor)}</strong>` : "Aucune surcharge — l'app utilise le bleu par défaut du thème actif."}
      </p>
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:12px;">
        <input type="color" id="blue-color-input" value="${state.blueColor || THEMES[state.currentTheme]?.vars['--blue'] || '#00209F'}" style="width:56px; height:44px; padding:2px; margin-bottom:0; cursor:pointer;">
        <button class="primary" id="blue-color-apply-btn" type="button" style="flex:1; margin:0;">Appliquer</button>
      </div>
      ${state.blueColor ? `<button class="secondary" id="blue-color-reset-btn" type="button">Réinitialiser (revenir au bleu du thème)</button>` : ''}
    </div>
    <div class="card">
      <h2>🃏 Couleur des cartes</h2>
      <p style="font-size:13px;">Indépendante des thèmes ci-dessus — remplace la couleur de fond des cartes/onglets/panneaux de jeu (l'accueil, le classement, le portefeuille, le profil...), sans toucher au reste des couleurs du thème actif. Une seule couleur à choisir : le second ton (fond des onglets/boutons de réponse) est calculé automatiquement. Le texte affiché sur ces cartes s'adapte automatiquement pour rester lisible : <strong>blanc</strong> si la couleur choisie est foncée, <strong>rouge ou bleu</strong> (celui qui ressort le mieux) si elle est pâle. S'applique immédiatement pour tout le monde.</p>
      <p style="font-size:13px; color:var(--muted);">
        ${state.cardColor ? `Couleur actuelle : <strong style="color:var(--text);">${escapeHtml(state.cardColor)}</strong>` : "Aucune surcharge — l'app utilise la couleur de carte par défaut du thème actif."}
      </p>
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:12px;">
        <input type="color" id="card-color-input" value="${state.cardColor || THEMES[state.currentTheme]?.vars['--card'] || '#141d33'}" style="width:56px; height:44px; padding:2px; margin-bottom:0; cursor:pointer;">
        <button class="primary" id="card-color-apply-btn" type="button" style="flex:1; margin:0;">Appliquer</button>
      </div>
      ${state.cardColor ? `<button class="secondary" id="card-color-reset-btn" type="button">Réinitialiser (revenir à la couleur du thème)</button>` : ''}
    </div>
    <div class="card">
      <h2>📢 Panneau publicitaire</h2>
      <p style="font-size:13px;">Image au format portrait (idéalement 9:16, ex. 1080×1920) affichée en surimpression une fois par session au joueur ET à l'agent — un bouton (x) permet de la fermer. Aucun lien cliquable, purement visuel : à utiliser pour promouvoir un avantage de l'app (VIP, parrainage...) ou une entreprise tierce. Remplaçable à tout moment ; sans image ici, aucun panneau ne s'affiche.</p>
      ${state.adImage ? `
        <div style="display:flex; justify-content:center; margin-bottom:12px;">
          <img src="${state.adImage}" alt="Aperçu du panneau publicitaire" style="width:140px; aspect-ratio:9/16; object-fit:cover; border-radius:10px;">
        </div>
      ` : `<p style="font-size:13px; color:var(--muted);">Aucun panneau configuré — rien ne s'affiche pour l'instant côté joueur/agent.</p>`}
      <input type="file" id="ad-image-input" accept="image/png,image/jpeg,image/webp" style="margin-bottom:12px;">
      <button class="primary" id="ad-image-apply-btn" type="button">Envoyer et appliquer</button>
      ${state.adImage ? `<button class="secondary" id="ad-image-reset-btn" type="button">Retirer (plus aucun panneau affiché)</button>` : ''}
    </div>
    <div class="card">
      <h2>🖼️ Photo de fond personnalisée</h2>
      <p style="font-size:13px;">Remplace le filigrane du logo par une photo en plein écran, indépendamment du thème et de la couleur de fond ci-dessus. L'image est automatiquement redimensionnée avant l'envoi (max 3 Mo côté serveur). S'applique immédiatement pour tout le monde.</p>
      ${state.bgImage ? `
        <img src="${state.bgImage}" alt="Aperçu de la photo de fond" style="width:100%; max-height:140px; object-fit:cover; border-radius:10px; margin-bottom:12px;">
      ` : `<p style="font-size:13px; color:var(--muted);">Aucune photo — l'app affiche le filigrane du logo par défaut.</p>`}
      <input type="file" id="bg-image-input" accept="image/png,image/jpeg,image/webp" style="margin-bottom:12px;">
      <button class="primary" id="bg-image-apply-btn" type="button">Envoyer et appliquer</button>
      ${state.bgImage ? `<button class="secondary" id="bg-image-reset-btn" type="button">Retirer (revenir au filigrane du logo)</button>` : ''}
    </div>
    <div class="card">
      <h2>🖼️ Logo (barre du haut et écran de connexion)</h2>
      <p style="font-size:13px;">Remplace le logo Konkou affiché en haut de l'app (joueur, agent, admin) et sur l'écran de connexion/création de compte. Format recommandé : bandeau large et bas, environ <strong>20:2</strong> (10 fois plus large que haut), comme le wordmark fourni par défaut — un autre format s'affichera mais peut paraître déformé ou trop petit selon la forme.</p>
      <div style="background:rgba(0,0,0,0.25); border-radius:10px; padding:14px; margin-bottom:12px; display:flex; justify-content:center;">
        <img src="${state.logo || 'logo.png'}" alt="Aperçu du logo" style="max-width:100%; max-height:60px;">
      </div>
      <input type="file" id="logo-input" accept="image/png,image/jpeg,image/webp" style="margin-bottom:12px;">
      <button class="primary" id="logo-apply-btn" type="button">Envoyer et appliquer</button>
      ${state.logo ? `<button class="secondary" id="logo-reset-btn" type="button">Réinitialiser (revenir au logo par défaut)</button>` : ''}
    </div>
    <div class="card">
      <h2>🖼️ Photo de fond de la barre du haut</h2>
      <p style="font-size:13px;">Ajoute une photo derrière le logo, dans le rectangle de la barre du haut — indépendamment du logo lui-même (carte ci-dessus) et de la photo de fond de toute l'app (plus haut) : les trois peuvent coexister. Le logo et les liens (Contact/Se déconnecter) restent affichés par-dessus, un léger assombrissement garde le texte lisible. Sans photo ici, la barre garde simplement le dégradé de couleurs du thème actif.</p>
      ${state.topbarBgImage ? `
        <img src="${state.topbarBgImage}" alt="Aperçu de la photo de la barre du haut" style="width:100%; max-height:100px; object-fit:cover; border-radius:10px; margin-bottom:12px;">
      ` : `<p style="font-size:13px; color:var(--muted);">Aucune photo — la barre du haut garde le dégradé de couleurs du thème actif.</p>`}
      <input type="file" id="topbar-bg-image-input" accept="image/png,image/jpeg,image/webp" style="margin-bottom:12px;">
      <button class="primary" id="topbar-bg-image-apply-btn" type="button">Envoyer et appliquer</button>
      ${state.topbarBgImage ? `<button class="secondary" id="topbar-bg-image-reset-btn" type="button">Retirer (revenir au dégradé du thème)</button>` : ''}
    </div>
    <div class="card" style="border:2px solid var(--red);">
      <h2 style="color:var(--red);">⚠️ Zone de danger</h2>
      <p style="font-size:13px;">Supprime définitivement TOUTES les données créées pendant les essais : comptes joueur/agent, transactions, dépôts, retraits, VIP, renflouements, sessions de jeu, codes de vérification en attente. Les réglages ci-dessus (thème, logo, contact WhatsApp) sont conservés. <strong>Irréversible</strong> — à utiliser une seule fois, juste avant le vrai lancement.</p>
      <button class="tile" id="reset-test-data-btn" style="background:rgba(210,16,52,0.25); color:var(--red); width:100%; font-weight:800;">🗑️ Réinitialiser toutes les données de test</button>
    </div>
  `;
}

// ---------- Chargement des données ----------
async function loadCashouts() {
  setState({ loading: true, error: '' });
  try {
    const data = await api(`/admin/cashouts?status=${state.statusFilter}`);
    setState({ cashouts: data.cashouts, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function loadVerifications() {
  setState({ loading: true, error: '' });
  try {
    const data = await api(`/admin/verifications?purpose=${state.verifyPurpose}`);
    setState({ verifications: data.requests, loading: false });
    loadVerificationChats(data.requests);
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

// Charge en parallèle la conversation de chaque demande en attente (voir "Tchat interne",
// juillet 2026, routes/chat.js) — remplace le message WhatsApp que l'opérateur devait
// auparavant recevoir/cross-vérifier manuellement : la personne indique désormais son code
// directement dans cette conversation, affichée dans chaque carte à côté du code de
// référence pour comparaison immédiate (voir renderVerificationsSection()). Volontairement
// séparé de loadVerifications() ci-dessus (n'affecte pas state.loading) : la liste
// s'affiche sans attendre que toutes les conversations aient fini de charger, chacune
// apparaît dès qu'elle est prête.
async function loadVerificationChats(requests) {
  const purpose = state.verifyPurpose;
  const chats = { ...state.verificationChats };
  await Promise.all((requests || []).map(async (v) => {
    try {
      const data = await api(`/admin/chat/messages?phone=${encodeURIComponent(v.phone)}&purpose=${purpose}`);
      chats[v.phone] = data.messages;
    } catch {
      // pas grave — on retentera au prochain chargement de l'onglet
    }
  }));
  setState({ verificationChats: chats });
}

async function loadDeposits() {
  setState({ loading: true, error: '' });
  try {
    const data = await api(`/admin/deposits?status=${state.statusFilter}`);
    setState({ deposits: data.deposits, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function loadVipPurchases() {
  setState({ loading: true, error: '' });
  try {
    const data = await api(`/admin/vip?status=${state.statusFilter}`);
    setState({ vip: data.vipPurchases, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function loadAgents() {
  if (state.agentsView === 'report') return loadAgentsReport();
  if (state.agentsView === 'reimbursements') return loadAgentsReimbursements();
  setState({ loading: true, error: '' });
  try {
    const data = await api(`/admin/agents?status=${state.statusFilter}`);
    setState({ agents: data.agents, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function loadAgentsReport() {
  setState({ loading: true, error: '' });
  try {
    const params = new URLSearchParams();
    if (state.reportFrom) params.set('from', state.reportFrom);
    if (state.reportTo) params.set('to', state.reportTo);
    const query = params.toString() ? `?${params.toString()}` : '';
    const data = await api(`/admin/agents/report${query}`);
    setState({ agentsReport: data, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function loadAgentsReimbursements() {
  setState({ loading: true, error: '' });
  try {
    const [status, history] = await Promise.all([
      api('/admin/agents/reimbursements'),
      api('/admin/agents/reimbursements/history')
    ]);
    setState({ agentsReimbursements: status.agents, agentsReimbursementsHistory: history.reimbursements, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function actOnAgentReimbursement(id, method) {
  const methodLabel = method === 'natcash' ? 'NatCash' : 'MonCash';
  if (!confirm(`Confirmer avoir envoyé ce montant à l'agent par ${methodLabel} ?`)) return;
  try {
    const res = await api('/admin/agents/reimbursements/confirm', { method: 'POST', body: { id: Number(id), method } });
    setState({ success: res.message, error: '' });
    loadAgentsReimbursements();
  } catch (err) {
    setState({ error: err.message, success: '' });
  }
}

async function loadRefills() {
  setState({ loading: true, error: '' });
  try {
    const data = await api(`/admin/agent-refills?status=${state.statusFilter}`);
    setState({ refills: data.refills, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function loadRevenue() {
  setState({ loading: true, error: '' });
  try {
    const query = state.revenueDate ? `?date=${encodeURIComponent(state.revenueDate)}` : '';
    const data = await api(`/admin/revenue${query}`);
    setState({ revenue: data, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function loadPlayers() {
  setState({ loading: true, error: '' });
  try {
    const query = state.playersSearch ? `?search=${encodeURIComponent(state.playersSearch)}` : '';
    const data = await api(`/admin/players${query}`);
    setState({
      players: data.players,
      playersTotal: data.totalPlayers,
      playersMatching: data.matching,
      playersTruncated: data.truncated,
      loading: false
    });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function loadContactSettings() {
  setState({ loading: true, error: '' });
  try {
    const [contact, theme, ad] = await Promise.all([
      api('/admin/settings/contact-whatsapp'),
      api('/admin/settings/theme'),
      api('/ad')
    ]);
    setState({ contactWhatsapp: contact.whatsappNumber, currentTheme: theme.theme, bgColor: theme.bgColor || '', blueColor: theme.blueColor || '', cardColor: theme.cardColor || '', bgImage: theme.bgImage || '', topbarBgImage: theme.topbarBgImage || '', logo: theme.logo || '', adImage: ad.adImage || '', loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

// Liste des conversations "support" (voir renderMessagesSection()) — recharge toujours la
// liste (jamais une conversation ouverte, voir openMessageThread() plus bas pour ça) :
// utilisé à l'ouverture de l'onglet et au retour depuis une conversation ("← Retour à la
// liste"), pour rafraîchir les compteurs de messages non lus.
async function loadMessageThreads() {
  setState({ loading: true, error: '' });
  try {
    const data = await api('/admin/chat/threads?purpose=support');
    setState({ messageThreads: data.threads, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function openMessageThread(phone) {
  setState({ loading: true, error: '' });
  try {
    const data = await api(`/admin/chat/messages?phone=${encodeURIComponent(phone)}&purpose=support`);
    setState({ openMessageThread: phone, messageThreadMessages: data.messages, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

function loadSection() {
  if (state.section === 'cashouts') return loadCashouts();
  if (state.section === 'verifications') return loadVerifications();
  if (state.section === 'messages') return loadMessageThreads();
  if (state.section === 'deposits') return loadDeposits();
  if (state.section === 'vip') return loadVipPurchases();
  if (state.section === 'agents') return loadAgents();
  if (state.section === 'refills') return loadRefills();
  if (state.section === 'revenue') return loadRevenue();
  if (state.section === 'players') return loadPlayers();
  if (state.section === 'settings') return loadContactSettings();
}

// ---------- Bind ----------
function bind() {
  if (!state.token) {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = new FormData(e.target).get('password');
      try {
        const data = await api('/admin/login', { method: 'POST', body: { password } });
        localStorage.setItem('konkou_admin_token', data.token);
        state.token = data.token;
        loadSection();
      } catch (err) {
        setState({ error: err.message });
      }
    });
    return;
  }

  document.getElementById('logout-btn').addEventListener('click', logout);

  document.querySelectorAll('[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.section = btn.dataset.section;
      state.statusFilter = 'pending';
      state.agentsView = 'list';
      loadSection();
    });
  });

  document.querySelectorAll('[data-cashout-filter]').forEach(btn => {
    btn.addEventListener('click', () => { state.statusFilter = btn.dataset.cashoutFilter; loadCashouts(); });
  });
  document.querySelectorAll('[data-pay]').forEach(btn => {
    btn.addEventListener('click', () => actOnCashout(btn.dataset.pay, 'pay'));
  });
  document.querySelectorAll('[data-reject]').forEach(btn => {
    btn.addEventListener('click', () => actOnCashout(btn.dataset.reject, 'reject'));
  });

  document.querySelectorAll('[data-verify-purpose]').forEach(btn => {
    btn.addEventListener('click', () => { state.verifyPurpose = btn.dataset.verifyPurpose; loadVerifications(); });
  });
  document.querySelectorAll('[data-confirm-verify]').forEach(btn => {
    btn.addEventListener('click', () => {
      const phone = btn.dataset.confirmVerify;
      const input = document.querySelector(`[data-verify-code-input="${CSS.escape(phone)}"]`);
      confirmVerification(phone, input ? input.value : '');
    });
  });
  document.querySelectorAll('[data-reject-verify]').forEach(btn => {
    btn.addEventListener('click', () => rejectVerification(btn.dataset.rejectVerify));
  });
  document.querySelectorAll('[data-verify-reply-form]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = form.dataset.verifyReplyForm;
      const textarea = form.querySelector('textarea');
      try {
        await api('/admin/chat/reply', { method: 'POST', body: { phone, purpose: state.verifyPurpose, body: textarea.value } });
        textarea.value = '';
        loadVerificationChats(state.verifications);
      } catch (err) {
        setState({ error: err.message });
      }
    });
  });

  document.querySelectorAll('[data-open-message-thread]').forEach(card => {
    card.addEventListener('click', () => openMessageThread(card.dataset.openMessageThread));
  });
  const messagesBackBtn = document.getElementById('messages-back-btn');
  if (messagesBackBtn) messagesBackBtn.addEventListener('click', () => setState({ openMessageThread: null, messageThreadMessages: [] }));
  const messageReplyForm = document.getElementById('message-reply-form');
  if (messageReplyForm) {
    messageReplyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = new FormData(e.target).get('body');
      try {
        await api('/admin/chat/reply', { method: 'POST', body: { phone: state.openMessageThread, purpose: 'support', body: text } });
        e.target.reset();
        openMessageThread(state.openMessageThread);
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }

  document.querySelectorAll('[data-deposit-filter]').forEach(btn => {
    btn.addEventListener('click', () => { state.statusFilter = btn.dataset.depositFilter; loadDeposits(); });
  });
  document.querySelectorAll('[data-deposit-confirm]').forEach(btn => {
    btn.addEventListener('click', () => actOnDeposit(btn.dataset.depositConfirm, 'confirm'));
  });
  document.querySelectorAll('[data-deposit-reject]').forEach(btn => {
    btn.addEventListener('click', () => actOnDeposit(btn.dataset.depositReject, 'reject'));
  });

  document.querySelectorAll('[data-vip-filter]').forEach(btn => {
    btn.addEventListener('click', () => { state.statusFilter = btn.dataset.vipFilter; loadVipPurchases(); });
  });
  document.querySelectorAll('[data-vip-confirm]').forEach(btn => {
    btn.addEventListener('click', () => actOnVip(btn.dataset.vipConfirm, 'confirm'));
  });
  document.querySelectorAll('[data-vip-reject]').forEach(btn => {
    btn.addEventListener('click', () => actOnVip(btn.dataset.vipReject, 'reject'));
  });

  document.querySelectorAll('[data-agent-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.agentFilter;
      if (key === 'report' || key === 'reimbursements') {
        state.agentsView = key;
      } else {
        state.agentsView = 'list';
        state.statusFilter = key;
      }
      loadAgents();
    });
  });

  document.querySelectorAll('[data-reimburse]').forEach(btn => {
    btn.addEventListener('click', () => actOnAgentReimbursement(btn.dataset.reimburse, btn.dataset.reimburseMethod));
  });
  document.querySelectorAll('[data-agent-approve]').forEach(btn => {
    btn.addEventListener('click', () => actOnAgent(btn.dataset.agentApprove, 'approve'));
  });
  document.querySelectorAll('[data-agent-reject]').forEach(btn => {
    btn.addEventListener('click', () => actOnAgent(btn.dataset.agentReject, 'reject'));
  });

  document.getElementById('report-from-input')?.addEventListener('change', (e) => { state.reportFrom = e.target.value; });
  document.getElementById('report-to-input')?.addEventListener('change', (e) => { state.reportTo = e.target.value; });
  document.getElementById('report-apply-btn')?.addEventListener('click', () => loadAgentsReport());
  document.getElementById('report-reset-btn')?.addEventListener('click', () => {
    setState({ reportFrom: '', reportTo: '' });
    loadAgentsReport();
  });
  document.getElementById('report-print-btn')?.addEventListener('click', () => window.print());

  document.querySelectorAll('[data-refill-filter]').forEach(btn => {
    btn.addEventListener('click', () => { state.statusFilter = btn.dataset.refillFilter; loadRefills(); });
  });
  document.querySelectorAll('[data-refill-confirm]').forEach(btn => {
    btn.addEventListener('click', () => actOnRefill(btn.dataset.refillConfirm, 'confirm'));
  });
  document.querySelectorAll('[data-refill-reject]').forEach(btn => {
    btn.addEventListener('click', () => actOnRefill(btn.dataset.refillReject, 'reject'));
  });

  bindNotificationsToggleEvents(api, state.pushSubscribed, (result) => {
    if (result.status === 'subscribed') { setState({ pushSubscribed: true, error: '', success: 'Notifications activées sur cet appareil.' }); return; }
    if (result.status === 'unsubscribed') { setState({ pushSubscribed: false, error: '', success: 'Notifications désactivées sur cet appareil.' }); return; }
    if (result.status === 'unsupported') { setState({ error: "Ce navigateur/appareil ne prend pas en charge les notifications." }); return; }
    if (result.status === 'denied') { setState({ error: "Permission refusée — activez les notifications pour ce site dans les réglages de votre navigateur, puis réessayez." }); return; }
    if (result.status === 'dismissed') { return; }
    setState({ error: result.error || 'Erreur inconnue lors de l\'activation des notifications.' });
  });

  const playersSearchForm = document.getElementById('players-search-form');
  if (playersSearchForm) {
    playersSearchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const search = new FormData(e.target).get('search');
      state.playersSearch = (search || '').trim();
      loadPlayers();
    });
  }
  document.getElementById('players-search-reset-btn')?.addEventListener('click', () => {
    state.playersSearch = '';
    loadPlayers();
  });
  document.querySelectorAll('[data-players-manage]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const phone = btn.dataset.playersManage;
      try {
        const data = await api(`/admin/accounts/lookup?phone=${encodeURIComponent(phone)}`);
        setState({ section: 'accounts', accountLookup: data, error: '', success: '' });
      } catch (err) {
        if (err.status === 401) { logout(); return; }
        setState({ error: err.message });
      }
    });
  });

  const lookupForm = document.getElementById('account-lookup-form');
  if (lookupForm) {
    lookupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = new FormData(e.target).get('phone');
      try {
        const data = await api(`/admin/accounts/lookup?phone=${encodeURIComponent(phone)}`);
        setState({ accountLookup: data, error: '', success: '' });
      } catch (err) {
        setState({ error: err.message, accountLookup: null });
      }
    });
  }
  const contactWhatsappForm = document.getElementById('contact-whatsapp-form');
  if (contactWhatsappForm) {
    contactWhatsappForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const whatsappNumber = new FormData(e.target).get('whatsappNumber');
      try {
        const data = await api('/admin/settings/contact-whatsapp', { method: 'POST', body: { whatsappNumber } });
        setState({ success: data.message, error: '', contactWhatsapp: data.whatsappNumber });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
  document.querySelectorAll('[data-broadcast-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ broadcastTarget: btn.dataset.broadcastTarget, broadcastResult: null });
    });
  });
  const broadcastForm = document.getElementById('broadcast-form');
  if (broadcastForm) {
    broadcastForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const title = fd.get('title');
      const messageBody = fd.get('body');
      const target = state.broadcastTarget;
      const label = target === 'players' ? 'tous les joueurs' : 'tous les agents';
      if (!confirm(`Envoyer cette annonce à ${label} abonnés aux notifications ? Cette action ne peut pas être annulée.`)) return;
      setState({ loading: true, error: '' });
      try {
        const data = await api(`/admin/broadcast/${target}`, { method: 'POST', body: { title, body: messageBody } });
        setState({ success: data.message, error: '', loading: false, broadcastResult: { targeted: data.targeted, sent: data.sent, expired: data.expired, target } });
        e.target.reset();
      } catch (err) {
        if (err.status === 401) { logout(); return; }
        setState({ error: err.message, loading: false });
      }
    });
  }
  document.querySelectorAll('[data-theme-pick]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const theme = btn.dataset.themePick;
      try {
        const data = await api('/admin/settings/theme', { method: 'POST', body: { theme } });
        applyThemeVars(data.theme, state.bgColor, state.blueColor, state.cardColor);
        applyThemeParticles(data.theme);
        setState({ currentTheme: data.theme, success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  });
  const bgColorApplyBtn = document.getElementById('bg-color-apply-btn');
  if (bgColorApplyBtn) {
    bgColorApplyBtn.addEventListener('click', async () => {
      const bgColor = document.getElementById('bg-color-input').value;
      try {
        const data = await api('/admin/settings/bg-color', { method: 'POST', body: { bgColor } });
        applyThemeVars(state.currentTheme, data.bgColor, state.blueColor, state.cardColor);
        setState({ bgColor: data.bgColor, success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
  const bgColorResetBtn = document.getElementById('bg-color-reset-btn');
  if (bgColorResetBtn) {
    bgColorResetBtn.addEventListener('click', async () => {
      try {
        const data = await api('/admin/settings/bg-color', { method: 'POST', body: { bgColor: '' } });
        applyThemeVars(state.currentTheme, '', state.blueColor, state.cardColor);
        setState({ bgColor: '', success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
  const blueColorApplyBtn = document.getElementById('blue-color-apply-btn');
  if (blueColorApplyBtn) {
    blueColorApplyBtn.addEventListener('click', async () => {
      const blueColor = document.getElementById('blue-color-input').value;
      try {
        const data = await api('/admin/settings/blue-color', { method: 'POST', body: { blueColor } });
        applyThemeVars(state.currentTheme, state.bgColor, data.blueColor, state.cardColor);
        setState({ blueColor: data.blueColor, success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
  const blueColorResetBtn = document.getElementById('blue-color-reset-btn');
  if (blueColorResetBtn) {
    blueColorResetBtn.addEventListener('click', async () => {
      try {
        const data = await api('/admin/settings/blue-color', { method: 'POST', body: { blueColor: '' } });
        applyThemeVars(state.currentTheme, state.bgColor, '', state.cardColor);
        setState({ blueColor: '', success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }

  const cardColorApplyBtn = document.getElementById('card-color-apply-btn');
  if (cardColorApplyBtn) {
    cardColorApplyBtn.addEventListener('click', async () => {
      const cardColor = document.getElementById('card-color-input').value;
      try {
        const data = await api('/admin/settings/card-color', { method: 'POST', body: { cardColor } });
        applyThemeVars(state.currentTheme, state.bgColor, state.blueColor, data.cardColor);
        setState({ cardColor: data.cardColor, success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
  const cardColorResetBtn = document.getElementById('card-color-reset-btn');
  if (cardColorResetBtn) {
    cardColorResetBtn.addEventListener('click', async () => {
      try {
        const data = await api('/admin/settings/card-color', { method: 'POST', body: { cardColor: '' } });
        applyThemeVars(state.currentTheme, state.bgColor, state.blueColor, '');
        setState({ cardColor: '', success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
  const adImageApplyBtn = document.getElementById('ad-image-apply-btn');
  if (adImageApplyBtn) {
    adImageApplyBtn.addEventListener('click', async () => {
      const fileInput = document.getElementById('ad-image-input');
      const file = fileInput?.files?.[0];
      if (!file) { setState({ error: 'Choisissez d\'abord une image.' }); return; }
      setState({ loading: true, error: '' });
      try {
        // Redimensionnement "photo" (resizeImageForBg) — pas resizeImageForLogo, qui
        // préserve la transparence PNG mais ne convient pas à une image publicitaire.
        const imageDataUrl = await resizeImageForBg(file, 1600, 0.85);
        const data = await api('/admin/settings/ad', { method: 'POST', body: { imageDataUrl } });
        setState({ adImage: data.adImage, success: data.message, error: '', loading: false });
      } catch (err) {
        setState({ error: err.message, loading: false });
      }
    });
  }
  const adImageResetBtn = document.getElementById('ad-image-reset-btn');
  if (adImageResetBtn) {
    adImageResetBtn.addEventListener('click', async () => {
      try {
        const data = await api('/admin/settings/ad', { method: 'POST', body: { imageDataUrl: '' } });
        setState({ adImage: '', success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
  const bgImageApplyBtn = document.getElementById('bg-image-apply-btn');
  if (bgImageApplyBtn) {
    bgImageApplyBtn.addEventListener('click', async () => {
      const fileInput = document.getElementById('bg-image-input');
      const file = fileInput?.files?.[0];
      if (!file) { setState({ error: 'Choisissez d\'abord une image.' }); return; }
      setState({ loading: true, error: '' });
      try {
        const imageDataUrl = await resizeImageForBg(file);
        const data = await api('/admin/settings/bg-image', { method: 'POST', body: { imageDataUrl } });
        applyBgImage(data.bgImage);
        setState({ bgImage: data.bgImage, success: data.message, error: '', loading: false });
      } catch (err) {
        setState({ error: err.message, loading: false });
      }
    });
  }
  const bgImageResetBtn = document.getElementById('bg-image-reset-btn');
  if (bgImageResetBtn) {
    bgImageResetBtn.addEventListener('click', async () => {
      try {
        const data = await api('/admin/settings/bg-image', { method: 'POST', body: { imageDataUrl: '' } });
        applyBgImage('');
        setState({ bgImage: '', success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
  const logoApplyBtn = document.getElementById('logo-apply-btn');
  if (logoApplyBtn) {
    logoApplyBtn.addEventListener('click', async () => {
      const fileInput = document.getElementById('logo-input');
      const file = fileInput?.files?.[0];
      if (!file) { setState({ error: 'Choisissez d\'abord une image.' }); return; }
      setState({ loading: true, error: '' });
      try {
        const imageDataUrl = await resizeImageForLogo(file);
        const data = await api('/admin/settings/logo', { method: 'POST', body: { imageDataUrl } });
        applyLogo(data.logo);
        setState({ logo: data.logo, success: data.message, error: '', loading: false });
      } catch (err) {
        setState({ error: err.message, loading: false });
      }
    });
  }
  const logoResetBtn = document.getElementById('logo-reset-btn');
  if (logoResetBtn) {
    logoResetBtn.addEventListener('click', async () => {
      try {
        const data = await api('/admin/settings/logo', { method: 'POST', body: { imageDataUrl: '' } });
        applyLogo('');
        setState({ logo: '', success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
  const topbarBgImageApplyBtn = document.getElementById('topbar-bg-image-apply-btn');
  if (topbarBgImageApplyBtn) {
    topbarBgImageApplyBtn.addEventListener('click', async () => {
      const fileInput = document.getElementById('topbar-bg-image-input');
      const file = fileInput?.files?.[0];
      if (!file) { setState({ error: 'Choisissez d\'abord une image.' }); return; }
      setState({ loading: true, error: '' });
      try {
        const imageDataUrl = await resizeImageForBg(file);
        const data = await api('/admin/settings/topbar-bg-image', { method: 'POST', body: { imageDataUrl } });
        applyTopbarBgImage(data.topbarBgImage);
        setState({ topbarBgImage: data.topbarBgImage, success: data.message, error: '', loading: false });
      } catch (err) {
        setState({ error: err.message, loading: false });
      }
    });
  }
  const topbarBgImageResetBtn = document.getElementById('topbar-bg-image-reset-btn');
  if (topbarBgImageResetBtn) {
    topbarBgImageResetBtn.addEventListener('click', async () => {
      try {
        const data = await api('/admin/settings/topbar-bg-image', { method: 'POST', body: { imageDataUrl: '' } });
        applyTopbarBgImage('');
        setState({ topbarBgImage: '', success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
  // Zone de danger — double confirmation volontairement redondante avec le backend
  // (voir adminRoutes.resetTestData) : un confirm() de résumé, puis le mot de passe
  // ADMIN_PASSWORD lui-même (pas juste une phrase à recopier) avant d'appeler la route —
  // même principe que deleteMyAccount côté joueur, qui redemande le mot de passe.
  const resetTestDataBtn = document.getElementById('reset-test-data-btn');
  if (resetTestDataBtn) {
    resetTestDataBtn.addEventListener('click', async () => {
      const summary = 'Ceci supprime DÉFINITIVEMENT tous les comptes joueur/agent, transactions, dépôts, retraits, VIP et renflouements (les réglages sont conservés). Irréversible. Continuer ?';
      if (!confirm(summary)) return;
      const password = prompt('Pour confirmer, entrez le mot de passe admin :');
      if (password === null) return; // annulé
      if (!password) {
        setState({ error: 'Mot de passe requis — action annulée, rien n\'a été supprimé.' });
        return;
      }
      setState({ loading: true, error: '' });
      try {
        const data = await api('/admin/reset-test-data', { method: 'POST', body: { password } });
        setState({ success: data.message, error: '', loading: false });
      } catch (err) {
        setState({ error: err.message, loading: false });
      }
    });
  }
  const revenueDateApplyBtn = document.getElementById('revenue-date-apply-btn');
  if (revenueDateApplyBtn) {
    revenueDateApplyBtn.addEventListener('click', () => {
      const date = document.getElementById('revenue-date-input').value;
      if (!date) { setState({ error: 'Choisissez une date.' }); return; }
      setState({ revenueDate: date, error: '' });
      loadRevenue();
    });
  }
  const revenueDateResetBtn = document.getElementById('revenue-date-reset-btn');
  if (revenueDateResetBtn) {
    revenueDateResetBtn.addEventListener('click', () => {
      setState({ revenueDate: '', error: '' });
      loadRevenue();
    });
  }
  const deleteAccountBtn = document.getElementById('account-delete-btn');
  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
      const phone = deleteAccountBtn.dataset.phone;
      const points = Number(deleteAccountBtn.dataset.points) || 0;
      const credit = Number(deleteAccountBtn.dataset.credit) || 0;
      const commission = Number(deleteAccountBtn.dataset.commission) || 0;
      const notes = [];
      if (points > 0) notes.push(`${points} points seront définitivement perdus`);
      if (credit > 0 || commission > 0) notes.push(`${credit} HTG de crédit et ${commission} HTG de commissions resteront à régler avec l'agent en dehors de l'app`);
      const warning = notes.length > 0
        ? `Supprimer définitivement le compte ${phone} ? Cette action est irréversible et ${notes.join(', ')}.`
        : `Supprimer définitivement le compte ${phone} ? Cette action est irréversible.`;
      if (!confirm(warning)) return;
      try {
        const data = await api('/admin/accounts/delete', { method: 'POST', body: { phone } });
        setState({ success: data.message, error: '', accountLookup: null });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
}

async function actOnRefill(id, action) {
  const confirmMsg = action === 'confirm'
    ? 'Confirmer avoir reçu ce dépôt de renflouement en espèces ?'
    : 'Rejeter cette demande de renflouement ?';
  if (!confirm(confirmMsg)) return;
  try {
    const data = await api(`/admin/agent-refills/${action}`, { method: 'POST', body: { id: Number(id) } });
    setState({ success: data.message, error: '' });
    loadRefills();
  } catch (err) {
    setState({ error: err.message });
  }
}

async function actOnAgent(id, action) {
  const confirmMsg = action === 'approve'
    ? "Confirmer avoir reçu le capital de cet agent et vérifié sa pièce d'identité ?"
    : 'Rejeter cette candidature agent ?';
  if (!confirm(confirmMsg)) return;
  try {
    const data = await api(`/admin/agents/${action}`, { method: 'POST', body: { id: Number(id) } });
    setState({ success: data.message, error: '' });
    loadAgents();
  } catch (err) {
    setState({ error: err.message });
  }
}

async function actOnCashout(id, action) {
  const confirmMsg = action === 'pay'
    ? 'Confirmer que ce retrait a bien été payé en espèces ?'
    : 'Rejeter cette demande et rembourser les points au joueur ?';
  if (!confirm(confirmMsg)) return;
  try {
    const data = await api(`/admin/cashouts/${action}`, { method: 'POST', body: { id: Number(id) } });
    setState({ success: data.message, error: '' });
    loadCashouts();
  } catch (err) {
    setState({ error: err.message });
  }
}

async function confirmVerification(phone, code) {
  const trimmedCode = String(code || '').trim();
  if (!trimmedCode) {
    setState({ error: 'Recopiez le code reçu sur WhatsApp dans le champ prévu avant de confirmer.' });
    return;
  }
  if (!confirm(`Confirmer que le code ${trimmedCode} correspond bien au message WhatsApp reçu de ${phone} ?`)) return;
  try {
    const path = state.verifyPurpose === 'verify_phone' ? '/admin/verifications/confirm-phone' : '/admin/verifications/confirm-reset';
    const data = await api(path, { method: 'POST', body: { phone, code: trimmedCode } });
    setState({ success: data.message, error: '' });
    // Pour une réinitialisation de mot de passe (depuis la refonte de juillet 2026), la
    // confirmation n'applique plus rien elle-même — elle AUTORISE seulement la demande
    // (voir confirmPasswordReset dans routes/admin.js). C'est à l'opérateur de prévenir la
    // personne pour qu'elle revienne choisir son nouveau mot de passe dans l'app ; comme
    // Konkou n'a pas d'API WhatsApp Business, on ouvre directement le lien wa.me pré-rempli
    // renvoyé par le serveur (même mécanique que renderContactForm côté joueur) plutôt que
    // de forcer l'opérateur à recopier un numéro et un message à la main.
    if (data.whatsappReplyLink) {
      window.open(data.whatsappReplyLink, '_blank');
    }
    loadVerifications();
  } catch (err) {
    setState({ error: err.message });
  }
}

async function rejectVerification(phone) {
  if (!confirm(`Refuser cette demande de ${phone} (aucun message WhatsApp reçu ou code ne correspondant pas) ?`)) return;
  try {
    const path = state.verifyPurpose === 'verify_phone' ? '/admin/verifications/reject-phone' : '/admin/verifications/reject-reset';
    const data = await api(path, { method: 'POST', body: { phone } });
    setState({ success: data.message, error: '' });
    loadVerifications();
  } catch (err) {
    setState({ error: err.message });
  }
}

async function actOnDeposit(id, action) {
  const confirmMsg = action === 'confirm'
    ? 'Confirmer que ce paiement a bien été reçu en espèces (crédite les parties bonus) ?'
    : "Rejeter cette demande (le paiement n'a pas été reçu) ?";
  if (!confirm(confirmMsg)) return;
  try {
    const path = action === 'confirm' ? '/admin/deposits/confirm' : '/admin/deposits/reject';
    const data = await api(path, { method: 'POST', body: { id: Number(id) } });
    setState({ success: data.message, error: '' });
    loadDeposits();
  } catch (err) {
    setState({ error: err.message });
  }
}

async function actOnVip(id, action) {
  const confirmMsg = action === 'confirm'
    ? 'Confirmer que ce paiement VIP a bien été reçu en espèces (prolonge le compte joueur) ?'
    : "Rejeter cette demande VIP (le paiement n'a pas été reçu) ?";
  if (!confirm(confirmMsg)) return;
  try {
    const path = action === 'confirm' ? '/admin/vip/confirm' : '/admin/vip/reject';
    const data = await api(path, { method: 'POST', body: { id: Number(id) } });
    setState({ success: data.message, error: '' });
    loadVipPurchases();
  } catch (err) {
    setState({ error: err.message });
  }
}

// ---------- INIT ----------
render();
if (state.token) loadSection();
