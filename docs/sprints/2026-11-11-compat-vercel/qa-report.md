# Rapport QA — Sprint `2026-11-11-compat-vercel`

- **Auteur** : QA Engineer · **Date** : 2026-11-12 · **Tâche orchestrateur** : #1
- **Périmètre** : recette locale (TS-1 à TS-8, TS-10 à TS-12). **Hors périmètre, en attente d'accord humain** : TS-9 (Postgres réel, V-7), TS-13 (Preview Vercel, V-1/V-6/T-13), TS-14 (recette UX, agent `ux-ui`). Procédures prêtes dans `test-plan.md` § 3.
- **Revue de code** : Approuvé (itération 2). Aucune commande réseau tiers, aucun `npm install`, aucune commande `vercel` ; `data/` et `.env*` non touchés.

## 1. Contrôles automatiques

| Contrôle | Commande | Résultat | Preuve |
|---|---|---|---|
| Types | `npx tsc --noEmit` | ✅ 0 erreur | code de sortie 0 |
| Tests | `npm test` | ✅ **12 fichiers, 649 tests réussis** (636 du Dev + 13 ajoutés par le QA) | sortie Vitest, exécuté deux fois |
| Build | `npm run build` | ✅ succès, 13 routes `ƒ`, `/` et `/admin` statiques | sur copie temporaire (voir § 3, OBS-1), sortie 0 |
| **TS-10** | `VERCEL=1`, sans `AUTH_SECRET`, `npm run build` | ✅ succès, aucun effet de bord au chargement des modules | code de sortie 0 |
| **TS-12** | recherche dans `.next/static` après un build `VERCEL=1` avec valeurs factices | ✅ **0 occurrence des valeurs** (jeton, mot de passe et hôte de base factices) ; 0 pour `DATABASE_URL` ; les **noms** `SETUP_TOKEN` et `AUTH_SECRET` n'apparaissent que dans les micro-copies imposées par la ux-spec (chunk `992-*.js`, 1 fichier chacun) | Grep sur `.next/static` ; aucune valeur non plus dans le reste de `.next/` |
| Garde `.skip` / `.only` / `TODO` | recherche dans `tests/`, `src/server/auth`, `src/app/api`, client auth | ✅ 0 occurrence | Grep |

## 2. Matrice critère Gherkin → statut → preuve

Légende : ✅ vérifié ici · ⏳ en attente d'accord humain (réel) · « simulé » = vérifié avec pool ou instance simulés, sans service externe.

### US-1 Comptes persistants
| Scénario | Statut | Preuve |
|---|---|---|
| Compte conservé après redémarrage | ✅ local · ⏳ Postgres réel | TS-11 : `users.json` ancien format relu par un nouveau processus, connexion OK ; `auth-file-backend` « relit un users.json existant ». Persistance Postgres : TS-9/TS-13 |
| Compte visible sur toutes les instances | ✅ simulé · ⏳ réel | `auth-gherkin-gaps` : modules rechargés (nouvelle « instance »), session et compte reconnus. Deux pools réels : TS-9 |
| Désactivation effective partout | ✅ local · ⏳ multi-instances réelles | `auth-routes` « désactivation révoque la session » ; TS-11 étapes 10 à 12 : `me` → `user:null`, reconnexion 401 |
| Mots de passe jamais en clair | ✅ | `auth-gherkin-gaps` (users.json sans le mot de passe, hachage hexadécimal + sel) ; TS-11 `users.json` |
| Stockage injoignable | ✅ simulé · ⏳ réel | `auth-postgres-backend` « base injoignable » : 503, code `storage`, message exact (`errors.ts`), hôte, mot de passe et port absents de la réponse et des journaux |
| Isolation par compte conservée | ✅ non-régression | `route-guard` (toutes les routes `await authorize`) ; TS-11 : 401 sans session sur `admin/users` et `connectors/test`, 403 pour un non-admin. Aucune donnée utilisateur n'est stockée côté serveur par ce sprint |

### US-2 Secret de session
| Scénario | Statut | Preuve |
|---|---|---|
| Session valable sur toutes les instances | ✅ simulé | `auth-gherkin-gaps` : cookie émis avant rechargement des modules accepté après ; cookie signé avec un autre secret rejeté |
| Refus sans secret sur Vercel (message exact) | ✅ | `auth-gherkin-gaps` : 503, `code:"config"`, message exact, aucun fichier `auth-secret` créé ; `auth-routes` idem sur `/api/auth/me` |
| Secret trop court | ✅ | `auth-gherkin-gaps` (15 caractères en hébergé, même message) ; `auth-config` ; `auth-routes` (local) |
| Mode local inchangé | ✅ | `auth-gherkin-gaps` (secret de 64 caractères généré dans le dossier de données) ; TS-11 (`auth-secret` préexistant réutilisé) |

