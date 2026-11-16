# Backlog — Sprint `2026-11-11-compat-vercel`

- **Auteur** : Product Owner · **Date** : 2026-11-11 · **Tâche orchestrateur** : #1
- **Entrées lues** : `CLAUDE.md`, `docs/audits/2026-11-10-audit-global.md` (S7, S8), `docs/sprints/2026-11-10-securite-p0/validation-po.md` (§ 3), `src/server/auth/store.ts`, `src/app/api/auth/setup/route.ts`, `src/components/auth/AuthGate.tsx`

## 1. Epic — Compatibilité Vercel

**Problème** : sur Vercel, le disque est en lecture seule hors `/tmp`, et `/tmp` est éphémère et propre à chaque instance. L'authentification actuelle (fichiers `users.json`, `auth-secret`, journal d'audit) y est donc inutilisable : comptes perdus, déconnexions aléatoires (secret différent selon l'instance), journal perdu. Sur une URL publique, la faille S8 (le premier visiteur devient administrateur) devient critique.

**Valeur métier** : un dirigeant ou un analyste de PME peut ouvrir BI Advisor sur une URL Vercel, s'y connecter de façon stable, et retrouver ses comptes d'une visite à l'autre.

**Personas** : Administrateur (déploie, initialise, gère les comptes), Utilisateur (se connecte, travaille).

**Cadrage de la portée**
- Ce sprint vise un **déploiement Preview fonctionnel**. La **mise en production reste interdite** tant que la dette de recette P0 du sprint `2026-11-10-securite-p0` n'est pas rejouée (`validation-po.md` § 3 : P0-1 à P0-4, P1-1, P1-2). Tout déploiement reste soumis à validation humaine (CLAUDE.md § 5).
- Le **mode local** (`npm run dev` / `npm run start` avec `./data`) doit continuer de fonctionner **sans service externe**.
- Le choix du stockage externe n'est **pas tranché ici** : voir § 6 (questions pour le Tech Lead).

**Décision UX (tranchée)** : impact visuel **mineur mais réel**. L'écran d'initialisation (`AuthGate`, mode « setup ») doit gérer un jeton d'initialisation (US-3) et de nouveaux messages d'erreur ; l'écran de connexion n'est pas modifié sauf message d'erreur de configuration (US-2). **L'étape UX/UI n'est pas sautée** : intervention courte limitée à ces écrans (champ jeton, état « initialisation désactivée », message d'erreur de configuration). Les autres stories n'ont pas d'impact visuel.

## 2. Vue d'ensemble

| ID | Titre | MoSCoW | Points | Dépend de | Impact visuel |
|---|---|---|---|---|---|
| US-1 | Comptes persistants et partagés entre instances (Vercel) | Must | 8 | Q1 (choix stockage) | Non |
| US-2 | Secret de session stable et obligatoire hors mode local | Must | 3 | — | Message d'erreur |
| US-3 | Initialisation sécurisée du premier administrateur (S8) | Must | 5 | US-1 | Oui (mineur) |
| US-4 | Journal d'audit conservé hors disque local | Should | 3 | Q1 | Non |
| US-5 | Cohérence des écritures de comptes avec plusieurs instances (S7) | Should | 5 | US-1 | Non |
| US-6 | Mode local inchangé, sans service externe | Must | 2 | US-1 | Non |
| US-7 | Guide de déploiement Vercel (nom du projet, variables, limites) | Must | 2 | US-1 à US-3 | Non |
| US-8 | Déploiement Preview vérifié de bout en bout | Must | 3 | US-1 à US-3, US-6 | Non |

Total : 31 points (8 Must hors US-4/US-5 = 23 ; Should = 8). Si la capacité est insuffisante, US-4 et US-5 sont reportables (voir § 5).

---

## 3. Stories et critères d'acceptation

### US-1 — Comptes persistants et partagés entre instances — Must — 8 pts

**En tant qu'** administrateur, **je veux** que les comptes utilisateurs survivent aux redémarrages et soient identiques sur toutes les instances Vercel, **afin que** mes collaborateurs puissent se connecter durablement sur l'URL déployée.

