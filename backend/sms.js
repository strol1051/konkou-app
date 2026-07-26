// Abstraction couche SMS. Par défaut ("console"), aucun SMS réel n'est envoyé : le message est
// simplement affiché dans les logs du serveur, et le code est renvoyé dans la réponse API pour
// permettre de tester tout le flux sans compte fournisseur SMS. C'est le seul endroit à modifier
// pour brancher un vrai fournisseur (Twilio, Vonage, un agrégateur local, etc.) — voir README.

export async function sendSms(phone, message) {
  const mode = process.env.SMS_MODE || 'console';

  if (mode === 'console') {
    console.log(`[SMS -> ${phone}] ${message}`);
    return { ok: true, devMode: true };
  }

  if (mode === 'twilio') {
    // Exemple d'intégration Twilio (nécessite un compte Twilio + un numéro capable d'envoyer
    // vers Haïti, voir https://www.twilio.com/en-us/guidelines/ht/sms).
    // Configurez TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER dans backend/.env,
    // puis décommentez le bloc ci-dessous (nécessite d'ajouter le SDK Twilio ou d'appeler
    // directement leur API REST avec fetch()).
    //
    // const sid = process.env.TWILIO_ACCOUNT_SID;
    // const token = process.env.TWILIO_AUTH_TOKEN;
    // const from = process.env.TWILIO_FROM_NUMBER;
    // const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    // const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    //   method: 'POST',
    //   headers: {
    //     Authorization: `Basic ${auth}`,
    //     'Content-Type': 'application/x-www-form-urlencoded'
    //   },
    //   body: new URLSearchParams({ To: phone, From: from, Body: message })
    // });
    // if (!res.ok) throw new Error('Échec envoi SMS Twilio');
    // return { ok: true };
    throw new Error('Mode SMS_MODE=twilio configuré mais intégration non activée — voir backend/sms.js');
  }

  throw new Error(`SMS_MODE inconnu: ${mode}`);
}
