// Konkou - application front-end (vanilla JS, aucune dépendance / aucun build requis)

import { startGameMusic, stopGameMusic, toggleMusic, isMusicEnabled } from './music.js';
import { isPushSubscribed, notificationsToggleHtml, bindNotificationsToggleEvents, subscribeToPush } from './push-client.js';

const APP = document.getElementById('app');

// Champ mot de passe avec un bouton "œil" pour basculer masqué/affiché. Un seul listener
// délégué (voir plus bas) suffit pour tous les champs générés par cette fonction, peu
// importe combien de fois la vue est re-rendue.
function pwdField(name, placeholder) {
  return `
    <div class="pwd-wrap">
      <input name="${name}" type="password" placeholder="${escapeHtml(placeholder)}" required />
      <button type="button" class="pwd-toggle" aria-label="Afficher le mot de passe">👁</button>
    </div>
  `;
}

// Champ téléphone avec préfixe "+509" fixe (non éditable) — le joueur ne tape que les 8
// chiffres locaux, qui servent de numéro d'identifiant (voir routes/auth.js, register :
// c'est ce numéro, une fois combiné au "509" fixe, qui sert de clé unique de compte et
// qui est comparé à deleted_phones pour le bonus de bienvenue). Utilisé sur les écrans
// d'INSCRIPTION (joueur et agent) ET de CONNEXION — tous les numéros stockés en base
// sont déjà au format "509" + 8 chiffres (c'était déjà le format canonique avant même ce
// préfixe visuel), donc un compte existant se connecte normalement en ne tapant que ses
// 8 chiffres ici aussi. Le formulaire appelant doit combiner "509" + la valeur soumise
// avant d'envoyer à l'API (voir bindAuthEvents et bindAgentRegisterEvents plus bas) : le
// "+509" affiché n'est qu'un préfixe visuel, pas une partie de la valeur du <input>.
function phoneField(name) {
  return `
    <div class="phone-wrap">
      <span class="phone-prefix" aria-hidden="true">+509</span>
      <input name="${name}" type="tel" inputmode="numeric" pattern="[0-9]{8}" maxlength="8"
        placeholder="37123456" title="8 chiffres, sans le +509" required />
    </div>
  `;
}

// Bouton "🔔 Activer les notifications" / "🔕 Désactiver les notifications" (juillet 2026,
// voir push-client.js pour la logique partagée avec admin.js) — même bloc réutilisé dans
// Profil (joueur) et les 3 écrans Espace Agent (en attente/rejeté/tableau de bord, voir
// agentDeleteAccountBlock()). Ces deux wrappers ne font qu'adapter le module partagé au
// state/setState propres à app.js — voir push-client.js pour le détail de la logique
// d'abonnement elle-même.
function appNotificationsToggleHtml() {
  return notificationsToggleHtml(state.pushSubscribed, "Soyez prévenu·e directement sur cet appareil dès qu'une action de votre part est possible (ex : réinitialisation de mot de passe autorisée) — même l'app fermée.");
}

// Partagé par bindProfileEvents() et bindAgentEvents() — l'élément #notifications-toggle-btn
// n'existe que sur un seul écran à la fois donc pas de risque de double-binding.
function bindAppNotificationsToggleEvents() {
  bindNotificationsToggleEvents(api, state.pushSubscribed, (result) => {
    if (result.status === 'subscribed') { setState({ pushSubscribed: true, error: '', success: 'Notifications activées sur cet appareil.' }); return; }
    if (result.status === 'unsubscribed') { setState({ pushSubscribed: false, error: '', success: 'Notifications désactivées sur cet appareil.' }); return; }
    if (result.status === 'unsupported') { setState({ error: "Ce navigateur/appareil ne prend pas en charge les notifications (sur iPhone, l'app doit d'abord être ajoutée à l'écran d'accueil)." }); return; }
    if (result.status === 'denied') { setState({ error: "Permission refusée — activez les notifications pour ce site dans les réglages de votre navigateur, puis réessayez." }); return; }
    if (result.status === 'dismissed') { return; } // fenêtre système fermée sans choix — pas d'erreur à afficher
    setState({ error: result.error || 'Erreur inconnue lors de l\'activation des notifications.' });
  });
}

// Bannière de rappel discret et répété (juillet 2026) — demandée en remplacement d'une
// activation forcée des notifications (techniquement impossible, voir discussion avec
// l'opérateur : Notification.requestPermission() est entièrement contrôlée par le
// navigateur). Affichée en haut de l'écran d'accueil joueur (renderHome) et du tableau de
// bord agent (agentDashboardHtml) tant que CET appareil n'est pas abonné — jamais sur
// Profil/Espace Agent puisque le vrai bouton complet (appNotificationsToggleHtml) y est déjà
// présent, ni côté admin (qui a son propre toggle explicite dans Réglages, hors périmètre de
// cette demande qui portait sur "coté utilisateur/Agent"). Contrairement à ce bouton complet,
// celle-ci n'offre qu'un aller simple vers l'abonnement (jamais de désactivation) plus un
// bouton "Plus tard" qui la masque pour le reste de la visite (state.pushReminderDismissed) —
// elle réapparaît naturellement à la prochaine visite tant que l'abonnement n'est pas fait,
// puisque cet état repart à false à chaque rechargement complet de la page.
function pushReminderBannerHtml() {
  if (state.pushSubscribed || state.pushReminderDismissed) return '';
  return `
    <div class="card" id="push-reminder-banner" style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; padding:12px 14px;">
      <p style="margin:0; font-size:13px; flex:1; min-width:180px;">🔔 Activez les notifications pour être prévenu·e dès qu'une action importante vous concerne (retrait, dépôt, mot de passe...).</p>
      <div style="display:flex; gap:8px; flex-shrink:0;">
        <button type="button" id="push-reminder-activate-btn" class="tile" style="font-size:12px; padding:8px 10px; background:rgba(34,197,94,0.2);">Activer</button>
        <button type="button" id="push-reminder-dismiss-btn" class="tile" style="font-size:12px; padding:8px 10px;">Plus tard</button>
      </div>
    </div>
  `;
}

// Utilise directement subscribeToPush() de push-client.js (plutôt que
// bindAppNotificationsToggleEvents ci-dessus, qui gère aussi le chemin "désabonnement" —
// jamais pertinent ici puisque la bannière n'apparaît que si non abonné) pour éviter tout
// conflit d'id avec un éventuel bouton #notifications-toggle-btn présent ailleurs sur le
// même écran (aucun cas actuel, mais les deux composants restent indépendants par prudence).
function bindPushReminderBannerEvents() {
  const activateBtn = document.getElementById('push-reminder-activate-btn');
  if (activateBtn) {
    activateBtn.addEventListener('click', async () => {
      activateBtn.disabled = true;
      const result = await subscribeToPush(api);
      activateBtn.disabled = false;
      if (result.status === 'subscribed') { setState({ pushSubscribed: true, error: '', success: 'Notifications activées sur cet appareil.' }); return; }
      if (result.status === 'unsupported') { setState({ error: "Ce navigateur/appareil ne prend pas en charge les notifications (sur iPhone, l'app doit d'abord être ajoutée à l'écran d'accueil)." }); return; }
      if (result.status === 'denied') { setState({ error: "Permission refusée — activez les notifications pour ce site dans les réglages de votre navigateur, puis réessayez." }); return; }
      if (result.status === 'dismissed') return; // fenêtre système fermée sans choix — pas d'erreur à afficher
      setState({ error: result.error || "Erreur inconnue lors de l'activation des notifications." });
    });
  }
  const dismissBtn = document.getElementById('push-reminder-dismiss-btn');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => setState({ pushReminderDismissed: true }));
  }
}

// Champs NatCash/MonCash + plan de remboursement (juillet 2026) — communs aux deux
// parcours de création d'un compte agent (inscription autonome "Devenir Agent" et
// candidature in-app depuis le Profil), factorisés ici pour ne jamais les faire diverger.
// Les numéros réutilisent phoneField() (même préfixe +509 visuel que le téléphone
// principal) — voir bindAgentRegisterEvents/bindAgentEvents plus bas pour le préfixage
// "509" avant envoi, identique à celui déjà fait sur le champ "phone". Les noms sont
// optionnels : laissés vides, le serveur utilise le nom complet de l'agent par défaut
// (voir validateAgentReimbursementFields dans routes/agents.js).
function agentReimbursementFieldsHtml() {
  return `
    <p style="font-size:12px; color:var(--muted); margin:10px 0 -4px;">Numéros NatCash et MonCash pour le suivi de vos remboursements de commission (à votre nom, ou à un nom que vous précisez) :</p>
    <label style="display:block; font-size:12px; color:var(--muted); margin:6px 0 -6px;">Numéro NatCash</label>
    ${phoneField('natcashNumber')}
    <input name="natcashName" placeholder="Nom sur le compte NatCash (optionnel — vous par défaut)" />
    <label style="display:block; font-size:12px; color:var(--muted); margin:6px 0 -6px;">Numéro MonCash</label>
    ${phoneField('moncashNumber')}
    <input name="moncashName" placeholder="Nom sur le compte MonCash (optionnel — vous par défaut)" />
    <label style="display:block; font-size:12px; color:var(--muted); margin:6px 0 -6px;">Plan de remboursement de vos commissions</label>
    <select name="reimbursementPeriodDays" required>
      <option value="">Choisir un plan</option>
      <option value="8">Tous les 8 jours</option>
      <option value="15">Tous les 15 jours</option>
      <option value="22">Tous les 22 jours</option>
    </select>
  `;
}

// Délégué sur #app (persiste à travers tous les re-rendus, contrairement aux listeners
// posés dans les fonctions bindXEvents qui sont perdus à chaque innerHTML).
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

// ---------- THÈME SAISONNIER (choisi par l'admin, voir /admin.html → Réglages) ----------
// Chaque thème ne fait que recolorer des variables CSS déjà utilisées partout dans
// styles.css (--blue/--blue-2 = dégradé de la barre du haut, --red = couleur d'accent
// des boutons/éléments actifs, --bg/--card/--card-2 = fonds) + une particule qui dérive
// en fond d'écran (voir #theme-particles dans styles.css). --green (succès) et --text/
// --muted (lisibilité) restent volontairement identiques dans tous les thèmes.
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
  // Fèt Gede : célébration haïtienne (1er-2 novembre) en hommage aux ancêtres, dans la
  // tradition vodou — violet, noir et blanc sont ses couleurs traditionnelles. Thème
  // pensé comme un hommage festif/culturel, pas une représentation religieuse littérale.
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

// Assombrit une couleur hex ("#rrggbb") d'un facteur (0–1) — utilisé pour dériver
// --blue-2 (bas du dégradé de la barre du haut) à partir de la seule couleur --blue que
// l'admin choisit (voir applyThemeVars ci-dessous), plutôt que de lui demander deux
// couleurs à assortir lui-même.
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
  // Réinitialise d'abord aux valeurs par défaut (celles de :root dans styles.css) avant
  // d'appliquer les surcharges du thème choisi, sinon revenir à "default" après avoir
  // essayé un autre thème ne restaurerait rien (les propriétés inline resteraient figées).
  ['--blue', '--blue-2', '--red', '--bg', '--card', '--card-2'].forEach(v => root.removeProperty(v));
  Object.entries(theme.vars).forEach(([k, v]) => root.setProperty(k, v));
  // Couleur de fond personnalisée (indépendante du thème, réglée par l'admin) — surcharge
  // le --bg du thème s'il y en a une, laisse le fond du thème sinon.
  if (bgColor) root.setProperty('--bg', bgColor);
  // Couleur bleu foncé personnalisée (admin, indépendante du thème actif) — surcharge
  // --blue ; --blue-2 (bas du dégradé de la barre du haut, voir .topbar dans styles.css)
  // est dérivée automatiquement en assombrissant la même couleur, pour ne demander qu'UNE
  // seule couleur à l'admin tout en gardant un dégradé à deux tons cohérent.
  if (blueColor) {
    root.setProperty('--blue', blueColor);
    root.setProperty('--blue-2', darkenHex(blueColor, 0.55));
  }
  // Couleur des cartes personnalisée (admin, indépendante du thème actif) — surcharge
  // --card (fond des .card/.tabbar/.ad-panel) ; --card-2 (fond des .tile/.choice-btn, et
  // 2e ton du dégradé des .game-panel) est dérivée en assombrissant légèrement la même
  // couleur (facteur doux, contrairement à --blue-2, pour rester subtil même si la
  // couleur choisie est déjà pâle). Le texte affiché sur ce fond (--card-text/
  // --card-muted, voir updateCardContrastColor ci-dessous) est recalculé juste après.
  if (cardColor) {
    root.setProperty('--card', cardColor);
    root.setProperty('--card-2', darkenHex(cardColor, 0.9));
  }
  updateGameContrastColor();
  updateCardContrastColor();
}

// Convertit une couleur CSS ("#rgb", "#rrggbb", "rgb(r, g, b)" — ce que renvoie
// getComputedStyle même quand la valeur d'origine était un hex) en triplet [r, g, b], ou
// null si le format n'est pas reconnu.
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

// Luminance relative standard (WCAG) — sert uniquement à décider si le fond actuel est
// "pâle" ou "foncé", pas à un calcul de contraste réglementaire précis.
function relativeLuminance([r, g, b]) {
  const srgb = [r, g, b].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

// Chronomètre de partie + compteurs "Parties restantes/bonus" (voir renderGameScreen,
// renderHome, walletHtml plus bas) : leur couleur s'adapte au fond actuel plutôt que
// d'être fixe, pour rester lisible quel que soit le thème/couleur de fond choisi par
// l'admin — rouge sur fond pâle, blanc sur fond foncé, comme demandé. Recalculé à chaque
// application de thème (voir applyThemeVars) puisque --bg peut changer (thème saisonnier
// ou couleur de fond personnalisée).
function updateGameContrastColor() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg');
  const rgb = parseColorToRgb(raw);
  const isLight = rgb ? relativeLuminance(rgb) > 0.5 : false;
  document.documentElement.style.setProperty('--game-contrast', isLight ? '#d21034' : '#ffffff');
}
updateGameContrastColor(); // valeur initiale avant même la réponse de /api/theme

