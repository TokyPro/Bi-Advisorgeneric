# Journal Git — Sprint 2026-11-11-compat-vercel

## 1. Branche

| Élément | Valeur |
|---|---|
| Branche | `feature/2026-11-11-compat-vercel` |
| Base | `main` @ `3dc50cd` (`docs(sprint): consigner la publication du sprint securite-p0`) |
| Synchronisation base | `main` = `origin/main` = `3dc50cd` au moment de la création |
| Commande | `git switch -c feature/2026-11-11-compat-vercel` |
| Date | 2026-11-11T15:32:08+03:00 |
| Validation humaine | OK explicite transmis par l'orchestrateur (Tâche #5) |
| Exécutée par | `reviewer` (CODE REVIEWER & GIT) |

### État de l'arbre à la création

- Aucun fichier suivi modifié (`git diff --stat HEAD` vide).
- Fichiers non suivis (conservés non suivis, ils suivent la branche) :
  - `docs/adr/ADR-001-stockage-auth.md`
  - `docs/sprints/2026-11-11-compat-vercel/architecture.md`
  - `docs/sprints/2026-11-11-compat-vercel/backlog.md`
  - `docs/sprints/2026-11-11-compat-vercel/ux-spec.md`
  - `docs/sprints/2026-11-11-compat-vercel/git-log.md` (ce fichier, créé après la bascule)

## 2. Commits

