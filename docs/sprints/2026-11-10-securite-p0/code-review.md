# Revue de code — Sprint `2026-11-10-securite-p0` (correctifs de sécurité P0)

- **Relecteur** : Code Reviewer & Git · **Tâche orchestrateur** : #8 · **Date** : 2026-11-10
- **Branche** : `fix/2026-11-10-securite-p0` (arbre de travail non commité ; aucune opération Git d'écriture pendant cette revue)
- **Entrées** : `architecture.md` (Gherkin § 1, ADR § 3, tâches § 4, catalogue § 6, checklist § 8, décisions GATE 2), `dev-notes.md`, `git diff` + fichiers non suivis, audit `docs/audits/2026-11-10-audit-global.md` (C1, S1, S2, S3, S9)
- **Revue renforcée 🔒** : toutes les stories sont sensibles.

---

## Itération 1

### 1. Périmètre revu

| Fichier | Tâches | Nature |
|---|---|---|
| `src/lib/markdown-safety.ts`, `src/components/ui/SafeMarkdown.tsx` | T-1 | nouveaux |
| `src/components/chat/MessageBubble.tsx`, `src/components/report/ReportModal.tsx` | T-2 | modifiés |
| `next.config.mjs` | T-3 | modifié |
| `src/server/connectors/sqlite-path.ts` | T-4 | nouveau |
| `src/server/connectors/sql.ts`, `src/components/connectors/ConnectorsModal.tsx` | T-5, T-11, T-14, T-15, T-16 | modifiés |
| `src/server/net/policy.ts`, `src/server/net/safe-fetch.ts` | T-6, T-7 | nouveaux |
| `src/server/connectors/saas.ts`, `odoo.ts`, `mongo.ts`, `index.ts` | T-8, T-9, T-11, T-12 | modifiés |
| `src/server/llm.ts`, `src/app/api/llm/{chat,test}/route.ts` | T-10 | modifiés |
| `src/server/connectors/sql-guard.ts` | T-13 | nouveau |
| `.env.example`, `README.md` | T-16, T-17 | modifiés |

Les 17 tâches T-1 à T-17 sont couvertes. Aucune dérive de périmètre. `package.json`, `tsconfig.json`, `src/server/auth/**`, `src/lib/vault.ts`, `src/lib/types.ts`, `store.ts`, `actions.ts` et `data/` ne sont pas modifiés.

En plus de la lecture, j'ai vérifié le code des pilotes installés (`node_modules`, en lecture seule) : mysql2 3.24.6, pg 8.23.1, mssql 11.0.2, tedious 20.3.8, react-markdown 9.1.0, mongodb 6.22.0. J'ai aussi lancé des sondes jetables par `node`, depuis le scratchpad de session et hors dépôt, sur `sql-guard.ts` et `markdown-safety.ts`.

### 2. Vérifications exécutées

| Commande | Résultat |
|---|---|
| `git status` / `git diff --stat` | 14 fichiers modifiés (+330 / −104) ; 6 nouveaux modules + `docs/` non suivis ; `.claude/`, `.omc/`, `AGENTS_README.md`, `CLAUDE.md` non suivis (hors périmètre de cette revue, à traiter au moment des commits) |
| `npx tsc --noEmit` | ✅ 0 erreur (relancé par le reviewer) |
| `npm run build` | non relancé (facultatif dans l'assignation) ; succès déclaré par le Dev (`dev-notes.md` § 4) |
| Recherche `react-markdown` / `rehype` / `dangerouslySetInnerHTML` | `react-markdown` importé uniquement dans `SafeMarkdown.tsx` ✅ ; seul `dangerouslySetInnerHTML` : script de palette existant de `layout.tsx` (inchangé) ✅ |
| Recherche `fetch(` dans `src/server/**` | seuls restent les hôtes constants Anthropic (`llm.ts:68`), Gemini (`llm.ts:112`) et les bases officielles OpenAI/DeepSeek/NVIDIA (`llm.ts:142`, `custom=false`) ✅ |
| `requireAuth` sur les routes modifiées | conservé en tête de `/api/llm/chat` et `/api/llm/test` ; les routes `/api/connectors/*` sont inchangées et protégées ✅ |
| Hygiène (`TODO`, `console.log`, `.only/.skip`, `any` nouveau) | aucun ✅ ; `catch` vides tous commentés ou explicites ✅ ; `console.warn/error` uniquement pour une configuration invalide, sans donnée utilisateur ✅ |

### 3. Constats

| ID | Gravité | Story / tâche | Fichier:ligne | Constat |
|---|---|---|---|---|
| CR-1 | 🔴 **Bloquant** | US-4 / T-13, T-14 | `sql-guard.ts:28`, `:125-126` ; `sql.ts:121-141`, `:227-230` | En T-SQL, plusieurs instructions sans `;` : on sort de la transaction annulée par `COMMIT`/`ROLLBACK`, et des écritures hors liste passent |
| CR-2 | 🔴 **Bloquant** | US-3 / T-11 | `sql.ts:124-129` (tedious `connection.js:1168-1170`, `:1299-1306`) | SSRF SQL Server : tedious suit le jeton de **routage** TDS vers n'importe quel hôte, sans passer par la politique réseau |
| CR-3 | 🟠 Majeur | US-4 / T-14 | `sql.ts:74`, `:97-117` | MySQL en flux : une erreur fatale de connexion est émise sur `connection` sans écouteur, ce qui **fait planter le processus Node** |
| CR-4 | 🟠 Majeur | US-4 / T-13 | `sql-guard.ts:85-86` ; `sql.ts:43-49` | PostgreSQL : l'analyseur suppose `standard_conforming_strings=on`. Si le serveur ou le rôle l'a désactivé, on peut cacher du code dans une « chaîne » |
| CR-5 | 🟠 Majeur | US-2 / T-4 | `sqlite-path.ts:49-53` | `lstatSync` est appelé **avant** le contrôle de confinement. Sous Windows, un chemin UNC (`\\hote\partage\x.db`) déclenche un accès SMB sortant |
| CR-6 | 🟡 Mineur | US-4 / T-13 | `sql-guard.ts:25` | Fonctions à effet de bord ou d'accès fichier absentes de la liste (privilèges élevés requis) |
| CR-7 | 🟡 Mineur | US-3 / T-6 | `policy.ts:207`, `:245` | Option Mongo `srvServiceName` non interdite : le pilote interroge un autre enregistrement SRV que celui contrôlé |
| CR-8 | 🟡 Mineur | US-3 / T-10 | `api/llm/chat/route.ts:19-21` | Les erreurs réseau brutes (IP, détail TLS) d'une base LLM personnalisée sont renvoyées au client |
| CR-9 | 🟡 Mineur | US-4 / T-14 | `sql.ts:101` | `core.destroy()` (mysql2) ne fait qu'un `stream.end()` : le reste du résultat continue d'être reçu et analysé |
| CR-10 | 🟡 Mineur | US-3 / T-11 (R-3) | `sql.ts:127` | `options.serverName` de tedious non utilisé : SNI absent avec l'IP épinglée (cas Azure SQL) |
| CR-11 | 🟡 Mineur | US-3 / T-11 | `sql.ts:125` | Avec `hote\INSTANCE`, le port découvert par SQL Browser n'est pas confronté aux entrées `hote:port` de la liste blanche |
| CR-12 | 🟡 Mineur | US-3 / T-6 | `policy.ts:27-29` | Plages IPv6 complémentaires non classées internes : `64:ff9b:1::/48`, `fec0::/10`, `2001::/32` (Teredo) |

#### CR-1 🔴 Bloquant : T-SQL multi-instructions sans `;`, sortie de la transaction annulée

- **Constat** : le contrôle « une seule instruction » repose sur la recherche de `;` (`sql-guard.ts:125`). En T-SQL, les instructions d'un lot n'ont pas besoin de `;`. `mssql.Request.query()` envoie un **batch** (`execSqlBatch`), qui exécute donc tout le lot. La liste noire (`sql-guard.ts:28`) ne contient ni `commit`, ni `rollback`, ni `save`, ni `begin`, ni plusieurs instructions d'écriture T-SQL.
- **Preuves** (sonde `node` sur `assertReadOnly(…, 'mssql')`, toutes **ACCEPTÉES**) :
  `SELECT 1 COMMIT` · `SELECT 1 COMMIT DENY SELECT ON t TO public` · `SELECT 1 ROLLBACK DISABLE TRIGGER ALL ON t` · `SELECT 1 WRITETEXT t.c 0x… 'x'` · `SELECT 1 RECEIVE * FROM q` · `SELECT * FROM t SELECT 2`.
- **Scénario d'échec** : une requête produite par le LLM (injection de prompt dans les données ou dans une question) ou saisie par l'utilisateur contient `SELECT 1 COMMIT <instruction>`. `COMMIT` valide la transaction ouverte par `withMssql` (`@@TRANCOUNT` passe de 1 à 0). Les instructions suivantes s'exécutent en **autocommit**. Le `tx.rollback()` du `finally` (`sql.ts:135`) échoue en silence, car son `catch` est commenté « transaction déjà annulée ». L'écriture est persistée (`WRITETEXT`/`UPDATETEXT`, `DENY`, `DISABLE TRIGGER`, `RECEIVE` qui vide une file Service Broker…) dès que le compte n'est pas strictement en lecture seule. La couche 4 de l'ADR-S3-01 (« transaction systématiquement annulée ») et l'invariant n° 1 (« une seule instruction SELECT ») sont donc contournés. Le README promet pourtant « transaction toujours annulée sur SQL Server ».
- **Correction attendue** :
  1. Ajouter à la liste noire, pour **tous** les dialectes, le contrôle transactionnel : `commit`, `rollback`, `save`, `savepoint`, `begin`, `release`. Aucune requête de lecture légitime n'en a besoin (un identifiant de ce nom reste utilisable entre guillemets).
  2. Pour `mssql`, ajouter les instructions T-SQL d'écriture ou de contexte hors liste : `deny`, `writetext`, `updatetext`, `receive`, `send`, `disable`, `enable`, `use`, `setuser`, `revert`, `checkpoint`, `open`, `close`, `fetch`, et la séquence `end conversation`. Contrôler aussi qu'aucun `select` n'apparaît en tête d'instruction au niveau 0 de parenthèses, sauf après `union`/`except`/`intersect` ou dans une CTE. Une solution alternative peut être arbitrée avec le Tech Lead.
  3. Défense en profondeur dans `withMssql` : après `fn`, exécuter `SELECT @@TRANCOUNT AS n` dans la transaction. Si `n !== 1`, lever une erreur générique avant de renvoyer les lignes.
  4. Ajouter les cas ci-dessus à `sql-guard.check.mjs` (exigence § T-13 : « tout ajout doit être couvert par un cas de test »).

#### CR-2 🔴 Bloquant : SSRF SQL Server par redirection TDS (routage)

- **Constat** : `withMssql` épingle bien l'adresse initiale (`server: t.address`). Mais tedious 20.3.8 traite le jeton `ENVCHANGE` de **routage** renvoyé après LOGIN7 (`connection.js:1168-1170` → `performReRouting`). Il se reconnecte ensuite à `routingData.server:routingData.port` avec `dns.lookup` standard (`connection.js:1299-1306`), sans aucun contrôle de `policy.ts`.
- **Scénario d'échec** : un utilisateur authentifié (rôle `user`) démarre un faux serveur TDS sur un hôte public qu'il contrôle. C'est autorisé par la politique `public` retenue à la GATE 2 (Q-1). Le faux serveur répond à LOGIN7 par un routage vers `127.0.0.1:1433`, `10.0.0.5:1433` ou `db.interne:1433`. Tedious s'y connecte avec les identifiants saisis : l'utilisateur interroge une base **interne** (le scénario Gherkin « Hôtes de bases de données internes refusés » est contourné). Il peut aussi balayer les ports internes en comparant les messages « Connexion refusée » et « Délai dépassé » de `friendly()`.
- **Correction attendue** : fournir `options.connector` à tedious (option prise en charge, `connection.js:571-575`, transmise par `mssql`). Le connecteur reçoit `(connectOpts, lookup, signal)` pour **chaque** connexion, routage compris (`connection.js:1305-1306`). Il doit appeler `resolveAllowed(connectOpts.host, connectOpts.port)` puis ouvrir `net.connect({ host: address, port })`. Sinon, refuser explicitement tout routage dont l'hôte diffère de la cible validée. Le QA doit vérifier que le connecteur est bien appelé lors d'un routage (faux serveur TDS local en liste blanche qui renvoie un routage vers un port non autorisé), ou que le routage est refusé. Voir aussi CR-11 (port découvert).

#### CR-3 🟠 Majeur : MySQL en flux, erreur fatale non écoutée, plantage du serveur

- **Constat** : `streamMysql` lance `core.query(sql)` **sans rappel** (`sql.ts:109`). Dans mysql2, `_notifyError` (`base/connection.js:302-339`) ne notifie la commande que si elle a un `onResult`. Sinon, l'erreur est **remontée** par `connection.emit('error', err)`. Aucun écouteur `'error'` n'est posé sur `core` : `core.promise()` n'en ajoute un que si on écoute le wrapper (`promise/inherit_events.js`).
- **Scénario d'échec** : pendant la lecture d'un résultat, le serveur MySQL ferme la socket (redémarrage, `KILL CONNECTION`, coupure réseau, ou serveur public malveillant qui envoie un paquet invalide). L'événement `stream.on('close')` produit `PROTOCOL_CONNECTION_LOST`, puis `emit('error')` sans écouteur : une exception non interceptée **arrête le processus Next.js** et déconnecte tous les utilisateurs. N'importe quel utilisateur authentifié peut déclencher ce déni de service avec un serveur MySQL public qu'il contrôle. L'ancien code (requêtes avec promesse et rappel) n'avait pas ce défaut : c'est une **régression**.
- **Correction attendue** : poser `core.on('error', …)` juste après `createConnection` (`sql.ts:74`). L'écouteur doit faire échouer la requête en cours (relais vers `done(err)` de `streamMysql`) et ne rien journaliser de sensible. Test QA : serveur TCP local en liste blanche qui accepte la poignée de main puis coupe la connexion (ou simulation par `core.stream.destroy()`), et contrôle que le processus survit et que l'API renvoie `ok:false`.

#### CR-4 🟠 Majeur : PostgreSQL et `standard_conforming_strings=off`

- **Constat** : `lex()` ne traite `\` comme échappement que pour les littéraux `E'…'` (`sql-guard.ts:85-86`). C'est juste avec `standard_conforming_strings=on`, valeur par défaut depuis PG 9.1 mais modifiable par le DBA (serveur, base ou rôle : `ALTER ROLE … SET standard_conforming_strings = off`). `withPg` ne fixe pas ce paramètre.
- **Preuve** (sonde `node`) : `SELECT 'a\'' , pg_sleep(10) -- '` est **ACCEPTÉE** par `assertReadOnly(…, 'postgres')`. Le lexer voit une seule chaîne. Avec `scs=off`, PostgreSQL lit `'a\''`, puis exécute `, pg_sleep(10)` et prend le reste pour un commentaire. La variante `E'…'` est bien refusée.
- **Scénario d'échec** : sur un serveur hérité configuré en `scs=off`, toute fonction de la liste noire (`pg_terminate_backend`, `dblink`, `pg_read_file`, `lo_export`…) peut être cachée dans une pseudo-chaîne. Le curseur et `BEGIN READ ONLY` n'empêchent ni `pg_terminate_backend`, ni la lecture de fichiers, ni `dblink`.
- **Correction attendue** : imposer le paramètre au démarrage de la session, `options: '-c standard_conforming_strings=on'` dans le `Client` pg (`sql.ts:43-49`). La requête ne peut pas l'annuler, puisque `SET`/`set_config` sont bloqués. Une autre solution, plus simple mais plus restrictive, consiste à refuser tout `\` dans les littéraux PG non préfixés par `E`, comme pour MySQL. Ajouter le cas au jeu de tests.

#### CR-5 🟠 Majeur : SQLite, accès disque ou SMB avant le contrôle de confinement

- **Constat** : `resolveSqlitePath` exécute `fs.lstatSync(candidate)` (`sqlite-path.ts:53`) puis `realpathSync`, **avant** de savoir si le candidat est dans `BI_SQLITE_DIR`. Le contrôle lexical `within()` n'intervient que dans le cas `ENOENT`. L'ordre suit l'algorithme de T-4, mais il laisse une surface d'attaque.
- **Scénario d'échec** : sur un serveur Windows (poste de développement actuel ou déploiement Windows), un utilisateur saisit `\\attaquant.tld\partage\x.db` ou `//attaquant.tld/p/x.db`. Le nom de fichier passe `FILE_NAME`, puis `lstatSync` ouvre une session **SMB sortante** vers l'hôte choisi. Conséquences : fuite du hachage NTLM du compte de service, et connexion réseau vers une destination interne ou externe qui contourne `policy.ts`. Sous Linux, le même ordre permet de sonder l'existence de fichiers hors du dossier par différence de temps de réponse (impact faible).
- **Correction attendue** : refuser explicitement les entrées UNC ou de périphérique (`^[\\/]{2}`, `\\?\`, `\\.\`). Contrôler `within(rootReal, candidate)` **avant tout appel `fs`**, en renvoyant `REFUSED` hors du dossier. Le `lstat`/`realpath` qui suit continue de gérer les dossiers intermédiaires liés. Ajouter les cas `\\hote\p\x.db` et `//hote/p/x.db` à `sqlite-path.check.mjs`.

#### CR-6 🟡 Mineur : liste de fonctions à compléter

Fonctions acceptées par la sonde (toutes demandent des privilèges élevés, ce qui justifie la gravité Mineur) :
- PG : `pg_file_write|pg_file_unlink|pg_file_rename` (adminpack), `pg_ls_\w+` (au-delà de `pg_ls_dir`), `pg_notify`, `pg_stat_reset\w*`, `pg_switch_wal`, `pg_promote`, `pg_create_restore_point`, `lo_\w+` (`lo_create`, `lo_put`, `lo_from_bytea`) ;
- MSSQL : `fn_xe_file_target_read_file`, `fn_get_audit_file`, `fn_trace_gettable`, `fn_dblog` ;
- MySQL : mot-clé `procedure` (`PROCEDURE ANALYSE`), `master_pos_wait|source_pos_wait`.

Chaque ajout doit être couvert par un cas de test.

#### CR-7 🟡 Mineur : Mongo `srvServiceName`

`assertMongoUriAllowed` résout `_mongodb._tcp.<hôte>` (`policy.ts:245`). Avec `?srvServiceName=x`, le pilote résout `_x._tcp.<hôte>`, dont les cibles ne sont jamais contrôlées. Le prérequis (maîtrise du DNS de l'hôte) est celui du risque résiduel R-2 déjà accepté, mais le contournement devient déterministe. Ajouter `srvServiceName` à `MONGO_FORBIDDEN` (`policy.ts:207`) et à la note de migration.

#### CR-8 🟡 Mineur : erreurs brutes de `/api/llm/chat`

`route.ts:21` renvoie `(e as Error).message` pour toute erreur qui n'est ni `ProviderError` ni `NetworkPolicyError`. Avec une base personnalisée, le client reçoit par exemple `connect ECONNREFUSED 10.0.0.5:8000` ou des détails TLS (IP résolue, nom d'hôte), contrairement à la règle du § 6 et au traitement de `testKey`. Correction : renvoyer « Réseau indisponible : fournisseur injoignable. » (E-LLM-3) pour les autres erreurs, sans journaliser l'URL. Le Dev l'a signalé en dette (§ 6), mais le correctif tient en 1 ligne et relève de ce sprint (T-10).

#### CR-9 🟡 Mineur : arrêt du flux MySQL

Dans mysql2, `destroy()` appelle `close()`, qui fait `stream.end()` (`base/connection.js:1015-1026`). La socket reste ouverte en lecture, et avec un `LIMIT 500000` explicite (qui l'emporte sur `sql_select_limit`) le serveur continue d'envoyer toutes les lignes, que le client analyse puis jette. La mémoire reste bornée, mais le CPU et le réseau sont gaspillés après la réponse. Correction : détruire réellement la socket (`core.stream.destroy()` après `core.destroy()`, ou méthode équivalente typée).

#### CR-10 🟡 Mineur : R-3, SNI SQL Server

Le Dev a raison sur `message-io.js:71` : le SNI est omis avec une IP. En revanche, tedious accepte `options.serverName` (`connection.js:814-818`, `:1246`, `:2335`), qui fixe le SNI indépendamment de `server`. Passer `serverName: t.host` quand `t.host` n'est pas une IP conserve l'épinglage **et** le routage par nom (passerelle Azure SQL) : la réserve de `dev-notes.md` § 3 tombe. Le QA doit le vérifier si un environnement est disponible.

#### CR-11 🟡 Mineur : port découvert par SQL Browser

Avec `hote\INSTANCE`, `port` est `undefined` (`sql.ts:125`). Tedious interroge SQL Browser (UDP 1434) sur l'IP épinglée, puis se connecte au port annoncé. `resolveAllowed` n'a contrôlé que le port 1433 par défaut, donc une entrée `10.0.0.5:1433` autorise en pratique n'importe quel port annoncé par cet hôte. Le connecteur demandé en CR-2, qui reçoit le port effectif, règle aussi ce cas.

#### CR-12 🟡 Mineur : plages IPv6 complémentaires

À ajouter à `INTERNAL_V6` : `64:ff9b:1::/48` (NAT64 local, RFC 8215), `fec0::/10` (site-local obsolète mais routé par certains équipements), `2001::/32` (Teredo). Ces ajouts restent fidèles à l'esprit « liste minimale + échec fermé ».

### 4. Conformité aux ADR et à la checklist § 8

| Point | Statut | Commentaire |
|---|---|---|
| ADR-C1-01 / § 8.1 Markdown | ✅ | `components.img` ne rend jamais d'`<img>` : syntaxe directe, **référence** (`imageReference` → hast `img`), autolien d'image. `skipHtml` est actif et `rehype-raw` absent, donc le HTML brut est ignoré. `urlTransform` vide `src` et toute clé ≠ `href`, `trim()` est appliqué et les contrôles/blancs internes sont refusés. Sondes : `javascript:`, `https:evil`, `https:/evil` et `//x` sont refusés ; `HTTPS://…` est normalisé, et `linkHost` est calculé sur l'URL normalisée (cohérent avec la destination réelle). Plus de `{...props}` sur `<a>`. Ancres sans `target`. Notes de bas de page GFM (`#user-content-…`) conservées |
| ADR-S9-01 / § 8.2 CSP | ✅ | Valeur exacte `img-src 'self' data: blob:` sur `/:path*`, sans `default-src` ni `unsafe-*`. Aucune image distante dans l'application (pas de `next/image` distant ni d'avatar). La non-régression est à vérifier par le QA : GIS (`accounts.google.com/gsi/client`, popup), exports PNG/PDF, import PDF |
| ADR-S2-01 / § 8.3 SQLite | ⚠️ | `realpath` ouvert (`sql.ts:146-148`), confinement par `path.relative`, lien final refusé, dossier intermédiaire lié traité par `realpath`, garde `BI_DATA_DIR` dans les deux sens, messages sans chemin : ✅. **CR-5** (ordre des contrôles, UNC) à corriger |
| ADR-S1-01 / § 8.4 épinglage | ✅ HTTP · ⚠️ MSSQL | `guardedLookup` vérifie toutes les adresses, rend l'adresse vérifiée et gère `options.all` (autoSelectFamily). IP littérales contrôlées sans `lookup`. IPv4 embarquées extraites. Plages toujours interdites testées avant la liste blanche. Valeur de politique inconnue traitée comme `allowlist`. `agent: false`. **CR-2** : routage TDS hors politique |
| ADR-S1-02 / § 8.5 couverture | ⚠️ | REST/Airtable/Notion/Odoo/LLM personnalisé passent par `safeFetch`. Pilotes SQL contrôlés avant connexion, `c.url` refusé, options Mongo interdites, `Host` refusé, aucune redirection suivie, plafond appliqué après décompression. **CR-2**, **CR-7**, **CR-11** |
| § 8.6 non-verbosité | ✅ (sauf CR-8) | Plus de corps distant ni de `cause.message` dans `saas.ts`. `ensureOk` n'utilise plus `JSON.stringify(j)` et le corps est annulé si `custom`. `safeFetch` ne journalise rien |
| ADR-S3-01 / § 8.7 lecture seule | ❌ | Lexer conforme au tableau T-13 pour chaque dialecte (pièges `--x` MySQL, `#temp` MSSQL, `$tag$`, `E'\''` vérifiés). `queryMode: 'extended'` + `DECLARE CURSOR` (pg 8.23 le prend en charge). `ROLLBACK` MSSQL en `finally`. `sql_select_limit` + flux MySQL. `stmt.readonly` + `query_only` SQLite. `-LOCAL_FILES` et `multipleStatements: false`. **CR-1** (bloquant), **CR-3**, **CR-4**, **CR-6**, **CR-9** |
| § 8.8 invariants | ⚠️ | BYOK : aucune clé, URL ni en-tête journalisé ✅. `requireAuth` conservé ✅. `data/` : seul `realpath(BI_DATA_DIR)` est calculé ✅. Lecture seule (n° 1) : voir CR-1 |
| § 8.9 qualité | ✅ | TS strict, aucun `any` nouveau (le `Record<string, any>` de `notionValue` existait déjà), modules § 2.1 en syntaxe effaçable, `catch` justifiés |

### 5. Évaluation des écarts déclarés par le Dev (`dev-notes.md` § 2 et § 3)

| Écart | Avis |
|---|---|
| 1. Marqueur d'image du rapport en `slate-300/500` | **Accepté**. `ReportModal` emploie déjà `slate` sur un fond `bg-white` forcé (`colorScheme: light`, export PDF) ; les tokens du thème sombre y seraient illisibles. Recette visuelle UX conseillée, non bloquante |
| 2. Refus des contrôles et blancs dans `safeUrlTransform` ; pas d'`aria-label` | **Accepté**. Plus strict que la conception. Le texte du lien reste l'intitulé accessible et `title` complète |
| 3. Fichier absent hors dossier renvoyé en E-SQLITE-2 ; `..x.db` accepté | **Accepté** (non-divulgation conforme au Gherkin ; `..x.db` correctement distingué de `..` + séparateur) |
| 4. Erreurs DNS propagées | **Accepté** (`friendly()` les traduit, aucune information interne exposée) |
| 5. `::ffff:0:0:0/96` et IPv4-compatible | **Accepté** (voir aussi CR-12) |
| 6. Message « URI MongoDB invalide… » hors catalogue | **Accepté** ; le Tech Lead doit l'ajouter au catalogue § 6 |
| 7. `safeFetch` : délai étendu au corps plafonné, mise en mémoire tampon, en-têtes retirés, `ETIMEDOUT` | **Accepté** (renforcement ; comportement équivalent à `res.json()`) |
| 8–9. Messages « réponse non JSON » (REST, Odoo) et contrôle des noms d'en-têtes | **Accepté** |
| 10. Constantes LLM exportées, 400 pour `NetworkPolicyError`, `cancel()` du corps | **Accepté** ; voir CR-8 pour les autres erreurs |
| 11. Messages « Port invalide. » et « Requête trop longue (20 000 caractères maximum). » hors catalogue | **Accepté** ; à ajouter au § 6. Le second ressemble à E-SQL-8 (« Requête trop longue : délai… »), et UX pourra le reformuler (« Requête trop volumineuse… ») |
| 11. MySQL via l'API cœur, `sql_select_limit` limité aux requêtes utilisateur ; `SET ROWCOUNT` limité aux requêtes utilisateur | **Accepté** dans le principe ; voir **CR-3** et **CR-9** (conséquences de l'API cœur) |
| 12. Durcissements `sql-guard` (identifiant cité suivi de `(`, refus de `U&`, ordre des séquences) | **Accepté**, avec mes félicitations : le cas `"pg_sleep"(10)` est bien pensé |
| § 3 R-3 (IP épinglée + `encrypt`) | **Vérification confirmée** (`message-io.js:71`, aucun avertissement Node). Épinglage conservé : **accepté**. Amélioration demandée en **CR-10** (`serverName`) |

### 6. Statut de revue par story

| Story | Statut | Constats ouverts |
|---|---|---|
| US-1 🔒 Markdown sûr (C1) | ✅ **Approuvé** | — |
| US-5 🔒 CSP `img-src` (S9 partiel) | ✅ **Approuvé** (non-régression navigateur à prouver par le QA) | — |
| US-2 🔒 SQLite confiné (S2) | ❌ **Changements requis** | CR-5 |
| US-3 🔒 Anti-SSRF (S1) | ❌ **Changements requis** | CR-2 (bloquant) ; CR-7, CR-8, CR-10, CR-11, CR-12 (mineurs) |
| US-4 🔒 Lecture seule bornée (S3) | ❌ **Changements requis** | CR-1 (bloquant), CR-3, CR-4 ; CR-6, CR-9 (mineurs) |

### 7. Verdict — itération 1

**❌ CHANGEMENTS REQUIS** : 2 bloquants (CR-1, CR-2), 3 majeurs (CR-3, CR-4, CR-5) et 7 mineurs (CR-6 à CR-12).

- À corriger obligatoirement avant le QA : **CR-1 à CR-5**.
- Mineurs : correction recommandée dans la même itération (chacun ne demande que quelques lignes). À défaut, le Dev doit les consigner explicitement en dette dans `dev-notes.md`.
- Pour CR-1 (stratégie de détection multi-instructions T-SQL) et CR-2 (connecteur tedious ou refus du routage), le Dev peut solliciter l'arbitrage du Tech Lead s'il hésite sur l'approche. Le résultat doit rester sans nouvelle dépendance.
- US-1 et US-5 sont approuvées et n'ont pas à être revues de nouveau, sauf modification.

Prochaine étape : correction par le Dev (boucle 1/3), puis **revue courte** (itération 2) limitée aux CR-n et à leurs tests.

---

## Itération 2 — revue courte des corrections CR-1 à CR-12 (tâche orchestrateur #18)

- **Entrées** : `dev-notes.md` § « Itération 2 — corrections CR », fichiers `sql-guard.ts`, `sql.ts`, `sqlite-path.ts`, `policy.ts`, `api/llm/chat/route.ts`, `README.md`.
- **Périmètre** : uniquement CR-1 à CR-12, les régressions qu'ils pourraient introduire et les 7 écarts/arbitrages du Dev. US-1 et US-5, approuvées en itération 1 et non modifiées, ne sont pas revues de nouveau.
- **Méthode** : lecture du code, relecture de tedious 20.3.8 et mysql2 3.24.6 (`node_modules`, en lecture seule), relance des scripts du Dev (`it2/`) et de mes sondes (`rev/`), plus une nouvelle sonde `rev2/probe.mjs` et `rev2/probe2.mjs`. Tous les scripts sont dans le scratchpad de session, hors dépôt, et ne touchent que `127.0.0.1`. Aucun SGBD ni LLM réel (V-7 non accordé).

### 1. Vérifications exécutées

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` (relancé) | ✅ 0 erreur |
| `npm run build` | non relancé (hors assignation) ; succès déclaré par le Dev |
| `it2/guard2.mjs` | ✅ « TOUS LES CAS OK » (49 refus, 22 acceptations) |
| `rev/guard.mjs`, `rev/pg.mjs` | les 6 cas T-SQL de CR-1 et les cas CR-6 sont refusés. Le cas PG `'a\''` de `guard.mjs` ne contient pas de `\` (échappement JS) : l'analyse du Dev est **exacte**. Le vrai cas (`pg.mjs`) reste accepté par l'analyseur, conformément à l'arbitrage CR-4 |
| `it2/tds.mjs` | ✅ A : routage vers un port hors liste → E-NET-1, **0 connexion** sur la cible ; B (témoin) : 1 connexion (le routage passe bien par le connecteur) ; C : port annoncé par SQL Browser hors liste → E-NET-1, 0 connexion ; D (témoin) : connexion établie, puis routage refusé |
| `it2/mysql.mjs` | ✅ CR-3 : coupure en plein flux → rejet `Connection lost…`, **0 exception non interceptée** ; CR-9 : 1 000 lignes renvoyées, émission du serveur interrompue (1 500 lignes, puis 2 000 sur 200 000) |
| `it2/misc.mjs` | ✅ CR-5 (0 accès disque hors du dossier pour UNC, `//hôte`, `\\?\`, `\\.\`, `../`, absolu), CR-7, CR-12, `assertAddressAllowed` |
| `rev2/probe.mjs`, `rev2/probe2.mjs` (nouvelles) | ❌ **contournement de CR-1** par collage d'un nombre et d'un mot-clé : voir CR-13 |
| Hygiène (fichiers modifiés de l'itération) | aucun `TODO`, `console.log`, `any`, `.only`/`.skip` ✅ ; `catch` vides tous commentés ✅ ; seul cast `as unknown as` : connecteur tedious, commenté (écart 5) ✅ |

### 2. Statut des constats de l'itération 1

| CR | Statut | Preuve / commentaire |
|---|---|---|
| CR-1 🔴 | ⚠️ **Partiel** | Liste transactionnelle commune, `MSSQL_WORDS`, séquences `end/move/get conversation` et règle `assertSingleSelect` : conformes, et sans faux positif sur les cas demandés (CTE multiples, `WITH RECURSIVE`, `UNION/EXCEPT/INTERSECT [ALL]`, `OFFSET … FETCH`, `WITH (NOLOCK)`, sous-requêtes, `LATERAL`, CTE imbriquée, `WITH XMLNAMESPACES`). Le contrôle `@@TRANCOUNT` est correct (`sql.ts:194-197`, exécuté avant le `ROLLBACK` du `finally`). **Mais** la détection lexicale reste contournable en T-SQL : voir **CR-13** (bloquant) |
| CR-2 🔴 | ✅ Corrigé | `mssqlConnector` (`sql.ts:143-169`) : tedious l'appelle pour **chaque** socket (`connection.js:1299-1306`, `connectOnPort` → `customConnector`, routage compris). Hôte épinglé : port contrôlé sans nouvelle résolution ; autre hôte : `resolveAllowed` puis connexion à l'adresse vérifiée (pas de rebinding). Abandon (`signal`) et nettoyage des écouteurs corrects. Refus d'origine restitué (`sql.ts:189`), sans hôte ni port dans le message. Preuve : `tds.mjs` A/B |
| CR-3 🟠 | ✅ Corrigé | `core.on('error', …)` permanent (`sql.ts:82`), plus un écouteur par requête (`sql.ts:116-124`) qui reçoit bien l'erreur : dans `_notifyError` (`base/connection.js:302-339`), une commande sans `onResult` remonte l'erreur **uniquement** à la connexion. Les commandes à rappel reçoivent l'erreur par `onResult`, et une commande ajoutée après l'erreur fatale échoue immédiatement (`_addCommandClosedState`), donc pas de requête bloquée. Preuve : `mysql.mjs` |
| CR-4 🟠 | ✅ Corrigé (arbitrage accepté, voir § 3) | `options: '-c standard_conforming_strings=on'` + `SHOW` (`sql.ts:50-56`). Amélioration mineure : **CR-14** |
| CR-5 🟠 | ✅ Corrigé | `sqlite-path.ts:48` refuse les entrées qui commencent par deux séparateurs, et `:53` applique `within` **avant** tout `lstat`. J'ai vérifié les formes `\??\UNC\…`, `C:x.db` et `/\hôte` : elles sont soit refusées par l'expression, soit résolues hors du dossier puis refusées lexicalement, sans accès disque. Preuve : `misc.mjs` (espion `lstatSync`) |
| CR-6 🟡 | ✅ Corrigé | Chaque fonction ajoutée est refusée (`guard2.mjs`). `lo_\w+` et `pg_ls_\w+` couvrent aussi les variantes |
| CR-7 🟡 | ✅ Corrigé | `policy.ts:214` ; le contrôle ignore la casse. `srvServiceName%3Dx` est accepté, mais ce n'est pas l'option : la clé décodée vaut `srvServiceName=x`. README à jour |
| CR-8 🟡 | ✅ Corrigé | `route.ts:22-23` : plus aucun message brut. Remarque, non bloquante : un corps JSON invalide (`req.json()`) renvoie aussi « Réseau indisponible… » en 502, ce qui est imprécis mais ne divulgue rien. À reformuler éventuellement dans une suite |
| CR-9 🟡 | ✅ Corrigé | `sql.ts:109-114` ; preuve `mysql.mjs`. L'écouteur `onFatal` n'est pas retiré sur le chemin du délai, mais la connexion est détruite : sans effet |
| CR-10 🟡 | ✅ Corrigé | `serverName` utilisé en priorité pour le SNI (`connection.js:1246`, `:2335`). Limite exacte relevée par le Dev : le champ `serverName` de LOGIN7 reste l'IP (`connection.js:1568`). Risque résiduel fonctionnel (passerelles exigeant le nom), pas de sécurité : à vérifier par le QA si un environnement Azure est disponible |
| CR-11 🟡 | ✅ Corrigé | Port annoncé par SQL Browser contrôlé par le connecteur. Preuve : `tds.mjs` C/D |
| CR-12 🟡 | ✅ Corrigé | `policy.ts:28-29` ; preuve `misc.mjs` (les adresses publiques témoins restent publiques) |

### 3. Avis sur les écarts et arbitrages du Dev

| Écart | Avis |
|---|---|
| 1. CR-4 : paramètre de session + vérification `SHOW` plutôt que refus lexical de `\` | **Accepté.** J'ai cherché à le contourner depuis la requête utilisateur. `SET`, `RESET` et `set_config` (y compris cité ou qualifié : `pg_catalog."set_config"(`) sont refusés par le filtre. Le protocole étendu et `DECLARE … CURSOR FOR` n'acceptent qu'une seule instruction `SELECT`. PostgreSQL analyse la requête avec la valeur de session au moment de l'analyse, soit `on`. Le refus lexical casserait des expressions régulières légitimes (`~ '^\d+$'`). Seul point faible : l'ordre `SHOW` puis `BEGIN` derrière un pooler en mode transaction (**CR-14**, mineur) |
| 2. `fetch` non bloqué en T-SQL ; `open`/`close` bloqués | **Accepté.** `FETCH` de curseur exige un curseur existant et reste une lecture. Le risque résiduel (curseur global préexistant) est négligeable. La citation de `[open]`/`[close]` est documentée dans le README |
| 3. Règle « un seul SELECT de tête » appliquée à tous les dialectes | **Accepté.** Aucun faux positif trouvé (voir § 2, CR-1). Évaluée après les listes, elle conserve les messages Gherkin |
| 4. `@@TRANCOUNT` détecte sans prévenir | **Accepté comme défense en profondeur.** CR-13 montre justement que la prévention lexicale doit être fiable : la détection rejette le résultat, mais elle n'annule pas une écriture déjà validée |
| 5. Connecteur tedious plutôt que refus de tout routage ; cast `as unknown as` | **Accepté.** Le cast est justifié : le typage de tedious est faux, et l'appel réel `connect(connectOpts, dns.lookup, signal)` (`connection.js:1306`) correspond à la signature implémentée |
| 6. UDP 1434 (SQL Browser) non confronté à la liste blanche | **Accepté, sans arbitrage nécessaire.** Le datagramme part vers l'IP déjà validée par la politique. Sa charge est fixe (nom d'instance limité à `[A-Za-z0-9_$]{1,16}`, `sql.ts:25`). La seule donnée utilisée en retour, le port, est contrôlée (CR-11). Exiger `hôte:1434` casserait les configurations existantes pour un gain négligeable. Une phrase dans les notes de migration ou dans `.env.example` suffirait (facultatif) |
| 7. Deux messages hors catalogue § 6 | **Accepté** ; à ajouter au catalogue par le Tech Lead / UX, avec ceux déjà signalés en itération 1 |

Aucun désaccord de conception : **pas d'arbitrage Tech Lead requis**.

### 4. Nouveaux constats

| ID | Gravité | Story / tâche | Fichier:ligne | Constat |
|---|---|---|---|---|
| CR-13 | 🔴 **Bloquant** | US-4 / T-13, T-14 (suite CR-1) | `sql-guard.ts:41`, `:44`, `:142` | T-SQL : un mot-clé **collé à un nombre** (`1COMMIT`, `0x00TRUNCATE`, `.5COMMIT`) échappe aux listes et à `assertSingleSelect`. On sort de nouveau de la transaction annulée |
| CR-14 | 🟡 Mineur | US-4 / T-13 (CR-4) | `sql.ts:55-57` | `SHOW standard_conforming_strings` est exécuté **avant** `BEGIN READ ONLY`. Derrière un pooler en mode transaction, il peut porter sur une autre connexion serveur que la requête |
| CR-15 | 🟡 Mineur | US-4 / T-13 | `sql-guard.ts:44` | Instructions T-SQL hors liste, exécutables en 2ᵉ instruction : `RAISERROR … WITH LOG` (écriture non transactionnelle dans le journal d'erreurs), `ADD [COUNTER]SIGNATURE` |

#### CR-13 🔴 Bloquant : contournement de CR-1 par collage nombre + mot-clé (T-SQL)

- **Constat** : l'analyseur lexical de SQL Server termine un littéral numérique au premier caractère qui n'en fait pas partie, sans exiger de séparateur. C'est la forme `SELECT 1FROM t` / `1UNION`, bien connue des contournements de filtres. Or les listes (`WORDS`, `MSSQL_WORDS`) reposent sur `\b`, et il n'y a **pas** de frontière de mot entre `1` et `c`. Quant à `assertSingleSelect`, il lit `1select` comme un seul jeton (`sql-guard.ts:142`). Même défaut avec les binaires `0x…` suivis d'une lettre hors `a-f` et avec les monnaies `$1…`.
- **Preuves** (sondes `rev2/probe.mjs`, `rev2/probe2.mjs`, `assertReadOnly(…, 'mssql')`, toutes **ACCEPTÉES**) :
  `SELECT 1COMMIT` · `SELECT 1ROLLBACK` · `SELECT 1COMMIT PRINT 1DELETE t` · `SELECT 1COMMIT IF 1=1TRUNCATE TABLE t` · `SELECT 1COMMIT IF 1=1DROP TABLE t` · `SELECT 1COMMIT IF 1=0x00TRUNCATE TABLE t` · `SELECT 1COMMIT IF 1=1UPDATETEXT t.c 0 0 0x00` · `SELECT 1WRITETEXT t.c 0x00 'x'` · `SELECT .5COMMIT` · `SELECT 1e1COMMIT` · `SELECT $1COMMIT` · `SELECT 1 FROM t WHERE a=1SELECT 2`.
- **Scénario d'échec** : c'est celui de CR-1. Une requête produite par le LLM (injection de prompt) ou saisie par l'utilisateur, par exemple `SELECT 1COMMIT IF 1=1DELETE t`, valide la transaction de `withMssql`, puis exécute le `DELETE` en autocommit si le compte n'est pas strictement en lecture seule. Le contrôle `@@TRANCOUNT` rejette ensuite le résultat (`TX_ESCAPED`), mais l'écriture est **déjà persistée**. Le README (`:39`, « transaction toujours annulée sur SQL Server ») et l'invariant n° 1 restent contournés. Les autres dialectes ne sont pas exploitables : MySQL a `multipleStatements: false`, PostgreSQL utilise le protocole étendu et un curseur, SQLite `prepare`. En PostgreSQL, `SELECT 1pg_sleep(10)` est aussi accepté, mais le serveur le lit `1 AS pg_sleep` suivi de `(10)` : erreur de syntaxe, aucun appel. Le comportement exact du lexer SQL Server doit être confirmé par le QA dès qu'un SQL Server de test est disponible (V-7). Le refus côté garde est en revanche démontré, et la correction ne dépend pas de cette confirmation.
- **Correction attendue** (dialecte `mssql` uniquement : MySQL autorise des identifiants commençant par un chiffre, comme `2023_ventes`) :
  1. Dans `assertReadOnly`, avant les listes, parcourir les jetons `[a-z0-9_$@#.]+` du code masqué. Pour tout jeton qui commence par un chiffre, par `$` ou par `.` suivi d'un chiffre, exiger une correspondance complète avec un littéral numérique T-SQL : `^\$?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$` ou `^0x[0-9a-f]*$`. Sinon, lever `ReadOnlyError` avec un message explicite, par exemple « SQL Server : séparez les nombres des mots-clés par un espace. ». Les symboles monétaires non ASCII (`€1COMMIT`, `£1…`) produisent un jeton qui commence par un chiffre : ils sont couverts.
  2. Variante acceptable : insérer un espace à chaque frontière « littéral numérique → lettre » dans une copie du code masqué, puis appliquer listes et `assertSingleSelect` à cette copie (les `1e5` et `0x1F` légitimes doivent rester intacts).
  3. Ajouter à `guard2.mjs` (puis à `sql-guard.check.mjs`) tous les cas ci-dessus en refus, et en acceptation : `SELECT 1e5, 0x1F, $10, .5, t1.col2 FROM t3`, `SELECT TOP 10 col2 FROM t3 WHERE c1=0x1F`.
  4. Mentionner la règle dans les notes de migration du README.

#### CR-14 🟡 Mineur : ordre `SHOW` / `BEGIN READ ONLY`

Avec un pgbouncer en mode `transaction`, chaque instruction hors transaction peut être servie par une connexion serveur différente. Le pooler conserve en outre les `SET` de session d'un client à l'autre. Le `SHOW` (`sql.ts:55`) peut donc lire `on` sur la connexion A, alors que le curseur s'exécute sur une connexion B passée en `off` par un autre client du même pool. Le cas est exotique, mais la correction est triviale : exécuter `BEGIN READ ONLY` **puis** `SHOW standard_conforming_strings` dans la transaction, avant `fn`. La transaction garantit la même connexion serveur.

#### CR-15 🟡 Mineur : instructions T-SQL résiduelles

Acceptées par la sonde en 2ᵉ instruction : `SELECT 1 RAISERROR('x',10,1) WITH LOG` (écriture dans le journal d'erreurs SQL Server, non annulée par le `ROLLBACK`) et `SELECT 1 ADD SIGNATURE TO p BY CERTIFICATE c` (transactionnelle, donc annulée). Les deux exigent des privilèges élevés (`ALTER TRACE` ou sysadmin, `CONTROL`), d'où la gravité Mineur. Correction : ajouter `raiserror` et `add` à `MSSQL_WORDS` (mots réservés T-SQL, donc sans nouveau faux positif) avec leurs cas de test. Les autres instructions acceptées (`PRINT`, `IF`, `FETCH` de curseur, `(SELECT 2)` en 2ᵉ instruction) sont des lectures ou du contrôle de flux, sans effet : pas de correction demandée.

### 5. Statut de revue par story

| Story | Statut | Constats ouverts |
|---|---|---|
| US-1 🔒 Markdown sûr (C1) | ✅ **Approuvé** (itération 1, non modifiée) | — |
| US-5 🔒 CSP `img-src` (S9 partiel) | ✅ **Approuvé** (itération 1, non modifiée ; non-régression navigateur à prouver par le QA) | — |
| US-2 🔒 SQLite confiné (S2) | ✅ **Approuvé** | — |
| US-3 🔒 Anti-SSRF (S1) | ✅ **Approuvé** | — (CR-10 : vérification Azure facultative par le QA) |
| US-4 🔒 Lecture seule bornée (S3) | ❌ **Changements requis** | CR-13 (bloquant) ; CR-14, CR-15 (mineurs) |

### 6. Verdict — itération 2

**❌ CHANGEMENTS REQUIS** : 1 bloquant (CR-13), 2 mineurs (CR-14, CR-15). Sur les 12 constats de l'itération 1, 11 sont corrigés et CR-1 est partiel (rouvert sous CR-13).

- À corriger obligatoirement avant le QA : **CR-13**. Le correctif est local à `sql-guard.ts`, avec ses cas de test et une ligne de README.
- CR-14 et CR-15 tiennent en quelques lignes : correction recommandée dans la même boucle, sinon dette à consigner explicitement dans `dev-notes.md`.
- Aucun arbitrage du Tech Lead n'est requis : les 7 écarts du Dev sont acceptés.
- Boucle de correction : **2/3**. Prochaine étape : correction par le Dev, puis revue courte (itération 3) limitée à CR-13, CR-14, CR-15 et à leurs tests. US-2 et US-3 n'auront pas à être revues de nouveau, sauf modification de `sqlite-path.ts`, `policy.ts` ou du connecteur tedious.

## Itération 3 — revue courte des corrections CR-13 à CR-15 (tâche orchestrateur #20, boucle 3/3)

- **Entrées** : `dev-notes.md` § « Itération 3 », `sql-guard.ts`, `sql.ts` (`withPg`), `README.md`.
- **Périmètre** : CR-13, CR-14, CR-15, leurs régressions possibles et le point 2 du Dev (`depth < 0`). Il n'y a pas de nouvelle revue complète. US-1, US-2, US-3 et US-5 ne sont pas revues de nouveau : `sqlite-path.ts`, `policy.ts` et le connecteur tedious n'ont pas changé.
- **Méthode** : relecture du code ; relance de `it2/guard2.mjs`, `it2/guard3.mjs`, `rev2/probe.mjs` et `rev2/probe2.mjs` ; deux nouvelles sondes, `rev3/probe.mjs` (contournements et faux positifs, 47 cas) et `rev3/probe2.mjs` (texte réellement renvoyé pour exécution). Tous les scripts sont dans le scratchpad de session, hors dépôt. Aucun SGBD ni LLM réel (V-7 non accordé).

### 1. Vérifications exécutées

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` (relancé) | ✅ 0 erreur |
| `npm run build` | non relancé (hors assignation) ; succès déclaré par le Dev (16 routes) |
| `it2/guard2.mjs` | ✅ « TOUS LES CAS OK » (aucune régression) |
| `it2/guard3.mjs` | ✅ 38 refus, 16 acceptations, « TOUS LES CAS OK » |
| `rev2/probe.mjs`, `rev2/probe2.mjs` | ✅ tous les cas CR-13 et CR-15 sont refusés ; les témoins de faux positifs restent acceptés |
| `rev3/probe.mjs`, `rev3/probe2.mjs` (nouvelles) | ✅ CR-13 : aucun contournement trouvé ; ❌ **masquage des commentaires `--` en cas de `\r` seul** : voir CR-16 |
| Hygiène (`sql-guard.ts`, `sql.ts`) | aucun `TODO`, `console.log`, `any` ni `.only`/`.skip` ✅ |

### 2. Statut des constats de l'itération 2

| CR | Statut | Preuve / commentaire |
|---|---|---|
| CR-13 🔴 | ✅ **Corrigé** | `assertMssqlNumbersSeparated` (`sql-guard.ts:67-80`) est appelée pour `mssql` avant les listes (`:197`), sur le code masqué en minuscules. Contournements essayés, **tous refusés** : chiffres Unicode (`١`, `１`, `½`, `²`) et lettres Unicode (`1éCOMMIT`, `İCOMMIT`), car JS voit une frontière `\b` avant `c` ; majuscules `0X…`/`1E…` (minuscules au préalable) ; exposants et décimaux multiples (`1e1e1`, `1.5.5`, `1.5E-3`) ; collage après opérateur (`1-1COMMIT`, `$-1COMMIT`) ; `t.1COMMIT` ; `1KCOMMIT` (le signe kelvin devient `k`) ; séparateurs exotiques (NBSP, U+200B, tabulation), qui créent tous une frontière `\b`. Acceptés mais non exploitables : `a$1COMMIT`, `@1COMMIT` (identifiant / variable selon les règles T-SQL) et `0x00add …`, que SQL Server lit comme un seul littéral binaire `0x00ADD`, de façon cohérente avec la garde. `$$1COMMIT` est aussi accepté ; T-SQL n'a pas de jeton `$$`, donc on doit s'attendre à une erreur de syntaxe. À confirmer par le QA sous V-7, sans blocage. Faux positifs : aucun sur `DATEADD`, `1.5e-3`, `0xFF`, `b<-1`, `decimal(10,2)`, `[1a]`, `AS [1x]`, `année1x`, `N'é'`. Le seul relevé est un identifiant non cité dont **la lettre précédant un chiffre est non ASCII**, puis une lettre (`colé1x`) : il est refusé, car `isMssqlIdChar` est en ASCII. C'est rare et le refus est sûr, avec un message clair (citer la colonne) : accepté. README `:107` à jour |
| CR-14 🟡 | ✅ **Corrigé** | `sql.ts:54-58` : `BEGIN READ ONLY`, puis `SHOW` dans la transaction, puis `fn`. Si le `SHOW` échoue ou que la valeur est différente de `on`, l'exception traverse le `finally` (`ROLLBACK` protégé, puis `client.end()`). Aucune requête utilisateur n'est exécutée. Correct |
| CR-15 🟡 | ✅ **Corrigé** | `raiserror` et `add` sont dans `MSSQL_WORDS` (`sql-guard.ts:45`). `RAISERROR … WITH LOG` et `ADD [COUNTER] SIGNATURE` sont refusés. `DATEADD`, `date_add_x`, `added`, `address`, `add_col`, `[add]` et `[raiserror]` restent acceptés, car il n'y a pas de frontière `\b` dans un identifiant |

### 3. Avis sur le point 2 du Dev (`SELECT 1) SELECT 2`, profondeur négative)

**Non nécessaire pour la sécurité.** J'ai vérifié que `SELECT 1)SELECT 2`, `SELECT 1) SELECT 2` et `SELECT 1)) SELECT 2 ((` sont acceptés par la garde. SQL Server compile le lot entier avant de l'exécuter : une parenthèse non appariée est une erreur de syntaxe, et **aucune** instruction du lot ne s'exécute. PostgreSQL (protocole étendu), MySQL (une instruction) et SQLite (`prepare`) échouent eux aussi à l'analyse. Toute écriture glissée après `)` (`… )) DELETE t ((`) reste par ailleurs refusée par les listes. Le test `depth < 0` → `MALFORMED` coûte une ligne et donnerait un message plus net. Je le classe **CR-17, Mineur, facultatif**, à faire si l'on corrige CR-16, sinon à consigner en dette.

### 4. Nouveaux constats

| ID | Gravité | Story / tâche | Fichier:ligne | Constat |
|---|---|---|---|---|
| CR-16 | 🔴 **Bloquant** | US-4 / T-13 (et US-3 par `dblink`) | `sql-guard.ts:126-131` | Un commentaire `--` n'est terminé que par `\n`. PostgreSQL le termine aussi sur un `\r` seul. Le code placé après `\r` est donc masqué par la garde, alors que le serveur l'exécute |
| CR-17 | 🟡 Mineur (facultatif) | US-4 / T-13 | `sql-guard.ts:171` | La profondeur de parenthèses peut devenir négative sans erreur (voir § 3) |

#### CR-16 🔴 Bloquant : un `\r` seul termine le commentaire `--` côté serveur, pas côté garde

- **Constat** : `lex` cherche la fin d'un commentaire de ligne avec `sql.indexOf('\n', i)` (`sql-guard.ts:128`). Or le scanner PostgreSQL (`src/backend/parser/scan.l` : `newline [\n\r]`, `comment ("--"{non_newline}*)`) termine le commentaire au **premier `\r` ou `\n`**. Tout ce qui suit un `\r` seul, jusqu'au prochain `\n`, est remplacé par des espaces dans le code masqué. Les listes `FUNCTIONS`/`WORDS` et `assertSingleSelect` ne le voient donc pas, mais le serveur l'exécute. Rien en amont ne normalise les fins de ligne : le texte SQL va tel quel de la requête HTTP à `querySql` (`sql.ts:285`).
- **Preuves** (`rev3/probe2.mjs`, `assertReadOnly(…, 'postgres')` : **ACCEPTÉ**, texte renvoyé pour exécution sans modification) :
  - `"SELECT 1 AS a --x\r, pg_read_file('/etc/passwd') AS b\nFROM t"`
  - `"SELECT 1 AS a --x\r, dblink('host=10.0.0.1 dbname=x','select 1') AS b\nFROM t"`
  - `"SELECT 1 AS a --x\r, pg_terminate_backend(pid) AS b FROM pg_stat_activity\nLIMIT 10"`

  Il faut du texte non masqué après le `\n` (`FROM t`, `LIMIT 10`). Sinon, `assertReadOnly` tronque la requête au début du commentaire et l'attaque est neutralisée, ce que montre le 3ᵉ cas de la sonde.
- **Scénario d'échec** : une requête produite par le LLM (injection de prompt dans des données ou un schéma) ou saisie par l'utilisateur contourne **toute** la liste de fonctions PostgreSQL exigée par T-13 et CR-6. La transaction `READ ONLY` ne bloque ni `pg_read_file`/`pg_ls_dir` (lecture de fichiers serveur), ni `pg_terminate_backend`/`pg_cancel_backend`, ni `pg_advisory_lock`, ni `pg_sleep` (borné à 30 s), ni surtout `dblink`/`dblink_exec`. Ces deux dernières ouvrent **une nouvelle connexion**, hors transaction lecture seule, vers un hôte arbitraire : c'est un contournement de l'anti-SSRF (US-3) et une **écriture possible** (`dblink_exec('dbname=…', 'DELETE …')`). Toutes exigent des privilèges ou une extension installée, mais la liste existe justement pour les comptes trop privilégiés : l'invariant n° 1 est contourné en un caractère.
- **Autres dialectes** : MySQL (`sql_lex.cc`, commentaire jusqu'à `\n`) et SQLite (`tokenize.c`, jusqu'à `\n`) se comportent comme la garde : **non exploitables**. **SQL Server : non confirmé.** Si le lexer T-SQL termine `--` sur `\r`, alors `"SELECT 1 AS a --x\rCOMMIT DELETE t\nFROM u"`, accepté par la garde, rouvre CR-1. À vérifier par le QA sous V-7 ; la correction ci-dessous couvre ce cas dans tous les cas de figure.
- **Correction attendue** (locale à `lex`) :
  1. **Ne pas** se contenter de terminer le commentaire sur `\r` pour tous les dialectes. En MySQL, `"-- x\r' \n, sleep(10) -- '"` ferait alors ouvrir à la garde une chaîne qui masquerait `sleep`, alors que MySQL l'exécute. Ce serait un contournement inverse.
  2. Solution recommandée, la plus simple et sûre pour tous les dialectes : dans un commentaire de ligne, **refuser tout `\r` qui n'est pas immédiatement suivi de `\n`**, avec `ReadOnlyError(MALFORMED)` ou un message dédié du type « Retour chariot isolé non autorisé dans un commentaire. ». Les `\r\n` (Windows) restent acceptés : PostgreSQL termine au `\r` et la garde au `\n`, et il n'y a rien entre les deux. Une variante acceptable consiste à refuser tout `\r` isolé dans la requête entière, hors littéraux.
  3. Cas de test à ajouter (`guard3.mjs`), en refus : les 3 cas PostgreSQL ci-dessus, le cas `mssql` `COMMIT DELETE`, et `"SELECT 1 -- x\r' \n, sleep(10) -- '"` en `mysql`. En acceptation : `"SELECT 1 AS n -- note\r\nFROM t"` pour chaque dialecte, et `"SELECT 'a\rb' AS x"` (un `\r` dans un littéral n'est pas concerné).
  4. Autres terminaisons de ligne Unicode (`U+0085`, `U+2028`) : PostgreSQL, MySQL et SQLite ne les traitent pas comme des fins de ligne, ce qui est cohérent avec la garde. Pour SQL Server, c'est à confirmer sous V-7. Les refuser dans un commentaire, comme `\r`, ne coûte rien (recommandé).

#### CR-17 🟡 Mineur, facultatif : profondeur négative

Dans `assertSingleSelect`, `else if (t === ')') { if (--depth < 0) throw new ReadOnlyError(MALFORMED); }`, avec le cas de test `SELECT 1) SELECT 2` en refus. Ce n'est pas un défaut de sécurité (voir § 3).

### 5. Statut de revue par story

| Story | Statut | Constats ouverts |
|---|---|---|
| US-1 🔒 Markdown sûr (C1) | ✅ **Approuvé** (itération 1, non modifiée) | — |
| US-5 🔒 CSP `img-src` (S9 partiel) | ✅ **Approuvé** (itération 1, non modifiée ; non-régression navigateur à prouver par le QA) | — |
| US-2 🔒 SQLite confiné (S2) | ✅ **Approuvé** (itération 2, non modifiée) | — |
| US-3 🔒 Anti-SSRF (S1) | ✅ **Approuvé** pour son périmètre (`policy.ts`, connecteurs) | contournement indirect par `dblink`, traité sous CR-16 (US-4) |
| US-4 🔒 Lecture seule bornée (S3) | ❌ **Changements requis** | CR-16 (bloquant) ; CR-17 (mineur, facultatif). CR-13, CR-14 et CR-15 : ✅ corrigés |

### 6. Verdict — itération 3

**❌ CHANGEMENTS REQUIS** : 1 bloquant nouveau (CR-16), 1 mineur facultatif (CR-17). Les trois constats de l'itération 2 (CR-13, CR-14, CR-15) sont **corrigés**, sans régression ni faux positif significatif.

- CR-16 n'est **pas une régression** des corrections de l'itération 3 : le défaut existe dans `lex` depuis l'itération 1. C'est l'exploration des « commentaires masqués » demandée pour CR-13 qui l'a mis au jour. La correction est locale (quelques lignes dans `lex`, plus des cas de test).
- La boucle de correction 3/3 est atteinte (CLAUDE.md § 3) : **→ arbitrage Tech Lead**. Il n'y a pas de désaccord de conception, mais deux décisions lui reviennent :
  1. corriger CR-16 dans une 4ᵉ boucle exceptionnelle et courte (recommandé, vu la gravité et la taille du correctif), ou bien l'accepter en risque résiduel documenté et le reporter à un sprint de suite, ce que je **déconseille** ;
  2. le sort de CR-17 (dans la même boucle, ou en dette).
- Si une 4ᵉ boucle est décidée, la revue courte se limitera à `lex` (CR-16) et à `assertSingleSelect` (CR-17), avec leurs cas de test.

## Arbitrage après boucle 3 (Tech Lead, tâche orchestrateur #21)

- **Entrées** : itérations 1 à 3 ci-dessus, `dev-notes.md` § 2 et 3, `architecture.md` (ADR-S3-01, T-13, T-14), `sql-guard.ts` (`lex`, `assertSingleSelect`, `assertReadOnly`), `sql.ts:285`.
- **Méthode** : relance de `rev3/probe2.mjs`, puis prototype de la règle retenue (`arb/proto.mjs`, dans le scratchpad de session, hors dépôt), qui enveloppe `assertReadOnly` sans modifier `src/`. Aucun SGBD ni LLM réel.

### 1. Constat CR-16 : confirmé

`rev3/probe2.mjs` relancé sur le code actuel : **les 7 cas sont acceptés**. Les plus graves sont `pg_read_file` et `dblink` cachés derrière `--x\r` en `postgres`, et `COMMIT DELETE t` en `mssql`. Le texte renvoyé par `assertReadOnly` est bien celui que `querySql` exécute (`sql.ts:285`) : il n'y a aucune normalisation entre l'analyse et l'envoi. Le constat du reviewer est exact, et la gravité 🔴 est maintenue (invariant n° 1 contourné, plus l'anti-SSRF de US-3 via `dblink_exec`).

### 2. Autres terminateurs et séparateurs, par dialecte (sous-étape 2.1)

| Caractère | PostgreSQL | MySQL | SQLite | SQL Server | Garde actuelle |
|---|---|---|---|---|---|
| `\r` isolé | **termine `--`** (`scan.l`, `newline [\n\r]`) : exploitable | ne termine pas (commentaire jusqu'à `\n`) | ne termine pas (`tokenize.c`, jusqu'à `\n` ou NUL) | **inconnu** : s'il termine `--`, CR-1 est rouvert | termine sur `\n` seul |
| `\f`, `\v` | espace, ne termine pas | espace, ne termine pas | espace (`CC_SPACE`), ne termine pas | inconnu | ne termine pas |
| `U+0085`, `U+2028`, `U+2029` | octets UTF-8 internes au commentaire | idem | idem | **inconnu** (analyseur UTF-16) | ne termine pas |
| `\0` | chaîne C dans le protocole étendu : troncature ou désynchronisation du message `Parse` | non spécifié | **termine le commentaire et l'analyse** (le texte après NUL est ignoré par `prepare`) | inconnu | caractère ordinaire |
| Autres contrôles C0 et C1 | sans rôle lexical connu | après `--`, un caractère de contrôle ouvre un commentaire (géré par `isBlankOrControl`) | sans rôle connu | inconnu | variable |

Conclusion : seul `\r` est **prouvé** exploitable (PostgreSQL). Pour les autres caractères, le comportement est soit cohérent avec la garde, soit **non vérifiable sans V-7** (SQL Server, et NUL partout). Une correction limitée à l'instance (`\r` dans `--`) laisserait donc des inconnues sur le dialecte qui a déjà produit deux bloquants (CR-1, CR-13).

### 3. Approche structurelle (sous-étape 2.2)

La faille appartient à une **classe** : la garde et le serveur ne découpent pas le texte de la même façon. On ne peut pas reproduire à l'identique quatre analyseurs SGBD, mais on peut **retirer de l'entrée les caractères sur lesquels ils divergent**. Trois options structurelles ont été évaluées :

| Option | Description | Ferme la classe ? | Inconvénients |
|---|---|---|---|
| C1 : normaliser | remplacer `\r\n`, `\r`, `U+0085`, `U+2028` et `U+2029` par `\n` avant `lex`, et **envoyer le texte normalisé** | oui pour les fins de ligne, si l'ordre est respecté | modifie le contenu des littéraux (`WHERE c = 'a\rb'` change de sens sans prévenir) ; ajoute une seconde transformation, à garder synchronisée entre analyse et envoi ; ne traite pas `\0`, `\f`, `\v` |
| **C2 : rejeter (retenue)** | refuser, **dans toute la requête, littéraux compris**, tout caractère de contrôle autre que `\t`, `\n` et `\r` immédiatement suivi de `\n`, ainsi que `U+2028` et `U+2029` | **oui** : il ne reste que des caractères dont le rôle est identique dans les 4 dialectes | refuse les rares requêtes contenant un `\r` isolé ou un contrôle dans un littéral (contournement : `CHR(13)` / `CHAR(13)`) |
| C3 : règle limitée aux commentaires | proposition du reviewer (refus de `\r` isolé dans un `--`) | non : l'instance seulement | dépend de l'état du lexer (commentaire ou non), alors que c'est justement cet état qui diverge |

Points décisifs pour C2 :
- **Fail-closed et sans état** : un seul test, sur le texte entier, **avant** `lex`. La règle ne dépend pas de la façon dont la garde découpe la requête, donc elle ne peut pas être prise en défaut par une divergence de découpage (chaîne pour la garde, commentaire pour le serveur, ou l'inverse).
- **Texte envoyé = texte analysé**, sans transformation : l'invariant « ce qui est contrôlé est ce qui est exécuté » reste trivial.
- **Coût fonctionnel quasi nul** : les `\r\n` (Windows, soumissions de formulaire) restent acceptés. Un `<textarea>` fournit des `\n` en JavaScript, et le LLM ne produit pas de `\r` isolé. Les fins de requête sont déjà coupées par `trim()`, qui retire aussi `\r`, `U+2028` et `U+2029` en tête et en queue.
- **Prototype validé** (`arb/proto.mjs`) : 50 cas de refus et 32 cas d'acceptation, **0 écart**. Sur ces mêmes 50 cas, la garde actuelle en accepte 49.

La normalisation (C1) est écartée parce qu'elle modifie silencieusement des données de requête et qu'elle ne couvre pas NUL. Une défense en profondeur côté exécution, par exemple un contrôle répété dans `sql.ts`, est inutile : `assertReadOnly` est le point de passage unique (`sql.ts:285`) et elle renvoie le texte exécuté.

### 4. Options d'arbitrage et recommandation

| Option | Contenu | Avis |
|---|---|---|
| A | 4ᵉ boucle courte et exceptionnelle, limitée à `lex`, avec la règle C3 du reviewer | insuffisante : elle ferme l'instance, pas la classe (§ 2) |
| B | risque résiduel documenté, report au sprint suivant | **refusée** : contournement total de la liste PostgreSQL et écriture possible via `dblink_exec`, alors que ce sprint est justement « sécurité P0 ». Un compte SGBD en lecture seule n'arrête ni `pg_read_file` (si le rôle a `pg_read_server_files`), ni `dblink_exec` vers un autre hôte |
| **C** | **4ᵉ boucle courte et exceptionnelle**, limitée à `assertReadOnly` (pré-contrôle C2) et à `assertSingleSelect` (CR-17), avec cas de test et revue courte ciblée | **recommandée** |

**Recommandation unique : option C.** La dérogation à la limite de 3 boucles (CLAUDE.md § 3) se justifie ainsi : (1) le défaut n'est pas une régression des corrections précédentes, il a été découvert par l'exploration demandée sous CR-13 ; (2) le correctif tient en environ 5 lignes, dans une seule fonction, sans changement d'interface ; (3) la revue courte est bornée à l'avance. **Il n'y aura pas de 5ᵉ boucle** : si la revue de la boucle 4 trouve un nouveau contournement du lexer, le constat est consigné en risque résiduel (R-10), et le sprint est livré avec la documentation « compte SGBD en lecture seule obligatoire » renforcée, sur décision humaine.

### 5. Spécification de la correction (à exécuter par le Dev)

Fichier unique : `src/server/connectors/sql-guard.ts` (⚠️ garde-fou lecture seule, V-2 déjà accordée pour ce fichier dans ce sprint ; la dérogation de boucle exige néanmoins l'accord du § 7).

**T-13-bis (CR-16), pré-contrôle des caractères, tous les dialectes**
1. Ajouter la constante de message (E-SQL-9) :
   `const CONTROL_CHAR = 'Caractère de contrôle non autorisé dans la requête (retour chariot isolé, saut de page, séparateur Unicode…) : utilisez des fins de ligne standard.';`
2. Ajouter l'expression :
   `const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F  ]|\r(?!\n)/;`
   Elle autorise donc uniquement `\t` (U+0009), `\n` (U+000A) et `\r` suivi de `\n`. Elle refuse `\0`, `\v`, `\f`, `\r` isolé, les autres contrôles C0, DEL, les contrôles C1 (dont `U+0085`), `U+2028` et `U+2029`.
3. Dans `assertReadOnly`, **après** `trim()` et le contrôle de longueur, **avant** `lex` : `if (CONTROL_CHARS.test(s)) throw new ReadOnlyError(CONTROL_CHAR);`. Le test porte sur `s` (texte tronqué aux bords), c'est-à-dire exactement le texte dont une partie est renvoyée et exécutée.
4. Ne **pas** modifier la fin de commentaire de `lex` (`indexOf('\n')`) : une fois le pré-contrôle en place, un `\r` dans un commentaire est forcément suivi de `\n`, et les deux lectures coïncident. Ajouter un commentaire d'une ligne au-dessus de `lex` qui renvoie au pré-contrôle (« fins de ligne : seul `\n` est séparateur, voir CONTROL_CHARS »).
5. README : une ligne dans la section « lecture seule » (requêtes refusées si elles contiennent des caractères de contrôle ou un retour chariot isolé).

**T-13-ter (CR-17), profondeur négative**
- `assertSingleSelect` : `else if (t === ')') { if (--depth < 0) throw new ReadOnlyError(MALFORMED); }`. Ce test s'applique au code masqué, donc une `)` dans un littéral, un identifiant cité ou un commentaire n'est pas comptée.

**Cas de test obligatoires** (`it2/guard3.mjs` ou script équivalent, à consigner dans `dev-notes.md` § Itération 4)

Refus attendus (message E-SQL-9 sauf mention contraire) :
- `postgres` : `"SELECT 1 AS a --x\r, pg_read_file('/etc/passwd') AS b\nFROM t"`, `"SELECT 1 AS a --x\r, dblink('host=10.0.0.1 dbname=x','select 1') AS b\nFROM t"`, `"SELECT 1 AS a --x\r, dblink_exec('dbname=x','DELETE FROM t') AS b\nFROM t"`, `"SELECT 1 AS a --x\r, pg_terminate_backend(pid) AS b FROM pg_stat_activity\nLIMIT 10"`
- `mssql` : `"SELECT 1 AS a --x\rCOMMIT DELETE t\nFROM u"`
- `mysql` : `"SELECT 1 -- x\r' \n, sleep(10) -- '"`
- **pour chacun des 4 dialectes** : `"SELECT 'a\rb' AS x"`, puis `"SELECT 1 AS a --x<C>, 2\nFROM t"` avec `<C>` ∈ {`\u0085`, ` `, ` `, `\f`, `\v`, `\0`}, puis `"SELECT 1\0 FROM t"`
- **pour chacun des 4 dialectes** (message E-SQL-4, CR-17) : `"SELECT 1) SELECT 2"`, `"SELECT 1)) SELECT 2 (("`

Acceptations attendues (pour chacun des 4 dialectes) :
- `"SELECT 1 AS n -- note\r\nFROM t"` ; `"SELECT a,\r\n  b\r\nFROM t\r\nWHERE x IN (1,2)\r\n"` ; `"SELECT\tx FROM t\n"`
- `"SELECT 1 AS a\r"` (le `\r` final est retiré par `trim()` ; texte renvoyé : `"SELECT 1 AS a"`)
- `"WITH c AS (SELECT 1 AS x) SELECT x FROM c"` ; `"(SELECT 1) UNION (SELECT 2)"` ; `"SELECT ')' AS p, \"a)\" FROM t"` (en `mysql`, `"a)"` est une chaîne) ; `"SELECT 1 -- )\nFROM t"` ; `"SELECT 'é ✓ 中文' AS u"`
- Non-régression : `it2/guard2.mjs`, `it2/guard3.mjs`, `rev2/probe*.mjs` et `rev3/probe.mjs` restent verts ; `npx tsc --noEmit` donne 0 erreur.

**Fin quand** : tous les cas ci-dessus sont conformes ; `rev3/probe2.mjs` ne montre plus aucun `ACCEPTED` sur ses 6 premiers cas (le 7ᵉ, `--x\r\nFROM t`, doit rester accepté) ; aucun autre fichier de `src/` n'est modifié, hormis le README.

**Revue courte de la boucle 4 (reviewer)** : limitée au diff de `sql-guard.ts` et du README. Vérifier que le pré-contrôle est placé avant `lex`, qu'il porte sur `s`, qu'il n'y a pas de faux positif sur `\r\n`, et que CR-17 n'est appliqué qu'au code masqué.

**QA sous V-7 (si elle est accordée)** : confirmer sur SQL Server la fin du commentaire `--` sur `\r` et sur `U+2028` (information seulement : la règle C2 les refuse dans les deux cas).

### 6. Sort de CR-17 (sous-étape 2.3)

**Corrigé dans la même boucle 4** (T-13-ter). Ce n'est pas un défaut de sécurité (voir le § 3 de l'itération 3), mais la correction tient en une ligne, dans une fonction déjà relue pendant la boucle 4, et le message obtenu est plus net. La reporter en dette coûterait plus cher (une nouvelle revue de `sql-guard.ts`) que de la faire maintenant. Si l'humain refuse la boucle 4, CR-17 est consigné en dette (sprint de suite), sans risque.

### 7. Question à poser à l'humain

```
⚠️ VALIDATION HUMAINE REQUISE
Action  : autoriser une 4ᵉ boucle de correction exceptionnelle (dérogation à CLAUDE.md § 3), strictement limitée à
          src/server/connectors/sql-guard.ts (pré-contrôle des caractères de contrôle CR-16 + profondeur négative CR-17)
          et à une ligne du README, suivie d'une revue courte ciblée. Pas de 5ᵉ boucle : tout nouveau constat sur le
          lexer sera consigné en risque résiduel.