### US-3 Initialisation sécurisée (S8)
| Scénario | Statut | Preuve |
|---|---|---|
| Refus sans jeton / mauvais jeton (403) | ✅ | `auth-routes` (réponses identiques, aucun compte) ; `auth-gherkin-gaps` (message « Jeton d'initialisation invalide. » en hébergé) |
| Succès avec le bon jeton | ✅ | `auth-routes`, `auth-gherkin-gaps` |
| Création par `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ✅ | `auth-routes` (admin créé au premier accès à `me`, setup → 409) |
| Aucun mécanisme (hébergé) | ✅ | `auth-gherkin-gaps` : `setupMode:"disabled"`, setup 403 `setup_disabled` avec le message exact, aucun compte. Le formulaire masqué relève de la recette UX (TS-14) ; micro-copie présente dans le bundle |
| Déjà initialisé → 409 | ✅ | `auth-gherkin-gaps` (avec et sans jeton, `users.json` inchangé) ; TS-11 étape 6 |
| Jeton jamais exposé | ✅ | `me` et réponses sans valeur (`auth-routes`) ; `audit.log` sans jeton ni jeton erroné ; 0 occurrence dans `.next/static` (TS-12). Temps constant : `auth-config` (TS-4) |
| Mode local sans jeton | ✅ | `auth-routes` : `setupMode:"open"`, initialisation sans jeton |

### US-4 Journal d'audit
| Scénario | Statut | Preuve |
|---|---|---|
| Consultable après recyclage | ✅ local · ⏳ Postgres réel | TS-11 : `audit.log` relu ; table `bia_auth_audit` : TS-9/TS-13 |
| Aucun secret dans le journal | ✅ | `auth-gherkin-gaps` (mot de passe correct et faux, jetons vrai et faux, secret de session, valeur du cookie absents) ; `audit.log` du TS-11 |
| Échec d'écriture non bloquant | ✅ | `auth-gherkin-gaps` : `appendAudit` en échec, connexion 200, `console.warn` émis sans le mot de passe |
| Mode local inchangé | ✅ | `auth-gherkin-gaps`, TS-11 (format TSV inchangé) |

### US-5 Concurrence (S7)
| Scénario | Statut | Preuve |
|---|---|---|
| Désactivation non écrasée par une connexion | ✅ fichier · ⏳ réel | `auth-file-backend` (`Promise.all`) |
| Deux créations, même e-mail | ✅ fichier · ⏳ réel | `auth-file-backend` : 1 succès + `email_taken` |
| Dernier administrateur protégé | ✅ fichier · ⏳ réel | `auth-file-backend` : désactivation croisée, 1 admin actif + `last_admin` |
| Pas de double initialisation | ✅ fichier + route · ⏳ réel | `auth-file-backend` ; `auth-routes` (2 setups simultanés : 200 + 409, 1 admin) |

La concurrence sur Postgres n'est vérifiée que par pool simulé (séquence `BEGIN`, verrou, `COMMIT`) : **TS-9 reste à exécuter** pour la preuve réelle.

### US-6 Mode local
| Scénario | Statut | Preuve |
|---|---|---|
| Démarrage local sans variable externe | ✅ `next start` · `npm run dev` non rejoué | TS-11 : initialisation (tests de route), connexion, création d'utilisateur, désactivation sur `next start` avec dossier temporaire. Un `next dev` du poste (port 3100) n'a pas été utilisé (il partage `data/`) |
| Comptes existants conservés | ✅ | TS-11 : `users.json` et `auth-secret` générés au format de l'ancienne version, `needsSetup:false`, connexion avec l'ancien mot de passe 200 ; TS-5 (non-régression scrypt) |
| Aucun accès réseau tiers | ✅ | Connexions TCP du processus `next start` : **0 hors boucle locale** ; `pg` chargé seulement en mode Postgres (`backends/index.ts`, import dynamique) ; aucune ligne `postgres` dans le journal serveur |
| Détection de l'environnement | ✅ | `auth-config` (TS-1) ; hébergé + `BI_AUTH_STORE=file` refusé ; `auth-routes` : rien écrit sur disque sans secret en hébergé |

Vérifié sur Windows 11 (poste du projet).

### US-7 Guide de déploiement
| Scénario | Statut | Preuve |
|---|---|---|
| Nom de projet refusé | ✅ relecture · ⏳ option CLI | `README.md` § « Déployer sur Vercel » : `vercel link` avec nom en minuscules. L'option `--yes --project` n'est pas confirmée (`vercel link --help` non lancé) |
| Variables listées | ✅ | Tableau : `AUTH_SECRET`, `DATABASE_URL`/`BI_AUTH_DATABASE_URL`, `SETUP_TOKEN`, `ADMIN_*`, `BI_ALLOWED_HOSTS`, `BI_SQLITE_DIR`, avec rôle, caractère obligatoire, environnements |
| Limites annoncées | ✅ | Disque éphémère, bases internes joignables, production déconseillée (README § Vercel) |
| Secrets jamais dans le dépôt | ✅ | Exemples factices uniquement (README) ; `.env.example` ne porte que des valeurs factices (relu par recherche) |

### US-8 Preview
| Scénario | Statut | Preuve |
|---|---|---|
| Parcours complet sur l'URL Preview | ⏳ en attente d'accord humain (V-1, V-6, T-13) | Équivalent local : TS-11, 10 requêtes `me` successives sans déconnexion (10/10) |
| Persistance après nouveau déploiement | ⏳ idem | Procédure : `test-plan.md` § 3 |
| Protection de l'initialisation | ✅ simulé · ⏳ URL Preview | `auth-gherkin-gaps` (hébergé, sans jeton → 403) |
| Rapport honnête | ✅ | Voir § 4 |

## 3. TS-11 : détail de la recette locale

`next start` (build isolé) avec `BI_DATA_DIR` temporaire contenant un `users.json` et un `auth-secret` au format de l'ancienne version, **fabriqués par le QA** (le vrai `data/` n'a pas été lu). Séquence, tous résultats conformes : connexion de l'ancien admin 200 → `me` 200 → création d'utilisateur 200 → connexion du nouvel utilisateur 200 → 10 × `me` (10 fois le même utilisateur) → `setup` 409 `already_initialized` → `admin/users` sans session 401 → `connectors/test` sans session 401 → `admin/users` en simple utilisateur 403 → désactivation 200 → `me` de l'utilisateur désactivé `user:null` → reconnexion 401. Fichiers produits : `users.json`, `auth-secret`, `audit.log` (TSV, aucun secret). Serveur arrêté (port 3917 libre), dossier temporaire et copie de build supprimés.

**OBS-1 (environnement, pas un défaut de code)** : `npm run build` lancé dans le dépôt a échoué avec `PageNotFoundError: Cannot find module for page: /_document`, car un `next dev -p 3100` (PID 23280 / 21664 / 15420, lancé hors de cette session) tourne sur le même `.next/`. Le même build réussit sur une copie propre (sorties 0, TS-10 compris). À faire : arrêter ce serveur de développement avant tout `npm run build` dans le dépôt ; il a pu être perturbé par le build échoué (relancer au besoin). Je ne l'ai pas arrêté (hors de mon périmètre).

## 4. Éléments non vérifiés (⏳, jamais déclarés ✅)

- **TS-9 / V-7** : Postgres réel (concurrence sur deux pools, révocation inter-instances, `ON CONFLICT … RETURNING`, schéma transactionnel derrière l'URL pooled et `SET LOCAL statement_timeout` (CR-3), URL invalide).
- **TS-13 / V-1, V-6 / US-8** : Preview Vercel, Neon, variables Vercel, redéploiement, `vercel link --project`.
- **TS-14** : recette visuelle É1 à É7 (formulaire masqué si initialisation désactivée, focus, contrastes) : relève de `ux-ui`.
- `npm run dev` : non rejoué (voir US-6).
- Connexion à de vraies bases clientes et appels LLM tiers : hors périmètre, aucune clé ni base réelle utilisée.

## 5. Anomalies

| ID | Gravité | Titre | Repro | Attendu / obtenu |
|---|---|---|---|---|
| BUG-1 | **Mineur** (non bloquant, pas une régression) | `POST /api/auth/login` ne déclenche pas `seedFromEnv()` | Dossier de données vide, `ADMIN_EMAIL` et `ADMIN_PASSWORD` valides, premier appel de l'instance = `POST /api/auth/login` avec ces identifiants | Attendu (Gherkin US-3 « première requête ») : compte créé et connexion 200. Obtenu : 401 « Identifiants incorrects. ». Le parcours normal de l'interface appelle `/api/auth/me` d'abord (qui crée le compte), donc invisible pour l'utilisateur ; comportement identique à l'ancien code (le login n'amorçait pas non plus). Suggestion Dev : `await seedFromEnv()` au début du `try` du login |

Aucun BUG Bloquant ni Majeur.

## 6. Couverture ajoutée

`tests/unit/auth-gherkin-gaps.test.ts` (13 tests, sans réseau ni écriture hors dossier temporaire) comble : mots de passe hachés (US-1), message exact de configuration et session inter-instances (US-2), mode hébergé sans mécanisme d'initialisation, 403/409 aux libellés exacts et double mécanisme (US-3), journal non bloquant et sans secret (US-4). Aucun `.skip`, `.only` ni test vide. Fichiers de test totaux : 12, soit 649 tests.

## 7. Verdict

**GO sur le périmètre local** (US-1 à US-8 vérifiables sans service externe, TS-1 à TS-8 et TS-10 à TS-12 ✅, aucun invariant de sécurité dégradé, aucun Bloquant/Majeur ouvert).

**Réserves à porter au PO et à la GATE 3** :
1. La DoD d'US-1 (« au moins sur un déploiement Preview ou équivalent multi-instances ») et **tout US-8** ne sont pas prouvés : TS-9 et TS-13 restent ⏳ (accord humain V-7, V-1, V-6).
2. BUG-1 (Mineur) à corriger ou à accepter.
3. OBS-1 : arrêter le `next dev` du poste avant de rebâtir dans le dépôt.
4. La mise en production reste interdite (dette de recette P0 du sprint précédent).
