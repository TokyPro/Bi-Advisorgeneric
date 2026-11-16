# Revue de code — Sprint `2026-11-11-compat-vercel`

- **Relecteur** : Code Reviewer & Git · **Tâche orchestrateur** : #7
- **Entrées** : `backlog.md`, `architecture.md` (§ 4, § 5 et § 10), `ux-spec.md`, `dev-notes.md`, `docs/adr/ADR-001-stockage-auth.md`

---

## Itération 1 (2026-11-11)

### Périmètre revu

Diff de l'arbre de travail sur `feature/2026-11-11-compat-vercel` par rapport à `main` (aucun commit de sprint à ce stade) :

- **Modifiés (20)** : `.env.example`, `README.md`, 12 `src/app/api/**/route.ts` (`admin/{health,users}`,
  `auth/{login,logout,me,password,setup}`, `connectors/{fetch,query,schema,test}`, `llm/{chat,test}`),
  `src/components/auth/AuthGate.tsx`, `src/lib/auth-client.ts`, `src/server/auth/{audit,session,store}.ts`.
- **Créés** : `src/server/auth/{config,errors,password}.ts`, `src/server/auth/backends/{types,file,index,postgres}.ts`,
  `tests/unit/{route-guard,auth-config,auth-file-backend,auth-postgres-backend,auth-routes}.test.ts`, `docs/adr/`, livrables du sprint.
- Tâches couvertes : T-1 à T-12. T-13 (recette Preview) est hors périmètre Dev (V-1/V-6).