Impact  : garde-fou lecture seule (fichier sensible) ; réversible (revert) ; change le comportement : les requêtes
          contenant un retour chariot isolé, un caractère de contrôle (hors tabulation et fin de ligne) ou U+2028/U+2029
          sont refusées, y compris dans les littéraux.
Raison  : CR-16 permet aujourd'hui, en un caractère, d'appeler pg_read_file, dblink ou dblink_exec sur PostgreSQL
          (lecture de fichiers serveur, SSRF, écriture hors transaction) et, peut-être, de rouvrir CR-1 sur SQL Server.
→ Répondez « OK option C » pour lancer la boucle 4,
  ou « option B » pour livrer avec le risque résiduel documenté (déconseillé, US-4 resterait non approuvée),
  ou proposez une alternative.
```

## Itération 4 — revue courte de T-13-bis (CR-16) et T-13-ter (CR-17) (tâche orchestrateur #24, boucle exceptionnelle 4, option C)

- **Entrées** : § « Arbitrage après boucle 3 » (spécification § 5 et cas obligatoires), `architecture.md` (ADR-S3-01 amendé, E-SQL-9), `dev-notes.md` § « Itération 4 ».
- **Périmètre** : `src/server/connectors/sql-guard.ts` (fichier non suivi par Git, relu en entier) et la ligne « Caractères de contrôle » du `README.md` (`:108`). Aucun autre fichier n'est revu.
- **Méthode** : relecture du code. Relance, depuis `scratchpad/it2/`, de `arb/proto.mjs`, `arb/proto-list.mjs`, `rev3/probe.mjs`, `rev3/probe2.mjs`, `rev2/probe.mjs`, `rev2/probe2.mjs`, `guard2.mjs`, `guard3.mjs` et `guard4.mjs`. Nouvelle sonde `rev4/probe.mjs` : 15 cas × 4 dialectes, qui vérifie aussi qu'**aucun caractère interdit ne figure dans le texte renvoyé pour exécution**. Contrôle du fichier au niveau des octets. Aucun SGBD ni LLM réel (V-7 non accordé).

### 1. Vérifications exécutées

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` (relancé) | ✅ 0 erreur |
| `npm run build` | non relancé (hors assignation) ; succès déclaré par le Dev (code 0, 16 routes) |
| `arb/proto.mjs` | ✅ `refus=50 accept=32 echecs_proto=0 ; acceptes_par_garde_actuelle=4` (les 4 sont `"SELECT 1 AS a\r"`, voir § 3) |
| `arb/proto-list.mjs` | ✅ la liste affiche exactement les 4 `CUR-ACCEPT "SELECT 1 AS a\r"`. Le script plante ensuite sur sa dernière ligne (`ReferenceError: cur is not defined`) : défaut de l'outil, hors dépôt, sans effet sur le résultat |
| `rev3/probe2.mjs` | ✅ les 6 premiers cas sont refusés (E-SQL-9) ; le 7ᵉ (`--x\r\nFROM t`) reste accepté, texte exécuté inchangé |
| `rev3/probe.mjs` | ✅ variantes `\r` refusées (E-SQL-9) dans les 4 dialectes ; `SELECT 1) SELECT 2` et `SELECT 1)) SELECT 2 ((` refusés (E-SQL-4) ; les témoins de faux positifs restent acceptés |
| `rev2/probe.mjs`, `rev2/probe2.mjs` | ✅ aucune régression ; seuls restent acceptés les témoins et les cas déjà jugés non exploitables aux itérations 2 et 3 (`1pg_sleep(10)`, `FETCH`/`IF`/`(SELECT 2)` en 2ᵉ instruction) |
| `it2/guard2.mjs` | ✅ « TOUS LES CAS OK » |
| `it2/guard3.mjs` | ✅ 38 refus, 16 acceptations, « TOUS LES CAS OK » |
| `it2/guard4.mjs` | ✅ 46 refus, 36 acceptations, « TOUS LES CAS OK » |
| `rev4/probe.mjs` (nouvelle) | ✅ `ecarts=0` sur 60 cas ; aucun texte accepté ne contient un caractère interdit |
| Octets de `sql-guard.ts` | ✅ 0 caractère `U+0085`/`U+2028`/`U+2029` ni contrôle C0 brut (hors `\n`), 0 `\r` : la ligne 22 n'utilise que des séquences d'échappement |
| Hygiène (`sql-guard.ts`) | ✅ aucun `TODO`, `console.log`, `any` ni `.only`/`.skip` |

