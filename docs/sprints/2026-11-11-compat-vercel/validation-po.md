# Validation fonctionnelle PO — Sprint `2026-11-11-compat-vercel`

- **Auteur** : Product Owner · **Date** : 2026-11-16 · **Tâche orchestrateur** : #1
- **Entrées relues** : `backlog.md`, `qa-report.md` (GO sur le périmètre local), `ux-recette.md`, `code-review.md` (itération 3 : UX-1 à UX-5 et BUG-1 corrigés, avec preuve), `dev-notes.md`, `architecture.md`.

## 1. Décision globale

**ACCEPTÉ AVEC RÉSERVES, sur le périmètre local uniquement.**

- Le cœur du sprint (US-1, US-2, US-3, US-6) est fonctionnellement livré et prouvé en local ou avec pool/instances simulés : 649 tests, `tsc` et `build` OK, aucun invariant de sécurité dégradé, aucun bug Bloquant ou Majeur ouvert.
- Ce sprint **ne démontre pas** qu'un déploiement Vercel réel fonctionne : TS-9 (Postgres réel), TS-13 (Preview) et donc **US-8 ne sont pas prouvés**. Je ne les déclare pas acceptés.
- **La mise en production reste interdite** (dette de recette P0 du sprint `2026-11-10-securite-p0` non rejouée). Tout déploiement exige un « OK » humain explicite (CLAUDE.md § 5).

## 2. Verdict par story

| Story | Pts | Verdict | Justification (preuves QA) |
|---|---|---|---|
| US-1 Comptes persistants et partagés | 8 | ✅ **Acceptée avec réserve** | Persistance locale, hachage salé, 503 au message exact sans fuite (hôte, mot de passe), session par compte : ✅ (TS-11, `auth-gherkin-gaps`, `auth-postgres-backend`). **Réserve R1** : « partagé entre instances » et persistance Postgres vérifiés seulement en simulé ; la DoD (« Preview ou équivalent multi-instances ») n'est pas pleinement atteinte. |
| US-2 Secret de session | 3 | ✅ **Acceptée** | Message exact « Configuration incomplète : AUTH_SECRET est requis. Contactez l'administrateur. », secret court refusé, aucun fichier généré en hébergé, mode local inchangé, session inter-instances (modules rechargés) : tous scénarios ✅. |
| US-3 Initialisation sécurisée (S8) | 5 | ✅ **Acceptée avec réserve** | 403 / 409 / « non configurée » aux libellés exacts, jeton absent des réponses, journaux et bundle (TS-12), création par `ADMIN_*`, mode local sans jeton : ✅. **Réserve R2** : l'absence du formulaire quand l'initialisation est désactivée et le parcours d'erreur jeton relèvent de la recette navigateur, non rejouée après correction (voir R3). |
| US-4 Journal d'audit | 3 | ✅ **Acceptée avec réserve** | Local, aucun secret, écriture non bloquante avec `console.warn` : ✅. **Réserve R1** : table `bia_auth_audit` sur Postgres réel non vérifiée. |
| US-5 Concurrence (S7) | 5 | ✅ **Acceptée avec réserve** | 4 scénarios ✅ sur le backend fichier (`Promise.all`) et la route. **Réserve R1** : concurrence Postgres vérifiée seulement par pool simulé. |
| US-6 Mode local inchangé | 2 | ✅ **Acceptée** | `next start` sur Windows avec anciennes données, 0 connexion hors boucle locale, `pg` chargé seulement en mode Postgres. Écart mineur : `npm run dev` non rejoué (R6). |
| US-7 Guide de déploiement | 2 | ✅ **Acceptée avec réserve** | Variables, limites, secrets factices : ✅ (README). **Réserve R5** : l'option CLI de `vercel link` pour nommer le projet n'est pas confirmée ; le guide doit rester prudent sur ce point. |
| US-8 Déploiement Preview vérifié | 3 | ⏳ **Non acceptée — reportée** | Parcours Preview et persistance après redéploiement non exécutés (en attente d'accord humain). Seul l'équivalent local est prouvé (10/10 `me`). Le scénario « Rapport honnête » est respecté : les éléments non vérifiés sont bien marqués ⏳. |

Total : 31 pts. Acceptés ou acceptés avec réserve : 28 pts. Reportés : 3 pts (US-8).

## 3. Réserves à porter à la GATE 3

| # | Réserve | Action attendue |
|---|---|---|
| R1 | Postgres réel non vérifié (TS-9 / V-7) : persistance, multi-instances, concurrence, audit, URL pooled, URL invalide. | Exécuter TS-9 sur une base de test jetable, après « OK » humain (création du service tiers). |
| R2 | Recette Preview Vercel (TS-13, US-8) non faite. | Déploiement Preview après « OK » humain, sans donnée cliente réelle ; rejouer le parcours du backlog US-8. |
| R3 | La recette UX concluait « Non conforme » (UX-1, contraste des champs en thème sombre). Le code l'a corrigé (`AuthGate.tsx`, itération 3 de la revue, UX-1 à UX-5 et BUG-1 corrigés) mais **aucune recette navigateur n'a confirmé la correction**. | Recette UX courte avant publication : contraste en sombre (aurora, graphite, 1280 et 360 px), É3 à É5, annonce UX-5. Je n'accepte pas l'écran d'initialisation comme « conforme » sans cette confirmation. |
| R4 | CR-7 (test instable préexistant, Mineur) à corriger par le Dev avant les commits finaux. | À traiter avant GATE 3. |
| R5 | Option CLI `vercel link` non confirmée. | Vérifier la documentation Vercel ou nuancer le README. |
| R6 | `npm run dev` non rejoué ; OBS-1 : un `next dev` du poste (port 3100) bloque `npm run build` dans le dépôt. | L'arrêter avant de rebâtir dans le dépôt. |

BUG-1 (login sans `seedFromEnv`) : corrigé en itération 3 (revue : approuvé). Je le considère clos, sous réserve que le QA ait rejoué le test de non-régression (non documenté dans le rapport QA daté avant la correction).

## 4. Stories et éléments reportés (sprint suivant)

1. **US-8** et la partie « réelle » d'US-1, US-4, US-5 (TS-9 / TS-13) : sprint ou lot de recette Vercel/Postgres.
2. **UX-6** (`prefers-reduced-motion` dans `globals.css`) : ticket séparé, décision design system à valider par l'humain.
3. **Dette de recette P0-1 à P0-4, P1-1, P1-2** du sprint précédent : prérequis à la mise en production.
4. Reste de l'audit (S5, S6, S9, S10, C2, C3, dépendances `xlsx` / `jspdf`) : inchangé, hors périmètre.

## 5. Conclusion

Je prononce la **validation fonctionnelle du périmètre local**. L'étape 6 (commits atomiques par le `reviewer`) peut se poursuivre sous réserve de CR-7 et de l'accord humain de la GATE 3. La livraison doit être présentée comme « prête pour un déploiement Preview », **pas** comme « compatible Vercel démontrée » : cette dernière affirmation reste conditionnée à la levée de R1 et R2.
