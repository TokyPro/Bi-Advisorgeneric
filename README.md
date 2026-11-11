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
- **Premier accès** : un écran vous demande de créer le compte administrateur (ou définissez `ADMIN_EMAIL` / `ADMIN_PASSWORD`, voir `.env.example`).
- Comptes stockés dans `data/users.json` (mots de passe hachés **scrypt**, fichier en 600) ; session par cookie **HttpOnly / SameSite=Lax** signé HMAC (7 jours, `Secure` automatique en HTTPS). Changer ou réinitialiser un mot de passe, désactiver un compte ou changer un rôle **révoque immédiatement** les sessions concernées.
- Toutes les routes `/api/*` exigent une session valide ; `/api/admin/*` exige le rôle administrateur ; contrôle d'origine (anti-CSRF) sur les requêtes modifiantes ; blocage 10 min après 5 échecs de connexion (par IP + e-mail) ; journal d'audit `data/audit.log`.
- **Rôles** : *Administrateur* (gestion des comptes, journal d'audit, diagnostic serveur) et *Utilisateur*. Chaque utilisateur a ses propres clés LLM, connexions et analyses : les données du navigateur sont **isolées par compte** (clés de stockage et coffre séparés).
- Les données déjà présentes avant l'authentification sont reprises par le premier compte qui se connecte sur ce navigateur.
- Mot de passe : 10 caractères minimum avec lettres et chiffres.
- `AUTH_DISABLED=true` désactive l'authentification (poste local uniquement). En production : HTTPS obligatoire (reverse-proxy) et sauvegarde du dossier `data/`.

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

## Fonctionnalités BI
Auto-EDA à la connexion (3–5 questions, générées par le LLM ou heuristique), détection d'anomalies (pics/creux/baisses signalés sur les graphiques), rapport exécutif (Markdown + annexes graphiques, export PDF), exports PNG / CSV / Excel, widgets réorganisables par glisser-déposer, citation de tables avec `@`, bascule de modèle à chaud, thème clair/sombre.

## Notes
- Les modèles ne sont jamais codés en dur : ils sont chargés depuis l'API du fournisseur après validation de la clé. Les API ne publiant pas les tarifs, les coûts ne sont estimés que si vous saisissez les prix ($/M tokens) du modèle dans la configuration LLM.
- Les drivers de bases sont des `optionalDependencies` : l'app fonctionne même si l'un d'eux ne s'installe pas.
- Polices : Plus Jakarta Sans via Google Fonts (repli sur la police système hors-ligne).
- Mascotte « Bibo » : illustration SVG originale, inspirée de l'ambiance de la maquette fournie.
