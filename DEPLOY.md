# Déployer Konkou sur Render

Ce guide part du principe que le dossier `konkou-app` (avec son dépôt Git déjà initialisé) est sur votre ordinateur. Toutes les étapes ci-dessous se font depuis votre machine — je n'ai pas d'accès réseau sortant vers GitHub ou Render depuis mon environnement de travail, donc ces étapes doivent être faites par vous.

Comptez environ 20-30 minutes, y compris la création des comptes.

## Coût

Le plan Render "Starter" (nécessaire pour avoir un disque persistant, indispensable pour ne pas perdre les comptes/points des joueurs) coûte environ **7 $/mois**, plus **0,25 $/Go/mois** pour le disque (1 Go suffit largement pour démarrer, donc ~7,25 $/mois au total). Une carte bancaire est nécessaire pour créer le compte Render.

## Étape 1 — Mettre le code sur GitHub

Si vous n'avez pas de compte GitHub, créez-en un gratuitement sur [github.com](https://github.com).

1. Sur GitHub, cliquez sur "New repository". Nommez-le `konkou-app`, laissez-le **vide** (ne cochez ni README, ni .gitignore, ni licence — le projet en a déjà), puis "Create repository".
2. Sur votre ordinateur, ouvrez un terminal dans le dossier `konkou-app` (celui que vous avez téléchargé) et lancez :

```bash
git remote add origin https://github.com/VOTRE-NOM-UTILISATEUR/konkou-app.git
git push -u origin main
```

(Remplacez `VOTRE-NOM-UTILISATEUR` par votre nom d'utilisateur GitHub. Le dépôt Git est déjà initialisé avec un premier commit — cette commande l'envoie simplement sur GitHub.)

## Étape 2 — Créer un compte Render et déployer

