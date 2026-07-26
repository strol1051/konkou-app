import { getSetting, setSetting } from '../settings.js';

const SETTING_KEY = 'contact_whatsapp_number';
const MESSAGE_MAX_LEN = 500;

// Garde uniquement les chiffres, comme OPERATOR_WHATSAPP_NUMBER (format E.164 sans "+").
// Accepte que l'admin tape le numéro avec espaces/tirets/+ et le normalise.
function normalizeWhatsappNumber(raw) {
  return String(raw || '').replace(/[^0-9]/g, '');
}

function isValidWhatsappNumber(digits) {
  return digits.length >= 8 && digits.length <= 15;
}

// Formulaire "Nous contacter", ouvert à tous (partenaires ou joueurs, connectés ou non) —
// aucune authentification requise. Ne stocke rien côté serveur : construit simplement un
// lien wa.me pré-rempli vers le numéro que l'admin a configuré, sur le même principe que
// la confirmation WhatsApp de l'inscription (otp.js) — c'est l'utilisateur qui envoie
// lui-même le message depuis sa propre app WhatsApp.
export function submitContact(body) {
  const { fullName, whatsapp, message } = body || {};
  if (!fullName || !String(fullName).trim()) {
    return { status: 400, data: { error: 'Nom et prénom requis' } };
  }
  if (!whatsapp || !String(whatsapp).trim()) {
    return { status: 400, data: { error: 'Numéro WhatsApp requis' } };
  }
  if (!message || !String(message).trim()) {
    return { status: 400, data: { error: 'Message requis' } };
  }
  if (String(message).length > MESSAGE_MAX_LEN) {
    return { status: 400, data: { error: `Le message ne peut pas dépasser ${MESSAGE_MAX_LEN} caractères` } };
  }

  const target = getSetting(SETTING_KEY);
  if (!target) {
    return { status: 503, data: { error: "Le numéro de contact n'est pas encore configuré par l'administrateur." } };
  }

  const text = `Konkou — Nouveau message via "Nous contacter"\nNom : ${fullName}\nWhatsApp : ${whatsapp}\nMessage : ${message}`;
  const whatsappLink = `https://wa.me/${target}?text=${encodeURIComponent(text)}`;
  return { status: 200, data: { whatsappLink } };
}

// --- Réglages admin ---

export function getContactSettings() {
  return { status: 200, data: { whatsappNumber: getSetting(SETTING_KEY) } };
}

export function setContactWhatsapp(body) {
  const digits = normalizeWhatsappNumber(body?.whatsappNumber);
  if (!isValidWhatsappNumber(digits)) {
    return { status: 400, data: { error: 'Numéro WhatsApp invalide (8 à 15 chiffres, avec indicatif pays, ex: 50937123456)' } };
  }
  setSetting(SETTING_KEY, digits);
  return { status: 200, data: { message: 'Numéro de contact mis à jour.', whatsappNumber: digits } };
}
