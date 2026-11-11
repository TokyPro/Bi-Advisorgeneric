# Notes de développement — Sprint `2026-11-10-securite-p0`

- **Auteur** : Dev Full Stack · **Date** : 2026-11-10 · **Tâche orchestrateur** : #7
- **Entrées** : `architecture.md` (T-1 à T-17, décisions GATE 2), `docs/audits/2026-11-10-audit-global.md`
- **Branche** : `fix/2026-11-10-securite-p0` (aucune opération Git d'écriture réalisée par le Dev)
- **Dépendances** : aucune ajoutée ni retirée ; `package.json`, `tsconfig.json`, `src/server/auth/**`, `src/lib/vault.ts`, `data/`, `.env*` (hors `.env.example`) non modifiés.

## 1. Tâches réalisées → fichiers

| Tâche | Statut | Fichiers |
|---|---|---|
| T-1 `markdown-safety.ts` + `SafeMarkdown.tsx` | ✅ | `src/lib/markdown-safety.ts` (créé), `src/components/ui/SafeMarkdown.tsx` (créé) |
| T-2 Branchement chat + rapport | ✅ | `src/components/chat/MessageBubble.tsx`, `src/components/report/ReportModal.tsx` — `react-markdown` n'est plus importé que dans `SafeMarkdown.tsx` |
| T-3 CSP `img-src` | ✅ | `next.config.mjs` (`headers()` : `Content-Security-Policy: img-src 'self' data: blob:` sur `/:path*`, aucune autre directive) |
| T-4 `sqlite-path.ts` | ✅ | `src/server/connectors/sqlite-path.ts` (créé) |
| T-5 Branchement SQLite + micro-copie | ✅ | `src/server/connectors/sql.ts` (`withSqlite` ouvre le realpath renvoyé), `src/components/connectors/ConnectorsModal.tsx` (libellé, placeholder `ventes.sqlite`, `split(/[\\/]/)`) |
| T-6 `net/policy.ts` | ✅ | `src/server/net/policy.ts` (créé) |
| T-7 `net/safe-fetch.ts` | ✅ | `src/server/net/safe-fetch.ts` (créé) |
| T-8 `saas.ts` | ✅ | `src/server/connectors/saas.ts` |
| T-9 `odoo.ts` | ✅ | `src/server/connectors/odoo.ts` |
| T-10 LLM | ✅ | `src/server/llm.ts`, `src/app/api/llm/chat/route.ts`, `src/app/api/llm/test/route.ts` |
| T-11 Hôtes SQL / Mongo | ✅ | `src/server/connectors/sql.ts` (`sqlTarget`), `src/server/connectors/mongo.ts` |
| T-12 `friendly()` | ✅ | `src/server/connectors/index.ts` |
| T-13 `sql-guard.ts` | ✅ | `src/server/connectors/sql-guard.ts` (créé) ; `sql.ts` réexporte `assertReadOnly` |
| T-14 Exécution bornée par SGBD | ✅ | `src/server/connectors/sql.ts` |
| T-15 Test / schéma | ✅ | `src/server/connectors/sql.ts` (mêmes wrappers : épinglage + délais ; SQL de schéma constant, inchangé) |
| T-16 Mention « compte lecture seule obligatoire » | ✅ | `ConnectorsModal.tsx` (DbForm), `README.md` (§ Sécurité, exemples PG / MySQL / SQL Server) |
| T-17 Documentation et configuration | ✅ | `.env.example` (bloc « Sécurité des connecteurs »), `README.md` (§ Sécurité, § Connecteurs, § Notes de migration, puce « authentification / rate-limit » corrigée) |

## 2. Écarts vs conception (et justification)

1. **Marqueur d'image dans le rapport (T-1)** : `variant="report"` utilise `border-slate-300 text-slate-500` au lieu de `border-line text-muted`. Le rapport est toujours rendu sur fond blanc (`bg-white`, `colorScheme: light`, export PDF) avec les couleurs `slate` déjà employées par `ReportModal` ; les tokens du thème sombre l'auraient rendu peu lisible. Le chat garde les tokens `border-line text-muted`.
2. **`safeUrlTransform` (T-1)** : refuse toute URL contenant un caractère de contrôle ou un blanc (`<= 0x20`, `0x7F–0x9F`, `U+2028/2029`) après `trim()`, en plus du contrôle `https:`/`mailto:`/`#`. `linkHost` renvoie le domaine de l'adresse pour un `mailto:`. Le lien sans hôte analysable n'a pas d'info-bulle. Aucun `aria-label` ajouté : il remplacerait le texte du lien pour les lecteurs d'écran.
3. **`resolveSqlitePath` (T-4)** : un fichier **absent situé hors du dossier** renvoie E-SQLITE-2 (refus) et non E-SQLITE-3 (introuvable), pour ne rien révéler de l'arborescence extérieure. Cela respecte le Gherkin (`../../autre-app/app.db` → refus). Le confinement utilise `path.relative` ; un nom de fichier commençant par `..` (ex. `..x.db`) reste accepté (contrôle `'..' + sep`).
4. **`resolveAllowed` / `guardedLookup` (T-6)** : les erreurs **DNS** (`ENOTFOUND`, `EAI_AGAIN`) sont propagées telles quelles, au lieu d'être converties en `NetworkPolicyError`. `friendly()` les traduit en « Hôte introuvable… », un message plus utile qui ne révèle rien d'interne. Les refus de politique restent `NetworkPolicyError(POLICY_MESSAGE)`.
5. **Plages internes (T-6)** : ajout de `::ffff:0:0:0/96` (SIIT), ce qui reste dans l'esprit d'une liste minimale. Les IPv4 embarquées `::ffff:a.b.c.d` et `::a.b.c.d` (IPv4-compatible) sont extraites puis classées en IPv4. Une adresse non analysable est classée interne (échec fermé).
6. **`assertMongoUriAllowed` (T-6)** : un 3ᵉ paramètre optionnel `srv` (résolveur SRV injectable) facilite les tests. Une URI hors `mongodb://`/`mongodb+srv://` renvoie un message dédié « URI MongoDB invalide : mongodb:// ou mongodb+srv:// attendu. » (absent du catalogue § 6).
7. **`safeFetch` (T-7)** :
   - `timeoutMs` couvre connexion + en-têtes ; si le corps est plafonné (`maxBytes` ≠ `null`), le **même délai couvre aussi la lecture du corps** (sinon un serveur lent bloquerait indéfiniment REST/Odoo). En mode flux (`maxBytes: null`), le délai s'arrête à la réception des en-têtes.
   - Si le corps est plafonné, il est **entièrement mis en mémoire tampon** dans `safeFetch`, avant de résoudre le `Response`. Les erreurs (taille, délai) rejettent donc directement l'appel, au lieu de remonter, déformées par undici, pendant `res.json()`. Le comportement est équivalent à l'ancien `res.json()`.
   - Les en-têtes dangereux (`host`, `content-length`, `transfer-encoding`, `connection`, `upgrade`, `proxy-authorization`, `te`, `trailer`, `keep-alive`, `expect`, `accept-encoding`) sont **retirés silencieusement** par `safeFetch` (défense en profondeur). Le refus explicite avec message est fait dans `saas.ts`.
   - Une erreur de délai porte le code `ETIMEDOUT` (traduit par `friendly()`). Le statut `304` n'est pas traité comme une redirection.
   - Constante supplémentaire exportée : `HTTP_BASEURL_MESSAGE` (E-LLM-2).
8. **`saas.ts` (T-8)** : une réponse non JSON renvoie « `<label>` : la réponse n'est pas un JSON valide. » : l'ancien `SyntaxError` contenait un extrait du corps distant. Les en-têtes personnalisés exigent aussi un nom valide au sens HTTP (sinon E « JSON invalide »), et le nom d'en-tête d'authentification (`authHeader`) passe par les mêmes contrôles. Pour une erreur réseau connue (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ETIMEDOUT`), on lève une `Error(code)` que `friendly()` traduit, ce qui évite de dupliquer les libellés.
9. **`odoo.ts` (T-9)** : une réponse non JSON renvoie « Odoo : la réponse n'est pas un JSON valide. ».
10. **LLM (T-10)** :
    - Les constantes `BASEURL_PROVIDERS` et `BASEURL_UNSUPPORTED` sont exportées par `llm.ts` et utilisées par les deux routes.
    - La route `chat` renvoie 400 pour une `NetworkPolicyError`.
    - L'ancien contrôle `^https?://` de `resolveBase` est supprimé : `safeFetch` le remplace (E-NET-2 / E-LLM-2).
    - Pour une base personnalisée en erreur, le corps est annulé (`res.body.cancel()`) sans être lu.
11. **SQL (T-11/T-14)** :
    - Un port non entier ou hors 1–65535 renvoie « Port invalide. » (message nouveau).
    - Une requête de plus de 20 000 caractères renvoie « Requête trop longue (20 000 caractères maximum). » (message nouveau).
    - Le délai client MySQL et le délai SGBD renvoient `QUERY_TIMEOUT_MESSAGE` (E-SQL-8), constante exportée par `sql-guard.ts` et réutilisée par `friendly()`.
    - MySQL passe par l'API cœur `mysql2` (`createConnection` + `.promise()`) pour lire en flux (`query().on('result')`) ; `sql_select_limit` n'est positionné **que** pour les requêtes utilisateur (pas pour le schéma, qui peut dépasser 1001 colonnes).
    - SQL Server : `SET ROWCOUNT` n'est appliqué qu'aux requêtes utilisateur ; les requêtes de schéma s'exécutent aussi dans la transaction annulée.
12. **`sql-guard.ts` (T-13), durcissements au-delà du minimum** (couverts par mes vérifications, à reprendre dans les tests du QA) :
    - un identifiant **cité** suivi de `(` est contrôlé contre la liste des fonctions (PostgreSQL exécute `"pg_sleep"(10)`) ;
    - les littéraux PostgreSQL `U&'…'` / `U&"…"` sont refusés (`Mot-clé ou fonction interdit (U&)`), car leurs échappements Unicode permettraient de déguiser un nom de fonction ;
    - les séquences (`FOR UPDATE`…) sont testées avant les mots isolés, pour que le message cite `FOR UPDATE` et non `UPDATE`.

## 3. Risque R-3 (MSSQL + `encrypt` + IP épinglée) — vérifié dans le code de tedious 20.3.8

- `tedious/lib/message-io.js` (`startTls`) positionne `servername: isIP(hostname) ? '' : hostname`. Avec une IP épinglée, l'extension SNI est donc **omise** et Node n'émet **pas** l'avertissement « Setting the TLS ServerName to an IP address ». **L'épinglage est conservé pour MSSQL, sans repli.**
- Effet de bord : le SNI et le nom de serveur du paquet LOGIN7 sont désormais l'IP. Sans conséquence avec `trustServerCertificate: true` (comportement inchangé, S10 hors périmètre). En revanche, **Azure SQL Database** (passerelle qui route selon le nom de serveur) pourrait refuser la connexion. Ce cas est **non vérifiable sans instance Azure** ; s'il se produit, il faudra arbitrer avec le Tech Lead (repli sans épinglage pour les seuls hôtes `*.database.windows.net`, par exemple).
- PostgreSQL : le nom d'origine est transmis en `ssl.servername` (SNI conservé). MySQL : SSL non configuré par l'application (inchangé).

## 4. Vérifications

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | ✅ 0 erreur |
| `npm run build` | ✅ succès (Next.js 15.5.29, « Compiled successfully », 9 pages, routes `/api/*` dynamiques) |

Vérifications ponctuelles du Dev (scripts jetables dans le scratchpad de session, **hors dépôt** et sans SGBD réel ni appel LLM réel) :
- `markdown-safety` : https / mailto / ancre conservés ; `http:`, `javascript:`, ` JaVaScRiPt:`, `java\tscript:`, `data:`, `//…`, URL avec espace → `''` ; `src` toujours vidé.
- `policy` : classification des plages (y compris `::ffff:127.0.0.1`, `::ffff:7f00:1`, `::127.0.0.1`, `64:ff9b::…`) ; enregistrement mixte public + interne refusé ; liste blanche `localhost:8000` (port 3000 refusé), CIDR `10.0.0.0/8`, `169.254.0.0/16` toujours refusé ; mode `allowlist` ; entrée invalide ignorée avec avertissement ; `guardedLookup` (`all` et adresse simple) ; tous les exemples Mongo du § 1 (+ `+srv` avec résolveur simulé).
- `safeFetch` contre un serveur `node:http` local : refus sans liste blanche **avec 0 requête reçue** ; `2130706433`, `[::ffff:127.0.0.1]`, `169.254.169.254` refusés ; avec liste blanche, 200 OK ; en-tête `Host` forcé ignoré ; 302 → E-NET-3 ; gzip décompressé ; bombe gzip (30 Mo) → E-NET-4 ; délai → ETIMEDOUT ; flux SSE lu ; POST ; `http://` LLM hors liste blanche → E-LLM-2.
- `sql-guard` : tous les exemples Gherkin US-4 (refus et faux positifs) donnent le message attendu ; cas pièges `E'\''`, `'\'` en PG standard, `--x` MySQL (`SELECT 5--3` accepté), `#temp` MSSQL, `$tag$` non terminé, `#` commentaire MySQL.
- `sqlite-path` : relatif, absolu interne, sous-dossier acceptés ; `../data/users.json`, `../../autre-app/app.db`, `/etc/passwd`, `C:\Windows\win.ini`, `:memory:`, vide, `file:…`, `../outside/x.sqlite`, `x.sqlite:flux` refusés ; `absent.sqlite` → introuvable ; `BI_SQLITE_DIR` absent → désactivé ; `BI_SQLITE_DIR` parent ou enfant de `BI_DATA_DIR` → « Configuration SQLite invalide. ». **Liens symboliques non testés** : la création échoue en `EPERM` (mode développeur Windows non actif) et le test par jonction n'a pas pu être lancé dans cette session. Cas à couvrir par le QA (voir § 5).

## 5. Points d'attention pour le QA et le reviewer

1. **Scripts `.mjs` du QA (§ 9.2)** : `policy.ts`, `sql-guard.ts`, `sqlite-path.ts` et `markdown-safety.ts` s'importent directement par `node` 24. En revanche, `safe-fetch.ts` importe `./policy` **sans extension** (exigé par `tsconfig` sans `allowImportingTsExtensions`, non modifiable) : pour l'importer depuis un script, enregistrer un crochet de résolution qui ajoute `.ts` (`module.register`, ~5 lignes, aucune dépendance). Sinon, le tester par HTTP via `/api/connectors/fetch`. Il en va de même pour `sql.ts`, `saas.ts`, `odoo.ts`, `llm.ts` (alias `@/`) : à tester par HTTP. Node affiche l'avertissement `MODULE_TYPELESS_PACKAGE_JSON` (bénin ; `--no-warnings` pour le masquer).
2. **Liens symboliques SQLite** : tester fichier lié et dossier lié sortant. Sous Windows, une jonction (`fs.symlinkSync(dir, lien, 'junction')`) ne demande pas de privilège ; pour un lien de fichier, le mode développeur est requis.
3. **CSP** : vérifier en `npm run dev` **et** `npm run start` (en-tête présent, aucune violation en navigation normale, Google Identity Services, export PNG/PDF, import PDF).
4. **Changements cassants attendus** (documentés dans README § Notes de migration) : SQLite désactivé sans `BI_SQLITE_DIR` ; destinations internes refusées ; `SHOW`/`DESCRIBE`/`EXPLAIN`/`PRAGMA` et `/* */` refusés ; chaînes de connexion SQL refusées ; redirections non suivies ; `baseUrl` refusée pour Anthropic/Gemini.
5. **SGBD réels (V-7 non accordé)** : `DECLARE CURSOR` + `queryMode: 'extended'` (PG), flux + `sql_select_limit` + `max_execution_time`/`max_statement_time` (MySQL/MariaDB), transaction annulée + `SET ROWCOUNT` + `readOnlyIntent` (MSSQL) **n'ont pas été exécutés contre de vraies bases**. Seule la compilation est vérifiée ; à marquer « non exécutés — en attente d'environnement » si V-7 reste refusé. SQLite (`stmt.readonly`, `iterate()`, `query_only`) est testable localement avec `better-sqlite3`.
6. **Reviewer** :
   - `catch` vides : chacun porte un commentaire justificatif ou renvoie une valeur explicite (`.catch(() => undefined)` pour le repli MariaDB et l'annulation de corps).
   - Aucun `any` nouveau, aucun `console.log`.
   - `console.warn` / `console.error` uniquement pour une configuration invalide (`BI_ALLOWED_HOSTS`, `BI_NETWORK_POLICY`, `BI_SQLITE_DIR`), sans donnée utilisateur ni chemin.
7. **Modules en syntaxe effaçable** : pas d'`enum`, de `namespace` ni de propriété de paramètre. Le champ de classe `readonly code = 'NETWORK_POLICY'` est effaçable (vérifié par exécution `node`).

## 6. Dette technique / suites (rappel, hors périmètre)

- R-2 Mongo sans épinglage ; R-4 SQLite synchrone sans délai ; R-6 export `.md` brut ; Azure SQL (§ 3).
- `friendly()` garde son repli « message brut » (S10). ~~La route `/api/llm/chat` renvoie encore le message brut des erreurs inattendues~~ : corrigé en itération 2 (CR-8).
- Indicateur « résultat tronqué à 1 000 lignes » (la ligne 1001 est déjà lue pour le permettre).

---

## Itération 2 — corrections CR (boucle 1/3, tâche orchestrateur #17)

Entrée : `code-review.md` itération 1 (CR-1 à CR-12). Aucune dépendance ajoutée. `package.json`, `tsconfig.json`, `next.config.mjs`, `src/server/auth/**`, `src/lib/vault.ts`, `data/` et `.env*` ne sont pas modifiés. Aucune opération Git d'écriture.

Scripts de vérification jetables, **hors dépôt**, dans le dossier `it2/` du scratchpad de session : `guard2.mjs` (sql-guard), `tds.mjs` (faux serveur TDS + faux SQL Browser UDP), `mysql.mjs` (faux serveur MySQL), `misc.mjs` (sqlite-path, policy, Mongo), avec `register.mjs`, `hook.mjs` et `mssql-shim.mjs` (résolution `.ts` et interop CJS de `mssql` sous Node). Le QA peut les reprendre dans `scripts/security/*.check.mjs`.

### Corrections

| CR | Correction (fichier) | Preuve locale | Cas à transmettre au QA |
|---|---|---|---|
| **CR-1** 🔴 | `sql-guard.ts` : (1) `commit`, `rollback`, `save`, `savepoint`, `begin`, `release` ajoutés à `WORDS` (tous dialectes) ; (2) liste `MSSQL_WORDS` (`deny`, `writetext`, `updatetext`, `receive`, `send`, `disable`, `enable`, `use`, `setuser`, `revert`, `checkpoint`, `open`, `close`, `while`, `goto`) et séquences `end/move/get conversation` ; (3) nouvelle règle `assertSingleSelect` (tous dialectes) : tout `SELECT` au niveau 0 de parenthèses ouvre une nouvelle instruction, sauf après `union`/`all`/`distinct`/`except`/`intersect`, ou une seule fois après la liste d'une CTE. `sql.ts` (`withMssql`) : après `fn`, `SELECT @@TRANCOUNT AS n` dans la transaction ; si `n !== 1`, le résultat est rejeté (`ReadOnlyError`) avant le `ROLLBACK` du `finally`. | `guard2.mjs` : **TOUS LES CAS OK** (49 refus attendus, 22 acceptations attendues). Les 6 cas de la sonde `rev/guard.mjs` sont désormais refusés. Gherkin US-4 (refus et faux positifs) inchangé. | Refus : `SELECT 1 COMMIT`, `SELECT 1 COMMIT DENY SELECT ON t TO public`, `SELECT 1 ROLLBACK DISABLE TRIGGER ALL ON t`, `SELECT 1 WRITETEXT t.c 0x00 'x'`, `SELECT 1 RECEIVE * FROM q`, `SELECT * FROM t SELECT 2`, `(SELECT 1) SELECT 2`, `WITH x AS (SELECT 1 a) SELECT * FROM x SELECT 2`, `SELECT 1 SAVE TRAN x`, `SELECT 1 BEGIN TRAN`, `SELECT 1 END CONVERSATION @h`, `SELECT 1 USE master`, `SELECT 1 WHILE 1=1 PRINT 1`. Acceptations : `… UNION ALL SELECT … EXCEPT SELECT … INTERSECT SELECT …`, CTE multiples + `UNION`, `WITH RECURSIVE`, `OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY`, `WITH (NOLOCK)` + sous-requête, `SELECT [open], [close], begin_date, release_date, saved FROM prix`. `@@TRANCOUNT` : non exécutable sans SQL Server (V-7). |
| **CR-2** 🔴 | `sql.ts` : `options.connector` de tedious (`mssqlConnector`). Chaque socket TDS, routage compris, est soumise à la politique : si l'hôte demandé est l'IP épinglée, le port effectif est contrôlé par `assertAddressAllowed` (nouvelle fonction exportée de `policy.ts`, sans nouvelle résolution DNS) ; sinon (routage vers un autre hôte), `resolveAllowed(hôte, port)` puis connexion à l'adresse vérifiée. Le refus d'origine (`NetworkPolicyError`) est renvoyé à la place du message tedious, qui cite hôte et port. | `tds.mjs`, faux serveur TDS en liste blanche qui répond à LOGIN7 par LOGINACK + jeton de routage vers `127.0.0.1:14332` : **A** (port de routage hors liste) → message E-NET-1, **0 connexion** sur 14332 ; **B** (témoin, port en liste) → 1 connexion sur 14332, ce qui prouve que le routage passe par le connecteur. | Rejouer A/B. Variante : routage vers un nom résolu en adresse interne → refus. |
| **CR-3** 🟠 | `sql.ts` : écouteur permanent `core.on('error')` posé dès `createConnection` (absorbe l'émission sans écouteur), et écouteur par requête dans `streamMysql`, qui relaie l'erreur fatale vers `done(err)` puis se retire. | `mysql.mjs`, faux serveur MySQL qui coupe la socket après une ligne : rejet `Connection lost: The server closed the connection.`, **0 exception non interceptée**, processus vivant. | Faux serveur MySQL en liste blanche qui coupe la connexion en plein résultat : l'API renvoie `ok:false` et le serveur Next reste disponible. |
| **CR-4** 🟠 | `sql.ts` (`withPg`) : `options: '-c standard_conforming_strings=on'` (paramètre de démarrage, prioritaire sur les réglages `ALTER DATABASE/ROLE … SET`), **plus** un contrôle `SHOW standard_conforming_strings` avant `BEGIN READ ONLY` : si la valeur n'est pas `on` (pooler qui ignore les paramètres de démarrage), la connexion est refusée avec un message explicite. | `tsc` + `build`. L'analyseur seul accepte toujours `SELECT 'a\'' , pg_sleep(10) -- '` (sonde `rev/pg.mjs`) : **c'est voulu** (voir écart 1). | Sur un PostgreSQL de test : `ALTER ROLE r SET standard_conforming_strings = off`, puis exécuter la requête piège : `pg_sleep` n'est pas exécuté (chaîne littérale). Derrière un pgbouncer qui ignore `options` : message « standard_conforming_strings doit valoir « on » ». |
| **CR-5** 🟠 | `sqlite-path.ts` : refus des entrées commençant par deux séparateurs (`\\hôte\…`, `//hôte/…`, `\\?\`, `\\.\`), et contrôle lexical `within(rootReal, candidate)` **avant** tout appel `fs`. Le `lstat`/`realpath` qui suit continue de traiter les dossiers intermédiaires liés. | `misc.mjs`, avec espion sur `fs.lstatSync` : UNC, `//hôte`, `\\?\C:\x.db`, `\\.\PhysicalDrive0\x.db`, `../outside/x.sqlite`, `../outside/absent.sqlite` et un absolu extérieur sont refusés avec **0 accès disque hors du dossier** ; `ventes.sqlite`, `sub/b.db` acceptés ; `absent.sqlite` → introuvable. | Ajouter `\\hote\p\x.db` et `//hote/p/x.db` à `sqlite-path.check.mjs` ; sous Windows, vérifier l'absence de trafic SMB (port 445) pendant l'appel. |
| CR-6 🟡 | `sql-guard.ts` : PG `pg_ls_\w+` (remplace `pg_ls_dir`), `pg_file_\w+` (adminpack), `pg_notify`, `pg_stat_reset\w*`, `pg_switch_wal`, `pg_promote`, `pg_create_restore_point`, `lo_\w+` (remplace `lo_import/export/unlink`) ; MSSQL `fn_xe_file_target_read_file`, `fn_get_audit_file`, `fn_trace_gettable`, `fn_dblog` ; MySQL mot-clé `procedure` (dialecte MySQL), `master_pos_wait`, `source_pos_wait`. | `guard2.mjs` : chaque ajout a son cas refusé. | Cas de `guard2.mjs` (`pg_ls_logdir()`, `lo_from_bytea`, `fn_dblog(NULL,NULL)`, `PROCEDURE ANALYSE()`…). |
| CR-7 🟡 | `policy.ts` : `srvServiceName` ajouté à `MONGO_FORBIDDEN`. README (notes de migration) mis à jour. | `misc.mjs` : `?srvServiceName=x` et `?SRVSERVICENAME=x` → « Option de connexion MongoDB non autorisée (srvServiceName). » | Idem. |
| CR-8 🟡 | `api/llm/chat/route.ts` : en dehors de `ProviderError` (statut du fournisseur) et `NetworkPolicyError` (400), on renvoie **toujours** « Réseau indisponible : fournisseur injoignable. » (E-LLM-3), en **502**, sans journaliser. Le client (`src/lib/llm/client.ts`) lit `error` quel que soit le statut. | `tsc` + `build`. | `baseUrl` personnalisée en liste blanche vers un port fermé : réponse E-LLM-3, sans IP ni port. |
| CR-9 🟡 | `sql.ts` (`streamMysql.stop`) : après `core.destroy()`, la socket est détruite (`core.stream.destroy()`, accès typé par conversion locale, car `stream` n'est pas déclaré dans les types de mysql2). | `mysql.mjs`, faux serveur qui émet 200 000 lignes en continu : 1 000 lignes renvoyées ; le serveur a émis 1 500 lignes au retour et 2 000 seulement 1,5 s après (émission interrompue par la fermeture). | Idem, avec `LIMIT 500000` sur une vraie base : le trafic s'arrête après la réponse. |
| CR-10 🟡 | `sql.ts` : `options.serverName = t.host` quand `t.host` n'est pas une IP. Le SNI porte le nom d'origine alors que la socket reste épinglée. | Code de tedious relu : `wrapWithTls` et `startTls` utilisent `options.serverName` en priorité. | Azure SQL (si un environnement est disponible) : la connexion par nom aboutit. Remarque : le nom de serveur du paquet LOGIN7 reste l'IP (tedious utilise `config.server`) ; si une passerelle l'exige, il faudra arbitrer. |
| CR-11 🟡 | Couvert par le connecteur de CR-2 : le port annoncé par SQL Browser est contrôlé par `assertAddressAllowed(t.host, port, IP épinglée)`. | `tds.mjs`, faux SQL Browser UDP sur `127.0.0.1:1434` : **C** (liste blanche `127.0.0.1:1433`, port annoncé 14331) → E-NET-1, **0 connexion** ; **D** (témoin, 14331 en liste) → connexion établie, puis routage vers 14332 refusé. | Rejouer C/D (UDP 1434 libre requis). |
| CR-12 🟡 | `policy.ts` : `64:ff9b:1::/48`, `2001::/32` (Teredo) et `fec0::/10` ajoutés à `INTERNAL_V6`. | `misc.mjs` : `64:ff9b:1::a00:1`, `fec0::1`, `2001:0:4136:e378::1` classées internes ; `2001:4860:4860::8888` et `2606:4700::1111` publiques. | Idem. |

### Écarts et arbitrages (à valider par le Tech Lead)

1. **CR-4 : option 1 du reviewer, avec vérification à l'exécution.** Le reviewer proposait soit de fixer le paramètre de session, soit de refuser tout `\` dans les littéraux PG sans `E`. J'ai retenu la première option : la seconde casserait des requêtes légitimes (expressions régulières `~ '^\d+$'`, chemins). J'ai ajouté le contrôle `SHOW` pour qu'aucun pooler ne puisse annuler silencieusement la garantie. L'analyseur seul accepte donc toujours la sonde `rev/pg.mjs`. Ce n'est pas un trou : la requête n'atteint jamais un serveur en `scs=off`. Si le Tech Lead préfère une défense purement lexicale, l'alternative tient en une ligne (`backslash: 'forbid'` pour les littéraux PG non `E`).
2. **CR-1 : `fetch` n'est pas bloqué en T-SQL** (le reviewer le demandait). `OFFSET … FETCH NEXT n ROWS ONLY` est la pagination standard de SQL Server. Un `FETCH` de curseur exige un `DECLARE`, déjà refusé, et reste une lecture. Le risque résiduel se limite aux curseurs globaux préexistants sur le serveur. **`open` et `close` sont bloqués** (`OPEN SYMMETRIC KEY` modifie le contexte de session) : une colonne nommée `open` ou `close` (cotations OHLC) doit être citée (`[open]`). C'est documenté dans les notes de migration du README.
3. **CR-1 : règle « un seul SELECT de tête » appliquée à tous les dialectes**, pas seulement à `mssql`. Aucune requête de lecture valide ne place un `SELECT` au niveau 0 ailleurs qu'après un opérateur ensembliste ou une CTE. Elle est évaluée **après** les listes de mots, pour que les messages des exemples Gherkin (`INTO`, `OPENROWSET`…) restent inchangés.
4. **CR-1 : `@@TRANCOUNT` sert à détecter, pas à prévenir.** Si un `COMMIT` échappait au filtre, les écritures déjà validées ne seraient pas annulées, mais le résultat serait refusé. La prévention reste le filtre lexical, et surtout le compte en lecture seule.
5. **CR-2 : connecteur plutôt que refus de tout routage.** Le routage légitime (groupes de disponibilité Always On, Azure SQL avec redirection) continue de fonctionner vers une destination autorisée. Le typage de tedious (`connector?: () => Promise<Socket>`) ne correspond pas à l'appel réel `connector(options, lookup, signal)` (`connection.js:1305-1306`), d'où une conversion `as unknown as`, commentée.
6. **Non traité : la requête UDP SQL Browser (port 1434)** part vers l'IP épinglée et validée, mais son port n'est pas confronté à la liste blanche. Une entrée `hôte:1433` n'autorise donc pas explicitement l'UDP 1434. L'impact est faible (un datagramme vers un hôte déjà autorisé), et le contrôle casserait les entrées `hôte:1433` existantes. À arbitrer par le Tech Lead si l'on veut l'exiger.
7. **Nouveaux messages hors catalogue § 6** (à ajouter par le Tech Lead / UX) : « Requête refusée : elle a modifié l'état transactionnel de la session. » (MSSQL) ; « PostgreSQL : le paramètre standard_conforming_strings doit valoir « on » pour ce connecteur. ».

### Vérifications — itération 2

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | ✅ 0 erreur |
| `npm run build` | ✅ succès (Next.js 15.5, 16 routes, `/api/*` dynamiques) |
| Sondes du reviewer `rev/guard.mjs`, `rev/pg.mjs` | 10/11 cas refusés. Le cas PG `'a\''` de `guard.mjs` ne contient en fait pas de `\` (en JS, `\'` vaut `'`) : c'est un littéral valide dans tous les modes, accepté à juste titre. Le vrai cas avec `\` (`pg.mjs`) est traité en session (écart 1) |
| `it2/guard2.mjs`, `it2/misc.mjs`, `it2/tds.mjs`, `it2/mysql.mjs` | ✅ tous conformes (détail dans le tableau ci-dessus) |
| Hygiène (fichiers modifiés) | aucun `TODO`, `console.log`, `.only`/`.skip` ni `any` nouveau |

Non exécuté (V-7 non accordé, sans SGBD réel) : `@@TRANCOUNT` sur SQL Server, `standard_conforming_strings` sur PostgreSQL, Azure SQL avec `serverName`.

## Itération 3 — corrections CR-13 à CR-15 (boucle 2/3, tâche orchestrateur #19)

Entrée : `code-review.md` § « Itération 2 ». Fichiers modifiés : `src/server/connectors/sql-guard.ts`, `src/server/connectors/sql.ts`, `README.md`.

### Corrections

| CR | Correction | Preuve | Cas de test QA |
|---|---|---|---|
| **CR-13** 🔴 | `sql-guard.ts` : `assertMssqlNumbersSeparated`, appelée dans `assertReadOnly` pour le dialecte `mssql` uniquement, **avant** les listes. Elle parcourt le code masqué (littéraux, identifiants cités et commentaires neutralisés). Une position commence un nombre si elle porte un chiffre, un `.` suivi d'un chiffre ou un `$` suivi d'un chiffre ou de `.chiffre`, et si le caractère précédent n'est pas un caractère d'identifiant `[a-z0-9_@#$]` (sinon c'est un identifiant : `t1`, `@v2`, `#tmp3`, `a$1`). Le littéral est consommé de façon gloutonne, comme le fait le lexer T-SQL : `0x[0-9a-f]*` ou `\$?(\d+\.?\d*\|\.\d+)(e[+-]?\d+)?`. S'il est suivi d'un caractère d'identifiant, la requête est refusée avec le message « SQL Server : séparez les nombres des mots-clés par un espace (« 1 FROM » et non « 1FROM »). ». J'ai retenu la variante 1 du reviewer, en version « lexer » plutôt que par jeton `[a-z0-9_$@#.]+` : un découpage par jeton aurait rejeté `$PARTITION`/`$IDENTITY` et mal traité `t.1COMMIT`. **Collages analogues examinés** : `N'x'COMMIT`, `'x'COMMIT`, `[a]COMMIT`, `"a"COMMIT` et `$COMMIT` étaient déjà refusés, car `'`, `]`, `"` et `$` ne sont pas des caractères de mot et `\b` y voit une frontière. `'x'SELECT 2` et `[a]SELECT 2` sont refusés par `assertSingleSelect`, qui lit les délimiteurs comme des jetons séparés. Les symboles monétaires non ASCII (`€1COMMIT`) sont couverts : le chiffre qui suit le symbole ouvre un nombre. | Sondes `rev2/probe.mjs` et `rev2/probe2.mjs` : **tous les cas CR-13 et CR-15 sont refusés**. Restent acceptés, conformément au § 4 de la revue : PG `1pg_sleep(10)` (non exploitable), `FETCH`/`IF`/`PRINT`/`(SELECT 2)` en 2ᵉ instruction, et les témoins de faux positifs. `it2/guard2.mjs` : « TOUS LES CAS OK », sans régression. Nouvelle suite `it2/guard3.mjs` : 38 refus et 16 acceptations, « TOUS LES CAS OK ». | Refus (`mssql`) : `SELECT 1COMMIT`, `SELECT 1COMMIT IF 1=0x00TRUNCATE TABLE t`, `SELECT .5COMMIT`, `SELECT 1e1COMMIT`, `SELECT $1COMMIT`, `SELECT 1.5E-3COMMIT`, `SELECT 0x1FTRUNCATE TABLE t`, `SELECT t.1COMMIT`, `SELECT €1COMMIT`, `SELECT 1 FROM t WHERE a=1SELECT 2`. Acceptations : `SELECT 1e5, 0x1F, $10, .5, t1.col2 FROM t3`, `SELECT TOP 10 col2 FROM t3 WHERE c1=0x1F`, `SELECT 1e3, 0x1F, .5, $1.50, 1.5E-3, 1.5e+3, $.5, 1.`, `… OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY`, `SELECT @v1, @@ROWCOUNT, a$1 FROM #tmp1`, `SELECT [2023_ventes].[1col] FROM [2023_ventes]`, `SELECT $PARTITION.pf(c), $IDENTITY FROM t`, MySQL `SELECT 2023_ventes FROM t`. Avec SQL Server (V-7) : vérifier que `SELECT 1COMMIT` est bien lu `1 COMMIT` par le serveur. |
| CR-14 🟡 | `sql.ts` (`withPg`) : `BEGIN READ ONLY` est exécuté **avant** `SHOW standard_conforming_strings`. La vérification a lieu dans la transaction, donc sur la même connexion serveur que le curseur, même derrière un pooler en mode transaction. En cas d'échec, l'erreur traverse le `finally`, qui annule la transaction. | `tsc` + `build` ; relecture de l'ordre des appels. | PostgreSQL avec un pgbouncer en mode `transaction` (V-7) : avec `scs=off`, refus explicite ; avec `on`, la requête aboutit. |
| CR-15 🟡 | `sql-guard.ts` : `raiserror` et `add` ajoutés à `MSSQL_WORDS`, avec un commentaire qui justifie l'ajout. Les deux sont des mots réservés T-SQL, donc toute colonne de ce nom est déjà citée. `DATEADD` et `date_add` ne sont pas touchés, faute de frontière `\b`. | `rev2/probe.mjs` : `RAISERROR … WITH LOG` et `ADD SIGNATURE` refusés. `guard3.mjs` : `ADD COUNTER SIGNATURE` refusé, `DATEADD(day, 1, d)` accepté. | Mêmes cas. |

### Écarts et remarques

1. **Faux positif assumé** : `SELECT 1e`, un flottant à exposant vide, est refusé. Cette forme n'apparaît jamais dans une requête générée ; elle est sans enjeu.
2. **Hors périmètre, signalé seulement** : `SELECT 1) SELECT 2` est accepté par la garde, car la profondeur devient négative dans `assertSingleSelect`. SQL Server refuse tout le lot à la compilation (parenthèse non appariée) : aucune instruction n'est exécutée. Si le reviewer souhaite une défense en profondeur, `depth < 0` → message `MALFORMED` tient en une ligne.
3. Le dépôt ne contient pas de fichier `sql-guard.check.mjs`. Les cas sont dans `it2/guard3.mjs` (scratchpad). Le QA pourra les reprendre quand un framework de test sera validé.

### Vérifications — itération 3

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | ✅ 0 erreur |
| `npm run build` | ✅ succès (code 0, 16 routes) |
| `rev2/probe.mjs`, `rev2/probe2.mjs` | ✅ tous les cas CR-13 et CR-15 sont refusés |
| `it2/guard2.mjs` | ✅ « TOUS LES CAS OK » (aucune régression) |
| `it2/guard3.mjs` (nouveau) | ✅ 38 refus, 16 acceptations, « TOUS LES CAS OK » |
| Hygiène | aucun `TODO`, `console.log`, `any` ni `.only`/`.skip` introduit |

## Itération 4 — CR-16 / CR-17 (boucle exceptionnelle 4, option C validée par l'humain, tâche orchestrateur #23)

Entrées : `code-review.md` § « Itération 3 » et § « Arbitrage après boucle 3 » ; `architecture.md` (ADR-S3-01 amendé, E-SQL-9). Fichiers modifiés : `src/server/connectors/sql-guard.ts`, `README.md` (1 ligne de notes de migration). Aucun autre fichier de `src/` n'a été touché.

### Corrections

| CR | Correction | Preuve | Cas de test QA |
|---|---|---|---|
| **CR-16** 🔴 (T-13-bis) | `sql-guard.ts` : ajout de la constante `CONTROL_CHAR` (E-SQL-9, texte repris mot pour mot de la spécification) et de l'expression `CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F  ]\|\r(?!\n)/`. Dans `assertReadOnly`, le test `if (CONTROL_CHARS.test(s)) throw …` est placé **après** `trim()` et le contrôle de longueur, **avant** `lex`. Il porte sur `s`, dont une tranche est renvoyée puis exécutée. `lex` n'est pas modifiée (la fin de commentaire reste `indexOf('\n')`) ; un commentaire d'une ligne dans sa JSDoc renvoie au pré-contrôle. | `rev3/probe2.mjs` : les 6 premiers cas sont refusés avec E-SQL-9 ; le 7ᵉ (`--x\r\nFROM t`) reste accepté. `rev3/probe.mjs` : les variantes `\r`, `U+2028` et `U+0085` sont refusées en `mssql`, `postgres`, `mysql` et `sqlite`. `arb/proto.mjs` : 50 refus et 32 acceptations, `echecs_proto=0`. Nouvelle suite `it2/guard4.mjs` : 46 refus (message vérifié) et 36 acceptations (texte renvoyé vérifié), « TOUS LES CAS OK ». | Refus E-SQL-9 : `postgres` `"SELECT 1 AS a --x\r, pg_read_file('/etc/passwd') AS b\nFROM t"`, la même requête avec `dblink(…)`, `dblink_exec(…)` et `pg_terminate_backend(pid)` ; `mssql` `"SELECT 1 AS a --x\rCOMMIT DELETE t\nFROM u"` ; `mysql` `"SELECT 1 -- x\r' \n, sleep(10) -- '"`. Dans les 4 dialectes : `"SELECT 'a\rb' AS x"`, `"SELECT 1 AS a --x<C>, 2\nFROM t"` avec `<C>` ∈ {`U+0085`, `U+2028`, `U+2029`, `\f`, `\v`, `\0`}, et `"SELECT 1\0 FROM t"`. Acceptations dans les 4 dialectes : `"SELECT 1 AS n -- note\r\nFROM t"`, `"SELECT a,\r\n  b\r\nFROM t\r\nWHERE x IN (1,2)\r\n"`, `"SELECT\tx FROM t\n"`, `"SELECT 1 AS a\r"` (renvoie `"SELECT 1 AS a"`), `"SELECT 'é ✓ 中文' AS u"`. |
| CR-17 🟡 (T-13-ter) | `assertSingleSelect` : `else if (t === ')') { if (--depth < 0) throw new ReadOnlyError(MALFORMED); }`. La fonction reçoit le code masqué : une `)` placée dans un littéral, un identifiant cité ou un commentaire n'est pas comptée. | `guard4.mjs` et `rev3/probe.mjs` : `SELECT 1) SELECT 2`, `SELECT 1)SELECT 2` et `SELECT 1)) SELECT 2 ((` sont refusés avec E-SQL-4 (MALFORMED). `SELECT (1)) DELETE t ((` est refusé plus tôt par la liste de mots (DELETE), qui garde son message explicite. | Refus E-SQL-4 dans les 4 dialectes : `"SELECT 1) SELECT 2"`, `"SELECT 1)) SELECT 2 (("`. Acceptations : `"WITH c AS (SELECT 1 AS x) SELECT x FROM c"`, `"(SELECT 1) UNION (SELECT 2)"`, `"SELECT ')' AS p, \"a)\" FROM t"` (en `mysql`, `"a)"` est une chaîne), `"SELECT 1 -- )\nFROM t"`. |

### Écarts et remarques

1. **Écart entre le prototype et la spécification, signalé ; la spécification est suivie.** `arb/proto.mjs` range `"SELECT 1 AS a\r"` parmi les **refus**, parce que son enveloppe teste l'entrée **avant** `trim()`. La spécification (§ 5, point 3, et liste des acceptations) demande au contraire de tester `s`, **après** `trim()`, et attend l'**acceptation** de ce cas (texte renvoyé : `"SELECT 1 AS a"`). C'est ce qui est implémenté. Le prototype reste à 50/32 avec 0 écart, puisque son enveloppe applique sa propre règle. Son compteur `acceptes_par_garde_actuelle` vaut désormais **4** (contre 49 avant la correction) : ce sont exactement les 4 occurrences de `"SELECT 1 AS a\r"`, une par dialecte. Ce résultat est conforme à la spécification, et aucun autre cas de refus n'est accepté par la garde.
2. **Déjà acceptés et jugés non exploitables aux itérations 2 et 3** (aucun changement, la correction ne fait qu'ajouter des refus) : `a$1COMMIT`, `@1COMMIT`, `$$1COMMIT`, `0x00add …`, PG `1pg_sleep(10)`, `FETCH`/`IF`/`PRINT`/`(SELECT 2)` en 2ᵉ instruction.
3. **Point d'outillage** : l'outil d'édition avait écrit `U+2028`/`U+2029` sous forme de caractères bruts dans l'expression régulière, ce qui est une fin de ligne pour JS et donc une `SyntaxError`. J'ai réécrit la ligne avec les séquences d'échappement `  `. Le fichier ne contient plus aucun caractère `U+0085`, `U+2028` ni `U+2029` brut (vérification réalisée).
4. **V-7 non accordée** : la fin du commentaire `--` sur `\r` et sur `U+2028` n'a pas été vérifiée sur un vrai SQL Server. C'est une information seulement, puisque la règle refuse les deux cas.

### Vérifications — itération 4

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | ✅ 0 erreur |
| `npm run build` | ✅ succès (code 0, 16 routes) |
| `arb/proto.mjs` | ✅ `refus=50 accept=32 echecs_proto=0` (voir l'écart 1) |
| `rev3/probe2.mjs` | ✅ 6 premiers cas refusés (E-SQL-9), 7ᵉ accepté |
| `rev3/probe.mjs`, `rev2/probe.mjs`, `rev2/probe2.mjs` | ✅ seuls restent acceptés les témoins de faux positifs et les cas déjà jugés non exploitables (écart 2) |
| `it2/guard2.mjs` | ✅ « TOUS LES CAS OK » |
| `it2/guard3.mjs` | ✅ 38 refus, 16 acceptations, « TOUS LES CAS OK » |
| `it2/guard4.mjs` (nouveau, hors dépôt) | ✅ 46 refus, 36 acceptations, « TOUS LES CAS OK » |
| Hygiène | aucun `TODO`, `console.log`, `any` ni `.only`/`.skip` introduit |

## BUG-1 — apostrophe typographique dans les messages (tâche orchestrateur #26, décision PO : corriger avant commit)

| Fichier | Modification |
|---|---|
| `src/server/connectors/sql.ts` | `CONNECTION_STRING_REFUSED` (E-SQL-7) : `’` → `'`. Le littéral passe entre guillemets doubles pour contenir l'apostrophe droite. Le texte correspond désormais mot pour mot à `architecture.md` § 6. |
| `src/server/connectors/saas.ts` | « la réponse n'est pas un JSON valide. » : `’` → `'` (harmonisation demandée par le PO). |
| `src/server/connectors/odoo.ts` | même message, même correction (littéral entre guillemets doubles). |
| `tests/unit/safe-fetch.test.ts` | Test « chaîne de connexion SQL refusée » : la normalisation `m.replace(/’/g, "'")` est supprimée, l'égalité stricte avec le texte de la spécification verrouille donc E-SQL-7. Test « réponse non JSON » : la regex `/n.est pas.../` laisse place à `toContain("la réponse n'est pas un JSON valide.")`. Les tests sont plus stricts, aucun n'a été assoupli. |

Vérifications : `npm test` → 575/575 ✅ · `npx tsc --noEmit` → 0 erreur ✅. Aucun comportement ni garde-fou modifié.
Hors périmètre, non modifiés : les autres messages contiennent encore `’` (`TX_ESCAPED` dans `sql.ts`, messages « Jeton d’… » dans `saas.ts`, « vérifiez l’adresse » dans `index.ts`). Aucun d'eux n'est fixé à l'apostrophe près par la spécification. Si l'on veut harmoniser, c'est une dette typographique à part.
