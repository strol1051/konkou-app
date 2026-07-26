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
  }
};

function applyThemeVars(themeKey) {
  const theme = THEMES[themeKey] || THEMES.default;
  const root = document.documentElement.style;
  ['--blue', '--blue-2', '--red', '--bg', '--card', '--card-2'].forEach(v => root.removeProperty(v));
  Object.entries(theme.vars).forEach(([k, v]) => root.setProperty(k, v));
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

async function applyThemeFromServer() {
  try {
    const res = await fetch('/api/theme');
    const data = await res.json();
    applyThemeVars(data.theme);
    applyThemeParticles(data.theme);
  } catch {
    // Hors ligne ou erreur réseau : on garde les couleurs par défaut de styles.css.
  }
}
applyThemeFromServer();

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
  revenue: null,
  accountLookup: null,
  contactWhatsapp: null, // numéro configuré pour "Nous contacter" (null tant que non défini)
  currentTheme: 'default', // thème saisonnier actif (voir THEMES plus haut)
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
  setState({ token: null, cashouts: [], verifications: [], deposits: [], agents: [], refills: [], revenue: null, accountLookup: null, error: '', success: '' });
}

function render() {
  APP.innerHTML = state.token ? renderDashboard() : renderLogin();
  bind();
}

function renderLogin() {
  return `
    <div class="auth-screen">
      <div class="auth-logo">
        <img src="logo.png" alt="Konkou" class="auth-logo-img">
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
  const sections = [['cashouts', '💸 Retraits'], ['verifications', '💬 Vérifications'], ['deposits', '🎟️ Dépôts'], ['agents', '🧑‍💼 Agents'], ['refills', '💳 Renflouements'], ['revenue', '📊 Revenus'], ['accounts', '🗑️ Comptes'], ['settings', '⚙️ Réglages']];
  return `
    <div class="topbar">
      <h1>🇭🇹 Konkou — Gestion</h1>
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
        <p><strong>${d.htg_amount} HTG → ${d.plays_granted} partie(s) bonus</strong></p>
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
    ['Frais de service sur les retraits', b.cashoutServiceFees]
  ];
  return `
    <div class="card" style="margin-top:14px;">
      <h2>📊 Revenu total de la plateforme</h2>
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
      <p style="font-size:13px;">Recherchez un compte (agent ou joueur) par numéro de téléphone. La suppression est bloquée si le compte a un retrait ou dépôt en attente, ou un rôle agent actif — réglez ces éléments d'abord via les autres onglets, puis revenez ici. Un solde de points ne bloque plus la suppression : il est simplement perdu.</p>
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
        ${a.status === 'active' ? `
          <div class="stat-row"><span>Crédit agent</span><span>${a.credit_balance} HTG</span></div>
          <div class="stat-row"><span>Commissions</span><span>${a.commission_earned} HTG</span></div>
        ` : ''}
      ` : `<p style="font-size:12px; color:var(--muted);">Pas de rôle agent.</p>`}
      ${u.points > 0 ? `<p class="error-banner">⚠️ Ce compte a <strong>${u.points} points</strong> — ils seront définitivement perdus à la suppression.</p>` : ''}
      <button class="tile" id="account-delete-btn" data-phone="${escapeHtml(u.phone)}" data-points="${u.points}" style="background:rgba(210,16,52,0.2); width:100%; margin-top:10px;">🗑️ Supprimer ce compte définitivement</button>
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
    const data = await api('/admin/revenue');
    setState({ revenue: data, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

async function loadContactSettings() {
  setState({ loading: true, error: '' });
  try {
    const [contact, theme] = await Promise.all([
      api('/admin/settings/contact-whatsapp'),
      api('/admin/settings/theme')
    ]);
    setState({ contactWhatsapp: contact.whatsappNumber, currentTheme: theme.theme, loading: false });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    setState({ error: err.message, loading: false });
  }
}

function loadSection() {
  if (state.section === 'cashouts') return loadCashouts();
  if (state.section === 'verifications') return loadVerifications();
  if (state.section === 'deposits') return loadDeposits();
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
    btn.addEventListener('click', () => confirmVerification(btn.dataset.confirmVerify));
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
        applyThemeVars(data.theme);
        applyThemeParticles(data.theme);
        setState({ currentTheme: data.theme, success: data.message, error: '' });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  });
  const deleteAccountBtn = document.getElementById('account-delete-btn');
  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
      const phone = deleteAccountBtn.dataset.phone;
      const points = Number(deleteAccountBtn.dataset.points) || 0;
      const warning = points > 0
        ? `Supprimer définitivement le compte ${phone} ? Cette action est irréversible et ${points} points seront définitivement perdus.`
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

async function confirmVerification(phone) {
  if (!confirm(`Confirmer avoir reçu et vérifié le message WhatsApp de ${phone} ?`)) return;
  try {
    const path = state.verifyPurpose === 'verify_phone' ? '/admin/verifications/confirm-phone' : '/admin/verifications/confirm-reset';
    const data = await api(path, { method: 'POST', body: { phone } });
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

// ---------- INIT ----------
render();
if (state.token) loadSection();
