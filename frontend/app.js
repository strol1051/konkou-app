// Konkou - application front-end (vanilla JS, aucune dépendance / aucun build requis)

const APP = document.getElementById('app');

// Names, referral notes, etc. can contain arbitrary text chosen by other users
// (e.g. a leaderboard entry, or "Parrainage de X" in a referrer's transaction history).
// Always escape before inserting into innerHTML to prevent stored XSS.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" (UTC, no "T", no offset).
// Safari's Date parser rejects that format (returns Invalid Date), so normalize to ISO 8601 first.
function formatDate(sqliteDateString) {
  if (!sqliteDateString) return '';
  const iso = sqliteDateString.includes('T') ? sqliteDateString : `${sqliteDateString.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return isNaN(d) ? sqliteDateString : d.toLocaleDateString('fr-FR');
}

const state = {
  token: localStorage.getItem('konkou_token') || null,
  user: JSON.parse(localStorage.getItem('konkou_user') || 'null'),
  view: 'home',
  authMode: 'login', // login | register | awaiting-confirm | forgot-request
  // Détails de la demande en attente de confirmation WhatsApp par un admin :
  // { phone, purpose ('verify_phone'|'reset_password'), code, whatsappLink }
  awaiting: null,
  awaitingStatus: null, // null | 'pending' | 'expired' | 'invalid'
  error: '',
  success: '',
  loading: false,
  lastCashoutCode: null, // code affiché juste après une demande de retrait réussie
  lastCashoutDetails: null, // { htgAmount, feePercent, platformFeeHtg, netPayoutHtg } de la dernière demande
  lastDepositCode: null, // code affiché juste après une demande de dépôt réussie
  // jeu en cours
  game: null // { type, sessionToken, questions/problems, index, answers, result }
};

function setState(patch) {
  Object.assign(state, patch);
  render();
}

// ---------- POLLING (confirmation WhatsApp par un admin) ----------
let pollTimer = null;

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    const { phone, purpose, code } = state.awaiting || {};
    if (!phone || !purpose || !code) return stopPolling();
    try {
      const params = new URLSearchParams({ phone, purpose, code });
      const res = await fetch(`/api/auth/verify-status?${params}`);
      const data = await res.json();
      if (data.status === 'confirmed') {
        stopPolling();
        persistAuth(data.token, data.user);
        setState({ view: 'home', authMode: 'login', awaiting: null, awaitingStatus: null, error: '', success: '' });
      } else if (data.status === 'expired' || data.status === 'invalid') {
        stopPolling();
        setState({ awaitingStatus: data.status });
      }
      // 'pending' -> keep waiting, no re-render needed to avoid flicker
    } catch {
      // network hiccup — just try again on the next tick
    }
  }, 3000);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Erreur inconnue');
    err.status = res.status;
    err.code = data.code;
    err.phone = data.phone;
    throw err;
  }
  return data;
}

function persistAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('konkou_token', token);
  localStorage.setItem('konkou_user', JSON.stringify(user));
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('konkou_token');
  localStorage.removeItem('konkou_user');
  setState({ view: 'home', authMode: 'login', error: '', success: '' });
}

async function refreshProfile() {
  try {
    const p = await api('/profile');
    state.user = { ...state.user, ...p, referralCode: p.referralCode };
    localStorage.setItem('konkou_user', JSON.stringify(state.user));
  } catch (e) {
    if (e.status === 401) logout();
  }
}

// ---------- RENDER ROOT ----------
function render() {
  if (!state.token) {
    APP.innerHTML = renderAuth();
    bindAuthEvents();
    return;
  }

  APP.innerHTML = `
    <div class="topbar">
      <img src="logo.png" alt="Konkou" class="topbar-logo">
      <div class="points-pill">${state.user?.points ?? 0} pts</div>
    </div>
    <div class="view" id="view-content"></div>
    <div class="tabbar">
      ${tabBtn('home', '🏠', 'Accueil')}
      ${tabBtn('leaderboard', '🏆', 'Classement')}
      ${tabBtn('wallet', '💰', 'Portefeuille')}
      ${tabBtn('profile', '👤', 'Profil')}
    </div>
  `;

  document.querySelectorAll('.tabbar button').forEach(btn => {
    btn.addEventListener('click', () => setState({ view: btn.dataset.view, error: '', success: '' }));
  });

  const content = document.getElementById('view-content');
  content.innerHTML = renderView();
  bindViewEvents();
}

function tabBtn(view, icon, label) {
  const active = state.view === view || (view === 'home' && ['stakePrompt', 'trivia', 'puzzle'].includes(state.view));
  return `<button data-view="${view}" class="${active ? 'active' : ''}"><span class="icon">${icon}</span>${label}</button>`;
}

// ---------- AUTH VIEWS ----------
function authShell(inner) {
  return `
    <div class="auth-screen">
      <div class="auth-logo">
        <img src="logo.png" alt="Konkou" class="auth-logo-img">
        <div class="tagline">Jouez à des jeux d'habileté. Gagnez des points. Encaissez en espèces.</div>
      </div>
      ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
      ${state.success ? `<div class="success-banner">${escapeHtml(state.success)}</div>` : ''}
      ${inner}
    </div>
  `;
}

function renderAuth() {
  if (state.authMode === 'awaiting-confirm') return authShell(renderAwaitingConfirm());
  if (state.authMode === 'forgot-request') return authShell(renderForgotRequest());
  return authShell(renderLoginRegister());
}

function renderLoginRegister() {
  const isLogin = state.authMode === 'login';
  return `
    <div class="card">
      <h2>${isLogin ? 'Connexion' : 'Créer un compte'}</h2>
      <form id="auth-form">
        ${!isLogin ? `<input name="name" placeholder="Nom complet" required />` : ''}
        <input name="phone" placeholder="Numéro de téléphone (ex: 50937123456)" required />
        <input name="password" type="password" placeholder="Mot de passe (min. 6 caractères)" required />
        ${!isLogin ? `<input name="referralCode" placeholder="Code de parrainage (optionnel)" />` : ''}
        <button class="primary" type="submit">${isLogin ? 'Se connecter' : "S'inscrire"}</button>
      </form>
      ${isLogin ? `<button class="link-btn" id="forgot-link" style="margin-top:10px;">Mot de passe oublié ?</button>` : ''}
      <button class="link-btn" id="toggle-auth" style="margin-top:14px; display:block;">
        ${isLogin ? "Pas de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
      </button>
    </div>
    <p style="text-align:center; color:var(--muted); font-size:12px;">
      En vous inscrivant vous recevez 100 points de bienvenue. La confirmation se fait par WhatsApp.
    </p>
  `;
}

function renderForgotRequest() {
  return `
    <div class="card">
      <h2>Mot de passe oublié</h2>
      <p>Entrez votre numéro et votre nouveau mot de passe. Vous confirmerez ensuite via WhatsApp pour l'activer.</p>
      <form id="forgot-request-form">
        <input name="phone" placeholder="Numéro de téléphone" required />
        <input name="newPassword" type="password" placeholder="Nouveau mot de passe (min. 6 caractères)" required />
        <button class="primary" type="submit">Continuer</button>
      </form>
      <button class="link-btn" id="back-to-login" style="margin-top:14px;">Retour à la connexion</button>
    </div>
  `;
}

function renderAwaitingConfirm() {
  const a = state.awaiting || {};
  const isReset = a.purpose === 'reset_password';
  const title = isReset ? 'Confirmez la réinitialisation' : 'Confirmez votre inscription';

  if (state.awaitingStatus === 'expired') {
    return `
      <div class="card">
        <h2>${title}</h2>
        <p>Cette demande a expiré avant confirmation.</p>
        <button class="link-btn" id="resend-link">Relancer une demande</button>
        <button class="link-btn" id="back-to-login" style="margin-top:10px; display:block;">Retour à la connexion</button>
      </div>
    `;
  }
  if (state.awaitingStatus === 'invalid') {
    return `
      <div class="card">
        <h2>${title}</h2>
        <p>Cette demande n'est plus valide.</p>
        <button class="link-btn" id="back-to-login">Retour à la connexion</button>
      </div>
    `;
  }

  return `
    <div class="card">
      <h2>${title}</h2>
      <p>Numéro : <strong>${escapeHtml(a.phone || '')}</strong></p>
      ${a.whatsappLink ? `
        <a class="primary" style="display:block; text-align:center; text-decoration:none; background:#25D366; margin-bottom:10px;" href="${a.whatsappLink}" target="_blank" rel="noopener">
          💬 Confirmer via WhatsApp
        </a>
        <p style="font-size:13px;">Un message pré-rempli s'ouvrira dans WhatsApp — envoyez-le tel quel. Votre compte sera activé automatiquement dès qu'un agent l'aura confirmé.</p>
        <p class="center-msg" style="padding:14px 0;">⏳ En attente de confirmation…</p>
      ` : `
        <div class="error-banner">Aucun numéro WhatsApp n'est configuré côté serveur pour le moment — contactez l'administrateur pour activer votre compte manuellement.</div>
      `}
      <button class="link-btn" id="resend-link">Je n'ai pas pu envoyer le message — relancer</button>
      <button class="link-btn" id="back-to-login" style="margin-top:10px; display:block;">Retour à la connexion</button>
    </div>
  `;
}

function bindAuthEvents() {
  if (state.authMode === 'awaiting-confirm') return bindAwaitingConfirmEvents();
  if (state.authMode === 'forgot-request') return bindForgotRequestEvents();

  document.getElementById('toggle-auth').addEventListener('click', () => {
    setState({ authMode: state.authMode === 'login' ? 'register' : 'login', error: '', success: '' });
  });
  const forgotLink = document.getElementById('forgot-link');
  if (forgotLink) {
    forgotLink.addEventListener('click', () => {
      setState({ authMode: 'forgot-request', error: '', success: '' });
    });
  }
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      const path = state.authMode === 'login' ? '/auth/login' : '/auth/register';
      const data = await api(path, { method: 'POST', body: payload });
      if (data.pendingVerification) {
        goAwaitingConfirm(data);
        return;
      }
      persistAuth(data.token, data.user);
      setState({ view: 'home', error: '', success: '' });
    } catch (err) {
      if (err.code === 'PHONE_NOT_VERIFIED') {
        // The user likely doesn't have a fresh confirmation link anymore — request one now.
        resendCode('verify_phone', err.phone);
        return;
      }
      setState({ error: err.message });
    }
  });
}

function goAwaitingConfirm(data) {
  setState({
    authMode: 'awaiting-confirm',
    awaiting: { phone: data.phone, purpose: data.purpose, code: data.code, whatsappLink: data.whatsappLink },
    awaitingStatus: null,
    error: '',
    success: data.message
  });
  startPolling();
}

async function resendCode(purpose, phone) {
  try {
    const data = await api('/auth/resend-otp', { method: 'POST', body: { phone, purpose } });
    goAwaitingConfirm({ phone, purpose, code: data.code, whatsappLink: data.whatsappLink, message: data.message });
  } catch (err) {
    setState({ error: err.message });
  }
}

function bindAwaitingConfirmEvents() {
  document.getElementById('resend-link').addEventListener('click', () => {
    const a = state.awaiting || {};
    resendCode(a.purpose, a.phone);
  });
  document.getElementById('back-to-login').addEventListener('click', () => {
    stopPolling();
    setState({ authMode: 'login', awaiting: null, awaitingStatus: null, error: '', success: '' });
  });
}

function bindForgotRequestEvents() {
  document.getElementById('back-to-login').addEventListener('click', () => {
    setState({ authMode: 'login', error: '', success: '' });
  });
  document.getElementById('forgot-request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const data = await api('/auth/forgot-password', { method: 'POST', body: fd });
      if (data.code) {
        goAwaitingConfirm({ phone: fd.phone, purpose: 'reset_password', code: data.code, whatsappLink: data.whatsappLink, message: data.message });
      } else {
        setState({ authMode: 'login', error: '', success: data.message });
      }
    } catch (err) {
      setState({ error: err.message });
    }
  });
}

// ---------- MAIN VIEWS ----------
function renderView() {
  switch (state.view) {
    case 'home': return renderHome();
    case 'stakePrompt': return renderStakePrompt();
    case 'trivia': return renderGameScreen('trivia');
    case 'puzzle': return renderGameScreen('puzzle');
    case 'leaderboard': return renderLeaderboard();
    case 'wallet': return renderWallet();
    case 'profile': return renderProfile();
    case 'agent': return renderAgent();
    default: return renderHome();
  }
}

function renderHome() {
  const bonusPlays = state.user?.bonusPlays ?? 0;
  return `
    ${state.success ? `<div class="success-banner">${state.success}</div>` : ''}
    ${state.error ? `<div class="error-banner">${state.error}</div>` : ''}
    <div class="card">
      <h2>Bonjour ${escapeHtml(state.user?.name ?? '')} 👋</h2>
      <p>Jouez chaque jour pour gagner des points, grimper au classement et les retirer en espèces chez notre agent.</p>
      ${bonusPlays > 0 ? `<p>🎟️ <strong>${bonusPlays}</strong> partie(s) bonus disponible(s) (au-delà de la limite gratuite du jour).</p>` : ''}
    </div>
    <div class="grid-2">
      <button class="tile" data-start="trivia"><span class="emoji">🧠</span>Quiz culture générale</button>
      <button class="tile" data-start="puzzle"><span class="emoji">🔢</span>Sprint de calcul</button>
    </div>
    <div class="card">
      <h2>Comment ça marche</h2>
      <p>1. Jouez à un jeu d'habileté (30 parties gratuites/jour et par jeu).</p>
      <p>2. Gagnez des points selon vos bonnes réponses.</p>
      <p>3. Cumulez et demandez un retrait en espèces chez notre agent.</p>
      <p>4. Plus de parties gratuites aujourd'hui ? Déposez chez l'agent pour des parties bonus (onglet Portefeuille) — cet argent achète des parties, il n'est pas retirable.</p>
      <p>5. Avant chaque partie, vous pouvez miser entre 100 et 2500 de vos points : bon score, la mise augmente jusqu'à 30% ; mauvais score, elle diminue jusqu'à 30%. Optionnel — vous pouvez toujours jouer sans miser.</p>
    </div>
  `;
}

function bindHomeEvents() {
  document.querySelectorAll('[data-start]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingGameType = btn.dataset.start;
      setState({ view: 'stakePrompt', error: '' });
    });
  });
}

// ---------- MISE (avant de jouer) ----------
const STAKE_MIN = 100;
const STAKE_MAX = 2500;
let pendingGameType = null; // 'trivia' | 'puzzle', en attente de choix de mise

function renderStakePrompt() {
  if (!pendingGameType) return renderHome();
  const label = pendingGameType === 'trivia' ? 'Quiz culture générale' : 'Sprint de calcul';
  const balance = state.user?.points ?? 0;
  const maxStake = Math.min(STAKE_MAX, balance);
  return `
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    <div class="card">
      <h2>${pendingGameType === 'trivia' ? '🧠' : '🔢'} ${label}</h2>
      <p>Vous pouvez miser entre ${STAKE_MIN} et ${STAKE_MAX} points de votre solde (${balance} pts disponibles) avant de jouer. Votre mise varie de ±30% selon votre score : un score parfait la fait gagner 30%, un score nul lui en fait perdre 30%, un score à mi-chemin la laisse inchangée. Les points gagnés normalement par bonne réponse restent les mêmes, avec ou sans mise.</p>
      ${maxStake < STAKE_MIN ? `
        <p class="error-banner">Solde insuffisant (min. ${STAKE_MIN} pts) pour miser — vous pouvez quand même jouer sans mise.</p>
        <button class="primary" id="play-no-stake">Jouer sans mise</button>
      ` : `
        <form id="stake-form">
          <input name="stake" type="number" min="${STAKE_MIN}" max="${maxStake}" placeholder="Mise (optionnel, ${STAKE_MIN}–${maxStake} pts)" />
          <button class="primary" type="submit">Jouer</button>
        </form>
        <button class="secondary" id="play-no-stake" style="margin-top:8px;">Jouer sans mise</button>
      `}
      <button class="link-btn" id="stake-back" style="margin-top:14px; display:block;">← Retour</button>
    </div>
  `;
}

function bindStakePromptEvents() {
  const backBtn = document.getElementById('stake-back');
  if (backBtn) backBtn.addEventListener('click', () => { pendingGameType = null; setState({ view: 'home', error: '' }); });

  const noStakeBtn = document.getElementById('play-no-stake');
  if (noStakeBtn) noStakeBtn.addEventListener('click', () => startGame(pendingGameType));

  const form = document.getElementById('stake-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = new FormData(e.target).get('stake');
      startGame(pendingGameType, raw || undefined);
    });
  }
}

// ---------- GAMES ----------
async function startGame(type, stake) {
  setState({ error: '' });
  try {
    const query = stake ? `?stake=${encodeURIComponent(stake)}` : '';
    const data = type === 'trivia' ? await api(`/games/trivia${query}`) : await api(`/games/puzzle${query}`);
    state.game = {
      type,
      sessionToken: data.sessionToken,
      items: type === 'trivia' ? data.questions : data.problems,
      index: 0,
      answers: [],
      result: null,
      timeLimitSeconds: data.timeLimitSeconds || null,
      usingBonusPlay: !!data.usingBonusPlay,
      stake: data.stake || 0,
      startedAt: Date.now()
    };
    pendingGameType = null;
    setState({ view: type });
  } catch (err) {
    setState({ view: 'stakePrompt', error: err.message });
  }
}

function renderGameScreen(type) {
  const g = state.game;
  if (!g || g.type !== type) {
    return `<div class="center-msg">Chargement du jeu...</div>`;
  }
  if (g.result) {
    const r = g.result;
    const staked = r.stake > 0;
    return `
      <div class="card">
        <h2>${type === 'trivia' ? '🧠 Résultat du quiz' : '🔢 Résultat du sprint'}</h2>
        <p>Bonnes réponses : <strong>${r.correctCount}/${r.total}</strong></p>
        <p>Points gagnés : <strong style="color:var(--green)">+${r.pointsEarned}</strong></p>
        ${staked ? `
          <p>Mise : <strong>${r.stake} pts</strong> → <strong>${r.stakeResult} pts</strong>
            (<strong style="color:${r.stakeDelta >= 0 ? 'var(--green)' : 'var(--red)'}">${r.stakeDelta >= 0 ? '+' : ''}${r.stakeDelta}</strong>)</p>
        ` : ''}
        <p>Nouveau solde : <strong>${r.newBalance} pts</strong></p>
      </div>
      <button class="primary" id="back-home">Retour à l'accueil</button>
    `;
  }

  const idx = g.index;
  const total = g.items.length;
  const dots = Array.from({ length: total }, (_, i) => `<span class="${i < idx ? 'done' : ''}"></span>`).join('');
  const bonusNote = g.usingBonusPlay ? `<p style="text-align:center; font-size:12px; color:var(--muted);">🎟️ Partie bonus</p>` : '';
  const stakeNote = g.stake > 0 ? `<p style="text-align:center; font-size:12px; color:var(--muted);">💰 Mise en cours : ${g.stake} pts</p>` : '';

  if (type === 'trivia') {
    const q = g.items[idx];
    return `
      <div class="progress-dots">${dots}</div>
      ${bonusNote}
      ${stakeNote}
      <div class="card">
        <h2>Question ${idx + 1}/${total}</h2>
        <p style="color:var(--text); font-size:16px; font-weight:600;">${q.question}</p>
      </div>
      <div id="choices">
        ${q.choices.map((c, i) => `<button class="choice-btn" data-choice="${i}">${c}</button>`).join('')}
      </div>
    `;
  }

  // puzzle
  const p = g.items[idx];
  return `
    <div class="progress-dots">${dots}</div>
    ${bonusNote}
    <div class="card">
      <h2>Calcul ${idx + 1}/${total}</h2>
      <p style="font-size:28px; font-weight:800; text-align:center; color:var(--text);">${p.text} = ?</p>
      <form id="puzzle-form">
        <input name="answer" type="number" inputmode="numeric" placeholder="Votre réponse" autofocus required />
        <button class="primary" type="submit">Valider</button>
      </form>
    </div>
  `;
}

function bindGameEvents() {
  const backBtn = document.getElementById('back-home');
  if (backBtn) {
    backBtn.addEventListener('click', async () => {
      state.game = null;
      await refreshProfile();
      setState({ view: 'home' });
    });
    return;
  }

  const choices = document.querySelectorAll('[data-choice]');
  choices.forEach(btn => {
    btn.addEventListener('click', () => {
      answerCurrent(parseInt(btn.dataset.choice, 10));
    });
  });

  const puzzleForm = document.getElementById('puzzle-form');
  if (puzzleForm) {
    puzzleForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = new FormData(e.target).get('answer');
      answerCurrent(Number(val));
    });
  }
}

async function answerCurrent(value) {
  const g = state.game;
  g.answers.push(value);
  if (g.index < g.items.length - 1) {
    g.index++;
    render();
  } else {
    // submit
    try {
      const path = g.type === 'trivia' ? '/games/trivia/submit' : '/games/puzzle/submit';
      const result = await api(path, { method: 'POST', body: { sessionToken: g.sessionToken, answers: g.answers } });
      g.result = result;
      if (state.user) {
        state.user.points = result.newBalance;
        if (typeof result.bonusPlays === 'number') state.user.bonusPlays = result.bonusPlays;
      }
      localStorage.setItem('konkou_user', JSON.stringify(state.user));
      render();
    } catch (err) {
      setState({ view: 'home', error: err.message });
    }
  }
}

// ---------- LEADERBOARD ----------
let leaderboardPeriod = 'today';
async function renderLeaderboardAsync() {
  try {
    const data = await api(`/leaderboard?period=${leaderboardPeriod}`);
    const content = document.getElementById('view-content');
    if (!content) return;
    content.innerHTML = leaderboardHtml(data);
    bindLeaderboardEvents();
  } catch (err) {
    setState({ error: err.message });
  }
}

function renderLeaderboard() {
  setTimeout(renderLeaderboardAsync, 0);
  return `<div class="center-msg">Chargement du classement...</div>`;
}

function leaderboardHtml(data) {
  const periods = [['today', "Aujourd'hui"], ['week', '7 jours'], ['all', 'Tout temps']];
  return `
    <div class="grid-2" style="grid-template-columns: repeat(3, 1fr);">
      ${periods.map(([key, label]) => `<button class="tile" data-period="${key}" style="${leaderboardPeriod === key ? 'outline:2px solid var(--red);' : ''}">${label}</button>`).join('')}
    </div>
    <div class="card">
      <h2>🏆 Classement</h2>
      ${data.leaderboard.length === 0 ? '<p>Aucune partie jouée pour cette période.</p>' : ''}
      ${data.leaderboard.map(r => `
        <div class="leader-row ${r.isMe ? 'me' : ''}">
          <span><span class="rank">#${r.rank}</span>${escapeHtml(r.name)}</span>
          <span>${r.points} pts</span>
        </div>
      `).join('')}
    </div>
  `;
}

function bindLeaderboardEvents() {
  document.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      leaderboardPeriod = btn.dataset.period;
      renderLeaderboardAsync();
    });
  });
}

// ---------- WALLET ----------
async function renderWalletAsync() {
  try {
    const [data, agentsRes] = await Promise.all([api('/wallet'), api('/agents/list')]);
    const content = document.getElementById('view-content');
    if (!content) return;
    content.innerHTML = walletHtml(data, agentsRes.agents);
    bindWalletEvents(data);
  } catch (err) {
    setState({ error: err.message });
  }
}

function renderWallet() {
  setTimeout(renderWalletAsync, 0);
  return `<div class="center-msg">Chargement du portefeuille...</div>`;
}

// Rendered in place of a free-text agent code field, so the player picks from active
// agents instead of having to already know/type a code correctly.
function agentSelectHtml(agents) {
  if (agents.length === 0) {
    return `<p class="error-banner">Aucun agent actif pour le moment — revenez plus tard.</p>`;
  }
  return `
    <select name="agentCode" required>
      <option value="">Choisir un agent</option>
      ${agents.map(a => `<option value="${escapeHtml(a.agentCode)}">${escapeHtml(a.agentCode)} — ${escapeHtml(a.firstName)} ${escapeHtml(a.lastName)} (N°${escapeHtml(a.agentNumber)})</option>`).join('')}
    </select>
  `;
}

function walletHtml(data, agents) {
  const minCashoutPoints = Math.ceil(data.minCashoutHtg / data.rate);
  const noAgents = agents.length === 0;
  return `
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    ${state.lastCashoutCode ? `
      <div class="card" style="border:2px solid var(--red);">
        <h2>✅ Retrait demandé</h2>
        <p>Votre code de retrait :</p>
        <p style="font-size:32px; font-weight:800; letter-spacing:4px; text-align:center; color:var(--text);">${escapeHtml(state.lastCashoutCode)}</p>
        ${state.lastCashoutDetails ? `
          <div class="stat-row"><span>Montant demandé</span><span>${state.lastCashoutDetails.htgAmount} HTG</span></div>
          <div class="stat-row"><span>Frais de service (${state.lastCashoutDetails.feePercent}%)</span><span>-${state.lastCashoutDetails.platformFeeHtg} HTG</span></div>
          <div class="stat-row"><span><strong>À recevoir en espèces</strong></span><span><strong>${state.lastCashoutDetails.netPayoutHtg} HTG</strong></span></div>
        ` : ''}
        <p>${escapeHtml(data.pickupInfo)}</p>
        <button class="secondary" id="dismiss-code">J'ai noté le code</button>
      </div>
    ` : ''}
    ${state.lastDepositCode ? `
      <div class="card" style="border:2px solid var(--green);">
        <h2>✅ Dépôt demandé</h2>
        <p>Votre code de dépôt (à présenter avec le paiement) :</p>
        <p style="font-size:32px; font-weight:800; letter-spacing:4px; text-align:center; color:var(--text);">${escapeHtml(state.lastDepositCode)}</p>
        <p>${escapeHtml(data.depositInfo)}</p>
        <button class="secondary" id="dismiss-deposit-code">J'ai noté le code</button>
      </div>
    ` : ''}
    <div class="card">
      <h2>💰 Solde</h2>
      <p style="font-size:26px; font-weight:800; color:var(--text);">${data.points} pts</p>
      <p>≈ ${data.htgValue} HTG (taux indicatif : 1 pt = ${data.rate} HTG)</p>
      <p style="font-size:12px;">Retrait minimum : ${data.minCashoutHtg} HTG (${minCashoutPoints} pts) · Limite quotidienne : ${data.maxDailyCashoutHtg} HTG (il vous reste ${data.dailyCashoutRemainingHtg} HTG aujourd'hui)</p>
      ${data.bonusPlays > 0 ? `<p>🎟️ ${data.bonusPlays} partie(s) bonus disponible(s)</p>` : ''}
    </div>
    <div class="card">
      <h2>Demander un retrait en espèces</h2>
      <p style="font-size:13px;">${escapeHtml(data.pickupInfo)}</p>
      <p style="font-size:12px;">Frais de service : ${(data.cashoutFeeTiers || []).map((t, i, arr) => {
        const min = i === 0 ? data.minCashoutHtg : arr[i - 1].maxHtg + 1;
        return `${t.percent}% (${min}${t.maxHtg ? `–${t.maxHtg}` : '+'} HTG)`;
      }).join(' · ')}</p>
      <form id="cashout-form">
        <input name="points" type="number" placeholder="Points à retirer" min="${minCashoutPoints}" required />
        ${agentSelectHtml(agents)}
        <button class="primary" type="submit" ${noAgents ? 'disabled' : ''}>Générer mon code de retrait</button>
      </form>
    </div>
    <div class="card">
      <h2>🎟️ Déposer chez un agent pour des parties bonus</h2>
      <p style="font-size:13px;">Achetez des parties bonus (au-delà de vos 30 parties gratuites/jour) — cet argent n'est pas retirable, il sert uniquement à jouer. ${data.htgPerBonusPlay} HTG = 1 partie bonus.</p>
      <p style="font-size:13px;">${escapeHtml(data.depositInfo)}</p>
      <form id="deposit-form">
        <input name="htgAmount" type="number" placeholder="Montant en HTG (${data.minDepositHtg}–${data.maxDepositHtg})" min="${data.minDepositHtg}" max="${data.maxDepositHtg}" required />
        ${agentSelectHtml(agents)}
        <button class="primary" type="submit" ${noAgents ? 'disabled' : ''}>Générer mon code de dépôt</button>
      </form>
    </div>
    <div class="card">
      <h2>Historique des retraits</h2>
      ${data.cashouts.length === 0 ? '<p>Aucune demande.</p>' : data.cashouts.map(c => `
        <div class="tx-row">
          <span>${c.points} pts → ${c.htg_amount} HTG (frais ${c.platform_fee_htg} HTG, net ${c.net_payout_htg} HTG) (code ${escapeHtml(c.payout_info)})</span>
          <span>${statusLabel(c.status)}</span>
        </div>
      `).join('')}
    </div>
    <div class="card">
      <h2>Historique des dépôts</h2>
      ${data.deposits.length === 0 ? '<p>Aucune demande.</p>' : data.deposits.map(d => `
        <div class="tx-row">
          <span>${d.htg_amount} HTG → ${d.plays_granted} partie(s) bonus (code ${escapeHtml(d.code)})</span>
          <span>${depositStatusLabel(d.status)}</span>
        </div>
      `).join('')}
    </div>
    <div class="card">
      <h2>Transactions récentes</h2>
      ${data.transactions.map(t => `
        <div class="tx-row">
          <span>${escapeHtml(t.note || t.type)}</span>
          <span class="tx-amount ${t.amount >= 0 ? 'pos' : 'neg'}">${t.amount >= 0 ? '+' : ''}${t.amount}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function statusLabel(status) {
  const map = { pending: '⏳ En attente', paid: '💸 Payé', rejected: '❌ Rejeté' };
  return map[status] || status;
}

function depositStatusLabel(status) {
  const map = { pending: '⏳ En attente', confirmed: '✅ Confirmé', rejected: '❌ Rejeté' };
  return map[status] || status;
}

function bindWalletEvents() {
  const dismissBtn = document.getElementById('dismiss-code');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => setState({ lastCashoutCode: null, lastCashoutDetails: null }));
  }
  const dismissDepositBtn = document.getElementById('dismiss-deposit-code');
  if (dismissDepositBtn) {
    dismissDepositBtn.addEventListener('click', () => setState({ lastDepositCode: null }));
  }
  const form = document.getElementById('cashout-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      try {
        const res = await api('/wallet/cashout', { method: 'POST', body: fd });
        await refreshProfile();
        setState({
          lastCashoutCode: res.code,
          lastCashoutDetails: {
            htgAmount: res.htgAmount,
            feePercent: res.feePercent,
            platformFeeHtg: res.platformFeeHtg,
            netPayoutHtg: res.netPayoutHtg
          },
          error: ''
        });
      } catch (err) {
        setState({ error: err.message, lastCashoutCode: null, lastCashoutDetails: null });
      }
    });
  }
  const depositForm = document.getElementById('deposit-form');
  if (depositForm) {
    depositForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      try {
        const res = await api('/deposits', { method: 'POST', body: fd });
        setState({ lastDepositCode: res.code, error: '' });
      } catch (err) {
        setState({ error: err.message, lastDepositCode: null });
      }
    });
  }
}

// ---------- PROFILE ----------
async function renderProfileAsync() {
  try {
    const data = await api('/profile');
    const content = document.getElementById('view-content');
    if (!content) return;
    content.innerHTML = profileHtml(data);
    bindProfileEvents();
  } catch (err) {
    setState({ error: err.message });
  }
}

function renderProfile() {
  setTimeout(renderProfileAsync, 0);
  return `<div class="center-msg">Chargement du profil...</div>`;
}

function profileHtml(data) {
  return `
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    <div class="card">
      <h2>👤 ${escapeHtml(data.name)}</h2>
      <div class="stat-row"><span>Téléphone</span><span>${escapeHtml(data.phone)}</span></div>
      <div class="stat-row"><span>Points</span><span>${data.points}</span></div>
      <div class="stat-row"><span>Parties bonus</span><span>${data.bonusPlays}</span></div>
      <div class="stat-row"><span>Parties jouées</span><span>${data.gamesPlayed}</span></div>
      <div class="stat-row"><span>Filleuls</span><span>${data.referralsCount}</span></div>
      <div class="stat-row"><span>Membre depuis</span><span>${formatDate(data.memberSince)}</span></div>
    </div>
    <div class="card">
      <h2>🎁 Parrainage</h2>
      <p>Partagez votre code pour gagner 50 pts par ami inscrit :</p>
      <p style="font-size:22px; font-weight:800; letter-spacing:2px; text-align:center;">${data.referralCode}</p>
    </div>
    <button class="secondary" id="agent-space-btn">🧑‍💼 Espace Agent</button>
    <button class="secondary" id="logout-btn">Se déconnecter</button>
    ${confirmingDeleteAccount ? `
      <div class="card" style="border:2px solid var(--red); margin-top:14px;">
        <h2>⚠️ Supprimer mon compte</h2>
        <p style="font-size:13px;">Action définitive et irréversible. Impossible si vous avez un solde de points, un retrait ou dépôt en attente, ou un rôle agent actif — réglez ces éléments d'abord.</p>
        <form id="delete-account-form">
          <input name="password" type="password" placeholder="Confirmez votre mot de passe" required />
          <button class="primary" type="submit" style="background:var(--red);">Supprimer définitivement mon compte</button>
        </form>
        <button class="link-btn" id="cancel-delete-account" style="margin-top:10px;">Annuler</button>
      </div>
    ` : `
      <button class="link-btn" id="show-delete-account" style="margin-top:20px; color:var(--red);">🗑️ Supprimer mon compte</button>
    `}
  `;
}

let confirmingDeleteAccount = false;

function bindProfileEvents() {
  const agentBtn = document.getElementById('agent-space-btn');
  if (agentBtn) agentBtn.addEventListener('click', () => setState({ view: 'agent', error: '', success: '' }));
  const btn = document.getElementById('logout-btn');
  if (btn) btn.addEventListener('click', logout);

  const showBtn = document.getElementById('show-delete-account');
  if (showBtn) showBtn.addEventListener('click', () => { confirmingDeleteAccount = true; setState({ error: '' }); });

  const cancelBtn = document.getElementById('cancel-delete-account');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { confirmingDeleteAccount = false; setState({ error: '' }); });

  const deleteForm = document.getElementById('delete-account-form');
  if (deleteForm) {
    deleteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = new FormData(e.target).get('password');
      try {
        await api('/account/delete', { method: 'POST', body: { password } });
        confirmingDeleteAccount = false;
        logout();
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
}

// ---------- ESPACE AGENT ----------
let agentForceForm = false; // true after "Soumettre une nouvelle candidature" on a rejected application

async function renderAgentAsync() {
  try {
    const me = await api('/agents/me');
    let html;
    if (!me.agent || agentForceForm) {
      html = agentApplyFormHtml();
    } else if (me.agent.status === 'pending') {
      html = agentPendingHtml(me.agent);
    } else if (me.agent.status === 'rejected') {
      html = agentRejectedHtml(me.agent);
    } else {
      const dash = await api('/agents/dashboard');
      html = agentDashboardHtml(dash);
    }
    const content = document.getElementById('view-content');
    if (!content) return;
    content.innerHTML = html;
    bindAgentEvents();
  } catch (err) {
    setState({ error: err.message });
  }
}

function renderAgent() {
  setTimeout(renderAgentAsync, 0);
  return `<div class="center-msg">Chargement...</div>`;
}

function agentBackLink() {
  return `<button class="link-btn" id="agent-back" style="margin-bottom:12px;">← Retour au profil</button>`;
}

function agentApplyFormHtml() {
  return `
    ${agentBackLink()}
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    ${state.success ? `<div class="success-banner">${escapeHtml(state.success)}</div>` : ''}
    <div class="card">
      <h2>🧑‍💼 Devenir agent</h2>
      <p>Un agent revend des parties bonus aux joueurs et leur paie leurs retraits en espèces, en échange d'une commission. Conditions :</p>
      <p>1. Avoir 18 ans ou plus.</p>
      <p>2. Fournir une pièce d'identité (CIN, passeport ou permis de conduire).</p>
      <p>3. Déposer 7 500 HTG de capital à notre bureau — 10% est gardé par Konkou, le reste (6 750 HTG) devient votre crédit à revendre aux joueurs.</p>
      <p>4. Vous gagnez 10% de commission sur chaque retrait que vous payez à un joueur.</p>
    </div>
    <div class="card">
      <form id="agent-apply-form">
        <input name="lastName" placeholder="Nom" required />
        <input name="firstName" placeholder="Prénom" required />
        <input name="birthDate" type="date" required />
        <select name="idType" required>
          <option value="">Type de pièce d'identité</option>
          <option value="cin">Carte d'Identification Nationale</option>
          <option value="passeport">Passeport</option>
          <option value="permis">Permis de conduire</option>
        </select>
        <input name="idNumber" placeholder="Numéro de la pièce" required />
        <button class="primary" type="submit">Envoyer ma candidature</button>
      </form>
    </div>
  `;
}

function agentPendingHtml(agent) {
  return `
    ${agentBackLink()}
    ${state.success ? `<div class="success-banner">${escapeHtml(state.success)}</div>` : ''}
    <div class="card">
      <h2>⏳ Candidature en attente</h2>
      <p>Agent N° <strong>${escapeHtml(agent.agentNumber)}</strong> — code :</p>
      <p style="font-size:28px; font-weight:800; letter-spacing:3px; text-align:center;">${escapeHtml(agent.agentCode)}</p>
      <p>Déposez <strong>${agent.capitalHtg} HTG</strong> à notre bureau pour activer votre compte agent.</p>
      <p style="font-size:13px;">Nous vérifions votre pièce d'identité et confirmons la réception du dépôt avant l'activation.</p>
    </div>
  `;
}

function agentRejectedHtml(agent) {
  return `
    ${agentBackLink()}
    <div class="card">
      <h2>❌ Candidature rejetée</h2>
      <p>Votre candidature agent (code ${escapeHtml(agent.agentCode)}) a été rejetée.</p>
      <button class="secondary" id="agent-reapply">Soumettre une nouvelle candidature</button>
    </div>
  `;
}

function agentDashboardHtml(dash) {
  return `
    ${agentBackLink()}
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    ${state.success ? `<div class="success-banner">${escapeHtml(state.success)}</div>` : ''}
    <div class="card">
      <h2>🧑‍💼 Espace Agent — ${escapeHtml(dash.agentCode)}</h2>
      <p>Agent N° <strong>${escapeHtml(dash.agentNumber)}</strong></p>
      <p>Crédit disponible à revendre : <strong>${dash.creditBalance} HTG</strong></p>
      <p>Commissions gagnées sur les retraits payés : <strong>${dash.commissionEarned} HTG</strong> (${dash.commissionPercent}% par retrait, réglé hors app)</p>
    </div>
    <div class="card">
      <h2>Dépôts à confirmer</h2>
      ${dash.pendingDeposits.length === 0 ? '<p>Aucun dépôt en attente.</p>' : dash.pendingDeposits.map(d => `
        <div class="tx-row" style="flex-direction:column; align-items:stretch; gap:6px; padding:12px 0;">
          <span>${escapeHtml(d.user_name)} (${escapeHtml(d.user_phone)}) — ${d.htg_amount} HTG → ${d.plays_granted} partie(s) bonus</span>
          <span style="font-weight:800; letter-spacing:2px;">${escapeHtml(d.code)}</span>
          <div class="grid-2">
            <button class="tile" data-agent-deposit-confirm="${d.id}" style="background:rgba(34,197,94,0.2); font-size:13px;">✅ Confirmer</button>
            <button class="tile" data-agent-deposit-reject="${d.id}" style="background:rgba(210,16,52,0.2); font-size:13px;">❌ Rejeter</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="card">
      <h2>Retraits à payer</h2>
      ${dash.pendingCashouts.length === 0 ? '<p>Aucun retrait en attente.</p>' : dash.pendingCashouts.map(c => `
        <div class="tx-row" style="flex-direction:column; align-items:stretch; gap:6px; padding:12px 0;">
          <span>${escapeHtml(c.user_name)} (${escapeHtml(c.user_phone)}) — ${c.points} pts → ${c.htg_amount} HTG (à remettre : ${c.net_payout_htg} HTG net après frais)</span>
          <span style="font-weight:800; letter-spacing:2px;">${escapeHtml(c.payout_info)}</span>
          <div class="grid-2">
            <button class="tile" data-agent-cashout-pay="${c.id}" style="background:rgba(34,197,94,0.2); font-size:13px;">✅ Payer</button>
            <button class="tile" data-agent-cashout-reject="${c.id}" style="background:rgba(210,16,52,0.2); font-size:13px;">❌ Rejeter</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="card">
      <h2>💳 Renflouement de capital</h2>
      <p style="font-size:13px;">Augmentez votre crédit à revendre : chaque renflouement peut aller jusqu'au plafond indiqué ci-dessous, avec ${dash.refillFeePercent}% de frais prélevés par Konkou sur le montant déposé.</p>
      <p>Dernier dépôt : <strong>${dash.lastCapitalDepositHtg} HTG</strong> · Plafond du prochain renflouement : <strong>${dash.nextRefillCeilingHtg} HTG</strong></p>
      ${dash.refills.some(r => r.status === 'pending') ? `
        <p class="error-banner">Vous avez déjà une demande de renflouement en attente.</p>
      ` : `
        <form id="agent-refill-form">
          <input name="amount" type="number" min="${dash.refillMinHtg}" max="${dash.nextRefillCeilingHtg}" placeholder="Montant à déposer (max ${dash.nextRefillCeilingHtg} HTG)" required />
          <button class="primary" type="submit">Demander un renflouement</button>
        </form>
      `}
      ${dash.refills.length > 0 ? `
        <h3 style="margin-top:16px; font-size:15px;">Historique</h3>
        ${dash.refills.map(r => `
          <div class="tx-row">
            <span>${r.amount_htg} HTG (frais ${r.fee_percent}%, crédité ${r.credited_htg} HTG)</span>
            <span>${refillStatusLabel(r.status)}</span>
          </div>
        `).join('')}
      ` : ''}
    </div>
  `;
}

function refillStatusLabel(status) {
  const map = { pending: '⏳ En attente', confirmed: '✅ Confirmé', rejected: '❌ Rejeté' };
  return map[status] || status;
}

function bindAgentEvents() {
  const backBtn = document.getElementById('agent-back');
  if (backBtn) backBtn.addEventListener('click', () => setState({ view: 'profile', error: '', success: '' }));

  const form = document.getElementById('agent-apply-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      try {
        const res = await api('/agents/apply', { method: 'POST', body: fd });
        agentForceForm = false;
        setState({ success: res.message, error: '' });
      } catch (err) {
        setState({ error: err.message, success: '' });
      }
    });
  }

  const reapplyBtn = document.getElementById('agent-reapply');
  if (reapplyBtn) {
    reapplyBtn.addEventListener('click', () => {
      agentForceForm = true;
      setState({ error: '', success: '' });
    });
  }

  document.querySelectorAll('[data-agent-deposit-confirm]').forEach(btn => {
    btn.addEventListener('click', () => agentAction('/agents/deposits/confirm', btn.dataset.agentDepositConfirm));
  });
  document.querySelectorAll('[data-agent-deposit-reject]').forEach(btn => {
    btn.addEventListener('click', () => agentAction('/agents/deposits/reject', btn.dataset.agentDepositReject));
  });
  document.querySelectorAll('[data-agent-cashout-pay]').forEach(btn => {
    btn.addEventListener('click', () => agentAction('/agents/cashouts/pay', btn.dataset.agentCashoutPay));
  });
  document.querySelectorAll('[data-agent-cashout-reject]').forEach(btn => {
    btn.addEventListener('click', () => agentAction('/agents/cashouts/reject', btn.dataset.agentCashoutReject));
  });

  const refillForm = document.getElementById('agent-refill-form');
  if (refillForm) {
    refillForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      try {
        const res = await api('/agents/refill', { method: 'POST', body: fd });
        setState({ success: res.message, error: '' });
      } catch (err) {
        setState({ error: err.message, success: '' });
      }
    });
  }
}

async function agentAction(path, id) {
  try {
    const res = await api(path, { method: 'POST', body: { id: Number(id) } });
    setState({ success: res.message, error: '' });
  } catch (err) {
    setState({ error: err.message, success: '' });
  }
}

// ---------- BIND ALL VIEW EVENTS ----------
function bindViewEvents() {
  if (state.view === 'home') bindHomeEvents();
  if (state.view === 'stakePrompt') bindStakePromptEvents();
  if (state.view === 'trivia' || state.view === 'puzzle') bindGameEvents();
  // leaderboard / wallet / profile bind themselves after async load
}

// ---------- INIT ----------
(async function init() {
  if (state.token && !state.user) {
    try {
      const p = await api('/profile');
      state.user = p;
    } catch {
      state.token = null;
    }
  }
  render();
  if (state.token) refreshProfile();
})();