// Convertit une couleur hex ("#rrggbb") en chaîne "rgba(r, g, b, alpha)" — utilisé pour
// une version adoucie (texte secondaire) de la couleur de texte adaptative des cartes,
// sans avoir à maintenir une deuxième couleur hex à part.
function hexToRgbaString(hex, alpha) {
  const rgb = parseColorToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

// Texte des cartes (--card-text/--card-muted, voir .card/.tile/.game-panel/.choice-btn/
// .tabbar dans styles.css) : s'adapte à la couleur de fond des cartes actuellement
// appliquée (--card — thème saisonnier ou couleur personnalisée par l'admin), comme
// demandé — blanc si le fond est foncé. Si le fond est pâle, rouge ou bleu (les deux
// couleurs de marque) : lequel des deux est choisi, PAS via le ratio de contraste WCAG
// (celui-ci ne dépend que de la luminosité, pas de la teinte — --blue étant nettement plus
// sombre que --red, il "gagnerait" quasiment à chaque fois sur un fond pâle, rendant le
// choix rouge/bleu sans intérêt). On compare plutôt la teinte du fond lui-même : un fond
// pâle à dominante rouge/chaude (canal rouge ≥ canal bleu) prend un texte bleu, un fond
// pâle à dominante bleue/froide prend un texte rouge — pour que le texte se détache
// visuellement du fond plutôt que de s'y fondre en dégradé de la même couleur, même si les
// deux restent techniquement lisibles au sens du contraste de luminosité seul.
function updateCardContrastColor() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--card');
  const rgb = parseColorToRgb(raw);
  const root = document.documentElement.style;
  if (!rgb) { root.removeProperty('--card-text'); root.removeProperty('--card-muted'); return; }
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
    // Inséré avant #app dans <body> — peint en dessous, jamais par-dessus le contenu
    // (voir le commentaire sur #theme-particles dans styles.css).
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

// Logo affiché dans la barre du haut et l'écran de connexion — 'logo.png' par défaut
// (fichier livré avec l'app), remplacé par l'upload de l'admin si défini (voir
// /admin.html → Réglages). Contrairement aux couleurs/décor de thème (appliqués en
// inline style hors du DOM re-rendu), les balises <img> sont À L'INTÉRIEUR de #app et
// sont donc recréées à chaque render() — d'où cette variable au niveau du module,
// référencée dans les templates (${logoUrl}) plutôt qu'une valeur codée en dur, pour que
// chaque futur rendu utilise automatiquement la bonne valeur.
let logoUrl = 'logo.png';

// Patch direct des <img> déjà affichées (pas de re-render complet, pour ne pas perdre la
// saisie en cours d'un formulaire) — les prochains rendus utiliseront de toute façon la
// variable logoUrl mise à jour ci-dessus.
function applyLogo(url) {
  logoUrl = url || 'logo.png';
  document.querySelectorAll('.topbar-logo, .auth-logo-img').forEach(img => { img.src = logoUrl; });
}

// Photo de fond personnalisée (voir /admin.html → Réglages) — indépendante du thème et
// de la couleur de fond, posée en inline style sur <body> (priorité automatique sur la
// règle CSS body{background-image:url('logo-watermark.png')...}). Vide/absente : on
// retire les surcharges et le filigrane par défaut de styles.css reprend la main.
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

// Photo de fond DÉDIÉE à la barre du haut (voir --topbar-bg-image/--topbar-overlay dans
// styles.css) — indépendante du logo et de la photo de fond de toute l'app (applyBgImage
// ci-dessus) : posée sur :root comme les couleurs de thème (applyThemeVars), donc valable
// pour n'importe quel élément .topbar, y compris ceux recréés lors d'un futur render().
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

// Le thème saisonnier actif n'est volontairement PAS mis en avant côté joueur (retiré en
// juillet 2026 après un premier essai en bannière sur l'accueil) — seul l'admin voit/
// choisit le thème actif, depuis /admin.html → Réglages (les couleurs/décor du thème
// s'appliquent quand même normalement pour tout le monde, seule la bannière annonçant
// "Thème X actif" a été retirée du joueur).
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

// Vérifié une fois au chargement, en tâche de fond — pas d'attente ni d'écran de chargement
// pour ça, puisque ça ne fait que corriger le libellé initial du bouton "🔔 Activer les
// notifications" (voir notificationsToggleHtml() plus bas) le temps que ça arrive ; jusque-là,
// il affiche par défaut "🔔 Activer" (state.pushSubscribed commence à false), ce qui est sans
// conséquence puisque personne n'atteint l'écran Profil/Espace Agent avant que ceci ait eu le
// temps de se résoudre dans la quasi-totalité des cas réels.
async function refreshPushSubscribedState() {
  const subscribed = await isPushSubscribed();
  if (subscribed !== state.pushSubscribed) state.pushSubscribed = subscribed; // pas de render() ici, voir commentaire ci-dessus
}
refreshPushSubscribedState();

// Panneau publicitaire (juillet 2026, voir /admin.html → Réglages) — image au format
// portrait affichée une fois par session (joueur ET agent), fermable via un bouton (x).
// "Une fois par session" est interprété ici comme "une fois par chargement de page" :
// adShown repasse à false à chaque rechargement/nouvelle connexion, mais ne redéclenche
// jamais l'affichage tant que la page reste ouverte (changer d'onglet dans l'app,
// terminer une partie, etc. ne le fait pas réapparaître).
let adImageUrl = '';
let adShown = false;

async function applyAdFromServer() {
  try {
    const res = await fetch('/api/ad');
    const data = await res.json();
    adImageUrl = data.adImage || '';
  } catch {
    // Hors ligne ou erreur réseau : pas de panneau ce coup-ci, rien de grave.
  }
}
applyAdFromServer();

// Insère le panneau publicitaire dans #app si une image est configurée et qu'il n'a pas
// déjà été montré cette session — appelée à la fin de render() (joueur ET agent, voir
// plus bas), jamais depuis applyAdFromServer() directement pour éviter d'agir avant que
// #app ait un premier contenu.
function renderAdOverlayIfNeeded() {
  if (!adImageUrl || adShown) return;
  adShown = true;
  APP.insertAdjacentHTML('beforeend', `
    <div class="ad-overlay" id="ad-overlay">
      <div class="ad-panel">
        <button type="button" class="ad-close" id="ad-close-btn" aria-label="Fermer la publicité">✕</button>
        <img src="${adImageUrl}" alt="Publicité" class="ad-image">
      </div>
    </div>
  `);
  const overlay = document.getElementById('ad-overlay');
  const closeBtn = document.getElementById('ad-close-btn');
  if (closeBtn && overlay) {
    closeBtn.addEventListener('click', () => overlay.remove());
  }
}

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
  authMode: 'login', // login | register | awaiting-confirm | forgot-request | reset-new-password
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
  game: null, // { type, sessionToken, questions/problems, index, answers, result }
  // Un numéro enregistré comme agent (voir /api/agents/register) n'a plus aucun usage
  // joueur — isAgent bascule le rendu vers un shell entièrement séparé (voir render()
  // et renderAgentShell()), sans tabbar ni accès jeux/portefeuille/classement/profil.
  isAgent: false,
  agentScreen: 'main', // 'main' | 'contact' — uniquement pertinent quand isAgent est vrai
  // Vrai si CET appareil a déjà un abonnement aux notifications push actif (voir
  // push-client.js) — rafraîchi une fois au chargement (refreshPushSubscribedState() plus
  // bas) puis après chaque activation/désactivation manuelle. Uniquement utilisé pour
  // choisir le libellé du bouton "🔔 Activer"/"🔕 Désactiver" dans Profil/Espace Agent ; ne
  // reflète jamais un état "par compte" (le serveur ne sait que quels endpoints précis sont
  // enregistrés, jamais si CET appareil-ci en fait partie avant qu'on ne le lui demande).
  pushSubscribed: false,
  // Rappel discret répété (juillet 2026, voir pushReminderBannerHtml()) — masque la bannière
  // de rappel pour le reste de la visite en cours quand on clique "Plus tard". Remis à false
  // à chaque rechargement complet de la page (valeur initiale de state, jamais persistée en
  // storage) — c'est ce qui fait que le rappel est "répété" d'une visite à l'autre tant que
  // l'abonnement n'est pas fait, sans jamais être insistant au sein d'une même visite.
  pushReminderDismissed: false,
  // Tchat "Nous contacter" (juillet 2026, voir routes/chat.js) — null tant qu'aucune
  // conversation anonyme n'a encore été démarrée (avant connexion). { phone, secret,
  // messages } une fois le premier message envoyé. Sans objet pour un utilisateur déjà
  // connecté (state.token) : dans ce cas /api/chat/... identifie la conversation via le
  // jeton de session, pas via ce state — voir renderContactForm()/contactChatMessages().
  contactChat: null,
  // Numéro affiché en complément du tchat sur l'écran "Nous contacter" (voir
  // contactRoutes.getPublicContactNumber) — "garder un numéro de contact sur le site" même
  // si les conversations elles-mêmes passent désormais par le tchat. null tant que non
  // chargé ou non configuré par l'admin.
  contactPhoneNumber: null
};

function setState(patch) {
  // Coupe la musique de partie si on quitte l'écran de jeu par un autre moyen que la
  // fin normale de la partie (ex: onglet "Accueil" cliqué en pleine partie) — la fin
  // normale/temps écoulé est déjà gérée dans submitGame() (voir music.js).
  const leavingGame = ('view' in patch) && (state.view === 'trivia' || state.view === 'puzzle') && patch.view !== state.view;
  Object.assign(state, patch);
  if (leavingGame) stopGameMusic();
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
        stopChatPolling();
        if (purpose === 'reset_password') {
          // Pas de token à ce stade — un admin vient seulement d'AUTORISER la demande
          // (voir confirmPasswordReset dans routes/admin.js), le mot de passe n'a pas
          // encore été choisi. On bascule vers le formulaire dédié plutôt que de se
          // connecter directement ; state.awaiting (phone/code) reste intact puisqu'on
          // ne passe pas par completeLogin() ici (voir renderSetNewPassword ci-dessus).
          setState({ authMode: 'reset-new-password', error: '', success: '' });
        } else {
          await completeLogin(data.token, data.user);
        }
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

// ---------- TCHAT INTERNE (juillet 2026, voir routes/chat.js) ----------
// Remplace la confirmation par WhatsApp (écran "Confirmez votre inscription/la
// réinitialisation") après le blocage du numéro opérateur — voir renderAwaitingConfirm()
// plus bas. Sondage séparé du pollTimer ci-dessus (qui, lui, ne fait que détecter
// 'confirmed'/'expired'/'invalid' pour changer d'écran) : celui-ci récupère les NOUVEAUX
// messages et les ajoute directement au DOM sans passer par setState()/render(), pour ne
// jamais effacer un brouillon en cours de frappe dans le champ de message (même principe
// déjà appliqué au commentaire "pending -> keep waiting" juste au-dessus).
let chatPollTimer = null;
let chatLastMessageId = 0;
let chatTick = null;

function stopChatPolling() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  chatTick = null;
}

// `fetchMessages` est une fonction async ré-appelée à CHAQUE tick (jamais figée une seule
// fois à l'appel) — elle doit renvoyer soit un tableau de messages, soit `null` pour
// signaler que l'écran concerné n'est plus affiché (ce qui arrête proprement le sondage).
// Généralisé (juillet 2026) pour servir aussi bien la conversation anonyme de confirmation
// (voir awaitingChatMessages() ci-dessous) que celle de "Nous contacter" (anonyme OU
// authentifiée selon state.token, voir contactChatMessages()/startContactChatPolling()) —
// un seul mécanisme de sondage/anti-doublon (chatLastMessageId) partagé, puisqu'un seul de
// ces écrans peut être affiché à la fois.
function startChatPolling(fetchMessages) {
  stopChatPolling();
  chatLastMessageId = 0;
  chatTick = async () => {
    try {
      const messages = await fetchMessages();
      if (messages === null) return stopChatPolling();
      appendNewChatMessages(messages);
    } catch {
      // network hiccup — on retentera au prochain tick
    }
  };
  chatTick();
  chatPollTimer = setInterval(chatTick, 3000);
}

// Source de messages pour la conversation anonyme de confirmation (inscription/
// réinitialisation) — voir goAwaitingConfirm() plus bas. Revient à `null` dès que l'écran
// n'est plus le bon, ou que la demande a expiré/n'est plus valide (state.awaitingStatus).
async function awaitingChatMessages() {
  if (state.authMode !== 'awaiting-confirm' || !state.awaiting) return null;
  if (state.awaitingStatus === 'expired' || state.awaitingStatus === 'invalid') return null;
  const { phone, purpose, code } = state.awaiting;
  const q = new URLSearchParams({ phone, purpose, secret: code || '' });
  const res = await fetch(`/api/chat/anonymous/messages?${q}`);
  const data = await res.json().catch(() => ({}));
  return res.ok ? (data.messages || []) : [];
}

// Ajoute directement les nouveaux messages (ceux dont l'id dépasse le dernier connu) au
// conteneur #chat-thread affiché à l'écran, sans jamais passer par render() — voir la note
// sur chatPollTimer ci-dessus.
function appendNewChatMessages(messages) {
  const container = document.getElementById('chat-thread');
  if (!container) return;
  const fresh = messages.filter(m => m.id > chatLastMessageId);
  if (fresh.length === 0) return;
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();
  fresh.forEach(m => {
    chatLastMessageId = Math.max(chatLastMessageId, m.id);
    container.insertAdjacentHTML('beforeend', chatBubbleHtml(m));
  });
  container.scrollTop = container.scrollHeight;
}

function chatBubbleHtml(m) {
  const isAdmin = m.sender === 'admin';
  return `<div class="chat-msg ${isAdmin ? 'chat-msg-admin' : 'chat-msg-user'}">
    <span class="chat-msg-author">${isAdmin ? 'Konkou' : 'Vous'}</span>
    <p>${escapeHtml(m.body)}</p>
  </div>`;
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
  state.isAgent = false;
  state.agentScreen = 'main';
  confirmingDeleteAccount = false; // partagé entre profil joueur et espace agent — repartir propre
  agentCommissionDate = ''; // repartir sur "tout l'historique" à la prochaine connexion
  localStorage.removeItem('konkou_token');
  localStorage.removeItem('konkou_user');
  setState({ view: 'home', authMode: 'login', error: '', success: '' });
}

// Un numéro agent (voir /api/agents/register) n'est jamais un joueur — on le détecte via
// /agents/me (et non /profile, qui est désormais refusé côté serveur à ces comptes).
async function checkAgentStatus() {
  try {
    const data = await api('/agents/me');
    state.isAgent = !!data.agent;
  } catch {
    state.isAgent = false;
  }
}

// Point d'entrée unique après une connexion réussie (login direct ou confirmation
// WhatsApp) — détermine si ce numéro est un compte agent avant de choisir vers quel
// écran basculer, pour ne jamais montrer même brièvement le shell joueur à un agent.
async function completeLogin(token, user) {
  persistAuth(token, user);
  await checkAgentStatus();
  setState({
    view: 'home',
    agentScreen: 'main',
    authMode: 'login',
    awaiting: null,
    awaitingStatus: null,
    error: '',
    success: ''
  });
  // Le login (/auth/login) et la confirmation WhatsApp (/auth/verify-status) ne renvoient
  // qu'un user "minimal" (sans dailyChallenge, voir publicUser() dans routes/auth.js) —
  // sans cet appel, la carte "Défi du jour" de l'accueil resterait bloquée sur son état de
  // chargement (voir renderHome) jusqu'à une action qui rafraîchit le profil par ailleurs
  // (ex: un retrait). On la complète ici tout de suite après la connexion, sans bloquer le
  // premier rendu (déjà fait par setState ci-dessus) : refreshProfile fait son propre render().
  if (!state.isAgent) refreshProfile();
}

async function refreshProfile() {
  try {
    const p = await api('/profile');
    state.user = { ...state.user, ...p, referralCode: p.referralCode };
    localStorage.setItem('konkou_user', JSON.stringify(state.user));
    // Sans ce render(), la carte "Défi du jour" de l'accueil (voir renderHome) resterait
    // sur les données de connexion (qui n'incluent pas dailyChallenge) jusqu'au prochain
    // changement d'état déclenché ailleurs — ici on la met à jour dès que la réponse
    // arrive, sans attendre une navigation.
    render();
  } catch (e) {
    if (e.status === 401) logout();
  }
}