### 2. Statut des constats de l'itération 3

| CR | Statut | Preuve / commentaire |
|---|---|---|
| CR-16 🔴 | ✅ **Corrigé** | **Position** : le pré-contrôle (`sql-guard.ts:196`) vient après `trim()` (`:192`) et le contrôle de longueur (`:194`), et **avant** `lex` (`:197`). Il porte sur `s`, dont `:215` renvoie une tranche (`s.slice(0, end)`) : le texte exécuté est donc toujours un sous-texte du texte contrôlé. **Expression** (`:22`) : `[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F  ]` ou `\r(?!\n)`. Les bornes sont exactes : elle exclut `\t` (09), `\n` (0A) et `\r` (0D) de la classe ; `\v` (0B), `\f` (0C), DEL et C1 (`7F`-`9F`, donc `U+0085`) sont inclus ; `\r` n'est admis que suivi de `\n`. Pas de drapeau `g`, donc `test()` est sans état (`lastIndex`). **Faux positifs** : aucun sur `\r\n` (y compris dans un commentaire, en début, en fin et sur plusieurs lignes), `\t`, NBSP, BOM de tête, ni sur l'Unicode imprimable (`é ✓ 中文`). **Contournements essayés, tous refusés** : `\r\r\n` (le premier `\r` est isolé), `\r` entouré d'espaces, `U+2028` suivi de `\n`, `U+0085`, `ESC`, `DEL`, `U+009F`. `lex` n'est pas modifiée ; la JSDoc (`:92`) renvoie au pré-contrôle, comme demandé. Message E-SQL-9 (`:19`) conforme mot pour mot |
| CR-17 🟡 | ✅ **Corrigé** | `sql-guard.ts:176` : `if (--depth < 0) throw new ReadOnlyError(MALFORMED)`. `assertSingleSelect` reçoit `lower`, qui vient du code **masqué** (`:203`, `:214`) : une `)` placée dans un littéral, un identifiant cité, une chaîne `"…"` MySQL ou un commentaire n'est pas comptée (`SELECT ')'`, `"a)"`, `-- )` sont acceptés). Refus E-SQL-4 : `SELECT 1) SELECT 2`, `SELECT 1)) SELECT 2 ((`, `SELECT 1 FROM t) UNION (SELECT 2`. L'appel reste placé après les listes : `SELECT (1)) DELETE t ((` garde son message explicite (DELETE). Non-régression `guard2`/`guard3`/`rev2` : verte |