```gherkin
Fonctionnalité: Persistance des comptes sur Vercel
  Scénario: Un compte créé reste disponible après un redémarrage
    Étant donné une application déployée sur Vercel avec un stockage de comptes configuré
    Et un administrateur ayant créé le compte « analyste@exemple.fr »
    Quand l'application est redéployée ou que l'instance est recyclée
    Alors « analyste@exemple.fr » peut toujours se connecter avec son mot de passe

  Scénario: Un compte créé sur une instance est visible sur toutes les autres
    Étant donné deux requêtes servies par deux instances différentes
    Quand un administrateur crée un compte via la première
    Alors la seconde reconnaît ce compte à la connexion

  Scénario: Une désactivation de compte est effective partout
    Étant donné un utilisateur connecté
    Quand un administrateur désactive son compte
    Alors toute requête suivante de cet utilisateur, quelle que soit l'instance, reçoit un refus d'accès (session invalide)

  Scénario: Les mots de passe ne sont jamais stockés en clair
    Étant donné un compte créé sur le stockage externe
    Quand on inspecte les données stockées
    Alors seul un hachage salé du mot de passe est présent

  Scénario: Stockage externe injoignable
    Étant donné un déploiement dont le stockage de comptes est indisponible
    Quand un utilisateur tente de se connecter
    Alors il voit « Service d'authentification momentanément indisponible. Réessayez dans un instant. »
    Et aucun détail technique (hôte, identifiants, chaîne de connexion) n'apparaît dans la réponse ni dans les journaux

  Scénario: Isolation par compte conservée
    Étant donné deux utilisateurs distincts
    Quand l'un appelle une API protégée
    Alors il n'accède qu'à ses propres données, comme avant le sprint
```

**DoD** : scénarios ci-dessus vérifiés (au moins sur un déploiement Preview ou un équivalent multi-instances) ; aucun secret du stockage externe dans le dépôt, les journaux ou les réponses ; `npx tsc --noEmit` et `npm run build` passent ; invariants de sécurité inchangés.

---

### US-2 — Secret de session stable et obligatoire hors mode local — Must — 3 pts

**En tant qu'** utilisateur, **je veux** rester connecté quelle que soit l'instance qui me répond, **afin de** ne pas être déconnecté de façon aléatoire.

```gherkin
Fonctionnalité: Secret de signature des sessions
  Scénario: Session valable sur toutes les instances
    Étant donné un déploiement avec la variable AUTH_SECRET définie (16 caractères minimum)
    Quand un utilisateur se connecte via une instance puis envoie ses requêtes suivantes à une autre instance
    Alors sa session est acceptée sans reconnexion

  Scénario: Démarrage refusé sans secret sur Vercel
    Étant donné un déploiement Vercel sans AUTH_SECRET
    Quand un utilisateur tente de se connecter
    Alors l'authentification est refusée avec le message « Configuration incomplète : AUTH_SECRET est requis. Contactez l'administrateur. »
    Et aucun secret n'est généré à la volée ni écrit sur le disque

  Scénario: Secret trop court
    Étant donné AUTH_SECRET défini avec moins de 16 caractères
    Quand l'application tente de signer une session
    Alors elle refuse avec le même message de configuration incomplète

  Scénario: Mode local inchangé
    Étant donné une exécution locale sans AUTH_SECRET
    Quand l'utilisateur se connecte
    Alors un secret est généré dans le dossier de données local, comme avant
```

**DoD** : message exact ci-dessus ; aucune valeur de secret loguée ; mode local inchangé (US-6).

---

### US-3 — Initialisation sécurisée du premier administrateur (S8) — Must — 5 pts

**En tant qu'** administrateur, **je veux** que seul le détenteur d'un secret de déploiement puisse créer le premier compte administrateur, **afin qu'** un visiteur anonyme ne s'empare pas de l'application sur une URL publique.