// ---------- RENDER ROOT ----------
function render() {
  // Le timer de partie (voir "GAMES" plus bas) est relancé à chaque rendu à partir de
  // state.game.deadlineAt (fixé une fois au début de la partie) plutôt que jamais réinitialisé
  // à chaque question — ça évite d'empiler plusieurs setInterval au fil des re-rendus
  // (un par réponse donnée) tout en gardant un compte à rebours exact.
  clearGameTimer();

  if (!state.token) {
    APP.innerHTML = renderAuth();
    bindAuthEvents();
    return;
  }

  if (state.isAgent) {
    APP.innerHTML = renderAgentShell();
    bindAgentShellEvents();
    renderAdOverlayIfNeeded();
    return;
  }

  APP.innerHTML = `
    <div class="topbar">
      <img src="${logoUrl}" alt="Konkou" class="topbar-logo">
      <button type="button" id="music-toggle-btn" aria-label="${isMusicEnabled() ? 'Couper la musique' : 'Activer la musique'}" style="background:none; border:none; font-size:20px; cursor:pointer; line-height:1; padding:4px;">${isMusicEnabled() ? '🔊' : '🔇'}</button>
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

  // Icône 🔊/🔇 dans la barre du haut — visible sur tous les écrans (pas seulement en
  // partie) puisqu'elle mémorise aussi la préférence pour la prochaine partie, même si
  // le son ne joue concrètement que pendant les questions (voir startGameMusic/
  // stopGameMusic dans music.js).
  const musicToggleBtn = document.getElementById('music-toggle-btn');
  if (musicToggleBtn) {
    musicToggleBtn.addEventListener('click', () => {
      const enabled = toggleMusic();
      musicToggleBtn.textContent = enabled ? '🔊' : '🔇';
      musicToggleBtn.setAttribute('aria-label', enabled ? 'Couper la musique' : 'Activer la musique');
    });
  }

  const content = document.getElementById('view-content');
  content.innerHTML = renderView();
  bindViewEvents();

  if ((state.view === 'trivia' || state.view === 'puzzle') && state.game && !state.game.result && state.game.deadlineAt) {
    startGameTimerTick();
  }

  renderAdOverlayIfNeeded();
}

function tabBtn(view, icon, label) {
  const active = state.view === view || (view === 'home' && ['stakePrompt', 'trivia', 'puzzle', 'dailyChallenge'].includes(state.view));
  return `<button data-view="${view}" class="${active ? 'active' : ''}"><span class="icon">${icon}</span>${label}</button>`;
}

// ---------- AUTH VIEWS ----------
function authShell(inner) {
  return `
    <div class="auth-screen">
      <div class="auth-logo">
        <img src="${logoUrl}" alt="Konkou" class="auth-logo-img">
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
  if (state.authMode === 'reset-new-password') return authShell(renderSetNewPassword());
  if (state.authMode === 'contact') return authShell(renderContactForm());
  if (state.authMode === 'agent-register') return authShell(renderAgentRegisterForm());
  return authShell(renderLoginRegister());
}

function renderLoginRegister() {
  const isLogin = state.authMode === 'login';
  return `
    <div class="card">
      <h2>${isLogin ? 'Connexion' : 'Créer un compte'}</h2>
      <form id="auth-form">
        ${!isLogin ? `<input name="name" placeholder="Nom complet" required />` : ''}
        ${phoneField('phone')}
        ${pwdField('password', 'Mot de passe (min. 8 car., 1 majuscule, 1 chiffre)')}
        ${!isLogin ? `
          <label style="display:block; font-size:12px; color:var(--muted); margin:6px 0 -6px;">Date de naissance (18 ans ou plus requis)</label>
          <input name="birthDate" type="date" required />
        ` : ''}
        ${!isLogin ? `<input name="referralCode" placeholder="Code de parrainage (optionnel)" />` : ''}
        <button class="primary" type="submit">${isLogin ? 'Se connecter' : "S'inscrire"}</button>
      </form>
      ${isLogin ? `<button class="link-btn" id="forgot-link" style="margin-top:10px;">Mot de passe oublié ?</button>` : ''}
      <button class="link-btn" id="toggle-auth" style="margin-top:14px; display:block;">
        ${isLogin ? "Pas de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
      </button>
    </div>
    <div class="card">
      <button class="secondary" id="agent-register-link" style="width:100%;">🧑‍💼 Devenir Agent</button>
      <p style="font-size:12px; color:var(--muted); margin:8px 0 0;">Vous voulez revendre des parties bonus et payer les retraits des joueurs en échange d'une commission ? Inscrivez-vous comme agent — un compte totalement séparé d'un compte joueur.</p>
    </div>
    <p style="text-align:center; color:var(--muted); font-size:12px;">
      En vous inscrivant vous recevez 100 points de bienvenue. La confirmation se fait via une conversation intégrée à l'application.
    </p>
    <button class="link-btn" id="contact-link" style="display:block; margin:6px auto 0; text-align:center;">📞 Nous contacter</button>
  `;
}

// Inscription agent : un compte totalement séparé de l'inscription joueur ci-dessus —
// un numéro enregistré ici n'aura jamais accès aux jeux/portefeuille/classement (voir
// server.js, blockIfAgent). Fusionne en un seul formulaire ce qui était avant réparti
// entre l'inscription joueur et la candidature agent depuis le Profil.
function renderAgentRegisterForm() {
  return `
    <div class="card">
      <h2>🧑‍💼 Devenir agent</h2>
      <p style="font-size:13px;">Un agent revend des parties bonus aux joueurs et leur paie leurs retraits en espèces, en échange d'une commission. Ce numéro sera réservé aux opérations agent — il ne pourra pas jouer.</p>
      <p style="font-size:13px;">Conditions : avoir 18 ans ou plus, fournir une pièce d'identité, déposer 7 500 HTG de capital à notre bureau (10% gardé par Konkou, le reste devient votre crédit à revendre).</p>
      <form id="agent-register-form">
        ${phoneField('phone')}
        ${pwdField('password', 'Mot de passe (min. 8 car., 1 majuscule, 1 chiffre)')}
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
        <input name="city" placeholder="Ville" required />
        <input name="address" placeholder="Adresse (où les joueurs viendront faire leurs transactions)" required />
        ${agentReimbursementFieldsHtml()}
        <button class="primary" type="submit">Envoyer ma candidature</button>
      </form>
      <button class="link-btn" id="agent-register-back" style="margin-top:14px;">Retour à la connexion</button>
    </div>
  `;
}

// Formulaire "Nous contacter" — accessible avant connexion (partenaires, prospects sans
// compte) et depuis le Profil/Espace Agent une fois connecté (voir bindProfileEvents et
// bindAgentShellEvents). Depuis juillet 2026 (blocage du numéro WhatsApp opérateur), ceci
// utilise le tchat interne (voir routes/chat.js) plutôt qu'un lien wa.me automatique : la
// conversation reste consultable ici même, avec un vrai aller-retour avec un admin. Un
// numéro reste néanmoins affiché en complément (state.contactPhoneNumber, voir
// loadContactNumber()) pour qui préfère écrire directement — "garder un numéro de contact
// sur le site" sans dépendre de ce canal pour la conversation elle-même.
function renderContactForm() {
  const isAuthed = !!state.token;
  const chat = state.contactChat;
  const started = isAuthed || !!chat;
  return `
    <div class="card">
      <h2>📞 Nous contacter</h2>
      ${!started ? `
        <p>Question, partenariat, problème avec l'app ? Écrivez-nous ci-dessous — un administrateur vous répond ici même.</p>
        <form id="contact-start-form">
          <input name="fullName" placeholder="Nom et prénom" required />
          <input name="whatsapp" placeholder="Votre numéro (ex: 50937123456)" required />
          <textarea name="message" placeholder="Votre message (500 caractères max)" maxlength="500" rows="4" required></textarea>
          <button class="primary" type="submit">Envoyer</button>
        </form>
      ` : `
        <p style="font-size:13px;">Un administrateur vous répond ici même.</p>
        <div id="chat-thread" class="chat-thread">
          ${(chat?.messages || []).length === 0 ? `<p class="chat-empty">Aucun message pour l'instant.</p>` : (chat.messages || []).map(chatBubbleHtml).join('')}
        </div>
        <p style="font-size:12px; color:var(--muted); margin:0 0 4px;">✍️ Écrire un message :</p>
        <form id="chat-send-form" class="chat-send-form">
          <textarea name="body" placeholder="Votre message..." maxlength="1000" rows="2" required></textarea>
          <button class="primary" type="submit">Envoyer</button>
        </form>
      `}
      ${state.contactPhoneNumber ? `<p style="font-size:12px; color:var(--muted); margin-top:14px;">Vous pouvez aussi nous joindre directement au <strong>+${escapeHtml(state.contactPhoneNumber)}</strong>.</p>` : ''}
      <button class="link-btn" id="contact-back" style="margin-top:14px;">Retour</button>
    </div>
  `;
}

async function loadContactNumber() {
  try {
    const res = await fetch('/api/contact/number');
    const data = await res.json();
    if (data.whatsappNumber) setState({ contactPhoneNumber: data.whatsappNumber });
  } catch {
    // pas grave — le numéro est un complément, pas requis pour utiliser le tchat
  }
}

// Vrai tant que l'écran "Nous contacter" est effectivement affiché, quel que soit le
// contexte (avant connexion, Profil joueur, Espace Agent — voir renderContactForm()) —
// relu à chaque tick de sondage (voir contactChatMessages() ci-dessous) pour arrêter
// proprement le sondage dès qu'on quitte cet écran, y compris par la barre d'onglets
// plutôt que par le bouton "Retour" (voir bindContactEvents()).
function isOnContactScreen() {
  if (state.isAgent) return state.agentScreen === 'contact';
  if (state.token) return state.view === 'contact';
  return state.authMode === 'contact';
}

// Source de messages pour startChatPolling() côté "Nous contacter" (juillet 2026,
// remplace le bouton "🔄 Actualiser" manuel par un sondage automatique, comme l'écran de
// confirmation) — authentifiée (jeton de session, voir /api/chat/messages) ou anonyme
// (phone+secret conservés dans state.contactChat, voir /api/chat/anonymous/messages).
async function contactChatMessages() {
  if (!isOnContactScreen()) return null;
  if (state.token) {
    const data = await api('/chat/messages');
    return data.messages || [];
  }
  if (!state.contactChat) return null;
  const q = new URLSearchParams({ phone: state.contactChat.phone, purpose: 'support', secret: state.contactChat.secret });
  const res = await fetch(`/api/chat/anonymous/messages?${q}`);
  const data = await res.json().catch(() => ({}));
  return res.ok ? (data.messages || []) : [];
}

function startContactChatPolling() {
  startChatPolling(contactChatMessages);
}

