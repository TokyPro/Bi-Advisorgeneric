# Plan de test — Sprint `2026-11-10-securite-p0`

- **Auteur** : QA Engineer · **Date** : 2026-11-10 · **Tâche orchestrateur** : #9
- **Références** : `architecture.md` § 1 (Gherkin US-1 à US-5), § 6 (messages), `dev-notes.md` (it. 1 à 4), `code-review.md` (it. 1 à 4 + arbitrage), `README.md`.
- **Décisions humaines applicables** : V-7 = NON (aucun SGBD réel, base cliente, LLM réel ni service tiers ; seuls faux serveurs `127.0.0.1` et serveur `npm run dev` local) ; Vitest autorisé (`npm install -D vitest`, script `test`, `vitest.config.ts`).

## 1. Environnement et données

| Élément | Valeur |
|---|---|
| OS / Node | Windows 11, Node v24.14.0 |
| Outillage | Vitest 5.1.0 (`npm test` = `vitest run`), `npx tsc --noEmit`, `npm run build`, `curl`, Chrome DevTools MCP (page non authentifiée) |
| Config | `vitest.config.ts` : environnement node, alias `@/` → `src/`, JSX automatique (oxc) |
| Données | Aucune donnée réelle. Dossiers temporaires du système (`mkdtemp`), bases SQLite créées à la volée, faux serveurs HTTP / TDS / MySQL / SQL Browser sur `127.0.0.1` (ports éphémères, sauf UDP 1434 pour SQL Browser) |
| Interdits respectés | `data/` et `.env*` ni lus ni modifiés ; aucun appel réseau tiers ; aucun navigateur Playwright installé |
| Résolution DNS | Jamais réelle : résolveurs injectés (`policy.ts`), URI Mongo avec IP littérales pour les appels en processus |

## 2. Fichiers de test

| Fichier | Tests | Couvre |
|---|---|---|
| `tests/unit/sql-guard.test.ts` | 305 | US-4 : Gherkin refus / faux positifs, scripts guard2, guard3, guard4, sondes rev2, rev3, rev4, prototype d'arbitrage, invariant « texte exécuté sans caractère interdit » |
| `tests/unit/policy.test.ts` | 90 | US-3 : classification IP (IPv4, IPv6, IPv4 embarquée, 6to4, Teredo, NAT64), syntaxe d'hôte, résolution, liste blanche, mode allowlist, anti DNS-rebinding (`guardedLookup`), URI MongoDB |
| `tests/unit/safe-fetch.test.ts` | 73 | US-3 : `safeFetch` contre faux serveur HTTP (0 requête reçue sur refus, 302, 20 Mo, bombe gzip, délais, flux SSE, Host forcé), connecteur REST, `friendly()`, hôtes SQL / Mongo / Odoo / LLM internes (en processus) |
| `tests/unit/sqlite-path.test.ts` | 49 | US-2 : confinement, UNC, jonction de répertoire réelle, simulation de lien de fichier, SQLite réel (lecture seule, SHA-256, 1000 lignes) |
| `tests/unit/markdown-safety.test.tsx` | 48 | US-1 : `safeUrlTransform`, `linkHost`, rendu HTML réel de `SafeMarkdown` (chat et rapport) |
| `tests/unit/sql-fake-servers.test.ts` | 10 | US-3 / US-4 : tedious (routage TDS, SQL Browser) et mysql2 (coupure, flux 1000 lignes, LOCAL INFILE, ordre des commandes READ ONLY) contre faux serveurs |

Manuel / outillage : `curl` sur `npm run dev` (CSP, sessions), navigateur sur page non authentifiée (violation `img-src`), relecture du README et du formulaire (US-4, dernier scénario).

## 3. Matrice de traçabilité

Légende : **A** automatisé Vitest · **C** curl / navigateur local · **R** relecture · **⏳** non exécutable sous V-7 ou sans authentification, procédure donnée dans `qa-report.md` § 5.

### US-1 — Markdown LLM sûr

| Critère Gherkin | Type | Cas |
|---|---|---|
| Image dans le chat non chargée, marqueur textuel | A | `markdown-safety` « image Markdown (chat) » (HTML sans `<img>`, sans hôte, marqueur + alt) |
| Image dans le rapport, y compris export PDF | A + ⏳ | rendu `variant=report` ; export PDF réel et onglet Réseau ⏳ |
| Image en syntaxe de référence | A | `![a][r]` + définition |
| Plan : liens sûrs / non sûrs (7 exemples + variantes) | A | `safeUrlTransform` (5 conservés, 20 refusés), rendu HTML (https, mailto, ancre, 8 liens refusés) |
| Domaine visible avant clic | A | `title="Lien externe vers attaquant.tld"` |
| HTML brut ignoré | A | `<img>`, `<script>`, `<iframe>` échappés |
| « Aucune requête réseau » (onglet Réseau) | ⏳ | nécessite session authentifiée (voir § 5) |

### US-5 — CSP `img-src`