```gherkin
Fonctionnalité: Initialisation du premier administrateur sur un déploiement public
  Scénario: Initialisation refusée sans jeton
    Étant donné un déploiement Vercel sans aucun compte et avec SETUP_TOKEN défini
    Quand un visiteur envoie une demande d'initialisation sans jeton ou avec un mauvais jeton
    Alors la réponse est un refus (403) « Jeton d'initialisation invalide. »
    Et aucun compte n'est créé

  Scénario: Initialisation réussie avec le bon jeton
    Étant donné un déploiement sans compte avec SETUP_TOKEN défini
    Quand l'administrateur saisit le bon jeton, son nom, son e-mail et un mot de passe valide
    Alors le premier compte administrateur est créé et il est connecté

  Scénario: Création par variables d'environnement
    Étant donné un déploiement sans compte avec ADMIN_EMAIL et ADMIN_PASSWORD valides
    Quand l'application démarre ou reçoit sa première requête
    Alors le compte administrateur est créé sans passer par l'écran d'initialisation
    Et l'écran d'initialisation n'est jamais proposé aux visiteurs

  Scénario: Déploiement public sans aucun mécanisme d'initialisation
    Étant donné un déploiement Vercel sans compte, sans SETUP_TOKEN et sans ADMIN_EMAIL/ADMIN_PASSWORD
    Quand un visiteur ouvre l'application
    Alors il voit « Initialisation non configurée. L'administrateur doit définir SETUP_TOKEN ou ADMIN_EMAIL / ADMIN_PASSWORD. »
    Et aucun formulaire de création de compte n'est affiché
    Et l'API d'initialisation refuse toute demande

  Scénario: Initialisation impossible une fois l'application initialisée
    Étant donné au moins un compte existant
    Quand quelqu'un appelle l'initialisation, avec ou sans jeton
    Alors la réponse est 409 « L'application est déjà initialisée. » et rien n'est modifié

  Scénario: Le jeton n'est jamais exposé
    Quand on consulte les réponses de l'API, le code client et les journaux
    Alors la valeur de SETUP_TOKEN n'y apparaît jamais
    Et un jeton erroné n'est pas écrit dans le journal d'audit

  Scénario: Mode local inchangé
    Étant donné une exécution locale sans SETUP_TOKEN
    Quand le premier utilisateur ouvre l'application
    Alors l'écran d'initialisation actuel est proposé sans champ jeton
```

**DoD** : parcours testé avec et sans jeton ; comparaison du jeton à temps constant (exigence fonctionnelle : aucune information sur le jeton ne fuit) ; textes validés par UX/UI ; README mis à jour (US-7).

---

### US-4 — Journal d'audit conservé hors disque local — Should — 3 pts

**En tant qu'** administrateur, **je veux** retrouver le journal des événements d'authentification (connexions, initialisation, désactivations), **afin de** pouvoir tracer les accès à mon déploiement.

```gherkin
Fonctionnalité: Journal d'audit sur Vercel
  Scénario: Événement consultable après recyclage de l'instance
    Étant donné un déploiement Vercel
    Quand un utilisateur se connecte puis l'instance est recyclée
    Alors l'événement de connexion reste consultable (stockage persistant ou journaux de la plateforme)

  Scénario: Aucun secret dans le journal
    Quand on consulte le journal
    Alors il ne contient ni mot de passe, ni jeton, ni secret de session

  Scénario: Échec d'écriture du journal
    Étant donné un journal momentanément inaccessible
    Quand un utilisateur se connecte
    Alors la connexion aboutit quand même (le journal n'est pas bloquant)
    Et l'anomalie est signalée dans les journaux de la plateforme

  Scénario: Mode local inchangé
    Étant donné une exécution locale
    Alors le journal continue d'être écrit dans le dossier de données local
```

**DoD** : l'emplacement exact de consultation est documenté dans le README ; décision Tech Lead sur Q2 consignée.

---

### US-5 — Cohérence des écritures de comptes avec plusieurs instances (S7) — Should — 5 pts

**En tant qu'** administrateur, **je veux** que deux actions simultanées sur les comptes ne s'écrasent pas, **afin qu'** une désactivation ne soit pas annulée par une connexion concurrente.

```gherkin
Fonctionnalité: Écritures concurrentes sur les comptes
  Scénario: Désactivation non écrasée par une connexion
    Étant donné un utilisateur actif
    Quand un administrateur le désactive au même instant qu'il se connecte
    Alors à l'issue des deux opérations le compte est désactivé
    Et sa session est invalide

  Scénario: Deux créations simultanées avec le même e-mail
    Quand deux administrateurs créent en même temps un compte avec le même e-mail
    Alors un seul compte existe et l'autre demande reçoit « Cet e-mail est déjà utilisé. »

  Scénario: Dernier administrateur protégé
    Étant donné deux administrateurs actifs
    Quand chacun désactive l'autre simultanément
    Alors au moins un administrateur actif subsiste
    Et l'une des demandes reçoit « Impossible : il doit rester au moins un administrateur actif. »

  Scénario: Pas de double initialisation
    Quand deux demandes d'initialisation valides arrivent simultanément sur un déploiement vide
    Alors un seul administrateur est créé et l'autre reçoit le message « L'application est déjà initialisée. »
```

