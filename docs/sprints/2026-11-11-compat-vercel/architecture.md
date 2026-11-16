# Architecture — Sprint `2026-11-11-compat-vercel`

- **Auteur** : Tech Lead · **Date** : 2026-11-11 · **Tâche orchestrateur** : #3
- **Entrées** : `backlog.md` (GATE 1 validée le 2026-11-11, décision Q7 = « les deux »), `ux-spec.md` (§ 2, H1–H6),
  `src/server/auth/{store,session,audit}.ts`, les 13 routes `src/app/api/**/route.ts`, `src/lib/auth-client.ts`,
  `src/components/auth/AuthGate.tsx`, `package.json`, `next.config.mjs`, `.env.example`, `README.md`, audit 2026-11-10 (S5–S8).
- **ADR** : [`docs/adr/ADR-001-stockage-auth.md`](../../adr/ADR-001-stockage-auth.md) (choix du stockage, Q1).

---

## 1. Constat sur l'existant (sous-étape 2.1)

| Élément | Comportement actuel | Problème sur Vercel |
|---|---|---|
| `store.ts` | `users.json` lu et réécrit en entier, **de façon synchrone**, à chaque appel (`read()` à chaque `getUser`) | FS en lecture seule hors `/tmp` ; `/tmp` est propre à chaque instance et éphémère, donc comptes perdus ou divergents |
| `authSecret()` | `AUTH_SECRET` s'il fait au moins 16 caractères, **sinon génération et écriture de `data/auth-secret`** | Un secret différent par instance provoque des déconnexions aléatoires ; un `AUTH_SECRET` trop court est ignoré en silence |
| `seedFromEnv()` | Appelée à chaque `getUser` et `/api/auth/me` | Course entre instances (double création possible) |
| `/api/auth/setup` | Ouvert tant que `countUsers() === 0` | **S8** : le premier visiteur d'une URL publique devient administrateur |
| `updateUser` / `createUser` / `deleteUser` | Lecture, modification, écriture sans verrou | **S7** : un `lastLogin` concurrent peut annuler une désactivation |
| Limiteur (`session.ts:55`) | `Map` en mémoire, jamais purgée | Inefficace entre instances (Q5) |
| `audit.ts` | `appendFileSync(data/audit.log)` | Écriture impossible ou perdue (US-4) |
| `hashPassword` | `scryptSync` N=32768, r=8, p=1 (≈ 32 Mio, plafond 64 Mio) | Bloque la boucle d'événements : gênant avec Fluid compute (requêtes concurrentes dans une même instance) |
| `requireAuth` | **Synchrone**, appelée dans 9 routes | Un stockage réseau rend l'API asynchrone (voir le risque R1, critique) |

**Contraintes Vercel retenues.** Rédigées sans accès réseau : le Dev ou le reviewer revérifie les valeurs chiffrées
sur vercel.com/docs avant la GATE 2.

- Runtime **Node.js** obligatoire (scrypt, `pg`) : toutes les routes gardent `export const runtime = 'nodejs'`. Pas d'Edge.
- FS : seul `/tmp` est accessible en écriture, sans persistance ni partage. **Aucune écriture d'authentification
  sur disque en mode hébergé.**
- Variables présentes au **build comme au runtime** (`VERCEL=1`) : **aucun effet de bord au chargement d'un
  module** (pas de lecture de secret, de connexion ou de `throw` au niveau du module), sinon `next build` échoue
  sur Vercel.
- Mémoire et durée des fonctions : les plafonds par défaut (de l'ordre de 2 Go et de plusieurs dizaines de secondes
  au minimum, valeurs à confirmer) dépassent largement le besoin d'un hachage scrypt (32 Mio, environ 50 à 150 ms
  sur 1 vCPU).
- Les Preview deployments sont protégés par défaut par la **Vercel Authentication** (Deployment Protection). Il faut
  la garder active : c'est une défense supplémentaire contre S8 en Preview. Pour la recette US-8, le testeur passe
  par son compte Vercel, ou par un jeton de contournement (*Protection Bypass for Automation*), qui est lui-même un
  secret.

---

## 2. Réponses aux questions ouvertes

### Q1 — Stockage externe : **PostgreSQL (Neon via Vercel Marketplace recommandé)**

Détail et comparaison dans l'**ADR-001** : PostgreSQL/Neon, Upstash Redis, Vercel Blob, Edge Config et SQLite sur `/tmp`.
Arguments décisifs :

1. **Aucune dépendance npm nouvelle** : `pg@8.23` est déjà installé (`optionalDependencies`) et externalisé (`serverExternalPackages`).
2. **Atomicité native** pour S7 et US-5 : transactions, index unique sur l'e-mail, verrou consultatif.
3. **Portable** : tout PostgreSQL convient (Neon, Supabase, base auto-hébergée), ce qui répond aussi au cas Docker de Q3.

La base d'authentification est **dédiée** : jamais une base cliente, jamais visible du LLM ni des connecteurs.

### Q2 — Consultation du journal d'audit

- **Mode Postgres** : table `bia_auth_audit`, consultable comme aujourd'hui dans `/admin` > Utilisateurs > journal
  (`readAudit` lit la table), et en SQL depuis la console Neon.
- **En cas d'échec d'écriture** (US-4, scénario 3) : l'événement est **émis sur `console.warn`** au format JSON d'une
  ligne (`{"audit":"login","actor":"…","at":"…"}`, sans secret). Il est alors visible dans les *Runtime Logs* Vercel,
  dont la rétention est courte et dépend du plan. Le journal n'est jamais bloquant.
- **Mode fichier** : `data/audit.log`, inchangé.
- Rétention de la table : non purgée dans ce sprint (volume négligeable). La purge à 180 jours est une dette notée (R7).

### Q3 — Détection de l'environnement

Nouveau module `src/server/auth/config.ts`, évalué **paresseusement** (fonctions, jamais au chargement du module) :

