# Konkou 🇭🇹 — Jeux d'habileté avec récompenses

Konkou est une application mobile (PWA) où les utilisateurs jouent à des jeux d'habileté (quiz de culture générale, sprint de calcul mental), gagnent des points selon leurs performances, grimpent au classement, et peuvent demander à encaisser leurs points en gourdes (HTG) sous forme de retrait cash à un point de retrait, via un code généré dans l'app.

**Important sur le modèle choisi :** à l'origine, Konkou n'était pas une application de paris — les gains dépendaient uniquement de la performance du joueur, jamais d'une mise d'argent, un modèle proche d'apps comme Mistplay ou Swagbucks, délibérément pensé pour éviter le besoin d'une licence de jeu d'argent réel.

**⚠️ Ce n'est plus entièrement vrai depuis l'ajout de la mise optionnelle (voir "Mise sur sa performance" plus bas).** Un joueur peut désormais engager entre 100 et 2500 de ses points avant une partie, et repartir avec jusqu'à 30% de plus ou 30% de moins selon son score — ces points ayant une valeur HTG réelle et retirable, c'est fonctionnellement un pari sur sa propre performance. **Ce n'est pas un avis juridique** : avant de lancer cette fonctionnalité auprès de vrais joueurs avec de l'argent réel, faites vérifier par un avocat en Haïti si ça change la qualification légale de l'app (licence de jeu d'argent, jeu d'habileté réglementé, etc.) — voir l'avertissement détaillé dans la section dédiée.

## Stack technique

Zéro dépendance externe à installer — tout fonctionne avec les modules natifs de Node.js et du navigateur :

- **Backend** : Node.js (`node:http`, `node:sqlite`, `node:crypto`) — API REST + base de données SQLite embarquée.
- **Frontend** : HTML/CSS/JavaScript vanilla, structuré comme une PWA (Progressive Web App) installable sur téléphone Android/iOS via "Ajouter à l'écran d'accueil", sans passer par un app store.

Ce choix zéro-dépendance permet de lancer l'app immédiatement avec juste Node.js installé (v22.5+), sans `npm install` ni configuration de build.

## Démarrage rapide

```bash
cd backend
node server.js
```