**DoD** : au moins un test de concurrence reproductible (QA) ; comportement local inchangé.

---

### US-6 — Mode local inchangé, sans service externe — Must — 2 pts

**En tant qu'** utilisateur local ou développeur, **je veux** continuer à lancer l'application avec `./data` sans rien configurer d'externe, **afin de** ne pas subir de régression.

```gherkin
Fonctionnalité: Mode local
  Scénario: Démarrage local sans variable de stockage externe
    Étant donné un poste sans aucune variable de stockage externe définie
    Quand je lance « npm run dev » puis « npm run start » après un build
    Alors l'application démarre, l'initialisation, la connexion et la gestion des comptes fonctionnent avec le dossier de données local

  Scénario: Comptes existants conservés
    Étant donné un dossier data/ contenant déjà des comptes
    Quand je lance la nouvelle version
    Alors ces comptes fonctionnent sans migration manuelle

  Scénario: Aucun accès réseau tiers en local
    Étant donné le mode local
    Quand j'utilise l'authentification
    Alors aucune connexion vers un service externe n'est tentée

  Scénario: Détection de l'environnement
    Étant donné une exécution sur Vercel
    Alors le mode « stockage externe » est utilisé et le disque local n'est jamais écrit pour les comptes
```

**DoD** : `npm run build` et `npx tsc --noEmit` passent ; vérifié sur Windows (poste du projet) ; les tests existants (`npm test`) restent verts.

---

### US-7 — Guide de déploiement Vercel — Must — 2 pts

**En tant qu'** administrateur, **je veux** un guide pas à pas pour déployer sur Vercel, **afin de** éviter les erreurs rencontrées (nom de projet refusé, variables manquantes).

```gherkin
Fonctionnalité: Documentation de déploiement
  Scénario: Nom de projet refusé par le CLI
    Étant donné un dépôt dont le nom contient des majuscules (« Bi-Advisorgeneric »)
    Quand l'administrateur lit la section « Déployer sur Vercel » du README
    Alors il y trouve la marche à suivre : `vercel link` avec un nom de projet en minuscules, sans espaces

  Scénario: Variables d'environnement listées
    Quand l'administrateur consulte le guide
    Alors il y trouve, pour chaque variable (AUTH_SECRET, SETUP_TOKEN ou ADMIN_EMAIL/ADMIN_PASSWORD, variables du stockage choisi, BI_ALLOWED_HOSTS, BI_SQLITE_DIR), son rôle, son caractère obligatoire et les environnements concernés (Preview / Production)

  Scénario: Limites explicitement annoncées
    Quand l'administrateur consulte le guide
    Alors il y lit que : le disque est éphémère (SQLite et fichiers locaux inutilisables), les bases internes doivent être joignables depuis Vercel, et la mise en production est déconseillée tant que la recette P0 n'est pas rejouée

  Scénario: Secrets jamais dans le dépôt
    Alors le guide n'affiche aucune valeur de secret réelle, seulement des exemples factices
```

**DoD** : relecture PO ; liens croisés avec les « Notes de migration » existantes.

---

### US-8 — Déploiement Preview vérifié de bout en bout — Must — 3 pts

**En tant qu'** administrateur, **je veux** la preuve qu'un déploiement Preview fonctionne réellement, **afin de** décider en confiance de la suite.