1. Allez sur [render.com](https://render.com) et créez un compte (le plus simple est "Sign up with GitHub", ça connecte directement les deux).
2. Une fois connecté, cliquez sur **"New +"** → **"Blueprint"**.
3. Sélectionnez le dépôt `konkou-app` que vous venez de pousser.
4. Render détecte automatiquement le fichier `render.yaml` à la racine du projet et vous propose de créer le service décrit dedans (nommé `konkou`, avec son disque persistant de 1 Go). Vérifiez que ça correspond, puis cliquez sur **"Apply"**.
5. Render va vous demander un moyen de paiement (nécessaire pour le disque persistant), installer les fichiers, puis démarrer le serveur. Ça prend 2-5 minutes.

## Étape 3 — Récupérer votre mot de passe administrateur

`render.yaml` génère automatiquement des valeurs aléatoires sécurisées pour `JWT_SECRET` et `ADMIN_PASSWORD` au moment du déploiement (au lieu d'utiliser les valeurs de démo du fichier `.env`).

1. Dans le tableau de bord Render, ouvrez le service `konkou`.
2. Allez dans l'onglet **"Environment"**.
3. Cliquez sur l'œil à côté de `ADMIN_PASSWORD` pour le révéler, et **notez-le quelque part en sécurité** — c'est le mot de passe pour accéder à `/admin.html` (retraits, vérifications, dépôts).
4. **Rien à faire ici depuis juillet 2026** : la confirmation d'inscription/réinitialisation se fait désormais via un tchat intégré à l'application elle-même (voir "Confirmation par tchat interne" dans `README.md`), sans dépendance à un numéro WhatsApp externe. `OPERATOR_WHATSAPP_NUMBER` reste dans `render.yaml` mais n'est plus utilisé par ce parcours ; vous pouvez l'ignorer.
5. **Optionnel** (notifications push, voir "Notifications push" dans `README.md`) : sur votre ordinateur, lancez `node backend/generate-vapid-keys.js` dans le dossier du projet — ça affiche deux valeurs `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY`. Collez-les dans les variables du même nom (actuellement `REMPLACER (node backend/generate-vapid-keys.js)`). Sans ça, l'app fonctionne normalement, seul le bouton "🔔 Activer les notifications" affichera une erreur.
6. Cliquez sur **"Save Changes"** — Render redémarre automatiquement le service avec les nouvelles valeurs.

## Étape 4 — Tester

Render vous donne une URL du type `https://konkou.onrender.com` (visible en haut du tableau de bord du service).

- Ouvrez cette URL : l'app doit se charger normalement — inscrivez-vous pour tester ; l'écran affiche votre code de confirmation et une conversation.
- Écrivez un message (avec votre code) dans cette conversation, puis ouvrez `https://konkou.onrender.com/admin.html`, connectez-vous avec le mot de passe récupéré à l'étape 3, onglet **Vérifications** : vous devriez voir la même conversation dans la carte de votre demande — comparez le code, cliquez "✅ Confirmer" — l'app du joueur devrait se connecter automatiquement en quelques secondes.

## ⚠️ Avant de partager l'app publiquement

La confirmation par tchat interne dépend d'une personne qui surveille activement `/admin.html` (onglets **Vérifications** et **Messages**) — sans surveillance régulière, les nouveaux joueurs resteront bloqués en attente de confirmation. Avant un vrai lancement à grande échelle, envisagez de brancher un vrai fournisseur SMS (voir la section correspondante dans `README.md`) pour automatiser cette étape.

## Mettre à jour l'app plus tard

Chaque fois que vous voulez déployer une modification du code : commitez et poussez sur GitHub (`git add -A && git commit -m "..." && git push`) — Render redéploie automatiquement à chaque push sur la branche `main`. Pas de commande spéciale à lancer sur Render.

## Nom de domaine personnalisé — konkouapp.com (Namecheap)

Le domaine `konkouapp.com` a été acheté chez Namecheap. Voici la marche à suivre pour le connecter au service Render `konkou`, avec un certificat HTTPS généré automatiquement par Render. Comptez quelques minutes à quelques heures pour la propagation DNS après ces réglages.

### Étape A — Ajouter le domaine côté Render

1. Dans le [tableau de bord Render](https://dashboard.render.com), ouvrez le service `konkou`.
2. Onglet **"Settings"**, faites défiler jusqu'à la section **"Custom Domains"**.
3. Cliquez **"+ Add Custom Domain"** et entrez `konkouapp.com` (le domaine racine, sans `www`). Cliquez **"Save"**.
4. Render ajoute automatiquement `www.konkouapp.com` en redirection vers `konkouapp.com`. Le domaine apparaît avec le statut "DNS update needed" — c'est normal, l'étape B ci-dessous s'en occupe.

### Étape B — Configurer le DNS côté Namecheap

1. Connectez-vous sur [namecheap.com](https://namecheap.com), allez dans **"Domain List"**, cliquez **"Manage"** à côté de `konkouapp.com`, puis l'onglet **"Advanced DNS"**.
2. **Supprimez toute entrée `AAAA`** existante si présente — elle pointe vers une adresse IPv6, que Render ne supporte pas, et peut bloquer la vérification.
3. **Enregistrement racine** : supprimez l'entrée `A` existante pour l'hôte `@`, puis ajoutez-en une nouvelle :
   - Type : `A Record`
   - Host : `@`
   - Value : `216.24.57.1` (adresse du load balancer Render)
   - TTL : `1 min` (le plus court possible, pour accélérer la vérification)
4. **Enregistrement www** : supprimez toute entrée `CNAME` ou redirection existante pour l'hôte `www`, puis ajoutez :
   - Type : `CNAME Record`
   - Host : `www`
   - Value : `konkou.onrender.com` (le sous-domaine exact du service, visible en haut du tableau de bord Render — à vérifier au cas où il diffère)
   - TTL : `1 min`

### Étape C — Vérifier et tester

1. Revenez sur Render, section **"Custom Domains"**, cliquez **"Verify"** à côté de `konkouapp.com`.
2. Si la vérification échoue, patientez quelques minutes (le temps que le changement DNS se propage) et réessayez.
3. Une fois vérifié, Render génère automatiquement le certificat TLS (HTTPS) — ça peut prendre quelques minutes de plus.
4. Ouvrez `https://konkouapp.com` dans un navigateur. Un "502 Bad Gateway" passager juste après la vérification est normal, le temps que Render mette à jour son routage — réessayez après quelques minutes.

Pas indispensable pour commencer : l'URL `.onrender.com` fonctionne très bien en attendant.

## Un doute pendant le déploiement ?

Je n'ai pas pu tester ces étapes sur Render en conditions réelles (pas d'accès réseau depuis mon environnement), donc si une option à l'écran ne correspond pas exactement à ce qui est décrit ici, dites-le-moi — je pourrai ajuster `render.yaml` ou ce guide en fonction de ce que Render affiche réellement.