Aucun commit à ce stade (hors périmètre de la Tâche #5).

## 3. Contrôles de secrets

Sans objet à ce stade (aucun fichier indexé).

## 4. Push / merge / PR

Non effectués. Soumis à la GATE 3.

## 5. Préparation des commits (Tâche #2, 2026-11-16) : vérifications

Branche courante : `feature/2026-11-11-compat-vercel`. Aucun fichier indexé, aucun commit créé à ce stade.

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` | ✅ aucune erreur (code 0) |
| `npm test` (vitest) | ✅ 12 fichiers, **650/650** tests réussis |
| CR-7 / R4 : `tests/unit/auth-postgres-backend.test.ts` relancé seul **10 fois** | ✅ 10/10 (11/11 tests à chaque passage). Correctif relu (`:121-123`) : test seul, `until_ms` dérivé du `now` transmis (`$2`) comme le SQL réel, code de production inchangé. **R4 levée.** |
| R6 : processus sur le port 3100 | ✅ aucun processus à l'écoute |
| Serveur de l'utilisateur sur le port 3000 | `next dev` lancé **depuis ce dépôt** (PID 4496, parent 28992) : il partage `.next/`, donc `npm run build` dans le dépôt l'aurait perturbé. **Non arrêté, non perturbé.** |
| `npm run build` | ✅ `next build` exécuté dans une **copie isolée** de l'arbre de travail (scratchpad de session, sans `.git`, `.next`, `data/`, `.env`, `.env.local`, `node_modules` relié par jonction) : code 0, 0 erreur, 0 avertissement, `BUILD_ID` produit, routes `/api/auth/*` et `/api/connectors/*` compilées. Le serveur 3000 écoutait toujours après le build. |
| Revue de code | Itération 3 : **Approuvé** (`code-review.md:229`). Correctif CR-7 relu ci-dessus (test uniquement). |
| QA / UX / PO | QA **GO sur le périmètre local** (`qa-report.md:123`) · recette UX itération 2 **Conforme** (`ux-recette.md:163`, R3 levée) · PO **accepté avec réserves** (US-8 reportée). |

### Contrôle des secrets et fichiers interdits (44 fichiers du périmètre)

- Recherche sur tous les fichiers modifiés et non suivis du sprint : `sk-…`, `AIza…`, `nvapi-…`, `BEGIN … PRIVATE KEY`,
  `postgres://user:pass@`, `password=`, `AUTH_SECRET=`, `ADMIN_PASSWORD=`, `SETUP_TOKEN=`, `DATABASE_URL=`.
  **Aucun secret réel.** Occurrences toutes factices et documentées : `.env.example` (lignes commentées, valeurs
  « remplacez… » / « factice » / `hote-factice.example.com`), `README.md:104` (exemples factices), `dev-notes.md:72`
  (valeur TS-12 tronquée et factice), `tests/unit/auth-postgres-backend.test.ts:101-102` (`hunter2`, hôte de test, servant
  justement à prouver l'absence de fuite).
- Adresses e-mail : uniquement des domaines fictifs (`ex.fr`, `exemple.fr`, `api.exemple.com`). Aucun hôte Neon ou Vercel réel.
- Fichiers interdits : aucun `data/**` (dont `data/users.json.bak`), `.env`, `.env.local`, `.omc/`, `.next/`, `node_modules/`,
  `*.tsbuildinfo`, `.bak`, capture d'écran dans le périmètre. `.gitignore` couvre déjà ces chemins : aucun ajout à proposer.
- Hygiène des `.ts` / `.tsx` du périmètre : aucun `TODO`, `FIXME`, `.only(`, `.skip(` ni `console.log`.
- Fins de ligne : Git signale `LF will be replaced by CRLF` sur 14 fichiers (`core.autocrlf`) ; conversion de checkout,
  sans incidence sur le contenu.
- **Exclus du plan** : `docs/sprints/2026-11-16-observability/**` (autre sprint) ; aucun `docs/adr/ADR-002*` présent.

## 6. Plan de commits proposé (en attente d'OK humain)

Le découpage suit les tâches `T-n`, en respectant une contrainte : **chaque commit doit compiler**. Les tâches T-3 à T-7
et T-10 changent ensemble l'API du store (passage en asynchrone, `authorize` remplace `requireAuth`) ; les séparer
laisserait des commits intermédiaires qui ne compilent pas. Elles forment donc un seul commit. Les modules T-1 et T-2/T-8
sont nouveaux et ne sont importés qu'à partir du commit 3 : ils compilent seuls (analyse des imports).

| # | Message | Fichiers |
|---|---|---|
| 1 | `feat(auth): ajouter la configuration, les erreurs typées et le hachage asynchrone` (Réf : US-2, US-3, US-6, T-1) | `src/server/auth/config.ts`, `src/server/auth/errors.ts`, `src/server/auth/password.ts` |
| 2 | `feat(auth): ajouter les backends de stockage fichier et PostgreSQL` (Réf : US-1, US-4, US-5, US-6, T-2, T-7, T-8, CR-2, CR-3) | `src/server/auth/backends/types.ts`, `src/server/auth/backends/file.ts`, `src/server/auth/backends/postgres.ts`, `src/server/auth/backends/index.ts` |
| 3 | `refactor(auth): migrer le store, la session, l'audit et les routes vers le stockage asynchrone` (Réf : US-1 à US-5, T-3, T-4, T-5, T-6, T-7, T-10, BUG-1) | `src/server/auth/store.ts`, `src/server/auth/session.ts`, `src/server/auth/audit.ts`, `src/app/api/auth/{login,logout,me,password,setup}/route.ts`, `src/app/api/admin/{health,users}/route.ts`, `src/app/api/connectors/{fetch,query,schema,test}/route.ts`, `src/app/api/llm/{chat,test}/route.ts` |
| 4 | `feat(auth): gérer l'initialisation par jeton et les erreurs de stockage dans l'écran de connexion` (Réf : US-2, US-3, T-9, UX-1 à UX-5) | `src/lib/auth-client.ts`, `src/components/auth/AuthGate.tsx` |
| 5 | `test(auth): couvrir la configuration, les backends, les routes et la garde des routes` (Réf : US-1 à US-6, T-12, CR-7, BUG-1) | `tests/unit/auth-config.test.ts`, `tests/unit/auth-file-backend.test.ts`, `tests/unit/auth-postgres-backend.test.ts`, `tests/unit/auth-routes.test.ts`, `tests/unit/auth-gherkin-gaps.test.ts`, `tests/unit/route-guard.test.ts` |
| 6 | `docs(config): documenter le déploiement Vercel et les variables d'authentification` (Réf : US-7, T-11) | `.env.example`, `README.md` |
| 7 | `docs(adr): consigner l'ADR-001 sur le stockage de l'authentification` (Réf : US-1, T-8) | `docs/adr/ADR-001-stockage-auth.md` |
| 8 | `docs(sprint): livrables du sprint 2026-11-11-compat-vercel` (Réf : US-1 à US-8) | `docs/sprints/2026-11-11-compat-vercel/{backlog,architecture,ux-spec,dev-notes,code-review,test-plan,qa-report,ux-recette,validation-po,git-log}.md` |

Chaque message aura un corps (le *pourquoi*), une ligne `Réf : …` et la ligne d'attribution
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Ajout explicite par chemin (`git add <chemins>`), jamais `-A` ni `.`,
puis `git diff --cached --stat` et nouveau contrôle des secrets avant chaque commit. Après le dernier commit :
`npx tsc --noEmit` et `npm test` sur l'état commité.

Les hashes seront consignés ici après exécution, par un commit complémentaire `docs(sprint): consigner les commits du sprint`
(soumis lui aussi à OK), ou bien inclus dans un amend du commit 8 avant tout push si l'humain le préfère.

Rappels pour la GATE 3 (hors périmètre de cette tâche) : livraison à présenter comme « prête pour un déploiement Preview »,
pas comme « compatible Vercel démontrée » (R1, R2 et R5 ouvertes, US-8 reportée) ; mise en production interdite.