| Critère | Type | Cas |
|---|---|---|
| En-tête exact sur les pages | C | `curl -I /` + toutes les routes `/api/*` (dev) |
| Image distante injectée bloquée | C | `new Image()` dans le navigateur local, violation `img-src` capturée |
| Aucune régression (onboarding, chat, canevas, exports, import PDF, thème, GIS) | ⏳ partiel | page de connexion : police chargée, aucun autre message CSP ; parcours authentifié ⏳ |

### US-2 — SQLite confiné

| Critère | Type | Cas |
|---|---|---|
| SQLite désactivé sans `BI_SQLITE_DIR` | A | `resolveSqlitePath` et `test('sqlite')` |
| Fichier autorisé, schéma | A | SQLite réel (`better-sqlite3`) : message « SQLite … », tables listées |
| Chemin absolu interne accepté | A | idem |
| Plan : chemins refusés (10 lignes) | A | 16 refus paramétrés ; message exact, sans chemin ; jonction réelle ; lien de fichier simulé (réel ⏳) |
| Lecture seule, fichier inchangé | A | SELECT OK, SHA-256 et mtime identiques, 10 écritures refusées, 1000 lignes max |
| UNC / `\\?\` / `\\.\` (CR-5) | A | refus lexical, 0 accès disque sur le chemin demandé |

### US-3 — Anti-SSRF

| Critère | Type | Cas |
|---|---|---|
| Plan : 14 destinations internes REST | A | 8 URL directes + 8 variantes de loopback avec serveur témoin (0 requête) ; `2130706433`, `0x7f000001`, `0177.0.0.1`, `[::ffff:127.0.0.1]`, `localhost` |
| Nom d'hôte → IP interne | A | `resolveAllowed`, REST, Odoo, LLM, SQL |
| Anti DNS-rebinding | A | `guardedLookup` : 1 résolution, adresse vérifiée utilisée |
| Redirections non suivies | A | 302, cible jamais contactée, message exact |
| Identifiants dans l'URL | A | message exact |
| Corps d'erreur non renvoyé | A | « API REST HTTP 500. » sans `SECRET-INTERNE` |
| Host non forçable | A | message « En-tête non autorisé : Host. » + 9 autres en-têtes ; `safeFetch` ignore Host |
| Liste blanche, port différent refusé | A | |
| Métadonnées cloud toujours refusées | A | |
| Mode allowlist | A | |
| baseUrl LLM : fournisseur non compatible | A (logique) / C | constante `BASEURL_UNSUPPORTED` + route : session requise, test de route ⏳ |
| baseUrl LLM http:// | A | message exact |
| Fournisseurs officiels | ⏳ | appel réel interdit (V-7) |
| Plan : hôtes SQL internes | A | 3 SGBD, y compris serveur TCP témoin (0 connexion) |
| Chaîne de connexion SQL, socket Unix | A | messages (BUG-1 sur l'apostrophe) |
| Plan : URI MongoDB | A | 6 exemples + variantes, driver MongoDB pour `srvServiceName%3D` |
| Routage TDS, SQL Browser (CR-2, CR-11) | A | faux serveurs : A, B, C, D |
| Sessions obligatoires sur `/api/*` | C | 14 routes, sans cookie : 401 / 405 |

### US-4 — Lecture seule

| Critère | Type | Cas |
|---|---|---|
| Plan : 16 requêtes refusées | A | messages vérifiés |
| Plan : 9 faux positifs | A | |
| Complétude arbitrage § 5 (CR-16, CR-17) | A | 6 refus nommés + 4 dialectes × (6 contrôles + NUL + 2 parenthèses) ; 4 dialectes × 9 acceptations avec texte renvoyé |
| CR-1, CR-13, CR-15, CR-6 | A | 200+ cas |
| Volume borné à 1000 | A (SQLite, MySQL faux) / ⏳ (PG curseur, MSSQL ROWCOUNT, 2 M lignes, mémoire) | |
| Délai 30 s | ⏳ | PG `statement_timeout`, MySQL `max_execution_time`, MSSQL : SGBD réel |
| Écriture annulée (MySQL, MSSQL, PG) | A (ordre des commandes) / ⏳ (effet serveur) | |
| LOCAL INFILE refusé | A | faux serveur MySQL |
| Documentation compte lecture seule | R | README § Sécurité (l. 37, 46-65), formulaire `ConnectorsModal` |

## 4. Non-régression sécurité (stories 🔒)

Authentification : 14 routes `/api/*` sans cookie. Isolation / data : `BI_SQLITE_DIR` ne peut contenir `BI_DATA_DIR`. Secrets : aucun test n'affiche ni n'enregistre de clé réelle. Lecture seule : cf. US-4. Chaque test mutant l'environnement restaure `BI_ALLOWED_HOSTS`, `BI_NETWORK_POLICY`, `BI_SQLITE_DIR`.

## 5. Critères de sortie

`npm test` vert, `tsc` et `build` sans erreur, chaque critère Gherkin avec statut ✅ / ❌ / ⏳ et preuve, aucun `.skip` / `.only` / `TODO` / test vide, verdict explicite.