```ts
export const isHosted = () => process.env.VERCEL === '1' || process.env.BI_HOSTED === 'true';
export type StoreKind = 'file' | 'postgres';
export function storeKind(): StoreKind {
  const v = process.env.BI_AUTH_STORE;
  if (v === 'file' || v === 'postgres') return v;
  return isHosted() ? 'postgres' : 'file';
}
// Mode hébergé + BI_AUTH_STORE=file : refusé (ConfigError 'config') — le disque n'est pas persistant.
```

- **Vercel** : `VERCEL=1` est injecté automatiquement par la plateforme, donc le mode hébergé est automatique.
- **Autre hébergement sans disque persistant** (Docker, Cloud Run, etc.) : l'administrateur pose `BI_HOSTED=true` et
  fournit l'URL Postgres. Une installation Docker **avec** volume persistant peut garder `BI_AUTH_STORE=file`, sans
  `BI_HOSTED`.
- **Local** : `file`, sans aucun accès réseau. Une variable `DATABASE_URL` présente n'active **pas** Postgres
  (seul `BI_AUTH_STORE=postgres` le fait), ce qui respecte US-6, scénario 3.

### Q4 — Coût du hachage scrypt sur Vercel : **conservé à l'identique**

- Paramètres **inchangés** : N=32768, r=8, p=1, clé de 64 octets, `maxmem` 64 Mio. Les hachages existants de
  `data/users.json` restent valides, sans migration (US-6, scénario 2). Environ 32 Mio par calcul, très en dessous
  des plafonds mémoire.
- Seul changement : **`crypto.scrypt` asynchrone** (pool de threads libuv) au lieu de `scryptSync`, pour ne pas bloquer
  la boucle d'événements quand plusieurs requêtes partagent une instance. Avec 4 threads libuv par défaut, au plus
  4 hachages simultanés par instance, soit environ 128 Mio : acceptable.
- La comparaison factice en cas d'utilisateur inconnu (temps constant) est conservée.
- **Aucune dégradation de sécurité**, donc pas d'arbitrage PO nécessaire.

### Q5 — Limitation des tentatives partagée : **oui, dans ce sprint (T-7)**

La `Map` en mémoire devient inefficace dès qu'il y a plusieurs instances. Sur une URL publique, c'est une régression
de fait de l'invariant « blocage 10 min après 5 échecs » documenté dans le README. Décision :

- La limitation passe par le backend : table `bia_login_attempts(key, n, until)` avec `INSERT … ON CONFLICT DO UPDATE`
  atomique en Postgres. En mode fichier, la `Map` mémoire est conservée **et purgée** des entrées expirées.