function bindContactEvents(onBack) {
  document.getElementById('contact-back').addEventListener('click', () => {
    stopChatPolling();
    onBack();
  });

  if (!state.contactPhoneNumber) loadContactNumber();

  const startForm = document.getElementById('contact-start-form');
  if (startForm) {
    startForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      try {
        const res = await fetch('/api/chat/anonymous/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: fd.whatsapp, purpose: 'support', body: fd.message, displayName: fd.fullName })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
        // messages: [] plutôt qu'un affichage optimiste du message qu'on vient d'envoyer —
        // startContactChatPolling() ci-dessous va aussitôt le récupérer avec son vrai id
        // depuis le serveur, un affichage optimiste créerait un doublon (même principe que
        // renderAwaitingConfirm(), qui ne fait jamais d'affichage optimiste non plus).
        setState({ contactChat: { phone: fd.whatsapp, secret: data.secret, messages: [] }, error: '', success: '' });
        startContactChatPolling();
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }

  const sendForm = document.getElementById('chat-send-form');
  if (sendForm) {
    sendForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = new FormData(e.target).get('body');
      try {
        if (state.token) {
          await api('/chat/send', { method: 'POST', body: { body: text } });
        } else {
          const res = await fetch('/api/chat/anonymous/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: state.contactChat.phone, purpose: 'support', secret: state.contactChat.secret, body: text })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
        }
        e.target.reset();
        // Redéclenche immédiatement un sondage plutôt que d'attendre le prochain tick —
        // même principe que bindAwaitingConfirmEvents(), sans risque de doublon puisque
        // appendNewChatMessages() ignore tout message déjà connu.
        if (chatTick) chatTick();
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
}

// Depuis la refonte de juillet 2026, cette demande ne contient plus de nouveau mot de
// passe (voir forgotPassword() dans routes/auth.js) — même principe que l'inscription :
// on demande d'abord, un admin autorise ensuite dans "Vérifications", et c'est SEULEMENT
// après cette autorisation que le joueur/agent choisit son nouveau mot de passe (voir
// renderSetNewPassword() plus bas). L'ancien champ "nouveau mot de passe" ici — saisi
// avant toute vérification d'identité — a été retiré pour cette raison.
//
// Correctif (juillet 2026) : ce champ utilise désormais phoneField() (préfixe "+509"
// automatique, comme la connexion/l'inscription/l'inscription agent) au lieu d'un simple
// <input> texte. Avant ce correctif, l'utilisateur devait taper lui-même "509" en tête de
// son numéro — un réflexe qu'il n'a nulle part ailleurs dans l'app — et un numéro entré
// sans ce préfixe ne correspondait à aucun compte en base (les numéros y sont stockés au
// format complet "509XXXXXXXX"), déclenchant silencieusement la réponse volontairement
// neutre "Si ce numéro est enregistré..." (anti-énumération, voir forgotPassword() dans
// routes/auth.js) sans qu'aucune vraie demande ne soit créée — un bug signalé en
// production qui donnait l'impression que la fonctionnalité entière ne faisait rien.
function renderForgotRequest() {
  return `
    <div class="card">
      <h2>Mot de passe oublié</h2>
      <p>Entrez votre numéro. Un administrateur autorisera votre demande via une conversation intégrée à l'application, puis vous pourrez choisir votre nouveau mot de passe directement ici.</p>
      <form id="forgot-request-form">
        ${phoneField('phone')}
        <button class="primary" type="submit">Continuer</button>
      </form>
      <button class="link-btn" id="back-to-login" style="margin-top:14px;">Retour à la connexion</button>
    </div>
  `;
}

// Étape finale de la réinitialisation, affichée seulement après qu'un admin a autorisé la
// demande (voir startPolling(), qui bascule authMode ici dès que /auth/verify-status
// renvoie 'confirmed' pour purpose === 'reset_password'). state.awaiting.phone/code sont
// ceux reçus à la demande initiale (voir bindForgotRequestEvents) — c'est ce même
// triplet (phone, purpose, code) qui prouve l'autorisation côté serveur (voir
// consumeConfirmedOtp dans otp.js), sans qu'il soit nécessaire d'être déjà connecté.
function renderSetNewPassword() {
  const a = state.awaiting || {};
  return `
    <div class="card">
      <h2>Choisissez votre nouveau mot de passe</h2>
      <p>Votre demande de réinitialisation pour <strong>${escapeHtml(a.phone || '')}</strong> a été autorisée. Entrez votre nouveau mot de passe pour terminer.</p>
      <form id="set-new-password-form">
        ${pwdField('newPassword', 'Nouveau mot de passe (min. 8 car., 1 majuscule, 1 chiffre)')}
        <button class="primary" type="submit">Valider</button>
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
      <p style="font-size:13px;">Votre code de confirmation :</p>
      <p style="font-size:28px; font-weight:800; letter-spacing:4px; text-align:center;">${escapeHtml(a.code || '')}</p>
      <p style="font-size:13px;">Indiquez ce code à l'administrateur dans le champ de message tout en bas de cette carte pour confirmer votre identité — ${isReset
        ? "vous pourrez ensuite choisir votre nouveau mot de passe directement dans l'application."
        : 'votre compte sera activé automatiquement dès la confirmation.'}</p>
      <div id="chat-thread" class="chat-thread"><p class="chat-empty">Aucun message pour l'instant.</p></div>
      <p style="font-size:12px; color:var(--muted); margin:0 0 4px;">✍️ Écrire un message :</p>
      <form id="chat-send-form" class="chat-send-form">
        <textarea name="body" placeholder="Ex : Bonjour, mon code est ${escapeHtml(a.code || '123456')}" maxlength="1000" rows="2" autofocus required></textarea>
        <button class="primary" type="submit">Envoyer</button>
      </form>
      <p class="center-msg" style="padding:14px 0;">⏳ En attente de confirmation…</p>
      <button class="link-btn" id="resend-link">Je n'ai pas reçu de réponse — relancer une demande</button>
      <button class="link-btn" id="back-to-login" style="margin-top:10px; display:block;">Retour à la connexion</button>
    </div>
  `;
}

function bindAuthEvents() {
  if (state.authMode === 'awaiting-confirm') return bindAwaitingConfirmEvents();
  if (state.authMode === 'forgot-request') return bindForgotRequestEvents();
  if (state.authMode === 'reset-new-password') return bindSetNewPasswordEvents();
  if (state.authMode === 'contact') {
    return bindContactEvents(() => setState({ authMode: 'login', error: '', success: '' }));
  }
  if (state.authMode === 'agent-register') return bindAgentRegisterEvents();

  document.getElementById('toggle-auth').addEventListener('click', () => {
    setState({ authMode: state.authMode === 'login' ? 'register' : 'login', error: '', success: '' });
  });
  const forgotLink = document.getElementById('forgot-link');
  if (forgotLink) {
    forgotLink.addEventListener('click', () => {
      setState({ authMode: 'forgot-request', error: '', success: '' });
    });
  }
  document.getElementById('contact-link').addEventListener('click', () => {
    setState({ authMode: 'contact', error: '', success: '' });
    // Reprend une conversation déjà démarrée plus tôt dans cette même visite (voir
    // state.contactChat) — sans effet si aucune conversation n'a encore été ouverte, le
    // formulaire de démarrage s'affiche alors normalement (voir renderContactForm()).
    if (state.contactChat) startContactChatPolling();
  });
  document.getElementById('agent-register-link').addEventListener('click', () => {
    setState({ authMode: 'agent-register', error: '', success: '' });
  });
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    // Le champ phone (voir phoneField()) ne contient que les 8 chiffres locaux, à la
    // connexion comme à l'inscription — le "+509" affiché n'est qu'un préfixe visuel, on
    // le rajoute ici avant l'envoi pour reconstituer le format stocké en base.
    payload.phone = `509${payload.phone}`;
    try {
      const path = state.authMode === 'login' ? '/auth/login' : '/auth/register';
      const data = await api(path, { method: 'POST', body: payload });
      if (data.pendingVerification) {
        goAwaitingConfirm(data);
        return;
      }
      await completeLogin(data.token, data.user);
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
    success: ''
  });
  startPolling();
  // Le code (state.awaiting.code) sert AUSSI de secret pour le tchat — voir
  // checkAnonymousAccess() dans routes/chat.js : même triplet (phone, purpose, code) déjà
  // utilisé par /auth/verify-status, aucun secret séparé à transporter.
  startChatPolling(awaitingChatMessages);
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
    stopChatPolling();
    setState({ authMode: 'login', awaiting: null, awaitingStatus: null, error: '', success: '' });
  });

  const sendForm = document.getElementById('chat-send-form');
  if (sendForm) {
    sendForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = new FormData(e.target).get('body');
      const a = state.awaiting || {};
      try {
        const res = await fetch('/api/chat/anonymous/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: a.phone, purpose: a.purpose, secret: a.code, body: text })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
        e.target.reset();
        // Redéclenche immédiatement un sondage plutôt que d'afficher le message envoyé de
        // façon optimiste (avec un id inventé) — évite tout risque de doublon quand le
        // vrai message arrive au tick suivant (voir appendNewChatMessages()), pour un coût
        // quasi nul puisque le serveur a déjà bien enregistré le message au moment où
        // cette réponse revient.
        if (chatTick) chatTick();
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
}

function bindForgotRequestEvents() {
  document.getElementById('back-to-login').addEventListener('click', () => {
    setState({ authMode: 'login', error: '', success: '' });
  });
  document.getElementById('forgot-request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    // Voir la note sur phoneField() ci-dessus (renderForgotRequest) : le champ ne contient
    // que les 8 chiffres locaux, on reconstitue ici le format complet stocké en base, comme
    // le fait déjà bindAuthEvents() pour la connexion/l'inscription.
    fd.phone = `509${fd.phone}`;
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

// Dernière étape : envoie le nouveau mot de passe choisi, accompagné du triplet
// (phone, purpose, code) conservé dans state.awaiting depuis la demande initiale — c'est
// ce triplet qui prouve côté serveur qu'un admin a bien autorisé CETTE demande précise
// (voir completePasswordReset dans routes/auth.js). En cas de succès, l'utilisateur est
// connecté directement (comme pour une inscription confirmée), sans repasser par l'écran
// de connexion.
function bindSetNewPasswordEvents() {
  document.getElementById('back-to-login').addEventListener('click', () => {
    setState({ authMode: 'login', awaiting: null, awaitingStatus: null, error: '', success: '' });
  });
  document.getElementById('set-new-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const a = state.awaiting || {};
    try {
      const data = await api('/auth/reset-password/complete', {
        method: 'POST',
        body: { phone: a.phone, code: a.code, newPassword: fd.newPassword }
      });
      await completeLogin(data.token, data.user);
    } catch (err) {
      setState({ error: err.message });
    }
  });
}

function bindAgentRegisterEvents() {
  document.getElementById('agent-register-back').addEventListener('click', () => {
    setState({ authMode: 'login', error: '', success: '' });
  });
  document.getElementById('agent-register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.phone = `509${fd.phone}`; // voir la note équivalente sur le formulaire joueur ci-dessus
    // Même préfixage "509" que le téléphone principal pour les numéros NatCash/MonCash
    // (voir agentReimbursementFieldsHtml, qui réutilise phoneField pour ces deux champs).
    fd.natcashNumber = `509${fd.natcashNumber}`;
    fd.moncashNumber = `509${fd.moncashNumber}`;
    try {
      const data = await api('/agents/register', { method: 'POST', body: fd });
      if (data.pendingVerification) {
        goAwaitingConfirm(data);
        return;
      }
      setState({ authMode: 'login', error: '', success: data.message });
    } catch (err) {
      setState({ error: err.message });
    }
  });
}

// ---------- MAIN VIEWS ----------
function renderView() {
  switch (state.view) {
    case 'home': return renderHome();
    case 'dailyChallenge': return renderDailyChallengeChoice();
    case 'stakePrompt': return renderStakePrompt();
    case 'trivia': return renderGameScreen('trivia');
    case 'puzzle': return renderGameScreen('puzzle');
    case 'leaderboard': return renderLeaderboard();
    case 'wallet': return renderWallet();
    case 'profile': return renderProfile();
    case 'contact': return renderContactForm();
    default: return renderHome();
  }
}

function renderHome() {
  const bonusPlays = state.user?.bonusPlays ?? 0;
  const dc = state.user?.dailyChallenge;
  return `
    ${state.success ? `<div class="success-banner">${state.success}</div>` : ''}
    ${state.error ? `<div class="error-banner">${state.error}</div>` : ''}
    ${pushReminderBannerHtml()}
    <div class="card">
      <h2>Bonjour ${escapeHtml(state.user?.name ?? '')} 👋</h2>
      <p>Jouez chaque jour pour gagner des points, grimper au classement et les retirer en espèces chez l'un de nos Agents sur tout le territoire national.</p>
      ${bonusPlays > 0 ? `<p style="font-size:18px; font-weight:800; color:var(--game-contrast);">🎟️ <strong>${bonusPlays}</strong> partie(s) bonus disponible(s) (au-delà de la limite gratuite du jour).</p>` : ''}
    </div>
    ${dc ? (dc.attemptedToday ? (dc.outcome === 'won' ? `
    <div class="card glow-card challenge-done">
      <h2>🎯 Défi du jour</h2>
      <p style="font-size:13px;">Questions très difficiles — au moins <strong>${dc.thresholdPercent}%</strong> de bonnes réponses pour réussir.</p>
      <p style="font-size:14px; font-weight:700; color:var(--green); margin:0;">✅ Réussi aujourd'hui par <strong>${escapeHtml(state.user?.name ?? '')}</strong> (${escapeHtml(state.user?.referralCode ?? '')}) — +${dc.rewardPoints} pts crédités</p>
    </div>
    ` : `
    <div class="card glow-card" style="border-left-color: var(--red);">
      <h2>🎯 Défi du jour</h2>
      <p style="font-size:13px;">Questions très difficiles — au moins <strong>${dc.thresholdPercent}%</strong> de bonnes réponses pour réussir.</p>
      <p style="font-size:14px; font-weight:700; color:var(--red); margin:0;">❌ Tentative échouée aujourd'hui — revenez demain.</p>
    </div>
    `) : `
    <button type="button" class="card glow-card" id="daily-challenge-card" style="width:100%; text-align:left; cursor:pointer; border:none; font:inherit; color:inherit;">
      <h2>🎯 Défi du jour</h2>
      <p style="font-size:13px;">Questions très difficiles — au moins <strong>${dc.thresholdPercent}%</strong> de bonnes réponses pour réussir.</p>
      <p style="font-size:13px; color:var(--muted); margin:0 0 8px;">Pas encore tenté — <strong style="color:var(--green);">+${dc.rewardPoints} pts</strong> si réussi, <strong style="color:var(--red);">-${dc.lossPercent}% du solde</strong> si échoué. Une seule tentative par jour.</p>
      <span class="panel-cta">Relever le défi <span aria-hidden="true">→</span></span>
    </button>
    `) : `
    <div class="card glow-card">
      <h2>🎯 Défi du jour</h2>
      <p style="font-size:13px; color:var(--muted);">Chargement du statut du défi du jour...</p>
    </div>
    `}
    <div class="game-hub">
      <button class="game-panel" data-start="trivia">
        <div class="icon-badge">🧠</div>
        <h3>Quiz culture générale</h3>
        <p>5 questions · 35 secondes</p>
        <div class="panel-cta">Jouer <span aria-hidden="true">→</span></div>
      </button>
      <button class="game-panel" data-start="puzzle">
        <div class="icon-badge">🔢</div>
        <h3>Sprint de calcul</h3>
        <p>8 calculs · 35 secondes</p>
        <div class="panel-cta">Jouer <span aria-hidden="true">→</span></div>
      </button>
    </div>
    <div class="card">
      <h2>Comment ça marche</h2>
      <p>1. Jouez à un jeu d'habileté (10 parties gratuites/jour et par jeu).</p>
      <p>2. Gagnez des points selon vos bonnes réponses.</p>
      <p>3. Cumulez et demandez un retrait en espèces chez l'un de nos Agents sur tout le territoire national.</p>
      <p>4. Plus de parties gratuites aujourd'hui ? Déposez chez l'agent pour des parties bonus (onglet Portefeuille) — cet argent achète des parties, il n'est pas retirable.</p>
      <p>5. Avant chaque partie, vous pouvez miser entre 100 et 2500 de vos points : score quasi parfait, la mise augmente jusqu'à 10% ; score faible, elle peut diminuer jusqu'à 75%. Optionnel — vous pouvez toujours jouer sans miser.</p>
      <p>6. Chaque partie est chronométrée (35 secondes, 60 secondes pour le Défi du jour) : le temps s'affiche pendant que vous jouez. Si le temps s'écoule avant la fin, la partie est perdue (0 point) et une mise éventuelle perd 50% — répondez avant la fin du compte à rebours !</p>
      <p>7. Défi du jour : questions et calculs très difficiles, sans mise, une seule tentative par jour. Réussi (≥90% de bonnes réponses) → +150 pts. Échoué (score insuffisant ou temps écoulé) → -75% de votre solde de points.</p>
    </div>
  `;
}

function bindHomeEvents() {
  bindPushReminderBannerEvents();

  document.querySelectorAll('[data-start]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingGameType = btn.dataset.start;
      setState({ view: 'stakePrompt', error: '' });
    });
  });

  // Carte "Défi du jour" — uniquement présente/cliquable tant qu'il n'est pas relevé (voir
  // renderHome() : une fois relevé, la carte redevient un <div> non interactif). Mène à un
  // choix de jeu dédié plutôt que de présélectionner l'un des deux, le défi comptant pour
  // n'importe lequel des deux jeux.
  const challengeCard = document.getElementById('daily-challenge-card');
  if (challengeCard) {
    challengeCard.addEventListener('click', () => setState({ view: 'dailyChallenge', error: '' }));
  }
}

// ---------- DÉFI DU JOUR (avertissement, puis choix du jeu) ----------
// Écran en deux temps (juillet 2026, refonte "tout ou rien") : un avertissement explicite
// avec les enjeux exacts (+150 pts / -75% du solde) doit être acquitté avant de proposer
// le choix Quiz/Sprint — voir dailyChallengeConfirmed ci-dessous, un drapeau de module
// (comme pendingGameType/confirmingDeleteAccount plus haut) plutôt qu'un champ de state,
// remis à false à chaque retour sur cet écran pour ne jamais sauter l'avertissement.
let dailyChallengeConfirmed = false;

function renderDailyChallengeChoice() {
  const dc = state.user?.dailyChallenge;
  if (!dailyChallengeConfirmed) {
    return `
      <div class="card glow-card" style="border-left-color: var(--red);">
        <h2>⚠️ Défi du jour — tout ou rien</h2>
        <p>Questions et calculs <strong>nettement plus difficiles</strong> que le jeu normal, sans mise possible. Une seule tentative par jour, quel que soit le résultat :</p>
        <p style="font-size:15px; font-weight:700; color:var(--green); margin:8px 0 4px;">✅ Réussi (≥ ${dc?.thresholdPercent ?? 90}% de bonnes réponses) → +${dc?.rewardPoints ?? 150} pts</p>
        <p style="font-size:15px; font-weight:700; color:var(--red); margin:0 0 12px;">❌ Échoué (score insuffisant ou temps écoulé) → -${dc?.lossPercent ?? 75}% de votre solde de points</p>
        <p style="font-size:13px; color:var(--muted);">Une fois lancée, la tentative ne peut plus être annulée — impossible de réessayer aujourd'hui, même en cas d'échec.</p>
        <button class="primary" id="daily-challenge-confirm-btn" style="margin-top:10px;">J'ai compris, continuer →</button>
      </div>
      <button class="link-btn" id="daily-challenge-back" style="display:block; margin-top:4px;">← Retour à l'accueil</button>
    `;
  }
  return `
    <div class="card glow-card">
      <h2>🎯 Défi du jour</h2>
      <p style="font-size:13px;">Choisissez le jeu pour votre unique tentative d'aujourd'hui — quiz ou sprint, tous deux en version difficile.</p>
    </div>
    <div class="game-hub">
      <button class="game-panel" data-daily-start="trivia">
        <div class="icon-badge">🧠</div>
        <h3>Quiz difficile</h3>
        <p>5 questions très difficiles · 60 secondes</p>
        <div class="panel-cta">Jouer <span aria-hidden="true">→</span></div>
      </button>
      <button class="game-panel" data-daily-start="puzzle">
        <div class="icon-badge">🔢</div>
        <h3>Sprint difficile</h3>
        <p>8 calculs difficiles · 60 secondes</p>
        <div class="panel-cta">Jouer <span aria-hidden="true">→</span></div>
      </button>
    </div>
    <button class="link-btn" id="daily-challenge-back" style="display:block; margin-top:4px;">← Retour à l'accueil</button>
  `;
}

function bindDailyChallengeChoiceEvents() {
  const confirmBtn = document.getElementById('daily-challenge-confirm-btn');
  if (confirmBtn) confirmBtn.addEventListener('click', () => { dailyChallengeConfirmed = true; setState({ error: '' }); });

  document.querySelectorAll('[data-daily-start]').forEach(btn => {
    btn.addEventListener('click', () => startDailyChallengeGame(btn.dataset.dailyStart));
  });

  const backBtn = document.getElementById('daily-challenge-back');
  if (backBtn) backBtn.addEventListener('click', () => { dailyChallengeConfirmed = false; setState({ view: 'home', error: '' }); });
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
      <p>Vous pouvez miser entre ${STAKE_MIN} et ${STAKE_MAX} points de votre solde (${balance} pts disponibles) avant de jouer. Votre mise varie selon votre score : un score parfait la fait gagner 10%, un score nul lui en fait perdre 75% — il faut environ 9 bonnes réponses sur 10 pour au moins récupérer sa mise. Les points gagnés normalement par bonne réponse restent les mêmes, avec ou sans mise. ⚠️ Si le temps s'écoule (35 secondes par partie), la partie est perdue et votre mise perd 50% quel que soit votre score en cours — cette règle remplace la formule ci-dessus dans ce cas.</p>
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
      mode: 'normal',
      sessionToken: data.sessionToken,
      items: type === 'trivia' ? data.questions : data.problems,
      index: 0,
      answers: [],
      result: null,
      submitting: false,
      // Feedback vert/rouge immédiat par question (voir answerCurrent/checkAnswerServer) :
      // `feedback` porte { value, correct } pendant la courte pause d'affichage juste après
      // une réponse (null sinon) ; `answering` bloque tout double-clic pendant l'appel réseau
      // + la pause, avant que la question suivante ne s'affiche.
      feedback: null,
      answering: false,
      timeLimitSeconds: data.timeLimitSeconds || null,
      // Fixé une seule fois au début de la partie — le compte à rebours affiché en
      // recalcule toujours à partir de cette échéance fixe, jamais réinitialisé question
      // par question (voir startGameTimerTick()).
      deadlineAt: data.timeLimitSeconds ? Date.now() + data.timeLimitSeconds * 1000 : null,
      usingBonusPlay: !!data.usingBonusPlay,
      remainingPlaysToday: data.remainingPlaysToday,
      stake: data.stake || 0,
      startedAt: Date.now()
    };
    pendingGameType = null;
    startGameMusic();
    setState({ view: type });
  } catch (err) {
    setState({ view: 'stakePrompt', error: err.message });
  }
}

