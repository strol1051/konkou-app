// Konkou - mini interface agent/gestionnaire : payer/rejeter les retraits, confirmer les
// inscriptions/réinitialisations via WhatsApp, confirmer/rejeter les dépôts de parties bonus.
// Page volontairement séparée de l'app principale (pas de lien depuis app.js) : ce n'est
// pas un compte utilisateur, c'est un accès protégé par le mot de passe ADMIN_PASSWORD.

const APP = document.getElementById('app');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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

function applyThemeVars(themeKey, bgColor, blueColor) {
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
}

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
    applyThemeVars(data.theme, data.bgColor, data.blueColor);
    applyThemeParticles(data.theme);
    applyBgImage(data.bgImage);
    applyTopbarBgImage(data.topbarBgImage);
    applyLogo(data.logo);
  } catch {
    // Hors ligne ou erreur réseau : on garde les couleurs par défaut de styles.css.
  }
}
applyThemeFromServer();

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
  deposits: [],
  agents: [],
  refills: [],
  vip: [],
  revenue: null,
  accountLookup: null,
  contactWhatsapp: null, // numéro configuré pour "Nous contacter" (null tant que non défini)
  currentTheme: 'default', // thème saisonnier actif (voir THEMES plus haut)
  bgColor: '', // couleur de fond personnalisée ('' = pas de surcharge, fond du thème actif)
  blueColor: '', // couleur bleu foncé personnalisée ('' = pas de surcharge, bleu du thème actif)
  adImage: '', // URL du panneau publicitaire ('' = aucun panneau affiché côté joueur/agent)
  bgImage: '', // URL de la photo de fond personnalisée ('' = filigrane logo par défaut)
  topbarBgImage: '', // URL de la photo dédiée à la barre du haut ('' = dégradé du thème actif)
  logo: '', // URL du logo personnalisé ('' = frontend/logo.png par défaut)
  revenueDate: '', // date choisie pour le filtre "Revenus par jour" ('' = tout l'historique)
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
  setState({ token: null, cashouts: [], verifications: [], deposits: [], agents: [], refills: [], vip: [], revenue: null, accountLookup: null, error: '', success: '' });
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
  const sections = [['cashouts', '💸 Retraits'], ['verifications', '💬 Vérifications'], ['deposits', '🎟️ Dépôts'], ['vip', '👑 VIP'], ['agents', '🧑‍💼 Agents'], ['refills', '💳 Renflouements'], ['revenue', '📊 Revenus'], ['accounts', '🗑️ Comptes'], ['settings', '⚙️ Réglages']];
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
  if (state.section === 'deposits') return renderDepositsSection();
  if (state.section === 'vip') return renderVipSection();
  if (state.section === 'agents') return renderAgentsSection();
  if (state.section === 'refills') return renderRefillsSection();
  if (state.section === 'revenue') return renderRevenueSection();
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
      Cross-vérifiez le numéro et le code ci-dessous avec le message WhatsApp reçu avant de confirmer.
    </p>
    ${state.verifications.length === 0 ? `<div class="card"><p>Aucune demande en attente.</p></div>` : state.verifications.map(v => `
      <div class="card">
        <h2>${escapeHtml(v.phone)}</h2>
        <p style="font-size:28px; font-weight:800; letter-spacing:4px; text-align:center;">${escapeHtml(v.code)}</p>
        <p style="font-size:12px;">Demandé le ${escapeHtml(v.requestedAt)} · Expire le ${escapeHtml(v.expiresAt)}</p>
        <input type="text" inputmode="numeric" maxlength="6" placeholder="Recopiez le code reçu sur WhatsApp" data-verify-code-input="${escapeHtml(v.phone)}" style="text-align:center; letter-spacing:2px; font-weight:700;" />
        <button class="tile" data-confirm-verify="${escapeHtml(v.phone)}" style="background:rgba(37,211,102,0.2); width:100%; margin-bottom:8px;">💬 Confirmer (message reçu sur WhatsApp)</button>
        <button class="tile" data-reject-verify="${escapeHtml(v.phone)}" style="background:rgba(210,16,52,0.2); width:100%;">❌ Refuser</button>
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

// ---------- Candidatures Agent ----------
const ID_TYPE_LABELS = { cin: "Carte d'Identification Nationale", passeport: 'Passeport', permis: 'Permis de conduire' };

function renderAgentsSection() {
  const tabs = [['pending', 'En attente'], ['active', 'Actifs'], ['rejected', 'Rejetés']];
  return `
    <div class="grid-2" style="grid-template-columns: repeat(3, 1fr); margin-top:14px;">
      ${tabs.map(([key, label]) => `
        <button class="tile" data-agent-filter="${key}" style="font-size:13px; ${state.statusFilter === key ? 'outline:2px solid var(--green);' : ''}">${label}</button>
      `).join('')}
    </div>
    ${state.agents.length === 0 ? `<div class="card"><p>Aucune candidature "${statusLabel(state.statusFilter)}".</p></div>` : state.agents.map(a => `
      <div class="card">
        <h2>N° ${escapeHtml(a.agent_number)} — ${escapeHtml(a.first_name)} ${escapeHtml(a.last_name)} — ${escapeHtml(a.agent_code)}</h2>
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
        <h2>${escapeHtml(r.agent_code)} — ${escapeHtml(r.first_name)} ${escapeHtml(r.last_name)}</h2>
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
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
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
  setState({ loading: true, error: '' });
  try {
    const data = await api(`/admin/agents?status=${state.statusFilter}`);
    setState({ agents: data.agents, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
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

async function loadContactSettings() {
  setState({ loading: true, error: '' });
  try {
    const [contact, theme, ad] = await Promise.all([
      api('/admin/settings/contact-whatsapp'),
      api('/admin/settings/theme'),
      api('/ad')
    ]);
    setState({ contactWhatsapp: contact.whatsappNumber, currentTheme: theme.theme, bgColor: theme.bgColor || '', blueColor: theme.blueColor || '', bgImage: theme.bgImage || '', topbarBgImage: theme.topbarBgImage || '', logo: theme.logo || '', adImage: ad.adImage || '', loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

function loadSection() {
  if (state.section === 'cashouts') return loadCashouts();
  if (state.section === 'verifications') return loadVerifications();
  if (state.section === 'deposits') return loadDeposits();
  if (state.section === 'vip') return loadVipPurchases();
  if (state.section === 'agents') return loadAgents();
  if (state.section === 'refills') return loadRefills();
  if (state.section === 'revenue') return loadRevenue();
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
    btn.addEventListener('click', () => { state.statusFilter = btn.dataset.agentFilter; loadAgents(); });
  });
  document.querySelectorAll('[data-agent-approve]').forEach(btn => {
    btn.addEventListener('click', () => actOnAgent(btn.dataset.agentApprove, 'approve'));
  });
  document.querySelectorAll('[data-agent-reject]').forEach(btn => {
    btn.addEventListener('click', () => actOnAgent(btn.dataset.agentReject, 'reject'));
  });

  document.querySelectorAll('[data-refill-filter]').forEach(btn => {
    btn.addEventListener('click', () => { state.statusFilter = btn.dataset.refillFilter; loadRefills(); });
  });
  document.querySelectorAll('[data-refill-confirm]').forEach(btn => {
    btn.addEventListener('click', () => actOnRefill(btn.dataset.refillConfirm, 'confirm'));
  });
  document.querySelectorAll('[data-refill-reject]').forEach(btn => {
    btn.addEventListener('click', () => actOnRefill(btn.dataset.refillReject, 'reject'));
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
  document.querySelectorAll('[data-theme-pick]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const theme = btn.dataset.themePick;
      try {
        const data = await api('/admin/settings/theme', { method: 'POST', body: { theme } });
        applyThemeVars(data.theme, state.bgColor, state.blueColor);
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
        applyThemeVars(state.currentTheme, data.bgColor, state.blueColor);
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
        applyThemeVars(state.currentTheme, '', state.blueColor);
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
        applyThemeVars(state.currentTheme, state.bgColor, data.blueColor);
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
        applyThemeVars(state.currentTheme, state.bgColor, '');
        setState({ blueColor: '', success: data.message, error: '' });
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
