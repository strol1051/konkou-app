import { getSetting, setSetting } from '../settings.js';

const SETTING_KEY = 'app_theme';
const DEFAULT_THEME = 'default';

// La liste des couleurs/décorations de chaque thème vit uniquement côté frontend
// (app.js/admin.js) — le serveur ne fait que stocker/valider la clé choisie, pour éviter
// de dupliquer des valeurs de couleur des deux côtés. Garder cette liste synchronisée
// avec l'objet THEMES du frontend si un thème est ajouté/retiré.
const THEME_KEYS = ['default', 'noel', 'nouvel_an', 'ete', 'paques', 'gede'];

// Public — lu par app.js ET admin.js dès le chargement de la page, avant même une
// éventuelle connexion, pour appliquer le thème sans délai visible.
export function getTheme() {
  return { status: 200, data: { theme: getSetting(SETTING_KEY, DEFAULT_THEME) } };
}

export function setTheme(body) {
  const theme = body?.theme;
  if (!THEME_KEYS.includes(theme)) {
    return { status: 400, data: { error: 'Thème invalide' } };
  }
  setSetting(SETTING_KEY, theme);
  return { status: 200, data: { message: 'Thème mis à jour.', theme } };
}
