# Plan de test — Sprint `2026-11-11-compat-vercel`

- **Auteur** : QA Engineer · **Date** : 2026-11-12 · **Tâche orchestrateur** : #1
- **Entrées** : `backlog.md`, `architecture.md` § 7 (TS-1 à TS-14), `dev-notes.md`, `code-review.md` (itération 2 : Approuvé)

## 1. Environnement et données

- Windows 11, Node via `npm`, Vitest 5.1 (déjà installé), `next start` local. Aucune installation, aucun réseau tiers.
- Données : dossiers temporaires (`BI_DATA_DIR`), `users.json` « ancien format » généré (scrypt N=32768), valeurs factices pour jeton, base et secret. `data/` et `.env*` jamais lus ni écrits.
- Mode hébergé simulé : `VERCEL=1` + backend fichier injecté (`vi.doMock`) ; Postgres réel **non utilisé** (⏳ V-7).
- Les builds sont exécutés sur une **copie temporaire** du dépôt (un `next dev` du poste, port 3100, partage `.next/` du dépôt et fait échouer `next build` : voir qa-report § 3).

## 2. Matrice stratégie → cas

| TS | Niveau | Cas / fichier | Périmètre |
|---|---|---|---|
| TS-1 à TS-5 | Unitaire | `tests/unit/auth-config.test.ts` | Local |
| TS-6 | Intégration fichier | `tests/unit/auth-file-backend.test.ts` | Local |
| TS-7 | Intégration routes | `tests/unit/auth-routes.test.ts` + `tests/unit/auth-gherkin-gaps.test.ts` (QA) | Local |
| TS-8 | Garde | `tests/unit/route-guard.test.ts` | Local |
| TS-9 | Intégration Postgres réel | Pool simulé : `auth-postgres-backend.test.ts`. Réel : **⏳ en attente d'accord humain (V-7)** | Hors périmètre |
| TS-10 | Build | `npx tsc --noEmit` ; `npm run build` ; build `VERCEL=1` sans `AUTH_SECRET` | Local |
| TS-11 | Manuel local | `next start`, `BI_DATA_DIR` temporaire, `users.json` ancien format, curl | Local |
| TS-12 | Statique | Recherche de valeurs et de noms dans `.next/static` | Local |
| TS-13 | E2E Preview | **⏳ en attente d'accord humain (V-1, V-6, T-13)** | Hors périmètre |
| TS-14 | Recette UX | Non confiée à ce lot (agent `ux-ui`) | Hors périmètre |

La traçabilité critère Gherkin → statut → preuve figure dans `qa-report.md` § 2.

## 3. Procédures prêtes (en attente d'accord humain)

**TS-9 (V-7)** : fournir `BI_TEST_DATABASE_URL` (Postgres local jetable ou branche Neon de test, jamais une base cliente), créer `vitest.pg.config.ts` (à ajouter après accord, `package.json` non modifié ici), rejouer les cas de `auth-file-backend.test.ts` sur deux pools distincts : concurrence réelle (désactivation vs `touchLogin`, double création, double initialisation, désactivation croisée d'admins), révocation vue depuis le second pool, `INSERT … ON CONFLICT … RETURNING` du limiteur (20 appels concurrents → 5 autorisés), schéma créé dans une transaction derrière l'URL **pooled** avec `SET LOCAL statement_timeout` (CR-3), URL invalide → 503 sans hôte ni mot de passe dans la réponse ni dans les journaux.

**TS-13 (V-1, V-6)** : après accord pour la base de test et `vercel deploy` (Preview) : 1) `setup` sans jeton → 403 ; 2) `setup` avec jeton ; 3) connexion ; 4) création d'un utilisateur ; 5) déconnexion, reconnexion avec lui ; 6) 10 requêtes `/api/auth/me` sans déconnexion ; 7) nouveau déploiement Preview, comptes conservés ; 8) vérifier `vercel link --help` pour l'option `--project` du README ; 9) consulter `bia_auth_audit`. Aucune donnée cliente ; éléments non vérifiés marqués ⏳.