// Démarre une tentative de Défi du jour (juillet 2026) — pendant analogue à startGame()
// mais volontairement séparée : pas de mise, pas de query stake, endpoints dédiés
// /games/daily-challenge/*, et state.game porte mode:'daily' pour que renderGameScreen()
// et submitGame() empruntent leurs branches spécifiques (voir plus bas).
async function startDailyChallengeGame(type) {
  setState({ error: '' });
  try {
    const data = type === 'trivia' ? await api('/games/daily-challenge/trivia') : await api('/games/daily-challenge/puzzle');
    state.game = {
      type,
      mode: 'daily',
      sessionToken: data.sessionToken,
      items: type === 'trivia' ? data.questions : data.problems,
      index: 0,
      answers: [],
      result: null,
      submitting: false,
      // Voir le commentaire équivalent dans startGame() ci-dessus.
      feedback: null,
      answering: false,
      timeLimitSeconds: data.timeLimitSeconds || null,
      deadlineAt: data.timeLimitSeconds ? Date.now() + data.timeLimitSeconds * 1000 : null,
      usingBonusPlay: false,
      remainingPlaysToday: null,
      stake: 0,
      // Conservés pour l'affichage du bandeau "tout ou rien" pendant la partie (voir dailyNote
      // dans renderGameScreen) — évite de coder les valeurs en dur côté frontend.
      rewardPoints: data.rewardPoints,
      lossPercent: data.lossPercent,
      startedAt: Date.now()
    };
    dailyChallengeConfirmed = false; // repart de l'écran d'avertissement à la prochaine visite
    startGameMusic();
    setState({ view: type });
  } catch (err) {
    setState({ view: 'dailyChallenge', error: err.message });
  }
}

function renderGameScreen(type) {
  const g = state.game;
  if (!g || g.type !== type) {
    return `<div class="center-msg">Chargement du jeu...</div>`;
  }
  if (g.result) {
    const r = g.result;
    // Défi du jour : résultat "tout ou rien" totalement distinct du résultat normal — la
    // réponse du serveur n'a ni mise, ni pointsEarned, ni quota de parties (voir
    // submitDailyChallengeTrivia/Puzzle dans backend/routes/games.js), donc on l'affiche à
    // part plutôt que de forcer ces champs absents dans le rendu normal ci-dessous.
    if (g.mode === 'daily') {
      return `
        <div class="card" style="border:2px solid ${r.won ? 'var(--green)' : 'var(--red)'};">
          <h2>${r.won ? '🎉 Défi du jour réussi !' : '❌ Défi du jour échoué'}</h2>
          <p>Bonnes réponses : <strong>${r.correctCount}/${r.total}</strong>${r.timedOut ? ' — temps écoulé' : ''}</p>
          ${r.won ? `
            <p style="font-size:20px; font-weight:800; color:var(--green);">+${r.pointsDelta} pts</p>
          ` : `
            <p style="font-size:20px; font-weight:800; color:var(--red);">${r.pointsDelta} pts (-75% du solde)</p>
          `}
          <p>Nouveau solde : <strong>${r.newBalance} pts</strong></p>
          <p style="font-size:13px; color:var(--muted);">Une seule tentative par jour — rendez-vous demain pour un nouveau Défi du jour.</p>
        </div>
        <div class="card">
          <h2>🎮 Jouer une partie normale</h2>
          <div class="grid-2">
            <button class="tile" data-start="trivia"><span class="emoji">🧠</span>Quiz culture générale</button>
            <button class="tile" data-start="puzzle"><span class="emoji">🔢</span>Sprint de calcul</button>
          </div>
        </div>
      `;
    }
    const staked = r.stake > 0;
    const remainingAfter = g.remainingPlaysToday;
    const remainingAfterNote = remainingAfter !== undefined && remainingAfter !== null
      ? `<p style="font-size:18px; font-weight:800; color:var(--game-contrast);">🎮 Parties gratuites restantes : <strong>${remainingAfter}</strong></p>`
      : '';
    const bonusAfter = typeof r.bonusPlays === 'number' ? r.bonusPlays : null;
    const bonusAfterNote = bonusAfter !== null && bonusAfter > 0
      ? `<p style="font-size:18px; font-weight:800; color:var(--game-contrast);">🎟️ Parties bonus disponibles : <strong>${bonusAfter}</strong></p>`
      : '';
    // Vrai si le joueur ne pourra pas relancer une partie gratuite maintenant (quota du
    // jour épuisé ET aucune partie bonus en réserve — voir playAllowance() dans
    // backend/routes/games.js). Dans ce cas seulement, on propose d'acheter des parties
    // (dépôt chez l'agent) ou de devenir VIP (plus de parties gratuites/jour) juste après
    // les deux tuiles de jeu, plutôt que de laisser le joueur cliquer dans le vide.
    const limitReached = remainingAfter !== undefined && remainingAfter !== null && remainingAfter <= 0 && !(bonusAfter > 0);
    const limitReachedCta = limitReached ? `
      <div class="grid-2" style="margin-top:8px;">
        <button class="tile" data-nav-view="wallet"><span class="emoji">🎟️</span>Acheter des points</button>
        <button class="tile" data-nav-view="wallet"><span class="emoji">👑</span>Devenir VIP</button>
      </div>
    ` : '';
    // Temps écoulé (juillet 2026) : traité comme une partie perdue plutôt qu'un résultat
    // normal — 0 point quel que soit ce qui avait déjà été répondu, et une perte fixe de
    // 50% de la mise éventuelle (au lieu de la formule ±15% habituelle) ; voir scoreOutcome()
    // dans backend/routes/games.js et "Limite de temps par partie" dans README.md.
    if (r.timedOut) {
      return `
        <div class="card" style="border:2px solid var(--red);">
          <h2>⏰ Temps écoulé — partie perdue</h2>
          <p>Vous avez répondu correctement à <strong>${r.correctCount}/${r.total}</strong>, mais le temps s'est écoulé avant la fin : la partie compte comme perdue, <strong style="color:var(--red)">0 point gagné</strong>.</p>
          ${staked ? `
            <p>Mise : <strong>${r.stake} pts</strong> → <strong>${r.stakeResult} pts</strong>
              (<strong style="color:var(--red)">${r.stakeDelta} pts, -50% pour temps écoulé</strong>)</p>
          ` : ''}
          ${!staked && r.noStakePenalty > 0 ? `
            <p>Partie sans mise perdue : <strong style="color:var(--red)">-${r.noStakePenalty} pts (-30% du solde)</strong></p>
          ` : ''}
          <p>Nouveau solde : <strong>${r.newBalance} pts</strong></p>
          ${remainingAfterNote}
          ${bonusAfterNote}
        </div>
        <div class="card">
          <h2>🎮 Jouer une nouvelle partie</h2>
          <div class="grid-2">
            <button class="tile" data-start="trivia"><span class="emoji">🧠</span>Quiz culture générale</button>
            <button class="tile" data-start="puzzle"><span class="emoji">🔢</span>Sprint de calcul</button>
          </div>
          ${limitReachedCta}
        </div>
      `;
    }
    return `
      <div class="card">
        <h2>${type === 'trivia' ? '🧠 Résultat du quiz' : '🔢 Résultat du sprint'}</h2>
        <p>Bonnes réponses : <strong>${r.correctCount}/${r.total}</strong></p>
        <p>Points gagnés : <strong style="color:var(--green)">+${r.pointsEarned}</strong></p>
        ${staked ? `
          <p>Mise : <strong>${r.stake} pts</strong> → <strong>${r.stakeResult} pts</strong>
            (<strong style="color:${r.stakeDelta >= 0 ? 'var(--green)' : 'var(--red)'}">${r.stakeDelta >= 0 ? '+' : ''}${r.stakeDelta}</strong>)</p>
        ` : ''}
        ${!staked && r.noStakePenalty > 0 ? `
          <p>Partie perdue sans mise : <strong style="color:var(--red)">-${r.noStakePenalty} pts (-30% du solde)</strong></p>
        ` : ''}
        <p>Nouveau solde : <strong>${r.newBalance} pts</strong></p>
        ${remainingAfterNote}
        ${bonusAfterNote}
      </div>
      <div class="card">
        <h2>🎮 Jouer une nouvelle partie</h2>
        <div class="grid-2">
          <button class="tile" data-start="trivia"><span class="emoji">🧠</span>Quiz culture générale</button>
          <button class="tile" data-start="puzzle"><span class="emoji">🔢</span>Sprint de calcul</button>
        </div>
        ${limitReachedCta}
      </div>
    `;
  }

  const idx = g.index;
  const total = g.items.length;
  const dots = Array.from({ length: total }, (_, i) => `<span class="${i < idx ? 'done' : ''}"></span>`).join('');
  const bonusNote = g.usingBonusPlay ? `<p style="text-align:center; font-size:12px; color:var(--muted);">🎟️ Partie bonus</p>` : '';
  const stakeNote = g.stake > 0 ? `<p style="text-align:center; font-size:12px; color:var(--muted);">💰 Mise en cours : ${g.stake} pts</p>` : '';
  // Rappel permanent des enjeux pendant la tentative — l'avertissement déjà vu sur l'écran
  // précédent (renderDailyChallengeChoice) ne suffit pas à lui seul une fois la partie
  // lancée, le joueur doit garder les enjeux sous les yeux jusqu'à la dernière question.
  const dailyNote = g.mode === 'daily'
    ? `<p style="text-align:center; font-size:13px; font-weight:700; color:var(--red);">🎯 Défi du jour — tout ou rien : +${g.rewardPoints} pts si réussi, -${g.lossPercent}% du solde si échoué</p>`
    : '';
  const remaining = g.remainingPlaysToday;
  const remainingNote = remaining !== undefined && remaining !== null
    ? `<p style="text-align:center; font-size:18px; font-weight:800; color:var(--game-contrast); margin:0 0 8px;">🎮 Parties gratuites restantes : <strong>${remaining}</strong></p>`
    : '';
  // Placeholder recalculé immédiatement par startGameTimerTick() (voir render()) — évite
  // d'afficher un "--:--" vide pendant la fraction de seconde avant le premier tick.
  // Bien plus grand/visible (juillet 2026) qu'à sa première version (16px, discret) — le
  // joueur doit voir le temps restant sans effort, en jeu comme sur écran mobile. Couleur
  // adaptative (--game-contrast, voir updateGameContrastColor) : rouge sur fond pâle,
  // blanc sur fond foncé — sauf dans les 10 dernières secondes, toujours en rouge plein
  // sur fond rouge (voir startGameTimerTick), pour une urgence visible quel que soit le thème.
  const timerNote = g.deadlineAt
    ? `<p id="game-timer" style="text-align:center; font-size:44px; font-weight:900; letter-spacing:1px; color:var(--game-contrast); margin:0 0 10px; padding:10px 0; border-radius:16px; background:rgba(0,0,0,0.28);">⏱️ --:--</p>`
    : '';

  // Feedback vert/rouge immédiat (juillet 2026) : g.feedback n'est posé que pendant la
  // courte pause juste après avoir répondu (voir answerCurrent) — sur LA question qui vient
  // d'être répondue, avant de passer à la suivante. Les boutons/le formulaire sont désactivés
  // pendant cette pause (voir fb ? 'disabled' : '' ci-dessous et le remplacement du
  // formulaire par un message pour le sprint) pour qu'un clic pendant la pause ne saute pas
  // la question suivante par erreur.
  const fb = g.feedback;

  if (type === 'trivia') {
    const q = g.items[idx];
    return `
      <div class="progress-dots">${dots}</div>
      ${timerNote}
      ${dailyNote}
      ${bonusNote}
      ${stakeNote}
      ${remainingNote}
      <div class="card">
        <h2>Question ${idx + 1}/${total}</h2>
        <p style="color:var(--text); font-size:16px; font-weight:600;">${q.question}</p>
      </div>
      <div id="choices">
        ${q.choices.map((c, i) => {
          // .correct/.wrong (styles.css) préexistaient mais n'étaient encore jamais posées
          // par app.js avant ce feedback en direct — réutilisées ici plutôt que de dupliquer
          // les mêmes couleurs en style inline.
          const isPicked = fb && String(i) === String(fb.value);
          const feedbackClass = isPicked ? (fb.correct ? ' correct' : ' wrong') : '';
          return `<button class="choice-btn${feedbackClass}" data-choice="${i}" ${fb ? 'disabled' : ''}>${c}${isPicked ? (fb.correct ? ' ✅' : ' ❌') : ''}</button>`;
        }).join('')}
      </div>
    `;
  }

  // puzzle
  const p = g.items[idx];
  return `
    <div class="progress-dots">${dots}</div>
    ${timerNote}
    ${dailyNote}
    ${bonusNote}
    ${stakeNote}
    ${remainingNote}
    <div class="card">
      <h2>Calcul ${idx + 1}/${total}</h2>
      <p style="font-size:28px; font-weight:800; text-align:center; color:var(--text);">${p.text} = ?</p>
      ${fb ? `
        <p style="text-align:center; font-size:20px; font-weight:800; color:${fb.correct ? 'var(--green)' : 'var(--red)'};">${fb.correct ? '✅ Bonne réponse !' : '❌ Mauvaise réponse'}</p>
      ` : `
        <form id="puzzle-form">
          <input name="answer" type="number" inputmode="numeric" placeholder="Votre réponse" autofocus required />
          <button class="primary" type="submit">Valider</button>
        </form>
      `}
    </div>
  `;
}

