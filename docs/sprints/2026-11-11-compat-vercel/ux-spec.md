# UX Spec — Sprint `2026-11-11-compat-vercel`

- **Auteur** : UX/UI Designer · **Date** : 2026-11-11 · **Tâche orchestrateur** : #11
- **Stories couvertes** : US-3 (initialisation sécurisée, S8) et US-2 (erreur de configuration). Aucun autre écran n'est modifié.
- **Entrées lues** : `backlog.md`, `CLAUDE.md`, `src/components/auth/AuthGate.tsx`, `src/components/ui/primitives.tsx` (`Field`, `inputCls`, `Spinner`), `src/lib/auth-client.ts`.
- **Décision humaine appliquée (GATE 1, Q7)** : deux mécanismes coexistent : (a) `SETUP_TOKEN` saisi dans l'écran ; (b) `ADMIN_EMAIL` / `ADMIN_PASSWORD` (admin créé côté serveur, écran de setup jamais proposé).

## 1. Relevé de l'existant (2.1)

`AuthGate` lit `useAuth.status` (`loading | anon | setup | authed`) et rend `AuthCard` (`mode = login | setup`).

| Élément | Constat |
|---|---|
| Carte | `max-w-[400px]`, `rounded-[2rem]`, `bg-white/90`, texte `#14142b`, `colorScheme: light` **forcé** : la carte reste claire même en thème sombre ; seul le fond (halos `--glow1/--glow2`, `--bg`) suit palette et thème. Mascotte `Robot` 110 px. |
| Setup actuel | Titre « Bienvenue sur BI Advisor », sous-titre, champs Nom, E-mail, Mot de passe (aide « 10 caractères minimum… »), Confirmer, bouton « Créer le compte administrateur ». |
| Erreur | `div role="alert"` `bg-red-50 text-red-700` affichant tel quel `error` renvoyé par l'API (`call()` : `throw new Error(j.error \|\| 'Erreur')`). |
| Chargement | squelette 48 px puis bouton `disabled` + `Spinner`. |
| Écarts a11y existants (à corriger au passage, faible coût) | **A-1** bouton œil : `aria-label="Afficher"` fixe, pas d'état ; icône `text-slate-400` sur blanc (~2,6:1, sous 3:1 requis pour un composant d'interface). **A-2** pas de `aria-live` sur le chargement. **A-3** `autoFocus` sur le premier champ sans lien avec le titre (acceptable, à conserver). **A-4** libellés `text-muted` dans une carte claire forcée : à vérifier en thème sombre (le jeton `muted` peut devenir clair sur fond blanc). |
| Limite | `refreshAuth()` n'expose que `needsSetup` : il n'existe aucun état « initialisation non configurée » ni « configuration incomplète ». |

## 2. Hypothèses à aligner avec le Tech Lead

Ces points ne sont pas tranchés par l'UX ; la spec les suppose pour pouvoir maquetter.

