import fs from 'node:fs';
import path from 'node:path';
import { getSetting, setSetting } from '../settings.js';
import { DATA_DIR } from '../db.js';

const SETTING_KEY = 'app_theme';
const BG_SETTING_KEY = 'app_bg_color';
const BG_IMAGE_SETTING_KEY = 'app_bg_image';
const LOGO_SETTING_KEY = 'app_logo';
const DEFAULT_THEME = 'default';

// La liste des couleurs/décorations de chaque thème vit uniquement côté frontend
// (app.js/admin.js) — le serveur ne fait que stocker/valider la clé choisie, pour éviter
// de dupliquer des valeurs de couleur des deux côtés. Garder cette liste synchronisée
// avec l'objet THEMES du frontend si un thème est ajouté/retiré.
const THEME_KEYS = ['default', 'noel', 'nouvel_an', 'ete', 'paques', 'gede', 'valentin'];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Les images uploadées par l'admin (photo de fond, logo) sont stockées sur le même
// disque persistant que la base SQLite (DATA_DIR, voir db.js) — pas dans frontend/, qui
// est recréé à neuf à chaque déploiement et perdrait donc le fichier. server.js sert
// /uploads/* directement depuis ce dossier.
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+=*)$/;

// Supprime le fichier actuellement référencé par un setting, s'il existe — évite
// d'accumuler des images orphelines sur le disque à chaque nouvel upload.
function removeExistingFile(settingKey) {
  const current = getSetting(settingKey, '');
  if (!current) return;
  const filePath = path.join(UPLOADS_DIR, path.basename(current));
  fs.rm(filePath, { force: true }, () => {}); // best-effort, asynchrone, ne bloque pas la réponse
}

// Logique d'upload partagée entre la photo de fond et le logo : reçoit une image encodée
// en data URL base64 (générée côté navigateur via <input type="file"> + canvas, pas
// besoin d'un parseur multipart/form-data côté serveur), la valide (format + taille),
// remplace l'éventuel fichier précédent, et l'écrit sur le disque persistant. Un
// dataUrl vide efface l'image actuelle. Retourne soit { error, status }, soit
// { url } (chemin public sous /uploads/, ou '' si l'image a été retirée).
function saveUploadedImage(dataUrl, { settingKey, filenamePrefix, maxBytes }) {
  if (!dataUrl) {
    removeExistingFile(settingKey);
    setSetting(settingKey, '');
    return { url: '' };
  }

  const match = IMAGE_DATA_URL_RE.exec(dataUrl);
  if (!match) {
    return { status: 400, error: 'Format d\'image invalide — utilisez un PNG, JPEG ou WebP.' };
  }

  const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > maxBytes) {
    return {
      status: 400,
      error: `Image trop lourde (${(buffer.length / 1024 / 1024).toFixed(1)} Mo) — maximum ${maxBytes / 1024 / 1024} Mo.`
    };
  }

  removeExistingFile(settingKey);
  const filename = `${filenamePrefix}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  const url = `/uploads/${filename}`;
  setSetting(settingKey, url);
  return { url };
}

// Public — lu par app.js ET admin.js dès le chargement de la page, avant même une
// éventuelle connexion, pour appliquer le thème (couleur/photo de fond, logo
// personnalisés) sans délai visible.
export function getTheme() {
  return {
    status: 200,
    data: {
      theme: getSetting(SETTING_KEY, DEFAULT_THEME),
      bgColor: getSetting(BG_SETTING_KEY, ''), // '' = pas de surcharge, on garde le fond du thème
      bgImage: getSetting(BG_IMAGE_SETTING_KEY, ''), // '' = pas de photo de fond personnalisée
      logo: getSetting(LOGO_SETTING_KEY, '') // '' = logo.png par défaut (fichier livré avec l'app)
    }
  };
}

export function setTheme(body) {
  const theme = body?.theme;
  if (!THEME_KEYS.includes(theme)) {
    return { status: 400, data: { error: 'Thème invalide' } };
  }
  setSetting(SETTING_KEY, theme);
  return { status: 200, data: { message: 'Thème mis à jour.', theme } };
}

// Couleur de fond personnalisée, indépendante du thème saisonnier — un admin peut la
// définir en plus de n'importe quel thème actif (ex: garder le décor de Noël mais avec
// un fond différent). Un body vide/absent ({} ou {bgColor:''}) efface la surcharge et
// revient au fond par défaut du thème actif.
export function setBgColor(body) {
  const bgColor = body?.bgColor ?? '';
  if (bgColor !== '' && !HEX_COLOR_RE.test(bgColor)) {
    return { status: 400, data: { error: 'Couleur invalide — utilisez un format hexadécimal du type #0b1220' } };
  }
  setSetting(BG_SETTING_KEY, bgColor);
  return {
    status: 200,
    data: { message: bgColor ? 'Couleur de fond mise à jour.' : 'Couleur de fond réinitialisée (fond du thème par défaut).', bgColor }
  };
}

// Photo de fond personnalisée, indépendante du thème et de la couleur de fond — un admin
// peut l'ajouter en plus de n'importe quel thème actif. Un body vide/absent
// ({} ou {imageDataUrl:''}) retire la photo actuelle et revient au filigrane par défaut.
export function setBgImage(body) {
  const result = saveUploadedImage(body?.imageDataUrl ?? '', {
    settingKey: BG_IMAGE_SETTING_KEY,
    filenamePrefix: 'bg-custom',
    maxBytes: 3 * 1024 * 1024 // 3 Mo décodés — voir aussi MAX_JSON_BODY_BYTES dans utils.js
  });
  if (result.error) return { status: result.status, data: { error: result.error } };
  return {
    status: 200,
    data: { message: result.url ? 'Photo de fond mise à jour.' : 'Photo de fond retirée.', bgImage: result.url }
  };
}

// Logo affiché dans la barre du haut (joueur, agent, admin) et sur l'écran de connexion —
// remplace frontend/logo.png sans avoir à redéployer. Format recommandé : bandeau large
// et bas (environ 20:2, soit un ratio 10:1), comme le wordmark fourni par défaut — non
// strictement imposé (le CSS .topbar-logo/.auth-logo-img redimensionne raisonnablement
// n'importe quel ratio), juste indiqué à titre de recommandation dans l'interface admin.
// Un body vide/absent ({} ou {imageDataUrl:''}) retire le logo personnalisé et revient au
// fichier frontend/logo.png livré avec l'app.
export function setLogo(body) {
  const result = saveUploadedImage(body?.imageDataUrl ?? '', {
    settingKey: LOGO_SETTING_KEY,
    filenamePrefix: 'logo-custom',
    maxBytes: 2 * 1024 * 1024 // 2 Mo décodés — un logo est un graphique simple, pas une photo
  });
  if (result.error) return { status: result.status, data: { error: result.error } };
  return {
    status: 200,
    data: { message: result.url ? 'Logo mis à jour.' : 'Logo réinitialisé (retour au logo par défaut).', logo: result.url }
  };
}