// ---------- MINUTEUR DE PARTIE ----------
// Un seul setInterval actif à la fois (voir clearGameTimer() appelé au début de render()) —
// relancé à chaque rendu, mais toujours recalculé depuis state.game.deadlineAt (fixé une
// fois au début de la partie), jamais réinitialisé : répondre à une question ne rallonge
// jamais le temps restant.
let gameTimerInterval = null;

function clearGameTimer() {
  if (gameTimerInterval) { clearInterval(gameTimerInterval); gameTimerInterval = null; }
}

function startGameTimerTick() {
  const tick = () => {
    const g = state.game;
    if (!g || g.result || !g.deadlineAt) { clearGameTimer(); return; }
    const el = document.getElementById('game-timer');
    const remainingMs = g.deadlineAt - Date.now();
    if (remainingMs <= 0) {
      clearGameTimer();
      if (el) el.textContent = '⏱️ 00:00';
      autoSubmitOnTimeout();
      return;
    }
    if (el) {
      const totalSec = Math.ceil(remainingMs / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      el.textContent = `⏱️ ${mm}:${ss}`;
      // Dans les 10 dernières secondes, un badge rouge plein + texte blanc reste visible
      // et alarmant quel que soit le thème — sinon --game-contrast (rouge/blanc selon le
      // fond) s'applique déjà via le style inline posé au premier rendu de l'écran.
      if (totalSec <= 10) {
        el.style.background = '#d21034';
        el.style.color = '#ffffff';
      } else {
        el.style.background = 'rgba(0,0,0,0.28)';
        el.style.color = 'var(--game-contrast)';
      }
    }
  };
  tick(); // affichage immédiat, sans attendre le premier intervalle de 250ms
  gameTimerInterval = setInterval(tick, 250);
}

// Complète les réponses manquantes (question en cours + celles jamais atteintes) avec -1
// — une valeur qui ne peut jamais correspondre à une bonne réponse légitime (indices de
// choix 0-3 pour le quiz, résultats toujours ≥ 0 pour le sprint de calcul), donc toujours
// comptée comme fausse côté serveur — puis soumet la partie comme si le joueur l'avait
// terminée avec ce qu'il avait déjà répondu.
async function autoSubmitOnTimeout() {
  const g = state.game;
  if (!g || g.result) return;
  while (g.answers.length < g.items.length) g.answers.push(-1);
  // timedOut: true déclenche la pénalité côté serveur (partie perdue, 50% de la mise
  // perdue au lieu de la formule normale) — voir scoreOutcome() dans backend/routes/games.js.
  await submitGame(g, { timedOut: true });
}

function bindGameEvents() {
  // Sur l'écran de résultat, "Jouer une nouvelle partie" propose directement les deux jeux
  // (mêmes tuiles data-start que l'Accueil) plutôt que de forcer un retour à l'Accueil
  // complet — le joueur reste dans l'enchaînement du jeu. La barre d'onglets en bas reste
  // toujours disponible pour revenir à l'Accueil manuellement si besoin.
  document.querySelectorAll('[data-start]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingGameType = btn.dataset.start;
      setState({ view: 'stakePrompt', error: '' });
    });
  });

  // "Acheter des points" / "Devenir VIP" (affichés uniquement quota épuisé, voir
  // limitReachedCta ci-dessus) — les deux renvoient vers le Portefeuille, où vivent à la
  // fois le dépôt chez l'agent (parties bonus) et l'abonnement VIP (voir renderWallet()).
  document.querySelectorAll('[data-nav-view]').forEach(btn => {
    btn.addEventListener('click', () => setState({ view: btn.dataset.navView, error: '', success: '' }));
  });

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Interroge le nouvel endpoint /games/check-answer pour savoir si LA réponse qui vient
// d'être donnée est correcte, sans rien changer d'autre (ni points, ni mise, ni solde — la
// notation réelle reste entièrement au moment de submitGame, voir checkAnswer() dans
// backend/routes/games.js). Dégrade en silence sur une erreur réseau/serveur : on ne bloque
// jamais la partie pour un simple problème d'affichage, la partie continue normalement sans
// couleur cette fois-ci plutôt que de planter.
async function checkAnswerServer(sessionToken, value) {
  try {
    return await api('/games/check-answer', { method: 'POST', body: { sessionToken, answer: value } });
  } catch {
    return null;
  }
}

// Durée d'affichage de la couleur vert/rouge avant de passer à la question suivante — assez
// longue pour être vue sans effort, assez courte pour ne pas ralentir une partie chronométrée
// (voir TRIVIA_TIME_LIMIT_SECONDS/PUZZLE_TIME_LIMIT_SECONDS dans backend/routes/games.js).
const ANSWER_FEEDBACK_DELAY_MS = 700;

async function answerCurrent(value) {
  const g = state.game;
  // g.answering bloque tout appel concurrent (double-clic pendant l'appel réseau ou la
  // pause d'affichage qui suit) — sans lui, cliquer deux fois vite pousserait deux réponses
  // pour la même question.
  if (!g || g.answering) return;
  g.answering = true;

  const check = await checkAnswerServer(g.sessionToken, value);
  g.feedback = check ? { value, correct: check.correct } : null;
  render(); // affiche la couleur (si dispo) et désactive les contrôles le temps de la pause
  await sleep(ANSWER_FEEDBACK_DELAY_MS);

  // Course rare avec l'auto-soumission par expiration du minuteur (autoSubmitOnTimeout) :
  // si le temps s'écoule pile pendant cette pause de 700ms sur la DERNIÈRE question, la
  // partie peut déjà avoir été soumise (g.result posé) avant que ce sleep() ne se termine —
  // dans ce cas, ne rien pousser/soumettre une seconde fois (submitGame a de toute façon son
  // propre garde-fou g.submitting/g.result, mais autant ne pas non plus polluer g.answers).
  if (!g || g.result) { if (g) g.answering = false; return; }

  g.feedback = null;
  g.answering = false;
  g.answers.push(value);
  if (g.index < g.items.length - 1) {
    g.index++;
    render();
  } else {
    await submitGame(g);
  }
}

// Point de soumission unique, utilisé à la fois par la dernière réponse du joueur
// (answerCurrent) et par l'auto-soumission à l'expiration du minuteur
// (autoSubmitOnTimeout) — le garde-fou g.submitting évite qu'un timeout arrivant pile au
// moment où le joueur soumet sa dernière réponse déclenche deux requêtes concurrentes pour
// la même session (le serveur, lui, refuserait la seconde de toute façon, mais la première
// réponse réussie ne doit jamais être écrasée par l'erreur de la seconde).
async function submitGame(g, extraBody = {}) {
  if (!g || g.result || g.submitting) return;
  g.submitting = true;
  try {
    // Le Défi du jour a ses propres endpoints (mode 'tout ou rien', sans mise) — voir
    // startDailyChallengeGame() et les garde-fous session.mode côté serveur dans
    // backend/routes/games.js (submitTrivia/submitPuzzle rejettent une session 'daily', et
    // inversement pour submitDailyChallengeTrivia/Puzzle).
    const path = g.mode === 'daily'
      ? (g.type === 'trivia' ? '/games/daily-challenge/trivia/submit' : '/games/daily-challenge/puzzle/submit')
      : (g.type === 'trivia' ? '/games/trivia/submit' : '/games/puzzle/submit');
    const result = await api(path, { method: 'POST', body: { sessionToken: g.sessionToken, answers: g.answers, ...extraBody } });
    g.result = result;
    stopGameMusic(); // partie terminée (score normal ou temps écoulé) — voir music.js
    if (state.user) {
      state.user.points = result.newBalance;
      if (typeof result.bonusPlays === 'number') state.user.bonusPlays = result.bonusPlays;
      // Met à jour localement la carte "Défi du jour" de l'Accueil (voir renderHome) sans
      // attendre un rechargement complet du profil — la réponse de submit ne renvoie pas
      // l'objet dailyChallenge complet, donc on ne touche qu'aux deux champs concernés et on
      // conserve thresholdPercent/rewardPoints/lossPercent déjà connus.
      if (g.mode === 'daily') {
        state.user.dailyChallenge = { ...(state.user.dailyChallenge || {}), attemptedToday: true, outcome: result.won ? 'won' : 'lost' };
      }
    }
    localStorage.setItem('konkou_user', JSON.stringify(state.user));
    render();
  } catch (err) {
    setState({ view: 'home', error: err.message });
  } finally {
    g.submitting = false;
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
    // Voir le commentaire détaillé sur renderAsyncLoadError — même correctif de boucle
    // infinie qu'au Profil.
    if (err.status === 401) { logout(); return; }
    renderAsyncLoadError(err, renderLeaderboardAsync);
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
    <div class="card glow-card">
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
    const [data, agentsRes, vip] = await Promise.all([api('/wallet'), api('/agents/list'), api('/vip/status')]);
    const content = document.getElementById('view-content');
    if (!content) return;
    content.innerHTML = walletHtml(data, agentsRes.agents, vip);
    bindWalletEvents(data, agentsRes.agents, vip);
  } catch (err) {
    // Voir le commentaire détaillé sur renderAsyncLoadError — même correctif de boucle
    // infinie qu'au Profil.
    if (err.status === 401) { logout(); return; }
    renderAsyncLoadError(err, renderWalletAsync);
  }
}

function renderWallet() {
  setTimeout(renderWalletAsync, 0);
  return `<div class="center-msg">Chargement du portefeuille...</div>`;
}

// Rendered in place of a free-text agent code field, so the player picks from active
// agents instead of having to already know/type a code correctly. selectId distinguishes
// the cashout form's select from the deposit form's select (both call this function on
// the same wallet screen), so each can have its own "Infos Agent" box wired independently
// — see bindAgentSelectInfo() below.
function agentSelectHtml(agents, selectId) {
  if (agents.length === 0) {
    return `<p class="error-banner">Aucun agent actif pour le moment — revenez plus tard.</p>`;
  }
  return `
    <select name="agentCode" id="${selectId}" required>
      <option value="">Choisir un agent</option>
      ${agents.map(a => `<option value="${escapeHtml(a.agentCode)}" data-city="${escapeHtml(a.city || '')}" data-address="${escapeHtml(a.address || '')}" data-phone="${escapeHtml(a.phone || '')}" data-first-name="${escapeHtml(a.firstName || '')}">${escapeHtml(a.fullCode || a.agentCode)} — ${escapeHtml(a.firstName)} ${escapeHtml(a.lastName)} — ${escapeHtml([a.city, a.address].filter(Boolean).join(', '))}</option>`).join('')}
    </select>
    <div id="${selectId}-info" class="card" style="display:none; padding:12px; margin-top:-2px;"></div>
  `;
}

