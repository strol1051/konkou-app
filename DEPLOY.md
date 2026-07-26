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

## Étape 3 — Récupérer votre mot de passe administrateur et définir votre numéro WhatsApp

`render.yaml` génère automatiquement des valeurs aléatoires sécurisées pour `JWT_SECRET` et `ADMIN_PASSWORD` au moment du déploiement (au lieu d'utiliser les valeurs de démo du fichier `.env`).

1. Dans le tableau de bord Render, ouvrez le service `konkou`.
2. Allez dans l'onglet **"Environment"**.
3. Cliquez sur l'œil à côté de `ADMIN_PASSWORD` pour le révéler, et **notez-le quelque part en sécurité** — c'est le mot de passe pour accéder à `/admin.html` (retraits, vérifications, dépôts).
4. **Obligatoire** : modifiez `OPERATOR_WHATSAPP_NUMBER` (actuellement `REMPLACER_PAR_VOTRE_NUMERO`) pour y mettre le numéro WhatsApp qui recevra les messages de confirmation d'inscription/réinitialisation, au format E.164 **sans le "+"** (ex. `50937123456`). Sans ça, personne ne peut activer un compte ni réinitialiser un mot de passe — voir "Confirmation par WhatsApp" dans `README.md`.
5. Cliquez sur **"Save Changes"** — Render redémarre automatiquement le service avec la nouvelle valeur.

## Étape 4 — Tester

Render vous donne une URL du type `https://konkou.onrender.com` (visible en haut du tableau de bord du service).

- Ouvrez cette URL : l'app doit se charger normalement — inscrivez-vous pour tester, puis appuyez sur "Confirmer via WhatsApp" (ça doit ouvrir WhatsApp avec un message pré-rempli vers le numéro que vous avez configuré à l'étape 3).
- Envoyez-vous ce message, puis ouvrez `https://konkou.onrender.com/admin.html`, connectez-vous avec le mot de passe récupéré à l'étape 3, onglet **Vérifications**, et confirmez la demande — l'app du joueur devrait se connecter automatiquement en quelques secondes.

## ⚠️ Avant de partager l'app publiquement

La confirmation par WhatsApp dépend d'une personne qui surveille activement `OPERATOR_WHATSAPP_NUMBER` — sans surveillance régulière, les nouveaux joueurs resteront bloqués en attente de confirmation. Avant un vrai lancement à grande échelle, envisagez de brancher un vrai fournisseur SMS (voir la section correspondante dans `README.md`) pour automatiser cette étape.

## Mettre à jour l'app plus tard

Chaque fois que vous voulez déployer une modification du code : commitez et poussez sur GitHub (`git add -A && git commit -m "..." && git push`) — Render redéploie automatiquement à chaque push sur la branche `main`. Pas de commande spéciale à lancer sur Render.

## Nom de domaine personnalisé (optionnel)

Si vous avez un nom de domaine (ex. `konkou.ht` ou `konkou.com`), Render permet de le connecter dans l'onglet **"Settings" → "Custom Domains"** du service, avec un certificat HTTPS généré automatiquement. Pas indispensable pour commencer — l'URL `.onrender.com` fonctionne très bien pour tester.

## Un doute pendant le déploiement ?

Je n'ai pas pu tester ces étapes sur Render en conditions réelles (pas d'accès réseau depuis mon environnement), donc si une option à l'écran ne correspond pas exactement à ce qui est décrit ici, dites-le-moi — je pourrai ajuster `render.yaml` ou ce guide en fonction de ce que Render affiche réellement.
