# BI Advisor — Conseiller Business Intelligence (BYOK, multi-sources)

Application web Next.js 15 (App Router, React 19, Tailwind) pour interroger, analyser et visualiser des données hétérogènes avec le LLM de votre choix.

## Démarrage

```bash
npm install
npm run dev        # http://localhost:3000
```

L'application est **testable immédiatement** : l'onboarding installe 3 sources de démonstration (Sales DB, Odoo mock, Budget.xlsx) et le moteur « Demo Advisor » répond sans clé API. Essayez : « évolution mensuelle du CA », « marge par catégorie », « erreurs comptables », « budget vs réel ».

Pour de vraies analyses en langage naturel : ⚙️ Paramètres LLM → collez votre clé (Anthropic, OpenAI, Gemini, DeepSeek) → « Enregistrer & tester ».

## Architecture

```
src/
  app/api/llm/{chat,test}        Proxy LLM streaming + testeur de clé (la clé n'est jamais stockée serveur)
  app/api/connectors/{test,schema,query}   Connecteurs distants (lecture seule)
  server/llm.ts                  Adaptateurs Anthropic / OpenAI / Gemini / DeepSeek
  server/connectors/             sql.ts (PG, MySQL, MSSQL, SQLite) · mongo.ts · odoo.ts (JSON-RPC)
  lib/vault.ts                   Chiffrement AES-GCM (clé non exportable en IndexedDB) pour clés API & identifiants
  lib/llm/                       models (contexte/coûts), prompts, client streaming, demo-provider
  lib/connectors/                local-engine (alasql), demo-data, files (xlsx/csv/pdf/docx), google, remote
  lib/bi/                        anomaly (z-score robuste), rag (embeddings locaux), blocks, pivot, export
  lib/actions.ts                 Orchestration : chat → LLM → blocs ```bi-query → exécution → widgets
  components/                    onboarding · layout · chat · canvas · settings · connectors · report
```

### Principe « Text-to-Query »
Le LLM reçoit uniquement le **schéma** (tables, colonnes, FK) des sources actives, jamais les données complètes. Il répond en Markdown avec des blocs ```` ```bi-query ```` (JSON : source, type sql/odoo/mongo, requête, spec de visualisation). L'application exécute la requête, crée le widget (barres, courbe, aire, camembert, KPI, tableau, pivot), détecte les anomalies et renvoie un résumé des résultats au tour suivant. En cas d'erreur : bouton « Corriger avec l'IA ».

