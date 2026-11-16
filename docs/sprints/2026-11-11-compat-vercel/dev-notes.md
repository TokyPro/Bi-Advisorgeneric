# Dev notes — Sprint `2026-11-11-compat-vercel`

- **Auteur** : Dev Full Stack · **Date** : 2026-11-11 · **Tâche orchestrateur** : #6
- **Entrées** : `backlog.md`, `architecture.md`, `ux-spec.md`, `docs/adr/ADR-001-stockage-auth.md`
- **Branche** : `feature/2026-11-11-compat-vercel` (aucune opération Git d'écriture faite par le Dev)
- **Validations utilisées (GATE 2)** : V-2 (`src/server/auth/**`), V-3 (refacto des 13 routes), V-4 (`.env.example`), V-5 (AUTH_SECRET court refusé).
  **Non utilisées** : V-1, V-6, V-7, V-8. Aucun `npm install`. `package.json`, `next.config.mjs`, `tsconfig.json`, `vault.ts`, `src/server/connectors/**` et `data/` n'ont pas été touchés.

## 1. Tâches réalisées

| Tâche | État | Fichiers |
|---|---|---|
| T-1 Config, erreurs, mot de passe | Fait | `src/server/auth/config.ts` (créé), `errors.ts` (créé), `password.ts` (créé) |
| T-2 `AuthBackend` + backend fichier | Fait | `src/server/auth/backends/{types,file,index}.ts` (créés) |
| T-3 Façade `store.ts` async | Fait | `src/server/auth/store.ts` (modifié) |
| T-4 Session : `authorize` remplace `requireAuth` | Fait | `src/server/auth/session.ts` (modifié) |
| T-5 Migration des routes | Fait | 12 `route.ts` sous `src/app/api/{admin,auth,connectors,llm}` (modifiés) |
| T-6 Initialisation sécurisée | Fait | `src/app/api/auth/setup/route.ts` (modifié) |
| T-7 Limiteur partagé | Fait | `backends/file.ts`, `backends/postgres.ts`, `session.ts`, `auth/login`, `auth/setup` |
| T-8 Backend Postgres | Fait, vérifié avec un pool simulé. **Vérification réelle en attente de V-7** | `src/server/auth/backends/postgres.ts` (créé) |
| T-9 Client (H5, codes, jeton, É1–É7, A-1/A-2/A-4) | Fait | `src/lib/auth-client.ts`, `src/components/auth/AuthGate.tsx` (modifiés) |
| T-10 Audit async best-effort | Fait | `src/server/auth/audit.ts` (modifié) |
| T-11 Documentation | Fait | `.env.example`, `README.md` (modifiés) |
| T-12 Test de garde des routes (R1) | Fait | `tests/unit/route-guard.test.ts` (créé) |
| T-13 Recette Preview | **Non réalisable par le Dev** : V-1 et V-6 requis (QA + humain) | — |

Tests ajoutés au-delà de T-12, sans réseau : `tests/unit/auth-config.test.ts` (TS-1 à TS-5),
`auth-file-backend.test.ts` (TS-6, dont la concurrence US-5), `auth-postgres-backend.test.ts` (TS-9 partiel, pool
simulé) et `auth-routes.test.ts` (TS-7 partiel). Le QA reste libre de les compléter.

## 2. Écarts par rapport à la conception (et pourquoi)

1. **`AttemptStore.lockedFor(key, max)`** : la conception prévoyait `lockedFor(key)`. Les deux clés ont des seuils
   différents (5 pour `ip|email`, 10 pour `email`) ; la table `(key, n, until_ms)` ne garde pas le seuil. Sémantique :
   `max` échecs dans une fenêtre de 10 min, puis blocage de 10 min à partir du `max`-ième échec ; purge des entrées
   expirées (mémoire à chaque appel, Postgres dans `clear`).
2. **URL de base absente en hébergé** : `AuthStorageError` (503 `storage`) avec `console.error` sans valeur, et non
   `config`. Avec `config`, le client afficherait « AUTH_SECRET est requis », ce qui serait faux. Le cas
   « hébergé + `BI_AUTH_STORE=file` » renvoie bien `config`, comme prévu.
3. **Codes d'erreur supplémentaires** : `invalid` (validation, 400), `not_found` (400, comme avant),
   `invalid_credentials` (login, 401) et `forbidden` (origine ou droits, 403). Le client affiche le texte serveur pour ces
   codes métier (`invalid`, `invalid_credentials`, `email_taken`, `last_admin`, `not_found`, `unauthenticated`,
   `forbidden`), prend sa propre table pour `config`, `storage`, `setup_token_invalid`, `setup_disabled`,
   `already_initialized` et `rate_limited`, et **affiche le message 5b pour tout autre code**.
4. **Clé du limiteur** : la clé e-mail seule est `email|<email>`. Une connexion réussie ne remet à zéro que `ip|email` :
   remettre aussi la clé e-mail permettrait de contourner le seuil de 10.
5. **`seedFromEnv`** ne fait de `count` que si `ADMIN_*` est défini. Une valeur `ADMIN_*` invalide n'est signalée qu'une
   fois par instance, au lieu d'une fois par requête.
6. **`/api/auth/me`** appelle `authSecret()` explicitement, pour qu'un visiteur anonyme voie É5a au chargement (sinon le
   secret n'est lu qu'en présence d'un cookie). Avec `AUTH_DISABLED=true`, aucun backend n'est sollicité.
7. **`/api/auth/setup`** appelle `seedFromEnv()` avant le comptage, pour que « ADMIN_* et SETUP_TOKEN tous deux définis »
   donne bien 409 (§ 4.3). Il appelle aussi `authSecret()` **avant** la création, pour ne pas créer un admin si le cookie
   ne peut pas être signé.
8. **Login** : si `touchLogin` renvoie un compte désactivé entre-temps, la réponse est 401 (S7, fermeture de la fenêtre).
9. **`updateUser`** refuse un rôle autre que `admin` ou `user` (400 `Rôle invalide.`). Avant, ce rôle était écrit tel quel ;
   en Postgres, la contrainte `CHECK` aurait donné un 503 trompeur.
10. **UI** : bouton œil séparé pour le jeton (libellés « Afficher / Masquer le jeton »). L'ordre de focus devient donc
    jeton, œil du jeton, nom, et ainsi de suite. A-4 est traité par une variante Tailwind sur la carte
    (`[&_.text-muted]:text-slate-600`), sans modifier `Field` ni ajouter de couleur en dur. Le focus visible passe par
    `focus-visible:outline-brand-violet` (AC-7). Le 409 bascule vers la connexion (toast) ; le message `role="alert"`
    ne s'affiche que si la bascule échoue.
11. **Normalisation de l'audit** : tout blanc (`\s+`) devient une espace, sur tous les champs, avec une troncature à
    200 caractères. C'est un sur-ensemble de `\t\r\n`, et c'était déjà la règle pour `detail`.

## 3. Vérifications (sorties consignées)

- `npx tsc --noEmit` : **aucune erreur**.
- `npm test` : **11 fichiers, 629 tests réussis** (dont les 54 nouveaux tests d'authentification).
- `npm run build` : **succès** (13 routes `ƒ`, pages `/` et `/admin` statiques).
- **TS-10** : `VERCEL=1`, `AUTH_SECRET` retiré de l'environnement du shell, `npm run build` : **succès** (code de
  sortie 0), donc aucun effet de bord au chargement des modules.
- **TS-12** (même build, avec `SETUP_TOKEN=valeur-factice-build-ts12-…`) : la valeur apparaît **0 fois** dans
  `.next/static`. Les **noms** `SETUP_TOKEN` et `AUTH_SECRET` apparaissent dans 1 fichier : ce sont les micro-copies
  É2, É4 et 5a imposées par la ux-spec (noms de variables, pas de valeurs). Le QA doit lire TS-12 comme « 0 valeur ».
- **Fumée locale (TS-11 partiel)** : `next start` avec un `BI_DATA_DIR` temporaire (jamais `data/`), sur localhost.
  Résultats : `me` donne `needsSetup` et `setupMode:"open"`, setup 200, `me` admin OK, création d'utilisateur 200
  (audit `user_created`, `setup_admin`), login utilisateur 200, **10 requêtes successives sans déconnexion**, second
  setup 409, route protégée sans session 401. Fichiers produits : `users.json`, `auth-secret`, `audit.log`, au format
  inchangé. Le dossier temporaire a été supprimé ensuite.
- Recherches : aucun `TODO`, `.skip` ou `.only` introduit ; aucun `rejectUnauthorized` ; aucun import des connecteurs
  dans `src/server/auth/**` ; plus aucun `requireAuth` dans `src/` (vérifié aussi par T-12).

## 4. Points d'attention pour le reviewer et le QA

- **R1** : chaque handler protégé commence par `const a = await authorize(req…); if (a instanceof Response) return a;`.
  `tests/unit/route-guard.test.ts` vérifie la première ligne de chaque handler, l'absence d'appel sans `await` et
  l'absence de `requireAuth`.
- **Journaux** (`console.*` dans `src/server/auth/**`) : uniquement des messages fixes et `errCode(e)` (code `pg` ou
  nom de classe, filtré par regex). Le message `ADMIN_* invalide` reprend le texte de validation, qui ne contient pas la
  valeur. Le test Postgres vérifie l'absence de l'hôte, du port et du mot de passe dans la réponse et dans les logs.
- **En attente de V-7 (base Postgres réelle)** : concurrence réelle sur 2 pools, révocation vue depuis une autre
  instance, création du schéma sur un vrai serveur, comportement du `ON CONFLICT` du limiteur et URL invalide (TS-9).
  Le SQL n'a été validé que par un pool simulé.
- **En attente de V-1/V-6 (T-13, US-8)** : intégration Neon, variables Vercel, `vercel link`, Preview. L'option
  `vercel link --yes --project` du README est à confirmer avec `vercel link --help` (CLI non lancé : il peut contacter
  le réseau).
- **Recette UX** : É1 change légèrement (couleur de l'œil et libellés en `text-slate-600`, A-1/A-4 demandés par la spec).
  É4/É5 : aucun `<form>`. Les boutons secondaires utilisent `border-line`, comme spécifié (la carte est forcée en clair).
- **Comportements nouveaux** : une erreur réseau sur `/api/auth/me` affiche maintenant É5b au lieu de l'écran de
  connexion. Les erreurs `config` et `storage` d'une route protégée donnent 503, et non plus 401.

## 5. Dette technique

- Pas de purge de `bia_auth_audit` (R7, prévue) ni de `bia_login_attempts` en dehors des appels à `clear` (volume négligeable).
- Mutex fichier limité à un processus (R10, documenté dans le README).
- Une requête SQL par appel API (révocation immédiate assumée, R5).

---

## Itération 2 — corrections de la revue (Tâche #12)

Entrée : `code-review.md`, itération 1, « Changements requis ».

| CR | Gravité | Correction | Fichiers |
|---|---|---|---|
| CR-1 | Majeur | Le schéma est créé dans une **transaction** : `BEGIN` ; `SET LOCAL statement_timeout` ; `pg_advisory_xact_lock` ; DDL ; `COMMIT`, avec `ROLLBACK` en cas d'échec et une nouvelle tentative à l'appel suivant. Plus aucun verrou de session (`pg_advisory_lock`/`unlock`). Une fonction `transaction()` est maintenant commune au schéma et aux mutations de comptes. | `src/server/auth/backends/postgres.ts`, `tests/unit/auth-postgres-backend.test.ts` |
| CR-2 | Majeur | Le limiteur passe à **`attempts.hit(key, max)`**, une opération atomique qui compte la tentative et renvoie les minutes de blocage. Elle est appelée **avant** scrypt. En fichier, l'incrément et la lecture sont synchrones sur la `Map`. En Postgres, une seule requête `INSERT … ON CONFLICT DO UPDATE … RETURNING n, until_ms`. `lockedFor` et `fail` disparaissent, `release` s'ajoute. Une connexion réussie remet à zéro `ip\|email` (comme avant) et ne fait que **décrémenter** `email` (`greatest(n - 1, 0)`), ce qui respecte l'écart 4 accepté. Le setup compte chaque appel et rend la tentative quand le jeton est valide. | `backends/{types,file,postgres}.ts`, `session.ts` (`hitLimit`, `releaseLimit`, `clearLimit`), `auth/login/route.ts`, `auth/setup/route.ts`, tests |
| CR-3 | Mineur | `statement_timeout` est retiré des options du pool (paramètre de démarrage) ; seul `query_timeout` reste côté client. Le délai serveur passe par `SET LOCAL statement_timeout = '5s'` dans chaque transaction. **À confirmer sur l'URL pooled réelle (TS-9 / T-13).** | `backends/postgres.ts` |
| CR-4 | Mineur | `readAudit().catch(() => [])` dans `snapshot()` : le journal ne bloque plus la gestion des comptes. | `src/app/api/admin/users/route.ts` |
| CR-5 | Mineur | `Object.hasOwn(AUTH_TEXT, code)` au lieu de `code in AUTH_TEXT`. | `src/lib/auth-client.ts` |
| CR-6 | Mineur | Le `console.error` « URL de base manquante » n'est émis qu'une fois par instance (drapeau `missingUrlLogged`). | `src/server/auth/config.ts` |

**Sémantique du limiteur** (fichier et Postgres identiques) : au plus `max` tentatives dans une fenêtre de 10 min. La
`max`-ième fixe la fin du blocage à +10 min, et toute tentative suivante reçoit 429 avec `retryAfterMin`. Une entrée
expirée repart de zéro. Seuils inchangés : 5 pour IP+e-mail, 10 pour l'e-mail seul, 5 pour le setup par IP.

**Tests ajoutés ou mis à jour** (+7, soit 61 tests d'authentification) :
- fichier : `hit` sur 20 tentatives concurrentes, exactement 5 autorisées ; `release` décrémente sans remettre à zéro ; blocage, puis levée et purge ;
- Postgres (pool simulé) : séquence du schéma `BEGIN` / `SET LOCAL` / `pg_advisory_xact_lock` / DDL / `COMMIT`, sans verrou de session ;
  `ROLLBACK` si le DDL échoue, puis nouvelle tentative ; `hit` sur 20 tentatives concurrentes, une seule requête `RETURNING` par tentative et aucun `SELECT` séparé ; `release` ;
- routes : **20 connexions concurrentes avec un mauvais mot de passe : 5 réponses 401 et 15 réponses 429, et le bon mot de passe reste bloqué** ;
  une connexion réussie remet le compteur IP+e-mail à zéro ; `readAudit` en échec : POST `admin/users` répond 200 avec `audit: []`.

**Vérifications** :
- `npx tsc --noEmit` : aucune erreur.
- `npm test` : **11 fichiers, 636 tests réussis**.
- `npm run build` : **succès** (code de sortie 0, 13 routes `ƒ`).
- Aucun `TODO`, `.skip` ou `.only` introduit ; `data/` non touché.
- Nettoyage de l'itération 1 : le serveur `next start` du test local (pid 16000, port 3917) est arrêté et le Monitor est
  terminé. Aucun processus `next` ou `vitest` ne reste actif, et le dossier de données temporaire a été supprimé.

**Toujours en attente d'une vérification réelle** : V-7 (TS-9 : `ON CONFLICT … RETURNING`, schéma en transaction et
`SET LOCAL` derrière l'URL pooled de Neon, CR-3) et V-1/V-6 (T-13).

## Itération 3 — corrections de la recette UX et du QA (Tâche #7)

Entrées : `ux-recette.md` (UX-1 à UX-5), `qa-report.md` (BUG-1). UX-6 (`prefers-reduced-motion`) reste hors périmètre
(ticket séparé, décision design system). Ni la primitive `Field`, ni `inputCls`, ni les tokens / `globals.css` ne sont
modifiés : tout est corrigé localement dans `AuthGate.tsx`.

| Réf | Correction | Fichier:ligne |
|---|---|---|
| UX-1 (Haute) | La carte force aussi les champs en clair : `[&_input]:bg-slate-50 [&_input]:text-[#14142b] [&_input]:caret-[#14142b] [&_input]:border-slate-500`. Sélecteur `.x input` (0,1,1) prioritaire sur `.bg-surface2` / `.border-line` (0,1,0) ; `focus:border-brand-violet` (`:focus`, 0,2,0) reste prioritaire au focus. Contrastes calculés : texte `#14142b` / `slate-50` ≈ 17:1 ; œil `slate-600` / `slate-50` ≈ 7,2:1 ; bordure `slate-500` / `slate-50` ≈ 4,6:1. Indépendant du thème (aucun jeton). Classes vérifiées dans le CSS compilé. | `src/components/auth/AuthGate.tsx:25` |
| UX-2 | Champs « Jeton d'initialisation » et « Mot de passe » : `aria-label` court ; l'aide n'est plus passée à `Field` mais rendue dans ses enfants avec un `id` (même classes que l'aide de `Field`) et reliée par `aria-describedby`. `fieldErr(k, hintId)` fusionne l'aide et `auth-error` (`aria-describedby="auth-token-hint auth-error"` après un 403). Aide du mot de passe uniquement en setup. | `AuthGate.tsx:88-90` (ids et classe de l aide), `:105-108` (`fieldErr`), `:136-141` (jeton), `:145-149` (mot de passe) |
| UX-3 | Sous-titre `text-slate-500` → `text-slate-600`. | `AuthGate.tsx:133` |
| UX-4 | Bouton « Réessayer » / « Vérifier à nouveau » : `border-line` → `border-slate-500` (≈ 4,8:1 sur blanc). | `AuthGate.tsx:47` |
| UX-5 | `RetryButton` : région `<p aria-live="polite">` présente dès le rendu, vidée au clic puis remplie après `refreshAuth()` par « Toujours indisponible. Réessayez dans un instant. » si le composant est encore monté (état inchangé). Si l'état change, la carte est démontée et rien n'est affiché. `min-h` évite le saut de mise en page. | `AuthGate.tsx:42-51` |
| BUG-1 | `await seedFromEnv()` en tête du `try` de `POST /api/auth/login` (même place que dans `setup` et `session`). Mémoïsé par instance : un seul `count` par instance. En cas de stockage injoignable, l'erreur passe par `authErrorResponse` (503 `storage`) comme les autres opérations. | `src/app/api/auth/login/route.ts:2,19` |
| CR-7 (Mineur, Tâche #10) | Test « limiteur (CR-2) » stabilisé : le faux pool calcule `until_ms` à partir du `now` transmis par le backend (`params[1]`, soit `$2`) comme le SQL réel, au lieu d'un `Date.now()` pris après celui du backend (11 min au lieu de 10 si l'horloge avançait d'1 ms). Code de production inchangé. Fichier relancé seul 20 fois : 20/20. | `tests/unit/auth-postgres-backend.test.ts:122-123` |
| BUG-1 (test) | Données vides, `ADMIN_EMAIL` / `ADMIN_PASSWORD` valides, premier appel = login → 200, admin créé, session valide via `/api/auth/me`. | `tests/unit/auth-routes.test.ts:102` |

**Vérifications** :
- `npx tsc --noEmit` : aucune erreur.
- `npm test` : **12 fichiers, 650 tests réussis** (649 + 1 test BUG-1).
- `npm run build` : **succès** (code de sortie 0) dans le dépôt, aucun processus `next` actif au préalable (OBS-1).
- Aucun `TODO`, `.skip` ou `.only` dans les fichiers modifiés ; `data/` et `.env*` non touchés ; aucun `npm install`.

**À rejouer par l'UX / le QA** (navigateur, non fait ici) : UX-1 en thème sombre sur aurora et graphite (1280 et 360 px),
nom accessible des champs jeton / mot de passe (attendu : libellé seul, description = aide), annonce UX-5 après un
« Réessayer » qui échoue encore.