### Vérifications exécutées

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` | ✅ aucune erreur |
| `npm test` | ✅ 11 fichiers, 629 tests réussis |
| `npm run build` | ✅ 13 routes `ƒ`, `/` et `/admin` statiques |
| `requireAuth` dans `src/` | ✅ 0 occurrence |
| `await authorize(` en tête de chaque handler protégé | ✅ 10 handlers sur 9 routes : `admin/users` (GET, POST), `admin/health`, `auth/password`, `connectors/*` (4), `llm/*` (2) |
| `TODO`, `FIXME`, `.only(`, `.skip(`, `console.log` (code et tests du sprint) | ✅ aucun |
| `rejectUnauthorized`, `NEXT_PUBLIC_` lié à l'auth | ✅ aucun |
| `console.*` dans `src/server/auth/**` | ✅ 8 appels, messages fixes + `errCode(e)` (filtré par regex) ou texte de validation : aucune valeur de secret, d'URL ni `err.message` de `pg` |
| Import des connecteurs depuis `src/server/auth/**` | ✅ aucun ; `src/server/connectors/**` non modifié |
| Fichiers sensibles | `package.json`, `next.config.mjs`, `tsconfig.json`, `vault.ts`, `data/` non modifiés ; `.env.example` contient des valeurs factices seulement |

### Grille de revue

**1. Sécurité.** Les points de l'architecture § 10 sont respectés, sauf la limitation des tentatives (CR-2) :

- **R1** : `authorize` est asynchrone, `requireAuth` a disparu (une erreur de compilation attraperait un appel oublié) et
  `route-guard.test.ts` vérifie la première ligne de chaque handler, l'absence d'appel sans `await` et l'absence de `requireAuth`. Ordre conservé dans `authorize` : CSRF, puis session, puis rôle.
- **Jeton** : `setupTokenMatches` compare les HMAC des deux valeurs avec une clé propre au processus via `timingSafeEqual` (longueurs égales par construction).
  La réponse est identique pour un jeton absent, vide ou faux, le contrôle `>= 32` est fait après la comparaison et l'audit `setup_denied` ne contient pas la valeur.
  Côté client, le jeton reste un état local du composant, vidé après le 403, et n'est envoyé que dans le corps POST.
- **Secrets** : `authSecret` n'écrit jamais sur disque en hébergé. Un secret trop court est refusé partout. Le message `config` contient seulement le nom de la variable.
- **SQL** : toutes les requêtes du backend Postgres sont paramétrées (`$n`), sans concaténation. Le schéma est une constante.
- **Atomicité** : `insert`, `update` et `remove` passent par `BEGIN` + `pg_advisory_xact_lock`, et les invariants (`onlyIfEmpty`, dernier admin) sont vérifiés après la prise du verrou. `touchLogin` ne modifie que `last_login`, et `update` ne réécrit pas `last_login` (S7 traité dans les deux sens). Le `23505` devient `email_taken`.
  Le backend fichier sérialise les mutations avec un mutex de promesses et relit l'état sous verrou.
- **Mode local** : `pg` n'est importé que dynamiquement dans `backends/index.ts` puis `postgres.ts`. Les paramètres scrypt et le format de `users.json` et `audit.log` sont inchangés.
- **Mode hébergé** : `storeKind` refuse `file`, et `localFileSecret` n'est pas atteignable. Le build avec `VERCEL=1` et sans `AUTH_SECRET` passe d'après les dev-notes (TS-10).
- **Constats** : limiteur contournable par requêtes concurrentes (CR-2) ; compatibilité du schéma avec l'URL « pooled » (CR-1, qui relève de la correction).

**2. Correction.** Gestion d'erreur cohérente (`authErrorResponse` centralise le mapping ; les erreurs inconnues deviennent `storage` sans message d'origine). Points relevés : CR-1, CR-3, CR-4, CR-5, CR-6.

**3. Conformité.** T-1 à T-12 sont couvertes sans dérive de périmètre. Les codes, statuts et messages correspondent à la table § 4.2. Les textes d'É1 à É7 correspondent à la ux-spec § 4. Les couleurs `bg-red-50`, `bg-amber-50` et `text-slate-600` viennent de la ux-spec (§ 5, AC-2) ou existaient déjà (`text-[#14142b]`).

**4. Maintenabilité et performance.** Façade `store.ts` conservée (diff des routes minimal). Une requête SQL par appel API, assumée (R5). Pool `max: 3`, mémoïsé.

**5. Hygiène.** RAS.

### Jugement des écarts déclarés par le Dev (dev-notes § 2)

| # | Écart | Décision |
|---|---|---|
| 1 | `lockedFor(key, max)` | **Accepté** : nécessaire avec deux seuils et une table sans colonne de seuil. À revoir avec CR-2. |
| 2 | URL de base absente → `storage` et non `config` | **Accepté** : avec `config`, le message « AUTH_SECRET est requis » serait faux. Le cas hébergé + `file` reste en `config`. |
| 3 | Codes `invalid`, `invalid_credentials`, `forbidden`, `not_found` ; liste fermée côté client | **Accepté** : seuls des messages `DomainError` écrits dans le code passent par `SERVER_TEXT`, et le repli 5b s'applique à tout autre code. Voir CR-5 (robustesse du test d'appartenance). |
| 4 | Succès de connexion : remise à zéro de `ip\|email` seulement | **Accepté** (empêche de contourner le seuil de 10). À conserver dans la correction de CR-2. |
| 5 | `seedFromEnv` ne fait de `count` que si `ADMIN_*` est défini | **Accepté**. |
| 6 | `/api/auth/me` vérifie le secret | **Accepté** : nécessaire pour qu'un visiteur anonyme voie É5a. |
| 7 | Setup : `seedFromEnv()` avant le comptage, `authSecret()` avant la création | **Accepté** : conforme à la matrice § 4.3 et évite un admin orphelin. |
| 8 | Login 401 si le compte est désactivé entre-temps | **Accepté** (ferme la fenêtre S7). |
| 9 | Rôle hors `admin`/`user` refusé | **Accepté** : évite le 503 trompeur dû au `CHECK`. |
| 10 | Bouton œil séparé pour le jeton | **Accepté côté code**. La ux-spec § É2 prévoyait de réutiliser l'état `show`, et l'ordre de focus AC-6 change (œil du jeton ajouté) : **à valider pendant la recette UX**, pas de CR. |
| 11 | Normalisation `\s+` de l'audit | **Accepté** (sur-ensemble de `\t\r\n`). |
| — | Erreur réseau sur `/api/auth/me` → É5b ; `config`/`storage` → 503 au lieu de 401 | **Accepté** : conforme à l'architecture § 4.9 et à H2. |

### Constats

#### CR-1 — Majeur — Le verrou de session du schéma ne fonctionne pas derrière un pooler en mode transaction (URL « pooled » Neon)

- **Où** : `src/server/auth/backends/postgres.ts:58-64`
- **Scénario** : l'architecture (§ 4.5) et le README imposent l'URL « pooled » de Neon (PgBouncer en mode *transaction*).
  Hors transaction, chaque instruction peut partir sur une connexion serveur différente. `pg_advisory_lock` est pris sur la connexion A, `SCHEMA` s'exécute sur B, et
  `pg_advisory_unlock` part sur C (il renvoie `false` sans erreur). Le verrou reste donc tenu sur A tant que cette connexion serveur vit, et le pooler la recycle pour d'autres clients.
  À l'initialisation suivante d'une autre instance (démarrage à froid sur Vercel), `pg_advisory_lock` attend jusqu'au `statement_timeout` de 5 s, puis renvoie 503 `storage`.
  Comme `schema = null`, chaque requête suivante recommence et attend encore 5 s. Résultat : des 503 intermittents et durables, alors qu'US-1 et US-8 exigent qu'aucune déconnexion ne se produise.
  Le test `auth-postgres-backend.test.ts:33` fige ce comportement et ne peut pas le détecter (pool simulé).
- **Correction attendue** : initialiser le schéma dans **une transaction** avec un verrou transactionnel, comme pour les écritures :
  `BEGIN; SELECT pg_advisory_xact_lock($1); <DDL>; COMMIT` (le DDL est transactionnel en PostgreSQL), avec `ROLLBACK` en cas d'erreur.
  Mettre à jour le test (séquence `BEGIN`, `pg_advisory_xact_lock`, DDL, `COMMIT`) et ajouter ce cas à TS-9 (URL pooled réelle).

#### CR-2 — Majeur — La limitation des tentatives se contourne avec des requêtes concurrentes (régression en local)

- **Où** : `src/app/api/auth/login/route.ts:18-23` (et selon le même schéma `src/app/api/auth/setup/route.ts:18-26`)
- **Scénario** : sur `main`, tout le traitement qui suit `await req.json()` était synchrone (`lockedFor`, `scryptSync`, `recordFail`).
  Dans un processus, la vérification et l'enregistrement de l'échec étaient donc atomiques. Désormais, `await lockedFor(...)` (lecture), `await checkPassword(...)` (scrypt asynchrone, environ 100 ms)
  et `await recordFail(...)` sont séparés par des points de suspension. Un attaquant qui envoie N requêtes simultanées pour le même e-mail les voit toutes passer
  `lockedFor` avec `n = 0` : les N mots de passe sont testés avant que le premier échec soit compté. Le seuil « 5 échecs, puis blocage de 10 min » (invariant du README,
  rattaché à US-1 par l'architecture Q5) devient « une rafale de taille arbitraire toutes les 10 min ». Cela concerne le mode fichier (régression par rapport à v1) comme le mode Postgres (où un `SELECT` puis un `INSERT … ON CONFLICT` séparés ne suffisent pas).
- **Correction attendue** : rendre atomiques la vérification et la consommation, **avant** le calcul scrypt. Par exemple, une opération
  `attempts.hit(key, max): Promise<number>` (minutes de blocage, 0 sinon) :
  - en Postgres, l'`INSERT … ON CONFLICT DO UPDATE … RETURNING n, until_ms` existant, avec refus si `n > max` et `until_ms > now` ;
  - en fichier, l'incrément et la lecture synchrones dans la même opération sur la `Map`.
  En cas de succès : `clear(ipKey)`. Pour `emailKey`, soit décrémenter (`n = greatest(n - 1, 0)`) pour qu'une connexion réussie ne compte pas, soit documenter qu'elle compte (sans jamais la remettre à zéro, écart 4).
  Appliquer le même schéma à `setup|ip` (impact faible, le jeton faisant ≥ 32 caractères, mais à garder cohérent).
  Ajouter un test : `Promise.all` de 20 connexions erronées → au plus `LOGIN_MAX` vérifications de mot de passe, et le reste en 429.

#### CR-3 — Mineur (à vérifier en TS-9 / T-13) — `statement_timeout` passé comme paramètre de démarrage

- **Où** : `src/server/auth/backends/postgres.ts:42`
- **Scénario** : `pg` transmet `statement_timeout` dans le message de démarrage de la connexion. Certains poolers PgBouncer refusent les paramètres de démarrage
  qu'ils ne connaissent pas (`unsupported startup parameter`). Si celui de Neon fait partie de ces poolers, **toutes** les connexions échouent et l'application renvoie 503 en permanence. Ce comportement n'a pas pu être vérifié ici (aucun accès réseau).
- **Correction attendue** : vérifier ce point avec l'URL pooled réelle (TS-9 ou T-13). Si c'est confirmé, ou par précaution, retirer `statement_timeout` des options du pool, garder `query_timeout`
  (côté client) et, si un délai serveur est voulu, utiliser `SET LOCAL statement_timeout = '5s'` dans les transactions de `tx`.

#### CR-4 — Mineur — Un échec de lecture du journal d'audit bloque la gestion des comptes

- **Où** : `src/app/api/admin/users/route.ts:10`
- **Scénario** : `snapshot()` attend `readAudit()`. Si la lecture de `bia_auth_audit` échoue (table absente pour un rôle sans droit `CREATE`, délai dépassé), GET et POST
  renvoient 503. Pour POST, la mutation est **déjà appliquée** mais l'administrateur voit une erreur et peut la relancer. US-4 demande que le journal ne bloque jamais.
- **Correction attendue** : `audit: await readAudit().catch(() => [])` (ou un repli dans `readAudit`).

#### CR-5 — Mineur — Test d'appartenance `code in AUTH_TEXT` sensible au prototype

- **Où** : `src/lib/auth-client.ts:30`
- **Scénario** : `'toString' in AUTH_TEXT` vaut `true`. Un `code` inattendu comme `toString` ou `constructor` (proxy, réponse altérée) produirait un `AuthError` dont le message est une fonction,
  au lieu du repli 5b prévu par la ux-spec (« lister côté client les seuls codes connus »).
- **Correction attendue** : `Object.hasOwn(AUTH_TEXT, code)`.

#### CR-6 — Mineur — Journaux inondés si l'URL de base manque

- **Où** : `src/server/auth/config.ts:30` appelé par `src/server/auth/backends/index.ts:10` à chaque `getBackend()`
- **Scénario** : en hébergé sans URL, chaque appel de `getBackend()` (plusieurs par requête : seed, session, limiteur, audit) émet `console.error`. Les *Runtime Logs* sont alors inondés.
- **Correction attendue** : ne journaliser qu'une fois par instance (même procédé que `shortTokenLogged`).

### Points notés (sans CR)

- **Backend fichier** : si `users.json` est illisible, il est traité comme vide (`backends/file.ts:15`), ce qui rouvre l'initialisation en local. C'était déjà le comportement de v1, hors périmètre ; à inscrire en dette si le tech-lead le juge utile.
- **Verrouillage par e-mail** : 10 échecs depuis n'importe quelle IP bloquent un compte pendant 10 min (déni de service ciblé). Le compromis est assumé par l'architecture (S5 partiel).
- **En attente d'une vérification réelle** (dev-notes § 4) : SQL sur un vrai serveur, concurrence sur 2 pools, `ON CONFLICT`, révocation entre instances (TS-9, V-7) et Preview (T-13).

### Verdict — itération 1 : **Changements requis**

Deux constats **Majeurs** (CR-1, CR-2) doivent être corrigés par le Dev. Les Mineurs CR-3 à CR-6 sont attendus dans la même boucle, car ils sont peu coûteux ;
CR-3 peut être levé après vérification réelle. Une revue courte (itération 2) suivra, puis le relais vers le QA.

---

## Itération 2 (2026-11-11) — revue courte des corrections CR-1 à CR-6

### Périmètre revu

Corrections déclarées dans `dev-notes.md` (« Itération 2 ») : `src/server/auth/backends/{types,file,postgres}.ts`, `session.ts`, `config.ts`,
`src/app/api/auth/{login,setup}/route.ts`, `src/app/api/admin/users/route.ts`, `src/lib/auth-client.ts`, tests `auth-{file-backend,postgres-backend,routes}.test.ts`.

### Vérifications exécutées

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` | ✅ aucune erreur |
| `npm test` | ✅ 11 fichiers, 636 tests réussis (+7) |
| `npm run build` | déclaré ✅ par le Dev (code de sortie 0) ; non relancé : seul du code serveur a changé, et tsc ainsi que les tests sont au vert |
| `lockedFor` / `recordFail` / `clearFails` / `attempts.fail` dans `src/` et `tests/` | ✅ plus aucune occurrence |
| R1 (`route-guard.test.ts`) | ✅ passe ; le garde d'`admin/users` est inchangé (`await authorize(req, 'admin')` en tête des deux handlers) |

### Vérification des corrections

| CR | Statut | Constat |
|---|---|---|
| CR-1 | ✅ Corrigé | `transaction()` (`postgres.ts:60-73`) est commune au schéma et aux mutations : `BEGIN` → `SET LOCAL statement_timeout = '5s'` → `pg_advisory_xact_lock($1)` → travail → `COMMIT`, `ROLLBACK` sur toute erreur, `release()` dans `finally`. Plus aucun verrou de session. Tout se passe sur une seule connexion et dans une seule transaction, ce qui est compatible avec un pooler en mode transaction. `ready()` remet `schema` à `null` en cas d'échec (nouvelle tentative). Test mis à jour (séquence, `ROLLBACK`, nouvelle tentative). |
| CR-2 | ✅ Corrigé | **Fichier** (`file.ts:73-80`) : purge, incrément et lecture sans aucun `await` intermédiaire, donc atomiques dans le processus. **Postgres** (`postgres.ts:153-164`) : une seule instruction `INSERT … ON CONFLICT DO UPDATE … RETURNING`. Le verrou de ligne pris par `ON CONFLICT` sérialise les mises à jour concurrentes, et la fenêtre expirée (`until_ms <= now`) repart à `n = 1`. La `max`-ième tentative fixe la fin du blocage à +10 min. Les tentatives au-delà de `max` renvoient au moins 1 minute. **Login** : les deux clés sont comptées **avant** scrypt, et le seuil est tenu en rafale (test de route : 20 tentatives concurrentes, 5 réponses 401 et 15 réponses 429, le bon mot de passe reste bloqué). En cas de succès, `ip\|email` est remise à zéro et `email` décrémentée (écart 4 respecté). Les échecs, y compris sur un compte désactivé, ne sont jamais rendus. **Setup** : chaque appel est compté ; seul un appel qui a **passé** `setupTokenMatches` (ou le mode `open`) rend la tentative. Un attaquant sans le jeton ne peut donc pas récupérer de crédit : au plus 5 essais par IP toutes les 10 min, comme prévu. |
| CR-3 | ✅ Corrigé, à confirmer en réel | `statement_timeout` est retiré des options du pool, `query_timeout` est conservé côté client et le délai serveur passe par `SET LOCAL` dans les transactions. La compatibilité avec le pooler Neon reste à confirmer en TS-9 / T-13 (inscrit dans les dev-notes). |
| CR-4 | ✅ Corrigé | `readAudit().catch(() => [])` (`admin/users/route.ts:10`) ; testé (POST 200 avec `audit: []`). |
| CR-5 | ✅ Corrigé | `Object.hasOwn(AUTH_TEXT, code)` (`auth-client.ts:30`). |
| CR-6 | ✅ Corrigé | Drapeau `missingUrlLogged` (`config.ts`), message sans valeur. |

### Observations (sans CR, non bloquantes)

- **O-1, prolongation du blocage par e-mail** : si une connexion **réussie** fait passer la clé `email` exactement à `max` (10), le `hit` renouvelle `until_ms` (+10 min) avant que `release` ne redescende `n` à 9. Ce comportement est plus strict, jamais plus permissif. La seule conséquence est une fenêtre de comptage qui se prolonge pour un compte déjà proche du seuil. Acceptable.
- **O-2, setup compté pour 409 et `setup_disabled`** : au-delà de 5 appels en 10 min depuis une même IP, un visiteur reçoit 429 au lieu de 409 ou 403. C'est sans risque de sécurité, et le client affiche la copie « Trop de tentatives ». Acceptable.
- **Reste à vérifier sur un vrai serveur** (TS-9 / V-7, T-13) : sémantique réelle de `ON CONFLICT … RETURNING`, schéma en transaction, `SET LOCAL` et paramètres de démarrage derrière l'URL pooled.

### Verdict — itération 2 : **Approuvé**

Aucun constat Bloquant ni Majeur ouvert. CR-1 à CR-6 sont corrigés, et CR-3 reste à confirmer en recette réelle (TS-9 / T-13). Relais : QA.

## Itération 3 (2026-11-12) — revue courte des corrections UX-1 à UX-5 et BUG-1

### Périmètre revu

Corrections déclarées dans `dev-notes.md` (« Itération 3 ») : `src/components/auth/AuthGate.tsx`, `src/app/api/auth/login/route.ts`,
`tests/unit/auth-routes.test.ts` (test BUG-1). UX-6 est hors périmètre (ticket distinct). Aucune opération Git d'écriture.

### Vérifications exécutées

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` | ✅ aucune erreur (code de sortie 0) |
| `npm test` (1ᵉʳ passage) | ⚠️ 11/12 fichiers, 649/650 : échec de `auth-postgres-backend.test.ts:126` (« limiteur (CR-2) … »), fichier **non modifié** dans cette itération. Voir CR-7. |
| `npm test` (2ᵉ passage) + 5 passages isolés de `auth-postgres-backend.test.ts` | ✅ 12 fichiers, 650 tests réussis ; 5 × 11/11. Le test est **instable**, ce n'est pas une régression. |
| `npm run build` | déclaré ✅ par le Dev, non relancé (tsc et tests au vert, changement limité à un composant client et une route) |
| `TODO`, `.only`, `.skip`, `console.log` dans les 3 fichiers revus | ✅ aucune occurrence |

### Vérification des corrections

| Réf | Statut | Constat (preuve) |
|---|---|---|
| UX-1 | ✅ Corrigé | `AuthGate.tsx:25` : `[&_input]:border-slate-500 [&_input]:bg-slate-50 [&_input]:text-[#14142b] [&_input]:caret-[#14142b]` sur `CARD`. Le sélecteur généré `.x input` (0,1,1) l'emporte sur `bg-surface2` et `border-line` d'`inputCls` (`primitives.tsx:59`, 0,1,0) ; `focus:border-brand-violet` (`:focus`, 0,2,0) reste prioritaire au focus. Aucun nouveau hexadécimal (`#14142b` est celui de la carte). Les champs n'ont pas d'attribut `placeholder`, donc `placeholder:text-muted/60` est sans effet ici. Primitive `inputCls` et tokens non modifiés. Contraste à confirmer en navigateur par l'UX (thème sombre). |
| UX-2 | ✅ Corrigé | `aria-label` court sur le jeton (`:138`) et le mot de passe (`:146`) : il prime sur le contenu du `<label>` (œil + aide) pour le nom accessible. Aide rendue en enfant avec `id` (`:140`, `:148`) et la même classe que `Field` (`:90`), reliée par `aria-describedby`. `fieldErr` (`:105-108`) fusionne aide et `auth-error` (`auth-token-hint auth-error` après un 403) et n'émet pas d'attribut vide. Champ confirmation : pas d'œil dans son `<label>`, nom propre. `Field` non modifié. |
| UX-3 | ✅ Corrigé | `AuthGate.tsx:133` : `text-slate-600`. |
| UX-4 | ✅ Corrigé | `AuthGate.tsx:47` : `border-slate-500`. |
| UX-5 | ✅ Corrigé | `AuthGate.tsx:40-53` : région `aria-live="polite"` présente dès le rendu (`:50`), vidée puis remplie après `refreshAuth()` (`:44`) : le même texte est donc ré-annoncé à chaque tentative. `refreshAuth()` ne rejette jamais (`auth-client.ts:57-70`, `catch` final), donc `busy` ne peut pas rester bloqué. Si l'état change, la carte est démontée ; `setState` après démontage est sans effet en React 19. `min-h` évite le saut de mise en page. |
| BUG-1 | ✅ Corrigé | `login/route.ts:2,19` : `await seedFromEnv()` en tête du `try`. **Limiteur** : le seed ne dépend d'aucune donnée de la requête, ne vérifie aucun mot de passe soumis et ne renvoie rien. Il ne peut donc pas servir à tester des identifiants hors du limiteur. Le comptage `hitLimit` (`:21`) reste **avant** `findByEmail` et `checkPassword` (scrypt, `:23-24`). Aucun chemin ne mène à `checkPassword` sans passer par `hitLimit`. **Erreurs** : les `DomainError` du seed (course perdue, valeurs `ADMIN_*` invalides) sont absorbées dans `store.ts:75-79` et ne changent pas la réponse du login. Les erreurs de stockage ou de configuration remontent à `authErrorResponse` (`errors.ts:50-55`) : 503 `storage` ou `config`, message générique, log limité au code. C'est le même mapping que si `hitLimit` avait échoué sur le même backend (`session.ts:69`). Aucune nouvelle fuite. **Coût** : mémoïsé (`store.ts:67-73`), un seul `count` par instance une fois initialisé. Comportement aligné sur `setup/route.ts:21` et `session.ts:24`. |
| BUG-1 (test) | ✅ | `auth-routes.test.ts:102-110` : dossier vide, `ADMIN_*` valides, premier appel = login → 200, admin créé (lecture de `users.json`), session valide via `/api/auth/me`. Modules rechargés à chaque test (`:17`), donc le mémo `seeded` est bien remis à zéro. Test réel, sans `.skip` ni `.only`. |

### Constats

| CR | Gravité | Fichier:ligne | Scénario | Correction suggérée |
|---|---|---|---|---|
| CR-7 | Mineur (test instable, hors code de production) | `tests/unit/auth-postgres-backend.test.ts:121` (faux pool) / `:126` | Le backend capture `now` (`postgres.ts:154`) **avant** la requête. Le faux pool calcule ensuite `until_ms = Date.now() + 10 min` **après**. Si l'horloge avance d'1 ms entre les deux, `ceil((until_ms - now) / 60000)` vaut 11 au lieu de 10, et l'assertion `toHaveLength(15)` échoue (observé 1 fois sur 7 passages). En production, `until_ms` est dérivé du même `$2` (`postgres.ts:156-161`) : pas de défaut fonctionnel. | Dans le faux pool, dériver `until_ms` du paramètre transmis (`Number(params[1]) + 10 * 60_000`) ou utiliser `vi.useFakeTimers()` / `vi.setSystemTime`. À traiter avant la livraison pour que la DoD (« `npm test` passe ») soit stable, sans bloquer le relais QA. |

### Observations (sans CR)

- **O-3** : si le stockage accepte `count` mais refuse l'`insert` du seed (panne partielle), chaque appel au login rejoue un hachage scrypt de `ADMIN_PASSWORD` avant le limiteur. Ce coût est borné par instance, ne dépend pas de l'attaquant et existe déjà sur toutes les routes `/api/*` via `session.ts:24`. Le login n'introduit donc rien de nouveau. Acceptable.
- **O-4** : sur É4 (« Initialisation non configurée »), la phrase « Toujours indisponible » est un peu impropre (ce n'est pas une panne). C'est la copie proposée par l'UX elle-même, à confirmer lors de sa recette courte.
- **À rejouer en navigateur (UX / QA)** : contraste UX-1 en thème sombre (aurora, graphite, 1280 et 360 px), nom et description accessibles du jeton et du mot de passe, annonce UX-5.

### Verdict — itération 3 : **Approuvé**

UX-1 à UX-5 et BUG-1 sont corrigés, avec preuve. `seedFromEnv()` ne contourne pas le limiteur, ne modifie pas le mapping d'erreurs et ne fuit aucune information. Aucun constat Bloquant ni Majeur. CR-7 (Mineur, test instable préexistant) est à corriger par le Dev avant les commits finaux. Relais : UX (recette courte) et QA.