### 3. Avis sur l'écart entre le prototype et la spécification (`"SELECT 1 AS a\r"`)

**L'écart est conforme à la spécification, et il est sûr.** Le prototype `arb/proto.mjs` teste l'entrée brute, alors que la spécification (§ 5, point 3, et la liste des acceptations) teste `s`, après `trim()`, et attend explicitement l'acceptation de ce cas. Le Dev a suivi la spécification : c'est le bon choix. Trois raisons :

1. `trim()` ne retire que des caractères **de bord**, et le texte renvoyé est `s.slice(0, end)`. Un caractère retiré n'est donc **jamais envoyé** au SGBD : il ne peut pas créer de divergence de découpage. `rev4/probe.mjs` le confirme : `"SELECT 1 AS a\r"`, `"\r\n SELECT 1 AS a \r"` et `"﻿SELECT …"` renvoient tous `"SELECT 1 AS a"`, et aucun texte accepté ne contient un caractère interdit.
2. Un `\r` isolé **à l'intérieur** du texte reste refusé, même s'il est entouré d'espaces (`"SELECT 1 AS a \r FROM t"`).
3. Tester l'entrée brute refuserait sans gain de sécurité des soumissions banales qui se terminent par une fin de ligne Mac ou par un séparateur Unicode collé.

