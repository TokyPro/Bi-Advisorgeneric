# Validation fonctionnelle PO — Sprint `2026-11-10-securite-p0`

- **Auteur** : Product Owner · **Date** : 2026-11-10 · **Tâche orchestrateur** : #25
- **Entrées lues** : `architecture.md` (Gherkin, décisions GATE 2), `qa-report.md` (GO CONDITIONNEL), `code-review.md` (Approuvé, itération 4), `README.md` (notes de migration)

## VERDICT GLOBAL : ACCEPTÉ SOUS RÉSERVE

Les 5 stories sont acceptées pour la **livraison dans le dépôt (commits / GATE 3)**. Elles ne sont **pas** acceptées pour une mise en production tant que la dette de recette ⏳ prioritaire (§ 3) n'est pas rejouée. Aucune story refusée. Une correction mineure est demandée avant commit (BUG-1).

## 1. Verdict par story

| Story | Verdict | Justification |
|---|---|---|
| US-1 🔒 Markdown LLM sûr (C1) | ✅ **Acceptée sous réserve** | Tous les scénarios Gherkin sont prouvés au niveau du HTML rendu (0 `<img>`, marqueur « Image non affichée (protection des données) », liens non sûrs en texte simple, info-bulle du domaine, HTML brut ignoré). Réserve : l'absence de requête dans l'onglet Réseau et le marqueur dans le PDF exporté n'ont pas été observés dans un navigateur authentifié (QA § 5.4 a, b). Le risque résiduel est faible, la garantie « pas d'`<img>` » étant établie. |
| US-5 🔒 CSP `img-src` | ✅ **Acceptée sous réserve** | En-tête exact présent sur pages, `/api/*` et 404 ; image distante injectée bloquée (violation CSP observée). Réserve : « aucune régression CSP » n'est vérifié que sur la page de connexion ; le parcours authentifié (onboarding, chat, canevas, export PNG/PDF, import PDF, thème, Google Identity) et `npm run start` restent ⏳ (§ 5.4 c, d). |
| US-2 🔒 SQLite confiné | ✅ **Acceptée** | Tous les scénarios sont ✅ avec preuve réelle (base `better-sqlite3`, jonction de répertoire réelle, empreinte SHA-256 inchangée, messages exacts sans fuite de chemin). Seul écart : le lien symbolique de **fichier** est prouvé par simulation (EPERM Windows), le code de refus étant exercé. À rejouer en réel (§ 5.5), non bloquant. |
| US-3 🔒 Anti-SSRF | ✅ **Acceptée sous réserve** | 14 destinations internes, encodages d'IP, DNS-rebinding, redirections, identifiants dans l'URL, corps d'erreur, Host, liste blanche, métadonnées cloud, SQL/Mongo/TDS : tous ✅ avec serveurs témoins (0 connexion). Réserves : (a) « les fournisseurs LLM officiels fonctionnent » ⏳ (appel tiers interdit) : c'est un risque de **régression fonctionnelle** pour tous les utilisateurs, à confirmer ; (b) appel HTTP complet de `/api/llm/test` avec session ⏳ (§ 5.6) ; (c) BUG-1. |
| US-4 🔒 Lecture seule effective et bornée | ✅ **Acceptée sous réserve (réserve forte)** | Le filtre applicatif (305 tests, ~230 cas de revue), le refus avant tout accès réseau, `LOCAL INFILE`, la coupure MySQL et le plafond de 1000 lignes (SQLite, faux serveur MySQL) sont ✅. Mais la promesse centrale « annulée / bornée **côté SGBD** » n'est pas prouvée sur de vrais SGBD : PostgreSQL (curseur, délai, `standard_conforming_strings`), SQL Server (`SET ROWCOUNT`, `ROLLBACK`, `@@TRANCOUNT`), délai 30 s, volumétrie 2 M lignes. La documentation « compte lecture seule obligatoire » est en place, ce qui reste la garantie réelle. |

## 2. Décision BUG-1 (Mineur — apostrophe typographique `’` au lieu de `'`)

**Décision : corriger avant commit** (revue courte du `reviewer`, pas de nouvelle recette complète).

