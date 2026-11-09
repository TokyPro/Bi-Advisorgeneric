# BI Advisor — Guide de lancement (Windows)

Dossier du projet : `C:\Moi\Travail\BI Advisor Generique\bi-advisor\bi-advisor`
(c'est le dossier qui contient `package.json`).

## 1. Prérequis

- **Node.js 20 ou plus récent** (recommandé : version LTS) — https://nodejs.org
- Vérifiez dans un terminal :

```powershell
node -v
npm -v
```

## 2. Lancer l'application en mode développement

Ouvrez **PowerShell** (ou l'invite de commandes) puis :

```powershell
cd "C:\Moi\Travail\BI Advisor Generique\bi-advisor\bi-advisor"
npm install
npm run dev
```

- `npm install` : à faire une seule fois (2 à 3 minutes). Il copie aussi automatiquement le moteur de lecture PDF dans `public\`.
- `npm run dev` : démarre le serveur. Ouvrez ensuite **http://localhost:3000** dans votre navigateur.
- Pour arrêter : `Ctrl + C` dans le terminal.

## 3. Premier démarrage

0. **Créez le compte administrateur** : au premier accès, un écran vous demande nom, e-mail et mot de passe (10 caractères min., lettres + chiffres). Ensuite, connectez-vous avec ce compte. Les comptes sont dans le dossier `data\` (à sauvegarder). Options (`AUTH_SECRET`, `ADMIN_EMAIL`, `AUTH_DISABLED`…) : voir `.env.example` (copiez-le en `.env.local`).
1. Parcourez l'écran d'accueil (**Continuer** puis **Commencer**, ou **Passer**).
2. Trois sources de démonstration sont installées automatiquement : *Sales DB*, *Odoo ERP* (simulé) et *Budget.xlsx*.
3. Posez par exemple : « Quelle est l'évolution mensuelle du chiffre d'affaires ? », « Marge par catégorie », « Quelles erreurs comptables ? », « Budget vs réel ».
   Le moteur **Demo Advisor** répond sans clé API.

## 4. Utiliser votre propre LLM (analyses libres)

1. Barre latérale → **Paramètres LLM** (ou le sélecteur de modèle en haut à droite).
2. Choisissez le fournisseur (Anthropic, OpenAI, Gemini, DeepSeek), collez votre clé API, cliquez **Enregistrer & tester** (pastille verte = OK).
3. Choisissez le modèle. Si un modèle de la liste n'existe plus chez le fournisseur, saisissez l'identifiant d'un modèle récent dans **ID de modèle personnalisé**.

La clé est chiffrée et conservée uniquement dans votre navigateur.

## 5. Connecter vos données

Bouton **Sources** (en haut) :

- **Bases de données** : PostgreSQL, MySQL, SQL Server, SQLite, MongoDB (lecture seule). Pour SQLite, le chemin du fichier est celui de **l'ordinateur qui exécute le serveur**, ex. `C:\data\ma_base.sqlite`.
- **Odoo** : URL, nom de la base, utilisateur, clé API.
- **Google** : nécessite votre propre *OAuth Client ID* (Google Cloud Console → Identifiants → Application Web, API Drive et Sheets activées, origine autorisée `http://localhost:3000`).
- **Fichiers** : glisser-déposer Excel, CSV, PDF, Word ou texte.

## 6. Lancer en mode production (optionnel, plus rapide)

```powershell
npm run build
npm start
```

L'application est alors disponible sur http://localhost:3000. Pour changer de port : `npm start -- -p 4000`.

## 7. Problèmes fréquents

| Symptôme | Solution |
|---|---|
| `npm` n'est pas reconnu | Installez Node.js puis rouvrez le terminal. |
| PowerShell : « l'exécution de scripts est désactivée » | Utilisez l'invite de commandes (`cmd`), ou exécutez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| Erreur pendant `npm install` à propos de `better-sqlite3`, `mssql`, `mysql2`, `pg` ou `mongodb` | Ces pilotes sont facultatifs : l'installation continue, l'application fonctionne (seul le connecteur concerné sera indisponible). Pour SQLite, installez les « Outils de build C++ » de Visual Studio puis relancez `npm install`. |
| `Port 3000 is already in use` | Fermez l'autre programme ou lancez `npm run dev -- -p 3001` puis ouvrez http://localhost:3001. |
| Page blanche / comportement étrange après une mise à jour | Supprimez le dossier `.next` puis relancez `npm run dev`. |
| Police différente de la maquette | Elle se charge depuis Google Fonts : sans internet, la police système est utilisée (sans impact fonctionnel). |
| Mot de passe administrateur oublié | Arrêtez l'application, supprimez `data\users.json` : l'écran de création du premier administrateur réapparaît (les données des utilisateurs restent dans leurs navigateurs). |
| Données ou clés à réinitialiser | Dans le navigateur : F12 → Application → *Clear site data* pour `localhost:3000`. |

## 8. Pour aller plus loin

Voir `README.md` (architecture, sécurité, détail des connecteurs).