| # | Hypothèse | À confirmer |
|---|---|---|
| H1 | `GET /api/auth/session` renvoie en plus de `needsSetup` un champ `setupMode` : `"open"` (local, sans jeton), `"token"` (jeton requis), `"disabled"` (déploiement public sans mécanisme). Quand `ADMIN_EMAIL/ADMIN_PASSWORD` ont créé l'admin, `needsSetup=false` donc écran de connexion standard. | Nom et valeurs du champ. |
| H2 | Erreur de configuration : `GET /api/auth/session` (ou le `login` / `setup`) renvoie un code stable `error: "config"` ou `"storage"` en plus d'un message ; le client choisit le texte (le serveur ne renvoie jamais de détail technique). Statut conseillé : 503. | Code et statut HTTP. |
| H3 | Jeton invalide : 403 avec le message exact du backlog « Jeton d'initialisation invalide. » ; le client l'affiche tel quel. | Message identique pour jeton absent ou faux (pas d'indication distinguant les deux). |
| H4 | Déjà initialisé : 409 « L'application est déjà initialisée. » ; le client re-appelle `refreshAuth()` et bascule sur la connexion. | Comportement de bascule. |
| H5 | L'état `status` du store gagne deux valeurs ou un champ annexe (`setupMode`, `configError`) : décision Tech Lead, l'UX n'impose que les rendus. | Forme du store. |
| H6 | Le mode « token » vs « open » ne doit pas être déduit côté client d'une variable d'environnement publique (le jeton ne doit jamais fuiter). Seul le booléen/énuméré H1 est exposé. | Conforme à US-3 « jeton jamais exposé ». |

## 3. Parcours

```
Visiteur ouvre l'URL
  └─ session ? ── erreur config/stockage (H2) ──────────► É5 Erreur de configuration (aucun formulaire)
        │
        ├─ compte(s) existant(s) ─────────────────────────► Connexion (inchangée)
        │        (inclut le cas ADMIN_EMAIL/ADMIN_PASSWORD : admin déjà créé, setup jamais proposé)
        └─ aucun compte ──┬─ setupMode = open     ───────► É1 Setup local (inchangé, sans jeton)
                          ├─ setupMode = token    ───────► É2 Setup avec jeton ──► envoi
                          │                                  ├─ OK ──► connecté, rechargement « / »
                          │                                  ├─ 403 ─► É3 Jeton invalide (reste sur É2)
                          │                                  ├─ 409 ─► É6 Déjà initialisé ► Connexion
                          │                                  └─ 5xx ─► É5 / message générique
                          └─ setupMode = disabled ───────► É4 Initialisation non configurée (aucun formulaire)
```

## 4. États et maquettes

Base commune (inchangée) : carte claire, mascotte, `h1`, sous-titre, zone de contenu, boutons `btn-grad`. Nouveaux blocs réutilisent uniquement les classes Tailwind déjà employées dans le fichier (`rounded-xl`, `bg-red-50 text-red-700`), plus un bloc « information » `bg-amber-50 text-amber-900` (équivalent des couleurs sémantiques déjà utilisées pour l'erreur). Aucun hexadécimal en dur ajouté.

### É1 — Setup local (mode local inchangé, US-3 dernier scénario)

Identique à l'écran actuel, **sans champ jeton**. Aucun changement visuel ni de copie. Critère de non-régression pour le QA.

### É2 — Setup avec jeton (déploiement public, `setupMode = token`)

```
┌──────────────────────────────────────┐
│               ( Bibo )               │
│    Bienvenue sur BI Advisor          │
│ Créez le compte administrateur pour  │
│ initialiser l'application.           │
│                                      │
│ ┌ Jeton d'initialisation ──────────┐ │  ← 1er champ, autoFocus
│ │ ••••••••••••               [👁]  │ │  type=password, autocomplete="off"
│ └──────────────────────────────────┘ │
│  Fourni par l'administrateur du      │
│  déploiement (variable SETUP_TOKEN). │
│ ┌ Nom complet ─────────────────────┐ │
│ ┌ Adresse e-mail ──────────────────┐ │
│ ┌ Mot de passe ──────────── [👁] ──┐ │
│  10 caractères minimum, avec lettres │
│  et chiffres.                        │
│ ┌ Confirmer le mot de passe ───────┐ │
│                                      │
│ [🛡 Créer le compte administrateur ] │
└──────────────────────────────────────┘
```

- Champ jeton : `Field label="Jeton d'initialisation"`, `inputCls`, `type="password"`, `required`, `autoComplete="off"`, `spellCheck={false}`, `name="setup-token"`. Le jeton est **masqué par défaut** ; le même bouton œil (état `show`) peut le révéler (réutilise l'existant, pas de nouveau composant).
- Aide sous le champ (`hint` de `Field`) : « Fourni par la personne qui a déployé l'application (variable SETUP_TOKEN). »
- Ordre de focus : jeton, nom, e-mail, mot de passe, œil, confirmation, bouton. L'ordre du DOM suit l'ordre visuel.
- Le jeton n'est jamais conservé dans le store, `localStorage`, l'URL ni les logs ; il est vidé du state après une réponse 403 (voir É3) pour éviter de le renvoyer par erreur.
- Validation côté client : mots de passe différents, message existant « Les mots de passe ne correspondent pas. » (inchangé).

### É3 — Jeton invalide (403)

```
│ ┌ Jeton d'initialisation ─── [👁] ─┐ │  ← aria-invalid="true", aria-describedby=erreur
│ ⚠ Jeton d'initialisation invalide. │  ← role="alert"
│   Vérifiez-le auprès de la personne  │
│   qui a déployé l'application.       │
```

- Message : « Jeton d'initialisation invalide. » (texte exact du backlog) suivi de l'aide « Vérifiez-le auprès de la personne qui a déployé l'application. »
- Le message est identique que le jeton soit absent, vide ou faux (aucune information sur le jeton, cf. H3).
- Les autres champs **conservent leur valeur** (sauf mots de passe : conservés aussi, aucun intérêt à les ressaisir). Seul le champ jeton est vidé, et reçoit le focus.
- Bouton ré-activé (`busy=false`). L'erreur disparaît dès la prochaine frappe (comportement `set()` existant).
- Aucune limitation visible de tentatives n'est promise par l'UI (Q5 non tranchée). Si le serveur renvoie 429 : « Trop de tentatives. Réessayez dans quelques minutes. » (copie proposée, à aligner).

### É4 — Initialisation non configurée (déploiement public sans mécanisme, `setupMode = disabled`)

```
┌──────────────────────────────────────┐
│               ( Bibo )               │
│    Initialisation non configurée     │  ← h1
│ ┌──────────────────────────────────┐ │
│ │ ⓘ L'administrateur doit définir  │ │  role="status" (statique, pas d'alerte)
│ │ SETUP_TOKEN ou ADMIN_EMAIL /     │ │
│ │ ADMIN_PASSWORD pour ce           │ │
│ │ déploiement.                     │ │
│ └──────────────────────────────────┘ │
│  Si vous n'êtes pas l'administrateur,│
│  contactez-le : l'application ne     │
│  peut pas être utilisée tant que ce  │
│  réglage n'est pas fait.             │
│  [ Vérifier à nouveau ]              │  ← bouton secondaire : refreshAuth()
└──────────────────────────────────────┘
```

- **Aucun formulaire, aucun champ.** Titre `h1` « Initialisation non configurée. »
- Texte principal : le message du backlog est conservé intégralement : « Initialisation non configurée. L'administrateur doit définir SETUP_TOKEN ou ADMIN_EMAIL / ADMIN_PASSWORD. » (le titre porte la première phrase, le bloc la seconde). Les noms de variables sont des noms de réglage, pas des valeurs : autorisés.
- Bouton « Vérifier à nouveau » : relance `refreshAuth()` (utile après que l'administrateur a configuré et redéployé). `type="button"`, style secondaire : `rounded-full border border-line` (même gabarit que `btn-grad`, h-12). Pendant l'appel : `Spinner` + `aria-busy`, texte « Vérification… ».
- Mascotte : `Robot` identique, `aria-hidden` (décorative).
- Ne pas afficher de lien vers une documentation externe (pas de détail technique inutile pour un utilisateur métier).

### É5 — Erreur de configuration / stockage indisponible (US-2, US-1)

Deux variantes, même gabarit : mascotte, `h1`, bloc d'erreur `role="alert"`, bouton « Réessayer ». **Aucun formulaire de connexion ni de setup n'est affiché** (il ne pourrait pas aboutir).

```
┌──────────────────────────────────────┐
│               ( Bibo )               │
│        Connexion impossible          │  ← h1
│ ┌──────────────────────────────────┐ │
│ │ ⚠ Configuration incomplète :     │ │  role="alert"
│ │ AUTH_SECRET est requis.          │ │  bg-red-50 text-red-700
│ │ Contactez l'administrateur.      │ │
│ └──────────────────────────────────┘ │
│  [ Réessayer ]                       │
└──────────────────────────────────────┘
```

| Variante | Condition (H2) | `h1` | Message (exact) |
|---|---|---|---|
| 5a Configuration | `AUTH_SECRET` absent ou < 16 caractères | « Connexion impossible » | « Configuration incomplète : AUTH_SECRET est requis. Contactez l'administrateur. » |
| 5b Stockage | stockage des comptes injoignable | « Connexion impossible » | « Service d'authentification momentanément indisponible. Réessayez dans un instant. » |

- Les deux messages viennent du backlog (US-1, US-2), reproduits à l'identique. Le nom `AUTH_SECRET` est un nom de variable, pas une valeur.
- **Jamais affiché** : valeur de secret, longueur attendue ou actuelle, hôte, chaîne de connexion, nom de fournisseur de stockage, chemin serveur, trace. Si le serveur renvoie un texte inattendu, le client affiche le message générique 5b plutôt qu'un texte brut inconnu (recommandation : lister côté client les seuls codes connus).
- « Réessayer » : relance `refreshAuth()`. En 5a, l'utilisateur final ne peut rien corriger : le message désigne l'administrateur (« Contactez l'administrateur »). Le bouton reste pour le cas de redéploiement.
- Si l'erreur survient **lors de l'envoi** du formulaire de connexion (et non au chargement), elle s'affiche dans le bloc `role="alert"` habituel au-dessus du bouton, sans remplacer le formulaire (l'utilisateur garde sa saisie).

### É6 — Déjà initialisé (409)

Pas d'écran dédié : le client ré-appelle `refreshAuth()` et affiche l'écran de connexion, avec un toast `sonner` (info) : « L'application est déjà initialisée. Connectez-vous avec votre compte. » Si la bascule échoue, message `role="alert"` identique à É3 avec le texte « L'application est déjà initialisée. »

### É7 — Chargement et mode « admin par variables d'environnement »

- Chargement initial : squelette actuel, ajouter `role="status"` et `aria-label="Chargement"` sur le conteneur (A-2).
- Cas (b) `ADMIN_EMAIL/ADMIN_PASSWORD` : aucun écran spécifique ; l'application affiche l'écran de **connexion** standard. Pas de mention des variables dans l'interface (ne pas révéler le mécanisme à un visiteur anonyme).

### Récapitulatif des micro-copies (français, vouvoiement)

| Clé | Texte |
|---|---|
| Libellé jeton | Jeton d'initialisation |
| Aide jeton | Fourni par la personne qui a déployé l'application (variable SETUP_TOKEN). |
| Erreur jeton | Jeton d'initialisation invalide. Vérifiez-le auprès de la personne qui a déployé l'application. |
| Titre É4 | Initialisation non configurée |
| Corps É4 | L'administrateur doit définir SETUP_TOKEN ou ADMIN_EMAIL / ADMIN_PASSWORD pour ce déploiement. |
| Aide É4 | Si vous n'êtes pas l'administrateur, contactez-le : l'application ne peut pas être utilisée tant que ce réglage n'est pas fait. |
| Bouton É4 | Vérifier à nouveau / Vérification… |
| Titre É5 | Connexion impossible |
| Erreur 5a | Configuration incomplète : AUTH_SECRET est requis. Contactez l'administrateur. |
| Erreur 5b | Service d'authentification momentanément indisponible. Réessayez dans un instant. |
| Bouton É5 | Réessayer |
| Déjà initialisé | L'application est déjà initialisée. Connectez-vous avec votre compte. |
| Trop de tentatives (proposé) | Trop de tentatives. Réessayez dans quelques minutes. |
| Bouton œil | Afficher le mot de passe / Masquer le mot de passe (jeton : Afficher le jeton / Masquer le jeton) |

## 5. Composants et design system

- **Réutilisés** : `Field` (avec `hint`), `inputCls`, `Spinner`, `Robot`, `btn-grad`, bloc d'erreur existant. **Aucune nouvelle primitive, aucun nouveau token, aucune modification de palette** : pas de ⚠️ VALIDATION HUMAINE REQUISE pour le design system.
- **Nouveaux blocs locaux à `AuthGate.tsx`** (pas dans `primitives.tsx`) : bloc d'information É4 (`rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900`), bouton secondaire « Vérifier à nouveau / Réessayer » (bordure `border-line`). Si le Dev préfère les factoriser, ce serait une décision de design system à faire valider.
- **Palettes / thèmes** : la carte étant forcée en clair, ses couleurs internes sont identiques dans les 5 palettes et les 2 thèmes ; seul le fond (`--glow1`, `--glow2`, `--bg`) varie. Le texte de la carte ne dépend donc pas du thème, à condition de ne **pas** utiliser `text-fg`/`text-muted` (jetons dépendants du thème) sur la carte sans vérifier A-4. Recommandation : sur la carte, utiliser `text-slate-600` minimum pour les textes d'aide (≥ 4,5:1 sur blanc) en lieu et place de `text-muted` si le contraste mesuré est insuffisant.
- **Responsive** : carte `w-full max-w-[400px]`, `p-8` ; à 360 px de large la carte occupe la largeur moins `p-4` (16 px de gouttière), sans défilement horizontal. Les messages longs (É4/É5) passent à la ligne (`break-words`). Mascotte réductible à 90 px sous 360 px de hauteur utile (clavier mobile ouvert) : la carte défile verticalement, rien n'est tronqué.
- **Animations** : aucune ajoutée ; si une entrée de l'erreur est animée (`framer-motion`), respecter `prefers-reduced-motion`.

## 6. Exigences d'accessibilité vérifiables (WCAG 2.1 AA)

| Réf | Exigence | Vérification |
|---|---|---|
| AC-1 | Chaque champ (dont jeton) a un libellé visible associé (`<label>` englobant via `Field`). | Inspecteur d'accessibilité : nom accessible non vide. |
| AC-2 | Texte ≥ 4,5:1 et éléments d'interface ≥ 3:1, dans les 5 palettes × 2 thèmes (la carte reste claire : à vérifier une fois en clair et une fois en sombre pour A-4). Erreur : `text-red-700` sur `bg-red-50` ≥ 4,5:1 ; info : `text-amber-900` sur `bg-amber-50` ≥ 4,5:1 ; aide : ≥ 4,5:1 ; icône œil ≥ 3:1 (remplacer `text-slate-400` par `text-slate-600`). | Mesure DevTools / audit Lighthouse. |
| AC-3 | Erreurs de saisie (403 jeton, mots de passe différents) dans un conteneur `role="alert"` ; le champ concerné porte `aria-invalid="true"` et `aria-describedby` pointant l'erreur. Le focus est replacé sur le champ jeton après un 403. | Lecteur d'écran / inspection DOM. |
| AC-4 | É4 (état informatif) : `role="status"` ; É5 (erreur) : `role="alert"`. Un seul rôle live par écran. | Inspection DOM. |
| AC-5 | Bouton œil : `aria-label` dynamique (« Afficher / Masquer le mot de passe » ou « …le jeton »), `aria-pressed` reflète l'état ; atteignable au clavier, focus visible. | Clavier + inspection. |
| AC-6 | Navigation clavier complète sans piège ; ordre de focus = ordre visuel (jeton, nom, e-mail, mot de passe, œil, confirmation, bouton). Entrée dans un champ soumet le formulaire. | Parcours Tab / Maj+Tab. |
| AC-7 | Focus visible sur tous les contrôles (anneau `focus:ring-brand-violet/20` seul est faible : ajouter un contour ≥ 3:1 via `focus-visible:outline` ou `focus:border-brand-violet` déjà présent, vérifié ≥ 3:1 sur blanc). Bouton `btn-grad` : indicateur de focus visible. | Capture avec focus. |
| AC-8 | À l'ouverture : `h1` unique par écran, `lang="fr"`, titre de page cohérent ; mascotte `aria-hidden` ou `alt` vide. | Inspection. |
| AC-9 | Le jeton : `type="password"`, `autocomplete="off"`, valeur absente de l'URL, de `localStorage`, `sessionStorage`, du store et des réponses d'erreur (vérifiable par recherche de la valeur dans ces zones). | DevTools Application / Réseau. |
| AC-10 | Aucun message ne contient de valeur de secret, d'hôte, de chemin ni de trace (comparer le DOM aux textes exacts de la § 4). | Capture + recherche DOM. |
| AC-11 | Bouton en cours d'envoi : `disabled` + `aria-busy="true"`, libellé inchangé ou « Création en cours… » ; pas de double soumission. | Double clic. |
| AC-12 | Mobile 360 px : aucun défilement horizontal, cibles tactiles ≥ 44 px de haut (boutons h-12 ; icône œil : zone cliquable ≥ 32 px recommandée), zoom 200 % sans perte d'info. | Émulation 360 px, zoom 200 %. |
| AC-13 | `prefers-reduced-motion` : aucune animation non essentielle (spinner autorisé). | Émulation du média. |

## 7. Critères de recette visuelle (2.3)

Le QA/UX recette contrôle, pour chaque état (É1 à É5), en clair **et** en sombre, sur au moins **aurora** et **graphite** (échantillon des 5 palettes, extrêmes de luminosité des halos), puis une passe sur les 3 autres palettes pour É2 et É5 :

1. **Captures** à 1280 px et 360 px de chaque état ; comparaison aux maquettes § 4 et aux textes exacts de la § 4 (copier-coller).
2. **É1** : strictement identique à l'écran actuel, sans champ jeton (non-régression, mode local).
3. **É2/É3** : jeton masqué, aide visible, 403 → message exact, focus sur le champ jeton, champs conservés sauf jeton.
4. **É4** : aucun `<form>`, aucun `<input>` dans le DOM ; bouton « Vérifier à nouveau » fonctionnel.
5. **É5** : aucun formulaire ; 5a et 5b affichent exactement leur message ; aucune fuite (AC-10).
6. **Audit a11y** (Chrome DevTools MCP / Lighthouse) : score a11y de l'écran sans régression, 0 erreur de contraste, AC-1 à AC-13 cochés ; résultat consigné dans `ux-review.md`.
7. **Clavier seul** : parcours complet de É2 jusqu'à l'envoi.
8. Verdict : Conforme si aucun écart de gravité haute (texte inexact, fuite d'information, formulaire visible en É4/É5, contraste < 4,5:1) ; sinon Non conforme.

## 8. Points hors périmètre signalés

- Écran de connexion : seul l'affichage d'un message d'erreur de configuration (É5) est spécifié ; aucune autre modification.
- Correctifs a11y A-1 (œil) et A-4 (`text-muted` sur carte claire) concernent le code existant : proposés ici car l'écran est retouché ; à retirer du périmètre Dev si l'orchestrateur le juge hors sujet.
- Limitation de tentatives (Q5) : copie 429 fournie à titre conditionnel.