```gherkin
Fonctionnalité: Recette du déploiement Preview
  Scénario: Parcours complet sur l'URL Preview
    Étant donné un déploiement Preview avec les variables requises (accord humain préalable pour le déploiement)
    Quand un testeur initialise l'administrateur, se connecte, crée un utilisateur, se déconnecte puis se reconnecte avec ce dernier
    Alors chaque étape réussit et aucune déconnexion inattendue n'est observée sur 10 requêtes successives

  Scénario: Persistance après nouveau déploiement
    Quand un nouveau déploiement Preview est publié
    Alors les comptes précédemment créés existent toujours

  Scénario: Protection de l'initialisation
    Quand un visiteur non authentifié tente l'initialisation sans jeton sur l'URL Preview
    Alors il est refusé

  Scénario: Rapport honnête
    Alors tout élément non vérifié (ex. connexion à une vraie base cliente, appel LLM tiers) est marqué ⏳ avec sa raison, jamais déclaré ✅
```

**DoD** : preuves dans `qa-report.md` ; aucune donnée cliente réelle utilisée ; aucun déploiement sans « OK » humain explicite.

---

## 4. Hors périmètre (sprints suivants)

- **Dette de recette P0-1 à P0-4** (PostgreSQL, MySQL/MariaDB, SQL Server réels, routes LLM) et P1-1/P1-2 : **sprint recette** à planifier ; conditionne la **mise en production**.
- **S5, S6, C2, C3** de l'audit.
- Dépendances `xlsx` / `jspdf` et les 7 vulnérabilités `npm audit`.
- Reste de S9 (CSP complète), S10 (blocage `AUTH_DISABLED` en production) — à reconsidérer : US-3/US-2 durcissent déjà la configuration, mais `AUTH_DISABLED` n'est pas traité ici.
- Fichiers de données importés côté serveur et SQLite sur Vercel : non supportés (limite documentée en US-7).
- Mise en production sur Vercel (non autorisée par ce sprint).

## 5. Ordre de priorité et plan de coupe

1. US-1 → US-2 → US-3 → US-6 (cœur : un déploiement sûr et stable) ; 2. US-7 → US-8 (documentation et preuve) ; 3. US-4, US-5 si capacité. Si le sprint déborde : reporter US-5 (S7 reste un risque faible tant que le trafic d'écriture est quasi nul) puis US-4 (le journal des plateformes sert de repli provisoire) — jamais US-1/2/3.

## 6. Questions ouvertes (arbitrage Tech Lead / humain)

| # | Question | Pour |
|---|---|---|
| Q1 | **Quel stockage externe** pour comptes (et idéalement audit) ? Le PO impose seulement : persistant, partagé entre instances, utilisable depuis Vercel, avec une option gratuite ou peu coûteuse pour une PME, et sans obligation en mode local. Le choix, le coût et la gestion des identifiants sont à trancher et à documenter (ADR). | Tech Lead, puis humain (création de compte / service tiers, CLAUDE.md § 5) |
| Q2 | Où consulter le journal d'audit (stockage, journaux Vercel) ? | Tech Lead |
| Q3 | Comment détecter proprement « exécution sur Vercel » vs local, et que faire sur un autre hébergement sans disque (Docker, etc.) ? | Tech Lead |
| Q4 | Mots de passe : le coût de hachage actuel (scrypt N=32768, 64 Mo) tient-il dans les limites mémoire et durée des fonctions Vercel ? Si non, quelle exigence minimale accepte-t-on ? Le PO ne dégrade pas la sécurité du hachage sans arbitrage. | Tech Lead |
| Q5 | Faut-il ajouter une limitation de tentatives de connexion partagée entre instances (si elle existe aujourd'hui en mémoire, elle devient inefficace) ? À vérifier. | Tech Lead |
| Q6 | Fichiers sensibles (CLAUDE.md § 5) : le sprint touche `src/server/auth/**` et probablement `package.json` (dépendance du stockage) — accord humain explicite requis à chaque action. | Orchestrateur / humain |
| Q7 | L'humain souhaite-t-il que le jeton d'initialisation soit **saisi dans l'écran** (US-3, choix PO) ou que seule la création par `ADMIN_EMAIL/ADMIN_PASSWORD` soit autorisée en ligne ? Par défaut, le PO retient les deux. | Humain |

## 7. Notes d'application du workflow

- GATE 1 attendue sur ce backlog (en particulier Q7).
- Conception : Tech Lead (architecture, ADR du stockage) ∥ UX/UI (écran d'initialisation, états d'erreur de configuration uniquement).
- Aucun déploiement, aucune dépendance installée, aucune création de service tiers sans « OK » humain explicite.