- Motif : le message E-SQL-7 est fixé **mot pour mot** par la spécification validée à la GATE 2 (`architecture.md` § 1 et § 6). Un écart au texte validé est une non-conformité, même cosmétique. Le correctif est une constante, coût quasi nul, et le test existant (qui compare à l'apostrophe près) le verrouille.
- Périmètre : aligner `CONNECTION_STRING_REFUSED` dans `sql.ts` sur l'apostrophe droite `'`. Pour « la réponse n'est pas un JSON valide » (`saas.ts`, `odoo.ts`) : non fixé par le Gherkin ; **à harmoniser dans la même passe** par cohérence typographique, sans que cela conditionne l'acceptation.
- Conséquence : le correctif ne change aucun comportement ni aucune sécurité ; une exécution de `npm test` + `npx tsc --noEmit` suffit comme preuve. Si l'humain préfère ne pas retarder les commits, l'**alternative acceptable** est de commiter tel quel et d'inscrire BUG-1 en dette (le texte reste compréhensible), mais ce n'est pas la recommandation du PO.

## 3. Dette de recette ⏳ — priorisation et condition de mise en production

| Priorité | Élément (réf. QA § 5) | Story | Pourquoi |
|---|---|---|---|
| **P0-1** | § 5.1 PostgreSQL : volumétrie 2 M lignes (1000 renvoyées, < 10 s, ≤ +50 Mo), `pg_sleep(40)` → E-SQL-8, `standard_conforming_strings = off`, pgbouncer, écriture annulée | US-4 | Cœur de la promesse de lecture seule ; pilote le plus répandu |
| **P0-2** | § 5.2 MySQL / MariaDB : volumétrie, `SLEEP(40)`, fonction d'écriture refusée par `READ ONLY`, `max_statement_time` | US-4 | idem |
| **P0-3** | § 5.3 SQL Server : `SET ROWCOUNT`, `WAITFOR`, `@@TRANCOUNT`, `SELECT 1COMMIT`, Azure SQL avec `serverName` | US-4 | idem ; risque R-3 d'arbitrage Tech Lead si échec |
| **P0-4** | § 5.6 Routes LLM : validation de clé des 5 fournisseurs officiels (accord humain, appel tiers réel) | US-3 | Régression possible pour **tous** les utilisateurs |
| P1-1 | § 5.4 (c, d) Parcours authentifié sous CSP + `npm run start` | US-5 | Régression visuelle / fonctionnelle possible (export, Google Identity) |
| P1-2 | § 5.4 (a, b) Onglet Réseau et PDF sur réponse piégée | US-1 | Preuve navigateur complémentaire |
| P2 | § 5.5 Lien symbolique de fichier réel | US-2 | Chemin de code déjà exercé par simulation |

**Condition avant mise en production** : P0-1 à P0-4 rejoués avec succès (ou, pour chaque SGBD non couvert, déclaré **non supporté en production** dans le README tant qu'il n'est pas vérifié), et P1-1 / P1-2 rejoués. Dans l'intervalle, le dépôt peut recevoir les commits mais **aucun déploiement** (le déploiement reste de toute façon soumis à validation humaine, CLAUDE.md § 5). Toute régression sur P0 rouvre la story concernée (retour Dev, arbitrage Tech Lead si R-3).

Dette supplémentaire à noter, hors stories : `npm audit` signale 7 vulnérabilités non analysées (QA § 6) ; à traiter dans un sprint dédié.

## 4. Changements cassants à communiquer aux utilisateurs / administrateurs

À mettre en avant dans les notes de version (déjà documentés dans `README.md`, « Notes de migration ») :

1. **Destinations internes bloquées** (bases, API REST, Odoo, NIM, `localhost`, réseau privé) : l'administrateur doit les déclarer dans `BI_ALLOWED_HOSTS` (préférer IP/CIDR). Les métadonnées cloud (`169.254.0.0/16`) restent refusées même listées. Mode strict optionnel `BI_NETWORK_POLICY=allowlist`.
2. **SQLite désactivé par défaut** : définir `BI_SQLITE_DIR` (jamais le dossier `data/`), placer les bases dedans, ressaisir les chemins sous la forme `ventes.sqlite`.
3. **Requêtes SQL plus strictes** : `SHOW`, `EXPLAIN`, commentaires `/* */` et caractères de contrôle sont refusés ; résultats plafonnés à 1000 lignes ; délai maximal 30 s. Un **compte SGBD en lecture seule est désormais obligatoire** (exemples PG / MySQL / SQL Server dans le README).
4. **Images Markdown non affichées** dans le chat et le rapport (marqueur à la place) ; liens `http:` / `javascript:` rendus en texte simple, liens `https:` avec info-bulle du domaine.
5. **URL de base LLM** : limitée aux fournisseurs compatibles OpenAI (openai, deepseek, nvidia) ; `http://` refusé hors liste blanche.
6. **Chaînes de connexion SQL** (URL complète) refusées : renseigner hôte, port, identifiants ; options Mongo dangereuses et en-tête `Host` interdits.

## 5. Recommandations pour la suite

1. **Maintenant** : BUG-1 → `dev` (constante), revue courte `reviewer`, puis commits atomiques sur `feature`/`fix/2026-11-10-securite-p0` après OK humain, puis **GATE 3**.
2. **Hygiène des commits** (à surveiller par le reviewer) : ne pas indexer `.vitest/`, `.omc/`, `data/`, `.env*` ; signaler que `package.json` / `package-lock.json` contiennent l'ajout de `vitest` et un réordonnancement de `@types/*` sans changement de version.
3. **Sprint recette** (court, prioritaire avant tout déploiement) : environnements SGBD de test (accord humain pour les conteneurs) + session de test pour la recette navigateur.
4. **Éléments P1 à planifier** : reste de S9 (autres en-têtes de sécurité / CSP complète), analyse des 7 vulnérabilités `npm audit`, `favicon.ico` en 404 (cosmétique), éventuelle livraison de la couverture de code. Les autres éléments P1 de l'audit de sécurité sont à reprioriser au backlog après la recette.

## 6. Stories reportées

Aucune story reportée. Seuls les critères ⏳ du § 3 sont reportés comme dette de recette.