- Mêmes seuils : 5 échecs, puis blocage de 10 minutes. Clés : `ip|email` (comme aujourd'hui) **et** `email` seul,
  avec un seuil de 10 pour limiter le contournement par changement d'IP (S5, recommandation partielle). Sur Vercel,
  `x-forwarded-for` est renseigné par la plateforme (à confirmer dans la doc). Le reste de S5 (`TRUST_PROXY`) est
  hors périmètre.
- Appliquée aussi à `/api/auth/setup`, clé `setup|ip`, 5 essais, puis 10 minutes de blocage.
- Réponse : **429**, `code: 'rate_limited'`, avec `retryAfterMin` (entier). Copie client retenue (proposition UX) :
  « Trop de tentatives. Réessayez dans quelques minutes. ». Le client n'affiche pas le texte serveur (H2).
- Rattachée à **US-1** (non-régression d'un invariant de sécurité). **Report possible sans casser US-1, mais à arbitrer
  par l'humain en GATE 2** : si elle est coupée, le README doit dire que la limitation ne vaut que par instance.

### Q6 et Q7

- Q6 : voir § 8 (validations humaines).
- Q7 « les deux » : traité par la matrice de `setupPolicy` (§ 4.3).

---

## 3. Réponses aux hypothèses UX (ux-spec § 2)

| # | Décision Tech Lead |
|---|---|
| **H1** | **Confirmé, avec correction de route** : la route existante est **`GET /api/auth/me`** (il n'y a pas de `/api/auth/session`) ; elle est conservée. Champ ajouté : `setupMode: 'open' \| 'token' \| 'disabled'`, renseigné **seulement si `needsSetup === true`** (sinon absent). Si `ADMIN_EMAIL`/`ADMIN_PASSWORD` ont créé l'admin, `needsSetup=false` et l'écran de connexion standard s'affiche. |
| **H2** | **Confirmé**. Toute réponse d'erreur d'auth porte `{ ok:false, code, error }`. Codes stables : `config` (AUTH_SECRET absent ou trop court en mode hébergé, ou configuration de stockage incohérente) et `storage` (backend injoignable, pilote absent), tous deux en **503**. `/api/auth/me`, `login`, `setup`, `password`, `admin/users` **et `authorize()` sur toutes les routes protégées** peuvent les renvoyer. Le client mappe `code` vers son texte et applique le **repli 5b** sur tout code inconnu ; `error` est conservé pour compatibilité, mais le client ne l'affiche pas pour ces codes. |
| **H3** | **Confirmé** : 403, `code: 'setup_token_invalid'`, message « Jeton d'initialisation invalide. », identique pour un jeton absent, vide ou faux. Comparaison à temps constant (§ 4.3). |
| **H4** | **Confirmé** : 409, `code: 'already_initialized'`, « L'application est déjà initialisée. », puis `refreshAuth()` côté client et toast. Également renvoyé au perdant d'une double initialisation concurrente (US-5). |
| **H5** | **Tranché** : `status` gagne **une seule** valeur, `'error'`. Champs annexes : `setupMode: SetupMode \| null` et `configError: 'config' \| 'storage' \| null`. `status: 'setup'` + `setupMode` mène à É1, É2 ou É4 ; `status: 'error'` + `configError` mène à É5a ou É5b. Pas de valeur `status` dédiée au mode `disabled`, qui reste un sous-état de `setup`. |
| **H6** | **Confirmé** : seul l'énuméré `setupMode` est exposé. Aucune variable `NEXT_PUBLIC_*` liée à l'auth. `SETUP_TOKEN`, `AUTH_SECRET`, `ADMIN_*` et l'URL de base ne sont lus que dans `src/server/**`. Vérification par recherche dans `.next/static` (plan de test, TS-12). |
| **429** | Retenu (Q5), code `rate_limited`, copie UX ci-dessus. |
| **A-1 / A-2 / A-4** | **Inclus dans T-9** (même fichier `AuthGate.tsx`, coût faible, aucun risque sécurité), **coupables en premier** si le sprint déborde. Ils n'appartiennent à aucune story : à signaler au PO comme amélioration annexe. |

---

## 4. Conception par story

### 4.1 Architecture cible (vue d'ensemble)

```
src/server/auth/
  config.ts        (nouveau)  isHosted, storeKind, authSecret strict, setupPolicy, lecture de l'env (paresseuse)
  errors.ts        (nouveau)  AuthConfigError('config'), AuthStorageError('storage'), DomainError(code, message)
  password.ts      (nouveau)  hashPassword / checkPassword (scrypt async, paramètres inchangés), validatePassword
  backends/
    types.ts       (nouveau)  interface AuthBackend
    file.ts        (nouveau)  data/users.json + audit.log + Map mémoire ; mutex en processus
    postgres.ts    (nouveau)  import dynamique de 'pg', Pool, schéma, transactions + verrou consultatif
    index.ts       (nouveau)  getBackend() mémoïsé selon storeKind()
  store.ts         (modifié)  façade domaine ASYNC : mêmes noms exportés (listUsers, createUser…), validation, invariants
  session.ts       (modifié)  getUser async, authorize() remplace requireAuth, seed mémoïsé, limiteur délégué
  audit.ts         (modifié)  audit() async best-effort → backend, repli console
src/app/api/**/route.ts (13)  await authorize(...) / await store.*
src/lib/auth-client.ts, src/components/auth/AuthGate.tsx   états H5, codes H2, champ jeton
```

### 4.2 Contrats et types (côté serveur, `src/server/auth/backends/types.ts`)

`src/lib/types.ts` n'est **pas** modifié : ces types sont serveur uniquement.

```ts
export interface User { id: string; email: string; name: string; role: Role; hash: string; salt: string;
  createdAt: number; disabled?: boolean; tokenVersion: number; lastLogin?: number }   // inchangé
export interface AuditEntry { at: string; event: string; actor: string; detail: string; ip: string }

export interface AuthBackend {
  readonly kind: 'file' | 'postgres';
  count(): Promise<number>;
  list(): Promise<User[]>;
  findById(id: string): Promise<User | undefined>;
  findByEmail(emailNormalized: string): Promise<User | undefined>;
  /** Insère un utilisateur déjà validé et haché. `onlyIfEmpty` : échoue avec DomainError('already_initialized')
   *  si un compte existe (vérification ET insertion dans la même section critique). E-mail en doublon → DomainError('email_taken'). */
  insert(u: User, opts?: { onlyIfEmpty?: boolean }): Promise<User>;
  /** Applique `mutate` sur l'état courant relu DANS la section critique ; vérifie l'invariant « ≥ 1 admin actif ». */
  update(id: string, mutate: (u: User) => User): Promise<User>;
  remove(id: string): Promise<void>;                       // même invariant
  touchLogin(id: string, at: number): Promise<User>;      // ne modifie QUE lastLogin (S7)
  attempts: { lockedFor(key: string): Promise<number>; fail(key: string, max: number): Promise<void>; clear(key: string): Promise<void> };
  appendAudit(e: AuditEntry): Promise<void>;
  readAudit(n: number): Promise<AuditEntry[]>;
}
```

Règles :
- Le **hachage scrypt est calculé hors section critique**, dans `store.ts`, avant `insert`/`update`, pour ne pas tenir
  le verrou environ 100 ms.
- `update(id, mutate)` : `mutate` est une fonction pure. Le backend relit l'utilisateur sous verrou, applique `mutate`,
  vérifie l'invariant puis écrit. Cela supprime la fenêtre « lecture, modification, écriture » de S7.
- `tokenVersion` est incrémenté dans `mutate` selon la règle actuelle (mot de passe, désactivation, changement de rôle).

**Façade `store.ts`** (signatures devenues `async`, noms conservés pour limiter le diff des routes) :
`listUsers`, `countUsers`, `findByEmail`, `findById`, `createUser`, `updateUser`, `deleteUser`, `touchLogin` (nouveau),
`createFirstAdmin` (nouveau, utilisé par setup **et** seed), `seedFromEnv`, `pub`, `validatePassword`.
`authSecret` est **déplacé** dans `config.ts`.

**Erreurs** (`errors.ts`) :

| Classe | `code` | HTTP | Message serveur (le client mappe par `code`) |
|---|---|---|---|
| `AuthConfigError` | `config` | 503 | « Configuration incomplète : AUTH_SECRET est requis. Contactez l'administrateur. » |
| `AuthStorageError` | `storage` | 503 | « Service d'authentification momentanément indisponible. Réessayez dans un instant. » |
| `DomainError` | `setup_token_invalid` | 403 | « Jeton d'initialisation invalide. » |
| `DomainError` | `setup_disabled` | 403 | « Initialisation non configurée. L'administrateur doit définir SETUP_TOKEN ou ADMIN_EMAIL / ADMIN_PASSWORD. » |
| `DomainError` | `already_initialized` | 409 | « L'application est déjà initialisée. » |
| `DomainError` | `email_taken` | 400 | « Cet e-mail est déjà utilisé. » |
| `DomainError` | `last_admin` | 400 | « Impossible : il doit rester au moins un administrateur actif. » |
| `DomainError` | `rate_limited` | 429 | « Trop de tentatives. Réessayez dans quelques minutes. » (+ `retryAfterMin`) |
| *(inchangé)* | `unauthenticated` | 401 | « Non authentifié. » |

Un utilitaire `authErrorResponse(e: unknown): Response` (dans `errors.ts`) centralise ce mapping. Toute erreur non
reconnue venant du backend est convertie en `storage` (503). **Les messages d'erreur `pg` ne sont jamais renvoyés ni
loggués** (ils peuvent contenir l'hôte) : on ne loggue que `err.code` (ex. `ECONNREFUSED`, `28P01`).

### 4.3 US-3 — Politique d'initialisation (`config.ts`, fonction pure testable)

```ts
export type SetupMode = 'open' | 'token' | 'disabled';
export function setupMode(env = process.env): SetupMode {
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) return 'disabled';          // admin créé par l'env : écran jamais proposé
  if (env.SETUP_TOKEN) return env.SETUP_TOKEN.length >= 32 ? 'token' : 'disabled'; // jeton trop court = non configuré (+ console.error sans valeur)
  return isHosted() ? 'disabled' : 'open';                               // local : comportement actuel
}
```

| Environnement | SETUP_TOKEN (≥ 32) | ADMIN_* | `setupMode` | Comportement |
|---|---|---|---|---|
| local | — | — | `open` | É1, inchangé |
| local | oui | — | `token` | É2, le jeton est exigé aussi en local |
| hébergé | oui | — | `token` | É2 |
| hébergé | — | — | `disabled` | É4, API setup 403 `setup_disabled` |
| tous | — / oui | oui (valides) | `disabled` | Seed au premier accès, `needsSetup=false`, écran de connexion |
| tous | — | oui (invalides) | `disabled` | Seed en échec : `console.error('[auth] ADMIN_* invalide')` sans valeur ; É4 |

- Q7 « les deux » : les deux mécanismes coexistent. Si les deux sont définis, ADMIN_* l'emporte (seed), et setup
  renvoie 409 puisqu'un compte existe.
- **Ordre de traitement dans `POST /api/auth/setup`** :
  1. limiteur `setup|ip` ;
  2. `count() > 0` → 409 ;
  3. `setupMode()` : `disabled` → 403 `setup_disabled` ;
  4. si `token` : comparaison à temps constant, échec → 403 `setup_token_invalid` + `audit('setup_denied', '-', '', ip)`, **sans la valeur reçue** ;
  5. validation des champs, puis hachage ;
  6. `createFirstAdmin()` → `insert(u, { onlyIfEmpty: true })`, atomique : le perdant d'une course reçoit 409 ;
  7. cookie + `audit('setup_admin')`.
- **Comparaison à temps constant** : `timingSafeEqual(hmacSha256(k, reçu), hmacSha256(k, attendu))`, avec `k` une clé
  aléatoire du processus. Les longueurs sont alors égales par construction et aucune information de longueur ne fuit.
- **Seed** (`seedFromEnv`) : mémoïsé par instance (`seeded = true` dès que `count() > 0`), pour ne pas lancer une
  requête `count` à chaque appel. Il passe par `createFirstAdmin` : si deux instances amorcent en même temps, une
  seule crée l'admin et l'autre ignore 409 en silence.

### 4.4 US-2 — Secret de session (`config.ts`)

```ts
export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s !== undefined && s !== '') { if (s.length >= 16) return s; throw new AuthConfigError(); } // défini mais trop court : refus partout
  if (isHosted()) throw new AuthConfigError();                       // jamais de génération ni d'écriture disque
  return localFileSecret();                                          // comportement actuel (data/auth-secret), mode local
}
```

- **Changement de comportement à documenter** (notes de migration) : un `AUTH_SECRET` défini mais de moins de
  16 caractères était ignoré ; il est maintenant refusé, y compris en local (scénario Gherkin « Secret trop court »,
  non restreint à Vercel). **PO informé via la revue de cette conception.**
- `signSession` et `getUser` laissent l'`AuthConfigError` remonter jusqu'à `authorize()` et aux routes, qui répondent
  503 `config`. La valeur n'est jamais logguée.

### 4.5 US-1 et US-5 — Backend Postgres (`backends/postgres.ts`)

- `const { Pool } = await import('pg')`, en import dynamique mémoïsé. En cas d'échec, `AuthStorageError` et
  `console.error('[auth] pilote pg absent')`. Le mode local n'importe **jamais** `pg`.
- Pool mémoïsé sur `globalThis` (survit au rechargement à chaud en dev) : `max: 3`, `idleTimeoutMillis: 10_000`,
  `connectionTimeoutMillis: 5_000`, `statement_timeout`/`query_timeout` de 5 s. Utiliser l'**URL « pooled » de Neon**.
  **Ne jamais désactiver la vérification TLS** (`rejectUnauthorized: false` interdit) ; la configuration SSL vient de
  l'URL (`sslmode=require`).
- **Module distinct des connecteurs** : il n'importe rien de `src/server/connectors/**` et ne modifie pas
  `sql.ts`/`sql-guard.ts`. Les garde-fous lecture seule des connecteurs ne sont ni assouplis ni réutilisés : cette
  base est une base applicative en écriture, configurée par l'administrateur et non par l'utilisateur. La politique
  SSRF `safe-fetch` ne s'applique pas à cette URL, qui vient de l'environnement serveur et non d'une saisie
  utilisateur.
- Schéma, initialisé une fois par instance (promesse mémoïsée) sous `pg_advisory_lock` :

```sql
CREATE TABLE IF NOT EXISTS bia_users (
  id text PRIMARY KEY, email text NOT NULL, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','user')), hash text NOT NULL, salt text NOT NULL,
  created_at bigint NOT NULL, disabled boolean NOT NULL DEFAULT false,
  token_version integer NOT NULL DEFAULT 1, last_login bigint);
CREATE UNIQUE INDEX IF NOT EXISTS bia_users_email_uq ON bia_users (email);   -- e-mail normalisé en minuscules à l'écriture
CREATE TABLE IF NOT EXISTS bia_login_attempts (key text PRIMARY KEY, n integer NOT NULL, until_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS bia_auth_audit (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL, actor text NOT NULL, detail text NOT NULL DEFAULT '', ip text NOT NULL DEFAULT '');
```

- **Écritures** (`insert`, `update`, `remove`) : `BEGIN; SELECT pg_advisory_xact_lock(<constante bia_users>); …; COMMIT`.
  Toutes les mutations de comptes sont sérialisées (trafic d'écriture quasi nul, coût négligeable). Le contrôle
  « au moins un admin actif » et `onlyIfEmpty` sont faits **après** la prise du verrou. Une violation de l'index
  unique (`23505`) donne `email_taken`.
- `touchLogin` : `UPDATE bia_users SET last_login=$1 WHERE id=$2 RETURNING *`, une seule colonne, sans verrou.
  Une désactivation concurrente n'est donc jamais écrasée (US-5, scénario 1).
- **Toutes les requêtes sont paramétrées** (`$1…`), sans aucune concaténation.
- `bigint` est renvoyé en chaîne par `pg` : conversion `Number()` au mapping.
- **Révocation immédiate partout** (US-1, scénario 3) : `getUser` relit `findById` à chaque requête, **sans cache**.
  C'est un compromis assumé : environ 1 aller-retour SQL par appel API.

### 4.6 US-6 — Backend fichier (`backends/file.ts`)

- Reprise **à l'identique** du format `users.json` (mêmes champs, permissions 600, écriture tmp puis renommage) et
  de `audit.log` (format TSV inchangé). Aucune migration.
- **Mutex en processus** (chaîne de promesses) autour de chaque mutation, avec relecture du fichier sous verrou :
  S7 est corrigé dans un même processus. Le multi-processus local n'est pas supporté (ce n'était pas le cas avant
  non plus) : à documenter.
- `attempts` : `Map` mémoire, avec purge des entrées expirées à chaque appel.
- `fs.promises` ou appels synchrones dans des fonctions `async` : laissé au choix du Dev, tant que le mutex encadre
  lecture et écriture.

### 4.7 US-1 — Session et routes (`session.ts`, 13 routes)

- `getUser(req): Promise<PublicUser | null>`.
- **`requireAuth` est supprimée et remplacée par `authorize(req, role?): Promise<{ user } | Response>`.** Le
  renommage est **obligatoire**, voir R1 : un `requireAuth` devenu asynchrone sans `await` ferait de
  `auth instanceof Response` toujours faux, donc un **contournement silencieux de l'authentification** sur
  `connectors/{fetch,query,schema,test}` et `llm/{chat,test}`, routes qui n'utilisent pas `auth.user`, sans aucune
  erreur TypeScript. Avec la suppression du nom, tout appel oublié devient une erreur de compilation.
- `authorize` attrape `AuthConfigError` et `AuthStorageError` et renvoie la `Response` 503 correspondante.
- L'ordre est conservé : contrôle d'origine CSRF, puis session, puis rôle.
- `lockedFor`, `recordFail` et `clearFails` deviennent async et délèguent à `backend.attempts`.
- `/api/auth/me` répond `{ ok, user, needsSetup, setupMode?, authDisabled }`, ou 503 `{ ok:false, code }`.
- `AUTH_DISABLED` : comportement inchangé (hors périmètre, S10).

### 4.8 US-4 — Audit (`audit.ts`)

`audit(event, actor, detail?, ip?): Promise<void>` :
1. normalisation (tronquer à 200 caractères, remplacer `\t\r\n` par une espace ; corrige S6 au passage, sans coût) ;
2. `await backend.appendAudit` dans un `try` ;
3. en cas d'échec, `console.warn(JSON.stringify({ audit: event, actor, at }))` et **la requête continue**.

Les routes font `await audit(...)` : sur une fonction serverless, une promesse non attendue peut être interrompue
après la réponse. `readAudit` est async et passe par le backend. **Liste noire** : aucun mot de passe, jeton,
secret ni URL de base dans `detail`. La route `admin/users` loggue aujourd'hui `pw: !!b.password`, un booléen :
conforme.

### 4.9 US-3 et US-2 — Client (`auth-client.ts`, `AuthGate.tsx`)

- `AuthState = { status: 'loading'|'anon'|'setup'|'authed'|'error'; user; authDisabled; setupMode: SetupMode|null; configError: 'config'|'storage'|null }`.
- `refreshAuth()` : `r.status === 503` ou `j.code ∈ {config, storage}` mène à `status:'error'` ; `needsSetup` mène à
  `status:'setup'` avec `setupMode`. Une erreur réseau mène à `status:'error'` avec `configError:'storage'`
  (aujourd'hui : `anon`).
- `call()` : renvoie une erreur typée `{ code, retryAfterMin? }`. Le texte affiché vient d'une **table client
  `code → message`**, et tout code inconnu donne le message 5b.
- `setupAdmin(name, email, password, token?)` : le jeton n'est envoyé que dans le corps POST. **Il n'est jamais mis
  dans le store Zustand, ni dans le stockage du navigateur, ni dans l'URL** (AC-9). Il reste dans un état local du
  composant, vidé après un 403.
- `AuthGate` : rendus É1 à É7 selon la ux-spec, plus A-1, A-2 et A-4.

---

## 5. Tâches techniques ordonnées

🔒 = sensible (revue de sécurité renforcée) · ⚠️ = validation humaine requise avant exécution (§ 8)

| # | Tâche | Stories | Fichiers | Dépend de | Notes |
|---|---|---|---|---|---|
| **T-1** 🔒⚠️ | Config, erreurs, mot de passe : `config.ts` (isHosted, storeKind, authSecret strict, setupMode), `errors.ts` (+ `authErrorResponse`), `password.ts` (scrypt **async**, paramètres inchangés, `checkPassword` à temps constant conservé) | US-2, US-3, US-6 | `src/server/auth/config.ts` (créé), `errors.ts` (créé), `password.ts` (créé) | — | Aucun effet de bord au chargement |
| **T-2** 🔒⚠️ | Interface `AuthBackend` + backend fichier (format identique, mutex, purge du limiteur) + `backends/index.ts` | US-6, US-5 (local) | `src/server/auth/backends/{types,file,index}.ts` (créés) | T-1 | `index.ts` n'importe `postgres.ts` que dynamiquement |
| **T-3** 🔒⚠️ | Façade domaine async `store.ts` : validation, hachage hors verrou, `createFirstAdmin`, `touchLogin`, seed mémoïsé ; `authSecret` retiré | US-1, US-5, US-6 | `src/server/auth/store.ts` (modifié) | T-1, T-2 | |
| **T-4** 🔒⚠️ | Session : `getUser` async, **`authorize` remplace `requireAuth`**, limiteur délégué, mapping 503 | US-1, US-2 | `src/server/auth/session.ts` (modifié) | T-3 | Voir R1 |
| **T-5** 🔒⚠️ | Migration des 13 routes : `await authorize`, `await` sur le store et l'audit, réponses `{ok,code,error}` ; `/api/auth/me` + `setupMode` ; login (`touchLogin`, 429 `rate_limited`) | US-1, US-2, US-3 | `src/app/api/{admin/health,admin/users,auth/login,auth/logout,auth/me,auth/password,connectors/fetch,connectors/query,connectors/schema,connectors/test,llm/chat,llm/test}/route.ts` (modifiés) | T-4 | **Refacto > 5 fichiers.** À la fin de T-5, `tsc` + `build` + test manuel local doivent passer (jalon « local iso-fonctionnel ») |
| **T-6** 🔒⚠️ | Initialisation sécurisée : `POST /api/auth/setup` selon § 4.3 (limiteur, 409, `setup_disabled`, jeton à temps constant, `createFirstAdmin` atomique, audit sans jeton) | US-3, US-5 | `src/app/api/auth/setup/route.ts` (modifié) | T-5 | |
| **T-7** 🔒⚠️ | Limitation des tentatives partagée (Q5) : `attempts` dans les deux backends, double clé `ip\|email` + `email`, appliquée au login et au setup | US-1 (parité) | `backends/file.ts`, `backends/postgres.ts`, `session.ts`, `auth/login`, `auth/setup` | T-5, T-8 pour Postgres | Report possible avec arbitrage humain (§ 2, Q5) |
| **T-8** 🔒⚠️ | Backend Postgres : import dynamique de `pg`, pool, schéma, transactions + verrou consultatif, `touchLogin`, journal d'audit, mapping des erreurs sans fuite | US-1, US-4, US-5 | `src/server/auth/backends/postgres.ts` (créé) | T-2 | Aucune dépendance ajoutée |
| **T-9** | Client : store H5, table `code → message`, champ jeton, états É1 à É7, 409 → `refreshAuth` + toast, 429 ; A-1/A-2/A-4 | US-2, US-3 | `src/lib/auth-client.ts`, `src/components/auth/AuthGate.tsx` (modifiés) | T-5, T-6 | A-x coupables en premier |
| **T-10** | Audit async best-effort + repli console + normalisation (US-4, S6) | US-4 | `src/server/auth/audit.ts` (modifié) | T-2 ; T-8 pour Postgres | US-4 coupable : repli console seul |
| **T-11** ⚠️ | Documentation : `.env.example` (nouvelles variables) ; README : section « Déployer sur Vercel » (§ 6), mise à jour de « Authentification », ajout aux « Notes de migration » (AUTH_SECRET court refusé, `requireAuth` → `authorize` pour les contributeurs) | US-7 | `.env.example` (fichier `.env*`), `README.md` | T-1 à T-8 | |
| **T-12** | Filet de sécurité automatisé (Dev) : test vitest **de garde des routes**. Pour chaque `src/app/api/**/route.ts` hors liste publique (`auth/login`, `auth/logout`, `auth/me`, `auth/setup`), chaque handler exporté contient `await authorize(`, et aucune occurrence de `requireAuth` ne subsiste dans `src/` | US-1 | `tests/unit/route-guard.test.ts` (créé) | T-5 | Le reste des tests revient au QA (§ 7) |
| **T-13** ⚠️ | Recette Preview (QA + humain) : intégration Neon, variables Vercel, `vercel link`, déploiement Preview, parcours US-8 | US-8 | aucun fichier source ; `qa-report.md` | Tout | Chaque action externe sous « OK » humain |

**Couverture** : US-1 (T-3, T-4, T-5, T-7, T-8, T-12) · US-2 (T-1, T-4, T-5, T-9) · US-3 (T-1, T-5, T-6, T-9) ·
US-4 (T-8, T-10) · US-5 (T-2, T-3, T-6, T-8) · US-6 (T-1, T-2, T-3) · US-7 (T-11) · US-8 (T-13).

**Ordre d'implémentation conseillé** : T-1, T-2, T-3, T-4, T-5, T-12 (jalon local iso-fonctionnel, tsc et build
au vert), puis T-6, T-9, T-8, T-10, T-7, T-11, T-13.

**Plan de coupe** (cohérent avec le backlog § 5) :
1. A-1/A-2/A-4 (dans T-9) ;
2. US-5 : retirer seulement les tests de concurrence dédiés. Les mécanismes de T-2 et T-8 étant de toute façon
   nécessaires à US-1 et US-3, le gain est faible ;
3. US-4 : T-10 réduit au repli console et `readAudit` en Postgres renvoie `[]` ;
4. T-7, sur arbitrage humain uniquement.

Ne jamais couper T-1 à T-6, T-8 et T-12.

---

## 6. US-7 — Contenu attendu du guide « Déployer sur Vercel » (T-11)

1. **Pré-requis** : compte Vercel, CLI `vercel`, base Postgres **dédiée** (Neon via *Vercel Marketplace > Neon*,
   ce qui injecte `DATABASE_URL`), à créer après accord humain.
2. **Nom du projet** : le CLI refuse les majuscules et les espaces. Utiliser `vercel link` et saisir un nom en
   minuscules (ex. `bi-advisor`), ou `vercel link --project bi-advisor`. Le Dev vérifie l'option exacte avec
   `vercel link --help` au moment de la rédaction.
3. **Variables** :

| Variable | Rôle | Obligatoire | Environnements |
|---|---|---|---|
| `AUTH_SECRET` | Signature des sessions, ≥ 16 caractères (32 recommandés) | **Oui** en hébergé | Preview, Production : **valeurs distinctes** |
| `DATABASE_URL` ou `BI_AUTH_DATABASE_URL` | Base des comptes (URL « pooled ») ; `BI_AUTH_DATABASE_URL` est prioritaire | **Oui** en hébergé | Preview, Production (branches Neon distinctes recommandées) |
| `SETUP_TOKEN` | Jeton d'initialisation, ≥ 32 caractères, à retirer après l'initialisation | L'un **ou** l'autre | Preview, Production |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` (`ADMIN_NAME`) | Création automatique de l'admin | L'un **ou** l'autre | idem ; retirer `ADMIN_PASSWORD` après le premier démarrage |
| `BI_AUTH_STORE` | Forcer `file` ou `postgres` (rarement utile) | Non | — |
| `BI_HOSTED` | Hébergement sans disque persistant hors Vercel | Non (Vercel : automatique) | — |
| `BI_ALLOWED_HOSTS`, `BI_NETWORK_POLICY` | Inchangés ; les cibles internes doivent être joignables depuis Vercel | Selon les besoins | — |
| `BI_SQLITE_DIR` | **Inutilisable sur Vercel** (disque éphémère) | Non | — |

4. **Limites** : disque éphémère (SQLite et fichiers serveur indisponibles) ; bases internes injoignables sans
   exposition réseau ; **mise en production déconseillée tant que la recette P0 n'est pas rejouée** ; garder la
   *Deployment Protection* sur les Preview ; aligner la région des fonctions sur celle de la base (réglage du
   projet, sans `vercel.json`).
5. Exemples de valeurs **factices uniquement** ; liens vers les « Notes de migration ».
6. SQL du schéma (§ 4.5), pour un rôle Postgres sans droit `CREATE`.

---

## 7. Stratégie de test suggérée au QA

Vitest est déjà configuré (`npm test`). **Pas de `.skip`/`.only`** : la suite Postgres est une configuration
séparée, lancée explicitement.

| # | Niveau | Cible | Cas |
|---|---|---|---|
| TS-1 | Unitaire | `config.ts` | Matrice `isHosted`/`storeKind` (VERCEL, BI_HOSTED, BI_AUTH_STORE, DATABASE_URL seul en local → `file`) ; mode hébergé + `file` → `config` |
| TS-2 | Unitaire | `authSecret` | Absent en hébergé → `AuthConfigError` **sans écriture disque** (vérifier l'absence de `auth-secret` dans un `BI_DATA_DIR` temporaire) ; 15 caractères → erreur partout ; local absent → fichier généré |
| TS-3 | Unitaire | `setupMode` | Les 6 lignes de la matrice § 4.3 ; jeton de 31 caractères → `disabled` |
| TS-4 | Unitaire | Comparaison du jeton | Bon, mauvais, vide, absent, de longueur différente ; aucune exception |
| TS-5 | Unitaire | `password.ts` | Un hachage produit par l'**ancien** `scryptSync` (fixture générée dans le test) est vérifié par le nouveau code : non-régression US-6 |
| TS-6 | Intégration (fichier, `BI_DATA_DIR` temporaire) | Backend fichier | CRUD ; `users.json` existant relu sans migration ; **concurrence** : `Promise.all([désactiver, touchLogin])` → désactivé ; 2 × `createUser` même e-mail → 1 succès + `email_taken` ; 2 × désactivation croisée d'admins → 1 admin actif + `last_admin` ; 2 × `createFirstAdmin` → 1 + `already_initialized` |
| TS-7 | Intégration (handlers appelés avec un `NextRequest` construit) | Routes auth | setup : 409 / 403 `setup_token_invalid` (jeton absent ou faux, réponse identique) / 403 `setup_disabled` / succès + cookie ; jeton absent du corps de réponse et de `audit.log` ; login 429 après 5 échecs ; `/api/auth/me` + `setupMode` ; 503 `config` en hébergé sans secret |
| TS-8 | Garde (T-12) | Toutes les routes | `await authorize(` présent, `requireAuth` absent |
| TS-9 | Intégration Postgres, **config dédiée `vitest.pg.config.ts`**, lancée seulement si `BI_TEST_DATABASE_URL` est fourni (Postgres local jetable ou branche Neon de test, **accord humain**) | Backend Postgres | Mêmes cas que TS-6, sur 2 pools distincts (simulation de 2 instances) ; révocation visible depuis le second pool ; URL invalide → `storage` 503 sans hôte dans la réponse ni dans les logs capturés |
| TS-10 | Build | — | `npx tsc --noEmit` ; `npm run build` **avec `VERCEL=1` et sans `AUTH_SECRET`** doit réussir (aucun effet au chargement) |
| TS-11 | Manuel local Windows | US-6 | `npm run dev` et `npm run start` avec un `data/` existant (copie, jamais le `data/` réel lu dans un livrable) : connexion, gestion des comptes, aucun trafic réseau sortant lié à l'auth |
| TS-12 | Statique | H6, US-3 | Recherche de `SETUP_TOKEN`, `AUTH_SECRET`, `DATABASE_URL` et des valeurs de test dans `.next/static/**` → 0 occurrence |
| TS-13 | E2E Preview (US-8) | Déploiement réel | Parcours complet ; 10 requêtes sans déconnexion ; redéploiement → comptes conservés ; setup sans jeton refusé ; tout élément non vérifié marqué ⏳ |
| TS-14 | Recette UX | É1 à É7 | Selon ux-spec § 7 |

---

## 8. Validations humaines à demander en GATE 2

⚠️ **VALIDATION HUMAINE REQUISE** pour chacun des points suivants, qui seront redemandés au moment de l'exécution :

| # | Action | Impact / réversibilité |
|---|---|---|
| V-1 | **Choix du stockage** : PostgreSQL avec Neon via Vercel Marketplace (ADR-001) | Création d'un compte et d'une base chez un service tiers ; réversible (suppression de la base) |
| V-2 | **Modification de `src/server/auth/**`** (store, session, audit + 9 fichiers créés) | Cœur de l'authentification ; réversible par Git |
| V-3 | **Refactorisation > 5 fichiers et interface partagée** : suppression de `requireAuth` au profit d'`authorize` async, 13 routes modifiées | Réversible par Git ; risque R1 traité par le renommage et T-12 |
| V-4 | **Fichier `.env.example`** (motif `.env*`) : ajout de `SETUP_TOKEN`, `BI_AUTH_STORE`, `BI_AUTH_DATABASE_URL`, `BI_HOSTED` | Documentation seule, valeurs factices |
| V-5 | **Changement de comportement** : un `AUTH_SECRET` défini mais trop court est refusé y compris en local | Peut bloquer une installation existante mal configurée ; documenté dans les notes de migration |
| V-6 | **Variables d'environnement Vercel** (AUTH_SECRET, SETUP_TOKEN ou ADMIN_*, DATABASE_URL), `vercel link`, **déploiement Preview** | Environnement distant ; chaque action sous « OK » explicite |
| V-7 | **Base de test pour TS-9** (Postgres local ou branche Neon) | Réseau tiers si Neon |
| V-8 | Option non retenue par défaut : passer `pg` d'`optionalDependencies` à `dependencies` (`package.json`) | Seulement si l'installation de `pg` échoue sur Vercel |

**Dépendances npm à ajouter : aucune.** **Fichiers sensibles non touchés** : `package.json` (sauf V-8),
`next.config.mjs` (`pg` déjà dans `serverExternalPackages`), `tsconfig.json`, `src/lib/vault.ts`, garde-fous des
connecteurs (`src/server/connectors/**`), `data/`.

---

## 9. Risques

| # | Risque | Prob. / Impact | Parade |
|---|---|---|---|
| **R1** | **Contournement silencieux de l'auth** : `requireAuth` devenue async sans `await` → `instanceof Response` toujours faux (6 routes n'utilisent pas `auth.user`) | Forte si non traité / **Critique** | Suppression du nom (erreur de compilation), `authorize` + test de garde T-12 + revue ligne à ligne |
| R2 | Fuite de l'URL ou de l'hôte de la base via un message d'erreur `pg` | Moyenne / Haute | Mapping vers `storage` ; ne logguer que `err.code` ; test TS-9 |
| R3 | Échec de `next build` sur Vercel à cause d'un effet au chargement (`VERCEL=1` présent au build) | Moyenne / Moyenne | Évaluation paresseuse ; TS-10 |
| R4 | Saturation des connexions Postgres (instances multiples) | Faible / Moyenne | URL pooled, `max: 3`, délais d'inactivité courts |
| R5 | Latence : réveil à froid de Neon + 1 requête SQL par appel API | Moyenne / Faible | Acceptable en Preview ; région alignée ; cache de session reporté (il casserait la révocation immédiate) |
| R6 | `pg` (optionnel) non installé sur Vercel | Faible / Haute | 503 `storage` explicite + `/api/admin/health` ; V-8 en repli |
| R7 | Table d'audit sans purge | Faible / Faible | Dette : purge à 180 jours dans un sprint ultérieur |
| R8 | `SETUP_TOKEN` laissé en place après l'initialisation | Moyenne / Faible | Sans effet une fois un compte créé (409) ; le guide recommande de le retirer |
| R9 | Clé du limiteur basée sur `x-forwarded-for` | Faible sur Vercel | Clé e-mail seule en complément ; S5 complet hors périmètre |
| R10 | Mutex fichier inefficace en multi-processus local | Faible / Faible | Documenté ; usage local mono-processus |

## 10. Points de vigilance pour la revue (`reviewer`)

1. **R1** : chaque route protégée fait `await authorize(...)` **avant** tout accès aux données. Plus aucun `requireAuth`. Le test T-12 est présent et passe.
2. **Aucun secret logué ni renvoyé** : `SETUP_TOKEN`, `AUTH_SECRET`, `ADMIN_PASSWORD`, URL de base, `err.message` de `pg`. Rechercher `console.` dans `src/server/auth/**`.
3. **Jeton** : comparaison HMAC + `timingSafeEqual` ; réponse identique pour un jeton absent ou faux ; pas d'audit de la valeur ; aucune variable `NEXT_PUBLIC_` ; le jeton n'est pas mis dans le store client.
4. **Atomicité** : toutes les mutations Postgres sous `pg_advisory_xact_lock` dans une transaction ; invariant « dernier admin » vérifié **après** le verrou ; `touchLogin` ne modifie qu'une colonne ; requêtes **paramétrées** uniquement.
5. **Mode local** : `pg` jamais importé (import dynamique uniquement dans `postgres.ts`) ; format de `users.json` et paramètres scrypt identiques.
6. **Mode hébergé** : aucune écriture disque (`fs.write*`, `appendFile`, `mkdir`) atteignable lorsque `isHosted()`.
7. **TLS** : pas de `rejectUnauthorized: false`.
8. **Isolation** : `postgres.ts` n'importe rien des connecteurs ; les garde-fous lecture seule de `src/server/connectors/**` ne sont pas modifiés.
9. Aucun effet de bord au chargement d'un module dans `src/server/auth/**`.
10. Ordre conservé dans `authorize` : CSRF, puis session, puis rôle ; `/api/admin/*` exige toujours `admin`.
