import { getSetting, setSetting } from '../settings.js';
import { saveUploadedImage } from './theme.js';

// Panneau publicitaire (juillet 2026) : une image au format portrait (9:16, affichée en
// surimpression légèrement rétrécie par rapport à l'écran, voir .ad-overlay/.ad-panel
// dans styles.css) montrée une fois par session au joueur ET à l'agent, fermable via un
// bouton (x). Purement informative — pas de lien cliquable ni de suivi de clic, juste une
// image que l'admin peut remplacer à tout moment depuis /admin.html → Réglages, pour
// promouvoir un avantage de l'app (VIP, parrainage...) ou une entreprise tierce.
const AD_IMAGE_SETTING_KEY = 'app_ad_image';

// Public — lu par app.js dès le chargement de la page, avant même la connexion (l'image
// n'est affichée qu'une fois connecté, mais autant la récupérer tôt comme le thème/logo).
export function getAd() {
  return {
    status: 200,
    data: { adImage: getSetting(AD_IMAGE_SETTING_KEY, '') } // '' = aucun panneau à afficher
  };
}

// Un imageDataUrl vide retire le panneau actuel (plus rien à afficher tant qu'un nouveau
// n'est pas envoyé) — même logique que setLogo/setBgImage dans routes/theme.js.
export function setAd(body) {
  const result = saveUploadedImage(body?.imageDataUrl ?? '', {
    settingKey: AD_IMAGE_SETTING_KEY,
    filenamePrefix: 'ad-custom',
    maxBytes: 3 * 1024 * 1024 // 3 Mo décodés — même limite que la photo de fond
  });
  if (result.error) return { status: result.status, data: { error: result.error } };
  return {
    status: 200,
    data: { message: result.url ? 'Panneau publicitaire mis à jour.' : 'Panneau publicitaire retiré.', adImage: result.url }
  };
}
