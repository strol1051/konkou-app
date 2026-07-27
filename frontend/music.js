// Musique de fond légère pendant les parties (juillet 2026) — générée entièrement via la
// Web Audio API, aucun fichier audio à héberger : rien à ajouter à la Content-Security-
// Policy (voir backend/utils.js, pas de media-src externe requis) et aucune question de
// droits d'auteur puisqu'il n'y a pas de piste enregistrée. C'est une boucle courte et
// discrète pensée pour occuper l'oreille pendant les questions, pas une composition —
// si un vrai morceau est souhaité un jour, il suffira de remplacer startGameMusic() par
// la lecture d'un <audio>/AudioBufferSourceNode pointant vers un fichier fourni.

const STORAGE_KEY = 'konkou_music_enabled';

let ctx = null;
let masterGain = null;
let schedulerTimer = null;
let nextNoteTime = 0;
let stepIndex = 0;
// true pendant qu'une partie est active, indépendamment du fait que le son soit coupé —
// permet à toggleMusic() de savoir s'il doit relancer la boucle immédiatement.
let musicShouldBePlaying = false;

// Petite grille d'accords douce (Am - F - C - G), jouée en arpège continu à tempo
// modéré — un classique "jeu mobile" apaisant qui ne cherche pas à attirer l'attention.
const CHORDS = [
  [220.00, 261.63, 329.63], // La mineur
  [174.61, 220.00, 261.63], // Fa majeur
  [261.63, 329.63, 392.00], // Do majeur
  [196.00, 246.94, 293.66]  // Sol majeur
];
const STEP_SECONDS = 0.42;
const STEPS_PER_CHORD = 4;
// Le scheduler regarde un peu en avance plutôt que de programmer note par note en temps
// réel (pattern standard Web Audio) — évite les décalages/saccades audibles liés à la
// précision approximative de setInterval seul.
const SCHEDULE_AHEAD_SECONDS = 1.5;

export function isMusicEnabled() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === 'true'; // activée par défaut
}

function setMusicEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}

function ensureContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.05; // volume discret, ne doit jamais couvrir l'interface
    masterGain.connect(ctx.destination);
  }
  // Les navigateurs suspendent l'AudioContext tant qu'aucun geste utilisateur n'a eu
  // lieu — startGameMusic() n'est appelée qu'au clic "Jouer", donc ce resume() aboutit
  // toujours immédiatement en pratique.
  if (ctx.state === 'suspended') ctx.resume();
}

function playNote(freq, time, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle'; // plus doux qu'une onde carrée/dent de scie
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(1, time + 0.02);
  gain.gain.linearRampToValueAtTime(0, time + duration);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(time);
  osc.stop(time + duration + 0.02);
}

function scheduleStep() {
  const chord = CHORDS[Math.floor(stepIndex / STEPS_PER_CHORD) % CHORDS.length];
  const note = chord[stepIndex % chord.length];
  playNote(note, nextNoteTime, STEP_SECONDS * 0.9);
  // Une octave en dessous au premier temps de chaque accord, pour donner un peu de
  // corps à la boucle sans la surcharger le reste du temps.
  if (stepIndex % STEPS_PER_CHORD === 0) playNote(note / 2, nextNoteTime, STEP_SECONDS * STEPS_PER_CHORD * 0.9);
  nextNoteTime += STEP_SECONDS;
  stepIndex++;
}

function schedulerTick() {
  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_SECONDS) {
    scheduleStep();
  }
}

function beginScheduler() {
  if (schedulerTimer) return; // déjà en cours
  stepIndex = 0;
  nextNoteTime = ctx.currentTime + 0.1;
  schedulerTick();
  schedulerTimer = setInterval(schedulerTick, 200);
}

// Appelée par startGame() (voir app.js) juste avant d'afficher les questions.
export function startGameMusic() {
  musicShouldBePlaying = true;
  if (!isMusicEnabled()) return;
  ensureContext();
  beginScheduler();
}

// Appelée dès que la partie se termine (résultat affiché, y compris temps écoulé) ou
// que le joueur quitte l'écran de jeu (barre d'onglets) — voir app.js.
export function stopGameMusic() {
  musicShouldBePlaying = false;
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
}

// Coupe/active le son immédiatement (relance la boucle sans attendre la prochaine
// partie si une partie est en cours) et mémorise le choix pour la prochaine fois.
// Retourne le nouvel état (true = activée) pour que l'appelant mette à jour l'icône.
export function toggleMusic() {
  const enabled = !isMusicEnabled();
  setMusicEnabled(enabled);
  if (enabled && musicShouldBePlaying) {
    ensureContext();
    beginScheduler();
  } else if (!enabled && schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  return enabled;
}
