# Recette UX — Sprint `2026-11-11-compat-vercel`

- **Auteur** : UX/UI Designer · **Date** : 2026-11-12 · **Tâche orchestrateur** : #2
- **Référence** : `ux-spec.md` § 4 (É1 à É7), § 6 (AC-1 à AC-13), § 7 (critères de recette).
- **Code recetté** : `src/components/auth/AuthGate.tsx`, `src/lib/auth-client.ts` (état du dépôt au 2026-11-12).
- **Méthode** : lecture statique du code (tous les écrans) + passage navigateur partiel (Chrome DevTools MCP) sur É2 avec
  `BI_DATA_DIR` temporaire, `AUTH_SECRET` et `SETUP_TOKEN` factices, port 3100. Serveur arrêté et dossier temporaire supprimé
  en fin de recette ; `data/` non touché.
- **Limite du passage navigateur** : après la première capture, le serveur de développement a renvoyé des 500
  (`ENOENT .next/routes-manifest.json`, problème d'environnement du cache `.next`, sans lien avec le code recetté).
  Les parcours dynamiques (403 jeton, 409, 429, 5a/5b, 360 px, clavier de bout en bout) n'ont donc **pas** pu être rejoués :
  ils sont jugés sur le code et marqués « statique ». À rejouer par le QA avec `npm run dev` ou `next build && next start`.

## Verdict global : NON CONFORME

Un écart de gravité **haute** (UX-1) : en thème sombre, le texte saisi, le curseur et l'icône œil des champs sont
illisibles (contraste 1,15:1 et 2,07:1), sur les écrans É1, É2 et la connexion. Le texte et les parcours spécifiés
sont par ailleurs conformes. Après correction d'UX-1 (une ligne de classes Tailwind), une revue courte suffit.

## 1. Écarts

| Réf | Gravité | Écran / AC | Constat (preuve) | Correction attendue |
|---|---|---|---|---|
| **UX-1** | **Haute** | É1, É2, É3, connexion · AC-2 · A-4 | En thème sombre, la carte reste claire (texte `#14142b`) mais `inputCls` impose `bg-surface2` = `rgb(31 33 58)`. Mesuré dans le navigateur : texte saisi `rgb(20 20 43)` sur `rgb(31 33 58)` = **1,15:1** ; icône œil `rgb(71 85 105)` sur ce fond = **2,07:1** (< 3:1) ; curseur et placeholder invisibles. Capture : `scratchpad/e2-dark2.png`. Le correctif A-4 n'a traité que `.text-muted`, pas le fond des champs. Écart déjà présent avant le sprint, mais l'écran est retouché et AC-2 impose le contrôle en sombre. | Sur `CARD` (AuthGate.tsx:24), forcer le fond des champs en clair, par exemple `[&_input]:bg-slate-50 [&_input]:text-[#14142b]` (aucun hexadécimal nouveau hors `#14142b` existant). Vérifier ensuite : texte ≥ 4,5:1, œil ≥ 3:1, bordure de champ visible, en clair et en sombre. |
| UX-2 | Moyenne | É2 · AC-1 | `Field` enveloppe le champ **et** le bouton œil dans un `<label>`. Nom accessible mesuré du champ jeton : « Jeton d'initialisation Afficher le jeton Fourni par la personne qui a déployé l'application (variable SETUP_TOKEN). » Même pollution sur « Mot de passe » (nom : « Mot de passe Afficher le mot de passe 10 caractères minimum… »). Un lecteur d'écran lit tout cela à chaque entrée dans le champ. | Donner un `aria-label` court aux champs concernés (« Jeton d'initialisation », « Mot de passe ») et relier l'aide par `aria-describedby`. Ne pas modifier `Field` (primitive partagée) ; si la factorisation est préférée, c'est une décision de design system à valider. |
| UX-3 | Moyenne | É2, É1, connexion · AC-2 | Sous-titre en `text-slate-500` (`rgb(100 116 139)`) : 4,76:1 sur blanc pur, mais la carte est `bg-white/90` sur fond teinté ; en sombre elle est grise (≈ `rgb(232 232 234)`) et le rapport tombe à environ **3,9:1** (estimé d'après la capture). Texte déjà présent avant le sprint, non repris par A-4. | Passer le sous-titre en `text-slate-600` (≥ 7:1). |
| UX-4 | Mineure | É4, É5 · AC-2/AC-7 | Le bouton secondaire « Réessayer » / « Vérifier à nouveau » a une bordure `border-line` (`rgb(227 229 245)`) sur carte blanche : **1,25:1**. Le libellé identifie le bouton, mais la forme n'est pas perceptible (WCAG 1.4.11). | Bordure `border-slate-500` (≥ 3:1), ou fond `bg-slate-50` avec bordure plus marquée. |
| UX-5 | Mineure | É4, É5 | Si la nouvelle tentative échoue encore, rien n'est annoncé : le bouton repasse de « Vérification… » à son libellé, le bloc `role="alert"` ne change pas et n'est donc pas relu. Un utilisateur de lecteur d'écran ne sait pas que la vérification a eu lieu. | Après `refreshAuth()`, afficher une courte phrase `aria-live="polite"` (« Toujours indisponible. Réessayez dans un instant. ») ou re-déclencher l'alerte. Facultatif si l'orchestrateur le juge hors périmètre. |
| UX-6 | Mineure (hors périmètre) | Tous · AC-13 | Aucune règle `prefers-reduced-motion` dans `globals.css` : le `skeleton` (shimmer infini) et les transitions `btn-grad` ne s'adaptent pas. Spinner autorisé par la spec ; shimmer non essentiel. Existant global, non introduit par le sprint. | Ticket distinct : bloc `@media (prefers-reduced-motion: reduce)` dans `globals.css` (décision design system, validation humaine). |

## 2. Statut par écran

| Écran | Statut | Détail |
|---|---|---|
| É1 Setup local | **Écart** (UX-1, UX-3) | Pas de champ jeton quand `setupMode='open'` (`withToken` faux) : structure identique à l'existant. Changement visuel attendu : œil `text-slate-600`, libellés `text-slate-600`. Les écarts UX-1/UX-3 sont ceux de l'écran historique. Note : le focus initial reste sur « Adresse e-mail » (au-dessus : « Nom complet »), comme avant le sprint ; hors périmètre. |
| É2 Setup avec jeton | **Écart** (UX-1, UX-2) | Vérifié navigateur : champ jeton en premier, `type=password`, `name=setup-token`, `autocomplete=off`, focus initial sur le jeton, aide exacte, bouton œil dynamique 32 px, textes exacts. Ordre de focus mesuré : jeton, œil du jeton, nom, e-mail, mot de passe, œil, confirmation, bouton. |
| É3 Jeton invalide | **Conforme** (statique) | `setup_token_invalid` : message `AUTH_TEXT` exact « Jeton d'initialisation invalide. Vérifiez-le auprès de la personne qui a déployé l'application. » dans `#auth-error` `role="alert"` ; champ jeton `aria-invalid` + `aria-describedby`, vidé, focus replacé ; autres champs conservés ; message effacé à la frappe ; bouton réactivé. Non rejoué (serveur 500). |
| É4 Initialisation non configurée | **Conforme** (statique) sous réserve d'UX-4 | `Shell` en `div` : aucun `<form>`, aucun `<input>`. `h1` « Initialisation non configurée », bloc `role="status"` `bg-amber-50 text-amber-900` (8,8:1), phrase d'aide, bouton « Vérifier à nouveau » / « Vérification… » (`aria-busy`, `type="button"`), mascotte `aria-hidden`. Textes identiques à la spec. |
| É5 Erreur de configuration | **Conforme** (statique) sous réserve d'UX-4/UX-5 | 5a et 5b : `h1` « Connexion impossible », `role="alert"` `bg-red-50 text-red-700` (≈ 5,9:1), aucun formulaire, bouton « Réessayer ». Textes `AUTH_TEXT.config` / `AUTH_TEXT.storage` exacts. Un code inconnu retombe sur 5b (`toAuthError`) : aucune fuite de texte serveur inattendu. Aucune valeur, hôte, chemin ni trace dans les chaînes. |
| É6 Déjà initialisé | **Conforme** (statique) | `already_initialized` : toast `sonner` « L'application est déjà initialisée. Connectez-vous avec votre compte. » (région `polite` présente dans le layout), `refreshAuth()`, bascule vers la connexion (`key="login"`) ; repli `role="alert"` « L'application est déjà initialisée. » si la bascule échoue. |
| É7 Chargement / admin par variables | **Conforme** | Conteneur `role="status" aria-label="Chargement"` (A-2). Cas `ADMIN_*` : écran de connexion standard, aucune mention des variables. |
| Erreur de connexion 429 / 503 | **Conforme** (statique) | 429 : « Trop de tentatives. Réessayez dans quelques minutes. » dans l'alerte du formulaire, saisie conservée. 503/stockage : 5b au chargement ; en envoi, `AUTH_TEXT.storage` dans l'alerte sans remplacer le formulaire. |

## 3. Micro-copies (ux-spec § 4, récapitulatif)

| Clé | Statut |
|---|---|
| Libellé jeton, aide jeton | Conforme (navigateur) |
| Erreur jeton | Conforme |
| Titre, corps, aide, bouton É4 (dont « Vérification… ») | Conforme |
| Titre É5, erreurs 5a et 5b, bouton « Réessayer » | Conforme |
| Déjà initialisé (toast et repli) | Conforme |
| Trop de tentatives | Conforme |
| Bouton œil : « Afficher/Masquer le mot de passe », « …le jeton » | Conforme (navigateur : « Afficher le jeton », « Afficher le mot de passe ») |
| Message d'initialisation désactivée renvoyé par un POST (`setup_disabled`) | Conforme au backlog (« Initialisation non configurée. L'administrateur doit définir SETUP_TOKEN ou ADMIN_EMAIL / ADMIN_PASSWORD. ») |