### Sécurité
- BYOK : clés chiffrées localement ; envoyées au proxy uniquement le temps d'un appel, jamais loguées.
- **Compte SGBD en lecture seule obligatoire** : c'est la seule garantie réelle côté base (exemples ci-dessous). Les garde-fous applicatifs ne font que la doubler :
  - une seule instruction commençant par `SELECT` ou `WITH` ; analyse lexicale par dialecte (chaînes, identifiants cités, commentaires) puis blocage des mots-clés et fonctions d'écriture ou d'accès fichier/réseau (`INTO`, `OPENROWSET`, `LOAD_FILE`, `pg_read_file`, `dblink`, `FOR UPDATE`…) ; commentaires `/* */` refusés ; en MySQL, chaînes contenant `\` refusées ;
  - transaction lecture seule (PostgreSQL `BEGIN READ ONLY` + curseur, MySQL `START TRANSACTION READ ONLY`), transaction **toujours annulée** sur SQL Server, base ouverte en lecture seule (`query_only`) sur SQLite ;
  - **1 000 lignes maximum**, limitées côté SGBD (curseur, `sql_select_limit` + lecture en flux, `SET ROWCOUNT`), et **délai de 30 s** par requête (PostgreSQL, MySQL/MariaDB, SQL Server) ; pipelines Mongo sans `$out/$merge`.
- **Politique réseau (anti-SSRF)** : toute connexion sortante pilotée par l'utilisateur (API REST, Airtable, Notion, Odoo, URL de base LLM personnalisée, hôtes PostgreSQL/MySQL/SQL Server, URI MongoDB) est contrôlée **après résolution DNS**, et les connexions HTTP et SQL se font sur l'adresse vérifiée (anti DNS-rebinding). Par défaut (`BI_NETWORK_POLICY=public`), les adresses internes (loopback, réseaux privés, CGNAT, ULA IPv6…) sont refusées sauf si l'hôte figure dans `BI_ALLOWED_HOSTS` ; `BI_NETWORK_POLICY=allowlist` n'autorise **que** la liste blanche (recommandé en production). Les adresses link-local / métadonnées cloud (`169.254.0.0/16`, `fe80::/10`), `0.0.0.0/8`, multicast et broadcast restent **toujours** interdites. Redirections HTTP non suivies, identifiants dans l'URL refusés, réponses plafonnées à 20 Mo, corps des erreurs distantes jamais renvoyés au navigateur, options MongoDB dangereuses refusées (`proxyHost`, `tlsCAFile`, `authMechanism=MONGODB-AWS`…). Un proxy sortant filtrant au niveau de l'infrastructure reste recommandé en complément.
- **Contenu produit par le LLM** : les images Markdown ne sont jamais chargées (un marqueur « Image non affichée (protection des données) » les remplace), seuls les liens `https:`, `mailto:` et les ancres restent cliquables (ouverts sans référent), le HTML brut est ignoré ; en-tête `Content-Security-Policy: img-src 'self' data: blob:` sur toutes les pages.
- Les identifiants de connecteurs sont chiffrés dans le vault ; les fichiers uploadés restent dans le navigateur (non persistés).
- Pour la production : l'authentification est intégrée (voir ci-dessous) ; servez l'application en HTTPS, renseignez `BI_ALLOWED_HOSTS` pour les cibles internes et préférez `BI_NETWORK_POLICY=allowlist`. Un rate-limit global sur `/api/*` n'est pas encore fourni (évolution prévue) : appliquez-le au niveau du reverse-proxy.

#### Créer un compte en lecture seule
PostgreSQL :
```sql
CREATE ROLE lecteur_bi LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE ma_base TO lecteur_bi;
GRANT USAGE ON SCHEMA public TO lecteur_bi;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lecteur_bi;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lecteur_bi;
ALTER ROLE lecteur_bi SET default_transaction_read_only = on;
```
MySQL / MariaDB (sans les privilèges `FILE`, `PROCESS` ni `SUPER`) :
```sql
CREATE USER 'lecteur_bi'@'%' IDENTIFIED BY '…';
GRANT SELECT, SHOW VIEW ON ma_base.* TO 'lecteur_bi'@'%';
```
SQL Server (ni `db_owner`, ni `sysadmin`) :
```sql
CREATE LOGIN lecteur_bi WITH PASSWORD = '…';
CREATE USER lecteur_bi FOR LOGIN lecteur_bi;
ALTER ROLE db_datareader ADD MEMBER lecteur_bi;
```

## Authentification & utilisateurs
- **Premier accès** : un écran vous demande de créer le compte administrateur (ou définissez `ADMIN_EMAIL` / `ADMIN_PASSWORD`, voir `.env.example`). Si `SETUP_TOKEN` est défini (32 caractères minimum), l'écran exige ce jeton ; sur un hébergement public (Vercel), l'initialisation est **désactivée** tant que ni `SETUP_TOKEN` ni `ADMIN_EMAIL` / `ADMIN_PASSWORD` ne sont définis.
- **Stockage des comptes** : en local, `data/users.json` (mots de passe hachés **scrypt**, fichier en 600), sans aucun service externe ; en hébergé (Vercel, ou `BI_HOSTED=true`), une base **PostgreSQL dédiée** (`BI_AUTH_DATABASE_URL` ou `DATABASE_URL`, tables `bia_*`). Session par cookie **HttpOnly / SameSite=Lax** signé HMAC (7 jours, `Secure` automatique en HTTPS). Changer ou réinitialiser un mot de passe, désactiver un compte ou changer un rôle **révoque immédiatement** les sessions concernées, sur toutes les instances.
- **`AUTH_SECRET`** : 16 caractères minimum ; obligatoire en hébergé (sinon « Configuration incomplète »). En local, s'il est absent, un secret est généré dans `data/auth-secret`.
- Toutes les routes `/api/*` exigent une session valide ; `/api/admin/*` exige le rôle administrateur ; contrôle d'origine (anti-CSRF) sur les requêtes modifiantes ; blocage 10 min après 5 échecs de connexion (par IP + e-mail) ou 10 échecs (par e-mail), partagé entre instances en hébergé ; même limite (5 essais par IP) sur l'initialisation.
- **Journal d'audit** : `data/audit.log` en local ; table `bia_auth_audit` en hébergé (consultable dans `/admin` > Utilisateurs, ou en SQL). Si l'écriture échoue, l'événement (sans secret) est émis dans les journaux de la plateforme (*Runtime Logs* sur Vercel, rétention courte) et la requête aboutit quand même.
- **Rôles** : *Administrateur* (gestion des comptes, journal d'audit, diagnostic serveur) et *Utilisateur*. Chaque utilisateur a ses propres clés LLM, connexions et analyses : les données du navigateur sont **isolées par compte** (clés de stockage et coffre séparés).
- Les données déjà présentes avant l'authentification sont reprises par le premier compte qui se connecte sur ce navigateur.
- Mot de passe : 10 caractères minimum avec lettres et chiffres.
- `AUTH_DISABLED=true` désactive l'authentification (poste local uniquement). En production : HTTPS obligatoire (reverse-proxy) et sauvegarde du dossier `data/` (mode fichier) ou de la base (mode PostgreSQL).
- Mode fichier : un seul processus Node par dossier `data/` (les écritures sont sérialisées dans le processus, pas entre plusieurs processus).

## Déployer sur Vercel
> Ce guide vise un déploiement **Preview**. La **mise en production est déconseillée** tant que la recette P0 du sprint `2026-11-10-securite-p0` (connecteurs PostgreSQL, MySQL/MariaDB, SQL Server réels, routes LLM) n'a pas été rejouée.

**1. Pré-requis** : un compte Vercel, le CLI (`npm i -g vercel`) et une base **PostgreSQL dédiée aux comptes**, jamais une base cliente. Le plus simple : *Vercel > Storage (Marketplace) > Neon*, qui injecte `DATABASE_URL` dans le projet. Prévoyez une branche Neon distincte pour Preview et pour Production.

**2. Nom du projet** : le CLI refuse les majuscules et les espaces (un dossier nommé `Bi-Advisorgeneric` est rejeté). Liez le dépôt avec un nom en minuscules :
```bash
vercel link                               # à la question du nom du projet, saisir : bi-advisor
vercel link --yes --project bi-advisor    # variante non interactive (vérifiez les options avec « vercel link --help »)
```

**3. Variables d'environnement** (*Settings > Environment Variables*, ou `vercel env add <NOM> preview`) :

| Variable | Rôle | Obligatoire | Environnements |
|---|---|---|---|
| `AUTH_SECRET` | Signature des sessions, ≥ 16 caractères (32 recommandés), ex. `openssl rand -hex 32` | **Oui** | Preview, Production : **valeurs distinctes** |
| `DATABASE_URL` ou `BI_AUTH_DATABASE_URL` | Base des comptes (URL « pooled », `sslmode=require`) ; `BI_AUTH_DATABASE_URL` est prioritaire | **Oui** | Preview, Production (branches Neon distinctes recommandées) |
| `SETUP_TOKEN` | Jeton d'initialisation, ≥ 32 caractères, saisi dans l'écran d'initialisation ; à retirer après l'initialisation | L'un **ou** l'autre | Preview, Production |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` (`ADMIN_NAME`) | Création automatique de l'administrateur au premier accès ; retirez `ADMIN_PASSWORD` ensuite | L'un **ou** l'autre | Preview, Production |
| `BI_AUTH_STORE` | Forcer `postgres` (`file` est refusé en hébergé) | Non | — |
| `BI_HOSTED` | Hébergement sans disque persistant **hors** Vercel (sur Vercel : automatique) | Non | — |
| `BI_ALLOWED_HOSTS`, `BI_NETWORK_POLICY` | Inchangés (voir `.env.example`) ; les cibles internes doivent être joignables depuis Vercel | Selon les besoins | Preview, Production |
| `BI_SQLITE_DIR` | **Inutilisable sur Vercel** (disque éphémère) : ne pas définir | Non | — |

Exemples **factices** uniquement : `AUTH_SECRET=remplacez-par-64-caracteres-hexadecimaux`, `SETUP_TOKEN=jeton-factice-a-remplacer-0123456789abcdef`. Ne commitez jamais de valeur réelle.

**4. Déploiement et initialisation** : `vercel deploy` (Preview). Ouvrez l'URL : avec `SETUP_TOKEN`, saisissez le jeton puis créez le compte administrateur ; avec `ADMIN_*`, connectez-vous directement. Sans aucun des deux, l'écran « Initialisation non configurée » s'affiche et l'API refuse toute initialisation.

**5. Limites** :
- disque **éphémère** : SQLite et fichiers serveur indisponibles ; comptes et journal sont en base ;
- les bases et API **internes** doivent être exposées et joignables depuis Vercel (et ajoutées à `BI_ALLOWED_HOSTS`) ;
- gardez la **Deployment Protection** (Vercel Authentication) active sur les Preview ;
- alignez la région des fonctions sur celle de la base (*Settings > Functions*) pour limiter la latence (une requête SQL par appel API) ;
- `pg` fait partie des dépendances optionnelles : si son installation échoue, l'application répond « Service d'authentification momentanément indisponible » (pilotes visibles dans `/admin` > Vue d'ensemble).

**6. Schéma** : créé automatiquement au premier accès. Pour un rôle PostgreSQL sans droit `CREATE`, exécutez-le au préalable :
```sql
CREATE TABLE IF NOT EXISTS bia_users (
  id text PRIMARY KEY, email text NOT NULL, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','user')), hash text NOT NULL, salt text NOT NULL,
  created_at bigint NOT NULL, disabled boolean NOT NULL DEFAULT false,
  token_version integer NOT NULL DEFAULT 1, last_login bigint);
CREATE UNIQUE INDEX IF NOT EXISTS bia_users_email_uq ON bia_users (email);
CREATE TABLE IF NOT EXISTS bia_login_attempts (key text PRIMARY KEY, n integer NOT NULL, until_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS bia_auth_audit (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL, actor text NOT NULL, detail text NOT NULL DEFAULT '', ip text NOT NULL DEFAULT '');
```
Voir aussi les [Notes de migration](#notes-de-migration-correctifs-de-sécurité-de-novembre-2026).

## Page d'administration (`/admin`)
Accessible depuis la barre latérale (« Administration »). Quatre sections :
- **Vue d'ensemble** : LLM actif et état de la clé, nombre de sources et erreurs, diagnostic serveur (version Node, pilotes PostgreSQL/MySQL/SQL Server/SQLite/MongoDB installés ou non).
- **Modèles LLM** : Anthropic, OpenAI, Gemini, DeepSeek et **NVIDIA NIM** (cloud `https://integrate.api.nvidia.com/v1` ou NIM auto-hébergé : saisir l'URL de base, clé facultative). URL de base aussi disponible pour OpenAI/DeepSeek (proxys compatibles). **Modèles chargés dynamiquement** : à la validation de la clé, la liste réelle des modèles du compte est récupérée via l'API du fournisseur (aucun modèle codé en dur ; bouton « Actualiser », filtre de recherche), modèle actif, ID de modèle personnalisé, température, tokens max et **consignes d'administrateur** injectées dans le prompt système.
- **Connecteurs** : liste des connexions enregistrées (tester, actualiser le schéma / resynchroniser, inclure/exclure du contexte, voir la configuration masquée, supprimer) et catalogue d'ajout (bases SQL/Mongo, Odoo, Google, API REST, Airtable, Notion, fichiers, démo).
- **Utilisateurs** (administrateurs) : créer / désactiver / supprimer des comptes, rôles, réinitialisation de mot de passe, journal d'audit. **Mon compte** : changement de mot de passe, déconnexion.
- **Données & sécurité** : export / import chiffré (PBKDF2 + AES-GCM) de toute la configuration pour migrer de navigateur, effacement des secrets, réinitialisation.

Stockage : clés et identifiants restent chiffrés **dans le navigateur** de chaque utilisateur ; seuls les comptes sont côté serveur.

## Connecteurs
| Source | Détails |
|---|---|
| PostgreSQL / MySQL / SQL Server / SQLite / MongoDB | Test de connexion, inspection du schéma (FK incluses), requêtes lecture seule avec un **compte SGBD en lecture seule obligatoire**. Hôte, port et identifiants uniquement (chaînes de connexion refusées, sauf l'URI MongoDB) ; SQL Server : `hote\INSTANCE` accepté. SQLite : fichier `.sqlite`, `.sqlite3` ou `.db` situé dans le dossier **`BI_SQLITE_DIR`** du serveur (nom relatif, ex. `ventes.sqlite`) ; SQLite est désactivé si la variable n'est pas définie. |
| Odoo | JSON-RPC (URL, base, utilisateur, clé API). Saisissez l'URL **finale** en `https://` (les redirections ne sont pas suivies). Modèles analysés : sale.order(.line), purchase.order(.line), account.move(.line), crm.lead, stock.quant, product.product, res.partner. Requêtes `search_read` / `read_group`. |
| Google Sheets / Drive | OAuth2 (Google Identity Services) avec **votre** Client ID, sélecteur de feuilles Drive ; ou feuille publique + clé API. Nécessite d'ajouter l'URL de l'app aux origines JS autorisées. |
| API REST / JSON | Tout endpoint HTTP (GET/POST), auth Bearer / Basic / en-tête / paramètre d'URL, chemin des données (`data.items`), pagination par paramètre, objets imbriqués aplatis (`client_name`). |
| Airtable | Jeton d'accès personnel + ID de base : toutes les tables et leurs enregistrements. |
| Notion | Jeton d'intégration : bases de données partagées avec l'intégration (propriétés aplaties). |
| Fichiers | Excel multi-onglets, CSV (types auto), PDF (texte + tableaux détectés), DOCX, TXT. Texte → RAG local (embeddings hachés, sans réseau). |

Les sources API (REST, Airtable, Notion) sont lues côté serveur (5 000 lignes max/table), chargées dans le moteur SQL du navigateur et **resynchronisées à chaque démarrage**.

Les connexions vers des adresses **internes** (base sur le réseau local, `localhost`, NIM auto-hébergé, API intranet) nécessitent que l'administrateur les ajoute à `BI_ALLOWED_HOSTS` (voir `.env.example`). Préférez des entrées IP/CIDR pour les cibles internes : une entrée par nom autorise toutes les adresses vers lesquelles ce nom est résolu.

## Notes de migration (correctifs de sécurité de novembre 2026)
Changements susceptibles de casser une installation existante :
- **Destinations internes bloquées** : bases, API REST, Odoo ou NIM sur `localhost` / réseau privé → ajoutez-les à `BI_ALLOWED_HOSTS` (ex. `localhost:8000,10.0.0.0/8,db.interne.local:5432`).
- **SQLite désactivé par défaut** : définissez `BI_SQLITE_DIR` (jamais le dossier `data/`), placez-y les bases et ressaisissez le chemin sous la forme `ventes.sqlite`.
- **Requêtes SQL** : seules `SELECT` / `WITH` sont acceptées (`SHOW`, `DESCRIBE`, `EXPLAIN`, `PRAGMA` ne le sont plus) ; commentaires `/* */` refusés (utilisez `--`) ; en MySQL, chaînes contenant `\` refusées ; un nom de colonne égal à un mot-clé bloqué (`set`, `lock`, `begin`, `save`… et, en SQL Server, `open`, `close`, `use`…) doit être cité ; en SQL Server, une requête contenant plusieurs instructions sans `;` est refusée.
- **SQL Server, littéraux numériques** : un nombre (`1`, `1.5`, `1e3`, `$10`, `0x1F`) doit être séparé du mot qui le suit par un espace ou un opérateur (`1 FROM`, pas `1FROM`), sinon la requête est refusée ; `raiserror` et `add` rejoignent la liste des mots bloqués.
- **Caractères de contrôle** (tous dialectes, littéraux compris) : une requête contenant un retour chariot isolé (`\r` non suivi de `\n`), un autre caractère de contrôle (hors tabulation et fin de ligne) ou `U+2028`/`U+2029` est refusée ; pour un tel caractère dans une valeur, utilisez `CHR(13)` (PostgreSQL) ou `CHAR(13)` (MySQL, SQL Server, SQLite).
- **PostgreSQL** : la session impose `standard_conforming_strings=on` ; un intermédiaire (pooler) qui ignore ce paramètre de démarrage rend le connecteur inutilisable (message explicite).
- **Chaînes de connexion SQL** (`url`) refusées : renseignez hôte, port et identifiants.
- **Redirections HTTP non suivies** (API REST, Odoo, URL de base LLM) : indiquez l'URL finale.
- **URL de base LLM** : acceptée uniquement pour OpenAI, DeepSeek et NVIDIA NIM (refusée pour Anthropic et Gemini) ; en `http://`, uniquement pour un hôte en liste blanche.
- **MongoDB** : options `proxyHost`, `tlsCAFile`, `tlsCertificateKeyFile`, `authMechanismProperties`, `srvServiceName` et mécanismes `MONGODB-AWS`, `MONGODB-OIDC`, `GSSAPI`, `MONGODB-X509`, `PLAIN` refusés.
- **`AUTH_SECRET` trop court refusé** : une valeur définie de moins de 16 caractères était ignorée en silence ; elle bloque désormais la connexion (« Configuration incomplète »), y compris en local. Allongez-la ou supprimez la variable (en local, un secret est alors généré dans `data/auth-secret`).
- **Initialisation sur un hébergement public** : sur Vercel (ou `BI_HOSTED=true`), la création du premier administrateur exige `SETUP_TOKEN` ou passe par `ADMIN_EMAIL` / `ADMIN_PASSWORD` ; sans l'un ni l'autre, elle est désactivée. En local, si `SETUP_TOKEN` est défini, le jeton est aussi exigé. Voir [Déployer sur Vercel](#déployer-sur-vercel).
- **Contributeurs** : `requireAuth` (synchrone) est remplacé par `authorize` (asynchrone). Toute route protégée commence par `const a = await authorize(req); if (a instanceof Response) return a;` : sans `await`, le contrôle serait silencieusement contourné ; le test `tests/unit/route-guard.test.ts` l'interdit. Les fonctions de `src/server/auth/store.ts` et `audit.ts` sont désormais asynchrones.

## Fonctionnalités BI
Auto-EDA à la connexion (3–5 questions, générées par le LLM ou heuristique), détection d'anomalies (pics/creux/baisses signalés sur les graphiques), rapport exécutif (Markdown + annexes graphiques, export PDF), exports PNG / CSV / Excel, widgets réorganisables par glisser-déposer, citation de tables avec `@`, bascule de modèle à chaud, thème clair/sombre.

## Notes
- Les modèles ne sont jamais codés en dur : ils sont chargés depuis l'API du fournisseur après validation de la clé. Les API ne publiant pas les tarifs, les coûts ne sont estimés que si vous saisissez les prix ($/M tokens) du modèle dans la configuration LLM.
- Les drivers de bases sont des `optionalDependencies` : l'app fonctionne même si l'un d'eux ne s'installe pas.
- Polices : Plus Jakarta Sans via Google Fonts (repli sur la police système hors-ligne).
- Mascotte « Bibo » : illustration SVG originale, inspirée de l'ambiance de la maquette fournie.
