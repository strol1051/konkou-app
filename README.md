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
| `CASHOUT_FEE_TIER1_MAX_HTG` / `CASHOUT_FEE_TIER1_PERCENT` | Plafond et taux du 1er palier de frais de retrait | 2000 / 12 |
| `CASHOUT_FEE_TIER2_MAX_HTG` / `CASHOUT_FEE_TIER2_PERCENT` | Plafond et taux du 2e palier de frais de retrait | 5000 / 14 |
| `CASHOUT_FEE_TIER3_PERCENT` | Taux du 3e palier (au-delà de `CASHOUT_FEE_TIER2_MAX_HTG`, jusqu'à `MAX_DAILY_CASHOUT_HTG`) | 16 |
| `MIN_DEPOSIT_HTG` / `MAX_DEPOSIT_HTG` | Bornes d'un dépôt chez l'agent (achat de parties bonus) | 100 / 2500 |
| `HTG_PER_BONUS_PLAY` | Combien de HTG déposés donnent 1 partie bonus | 50 |
| `DEPOSIT_LOCATION_INFO` | Texte affiché au joueur expliquant comment finaliser un dépôt chez l'agent | phrase générique |
| `DEPOSIT_FEE_PERCENT` | Frais de service prélevé sur chaque dépôt, avant de calculer les parties bonus accordées | 5 |
| `VIP_PRICE_HTG` | Prix en HTG d'un abonnement VIP (payé en espèces chez un agent) | 300 |
| `VIP_DURATION_DAYS` | Durée en jours d'un abonnement VIP | 30 |
| `VIP_EXTRA_DAILY_PLAYS` | Parties gratuites supplémentaires par jour et par jeu accordées à un VIP actif | 10 |
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
- Deux jeux d'habileté : quiz de culture générale (5 questions/partie, tirées d'une banque de 160 — géographie, histoire, sciences, sport, arts, mathématiques, avec une dizaine de questions sur Haïti et 60 questions saisonnières, voir "Questions saisonnières" plus bas) et sprint de calcul mental (8 opérations/partie), limités à 10 parties gratuites/jour chacun — au-delà, un joueur peut continuer en utilisant une **partie bonus** (voir "Dépôts" ci-dessous).
- **Mise optionnelle avant de jouer** : le joueur peut engager entre 100 et 2500 de ses points (dans la limite de son solde) avant une partie — voir "Mise sur sa performance" ci-dessous pour le fonctionnement exact et l'avertissement légal associé.
- Portefeuille : solde de points, valeur estimée en HTG, historique des transactions.
- **Retrait cash par code, avec limites et frais de service par palier** : le joueur demande un retrait (minimum `MIN_CASHOUT_HTG`, plafond `MAX_DAILY_CASHOUT_HTG` par jour), l'app génère un code unique à présenter à un point de retrait physique pour recevoir l'argent en espèces. Un frais de service — 12% jusqu'à 2000 HTG, 14% de 2001 à 5000 HTG, 16% au-delà — est prélevé sur le montant demandé et gardé par Konkou ; le joueur voit clairement le montant brut, le frais et le net à recevoir avant de confirmer. Ce frais est distinct de la commission de l'agent (voir "Réseau d'agents"), qui reste calculée sur le montant brut — voir "Comment Konkou génère du revenu" plus bas pour l'importance de garder ce frais au-dessus de la commission agent.
- **Dépôt chez l'agent pour des parties bonus, avec frais de service** : le joueur peut déposer entre `MIN_DEPOSIT_HTG` et `MAX_DEPOSIT_HTG` (autant de fois qu'il veut) pour acheter des parties bonus (`HTG_PER_BONUS_PLAY` HTG = 1 partie). Un frais de service de `DEPOSIT_FEE_PERCENT` % (5% par défaut) est prélevé sur le montant avant de calculer les parties accordées — le joueur voit clairement le montant versé, le frais et les parties bonus obtenues avant de confirmer. **Achat à sens unique** : cet argent n'est jamais reconvertible en points retirables, il sert uniquement à débloquer des parties au-delà de la limite gratuite — voir "Pourquoi les dépôts ne sont pas retirables" ci-dessous.
- **Abonnement VIP payant** : pour `VIP_PRICE_HTG` HTG (300 par défaut) payés en espèces chez un agent, comme un dépôt, un joueur devient VIP pendant `VIP_DURATION_DAYS` jours (30 par défaut) et gagne `VIP_EXTRA_DAILY_PLAYS` (10 par défaut) parties gratuites supplémentaires par jour et par jeu, en plus des parties bonus. Renouveler avant l'échéance prolonge la date d'expiration au lieu de la remettre à zéro — voir "Abonnement VIP" ci-dessous.
- **Réseau d'agents, avec renflouement de capital** : inscription agent séparée de l'inscription joueur, sans aucun accès aux fonctionnalités joueur (voir section dédiée ci-dessous). Un agent revend des parties bonus et paie les retraits des autres joueurs, en échange d'une commission — les dépôts et retraits demandent désormais le code d'un agent actif. Un agent actif peut aussi demander un renflouement de capital (jusqu'à 25% de plus que son dernier dépôt, avec 7% de frais retenus par Konkou) pour augmenter progressivement son crédit revendable.
- **Interface centrale** (`/admin.html`, protégée par `ADMIN_PASSWORD`), en neuf onglets :
  - *Retraits* : payer/rejeter les demandes de retrait cash (override de secours — voir "Réseau d'agents").
  - *Vérifications* : confirmer **ou refuser** les inscriptions/réinitialisations reçues par WhatsApp — deux sous-onglets, "Inscriptions" (nouveaux comptes) et "Réinitialisations" (mots de passe oubliés), voir "Confirmation par WhatsApp" plus bas.
  - *Dépôts* : confirmer/rejeter les dépôts (override de secours).
  - *VIP* : confirmer/rejeter les achats d'abonnement VIP (override de secours) — voir "Abonnement VIP" ci-dessous.
  - *Agents* : approuver/rejeter les candidatures agent (identité + numéro de pièce + réception du capital de 7500 HTG).
  - *Renflouements* : confirmer/rejeter les demandes de renflouement de capital agent.
  - *Revenus* : tableau de bord du revenu total de la plateforme, détaillé par source (frais de capital agent, frais de renflouement, frais de service sur les retraits, frais de service sur les dépôts, ventes VIP), avec un sélecteur pour n'afficher que les revenus d'un jour précis.
  - *Comptes* : rechercher un compte (agent ou joueur) par numéro de téléphone et le supprimer définitivement — voir "Suppression de compte" ci-dessous.
  - *Réglages* : définir/modifier le numéro WhatsApp qui reçoit les messages de "Nous contacter", choisir le thème saisonnier de l'app, personnaliser la couleur/photo de fond et le logo — voir "Thème saisonnier de l'app" ci-dessous.
- **Mot de passe visible à la demande** : un bouton "œil" sur tous les champs mot de passe (connexion, inscription, mot de passe oublié, suppression de compte, connexion admin) permet de basculer entre masqué et affiché en clair, pour éviter les erreurs de frappe.
- **"Nous contacter"** : formulaire ouvert à tous (joueurs, agents, partenaires potentiels), accessible avant même de se connecter (lien sous le formulaire de connexion) et depuis l'onglet Profil une fois connecté. Nom et prénom, numéro WhatsApp, message (500 caractères max) — "Envoyer" ouvre WhatsApp avec le message déjà rempli, prêt à envoyer vers le numéro que l'admin a configuré dans l'onglet *Réglages*. Comme pour la confirmation d'inscription, rien n'est envoyé automatiquement depuis le serveur : c'est le visiteur qui appuie sur "Envoyer" dans sa propre app WhatsApp.
- **Suppression de compte, par le joueur, par l'agent ou par l'admin** : un joueur ou un agent peut supprimer son propre compte (Profil ou Espace Agent, mot de passe requis en confirmation) ; un admin peut supprimer n'importe quel compte (joueur ou agent) depuis l'onglet *Comptes*. Un solde de points, un crédit agent ou des commissions non nuls ne bloquent pas la suppression — ils sont simplement perdus/à régler hors app, avec avertissement explicite avant confirmation. La suppression reste bloquée par un retrait/dépôt en attente (joueur), ou un dépôt/retrait/renflouement assigné en attente (agent) — voir "Suppression de compte" ci-dessous pour le détail.
- Classement quotidien / hebdomadaire / général.
- Système de parrainage : code unique par utilisateur, 50 points offerts au parrain à chaque inscription filleul.
- **Logo** : le wordmark fourni par l'utilisateur (`frontend/logo.png`) remplace le texte "🇭🇹 Konkou" dans la barre du haut et l'écran de connexion/création de compte, côté joueur comme côté admin — remplaçable à tout moment sans redéploiement depuis *Réglages*, voir "Thème saisonnier de l'app" ci-dessous. Une version très atténuée du même logo (`frontend/logo-watermark.png`, ~9% d'opacité) est aussi affichée en filigrane, fixe au centre de l'écran, sur `<body>` — donc visible en fond sur tout l'écran (connexion, jeux, portefeuille, agent, admin) sans gêner la lecture, puisque les cartes de contenu (fond plein) passent par-dessus. L'icône PWA carrée (`frontend/icon.png`, badge bleu/rouge aux couleurs du drapeau haïtien avec le wordmark redimensionné dans un cercle blanc central) est utilisée pour l'écran d'accueil du téléphone et l'onglet du navigateur — voir "Icône de l'app (favicon/écran d'accueil)" ci-dessous.
- **Thème saisonnier de l'app, contrôlé par l'admin** : 8 thèmes disponibles (Défaut, Noël, Nouvel An, Été, Pâques, Fèt Gede, Saint-Valentin, Rentrée des classes) changeant à la fois les couleurs de l'app, une décoration animée (flocons, confettis, cœurs, etc.) et, pour 6 d'entre eux, un mélange de questions de quiz sur le thème (voir "Questions saisonnières" ci-dessous), plus une couleur de fond et une photo de fond personnalisables indépendamment de ces thèmes — voir "Thème saisonnier de l'app" ci-dessous.
- **Nombre de parties restantes affiché en jeu** : l'écran de quiz et de sprint de calcul affiche désormais "🎮 Parties gratuites restantes aujourd'hui : N" pendant la partie, à partir de la même valeur déjà calculée côté serveur (`remainingPlaysToday`).

Toutes ces fonctionnalités ont été testées de bout en bout (inscription, jeu, gain de points, retrait avec plafond quotidien, dépôt et parties bonus, parrainage, confirmation WhatsApp, réinitialisation de mot de passe, candidature agent avec vérification d'âge et génération de code, approbation agent créditant le bon montant, dépôt/retrait routés vers un agent précis, crédit insuffisant refusé, rejets d'authentification invalide, reprise d'une inscription abandonnée sur le même numéro).

## Mettre à jour la banque de questions

`backend/data/questions.json` contient 160 questions : 100 questions générales (une dizaine sur Haïti, le reste en culture générale mondiale : géographie, histoire, sciences, sport, arts, mathématiques) + 60 questions saisonnières réparties en 6 thèmes de 10 questions chacun (Noël, Été, Pâques, Saint-Valentin, Nouvel An, Rentrée des classes — voir "Questions saisonnières" ci-dessous). C'est un simple fichier JSON, rechargé à chaque démarrage du serveur — pour le renouveler :

1. Éditez `backend/data/questions.json` directement (ajoutez, retirez ou remplacez des entrées). Chaque question suit ce format :
   ```json
   { "id": 201, "question": "...", "choices": ["...", "...", "...", "..."], "answer": 0 }
   ```
   `answer` est l'index (0 à 3) de la bonne réponse dans `choices`. Les `id` doivent rester uniques. Un champ `"theme"` optionnel (ex. `"theme": "noel"`) rend la question saisonnière — voir ci-dessous ; son absence en fait une question générale, toujours piochable.
2. Redémarrez le serveur (`node server.js`) pour que les changements prennent effet — ou lancez-le avec `node --watch server.js` en développement pour un rechargement automatique.

Chaque partie de quiz tire 5 questions au hasard dans le pool actif (voir ci-dessous), donc plus la banque est grande, moins un joueur assidu revoit les mêmes questions.

### Questions saisonnières

Une question peut être taguée avec un champ `"theme"` correspondant à une des clés de thème saisonnier de l'app (`noel`, `ete`, `paques`, `valentin`, `nouvel_an`, `rentree` — voir "Thème saisonnier de l'app" plus bas pour la liste complète des 8 thèmes ; `gede` et `default` n'ont pas encore de questions dédiées, rien n'empêche d'en ajouter de la même façon). Le pool de tirage d'une partie de quiz (`routes/games.js`, fonction `questionPool()`) est composé ainsi :

- **Toutes les questions générales** (sans champ `theme`) sont toujours piochables, quel que soit le thème actif.
- **Les questions saisonnières** ne rejoignent le pool que lorsque leur thème est le thème actif de l'app (celui choisi par vous dans `/admin.html` → *Réglages*).

Concrètement, si vous activez le thème "Noël" en décembre, les joueurs voient un mélange des 100 questions générales et des 10 questions de Noël — jamais les questions d'un autre thème (Pâques, Valentin...), et jamais uniquement les questions de Noël non plus : les questions saisonnières s'ajoutent au pool général, elles ne le remplacent pas. Dès que vous repassez sur le thème "Défaut" (ou un autre thème sans rapport), les questions de Noël redeviennent invisibles jusqu'à la prochaine fois. Comme les 100 questions générales, ce mécanisme ne demande aucune action ponctuelle de votre part au-delà du choix du thème déjà fait dans *Réglages* — pas de bouton ou de réglage séparé pour les questions.

## Mise sur sa performance

Avant de lancer une partie (quiz ou sprint), un joueur peut optionnellement miser un nombre de points entre `STAKE_MIN` (100) et `STAKE_MAX` (2500), plafonné par son solde actuel — l'app refuse toute mise qu'il n'a pas les moyens de couvrir. S'il ne mise rien, tout se comporte exactement comme avant.

**Comment le résultat est calculé** : à la fin de la partie, le ratio de bonnes réponses (`bonnes réponses / total`) détermine un multiplicateur continu appliqué à la mise, sans seuil de réussite/échec net :

```
multiplicateur = 0,85 + 0,3 × ratio
```

- Score de 0% → multiplicateur 0,85 → la mise perd 15%.
- Score de 50% → multiplicateur 1,0 → la mise revient inchangée.
- Score de 100% → multiplicateur 1,15 → la mise gagne 15%.

*(Fourchette resserrée en juillet 2026 — elle était de ±30% à l'origine ; voir "Comment Konkou génère du revenu" ci-dessous pour le raisonnement.)*

Ce résultat de mise est **entièrement séparé** des points normaux gagnés par bonne réponse (10 pts/question au quiz, 6 pts/calcul au sprint), qui restent inchangés avec ou sans mise — la mise est un mécanisme additionnel, pas un remplacement. Le solde ne peut jamais descendre sous zéro (garde-fou appliqué côté serveur), et une partie abandonnée sans être soumise n'a aucun effet sur la mise (rien n'est débité tant que la partie n'est pas notée).

### ⚠️ Avertissement légal

**Je ne suis pas juriste et ceci n'est pas un avis juridique.** Tout le reste de Konkou est conçu pour ne jamais mettre d'argent en jeu selon un résultat incertain — c'est ce qui permettait de le positionner comme une app de récompenses basée sur l'habileté plutôt qu'un jeu d'argent réel (voir "Important sur le modèle choisi" en haut de ce document). La mise change ça : les points ayant une valeur HTG réelle et retirable via le portefeuille, engager des points puis en perdre ou en gagner selon sa performance est fonctionnellement un pari sur soi-même — même si le résultat dépend de l'habileté et non du hasard.

Avant de proposer cette fonctionnalité à de vrais joueurs avec de l'argent réel, faites vérifier par un avocat en Haïti si :
- ça requiert une licence de jeu d'argent ou de jeu d'habileté réglementé ;
- ça change vos obligations déclaratives ou fiscales ;
- ça affecte votre couverture d'assurance ou votre responsabilité en cas de litige avec un joueur.

Ça a aussi une incidence directe sur toute future soumission sur l'App Store ou le Play Store (voir la discussion sur le sujet plus haut dans cette conversation) : les apps avec de l'argent réel en jeu selon un résultat de jeu d'habileté tombent généralement dans une catégorie de review plus stricte ("real money skill gaming"), avec restriction géographique obligatoire et parfois des exigences de licence supplémentaires.

## Limite de temps par partie

Chaque partie (quiz comme sprint de calcul) est chronométrée à **45 secondes**, avec un compte à rebours affiché en gros (44px, gras, sur fond assombri) pendant que le joueur joue — impossible à manquer, y compris sur petit écran. Les deux jeux partagent la même durée (`TRIVIA_TIME_LIMIT_SECONDS`, `PUZZLE_TIME_LIMIT_SECONDS` dans `backend/routes/games.js`), volontairement identique pour rester simple à comprendre plutôt que d'avoir une durée différente par jeu.

**Si le temps s'écoule, la partie est perdue.** Contrairement à un simple mauvais score (qui suit la formule continue ±15% habituelle — voir "Mise sur sa performance"), une partie qui expire est traitée comme une défaite nette : **0 point gagné**, quel que soit ce que le joueur avait déjà répondu correctement, et **une mise éventuelle perd 50% d'un coup** (au lieu de suivre la formule normale). L'objectif : laisser filer le temps ne doit jamais être une stratégie neutre ou avantageuse. Techniquement, la partie se soumet quand même automatiquement à l'expiration (avec les réponses déjà données, complétées par une valeur factice pour celles manquantes) — c'est cette soumission automatique qui déclenche la pénalité de défaite, pas une simple annulation silencieuse.

**Vérification côté serveur, pas seulement visuelle.** Le compte à rebours affiché n'aurait aucune valeur s'il pouvait être contourné en modifiant le navigateur (pause de l'onglet, appel direct à l'API après le délai affiché, etc.) — chaque session de jeu retient donc sa propre limite de temps et l'heure de son démarrage. Deux garde-fous serveur, indépendants du navigateur :
- Le serveur détermine **lui-même** si le temps annoncé (45s) est réellement dépassé avant d'appliquer la pénalité de défaite — un signal du client prétendant à tort qu'il y a eu expiration est ignoré si le serveur mesure que ce n'est pas le cas, pour ne jamais pénaliser un joueur à tort.
- Au-delà de `limite + 10 secondes` (marge de tolérance réseau), toute soumission est purement et simplement refusée (`Temps écoulé pour cette partie`), qu'elle prétende être une expiration ou non — ferme la porte à un client qui tenterait d'éviter la pénalité en soumettant très en retard sans le signaler.

Techniquement, le minuteur affiché ne redémarre jamais d'une question à l'autre : il est fixé une seule fois au tout début de la partie (`deadlineAt`) et le compte à rebours se recalcule toujours à partir de cette échéance fixe — répondre vite à une question ne rallonge donc jamais le temps restant sur les questions suivantes.

## Réseau d'agents

**Un compte agent est totalement séparé d'un compte joueur.** Devenir agent ne se fait plus depuis le Profil d'un joueur existant : c'est une inscription à part entière, avec son propre bouton "🧑‍💼 Devenir Agent" sur l'écran de connexion, juste après la carte Connexion/Créer un compte. Un numéro de téléphone est soit joueur, soit agent, jamais les deux — un numéro déjà enregistré et vérifié (dans un rôle ou dans l'autre) est refusé si on tente de le réinscrire dans l'autre rôle. Un compte agent :
- ne reçoit **aucun bonus de bienvenue** (0 point à la création, contre 100 pour un joueur) ;
- **n'a accès à aucune fonctionnalité joueur** : jeux, portefeuille, classement, dépôts, liste des agents (pour choisir un agent) et profil joueur lui renvoient tous une erreur 403, y compris en appelant l'API directement (pas seulement caché dans l'interface) ;
- après connexion, atterrit directement sur une interface dédiée (barre du haut + candidature/tableau de bord agent, sans les onglets Accueil/Classement/Portefeuille/Profil du joueur) — voir `app.js`, `state.isAgent` et `renderAgentShell()`.

Le parcours :

1. **Inscription** : téléphone, mot de passe, nom, prénom, date de naissance (l'app vérifie 18 ans ou plus), type de pièce d'identité (CIN, passeport ou permis) et son numéro, **ville et adresse** — tout en une seule fois, sur l'écran d'inscription agent (les deux champs sont obligatoires, même règle sur le formulaire "Devenir Agent" rempli depuis un compte joueur existant). Comme pour un joueur, une confirmation par WhatsApp est requise (`/admin.html` → *Vérifications* → *Inscriptions*, même file d'attente que les joueurs) avant que le compte soit utilisable. L'app génère un **code agent** à partir de 3 lettres du nom + 2 lettres du prénom (ex. Pierre Louis → `PIELO`) — un suffixe numérique est ajouté en cas de collision avec un code déjà pris. La ville et l'adresse sont ensuite affichées à l'admin (`/admin.html` → *Agents*) et, une fois le compte actif, dans les "Infos Agent" que voit le joueur lors d'une demande de dépôt/retrait (voir point 3).
2. **Dépôt du capital** : le candidat apporte `AGENT_CAPITAL_HTG` (7500 HTG par défaut) à votre bureau. Dans `/admin.html`, onglet *Agents*, vous vérifiez son identité et confirmez avoir reçu le capital en cliquant "Approuver" — l'app crédite alors automatiquement `100 - AGENT_CAPITAL_FEE_PERCENT` % de ce montant (6750 HTG par défaut) comme **crédit revendable** sur son compte agent ; le reste (10%) reste acquis à la plateforme.
3. **Vente de crédit** : un joueur qui veut acheter des parties bonus choisit un agent dans une liste déroulante (nom, code, numéro d'agent) sur le formulaire de dépôt — plus besoin de connaître/taper un code à l'avance. Dès qu'il sélectionne un agent, un encart "📍 Infos agent" apparaît sous la liste avec la ville et l'adresse enregistrées par cet agent, pour que le joueur sache clairement où il va effectuer sa transaction avant de valider sa demande (même encart sur le formulaire de retrait, voir point 4). L'agent se connecte avec son propre numéro/mot de passe agent, atterrit directement sur son tableau de bord, et clique "✅ Confirmer" sur le dépôt correspondant — son crédit revendable diminue du montant, et le joueur reçoit ses parties bonus. Une confirmation est refusée si le crédit de l'agent est insuffisant.
4. **Paiement des retraits** : de la même façon, un joueur qui demande un retrait choisit un agent dans la même liste déroulante (avec le même encart "Infos agent"). Sur son tableau de bord, l'agent clique "✅ Payer" — il gagne alors `AGENT_CASHOUT_COMMISSION_PERCENT` % du montant **brut** demandé par le joueur (10% par défaut). Le frais de service par palier (voir "Retrait cash" ci-dessus, 12/14/16%) est séparé : il est prélevé sur ce que le joueur reçoit, pas sur la base de calcul de la commission de l'agent — **le frais reste volontairement au-dessus de la commission agent à chaque palier**, pour que chaque retrait dégage une marge nette pour vous plutôt qu'une perte (voir "Comment Konkou génère du revenu" plus bas). **Ce compteur reste purement informatif** : aucun paiement automatique n'a lieu dans l'app, vous réglez cette commission à l'agent par vos propres moyens, périodiquement. Le tableau de bord de l'agent affiche désormais son nom complet, son numéro d'agent, son crédit revendable et une carte "💰 Commission sur retraits" avec un sélecteur de date (borné entre le jour d'activation de son compte et aujourd'hui) pour qu'il puisse vérifier ce qu'il a gagné un jour précis, en plus du total cumulé depuis toujours.
5. **Renflouement de capital** : depuis son tableau de bord, un agent actif peut demander à augmenter son crédit revendable au-delà du dépôt initial. Le plafond d'un renflouement est `AGENT_REFILL_GROWTH_PERCENT` % (25% par défaut) du montant de son *dernier* dépôt confirmé — un plafond qui grandit donc à chaque renflouement réussi, comme une ligne de crédit progressive. Konkou retient `AGENT_REFILL_FEE_PERCENT` % (7% par défaut) du montant déposé ; le reste est ajouté au crédit revendable une fois que vous confirmez la réception du dépôt dans `/admin.html` (onglet *Renflouements*), suivant exactement le même principe de remise en main propre + confirmation qu'un dépôt initial.

⚠️ **Comptes agent déjà créés avant ce changement** : si un compte qui a déjà joué (points, historique...) a été promu agent via l'ancien parcours (Profil → Espace Agent), il bascule automatiquement vers l'interface agent-only à sa prochaine connexion — ses éventuels points restent dans la base mais deviennent inaccessibles (portefeuille bloqué), puisqu'il ne peut plus se voir comme joueur. Si ce cas se présente avec un vrai compte, réglez son solde manuellement (ou via l'onglet *Comptes* de `/admin.html`) avant qu'il ne devienne agent, plutôt qu'après.

La liste déroulante (`GET /api/agents/list`) ne montre que les agents actifs (nom, code, numéro, ville, adresse) — jamais leur crédit ni leurs commissions, qui restent privés. Si aucun agent n'est encore actif, les formulaires de dépôt/retrait affichent un message et se désactivent plutôt que d'accepter une demande impossible à traiter.

`/admin.html` garde la capacité de payer/rejeter n'importe quel retrait ou dépôt directement (utile en cas de litige ou d'agent injoignable), mais ce chemin ne touche pas au crédit ni à la commission d'un agent — c'est un override de secours, pas le fonctionnement normal.

## Comment Konkou génère du revenu

Le joueur, lui, gagne `POINTS_TO_HTG_RATE` HTG par point (0,08 HTG/pt par défaut). Konkou a cinq sources de revenu récurrentes, toutes automatiquement additionnées dans `/admin.html` (onglet *Revenus*) :

1. **Frais de capital agent** : `AGENT_CAPITAL_FEE_PERCENT` % (10% par défaut) du capital initial de chaque nouvel agent — 750 HTG sur les 7500 HTG par défaut. Ponctuel par agent, à l'inscription.
2. **Frais de renflouement agent** : `AGENT_REFILL_FEE_PERCENT` % (7% par défaut) de chaque renflouement de capital qu'un agent demande ensuite — une source récurrente, puisqu'un agent actif peut renflouer régulièrement (voir "Réseau d'agents").
3. **Frais de service sur les retraits** : prélevé sur chaque retrait joueur, par palier — 12% jusqu'à 2000 HTG, 14% de 2001 à 5000 HTG, 16% au-delà (jusqu'au plafond quotidien de `MAX_DAILY_CASHOUT_HTG`). C'est la source la plus directement liée au volume de joueurs actifs : plus il y a de retraits, plus elle rapporte.
4. **Frais de service sur les dépôts** : `DEPOSIT_FEE_PERCENT` % (5% par défaut) prélevé sur chaque dépôt avant de calculer les parties bonus accordées — voir "Fonctionnalités incluses" plus haut.
5. **Ventes VIP** : contrairement aux quatre sources ci-dessus, qui ne sont qu'un pourcentage prélevé sur un montant, le montant **entier** d'un achat VIP (`VIP_PRICE_HTG`, 300 HTG par défaut) devient revenu de la plateforme une fois confirmé — voir "Abonnement VIP" ci-dessous pour le détail.

Chaque montant de frais est figé au moment de la transaction (pas recalculé après coup), donc changer un taux dans `.env` n'affecte que les futures transactions — l'historique des revenus reste exact même après un changement de configuration.

### ⚠️ Point de rentabilité corrigé (juillet 2026)

Une revue de rentabilité a révélé un problème structurel qui a depuis été corrigé, et qu'il faut comprendre pour ne pas le réintroduire par erreur en changeant les paramètres plus tard :

**Le frais de retrait doit toujours rester au-dessus de la commission agent (`AGENT_CASHOUT_COMMISSION_PERCENT`, 10% par défaut).** Ces deux pourcentages se calculent tous les deux sur le montant **brut** du même retrait, mais l'un est un revenu pour vous (le frais) et l'autre est un coût que vous payez à l'agent (la commission, réglée hors app). Avant cette correction, les paliers de frais (5/6/8%) étaient tous **inférieurs** à la commission (10%) — chaque retrait payé coûtait donc plus cher en commission qu'il ne rapportait en frais, une perte nette de 2 à 5% sur **chaque** retrait, qui s'aggravait avec le volume plutôt que de s'améliorer. Exemple concret sur un retrait de 1000 HTG brut, avant/après :

| | Avant (frais 5%) | Après (frais 12%) |
|---|---|---|
| Frais encaissé (votre revenu) | 50 HTG | 120 HTG |
| Commission due à l'agent (votre coût) | 100 HTG | 100 HTG |
| **Marge nette pour vous** | **-50 HTG** | **+20 HTG** |

Les nouveaux paliers (12/14/16%) dégagent une marge nette de 2 à 6 points au-dessus de la commission, à chaque tranche de montant.

**Ceci reste distinct du coût du jeu gratuit.** Même avec cette correction, chaque point gagné gratuitement (10 pts/bonne réponse au quiz, 6 pts/bonne réponse au sprint) représente une valeur en HTG que vous devrez éventuellement payer si le joueur la retire — ce n'est ni un revenu ni compensé automatiquement par les frais ci-dessus. Deux réglages limitent ce passif : la limite quotidienne de parties gratuites (`DAILY_LIMIT` dans `backend/routes/games.js`, 15/jour/jeu depuis juillet 2026, contre 30 auparavant) et la fourchette de la mise sur sa performance (±15% depuis juillet 2026, contre ±30% — voir "Mise sur sa performance" plus haut). Les trois revenus listés ci-dessus doivent, sur la durée, dépasser la somme de : ce passif de jeu gratuit + le coût net de la mise (qui reste, en moyenne, légèrement défavorable pour vous si les joueurs répondent correctement plus de la moitié du temps) + vos coûts d'exploitation (hébergement, temps passé à confirmer les WhatsApp, etc.).

**Revenus par jour.** En haut de l'onglet *Revenus*, un sélecteur de date permet de ne voir que les revenus collectés un jour précis plutôt que tout l'historique — la date la plus ancienne sélectionnable est celle du tout premier compte créé (joueur ou agent), affichée à côté du sélecteur. Techniquement : `GET /api/admin/revenue` accepte un paramètre `?date=YYYY-MM-DD` qui filtre chaque source de revenu sur la date de sa transaction (`approved_at` pour les frais de capital agent, `processed_at` pour les frais de renflouement et de retrait) ; sans paramètre, la réponse reste le total sur tout l'historique comme avant. Un bouton "Revenir à tout l'historique" efface le filtre.

D'autres leviers non encore implémentés (publicité entre les parties, packs de questions sponsorisés par des commerces locaux) restent listés dans "Ce qu'il reste à faire avant un vrai lancement commercial" ci-dessous — ce sont eux qui permettraient de vraiment financer le jeu gratuit plutôt que de simplement en limiter les dégâts.

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

Trois façons de supprimer un compte (joueur ou agent), avec exactement les mêmes garde-fous dans les trois cas :

- **Le joueur lui-même** : Profil → "🗑️ Supprimer mon compte" → confirme avec son mot de passe.
- **L'agent lui-même** : Espace Agent → "🗑️ Supprimer mon compte" (disponible que la candidature soit en attente, rejetée ou active) → confirme avec son mot de passe.
- **L'admin** : `/admin.html`, onglet *Comptes* → recherche par numéro de téléphone → voit le solde, les parties bonus et le rôle agent éventuel du compte (avec son crédit et ses commissions s'il est actif) → "🗑️ Supprimer ce compte définitivement".

**Un solde de points (joueur), un crédit revendable ou des commissions (agent) ne bloquent plus la suppression.** Ils sont simplement **perdus/à régler en dehors de l'app** — ni remboursés, ni transférés automatiquement. L'app affiche un avertissement explicite avec les montants exacts avant confirmation, et le message final les rappelle. Pour un agent, un rôle **actif** n'est plus non plus un motif de blocage en soi : supprimer le compte ferme le rôle du même coup (le crédit/les commissions restants sont à régler avec l'agent de façon informelle, comme le reste de sa comptabilité).

La suppression reste **refusée** si l'une de ces conditions est vraie (parce qu'elles impliquent, elles, un montant en espèces déjà engagé ailleurs, potentiellement dû à quelqu'un d'autre) :
- pour un **joueur** : un retrait ou un dépôt en attente sur son propre compte ;
- pour un **agent** : un dépôt, un retrait ou une demande de renflouement qui lui est **assigné** et encore en attente — réglez-le (confirmer/rejeter) depuis l'Espace Agent ou `/admin.html`, puis réessayez.

**Ce que la suppression fait concrètement** : le compte (`users`) et son éventuel rôle agent (`agents`, quel que soit son statut) sont supprimés de la base, points/crédit/commissions compris. L'historique des transactions, parties jouées, retraits et dépôts déjà traités (payés/confirmés/rejetés) **n'est pas supprimé**, pour garder une trace comptable — il devient simplement orphelin (visible dans les données brutes, mais plus rattaché à un compte affiché dans l'app). C'est une suppression définitive côté application ; il n'y a pas de "corbeille" ni de récupération possible après coup.

**Le numéro de téléphone est immédiatement libéré** : rien n'empêche de créer un nouveau compte avec le même numéro juste après une suppression (le seul délai possible est le cooldown anti-spam habituel de 60 secondes avant de redemander un code WhatsApp, identique à celui de n'importe quelle inscription).

## Pourquoi les dépôts ne sont pas retirables

Un dépôt chez l'agent achète des parties bonus, jamais des points retirables — c'est un choix délibéré, pas une limitation technique. Si l'argent déposé pouvait ensuite ressortir en espèces (même indirectement, via des points gagnés en jouant avec cet argent), Konkou ressemblerait à un système de mise/pari plutôt qu'à une app de récompenses basée sur la performance, ce qui changerait sa qualification légale (voir "Important sur le modèle choisi" en haut de ce document) et l'exposerait à des règles bien plus strictes. Les deux circuits — points gagnés en jouant (retirables) et parties achetées (non retirables) — sont donc gardés strictement séparés dans la base de données (`points` vs `bonus_plays`, `cashouts` vs `deposits`).

## Abonnement VIP

Depuis son Portefeuille, un joueur peut devenir VIP pour `VIP_PRICE_HTG` HTG (300 par défaut), payés en espèces chez un agent — exactement le même flux qu'un dépôt (code généré dans l'app, présenté avec le paiement, confirmé en personne par l'agent).

**Ce que ça donne** : `VIP_EXTRA_DAILY_PLAYS` (10 par défaut) parties gratuites supplémentaires par jour et par jeu, en plus de la limite gratuite normale (15/jour/jeu) et des parties bonus achetées par dépôt — les trois se cumulent. L'abonnement dure `VIP_DURATION_DAYS` jours (30 par défaut) ; le renouveler **avant** l'échéance prolonge la date d'expiration existante au lieu de la remettre à zéro (renouveler à 10 jours de la fin ajoute bien 30 jours pleins, pas 30 jours à partir d'aujourd'hui).

**Différence clé avec un dépôt** : un dépôt réduit le crédit revendable de l'agent (il "vend" une partie de son stock prépayé) ; un achat VIP n'y touche pas du tout — l'agent n'est ici qu'un point de collecte du paiement en espèces, à vous remettre intégralement en dehors de l'app, comme le reste de sa comptabilité (commissions, renflouements). Le montant complet d'un achat VIP confirmé est donc un revenu pur pour la plateforme (voir "Comment Konkou génère du revenu" plus haut), contrairement au frais de service sur les dépôts qui n'en représente qu'une fraction.

Le joueur voit son statut VIP (actif jusqu'à quelle date, ou pas encore VIP), un formulaire de souscription/renouvellement, et son historique d'achats dans le Portefeuille. Côté agent, une carte "👑 Achats VIP à confirmer" apparaît sur le tableau de bord, à côté des dépôts et retraits à traiter. `/admin.html` garde une capacité de secours (onglet *VIP*) pour confirmer/rejeter directement, sans toucher au crédit de l'agent, comme pour les dépôts et retraits.

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

Dans `/admin.html`, onglet *Réglages*, une carte "🎨 Thème de l'app" propose 8 options en tuiles cliquables, chacune avec un aperçu de ses couleurs :

- **Défaut** 🇭🇹 : les couleurs bleu/rouge habituelles de Konkou, sans décoration.
- **Noël** 🎄 : rouge/vert profond, décor de flocons de neige qui dérivent lentement de haut en bas de l'écran.
- **Nouvel An** 🎆 : noir/or, décor de confettis.
- **Été** ☀️ : bleu ciel/turquoise/orange, décor de petits soleils.
- **Pâques** 🐣 : violet/rose pastel, décor de fleurs.
- **Fèt Gede** 💜 : violet/noir/blanc — les couleurs traditionnelles de la fête haïtienne du 1er/2 novembre honorant les ancêtres dans la tradition vodou —, décor de bougies. Choisi plutôt qu'une imagerie plus littérale (crâne, etc.) pour rester dans un registre festif/culturel respectueux plutôt que caricatural ; n'hésitez pas à demander un ajustement si ce choix ne correspond pas à ce que vous aviez en tête.
- **Saint-Valentin** ❤️ : rouge/rose, décor de cœurs.
- **Rentrée des classes** 🎒 : vert tableau/jaune crayon, décor de crayons. Ajouté en même temps que les questions saisonnières (voir "Questions saisonnières" plus haut) pour couvrir la période de rentrée scolaire, qui n'avait pas encore de thème visuel dédié.

Cliquer sur une tuile applique le thème **immédiatement pour tous les joueurs et agents**, dès leur prochain chargement de page (pas besoin de redéployer) — et, depuis l'ajout des questions saisonnières, change aussi automatiquement le mélange de questions du quiz si des questions sont taguées pour ce thème (voir "Questions saisonnières" plus haut). Techniquement : la clé du thème choisi est stockée dans la même table `settings` que le numéro WhatsApp de contact ; `GET /api/theme` (public, lu par `app.js` et `admin.js` avant même une éventuelle connexion) renvoie cette clé, et chaque thème (couleurs + décor) est défini côté frontend uniquement, dans un objet `THEMES` dupliqué à l'identique dans `app.js` et `admin.js`. Les couleurs remplacent des variables CSS (`--blue`, `--blue-2`, `--red`, `--bg`, `--card`, `--card-2`) — le vert, le texte et le gris restent constants dans tous les thèmes pour garder une lisibilité identique (succès/erreur toujours reconnaissables). Le décor animé est un calque plein écran, non cliquable, peint derrière le contenu de l'app (visible seulement dans les espaces transparents entre les cartes), sur le même principe que le filigrane du logo.

Pour ajouter un nouveau thème plus tard : ajouter une entrée dans l'objet `THEMES` (`frontend/app.js` **et** `frontend/admin.js`, à garder synchronisés) et sa clé dans la liste `THEME_KEYS` de `backend/routes/theme.js` (validation côté serveur) — et, si vous voulez des questions dédiées, leur ajouter le champ `"theme"` correspondant dans `questions.json` (voir "Questions saisonnières" plus haut).

**Couleur de fond personnalisée, en plus des thèmes.** Sous la carte des thèmes, une deuxième carte "🖌️ Couleur de fond personnalisée" permet de choisir n'importe quelle couleur (sélecteur de couleur natif) et de l'appliquer par-dessus le thème actif — elle ne remplace que le fond (`--bg`), pas les autres couleurs ni le décor animé du thème. Utile pour garder par exemple le décor de Noël avec un fond différent. Un bouton "Réinitialiser" revient au fond par défaut du thème actif. Techniquement : stockée dans `settings` sous la clé `app_bg_color` (chaîne vide = pas de surcharge), validée côté serveur au format hexadécimal (`#rrggbb`), renvoyée par `GET /api/theme` en plus de la clé du thème, modifiable via `POST /api/admin/settings/bg-color`.

**Photo de fond personnalisée, en plus de la couleur.** Une troisième carte "🖼️ Photo de fond personnalisée" permet d'uploader une image qui remplace le filigrane du logo par une photo en plein écran, indépendamment du thème et de la couleur de fond. L'admin choisit un fichier (PNG/JPEG/WebP) via un simple `<input type="file">` — le navigateur le redimensionne et le compresse automatiquement (max 1600px de large, JPEG qualité 0.82) avant l'envoi, pour qu'une photo de téléphone de plusieurs Mo passe sans problème. Un bouton "Retirer" revient au filigrane du logo par défaut.

Techniquement, pas de librairie d'upload (`multer` ou équivalent) : le fichier est converti en data URL base64 côté navigateur (`FileReader` + `<canvas>` pour le redimensionnement), envoyé dans un simple corps JSON à `POST /api/admin/settings/bg-image`, puis décodé et écrit sur disque côté serveur (`backend/routes/theme.js`, fonction `setBgImage`) — validé au format (PNG/JPEG/WebP uniquement) et à la taille (3 Mo max une fois décodé ; la limite globale des corps JSON, `backend/utils.js`, a été relevée à 6 Mo pour laisser passer le base64). L'ancien fichier est supprimé à chaque nouvel upload, pour ne pas accumuler d'images orphelines.

**Important : stockage sur le disque persistant, pas dans le dépôt.** L'image est écrite dans le même dossier que la base SQLite (`DATA_DIR`, à côté de `DB_PATH` — voir `render.yaml`, qui attache un disque persistant Render à `/var/data`), et non dans `frontend/`, qui est entièrement recréé depuis le dépôt à chaque déploiement et perdrait donc le fichier. Le serveur sert ces images via une route dédiée (`/uploads/*`, dans `server.js`) qui pointe vers ce dossier persistant. Conséquence pratique : la photo de fond survit aux redéploiements, exactement comme les comptes et les points des joueurs.

**Logo personnalisé, dans la barre du haut et l'écran de connexion.** Une quatrième carte "🖼️ Logo (barre du haut et écran de connexion)" permet de remplacer le wordmark `frontend/logo.png` sans redéployer — affiché dans la barre du haut (joueur, agent, admin) et sur l'écran de connexion/création de compte. **Format recommandé : environ 20:2** (un bandeau 10 fois plus large que haut, comme le wordmark fourni par défaut) — non strictement imposé, un autre ratio s'affiche quand même mais peut paraître déformé ou trop petit selon le gabarit choisi par le CSS (`.topbar-logo`/`.auth-logo-img`). Contrairement à la photo de fond (convertie en JPEG), le logo est gardé en PNG côté navigateur pour préserver un éventuel fond transparent, habituel sur un wordmark. Même mécanisme technique que la photo de fond (upload en base64, stockage sur le disque persistant, route `POST /api/admin/settings/logo`, max 2 Mo décodés) — voir plus haut pour le détail. Un bouton "Réinitialiser" revient au fichier `logo.png` livré avec l'app.

⚠️ **À ne pas confondre avec la carte suivante** : cette carte "Logo" remplace le wordmark lui-même (le mot "Konkou" affiché) — si vous y uploadez une photo (un paysage, par exemple), c'est le logo entier qui disparaît, remplacé par cette photo. Pour ajouter une photo **derrière** le logo, sans le faire disparaître, utilisez la carte "Photo de fond de la barre du haut" ci-dessous.

**Photo de fond de la barre du haut, en plus du logo.** Une cinquième carte "🖼️ Photo de fond de la barre du haut" ajoute une photo dans le rectangle de la barre du haut, derrière le logo — indépendamment à la fois du logo (carte précédente) et de la photo de fond de toute l'app (deux cartes plus haut) : les trois coexistent sans se remplacer. Le logo et les liens (Contact/Se déconnecter) restent affichés par-dessus la photo, avec un léger assombrissement automatique pour rester lisibles sur n'importe quelle image. Techniquement : même mécanisme d'upload que les autres photos (base64, disque persistant, `POST /api/admin/settings/topbar-bg-image`, max 3 Mo décodés), mais posée comme variable CSS sur `:root` (`--topbar-bg-image`/`--topbar-overlay` dans `styles.css`) plutôt qu'un style inline sur un élément précis — ainsi elle s'applique à la barre du haut où qu'elle soit re-rendue dans l'app (joueur, agent, admin), sans code de "patch" supplémentaire à chaque écran. Sans photo ici, la barre garde simplement le dégradé de couleurs du thème actif, comportement identique à avant cet ajout. Un bouton "Retirer" revient à ce dégradé.

### Icône de l'app (favicon/écran d'accueil)

`frontend/icon.png` (512×512) est l'icône utilisée par le navigateur (onglet, notifications) et par le téléphone quand l'app est ajoutée à l'écran d'accueil (PWA — voir `manifest.json`). Contrairement au logo et aux photos de fond ci-dessus, cette icône **n'est pas modifiable depuis `/admin.html`** : c'est un simple fichier statique dans `frontend/`, remplacé en éditant le fichier puis en redéployant.

À l'origine, cette icône affichait un "K" générique (police Arial) sur un badge aux couleurs du drapeau haïtien. Remplacée par le wordmark réel (`logo.png`) redimensionné et centré dans le cercle blanc du même badge — plus fidèle à la marque, tout en gardant un bon contraste (rouge sur blanc) et le même repère visuel bleu/rouge. À la taille d'un onglet de navigateur (16-32px), le mot "Konkou" en écriture cursive n'est pas lisible lettre par lettre (aucune police de logo ne le serait à cette taille) mais reste reconnaissable comme une tache rouge distinctive sur fond blanc, dans le badge aux couleurs de Konkou — largement suffisant pour repérer l'onglet/l'icône parmi d'autres. Pour la remplacer par autre chose : régénérer `frontend/icon.png` (512×512 recommandé, PNG avec transparence si besoin) et redéployer — `manifest.json`, `index.html`, `admin.html` et `sw.js` référencent tous ce même fichier.

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

- **Corrigé (juillet 2026)** : le sprint de calcul mental annonçait une limite de 45 secondes côté serveur, mais rien ne l'imposait ni côté interface ni côté serveur — un joueur pouvait prendre tout son temps. Voir "Limite de temps par partie" ci-dessous pour la correction (compte à rebours affiché + vérification serveur, sur les deux jeux).
- La limite de "10 parties/jour" se réinitialise à minuit UTC, pas à minuit heure d'Haïti — concrètement le nouveau quota tombe en fin d'après-midi/soirée locale plutôt qu'à minuit. Facile à ajuster si vous voulez un vrai minuit local.
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

**Logo manquant sur le tableau de bord admin + couleur de fond personnalisée (juillet 2026).** Deux ajouts en parallèle, remontés après la mise en place du thème saisonnier :
- Le tableau de bord principal de `/admin.html` (après connexion) affichait encore le texte "🇭🇹 Konkou — Gestion" au lieu du logo — un oubli datant d'avant que le logo ne soit branché ailleurs dans l'app (connexion, portefeuille joueur, espace agent l'affichaient déjà correctement). Corrigé : même `<img src="logo.png" class="topbar-logo">` que partout ailleurs.
- Nouvelle carte "🖌️ Couleur de fond personnalisée" dans l'onglet *Réglages* — voir "Thème saisonnier de l'app" plus haut pour le détail. Permet de choisir une couleur de fond libre, indépendamment des 6 thèmes saisonniers.

Testé de bout en bout via curl : `GET /api/theme` renvoie bien `bgColor` en plus de `theme` (vide sur une base neuve), une couleur non-hexadécimale est rejetée (400), une couleur valide est acceptée (200) et persistée, la réinitialisation (`bgColor` vide) revient bien à un état vide, et l'accès sans jeton admin est bloqué (401).

**Thème Saint-Valentin + photo de fond personnalisée (juillet 2026).** Deux ajouts en parallèle, voir "Thème saisonnier de l'app" plus haut pour le détail complet :
- 7e thème saisonnier : **Saint-Valentin** ❤️ (rouge/rose, décor de cœurs).
- Nouvelle carte "🖼️ Photo de fond personnalisée" dans *Réglages* — upload d'une image (redimensionnée/compressée côté navigateur), stockée sur le disque persistant Render pour survivre aux redéploiements (contrairement à `frontend/`), servie via une nouvelle route statique `/uploads/*`.

Testé de bout en bout via curl : thème `valentin` accepté et persisté, upload d'une vraie image PNG accepté (200) et re-servie avec le bon `Content-Type` via `/uploads/...`, format non-image rejeté (400), image de 4 Mo décodés rejetée (400, au-dessus de la limite de 3 Mo) sans laisser de fichier sur le disque, l'ancien fichier est bien supprimé à chaque nouvel upload (pas d'accumulation), la suppression (`imageDataUrl` vide) vide bien le dossier `uploads/`, et l'accès sans jeton admin est bloqué (401).

**Suppression de compte agent, revenus par jour, logo personnalisé (juillet 2026).** Trois ajouts en parallèle :
- **Suppression de compte côté agent** : l'Espace Agent a maintenant le même bouton "🗑️ Supprimer mon compte" que le Profil joueur (mot de passe requis, avertissement sur le crédit/commissions non réglés). Ce changement a nécessité de revoir la règle de blocage (`backend/routes/account.js`, `blockingReason`) : un rôle agent **actif** n'est plus, en soi, un motif de blocage (c'était un point mort — rien dans l'app ne permettait de "clôturer" un rôle actif, donc un agent actif ne pouvait jamais être supprimé) ; le blocage réel porte maintenant sur les dépôts/retraits/renflouements **assignés** à cet agent et encore en attente, qui seraient sinon orphelins. Voir "Suppression de compte" plus haut pour le détail complet, y compris côté admin (`/admin.html` affiche et avertit désormais aussi sur le crédit/commissions d'un agent avant suppression).
- **Revenus par jour** : sélecteur de date dans l'onglet *Revenus*, voir "Comment Konkou génère du revenu" plus haut.
- **Logo personnalisé** : nouvelle carte dans *Réglages*, voir "Thème saisonnier de l'app" plus haut.

Testé de bout en bout : suppression d'un compte agent actif avec un dépôt assigné en attente correctement bloquée (409, message explicite), suppression réussie une fois ce dépôt confirmé (200, message récapitulant le crédit/commissions restants à régler), compte introuvable après coup ; revenus filtrés par date validés avec des transactions réparties sur deux jours différents (total tout-historique = somme des deux jours, date sans activité = 0, format de date invalide = repli sur tout l'historique, `earliestDate` correspond bien à la création du tout premier compte) ; upload de logo validé (format/taille rejetés correctement, ancien fichier supprimé à chaque nouvel upload, réinitialisation fonctionne, servi avec le bon `Content-Type`).

**Ville/Adresse agent + refonte du tableau de bord agent (juillet 2026).** Deux ajouts en parallèle :
- **Ville et adresse** sont désormais demandées (obligatoires) sur les deux formulaires d'inscription agent (inscription dédiée et candidature "Devenir Agent" depuis un compte joueur existant) — colonnes ajoutées à la table `agents`. Une fois le compte actif, ces informations apparaissent : dans `/admin.html` (onglet *Agents*, sur chaque candidature, et onglet *Comptes* lors d'une recherche) ; et surtout, côté joueur, dans un encart "📍 Infos Agent" qui s'affiche dès qu'un agent est sélectionné sur les formulaires de dépôt et de retrait, pour que le joueur sache où il va faire sa transaction avant de valider sa demande.
- **Tableau de bord agent enrichi** : affiche maintenant le nom complet de l'agent, son numéro d'agent, son crédit revendable (montant à vendre), et une nouvelle carte "💰 Commission sur retraits" avec un sélecteur de date (borné entre le jour d'activation de son compte et aujourd'hui) qui permet de consulter la commission gagnée un jour précis, en plus du total cumulé depuis toujours. Techniquement, chaque retrait payé fige désormais sa commission (`cashouts.commission_htg`) au moment du paiement — comme le fait déjà `platform_fee_htg` — pour que ce filtre par jour reste exact même si `AGENT_CASHOUT_COMMISSION_PERCENT` change plus tard (les retraits payés avant l'ajout de cette colonne affichent 0 sur un jour filtré, mais le total cumulé `commission_earned`, lui, reste correct).

Testé de bout en bout via curl : inscription (dédiée et candidature) refusée sans ville/adresse (400) et acceptée avec ; `GET /api/agents/list` exposant bien la ville/adresse à un joueur ; tableau de bord agent renvoyant nom/prénom/ville/adresse/date d'activation ; commission par jour sur un retrait payé le jour même (montant correct), sur un jour sans activité (0 HTG), et avec une date invalide (repli sur le total cumulé) ; affichage ville/adresse confirmé côté admin, tant sur les candidatures que sur la recherche de compte.

**Questions de quiz saisonnières + 8e thème "Rentrée des classes" (juillet 2026).** Deux ajouts liés, voir "Questions saisonnières" et "Thème saisonnier de l'app" plus haut pour le détail complet :
- 60 nouvelles questions ajoutées à `questions.json` (100 → 160), réparties en 6 thèmes de 10 questions chacun : Noël, Été, Pâques, Saint-Valentin, Nouvel An, Rentrée des classes. Chacune porte un champ `"theme"` optionnel ; les 100 questions générales existantes n'en ont pas et restent toujours piochables.
- `routes/games.js` compose désormais le pool de tirage du quiz à partir du thème saisonnier actif (`routes/theme.js`, nouvelle fonction `getActiveThemeKey()`) : questions générales + questions du thème actif uniquement — les questions d'un autre thème restent invisibles. Ce comportement suit directement le thème déjà choisi par vous dans *Réglages*, sans réglage séparé à gérer pour les questions.
- Nouveau 8e thème visuel **Rentrée des classes** 🎒 (vert tableau/jaune crayon, décor de crayons), ajouté car cette période n'avait pas encore de thème alors qu'elle a désormais ses propres questions.

Testé de bout en bout via curl : 160 questions validées programmatiquement (ids uniques, 4 choix, réponse valide, 10 questions par thème, 100 questions générales) ; sur le thème "Défaut", 40 tirages successifs (200 questions) ne renvoient que des questions générales ; sur le thème "Noël" actif, 60 tirages font apparaître des questions de Noël mélangées aux questions générales, sans qu'aucune question d'un autre thème (Été, Pâques...) n'apparaisse ; le thème "Rentrée des classes" est accepté et persisté comme les 7 thèmes existants.

**Photo de fond dédiée à la barre du haut (juillet 2026).** Remontée après un test : uploader une photo dans la carte "Logo" la remplaçait entièrement (le mot "Konkou" disparaissait), alors que l'intention était d'ajouter une photo *derrière* le logo, pas de le remplacer. Nouvelle carte "🖼️ Photo de fond de la barre du haut" dans *Réglages*, indépendante du logo et de la photo de fond de toute l'app — voir "Photo de fond de la barre du haut, en plus du logo" plus haut pour le détail complet, y compris le choix technique (variables CSS sur `:root` plutôt qu'un style inline, pour survivre à n'importe quel re-rendu de la barre).

Testé de bout en bout via curl : `GET /api/theme` renvoie bien `topbarBgImage` (vide sur une base neuve, coexiste avec `bgImage` et `logo` déjà définis) ; accès sans jeton admin bloqué (401) ; format non-image rejeté (400) ; upload PNG valide accepté (200) et re-servi avec le bon `Content-Type` via `/uploads/...` ; un nouvel upload supprime bien l'ancien fichier (pas d'accumulation) ; la réinitialisation (`imageDataUrl` vide) vide bien le réglage et le dossier.

**Icône PWA/favicon remplacée par le vrai logo (juillet 2026).** `frontend/icon.svg` (badge bleu/rouge avec un "K" en police Arial générique) remplacé par `frontend/icon.png` (même badge, wordmark `logo.png` redimensionné et centré dans le cercle blanc) — voir "Icône de l'app (favicon/écran d'accueil)" plus haut pour le détail complet, y compris pourquoi isoler juste la lettre "K" du logo cursif n'était pas possible proprement (glyphes qui se chevauchent visuellement dans l'image). `index.html`, `admin.html`, `manifest.json` et `sw.js` mis à jour pour référencer `icon.png` ; `icon.svg`, plus utilisé nulle part, a été retiré du dépôt.

Testé : `icon.png` (512×512 PNG) servi avec `Content-Type: image/png` sur `/`, `manifest.json` reste un JSON valide référençant `icon.png`, `index.html` et `admin.html` chargent toujours (200).

**Correction du modèle économique (juillet 2026).** Une revue de rentabilité a révélé que le frais de retrait (5/6/8% selon le palier) était systématiquement inférieur à la commission agent (10% fixe) — chaque retrait payé coûtait donc plus cher en commission qu'il ne rapportait en frais, une perte nette structurelle qui s'aggravait avec le volume de retraits plutôt que de s'améliorer. Trois ajustements en parallèle pour renverser la tendance, voir "Comment Konkou génère du revenu" plus haut pour le détail complet et un exemple chiffré :
- **Frais de retrait relevés à 12/14/16%** (`CASHOUT_FEE_TIER1/2/3_PERCENT` dans `.env` et `render.yaml`), désormais au-dessus de la commission agent (10%) à chaque palier — chaque retrait dégage maintenant une marge nette de 2 à 6 points au lieu d'une perte de 2 à 5 points.
- **Limite quotidienne de parties gratuites réduite à 15** (`DAILY_LIMIT` dans `backend/routes/games.js`, contre 30 auparavant) — réduit de moitié le plafond de points gagnables gratuitement par jour et par joueur, donc le passif maximal théorique par joueur très actif.
- **Fourchette de la mise sur sa performance resserrée à ±15%** (contre ±30% auparavant, voir `stakeMultiplier()` dans `backend/routes/games.js`) — si les joueurs répondent correctement plus de la moitié du temps en moyenne, la mise crée en moyenne plus de points qu'elle n'en détruit à l'échelle de tous les joueurs ; resserrer la fourchette réduit cette volatilité de moitié sans retirer l'aspect ludique du mécanisme.

Tous les textes visibles par le joueur ont été mis à jour en conséquence ("15 parties gratuites/jour", "±15%" dans les écrans Comment ça marche, Portefeuille et l'écran de mise avant une partie). Testé de bout en bout via curl : les trois paliers de frais recalculés correctement (12/14/16%, toujours au-dessus de la commission de 10%), la limite de 15 parties/jour appliquée (le 16e essai est refusé avec le message habituel, une partie bonus reste utilisable au-delà), et la nouvelle formule de mise validée à 0% (perte de 15% exacte), 50% (mise inchangée) et 100% (gain de 15% exact).

⚠️ **Important pour le déploiement** : `render.yaml` ne s'applique qu'à la création initiale d'un service Render via "New +" → "Blueprint" — modifier ce fichier ne met **pas** à jour automatiquement les variables d'environnement d'un service déjà existant et actif comme `konkou.onrender.com`. Après avoir poussé ce changement, allez dans le **dashboard Render** → votre service → onglet *Environment*, et mettez à jour manuellement `CASHOUT_FEE_TIER1_PERCENT` (12), `CASHOUT_FEE_TIER2_PERCENT` (14) et `CASHOUT_FEE_TIER3_PERCENT` (16), puis redéployez (ou laissez Render redéployer automatiquement après le changement de variable). `DAILY_LIMIT` et la fourchette de mise, eux, sont codés en dur dans `games.js` — ils s'appliquent automatiquement dès que ce fichier est déployé, sans variable d'environnement à changer.

**Frais sur les dépôts + Abonnement VIP payant (juillet 2026).** Deux nouvelles sources de revenu récurrentes, à la demande explicite de l'utilisateur ("l'app est conçue dans le but de gagner de l'argent") après la correction du point de rentabilité ci-dessus — voir "Comment Konkou génère du revenu" et "Abonnement VIP" plus haut pour le détail complet :
- **Frais sur les dépôts** (`DEPOSIT_FEE_PERCENT`, 5% par défaut) : prélevé sur le montant déposé avant de calculer les parties bonus accordées (`backend/routes/deposits.js`, `postDeposit`) — le crédit débité chez l'agent reste inchangé (montant brut), seul le nombre de parties accordées au joueur en tient compte. Le montant du frais est figé sur chaque dépôt (`deposits.platform_fee_htg`, nouvelle colonne), comme les autres frais de la plateforme.
- **Abonnement VIP payant** (`VIP_PRICE_HTG`/`VIP_DURATION_DAYS`/`VIP_EXTRA_DAILY_PLAYS`, 300 HTG / 30 jours / +10 parties par défaut) : nouvelle table `vip_purchases` et colonne `users.vip_until`, nouveau module `backend/routes/vip.js`, nouvel onglet *VIP* dans `/admin.html`, nouvelle carte "👑 Achats VIP à confirmer" côté agent. `backend/routes/games.js` (`playAllowance`) relève désormais la limite quotidienne gratuite de `VIP_EXTRA_DAILY_PLAYS` pour un joueur VIP actif, en plus des parties bonus déjà existantes.
- L'onglet *Revenus* affiche désormais cinq sources au lieu de trois (les deux nouvelles : "Frais de service sur les dépôts" et "Ventes VIP"), toujours calculées dynamiquement depuis les transactions.

Testé de bout en bout (scénarios directs sur les fonctions de route, équivalent à des appels API) : frais de dépôt calculé et persisté correctement (5% de 200 HTG → 10 HTG de frais, parties bonus calculées sur le net) ; double demande VIP en attente rejetée (409) ; VIP inactif avant confirmation, actif immédiatement après confirmation par l'agent ; crédit revendable de l'agent inchangé par un achat VIP (contrairement à un dépôt) ; limite quotidienne de parties relevée de 15 à 25 pour un joueur VIP actif (`remainingPlaysToday` le reflète) ; liste et revenus admin incluant bien les nouvelles sources (310 HTG = 300 de vente VIP + 10 de frais de dépôt sur le scénario de test) ; code agent invalide rejeté (400) sur dépôt et sur VIP ; rejet d'une demande VIP fonctionnel ; renouvellement VIP avant échéance ajoutant exactement 30 jours à la date d'expiration existante plutôt que de la remettre à zéro. Démarrage du serveur HTTP et routes `/api/admin/vip` et `/api/admin/revenue` vérifiées via curl.

⚠️ **Important pour le déploiement** : comme pour les frais de retrait plus haut, `render.yaml` ne met pas à jour un service Render déjà existant. Après avoir poussé ce changement, ajoutez manuellement dans le dashboard Render → votre service → onglet *Environment* : `DEPOSIT_FEE_PERCENT` (5), `VIP_PRICE_HTG` (300), `VIP_DURATION_DAYS` (30), `VIP_EXTRA_DAILY_PLAYS` (10) — sans ces variables, le serveur utilise les mêmes valeurs par défaut codées en dur, donc l'app fonctionne quand même, mais vous ne pourrez pas les ajuster depuis Render sans les ajouter explicitement d'abord.

**Limite de temps par partie, réellement appliquée (juillet 2026).** Le sprint de calcul annonçait déjà un chiffre de 45 secondes depuis le début du projet, mais rien ne l'imposait — voir "Limite de temps par partie" plus haut pour le détail complet :
- Compte à rebours visible ajouté sur les deux jeux (60s quiz, 45s sprint), avec auto-soumission des réponses déjà données à l'expiration (réponses manquantes = fausses, jamais partie annulée).
- Vérification serveur ajoutée en plus du visuel : chaque session de jeu retient sa propre limite et son heure de démarrage ; une soumission arrivant plus de 10 secondes (marge réseau) après la limite affichée est refusée (400), pour empêcher de contourner le compte à rebours en manipulant le navigateur.
- Le minuteur ne redémarre jamais entre deux questions — il est fixé une seule fois au début de la partie.

Testé de bout en bout (scénarios directs sur les fonctions de route) : les deux jeux annoncent bien la bonne limite (60s/45s) ; une soumission immédiate fonctionne normalement (aucune régression) ; une soumission simulée juste après la limite mais dans la marge de 10s est acceptée ; une soumission simulée au-delà de la marge est rejetée (400) sur les deux jeux ; des réponses "manquantes" (valeur sentinelle -1, jamais une réponse valide) comptent bien comme fausses sans fausser le score.

**Écran de résultat de partie amélioré (juillet 2026).** Deux corrections remontées après la mise en place du minuteur ci-dessus :
- Le nombre de parties gratuites restantes aujourd'hui (et de parties bonus disponibles) s'affiche de nouveau après une partie, sur l'écran de résultat lui-même — il n'avait jamais été présent à cet endroit précis (seulement pendant la partie), ce qui le rendait invisible juste au moment où le joueur veut savoir s'il peut enchaîner.
- Le bouton "Retour à l'accueil" en fin de partie est remplacé par une carte "🎮 Jouer une nouvelle partie" avec les deux jeux directement proposés (mêmes tuiles que sur l'Accueil) — le joueur enchaîne une nouvelle partie sans revenir à l'écran d'Accueil complet. La barre d'onglets en bas reste toujours accessible pour y revenir manuellement si besoin.

**Minuteur uniformisé, agrandi, et pénalité de défaite (juillet 2026).** Trois ajustements demandés après la mise en place initiale du minuteur — voir "Limite de temps par partie" plus haut pour le détail complet :
- **Durée uniformisée à 45 secondes** pour les deux jeux (`TRIVIA_TIME_LIMIT_SECONDS` passe de 60 à 45) — plus simple à retenir qu'une durée différente par jeu.
- **Compte à rebours bien plus visible** : passé de 16px discret à 44px en gras sur fond assombri, impossible à manquer.
- **Nouvelle pénalité de défaite** : contrairement à avant (où une partie expirée comptait juste les questions manquantes comme fausses, avec un score et une mise calculés normalement), le temps écoulé est désormais traité comme une défaite nette — 0 point gagné quel que soit le score réel, et 50% de la mise perdue d'un coup (au lieu de la formule ±15% habituelle). Implémenté via une fonction `scoreOutcome()` partagée entre `submitTrivia`/`submitPuzzle`, qui exige la confirmation indépendante du serveur (temps réellement dépassé) avant d'appliquer la pénalité — un signal client erroné ou prématuré ne pénalise jamais un joueur à tort, et le garde-fou déjà en place (soumission refusée au-delà de `limite + 10s`) reste la limite dure absolue, quelle que soit la prétention du client.

Testé de bout en bout (scénarios directs sur les fonctions de route) : les deux jeux annoncent bien 45s ; une soumission normale avec mise applique toujours la formule ±15% habituelle (aucune régression) ; une soumission signalée comme expirée et confirmée par le serveur comme réellement en retard applique bien 0 point et -50% de la mise pile ; un signal d'expiration prématuré (envoyé par erreur alors que le temps n'est pas dépassé) est ignoré et la partie notée normalement ; une soumission au-delà de la marge de tolérance reste rejetée (400) quel que soit le signal envoyé ; comportement identique vérifié sur les deux jeux.

**Couleur adaptative du chronomètre et des compteurs de parties (juillet 2026).** Le chronomètre et les compteurs "Parties gratuites restantes"/"Parties bonus disponibles" (Accueil, écran de jeu, écran de résultat, Portefeuille) avaient une couleur fixe, peu lisible selon la couleur de fond ou le thème saisonnier actif. Ils s'adaptent désormais automatiquement : **rouge** sur un fond pâle, **blanc** sur un fond foncé. Techniquement, `frontend/app.js` lit la variable CSS `--bg` actuellement appliquée (thème saisonnier ou couleur de fond personnalisée par l'admin), calcule sa luminance relative (formule WCAG standard), et pose le résultat dans une nouvelle variable `--game-contrast` sur `:root` — recalculée à chaque application de thème (`applyThemeVars`), donc toujours à jour même après un changement de thème ou de couleur de fond en direct. Dans les 10 dernières secondes du chronomètre, un badge rouge plein avec texte blanc prend le relais quelle que soit la couleur de fond, pour une urgence toujours visible.

Testé (calcul de luminance sur des cas connus, hors navigateur puisque `getComputedStyle` n'existe pas en dehors du DOM) : le fond sombre par défaut de Konkou (`#0b1220`) est bien classé "foncé", le blanc et les tons pâles (`#ffffff`, `#f5f5f5`) sont bien classés "pâles", et le format `rgb(r, g, b)` (celui que renvoie réellement `getComputedStyle`, même quand la couleur d'origine était un hex) est correctement interprété, pas seulement le format hex brut.

**Bouton "Devenir Agent" plus visible sur l'écran de connexion (juillet 2026).** Le lien d'inscription agent (petit texte en bas de l'écran, sous "Nous contacter") est remplacé par un bouton "🧑‍💼 Devenir Agent" pleine largeur, dans sa propre carte, juste après la carte Connexion/Créer un compte — visible immédiatement, sans avoir à faire défiler. Comportement inchangé (même formulaire d'inscription agent complet ensuite) — seul l'emplacement et la mise en avant changent.

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
│   ├── routes/              # auth, jeux, portefeuille, dépôts, vip, agents, compte (suppression), classement, profil, admin (retraits/vérifications/dépôts/vip/agents/renflouements/revenus/comptes)
│   └── data/questions.json # banque de 160 questions du quiz : 100 générales + 60 saisonnières (voir "Mettre à jour la banque de questions")
└── frontend/
    ├── index.html, app.js, styles.css   # app joueur
    ├── admin.html, admin.js              # interface agent/gestionnaire (retraits, vérifications WhatsApp, dépôts, VIP, candidatures agent, renflouements, revenus)
    ├── manifest.json, sw.js, icon.png   # config PWA (installable, mode hors-ligne partiel — voir note ci-dessous)
    ├── logo.png, logo-watermark.png       # wordmark (barre du haut / connexion) + version filigrane (fond d'écran)
```