Le compteur `acceptes_par_garde_actuelle=4` du prototype correspond exactement à ces 4 cas, un par dialecte. C'est un artefact de l'enveloppe, pas un défaut.

### 4. README

`README.md:108` : la ligne est exacte et cohérente avec la règle. Elle couvre `\r` isolé, les contrôles hors tabulation et fin de ligne, `U+2028`/`U+2029`, et précise que la règle s'applique « littéraux compris ». Les alternatives `CHR(13)` (PostgreSQL) et `CHAR(13)` (MySQL, SQL Server ; `char()` existe aussi en SQLite) sont correctes. **Conforme.**

### 5. Nouveaux constats et risque résiduel

**Aucun nouveau constat** (ni Bloquant, ni Majeur, ni Mineur). **R-10 n'est pas ouvert** : aucun nouveau contournement du lexer n'a été trouvé pendant cette boucle.

Points d'information, déjà connus et hors R-10 :
- Comportement réel de SQL Server sur `--` suivi de `\r` ou de `U+2028` : non vérifié (V-7 non accordé). C'est **sans incidence**, puisque la règle C2 refuse ces caractères quel que soit leur rôle lexical. Le QA peut le confirmer sous V-7, à titre d'information.
- Espaces Unicode non refusés (NBSP, BOM interne, `U+2000`-`U+200A`) : pour la garde (`\b` en ASCII, `\s` Unicode dans `FUNCTIONS`), ce sont des frontières de mot, ce qui la rend **plus stricte** que les SGBD (pour PostgreSQL, ce sont des caractères d'identifiant). Aucun d'eux ne termine un commentaire ni une chaîne dans les 4 dialectes : il n'existe pas de divergence exploitable.
- Le principe de l'ADR-S3-01 reste valable : la garde est une première ligne de défense, et le compte SGBD en lecture seule reste obligatoire (README).

### 6. Statut de revue par story

| Story | Statut | Constats ouverts |
|---|---|---|
| US-1 🔒 Markdown sûr (C1) | ✅ **Approuvé** (itération 1, non modifiée) | — |
| US-2 🔒 SQLite confiné (S2) | ✅ **Approuvé** (itération 2, non modifiée) | — |
| US-3 🔒 Anti-SSRF (S1) | ✅ **Approuvé** : le contournement indirect par `dblink`/`dblink_exec` (CR-16) est fermé | — |
| US-4 🔒 Lecture seule bornée (S3) | ✅ **Approuvé** : CR-1 à CR-17 corrigés | — |
| US-5 🔒 CSP `img-src` (S9 partiel) | ✅ **Approuvé** (itération 1, non modifiée ; la non-régression dans le navigateur reste à prouver par le QA) | — |

### 7. Verdict — itération 4 (final)

**✅ APPROUVÉ.** CR-16 (bloquant) et CR-17 (mineur) sont corrigés conformément à la spécification de l'arbitrage. Aucune régression sur les 9 scripts existants, aucun faux positif sur `\r\n` ni `\t`, `tsc` passe sans erreur. L'écart avec le prototype sur `"SELECT 1 AS a\r"` est conforme à la spécification et sûr. Aucun risque résiduel R-10 n'est ouvert, et la règle « pas de 5ᵉ boucle » est respectée.

→ Relais **QA**. Il doit reprendre les cas obligatoires du § 5 de l'arbitrage (suite `it2/guard4.mjs`) dans le plan de test de US-4, et, si V-7 est accordée, confirmer à titre d'information le comportement de SQL Server sur `--` suivi de `\r` ou de `U+2028`.

## Revue courte BUG-1 — apostrophe typographique (tâche orchestrateur #27)

**Entrées** : `qa-report.md` § 3 (BUG-1, Mineur), `validation-po.md` § 2 (décision : corriger avant commit), `dev-notes.md` § BUG-1.

### 1. Périmètre et diff revus

| Fichier:ligne | Constat |
|---|---|
| `src/server/connectors/sql.ts:12` | `CONNECTION_STRING_REFUSED` = `"Chaîne de connexion non prise en charge : renseignez l'hôte, le port et les identifiants."` : identique **octet pour octet** à `architecture.md:257`, `:569` et `:694` (E-SQL-7). 0 occurrence de U+2019 sur la ligne. Le littéral entre guillemets doubles est correct, sans échappement fragile. |
| `src/server/connectors/odoo.ts:25` | `"Odoo : la réponse n'est pas un JSON valide."` : apostrophe droite, 0 U+2019. |
| `src/server/connectors/saas.ts:29` | `` `${label} : la réponse n'est pas un JSON valide.` `` : apostrophe droite, 0 U+2019. |
| `tests/unit/safe-fetch.test.ts:279-283` | La normalisation `m.replace(/’/g, "'")` a disparu (0 occurrence dans `tests/`). Le test utilise `toBe(...)` sur le texte exact de la spécification : **plus strict** qu'avant. |
| `tests/unit/safe-fetch.test.ts:232-237` | La regex `/n.est pas.../` est remplacée par `toContain("la réponse n'est pas un JSON valide.")` : **plus strict** (l'apostrophe droite est imposée), et la non-fuite du corps (`not.toContain('SECRET-INTERNE')`) est conservée. |

Aucun autre code n'est touché. Aucun consommateur côté client ne compare ces messages (grep `src/` : seules les 3 définitions). La correction ne change ni le comportement ni les garde-fous (le refus de `c.url` à `sql.ts:20` est inchangé).

Écarts hors périmètre déclarés par le Dev (`TX_ESCAPED` `sql.ts:172`, « Jeton d’… » `saas.ts:97` et `:140`, « vérifiez l’adresse » `index.ts`) : ces textes ne sont pas fixés à l'apostrophe près par la spécification. Je confirme qu'ils sont **sans constat**. L'harmonisation éventuelle relève d'une dette typographique séparée.

### 2. Vérifications relancées

| Contrôle | Résultat |
|---|---|
| `npm test` (Vitest 5.1.0) | ✅ 6 fichiers, **575/575** tests passés, 3,6 s |
| `npx tsc --noEmit` | ✅ 0 erreur |
| Octets U+2019 sur les 5 lignes concernées | ✅ 0 |
| Hygiène (`TODO`, `FIXME`, `console.log`, `.only(`, `.skip(`) sur les sources et les tests du sprint | ✅ 0 occurrence |
| `npm run build` | non relancé : correction limitée à 3 littéraux de chaîne, déjà couverte par `tsc`. Le build final est à rejouer avant le commit (voir `git-log.md` § 6) |

### 3. Constats

**Aucun constat** (ni Bloquant, ni Majeur, ni Mineur). BUG-1 est **corrigé**.

### 4. Verdict — revue courte BUG-1

**✅ APPROUVÉ.** Le message E-SQL-7 est conforme mot pour mot à la spécification validée à la GATE 2. Les tests sont plus stricts et aucun n'a été assoupli. Les 575 tests et `tsc` passent. Comme le prévoit `validation-po.md` § 2, aucune nouvelle recette QA n'est nécessaire.

→ Relais **orchestrateur** : plan de commits (`git-log.md` § 6) à soumettre à l'humain.