Ouvrez ensuite `http://localhost:4000` dans votre navigateur (ou sur le téléphone connecté au même réseau, en remplaçant `localhost` par l'IP de la machine). Le serveur sert à la fois l'API (`/api/...`) et l'interface (le frontend), donc une seule commande suffit.

Sur mobile, ouvrez l'URL dans Chrome puis choisissez "Ajouter à l'écran d'accueil" pour l'installer comme une vraie app.

### Configuration (`backend/.env`)

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port du serveur | 4000 |
| `JWT_SECRET` | Clé de signature des sessions — **à changer en production** | valeur de dev |
| `POINTS_TO_HTG_RATE` | Taux de conversion 1 point → HTG | 0.08 |
| `OPERATOR_WHATSAPP_NUMBER` | Numéro WhatsApp de l'opérateur qui reçoit les messages de confirmation (E.164 **sans** le `+`, ex. `50937123456`) — **obligatoire**, voir section dédiée ci-dessous | *(à définir)* |
| `MIN_CASHOUT_HTG` | Montant minimum (en HTG) pour demander un retrait | 500 |
| `MAX_DAILY_CASHOUT_HTG` | Plafond de retrait par joueur et par jour (en HTG) | 10000 |
| `PICKUP_LOCATION_INFO` | Texte affiché au joueur expliquant où/comment récupérer son argent en espèces | phrase générique |
| `CASHOUT_FEE_TIER1_MAX_HTG` / `CASHOUT_FEE_TIER1_PERCENT` | Plafond et taux du 1er palier de frais de retrait | 2000 / 5 |
| `CASHOUT_FEE_TIER2_MAX_HTG` / `CASHOUT_FEE_TIER2_PERCENT` | Plafond et taux du 2e palier de frais de retrait | 5000 / 6 |
| `CASHOUT_FEE_TIER3_PERCENT` | Taux du 3e palier (au-delà de `CASHOUT_FEE_TIER2_MAX_HTG`, jusqu'à `MAX_DAILY_CASHOUT_HTG`) | 8 |
| `MIN_DEPOSIT_HTG` / `MAX_DEPOSIT_HTG` | Bornes d'un dépôt chez l'agent (achat de parties bonus) | 100 / 2500 |
| `HTG_PER_BONUS_PLAY` | Combien de HTG déposés donnent 1 partie bonus | 50 |
| `DEPOSIT_LOCATION_INFO` | Texte affiché au joueur expliquant comment finaliser un dépôt chez l'agent | phrase générique |
| `AGENT_CAPITAL_HTG` | Capital que doit déposer un candidat agent pour être activé | 7500 |
| `AGENT_CAPITAL_FEE_PERCENT` | Part de ce capital gardée par Konkou (le reste devient le crédit de l'agent) | 10 |
| `AGENT_CASHOUT_COMMISSION_PERCENT` | Commission qu'un agent gagne sur chaque retrait qu'il paie | 10 |
| `AGENT_REFILL_GROWTH_PERCENT` | Plafond d'un renflouement de capital agent, en % du dépôt précédent | 25 |
| `AGENT_REFILL_FEE_PERCENT` | Part d'un renflouement gardée par Konkou (le reste devient du crédit revendable) | 7 |
| `AGENT_REFILL_MIN_HTG` | Montant minimum d'une demande de renflouement | 100 |
| `ADMIN_PASSWORD` | Mot de passe pour accéder à `/admin.html` (retraits, vérifications, dépôts, candidatures agent, renflouements, revenus) — **à changer avant tout usage réel** | valeur de dev |

## Fonctionnalités incluses

- Inscription/connexion par numéro de téléphone, mot de passe (hashé avec scrypt), session par jeton signé (type JWT).
- **Confirmation par WhatsApp** (inscription + mot de passe oublié) : voir section dédiée ci-dessous — remplace l'envoi de SMS tant qu'aucun fournisseur SMS n'est branché.
- Bonus de bienvenue : 100 points à l'inscription.
- Deux jeux d'habileté : quiz de culture générale (5 questions/partie, tirées d'une banque de 100 — géographie, histoire, sciences, sport, arts, mathématiques, avec une dizaine de questions sur Haïti) et sprint de calcul mental (8 opérations/partie), limités à 30 parties gratuites/jour chacun — au-delà, un joueur peut continuer en utilisant une **partie bonus** (voir "Dépôts" ci-dessous).
- **Mise optionnelle avant de jouer** : le joueur peut engager entre 100 et 2500 de ses points (dans la limite de son solde) avant une partie — voir "Mise sur sa performance" ci-dessous pour le fonctionnement exact et l'avertissement légal associé.
- Portefeuille : solde de points, valeur estimée en HTG, historique des transactions.
- **Retrait cash par code, avec limites et frais de service par palier** : le joueur demande un retrait (minimum `MIN_CASHOUT_HTG`, plafond `MAX_DAILY_CASHOUT_HTG` par jour), l'app génère un code unique à présenter à un point de retrait physique pour recevoir l'argent en espèces. Un frais de service — 5% jusqu'à 2000 HTG, 6% de 2001 à 5000 HTG, 8% au-delà — est prélevé sur le montant demandé et gardé par Konkou ; le joueur voit clairement le montant brut, le frais et le net à recevoir avant de confirmer. Ce frais est distinct de la commission de l'agent (voir "Réseau d'agents"), qui reste calculée sur le montant brut. Aucun intermédiaire financier requis.
- **Dépôt chez l'agent pour des parties bonus** : le joueur peut déposer entre `MIN_DEPOSIT_HTG` et `MAX_DEPOSIT_HTG` (autant de fois qu'il veut) pour acheter des parties bonus (`HTG_PER_BONUS_PLAY` HTG = 1 partie). **Achat à sens unique** : cet argent n'est jamais reconvertible en points retirables, il sert uniquement à débloquer des parties au-delà de la limite gratuite — voir "Pourquoi les dépôts ne sont pas retirables" ci-dessous.
- **Réseau d'agents, avec renflouement de capital** : inscription agent séparée de l'inscription joueur, sans aucun accès aux fonctionnalités joueur (voir section dédiée ci-dessous). Un agent revend des parties bonus et paie les retraits des autres joueurs, en échange d'une commission — les dépôts et retraits demandent désormais le code d'un agent actif. Un agent actif peut aussi demander un renflouement de capital (jusqu'à 25% de plus que son dernier dépôt, avec 7% de frais retenus par Konkou) pour augmenter progressivement son crédit revendable.
- **Interface centrale** (`/admin.html`, protégée par `ADMIN_PASSWORD`), en huit onglets :
  - *Retraits* : payer/rejeter les demandes de retrait cash (override de secours — voir "Réseau d'agents").
  - *Vérifications* : confirmer **ou refuser** les inscriptions/réinitialisations reçues par WhatsApp — deux sous-onglets, "Inscriptions" (nouveaux comptes) et "Réinitialisations" (mots de passe oubliés), voir "Confirmation par WhatsApp" plus bas.
  - *Dépôts* : confirmer/rejeter les dépôts (override de secours).
  - *Agents* : approuver/rejeter les candidatures agent (identité + numéro de pièce + réception du capital de 7500 HTG).
  - *Renflouements* : confirmer/rejeter les demandes de renflouement de capital agent.
  - *Revenus* : tableau de bord du revenu total de la plateforme, détaillé par source (frais de capital agent, frais de renflouement, frais de service sur les retraits).
  - *Comptes* : rechercher un compte (agent ou joueur) par numéro de téléphone et le supprimer définitivement — voir "Suppression de compte" ci-dessous.
  - *Réglages* : définir/modifier le numéro WhatsApp qui reçoit les messages de "Nous contacter", et choisir le thème saisonnier de l'app — voir "Thème saisonnier de l'app" ci-dessous.
- **Mot de passe visible à la demande** : un bouton "œil" sur tous les champs mot de passe (connexion, inscription, mot de passe oublié, suppression de compte, connexion admin) permet de basculer entre masqué et affiché en clair, pour éviter les erreurs de frappe.
- **"Nous contacter"** : formulaire ouvert à tous (joueurs, agents, partenaires potentiels), accessible avant même de se connecter (lien sous le formulaire de connexion) et depuis l'onglet Profil une fois connecté. Nom et prénom, numéro WhatsApp, message (500 caractères max) — "Envoyer" ouvre WhatsApp avec le message déjà rempli, prêt à envoyer vers le numéro que l'admin a configuré dans l'onglet *Réglages*. Comme pour la confirmation d'inscription, rien n'est envoyé automatiquement depuis le serveur : c'est le visiteur qui appuie sur "Envoyer" dans sa propre app WhatsApp.
- **Suppression de compte, par le joueur ou par l'admin** : un joueur peut supprimer son propre compte depuis l'onglet Profil (mot de passe requis en confirmation) ; un admin peut supprimer n'importe quel compte (joueur ou agent) depuis l'onglet *Comptes*. Un solde de points ne bloque pas la suppression — il est simplement perdu, avec avertissement explicite avant confirmation. La suppression reste bloquée par un retrait ou un dépôt en attente, ou un rôle agent actif — voir "Suppression de compte" ci-dessous pour le détail.
- Classement quotidien / hebdomadaire / général.
- Système de parrainage : code unique par utilisateur, 50 points offerts au parrain à chaque inscription filleul.
- **Logo** : le wordmark fourni par l'utilisateur (`frontend/logo.png`) remplace le texte "🇭🇹 Konkou" dans la barre du haut et l'écran de connexion/création de compte, côté joueur comme côté admin. Une version très atténuée du même logo (`frontend/logo-watermark.png`, ~9% d'opacité) est aussi affichée en filigrane, fixe au centre de l'écran, sur `<body>` — donc visible en fond sur tout l'écran (connexion, jeux, portefeuille, agent, admin) sans gêner la lecture, puisque les cartes de contenu (fond plein) passent par-dessus. L'icône PWA carrée (`frontend/icon.svg`, badge bleu/rouge avec "K") est conservée telle quelle pour l'écran d'accueil du téléphone, le wordmark n'étant pas au bon format (large et bas) pour une icône carrée.
- **Thème saisonnier de l'app, contrôlé par l'admin** : 6 thèmes disponibles (Défaut, Noël, Nouvel An, Été, Pâques, Fèt Gede) changeant à la fois les couleurs de l'app et une décoration animée (flocons, confettis, etc.) — voir "Thème saisonnier de l'app" ci-dessous.
- **Nombre de parties restantes affiché en jeu** : l'écran de quiz et de sprint de calcul affiche désormais "🎮 Parties gratuites restantes aujourd'hui : N" pendant la partie, à partir de la même valeur déjà calculée côté serveur (`remainingPlaysToday`).

Toutes ces fonctionnalités ont été testées de bout en bout (inscription, jeu, gain de points, retrait avec plafond quotidien, dépôt et parties bonus, parrainage, confirmation WhatsApp, réinitialisation de mot de passe, candidature agent avec vérification d'âge et génération de code, approbation agent créditant le bon montant, dépôt/retrait routés vers un agent précis, crédit insuffisant refusé, rejets d'authentification invalide, reprise d'une inscription abandonnée sur le même numéro).

## Mettre à jour la banque de questions

`backend/data/questions.json` contient 100 questions (une dizaine sur Haïti, le reste en culture générale mondiale : géographie, histoire, sciences, sport, arts, mathématiques). C'est un simple fichier JSON, rechargé à chaque démarrage du serveur — pour le renouveler :

1. Éditez `backend/data/questions.json` directement (ajoutez, retirez ou remplacez des entrées). Chaque question suit ce format :
   ```json
   { "id": 101, "question": "...", "choices": ["...", "...", "...", "..."], "answer": 0 }
   ```
   `answer` est l'index (0 à 3) de la bonne réponse dans `choices`. Les `id` doivent rester uniques.
2. Redémarrez le serveur (`node server.js`) pour que les changements prennent effet — ou lancez-le avec `node --watch server.js` en développement pour un rechargement automatique.

Chaque partie de quiz tire 5 questions au hasard dans tout le fichier, donc plus la banque est grande, moins un joueur assidu revoit les mêmes questions.

## Mise sur sa performance

Avant de lancer une partie (quiz ou sprint), un joueur peut optionnellement miser un nombre de points entre `STAKE_MIN` (100) et `STAKE_MAX` (2500), plafonné par son solde actuel — l'app refuse toute mise qu'il n'a pas les moyens de couvrir. S'il ne mise rien, tout se comporte exactement comme avant.

**Comment le résultat est calculé** : à la fin de la partie, le ratio de bonnes réponses (`bonnes réponses / total`) détermine un multiplicateur continu appliqué à la mise, sans seuil de réussite/échec net :

```
multiplicateur = 0,7 + 0,6 × ratio
```

- Score de 0% → multiplicateur 0,7 → la mise perd 30%.
- Score de 50% → multiplicateur 1,0 → la mise revient inchangée.
- Score de 100% → multiplicateur 1,3 → la mise gagne 30%.

Ce résultat de mise est **entièrement séparé** des points normaux gagnés par bonne réponse (10 pts/question au quiz, 6 pts/calcul au sprint), qui restent inchangés avec ou sans mise — la mise est un mécanisme additionnel, pas un remplacement. Le solde ne peut jamais descendre sous zéro (garde-fou appliqué côté serveur), et une partie abandonnée sans être soumise n'a aucun effet sur la mise (rien n'est débité tant que la partie n'est pas notée).

### ⚠️ Avertissement légal

**Je ne suis pas juriste et ceci n'est pas un avis juridique.** Tout le reste de Konkou est conçu pour ne jamais mettre d'argent en jeu selon un résultat incertain — c'est ce qui permettait de le positionner comme une app de récompenses basée sur l'habileté plutôt qu'un jeu d'argent réel (voir "Important sur le modèle choisi" en haut de ce document). La mise change ça : les points ayant une valeur HTG réelle et retirable via le portefeuille, engager des points puis en perdre ou en gagner selon sa performance est fonctionnellement un pari sur soi-même — même si le résultat dépend de l'habileté et non du hasard.

Avant de proposer cette fonctionnalité à de vrais joueurs avec de l'argent réel, faites vérifier par un avocat en Haïti si :
- ça requiert une licence de jeu d'argent ou de jeu d'habileté réglementé ;
- ça change vos obligations déclaratives ou fiscales ;
- ça affecte votre couverture d'assurance ou votre responsabilité en cas de litige avec un joueur.

Ça a aussi une incidence directe sur toute future soumission sur l'App Store ou le Play Store (voir la discussion sur le sujet plus haut dans cette conversation) : les apps avec de l'argent réel en jeu selon un résultat de jeu d'habileté tombent généralement dans une catégorie de review plus stricte ("real money skill gaming"), avec restriction géographique obligatoire et parfois des exigences de licence supplémentaires.

## Réseau d'agents

**Un compte agent est totalement séparé d'un compte joueur.** Devenir agent ne se fait plus depuis le Profil d'un joueur existant : c'est une inscription à part entière, avec son propre lien "🧑‍💼 Vous êtes agent ? Inscrivez-vous ici" sur l'écran de connexion. Un numéro de téléphone est soit joueur, soit agent, jamais les deux — un numéro déjà enregistré et vérifié (dans un rôle ou dans l'autre) est refusé si on tente de le réinscrire dans l'autre rôle. Un compte agent :
- ne reçoit **aucun bonus de bienvenue** (0 point à la création, contre 100 pour un joueur) ;
- **n'a accès à aucune fonctionnalité joueur** : jeux, portefeuille, classement, dépôts, liste des agents (pour choisir un agent) et profil joueur lui renvoient tous une erreur 403, y compris en appelant l'API directement (pas seulement caché dans l'interface) ;
- après connexion, atterrit directement sur une interface dédiée (barre du haut + candidature/tableau de bord agent, sans les onglets Accueil/Classement/Portefeuille/Profil du joueur) — voir `app.js`, `state.isAgent` et `renderAgentShell()`.

Le parcours :

1. **Inscription** : téléphone, mot de passe, nom, prénom, date de naissance (l'app vérifie 18 ans ou plus), type de pièce d'identité (CIN, passeport ou permis) et son numéro — tout en une seule fois, sur l'écran d'inscription agent. Comme pour un joueur, une confirmation par WhatsApp est requise (`/admin.html` → *Vérifications* → *Inscriptions*, même file d'attente que les joueurs) avant que le compte soit utilisable. L'app génère un **code agent** à partir de 3 lettres du nom + 2 lettres du prénom (ex. Pierre Louis → `PIELO`) — un suffixe numérique est ajouté en cas de collision avec un code déjà pris.
2. **Dépôt du capital** : le candidat apporte `AGENT_CAPITAL_HTG` (7500 HTG par défaut) à votre bureau. Dans `/admin.html`, onglet *Agents*, vous vérifiez son identité et confirmez avoir reçu le capital en cliquant "Approuver" — l'app crédite alors automatiquement `100 - AGENT_CAPITAL_FEE_PERCENT` % de ce montant (6750 HTG par défaut) comme **crédit revendable** sur son compte agent ; le reste (10%) reste acquis à la plateforme.
3. **Vente de crédit** : un joueur qui veut acheter des parties bonus choisit un agent dans une liste déroulante (nom, code, numéro d'agent) sur le formulaire de dépôt — plus besoin de connaître/taper un code à l'avance. L'agent se connecte avec son propre numéro/mot de passe agent, atterrit directement sur son tableau de bord, et clique "✅ Confirmer" sur le dépôt correspondant — son crédit revendable diminue du montant, et le joueur reçoit ses parties bonus. Une confirmation est refusée si le crédit de l'agent est insuffisant.
4. **Paiement des retraits** : de la même façon, un joueur qui demande un retrait choisit un agent dans la même liste déroulante. Sur son tableau de bord, l'agent clique "✅ Payer" — il gagne alors `AGENT_CASHOUT_COMMISSION_PERCENT` % du montant **brut** demandé par le joueur (10% par défaut), affiché comme un compteur cumulatif. Le frais de service par palier (voir "Retrait cash" ci-dessus) est séparé : il est prélevé sur ce que le joueur reçoit, pas sur la base de calcul de la commission de l'agent. **Ce compteur est purement informatif pour l'instant** : aucun paiement automatique n'a lieu dans l'app, vous réglez cette commission à l'agent par vos propres moyens, périodiquement.
5. **Renflouement de capital** : depuis son tableau de bord, un agent actif peut demander à augmenter son crédit revendable au-delà du dépôt initial. Le plafond d'un renflouement est `AGENT_REFILL_GROWTH_PERCENT` % (25% par défaut) du montant de son *dernier* dépôt confirmé — un plafond qui grandit donc à chaque renflouement réussi, comme une ligne de crédit progressive. Konkou retient `AGENT_REFILL_FEE_PERCENT` % (7% par défaut) du montant déposé ; le reste est ajouté au crédit revendable une fois que vous confirmez la réception du dépôt dans `/admin.html` (onglet *Renflouements*), suivant exactement le même principe de remise en main propre + confirmation qu'un dépôt initial.

⚠️ **Comptes agent déjà créés avant ce changement** : si un compte qui a déjà joué (points, historique...) a été promu agent via l'ancien parcours (Profil → Espace Agent), il bascule automatiquement vers l'interface agent-only à sa prochaine connexion — ses éventuels points restent dans la base mais deviennent inaccessibles (portefeuille bloqué), puisqu'il ne peut plus se voir comme joueur. Si ce cas se présente avec un vrai compte, réglez son solde manuellement (ou via l'onglet *Comptes* de `/admin.html`) avant qu'il ne devienne agent, plutôt qu'après.

La liste déroulante (`GET /api/agents/list`) ne montre que les agents actifs (nom, code, numéro) — jamais leur crédit ni leurs commissions, qui restent privés. Si aucun agent n'est encore actif, les formulaires de dépôt/retrait affichent un message et se désactivent plutôt que d'accepter une demande impossible à traiter.

`/admin.html` garde la capacité de payer/rejeter n'importe quel retrait ou dépôt directement (utile en cas de litige ou d'agent injoignable), mais ce chemin ne touche pas au crédit ni à la commission d'un agent — c'est un override de secours, pas le fonctionnement normal.

## Comment Konkou génère du revenu

Le joueur, lui, gagne `POINTS_TO_HTG_RATE` HTG par point (0,08 HTG/pt par défaut — relevé depuis 0,05 pour rendre le jeu plus attractif). Konkou a trois sources de revenu récurrentes, toutes automatiquement additionnées dans `/admin.html` (onglet *Revenus*) :

1. **Frais de capital agent** : `AGENT_CAPITAL_FEE_PERCENT` % (10% par défaut) du capital initial de chaque nouvel agent — 750 HTG sur les 7500 HTG par défaut. Ponctuel par agent, à l'inscription.
2. **Frais de renflouement agent** : `AGENT_REFILL_FEE_PERCENT` % (7% par défaut) de chaque renflouement de capital qu'un agent demande ensuite — une source récurrente, puisqu'un agent actif peut renflouer régulièrement (voir "Réseau d'agents").
3. **Frais de service sur les retraits** : prélevé sur chaque retrait joueur, par palier — 5% jusqu'à 2000 HTG, 6% de 2001 à 5000 HTG, 8% au-delà (jusqu'au plafond quotidien de `MAX_DAILY_CASHOUT_HTG`). C'est la source la plus directement liée au volume de joueurs actifs : plus il y a de retraits, plus elle rapporte.

Ces trois frais sont indépendants de la commission de l'agent (`AGENT_CASHOUT_COMMISSION_PERCENT`, 10% par défaut) : celle-ci reste calculée sur le montant brut du retrait et va entièrement à l'agent, elle ne réduit pas le revenu de Konkou. Chaque montant de frais est figé au moment de la transaction (pas recalculé après coup), donc changer un taux dans `.env` n'affecte que les futures transactions — l'historique des revenus reste exact même après un changement de configuration.

D'autres leviers non encore implémentés (publicité entre les parties, packs de questions sponsorisés par des commerces locaux) restent listés dans "Ce qu'il reste à faire avant un vrai lancement commercial" ci-dessous.

## Confirmation par WhatsApp (inscription + mot de passe oublié)

Konkou n'a pas encore de réseau/fournisseur SMS en place, donc la confirmation d'un numéro se fait par un humain plutôt que par un automate :

1. Le joueur s'inscrit (ou demande une réinitialisation de mot de passe, en choisissant son nouveau mot de passe **dès cette étape**).
2. L'app affiche un bouton "Confirmer via WhatsApp" qui ouvre WhatsApp avec un message pré-rempli (numéro + code à 6 chiffres) adressé au numéro `OPERATOR_WHATSAPP_NUMBER`. Le joueur n'a qu'à appuyer sur envoyer.
3. Vous (l'opérateur) recevez ce message sur votre WhatsApp personnel/professionnel — **c'est ce qui prouve que le numéro est réel et joignable**, puisque WhatsApp affiche l'expéditeur réel de la conversation.
4. Dans `/admin.html`, onglet *Vérifications*, vous voyez la même demande (numéro + code) : vous cross-vérifiez que ça correspond au message reçu, puis cliquez "Confirmer".
5. L'app du joueur détecte automatiquement la confirmation (elle vérifie l'état toutes les 3 secondes) et le connecte — **aucune saisie de code requise côté joueur**.

Ce même onglet a deux sous-onglets — "Inscriptions" (`purpose=verify_phone`) pour les nouveaux comptes, "Réinitialisations" (`purpose=reset_password`) pour les mots de passe oubliés — parce que ce sont deux files d'attente séparées : un numéro peut avoir une demande d'inscription en attente et une demande de réinitialisation en attente en même temps (rare mais possible), et vous devez confirmer chacune indépendamment, avec le bon message WhatsApp reçu pour chacune.

Si le message attendu n'arrive jamais (numéro invalide, joueur qui abandonne) ou ne correspond pas à ce que vous voyez, cliquez **"❌ Refuser"** à côté de "Confirmer" plutôt que de laisser la demande traîner : elle disparaît de la liste, et le joueur voit "Cette demande n'est plus valide" avec un bouton pour relancer — son compte reste non vérifié (ou son mot de passe non modifié pour une réinitialisation refusée), rien n'est perdu de son côté.

Une demande expire après 10 minutes si elle n'est pas confirmée ; le joueur peut relancer avec le bouton "Relancer" dans l'app. **`OPERATOR_WHATSAPP_NUMBER` doit être configuré pour que ce parcours fonctionne** — sans lui, personne ne peut activer un compte ni réinitialiser un mot de passe.

Si vous branchez un jour un vrai fournisseur SMS, ce mécanisme peut être remplacé : la logique d'émission/validation des codes vit entièrement dans `backend/otp.js`, c'est le seul fichier à modifier en profondeur (`backend/sms.js`, déjà présent avec un exemple Twilio commenté, reste disponible pour ça).

## Suppression de compte

Deux façons de supprimer un compte (joueur ou agent), avec exactement les mêmes garde-fous dans les deux cas :

- **Le joueur lui-même** : Profil → "🗑️ Supprimer mon compte" → confirme avec son mot de passe.
- **L'admin** : `/admin.html`, onglet *Comptes* → recherche par numéro de téléphone → voit le solde, les parties bonus et le rôle agent éventuel du compte → "🗑️ Supprimer ce compte définitivement".

**Un solde de points ne bloque plus la suppression.** Si le compte a des points au moment de la suppression, ils sont simplement **perdus définitivement** — ni remboursés, ni transférables, ni convertibles en espèces après coup. L'app affiche un avertissement explicite avec le montant exact avant que le joueur (ou l'admin) ne confirme, et le message de confirmation final rappelle combien de points ont été perdus.

La suppression reste **refusée** si l'une de ces conditions est vraie (parce qu'elles impliquent, elles, un montant en espèces déjà engagé ailleurs — un code de retrait remis à un agent, un paiement en cours chez un agent, ou un crédit agent en circulation — pas seulement un solde de points internes à l'app) :
- un retrait est en attente sur ce compte ;
- un dépôt est en attente sur ce compte ;
- le compte a un rôle agent **actif** (crédit revendable et commissions en cours) — le rôle agent doit être clôturé séparément (hors app pour l'instant) avant de pouvoir supprimer le compte sous-jacent.

**Ce que la suppression fait concrètement** : le compte (`users`) et son éventuel rôle agent non-actif (`agents`, forcément `pending` ou `rejected` si la suppression a été autorisée) sont supprimés de la base, points compris. L'historique des transactions, parties jouées, retraits et dépôts déjà traités (payés/confirmés/rejetés) **n'est pas supprimé**, pour garder une trace comptable — il devient simplement orphelin (visible dans les données brutes, mais plus rattaché à un compte affiché dans l'app). C'est une suppression définitive côté application ; il n'y a pas de "corbeille" ni de récupération possible après coup.

**Le numéro de téléphone est immédiatement libéré** : rien n'empêche de créer un nouveau compte avec le même numéro juste après une suppression (le seul délai possible est le cooldown anti-spam habituel de 60 secondes avant de redemander un code WhatsApp, identique à celui de n'importe quelle inscription).

## Pourquoi les dépôts ne sont pas retirables

Un dépôt chez l'agent achète des parties bonus, jamais des points retirables — c'est un choix délibéré, pas une limitation technique. Si l'argent déposé pouvait ensuite ressortir en espèces (même indirectement, via des points gagnés en jouant avec cet argent), Konkou ressemblerait à un système de mise/pari plutôt qu'à une app de récompenses basée sur la performance, ce qui changerait sa qualification légale (voir "Important sur le modèle choisi" en haut de ce document) et l'exposerait à des règles bien plus strictes. Les deux circuits — points gagnés en jouant (retirables) et parties achetées (non retirables) — sont donc gardés strictement séparés dans la base de données (`points` vs `bonus_plays`, `cashouts` vs `deposits`).

## Comment fonctionne le retrait cash — et comment brancher NatCash/MonCash plus tard

Le système de paiement actuel ne dépend d'aucun opérateur mobile money ni d'aucune banque : le joueur demande un retrait dans l'app (`points → code`), reçoit un code à 8 caractères, et le présente en personne à un point de retrait pour recevoir l'argent en espèces. Vous (ou la personne qui gère le point de retrait) validez la demande sur `/admin.html` avec le mot de passe défini dans `ADMIN_PASSWORD` :

- **Payer** marque la demande comme réglée.
- **Rejeter** annule la demande et rembourse automatiquement les points au joueur (utile en cas de code invalide, fraude suspectée, etc.).

**Ce système a été conçu pour être extensible dès le départ** : la table `cashouts` a une colonne `method` (`cash_pickup` aujourd'hui) et une colonne générique `payout_info` (le code de retrait aujourd'hui, un numéro de téléphone demain). Si vos démarches NatCash ou MonCash aboutissent plus tard, il suffira de :
1. Ajouter `natcash`/`moncash` comme nouvelle valeur possible de `method` dans `backend/routes/wallet.js`.
2. Proposer un choix de méthode de retrait dans le formulaire (`frontend/app.js`), avec le champ numéro de téléphone pour ces méthodes-là.
3. Brancher l'API réelle de paiement à l'étape où l'admin clique "Payer" (au lieu de rester manuel).

Rien dans l'architecture actuelle n'a besoin d'être réécrit pour ça — le retrait cash et un futur retrait NatCash/MonCash peuvent même coexister comme deux options proposées au joueur.

## Thème saisonnier de l'app

Dans `/admin.html`, onglet *Réglages*, une carte "🎨 Thème de l'app" propose 6 options en tuiles cliquables, chacune avec un aperçu de ses couleurs :

- **Défaut** 🇭🇹 : les couleurs bleu/rouge habituelles de Konkou, sans décoration.
- **Noël** 🎄 : rouge/vert profond, décor de flocons de neige qui dérivent lentement de haut en bas de l'écran.
- **Nouvel An** 🎆 : noir/or, décor de confettis.
- **Été** ☀️ : bleu ciel/turquoise/orange, décor de petits soleils.
- **Pâques** 🐣 : violet/rose pastel, décor de fleurs.
- **Fèt Gede** 💜 : violet/noir/blanc — les couleurs traditionnelles de la fête haïtienne du 1er/2 novembre honorant les ancêtres dans la tradition vodou —, décor de bougies. Choisi plutôt qu'une imagerie plus littérale (crâne, etc.) pour rester dans un registre festif/culturel respectueux plutôt que caricatural ; n'hésitez pas à demander un ajustement si ce choix ne correspond pas à ce que vous aviez en tête.

Cliquer sur une tuile applique le thème **immédiatement pour tous les joueurs et agents**, dès leur prochain chargement de page (pas besoin de redéployer). Techniquement : la clé du thème choisi est stockée dans la même table `settings` que le numéro WhatsApp de contact ; `GET /api/theme` (public, lu par `app.js` et `admin.js` avant même une éventuelle connexion) renvoie cette clé, et chaque thème (couleurs + décor) est défini côté frontend uniquement, dans un objet `THEMES` dupliqué à l'identique dans `app.js` et `admin.js`. Les couleurs remplacent des variables CSS (`--blue`, `--blue-2`, `--red`, `--bg`, `--card`, `--card-2`) — le vert, le texte et le gris restent constants dans tous les thèmes pour garder une lisibilité identique (succès/erreur toujours reconnaissables). Le décor animé est un calque plein écran, non cliquable, peint derrière le contenu de l'app (visible seulement dans les espaces transparents entre les cartes), sur le même principe que le filigrane du logo.

Pour ajouter un nouveau thème plus tard : ajouter une entrée dans l'objet `THEMES` (`frontend/app.js` **et** `frontend/admin.js`, à garder synchronisés) et sa clé dans la liste `THEME_KEYS` de `backend/routes/theme.js` (validation côté serveur).

## Ce qu'il reste à faire avant un vrai lancement commercial

Cette application est un socle fonctionnel complet, pas un produit fini prêt pour de l'argent réel. Avant de la lancer publiquement avec de vrais retraits :

1. **Définir `OPERATOR_WHATSAPP_NUMBER`** et vous assurer qu'une personne surveille activement ce numéro — indispensable avant le lancement, sinon personne ne peut activer un compte ni réinitialiser un mot de passe.
2. **Changer `ADMIN_PASSWORD`** avant tout usage réel — la valeur par défaut est publique (elle est dans ce dépôt).
3. **Recruter et approuver vos premiers agents** (lien "Vous êtes agent ?" sur l'écran de connexion, puis onglet *Agents* de `/admin.html`) — sans agent actif, aucun joueur ne peut déposer ni retirer, puisque les deux exigent désormais un code agent valide.
4. **Conditions d'utilisation et politique de confidentialité**, notamment sur la collecte de numéros de téléphone, la gestion des retraits en espèces et le caractère non remboursable des dépôts.
5. **Anti-fraude** : les sessions de jeu et les codes de confirmation sont actuellement en mémoire ou en base locale (redémarrage du serveur = sessions actives perdues, et ne fonctionne pas si vous faites tourner plusieurs instances du serveur derrière un load-balancer) — à déplacer vers Redis pour un usage en production à plus grande échelle.
6. **HTTPS** en production (via un reverse proxy comme Nginx + certificat Let's Encrypt).
7. **Monétisation** pour financer les paiements aux joueurs : publicités entre les parties, packs de questions sponsorisés par des commerces locaux, dépôts pour parties bonus (déjà en place).
8. **Un vrai fournisseur SMS ou NatCash/MonCash en complément**, si les démarches aboutissent — la logique d'OTP (`backend/otp.js`) et de paiement (`method`/`payout_info` sur `cashouts`) est conçue pour accueillir ça sans réécriture.

### Limitations connues (non bloquantes, à garder en tête)

- Le sprint de calcul mental annonce une limite de 45 secondes côté serveur, mais rien ne l'impose encore côté interface ni côté serveur — un joueur peut actuellement prendre tout son temps. À corriger si la dimension "rapidité" est importante pour vous.
- La limite de "30 parties/jour" se réinitialise à minuit UTC, pas à minuit heure d'Haïti — concrètement le nouveau quota tombe en fin d'après-midi/soirée locale plutôt qu'à minuit. Facile à ajuster si vous voulez un vrai minuit local.
- **Corrigé (juillet 2026)** : le service worker (`frontend/sw.js`) servait l'app shell (`app.js`, `styles.css`...) en cache-first, ce qui figeait la version affichée pour toujours après la première visite — un joueur qui avait déjà ouvert l'app une fois ne voyait jamais les mises à jour, même après un redéploiement réussi. Passage en network-first (toujours la dernière version en ligne, le cache ne sert que hors-ligne) + changement du nom de cache (`konkou-shell-v2`) pour forcer une mise à jour immédiate chez les joueurs déjà visités.

## Revue de code (juillet 2026)

Une relecture complète du projet a été faite après la mise en place initiale. Deux problèmes réels ont été trouvés et corrigés :

- **Faille XSS stockée** : un nom d'utilisateur contenant du code HTML/JS (ex. à l'inscription) s'affichait sans échappement dans le classement et dans les notes de transaction d'un parrain — un utilisateur malveillant aurait pu exécuter du code dans le navigateur d'autres joueurs. Corrigé en échappant systématiquement tout texte fourni par un utilisateur avant affichage.
- **Plantages serveur (erreur 500) sur entrées invalides** : un jeton de session corrompu/trafiqué ou un corps de requête JSON malformé provoquaient une erreur serveur brute au lieu d'un message propre. Corrigé pour renvoyer des erreurs 401/400 normales.

Corrections mineures additionnelles : cohérence de la comparaison des réponses du quiz, gestion propre d'une double inscription simultanée avec le même numéro, nettoyage périodique des parties commencées puis jamais terminées (évite une fuite mémoire sur un serveur qui tourne longtemps), et correction de l'affichage de date d'inscription qui pouvait échouer sur Safari/iOS.

Tout le parcours (inscription, jeu, gains, retrait, parrainage, limites quotidiennes, rejets d'authentification) a été re-testé après ces corrections.

**Ajout vérification SMS + mot de passe oublié.** L'inscription exige désormais un code à 6 chiffres envoyé par SMS avant que le compte soit utilisable, et un utilisateur peut réinitialiser son mot de passe via un code SMS. Un bug a été trouvé et corrigé pendant les tests : un numéro qui s'inscrivait puis abandonnait avant d'entrer le code restait "réservé" indéfiniment (le compte existait en base, non vérifié), empêchant quiconque — y compris le vrai propriétaire en cas de faute de frappe — de réinscrire ce numéro. Corrigé : une nouvelle tentative d'inscription sur un numéro non encore vérifié reprend la main dessus (nouveau nom/mot de passe, nouveau code envoyé) plutôt que d'échouer.

**Remplacement du retrait NatCash par un retrait cash à code.** NatCash demandait des démarches encore en cours ; en attendant, le retrait se fait maintenant par un code généré dans l'app, à présenter à un point de retrait physique. Nouvelle interface `/admin.html` pour payer/rejeter les demandes. Le système reste conçu pour accueillir NatCash/MonCash en plus (ou à la place) du retrait cash dès que vous le souhaitez — voir "Comment fonctionne le retrait cash" plus haut.

**Réseau d'agents (juillet 2026).** Konkou passe d'un point de retrait/dépôt central unique à un réseau d'agents décentralisé :
- N'importe quel joueur peut candidater en agent dans l'app (Profil → Espace Agent) : identité + date de naissance (vérification 18 ans), pièce d'identité, génération d'un code agent (3 lettres du nom + 2 du prénom).
- Un capital de 7500 HTG est requis pour être activé — approuvé par vous dans `/admin.html` (onglet *Agents*), qui garde 10% et crédite le reste (6750 HTG) comme crédit revendable sur le compte agent.
- Les dépôts (parties bonus) et les retraits demandent maintenant le code d'un agent actif ; l'agent gère lui-même ses dépôts/retraits assignés depuis son propre "Espace Agent" dans l'app (pas besoin d'accès à `/admin.html`) — confirmer un dépôt débite son crédit, payer un retrait crédite sa commission (10%, compteur informatif réglé hors app).
- `/admin.html` garde une capacité de secours pour payer/rejeter n'importe quel retrait ou dépôt directement, sans passer par un agent (utile en cas de litige) — mais sans toucher au crédit/commission d'un agent dans ce cas.

Testé de bout en bout : candidature rejetée sous 18 ans, génération de code (avec gestion de collision en ajoutant un suffixe numérique), approbation créditant le bon montant (90% du capital), dépôt/retrait routés vers le bon agent, confirmation d'un dépôt refusée si le crédit de l'agent est insuffisant, un agent ne peut pas agir sur les demandes assignées à un autre agent.

**Confirmation WhatsApp, limites de retrait et dépôts pour parties bonus (juillet 2026).** Trois ajouts en parallèle :
- La vérification par SMS (jamais réellement branchée à un fournisseur) est remplacée par une confirmation WhatsApp semi-manuelle : voir "Confirmation par WhatsApp" plus haut. Le mot de passe oublié suit le même principe, avec le nouveau mot de passe saisi dès la demande plutôt qu'après le code.
- Le retrait cash a désormais un minimum et un plafond quotidien exprimés directement en HTG (`MIN_CASHOUT_HTG`, `MAX_DAILY_CASHOUT_HTG`) plutôt qu'en points bruts.
- Nouveau système de dépôt chez l'agent (`MIN_DEPOSIT_HTG`–`MAX_DEPOSIT_HTG`, `HTG_PER_BONUS_PLAY`) qui achète des parties bonus non retirables — voir "Pourquoi les dépôts ne sont pas retirables" plus haut pour le raisonnement légal derrière ce choix.
- `/admin.html` passe de deux à trois onglets (Retraits / Vérifications / Dépôts).

Testé de bout en bout via des scénarios curl couvrant : inscription → confirmation WhatsApp → connexion, mot de passe oublié → confirmation → connexion avec le nouveau mot de passe, retrait dans la limite / au-dessus du plafond quotidien / sous le minimum, dépôt dans les bornes / hors bornes, confirmation d'un dépôt créditant bien les parties bonus, une partie bonus qui débloque effectivement une partie au-delà de la limite gratuite et décrémente le solde, rejet d'un retrait (points remboursés) et rejet d'un dépôt (aucun remboursement nécessaire, rien n'avait été débité).

**Banque de questions élargie et diversifiée (juillet 2026).** La banque de questions du quiz passe de 20 questions (culture générale haïtienne uniquement) à 100 questions : une dizaine restent spécifiques à Haïti, le reste couvre la culture générale mondiale (géographie, histoire, sciences, sport, arts/littérature, inventions, mathématiques/logique). Format inchangé, toujours dans `backend/data/questions.json` — voir "Mettre à jour la banque de questions" plus haut. Validé programmatiquement (100 entrées, identifiants uniques, 4 choix par question, réponse valide) et testé par tirage aléatoire répété pour confirmer que les 100 questions sont bien piochées.

**Numérotation séquentielle des agents.** Chaque agent reçoit désormais un numéro séquentiel à 5 chiffres (`00001`, `00002`, ...) attribué à sa toute première candidature — affiché à côté de son code agent dans l'app et dans `/admin.html`. Une candidature rejetée puis resoumise garde son numéro d'origine plutôt que d'en recevoir un nouveau.

**Sélecteur d'agent sur les formulaires.** Les formulaires de dépôt et de retrait proposent désormais une liste déroulante des agents actifs (nom, code, numéro) plutôt que de demander au joueur de connaître/taper un code à l'avance — alimentée par `GET /api/agents/list`, qui ne révèle ni le crédit ni les commissions d'un agent.

**Refonte de la monétisation (juillet 2026).** Trois changements en parallèle, détaillés dans "Comment Konkou génère du revenu" plus haut :
- Frais de service par palier sur les retraits (5%/6%/8% selon le montant), entièrement pour Konkou, distinct de la commission de l'agent qui reste calculée sur le montant brut.
- Renflouement de capital agent : un agent actif peut augmenter son crédit revendable de jusqu'à 25% de plus que son dernier dépôt, avec 7% de frais retenus par Konkou — nouvelle source de revenu récurrente, en plus du frais unique à l'inscription.
- Taux de conversion point→HTG relevé de 0,05 à 0,08 HTG/point pour rendre le jeu plus attractif pour les joueurs.
- Nouvel onglet *Revenus* dans `/admin.html` : total et détail par source (frais de capital agent, frais de renflouement, frais de service sur les retraits), calculé dynamiquement à partir des transactions plutôt que par un compteur à part — évite tout risque de dérive entre le total affiché et les transactions réelles.

Testé de bout en bout via des scénarios curl couvrant : les trois paliers de frais de retrait (montants juste en dessous/au-dessus de chaque seuil), un renflouement dans la limite des 25% et un au-dessus (rejeté), le frais de 7% correctement calculé et le crédit correctement ajouté après confirmation admin, la commission de l'agent toujours calculée sur le montant brut du retrait (pas le net après frais), et le tableau de revenus reflétant exactement la somme des frais collectés sur les trois sources.

**Séparation complète des comptes agent (juillet 2026).** Un compte agent n'a plus aucun lien avec un compte joueur — voir "Réseau d'agents" plus haut pour le détail complet. En résumé : inscription agent déplacée du Profil joueur vers un lien dédié sur l'écran de connexion (téléphone + mot de passe + candidature en une seule fois, toujours avec confirmation WhatsApp) ; 0 point de bienvenue pour un compte agent ; toutes les routes joueur (jeux, portefeuille, classement, dépôts, liste des agents, profil) renvoient désormais une erreur 403 pour un compte agent, y compris en appelant l'API directement ; côté interface, un compte agent atterrit après connexion sur un shell entièrement séparé (sans les onglets du joueur). Testé de bout en bout : inscription agent créditée à 0 point, confirmation WhatsApp, connexion, et les 6 routes joueur (`profile`, `wallet`, `leaderboard`, `games/puzzle`, `deposits`, `agents/list`) confirmées à 403 pour ce compte.

**Œil mot de passe + formulaire "Nous contacter" (juillet 2026).** Bouton "œil" sur tous les champs mot de passe (connexion, inscription, mot de passe oublié, suppression de compte, connexion admin, inscription agent). Formulaire "Nous contacter" ouvert à tous (avant connexion et depuis Profil), qui ouvre WhatsApp avec un message pré-rempli vers un numéro configurable par l'admin dans un nouvel onglet *Réglages* (stocké en base, modifiable sans redéploiement).

**Limite quotidienne relevée à 30 parties/jeu (juillet 2026).** La limite de parties gratuites passe de 5 à 30 par jeu et par jour (donc jusqu'à 60 parties gratuites/jour au total entre les deux jeux), pour inciter davantage les joueurs à revenir jouer. Seul `DAILY_LIMIT` dans `backend/routes/games.js` a changé — toute la logique de décompte, d'utilisation des parties bonus et de réinitialisation quotidienne reste identique.

**Mise optionnelle sur sa performance (juillet 2026).** Un joueur peut désormais miser entre 100 et 2500 de ses points avant une partie, plafonné par son solde. Le résultat de la partie fait varier cette mise de manière continue entre -30% (score nul) et +30% (score parfait), sans seuil de réussite/échec net — voir "Mise sur sa performance" plus haut pour la formule exacte et **l'avertissement légal important** : contrairement au reste de l'app, ce mécanisme met réellement des points (donc de la valeur HTG retirable) en jeu selon un résultat, ce qui s'apparente à un pari sur sa propre performance. Testé de bout en bout : score parfait (+30% exact), score nul (-30% exact), score médian (mise inchangée), mise hors des bornes 100–2500 rejetée, mise supérieure au solde rejetée, absence de mise laissant le comportement strictement identique à avant (régression vérifiée), et garde-fou serveur empêchant le solde de devenir négatif.

**Refus de vérification WhatsApp + numéro de pièce d'identité obligatoire pour les agents (juillet 2026).** Deux ajouts indépendants :
- `/admin.html`, onglet Vérifications : un bouton "❌ Refuser" à côté de "Confirmer", pour les cas où le message WhatsApp attendu n'arrive jamais ou ne correspond pas. Techniquement, la demande est supprimée plutôt que marquée confirmée — le joueur, dont l'app vérifie l'état toutes les 3 secondes, voit alors l'écran "Cette demande n'est plus valide" déjà existant et peut relancer une nouvelle demande. Son compte reste non vérifié, rien n'est modifié côté mot de passe en cas de réinitialisation refusée.
- Candidature agent : le numéro de la pièce d'identité, auparavant optionnel, est désormais **obligatoire** (en plus du type de pièce déjà requis) — renforce la vérification d'identité avant l'activation d'un agent.

**Suppression de compte, joueur et admin (juillet 2026).** Nouveau bouton "Supprimer mon compte" (Profil, avec confirmation par mot de passe) et nouvel onglet *Comptes* dans `/admin.html` (recherche par téléphone, suppression admin). *Mise à jour depuis : un solde de points non nul ne bloque plus la suppression — voir l'entrée "Perte de points" ci-dessous.* Les deux chemins partagent les mêmes garde-fous restants — voir "Suppression de compte" plus haut : refusé si retrait/dépôt en attente, ou rôle agent actif. Testé de bout en bout : suppression bloquée dans chacun des cas de garde-fou, mauvais mot de passe rejeté côté joueur, suppression réussie une fois qu'aucune obligation n'est en attente, compte introuvable après suppression (login et recherche admin échouent tous les deux proprement).

**Perte de points à la suppression au lieu du blocage (juillet 2026).** Un solde de points non nul ne bloque plus la suppression de compte : les points sont désormais simplement perdus définitivement, avec un avertissement explicite (montant exact) affiché avant confirmation côté joueur comme côté admin, et rappelé dans le message de confirmation final. Le numéro de téléphone est libéré immédiatement après suppression (seul délai possible : le cooldown anti-spam habituel de 60 secondes avant un nouveau code WhatsApp). Testé de bout en bout via curl : compte avec 100 points supprimé avec succès, message confirmant "100 points ont été définitivement perdus", connexion impossible ensuite, ré-inscription possible sur le même numéro.

**Affichage du nombre de parties restantes en jeu (juillet 2026).** L'écran de partie en cours (quiz et sprint de calcul) affiche désormais "🎮 Parties gratuites restantes aujourd'hui : N", à partir de `remainingPlaysToday` — un champ déjà calculé et renvoyé par le serveur mais jusqu'ici jamais affiché côté interface.

**Thème saisonnier contrôlé par l'admin (juillet 2026).** Nouvelle carte "🎨 Thème de l'app" dans `/admin.html`, onglet *Réglages* — voir "Thème saisonnier de l'app" plus haut pour le détail des 6 thèmes disponibles et le fonctionnement technique. Testé de bout en bout via curl : `GET /api/theme` public renvoie `default` sur une base neuve, une clé de thème invalide est rejetée (400), une clé valide est acceptée (200) et persistée (relue correctement ensuite), et l'accès aux routes admin du thème est bien bloqué (401) sans jeton admin.

## Structure du projet

```
konkou-app/
├── backend/
│   ├── server.js          # serveur HTTP + routage API + fichiers statiques
│   ├── db.js               # schéma SQLite
│   ├── utils.js             # hash mots de passe, jetons de session, helpers HTTP
│   ├── otp.js                # génération/validation des codes à 6 chiffres + confirmation WhatsApp (inscription + reset)
│   ├── sms.js                # point d'intégration pour un futur fournisseur SMS réel (non branché actuellement)
│   ├── middleware/auth.js  # extraction de l'utilisateur (et de l'admin) depuis le jeton
│   ├── routes/              # auth, jeux, portefeuille, dépôts, agents, compte (suppression), classement, profil, admin (retraits/vérifications/dépôts/agents/renflouements/revenus/comptes)
│   └── data/questions.json # banque de 100 questions du quiz (voir "Mettre à jour la banque de questions")
└── frontend/
    ├── index.html, app.js, styles.css   # app joueur
    ├── admin.html, admin.js              # interface agent/gestionnaire (retraits, vérifications WhatsApp, dépôts, candidatures agent, renflouements, revenus)
    ├── manifest.json, sw.js, icon.svg   # config PWA (installable, mode hors-ligne partiel — voir note ci-dessous)
    ├── logo.png, logo-watermark.png       # wordmark (barre du haut / connexion) + version filigrane (fond d'écran)
```