Aucun texte inexact, aucune fuite d'information.

## 4. Exigences d'accessibilité (AC)

| AC | Statut | Note |
|---|---|---|
| AC-1 libellés | Écart partiel | Libellés visibles et associés, mais noms accessibles pollués (UX-2). |
| AC-2 contraste | **Non conforme** | UX-1 (sombre), UX-3, UX-4. Erreur/info/aide en clair : conformes (aide `slate-600` 7,6:1). |
| AC-3 erreurs/focus | Conforme (statique) | `aria-invalid`, `aria-describedby="auth-error"`, focus sur le jeton après 403. |
| AC-4 un seul rôle live | Conforme | É4 `status`, É5 `alert` ; le toaster est global. |
| AC-5 œil | Conforme (navigateur) | `aria-label` dynamique, `aria-pressed`, 32 × 32 px, `focus-visible` outline. |
| AC-6 clavier | Conforme avec évolution acceptée | Un arrêt de tabulation s'ajoute (œil du jeton, après le jeton). Accepté (code-review § 10) : l'œil est nécessaire pour révéler le jeton au clavier. Mettre à jour AC-6 dans la spec. |
| AC-7 focus visible | Conforme | Contour `brand-violet` sur blanc : aurora 3,82:1, émeraude 3,29:1, océan 4,47:1, coucher de soleil 3,93:1, graphite 5,78:1 (tous ≥ 3:1). Champs : bordure violet sur fond clair ≥ 3,0:1 (émeraude, limite). |
| AC-8 structure | Conforme | `lang="fr"`, un `h1` par écran, mascotte `aria-hidden`. |
| AC-9 jeton | Conforme (statique) | État React local, jamais dans le store ; corps POST uniquement ; `autocomplete="off"`, `spellCheck=false`, masqué par défaut. Recherche de la valeur dans `localStorage` : aucune occurrence (parcours d'envoi non abouti, à rejouer par le QA). |
| AC-10 pas de fuite | Conforme | Textes issus de listes fermées (`AUTH_TEXT`, `SERVER_TEXT`) ; repli 5b sinon. |
| AC-11 envoi | Conforme (statique) | `disabled` + `aria-busy`, libellé inchangé, pas de double soumission. |
| AC-12 mobile 360 px | Conforme (statique) | `w-full max-w-[400px]`, `p-4` extérieur, `break-words`, `overflow-hidden` ; à confirmer à 360 px et zoom 200 %. |
| AC-13 réduction de mouvement | Non vérifié sur ce périmètre | Aucune animation ajoutée par le sprint ; voir UX-6 (existant global). |

## 5. Palettes et thèmes

La carte étant forcée en clair, le contenu textuel est identique dans les 5 palettes ; seul le fond change. Les contrastes de
focus ont été calculés pour les 5 palettes (AC-7). Le thème sombre n'est pas conforme à cause d'UX-1. Le thème clair
(aurora) a été inspecté : conforme hors UX-3. Pas de passage visuel sur émeraude, océan, coucher de soleil, graphite (serveur indisponible).

## 6. À rejouer par le QA après correction

1. UX-1 : contraste du texte saisi et de l'œil en sombre sur aurora et graphite ; capture à 1280 et 360 px.
2. É3 : envoi avec jeton faux, observation du `role="alert"`, du focus et des champs conservés ; jeton absent de `localStorage`.
3. É4/É5 : DOM sans `<form>`/`<input>`, textes exacts, bouton fonctionnel (config : `SETUP_TOKEN` absent en mode hébergé ; `AUTH_SECRET` absent).
4. Parcours clavier É2 jusqu'à l'envoi (ordre mesuré ci-dessus).

## 7. Conclusion

Textes, états et logique conformes à la spec. Verdict **Non conforme** pour un seul motif bloquant (UX-1, contraste en sombre sur les champs).
Corrections demandées au Dev : UX-1 (obligatoire), UX-2 et UX-3 (même boucle, faible coût), UX-4 et UX-5 (souhaitées). UX-6 : ticket séparé.
Aucune nouvelle primitive, aucun nouveau token : pas de validation de design system requise, sauf si UX-6 est pris en charge.

---

# Recette courte — itération 2 (2026-11-16)

- **Auteur** : UX/UI Designer · **Tâche orchestrateur** : #16 · **Objet** : lever ou confirmer la réserve R3 de `validation-po.md`
  (corrections UX-1 à UX-5 et BUG-1 de `src/components/auth/AuthGate.tsx`).
- **Méthode** : navigateur réel (Chrome DevTools MCP) sur le serveur `next dev` existant (http://localhost:3000), thème sombre forcé
  (`data-theme="dark"`), palettes **aurora** et **graphite**, 1280 px et 360 px (émulation mobile, scrollWidth = 360). Aucun compte réel utilisé
  pour la saisie (valeurs fictives) ; `data/` et `.env*` non touchés ; aucun mot de passe consigné.
- **États d'erreur** (É3, É4, É5) : réponses de `/api/auth/me` et `/api/auth/setup` **simulées côté navigateur** (surcharge de `fetch` injectée
  avant chargement de la page ; le serveur n'est pas modifié). Le code testé est le vrai code de l'application.
- **Captures** (dossier `C:\Users\TOKYRA~1\AppData\Local\Temp\claude\e2df9c337914279f\5123eec3-dbdd-479b-876f-31545d2d52d4\scratchpad\ux-recette\`) :
  - `it2-aurora-dark-1280.png` : connexion, aurora, sombre, 1280 px, champs remplis, mot de passe révélé ;
  - `it2-graphite-dark-360.png` : connexion, graphite, sombre, 360 px ;
  - `it2-e3-token-invalide-aurora-dark-360.png` : É3, jeton refusé, aurora, sombre, 360 px ;
  - `it2-e4-non-configure-graphite-dark-360.png` : É4 après « Vérifier à nouveau », graphite, sombre, 360 px ;
  - `it2-e5-config-aurora-dark-360.png` : É5a, aurora, sombre, 360 px.

## Verdict : CONFORME (réserve R3 levée)

Tous les points UX-1 à UX-5 sont corrigés et vérifiés en navigateur. Aucun écart bloquant. Deux observations mineures hors périmètre en § 4.

## 1. Statut par point

| Réf | Statut | Preuve |
|---|---|---|
| **UX-1** contraste des champs en sombre | **Corrigé** | Mesuré (aurora et graphite, identiques car la carte est forcée en clair) : texte saisi `rgb(20 20 43)` sur `rgb(248 250 252)` = **17,23:1** (avant : 1,15:1) ; icône œil `rgb(71 85 105)` sur le même fond = **7,24:1** (avant : 2,07:1) ; curseur `rgb(20 20 43)` (visible, avant invisible). Bordure de champ `rgb(100 116 139)` sur la carte effective `rgb(231 231 232)` = **3,85:1** (≥ 3:1, WCAG 1.4.11). Texte et œil lisibles sur les captures 1280 px et 360 px. |
| **UX-2** nom accessible des champs | **Corrigé** | Arbre d'accessibilité : « Jeton d'initialisation » et « Mot de passe » (noms courts, sans le texte du bouton œil ni de l'aide). Aide reliée par `aria-describedby` (`auth-token-hint`, `auth-password-hint`). |
| **UX-3** sous-titre | **Corrigé** | Couleur `rgb(71 85 105)` (slate-600) : **6,13:1** sur la carte effective en sombre (avant ≈ 3,9:1). Libellés de champs identiques (`rgb(71 85 105)`). |
| **UX-4** bordure du bouton secondaire | **Corrigé** | « Vérifier à nouveau » / « Réessayer » : bordure `rgb(100 116 139)` = **3,85:1** sur la carte (avant 1,25:1). |
| **UX-5** annonce après nouvelle tentative | **Corrigé** | Région `<p aria-live="polite">` présente et vide au départ. Après un clic alors que l'état ne change pas (réponse simulée identique), la région est vidée puis remplie : « Toujours indisponible. Réessayez dans un instant. » (relevé par `MutationObserver`, É4 et É5). Le composant reste monté (le titre ne change pas). |
| **BUG-1** (AuthGate) | **Corrigé** (vu par É3 / É4 / É5) | Voir § 2 : aucun écart sur les états concernés. |

## 2. États É3 à É5 (navigateur, sombre, 360 px)

| Écran | Statut | Détail mesuré |
|---|---|---|
| É2 Setup avec jeton | Conforme | `h1` « Bienvenue sur BI Advisor » ; focus initial sur le jeton ; `type=password`, `autocomplete=off` ; aide exacte. Ordre de tabulation : jeton, œil du jeton, nom, e-mail, mot de passe, œil, confirmation, bouton (identique à la recette précédente, évolution déjà acceptée). |
| É3 Jeton invalide (403) | Conforme | Message exact « Jeton d'initialisation invalide. Vérifiez-le auprès de la personne qui a déployé l'application. » dans `#auth-error` `role="alert"` (rouge sur rose : **5,91:1**) ; champ jeton `aria-invalid="true"`, `aria-describedby="auth-token-hint auth-error"`, vidé, **focus replacé dessus** ; nom et e-mail conservés ; bouton réactivé ; message et `aria-invalid` effacés dès la frappe suivante ; jeton absent de `localStorage` / `sessionStorage` ; un seul POST envoyé. |
| É4 Initialisation non configurée | Conforme | `h1` « Initialisation non configurée » ; **0 `<form>`, 0 `<input>`** ; bloc `role="status"` ambre (**8,75:1**) ; textes exacts ; bouton « Vérifier à nouveau » (`aria-busy`). |
| É5a Configuration incomplète | Conforme | `h1` « Connexion impossible » ; 0 formulaire, 0 champ ; `role="alert"` « Configuration incomplète : AUTH_SECRET est requis. Contactez l'administrateur. » (**5,91:1**) ; bouton « Réessayer » ; contour de focus `solid 1,6 px rgb(139 108 240)` (visible). |
| É5b Stockage indisponible | **Vérifié par lecture du code** | Même composant `ErrorCard` (`kind='storage'`), texte `AUTH_TEXT.storage` ; tout code inconnu ou réponse non OK retombe sur 5b (`auth-client.ts` l. 62-63, `toAuthError`). Non rejoué en navigateur (seul 5a simulé). |
| Responsive 360 px | Conforme | `scrollWidth` = `innerWidth` = 360 sur connexion, É3, É4, É5 ; carte de 328 px (marges 16 px) ; pas de défilement horizontal. |

## 3. Ratios de contraste mesurés (thème sombre)

| Élément | Avant (recette 2026-11-12) | Après |
|---|---|---|
| Texte saisi / fond du champ | 1,15:1 | **17,23:1** |
| Icône œil / fond du champ | 2,07:1 | **7,24:1** |
| Sous-titre / carte | ≈ 3,9:1 | **6,13:1** |
| Bordure de champ ou de bouton / carte | 1,25:1 (bouton) | **3,85:1** |
| Message d'erreur (rouge) | ≈ 5,9:1 | **5,91:1** |
| Message d'information (ambre) | 8,8:1 | **8,75:1** |

Mesure faite sur aurora et graphite : valeurs identiques, car la carte est forcée en clair (`colorScheme: light`) ; seul le fond de page change. Les trois autres palettes
(émeraude, océan, coucher de soleil) n'ont pas été rejouées visuellement ; elles ne modifient que le fond de page, derrière une carte opaque à 90 %.

## 4. Observations (hors périmètre, non bloquantes)

1. **Bouton « Se connecter » / « Créer le compte »** (`btn-grad`, texte blanc gras 14 px) : sur la palette graphite, le haut du dégradé est clair (capture 360 px) ; le contraste du texte blanc n'est pas conforme à l'œil sur cette zone.
   Non mesuré précisément, composant global existant, non retouché par le sprint. À instruire dans un ticket de design system (**⚠️ VALIDATION HUMAINE REQUISE** si un token ou une classe de bouton change).
2. **UX-6 (reduced motion)** : inchangé, toujours hors sprint (ticket séparé).

## 5. Conclusion et relais

UX-1 à UX-5 : **corrigés, preuves ci-dessus**. États É3, É4, É5a vérifiés en navigateur ; É5b par lecture du code (explicite). Aucun nouvel écart UX-n à ouvrir pour le Dev.
**Verdict : Conforme.** La réserve R3 de `validation-po.md` peut être levée côté UX. Aucune nouvelle primitive ni aucun nouveau token : pas de validation de design system requise pour ce périmètre.