// Lien wa.me pré-rempli vers l'agent choisi — même principe que le formulaire "Nous
// contacter" (voir routes/contact.js) et la confirmation d'inscription (otp.js) : construit
// entièrement côté client (le téléphone de l'agent est déjà dans les données du
// sélecteur, pas besoin d'aller-retour serveur), c'est le joueur qui envoie lui-même le
// message depuis sa propre app WhatsApp.
function agentContactWhatsappLink(phone, agentFirstName) {
  const playerName = state.user?.name || 'un joueur Konkou';
  const text = `Bonjour${agentFirstName ? ` ${agentFirstName}` : ''}, je suis ${playerName} sur Konkou. J'ai une question à propos d'une demande chez vous.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

// Met à jour l'encart "📍 Infos agent" (ville/adresse + bouton de contact) sous le
// sélecteur dès que le joueur choisit un agent — pour qu'il sache où se rendre, et
// puisse déjà le joindre en cas de question, avant même de valider sa demande.
function bindAgentSelectInfo(selectId) {
  const select = document.getElementById(selectId);
  const info = document.getElementById(`${selectId}-info`);
  if (!select || !info) return;
  select.addEventListener('change', () => {
    const opt = select.selectedOptions[0];
    const city = opt?.dataset.city;
    const address = opt?.dataset.address;
    const phone = opt?.dataset.phone;
    const firstName = opt?.dataset.firstName;
    if (opt && opt.value && (city || address || phone)) {
      info.style.display = 'block';
      info.innerHTML = `
        <strong>📍 Infos agent</strong>
        ${(city || address) ? `<p style="margin:6px 0 0;">${[city, address].filter(Boolean).map(escapeHtml).join(' — ')}</p>` : ''}
        ${phone ? `
          <a href="${agentContactWhatsappLink(phone, firstName)}" target="_blank" rel="noopener" class="primary" style="display:block; text-align:center; text-decoration:none; background:#25D366; margin-top:10px;">💬 Contacter cet agent</a>
        ` : ''}
      `;
    } else {
      info.style.display = 'none';
      info.innerHTML = '';
    }
  });
}

function vipCardHtml(vip, agents) {
  const noAgents = agents.length === 0;
  if (vip.active) {
    // "Depuis le" reste affiché même en attente de renouvellement (l'abonnement en
    // cours, lui, ne change pas tant que ce renouvellement n'est pas confirmé — voir
    // agentConfirmVip/confirmVipPurchase, qui ne posent vip_activated_at qu'au moment où
    // une période VIP EXPIRÉE redémarre, jamais lors d'une prolongation avant échéance).
    const activatedNote = vip.activatedAt ? `Actif depuis le ${formatDate(vip.activatedAt)} — ` : '';
    return `
      <div class="card" style="border:2px solid var(--gold, #d4a017);">
        <h2>👑 Vous êtes VIP</h2>
        <p>${activatedNote}jusqu'au ${formatDate(vip.vipUntil)} — +${vip.extraDailyPlays} parties gratuites/jour.</p>
        ${vip.pending ? `<p style="font-size:12px;">Un renouvellement de ${vip.pending.amount_htg} HTG est en attente de confirmation (code ${escapeHtml(vip.pending.code)}) — sera ajouté à la date de fin actuelle une fois confirmé, vous pouvez continuer à jouer normalement en attendant.</p>` : `
        <form id="vip-form">
          ${agentSelectHtml(agents, 'vip-agent-select')}
          <button class="primary" type="submit" ${noAgents ? 'disabled' : ''}>Prolonger de ${vip.durationDays} jours (${vip.priceHtg} HTG)</button>
        </form>
        `}
      </div>
    `;
  }
  return `
    <div class="card glow-card">
      <h2>👑 Devenir VIP</h2>
      <p style="font-size:13px;">${vip.priceHtg} HTG chez un agent pour +${vip.extraDailyPlays} parties gratuites/jour pendant ${vip.durationDays} jours.</p>
      ${vip.pending ? `<p style="font-size:12px;">Demande en attente de confirmation (code ${escapeHtml(vip.pending.code)}).</p>` : `
      <form id="vip-form">
        ${agentSelectHtml(agents, 'vip-agent-select')}
        <button class="primary" type="submit" ${noAgents ? 'disabled' : ''}>Devenir VIP (${vip.priceHtg} HTG)</button>
      </form>
      `}
    </div>
  `;
}

function walletHtml(data, agents, vip) {
  const minCashoutPoints = Math.ceil(data.minCashoutHtg / data.rate);
  const noAgents = agents.length === 0;
  // Un joueur avec moins de points retirables que le minimum requis rendrait l'input
  // "points" avec min > max (ex. min="6250" max="0") — une plage impossible en HTML5 que
  // Chrome/Firefox détectent et signalent avec leur propre message technique ("La valeur
  // minimale doit être inférieure à la valeur maximale"), à chaque tentative de soumission,
  // sans jamais expliquer la vraie raison (solde insuffisant). On remplace le formulaire
  // par un message explicite dans ce cas plutôt que de laisser le navigateur gérer ça.
  const canCashout = data.withdrawablePoints >= minCashoutPoints;
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
        ${state.lastDepositDetails ? `
          <div class="stat-row"><span>Montant versé</span><span>${state.lastDepositDetails.htgAmount} HTG</span></div>
          <div class="stat-row"><span>Frais de service (${state.lastDepositDetails.feePercent}%)</span><span>-${state.lastDepositDetails.platformFeeHtg} HTG</span></div>
          ${state.lastDepositDetails.kind === 'points' ? `
          <div class="stat-row"><span><strong>Points accordés (non retirables)</strong></span><span><strong>${state.lastDepositDetails.pointsGranted}</strong></span></div>
          ` : `
          <div class="stat-row"><span><strong>Parties bonus accordées</strong></span><span><strong>${state.lastDepositDetails.playsGranted}</strong></span></div>
          `}
        ` : ''}
        <p>${escapeHtml(data.depositInfo)}</p>
        <button class="secondary" id="dismiss-deposit-code">J'ai noté le code</button>
      </div>
    ` : ''}
    ${state.lastVipCode ? `
      <div class="card" style="border:2px solid var(--gold, #d4a017);">
        <h2>👑 Abonnement VIP demandé</h2>
        <p>Votre code (à présenter avec le paiement) :</p>
        <p style="font-size:32px; font-weight:800; letter-spacing:4px; text-align:center; color:var(--text);">${escapeHtml(state.lastVipCode)}</p>
        ${state.lastVipDetails ? `
          <div class="stat-row"><span>Montant</span><span>${state.lastVipDetails.amountHtg} HTG</span></div>
          <div class="stat-row"><span>Durée</span><span>${state.lastVipDetails.durationDays} jours</span></div>
        ` : ''}
        <p>${escapeHtml(data.depositInfo)}</p>
        <button class="secondary" id="dismiss-vip-code">J'ai noté le code</button>
      </div>
    ` : ''}
    <div class="card glow-card">
      <h2>💰 Solde</h2>
      <p style="font-size:26px; font-weight:800; color:var(--text);">${data.points} pts</p>
      <p>≈ ${data.htgValue} HTG (taux indicatif : 1 pt = ${data.rate} HTG)</p>
      ${data.nonCashablePoints > 0 ? `
      <p style="font-size:12px;">Dont <strong>${data.withdrawablePoints} pts retirables</strong> (≈ ${data.withdrawableHtgValue} HTG) et <strong>${data.nonCashablePoints} pts achetés</strong>, non retirables — utilisables uniquement pour jouer.</p>
      ` : ''}
      <p style="font-size:12px;">Retrait minimum : ${data.minCashoutHtg} HTG (${minCashoutPoints} pts) · Limite quotidienne : ${data.maxDailyCashoutHtg} HTG (il vous reste ${data.dailyCashoutRemainingHtg} HTG aujourd'hui)</p>
      ${data.bonusPlays > 0 ? `<p style="font-size:18px; font-weight:800; color:var(--game-contrast);">🎟️ <strong>${data.bonusPlays}</strong> partie(s) bonus disponible(s)</p>` : ''}
    </div>
    <div class="card">
      <h2>Demander un retrait en espèces</h2>
      <p style="font-size:13px;">${escapeHtml(data.pickupInfo)}</p>
      <p style="font-size:12px;">Frais de service : ${(data.cashoutFeeTiers || []).map((t, i, arr) => {
        const min = i === 0 ? data.minCashoutHtg : arr[i - 1].maxHtg + 1;
        return `${t.percent}% (${min}${t.maxHtg ? `–${t.maxHtg}` : '+'} HTG)`;
      }).join(' · ')}</p>
      ${canCashout ? `
      <form id="cashout-form">
        <input name="points" type="number" placeholder="Points à retirer" min="${minCashoutPoints}" max="${data.withdrawablePoints}" required />
        ${agentSelectHtml(agents, 'cashout-agent-select')}
        <button class="primary" type="submit" ${noAgents ? 'disabled' : ''}>Générer mon code de retrait</button>
      </form>
      ` : `
      <p class="error-banner">Vous n'avez pas assez de points retirables pour demander un retrait — minimum ${minCashoutPoints} pts (${data.minCashoutHtg} HTG), vous avez ${data.withdrawablePoints} pts retirables.</p>
      `}
    </div>
    <div class="card">
      <h2>🎟️ Acheter chez un agent</h2>
      <p style="font-size:13px;">Achetez des parties bonus (au-delà de vos 10 parties gratuites/jour) ou des points directement — dans les deux cas cet argent n'est pas retirable, il sert uniquement à jouer. ${data.htgPerBonusPlay} HTG = 1 partie bonus · ${data.pointsPerHtgPurchase} pts par HTG net (après ${data.depositFeePercent}% de frais de service).</p>
      <p style="font-size:13px;">${escapeHtml(data.depositInfo)}</p>
      <form id="deposit-form">
        <div class="grid-2" style="margin-bottom:12px;">
          <label class="choice-btn" style="margin-bottom:0; display:flex; align-items:center; gap:8px;"><input type="radio" name="kind" value="plays" checked /> Parties bonus</label>
          <label class="choice-btn" style="margin-bottom:0; display:flex; align-items:center; gap:8px;"><input type="radio" name="kind" value="points" /> Points</label>
        </div>
        <input name="htgAmount" type="number" placeholder="Montant en HTG (${data.minDepositHtg}–${data.maxDepositHtg})" min="${data.minDepositHtg}" max="${data.maxDepositHtg}" required />
        ${agentSelectHtml(agents, 'deposit-agent-select')}
        <button class="primary" type="submit" ${noAgents ? 'disabled' : ''}>Générer mon code de dépôt</button>
      </form>
    </div>
    ${vipCardHtml(vip, agents)}
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
          <span>${d.htg_amount} HTG → ${d.kind === 'points' ? `${d.points_granted} points` : `${d.plays_granted} partie(s) bonus`} (code ${escapeHtml(d.code)})</span>
          <span>${depositStatusLabel(d.status)}</span>
        </div>
      `).join('')}
    </div>
    ${vip.history.length > 0 ? `
    <div class="card">
      <h2>Historique VIP</h2>
      ${vip.history.map(v => `
        <div class="tx-row" style="align-items:flex-start;">
          <span>${v.amount_htg} HTG → ${v.duration_days} jours (code ${escapeHtml(v.code)})<br>
            <span style="font-size:11px; color:var(--muted);">Demandé le ${formatDate(v.requested_at)}${v.processed_at ? ` · Traité le ${formatDate(v.processed_at)}` : ''}</span>
          </span>
          <span>${depositStatusLabel(v.status)}</span>
        </div>
      `).join('')}
    </div>
    ` : ''}
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
  bindAgentSelectInfo('cashout-agent-select');
  bindAgentSelectInfo('deposit-agent-select');
  bindAgentSelectInfo('vip-agent-select');
  const dismissBtn = document.getElementById('dismiss-code');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => setState({ lastCashoutCode: null, lastCashoutDetails: null }));
  }
  const dismissDepositBtn = document.getElementById('dismiss-deposit-code');
  if (dismissDepositBtn) {
    dismissDepositBtn.addEventListener('click', () => setState({ lastDepositCode: null, lastDepositDetails: null }));
  }
  const dismissVipBtn = document.getElementById('dismiss-vip-code');
  if (dismissVipBtn) {
    dismissVipBtn.addEventListener('click', () => setState({ lastVipCode: null, lastVipDetails: null }));
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
        setState({
          lastDepositCode: res.code,
          lastDepositDetails: {
            kind: res.kind,
            htgAmount: res.htgAmount,
            feePercent: res.feePercent,
            platformFeeHtg: res.platformFeeHtg,
            playsGranted: res.playsGranted,
            pointsGranted: res.pointsGranted
          },
          error: ''
        });
      } catch (err) {
        setState({ error: err.message, lastDepositCode: null, lastDepositDetails: null });
      }
    });
  }
  const vipForm = document.getElementById('vip-form');
  if (vipForm) {
    vipForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      try {
        const res = await api('/vip/request', { method: 'POST', body: fd });
        setState({
          lastVipCode: res.code,
          lastVipDetails: { amountHtg: res.amountHtg, durationDays: res.durationDays },
          error: ''
        });
      } catch (err) {
        setState({ error: err.message, lastVipCode: null, lastVipDetails: null });
      }
    });
  }
}

// Message d'erreur + bouton "Réessayer" affiché à la place du contenu quand le chargement
// asynchrone d'un écran (Profil/Classement/Portefeuille) échoue — voir renderProfileAsync/
// renderLeaderboardAsync/renderWalletAsync ci-dessous.
//
// CORRECTIF IMPORTANT (juillet 2026) : ces trois écrans appelaient auparavant
// setState({ error: err.message }) en cas d'échec. Comme setState() déclenche un render()
// complet, et que renderView() rappelle la fonction synchrone de cet écran (renderProfile,
// etc.) qui affiche TOUJOURS "Chargement..." puis reprogramme le même appel async — un
// échec persistant (session expirée/invalide, serveur qui répond une erreur, service qui
// se réveille après une mise en veille...) créait une boucle infinie et silencieuse : le
// joueur restait bloqué sur "Chargement du profil..." indéfiniment, sans jamais voir le
// vrai message d'erreur ni pouvoir réessayer manuellement. Corrigé en mettant à jour
// #view-content DIRECTEMENT ici (sans repasser par setState()/render()), avec le message
// d'erreur réel et un bouton pour relancer le chargement à la demande — plus de boucle.
function renderAsyncLoadError(err, retryFn, containerId = 'view-content') {
  const content = document.getElementById(containerId);
  if (!content) return;
  content.innerHTML = `
    <div class="card">
      <p class="error-banner">${escapeHtml(err.message || 'Erreur inconnue')}</p>
      <button class="secondary" id="async-retry-btn" type="button">🔄 Réessayer</button>
    </div>
  `;
  const btn = document.getElementById('async-retry-btn');
  if (btn) btn.addEventListener('click', retryFn);
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
    // Une session expirée/invalide (401) doit renvoyer à l'écran de connexion plutôt que
    // d'afficher un bouton "Réessayer" qui échouerait à chaque tentative de toute façon.
    if (err.status === 401) { logout(); return; }
    renderAsyncLoadError(err, renderProfileAsync);
  }
}

function renderProfile() {
  setTimeout(renderProfileAsync, 0);
  return `<div class="center-msg">Chargement du profil...</div>`;
}

function profileHtml(data) {
  return `
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    <div class="card glow-card">
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
    ${appNotificationsToggleHtml()}
    <button class="secondary" id="contact-btn">📞 Nous contacter</button>
    <button class="secondary" id="logout-btn">Se déconnecter</button>
    ${confirmingDeleteAccount ? `
      <div class="card" style="border:2px solid var(--red); margin-top:14px;">
        <h2>⚠️ Supprimer mon compte</h2>
        <p style="font-size:13px;">Action définitive et irréversible. Impossible s'il y a un retrait ou dépôt en attente, ou un rôle agent actif — réglez ces éléments d'abord.</p>
        ${data.points > 0 ? `<p class="error-banner">Vous avez <strong>${data.points} points</strong> sur ce compte — ils seront <strong>définitivement perdus</strong> si vous supprimez votre compte maintenant. Ils ne sont ni remboursés ni transférables.</p>` : ''}
        <p style="font-size:13px; color:var(--muted);">Votre numéro de téléphone sera libéré et pourra être utilisé pour créer un nouveau compte par la suite.</p>
        <form id="delete-account-form">
          ${pwdField('password', 'Confirmez votre mot de passe')}
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
  bindAppNotificationsToggleEvents();
  const contactBtn = document.getElementById('contact-btn');
  if (contactBtn) contactBtn.addEventListener('click', () => {
    setState({ view: 'contact', error: '', success: '' });
    startContactChatPolling();
  });
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
        const data = await api('/account/delete', { method: 'POST', body: { password } });
        confirmingDeleteAccount = false;
        logout();
        setState({ success: data.message });
      } catch (err) {
        setState({ error: err.message });
      }
    });
  }
}

// ---------- ESPACE AGENT (shell entièrement séparé — voir renderAgentShell()) ----------
let agentForceForm = false; // true after "Soumettre une nouvelle candidature" on a rejected application
let agentCommissionDate = ''; // '' = commission totale (tout l'historique), sinon 'YYYY-MM-DD'

// Bloc "Supprimer mon compte" partagé par les trois écrans agent (en attente, rejeté,
// tableau de bord) — même schéma que profileHtml() côté joueur (confirmingDeleteAccount
// réutilisé tel quel : un compte est soit joueur soit agent dans une session donnée,
// jamais les deux, donc pas de conflit à partager ce drapeau). L'objet passé en
// paramètre est soit `agent` (publicAgent, écrans en attente/rejeté) soit `dash`
// (tableau de bord) — les deux exposent creditBalance/commissionEarned.
function agentDeleteAccountBlock(agentOrDash) {
  const creditBalance = agentOrDash.creditBalance || 0;
  const commissionEarned = agentOrDash.commissionEarned || 0;
  const parts = [];
  if (creditBalance > 0) parts.push(`<strong>${creditBalance} HTG</strong> de crédit revendable`);
  if (commissionEarned > 0) parts.push(`<strong>${commissionEarned} HTG</strong> de commissions`);
  return `
    ${appNotificationsToggleHtml()}
    ${confirmingDeleteAccount ? `
      <div class="card" style="border:2px solid var(--red); margin-top:14px;">
        <h2>⚠️ Supprimer mon compte agent</h2>
        <p style="font-size:13px;">Action définitive et irréversible. Impossible s'il y a un dépôt, un retrait ou un renflouement qui vous est assigné et encore en attente — réglez-les d'abord depuis cet écran.</p>
        ${parts.length > 0 ? `<p class="error-banner">Ce compte a encore ${parts.join(' et ')} — à régler avec l'administrateur en dehors de l'app, ce n'est ni remboursé ni transféré automatiquement à la suppression.</p>` : ''}
        <p style="font-size:13px; color:var(--muted);">Votre numéro de téléphone sera libéré et pourra être utilisé pour créer un nouveau compte par la suite.</p>
        <form id="agent-delete-account-form">
          ${pwdField('password', 'Confirmez votre mot de passe')}
          <button class="primary" type="submit" style="background:var(--red);">Supprimer définitivement mon compte</button>
        </form>
        <button class="link-btn" id="agent-cancel-delete-account" style="margin-top:10px;">Annuler</button>
      </div>
    ` : `
      <button class="link-btn" id="agent-show-delete-account" style="margin-top:20px; color:var(--red);">🗑️ Supprimer mon compte</button>
    `}
  `;
}

function renderAgentShell() {
  return `
    <div class="topbar">
      <img src="${logoUrl}" alt="Konkou" class="topbar-logo">
      <div style="display:flex; gap:16px; align-items:center;">
        <button class="link-btn" id="agent-contact-btn" style="color:#fff; font-size:13px;">📞 Contact</button>
        <button class="link-btn" id="agent-logout-btn" style="color:#fff; font-size:13px;">Se déconnecter</button>
      </div>
    </div>
    <div class="view" id="agent-shell-content">
      <div class="center-msg">Chargement...</div>
    </div>
  `;
}

function bindAgentShellEvents() {
  document.getElementById('agent-logout-btn').addEventListener('click', logout);
  document.getElementById('agent-contact-btn').addEventListener('click', () => {
    const opening = state.agentScreen !== 'contact';
    if (!opening) stopChatPolling();
    setState({ agentScreen: opening ? 'contact' : 'main', error: '', success: '' });
    if (opening) startContactChatPolling();
  });

  const content = document.getElementById('agent-shell-content');
  if (state.agentScreen === 'contact') {
    content.innerHTML = renderContactForm();
    bindContactEvents(() => setState({ agentScreen: 'main', error: '', success: '' }));
  } else {
    renderAgentMainAsync();
  }
}

async function renderAgentMainAsync() {
  try {
    const me = await api('/agents/me');
    let html;
    if (!me.agent) {
      // Ne devrait pas arriver (isAgent implique une ligne agents) — filet de sécurité.
      html = `<div class="card"><p>Compte agent introuvable. Contactez l'administrateur.</p></div>`;
    } else if (agentForceForm) {
      html = agentApplyFormHtml();
    } else if (me.agent.status === 'pending') {
      html = agentPendingHtml(me.agent);
    } else if (me.agent.status === 'rejected') {
      html = agentRejectedHtml(me.agent);
    } else {
      const query = agentCommissionDate ? `?date=${encodeURIComponent(agentCommissionDate)}` : '';
      const [dash, commission] = await Promise.all([
        api('/agents/dashboard'),
        api(`/agents/commission-by-day${query}`)
      ]);
      html = agentDashboardHtml(dash, commission);
    }
    const content = document.getElementById('agent-shell-content');
    if (!content) return;
    content.innerHTML = html;
    bindAgentEvents();
  } catch (err) {
    // Même correctif de boucle infinie que renderProfileAsync/renderLeaderboardAsync/
    // renderWalletAsync (voir renderAsyncLoadError) : bindAgentShellEvents() rappelle
    // renderAgentMainAsync() à chaque render() tant que state.isAgent est vrai — un
    // setState({error}) ici redéclencherait indéfiniment le même appel qui échoue.
    if (err.status === 401) { logout(); return; }
    renderAsyncLoadError(err, renderAgentMainAsync, 'agent-shell-content');
  }
}

function agentApplyFormHtml() {
  return `
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    ${state.success ? `<div class="success-banner">${escapeHtml(state.success)}</div>` : ''}
    <div class="card">
      <h2>🧑‍💼 Nouvelle candidature</h2>
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
        <input name="city" placeholder="Ville" required />
        <input name="address" placeholder="Adresse (où les joueurs viendront faire leurs transactions)" required />
        ${agentReimbursementFieldsHtml()}
        <button class="primary" type="submit">Envoyer ma candidature</button>
      </form>
    </div>
  `;
}

function agentPendingHtml(agent) {
  return `
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    ${state.success ? `<div class="success-banner">${escapeHtml(state.success)}</div>` : ''}
    <div class="card">
      <h2>⏳ Candidature en attente</h2>
      <p>Code Agent :</p>
      <p style="font-size:28px; font-weight:800; letter-spacing:3px; text-align:center;">${escapeHtml(agent.fullCode || agent.agentCode)}</p>
      <p>Déposez <strong>${agent.capitalHtg} HTG</strong> à notre bureau pour activer votre compte agent.</p>
      <p style="font-size:13px;">Nous vérifions votre pièce d'identité et confirmons la réception du dépôt avant l'activation.</p>
    </div>
    ${agentDeleteAccountBlock(agent)}
  `;
}

function agentRejectedHtml(agent) {
  return `
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    ${state.success ? `<div class="success-banner">${escapeHtml(state.success)}</div>` : ''}
    <div class="card">
      <h2>❌ Candidature rejetée</h2>
      <p>Votre candidature agent (code ${escapeHtml(agent.fullCode || agent.agentCode)}) a été rejetée.</p>
      <button class="secondary" id="agent-reapply">Soumettre une nouvelle candidature</button>
    </div>
    ${agentDeleteAccountBlock(agent)}
  `;
}

// Carte "Remboursement de commission" (juillet 2026) — rappelle à l'agent les numéros
// NatCash/MonCash qu'il a fournis, son plan (8/15/22 jours) et où il en est dans son cycle
// actuel : combien l'admin lui doit déjà en commission depuis le dernier remboursement, et
// dans combien de jours (ou depuis quand, si en retard) le prochain est dû. Purement
// informatif côté agent — seul l'admin peut marquer un remboursement comme effectué (voir
// /admin.html → Agents → Remboursements), l'agent ne peut ni le déclencher ni le confirmer
// lui-même puisque c'est l'admin qui lui doit de l'argent, pas l'inverse.
function agentReimbursementCardHtml(dash) {
  const r = dash.reimbursement;
  return `
    <div class="card">
      <h2>💸 Remboursement de commission</h2>
      <p style="font-size:13px;">Plan choisi : <strong>tous les ${dash.reimbursementPeriodDays} jours</strong>, réglé par l'administration via NatCash ou MonCash.</p>
      <div class="stat-row"><span>NatCash</span><span>${escapeHtml(dash.natcashNumber || '—')}${dash.natcashName ? ` (${escapeHtml(dash.natcashName)})` : ''}</span></div>
      <div class="stat-row"><span>MonCash</span><span>${escapeHtml(dash.moncashNumber || '—')}${dash.moncashName ? ` (${escapeHtml(dash.moncashName)})` : ''}</span></div>
      ${r ? `
        <p style="margin-top:12px; font-size:14px;">Commission accumulée depuis le ${escapeHtml((r.cycleStartAt || '').slice(0, 10))}</p>
        <p style="font-size:28px; font-weight:800; color:var(--text);">${r.commissionOwedHtg} HTG</p>
        <p style="font-size:12px; color:var(--muted);">${r.withdrawalsCount} retrait(s) payé(s) cette période (${r.withdrawalsHtg} HTG remis aux joueurs).</p>
        <p style="font-size:13px; font-weight:700; color:${r.isDue ? 'var(--red)' : 'var(--muted)'};">${r.isDue
          ? "⏰ Remboursement dû — contactez l'administration si ce n'est pas encore réglé."
          : `📅 Prochain remboursement dans ${r.daysRemaining} jour(s) (${(r.dueAt || '').slice(0, 10)}).`}</p>
      ` : `<p style="font-size:13px; color:var(--muted); margin-top:10px;">Votre cycle de remboursement démarrera dès l'activation de votre compte.</p>`}
    </div>
  `;
}

function agentDashboardHtml(dash, commission) {
  const today = new Date().toISOString().slice(0, 10);
  const min = dash.activatedDate || commission?.activatedDate || undefined;
  return `
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    ${state.success ? `<div class="success-banner">${escapeHtml(state.success)}</div>` : ''}
    ${pushReminderBannerHtml()}
    <div class="card">
      <h2>🧑‍💼 ${escapeHtml(dash.firstName)} ${escapeHtml(dash.lastName)}</h2>
      <div class="stat-row"><span>Code Agent</span><span><strong>${escapeHtml(dash.fullCode || dash.agentCode)}</strong></span></div>
      ${(dash.city || dash.address) ? `<div class="stat-row"><span>Point de service</span><span>${[dash.city, dash.address].filter(Boolean).map(escapeHtml).join(' — ')}</span></div>` : ''}
      <div class="stat-row"><span>Balance (crédit à revendre)</span><span><strong>${dash.creditBalance} HTG</strong></span></div>
    </div>
    <div class="card">
      <h2>💰 Commission sur retraits</h2>
      <p style="font-size:13px;">Choisissez un jour pour voir la commission gagnée ce jour-là${min ? ` (depuis le ${min}, activation de votre compte)` : ''}.</p>
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:12px;">
        <input type="date" id="agent-commission-date-input" value="${escapeHtml(agentCommissionDate)}" ${min ? `min="${min}"` : ''} max="${today}" style="margin-bottom:0;">
        <button class="primary" id="agent-commission-date-apply-btn" type="button" style="flex:1; margin:0;">Voir ce jour</button>
      </div>
      ${agentCommissionDate ? `<button class="secondary" id="agent-commission-date-reset-btn" type="button">Revenir à tout l'historique</button>` : ''}
      <p style="margin-top:16px; font-size:14px;">Commission ${commission?.date ? `du ${commission.date}` : "totale (tout l'historique)"}</p>
      <p style="font-size:28px; font-weight:800; color:var(--text);">${commission?.commissionHtg ?? 0} HTG</p>
      <p style="font-size:12px; color:var(--muted);">${commission?.cashoutsCount ?? 0} retrait(s) payé(s) ${commission?.date ? 'ce jour-là' : 'au total'} · ${dash.commissionPercent}% par retrait, réglé hors app.</p>
    </div>
    ${agentReimbursementCardHtml(dash)}
    <div class="card">
      <h2>Dépôts à confirmer</h2>
      ${dash.pendingDeposits.length === 0 ? '<p>Aucun dépôt en attente.</p>' : dash.pendingDeposits.map(d => `
        <div class="tx-row" style="flex-direction:column; align-items:stretch; gap:6px; padding:12px 0;">
          <span>${escapeHtml(d.user_name)} (${escapeHtml(d.user_phone)}) — ${d.htg_amount} HTG → ${d.kind === 'points' ? `${d.points_granted} points` : `${d.plays_granted} partie(s) bonus`}</span>
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
      <h2>👑 Achats VIP à confirmer</h2>
      ${(dash.pendingVip || []).length === 0 ? '<p>Aucun achat VIP en attente.</p>' : dash.pendingVip.map(v => `
        <div class="tx-row" style="flex-direction:column; align-items:stretch; gap:6px; padding:12px 0;">
          <span>${escapeHtml(v.user_name)} (${escapeHtml(v.user_phone)}) — ${v.amount_htg} HTG → ${v.duration_days} jours VIP</span>
          <span style="font-weight:800; letter-spacing:2px;">${escapeHtml(v.code)}</span>
          <div class="grid-2">
            <button class="tile" data-agent-vip-confirm="${v.id}" style="background:rgba(34,197,94,0.2); font-size:13px;">✅ Confirmer</button>
            <button class="tile" data-agent-vip-reject="${v.id}" style="background:rgba(210,16,52,0.2); font-size:13px;">❌ Rejeter</button>
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
    ${agentDeleteAccountBlock(dash)}
  `;
}

function refillStatusLabel(status) {
  const map = { pending: '⏳ En attente', confirmed: '✅ Confirmé', rejected: '❌ Rejeté' };
  return map[status] || status;
}

function bindAgentEvents() {
  bindAppNotificationsToggleEvents();
  // Sans effet sur agentPendingHtml()/agentRejectedHtml() (la bannière n'existe que dans
  // agentDashboardHtml) — getElementById renvoie simplement null et les deux handlers ne
  // sont jamais attachés, sans erreur.
  bindPushReminderBannerEvents();
  const form = document.getElementById('agent-apply-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      // Voir la note équivalente sur le formulaire "Devenir Agent" (bindAgentRegisterEvents) —
      // phoneField() n'affiche/ne soumet que les 8 chiffres locaux, le "509" est rajouté ici.
      fd.natcashNumber = `509${fd.natcashNumber}`;
      fd.moncashNumber = `509${fd.moncashNumber}`;
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
  document.querySelectorAll('[data-agent-vip-confirm]').forEach(btn => {
    btn.addEventListener('click', () => agentAction('/agents/vip/confirm', btn.dataset.agentVipConfirm));
  });
  document.querySelectorAll('[data-agent-vip-reject]').forEach(btn => {
    btn.addEventListener('click', () => agentAction('/agents/vip/reject', btn.dataset.agentVipReject));
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

  const agentCommissionApplyBtn = document.getElementById('agent-commission-date-apply-btn');
  if (agentCommissionApplyBtn) {
    agentCommissionApplyBtn.addEventListener('click', () => {
      const date = document.getElementById('agent-commission-date-input').value;
      if (!date) { setState({ error: 'Choisissez une date.' }); return; }
      agentCommissionDate = date;
      renderAgentMainAsync();
    });
  }
  const agentCommissionResetBtn = document.getElementById('agent-commission-date-reset-btn');
  if (agentCommissionResetBtn) {
    agentCommissionResetBtn.addEventListener('click', () => {
      agentCommissionDate = '';
      renderAgentMainAsync();
    });
  }

  const agentShowDeleteBtn = document.getElementById('agent-show-delete-account');
  if (agentShowDeleteBtn) agentShowDeleteBtn.addEventListener('click', () => { confirmingDeleteAccount = true; setState({ error: '' }); });

  const agentCancelDeleteBtn = document.getElementById('agent-cancel-delete-account');
  if (agentCancelDeleteBtn) agentCancelDeleteBtn.addEventListener('click', () => { confirmingDeleteAccount = false; setState({ error: '' }); });

  const agentDeleteForm = document.getElementById('agent-delete-account-form');
  if (agentDeleteForm) {
    agentDeleteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = new FormData(e.target).get('password');
      try {
        const data = await api('/account/delete', { method: 'POST', body: { password } });
        confirmingDeleteAccount = false;
        logout();
        setState({ success: data.message });
      } catch (err) {
        setState({ error: err.message });
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
  if (state.view === 'dailyChallenge') bindDailyChallengeChoiceEvents();
  if (state.view === 'stakePrompt') bindStakePromptEvents();
  if (state.view === 'trivia' || state.view === 'puzzle') bindGameEvents();
  if (state.view === 'contact') bindContactEvents(() => setState({ view: 'profile', error: '', success: '' }));
  // leaderboard / wallet / profile bind themselves after async load
}

// ---------- INIT ----------
(async function init() {
  if (state.token) {
    await checkAgentStatus();
    if (!state.isAgent && !state.user) {
      try {
        const p = await api('/profile');
        state.user = p;
      } catch {
        state.token = null;
      }
    }
  }
  render();
  if (state.token && !state.isAgent) refreshProfile();
})();
