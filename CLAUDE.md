# BI Advisor — Gouvernance Claude Code & orchestration multi-agents

Ce fichier s'applique à toute session Claude Code ouverte dans ce dépôt. Pour ce projet, le **workflow à 6 agents
ci-dessous prime** sur les workflows génériques (OMC ou autres) dès qu'il s'agit d'une fonctionnalité, d'une epic ou
d'un bug non trivial. Les tâches triviales (question, lecture, correction d'une ligne) peuvent être traitées directement.

## 1. Contexte projet

- **Produit** : conseiller BI BYOK multi-sources (chat → LLM → blocs `bi-query` → exécution lecture seule → widgets / rapports).
- **Stack** : Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind 3 (tokens + palettes) · Zustand · Recharts · alasql ·
  connecteurs serveur (`src/server/connectors`) · auth fichier (`src/server/auth`, `data/`).
- **Commandes** : `npm run dev` (http://localhost:3000) · `npm run build` · `npx tsc --noEmit`.
  Aucun framework de test ni linter installé à ce jour (voir agent `qa`).
- **Langue** : interface, livrables et échanges **en français**.
- **Invariants de sécurité** (détaillés dans `.claude/agents/tech-lead.md`) : connecteurs en lecture seule, secrets BYOK jamais
  logués/persistés serveur, LLM limité au schéma, session obligatoire sur `/api/*`, isolation par compte, `data/` et `.env*` intouchables.

## 2. Les agents (`.claude/agents/`)

| Agent | Fichier | Rôle | Écrit dans |
|---|---|---|---|
| `po` | `po.md` | Découpage epic → user stories, priorisation, critères Gherkin, validation fonctionnelle | `docs/sprints/` |
| `tech-lead` | `tech-lead.md` | Architecture, tâches techniques, ADR, sécurité/perf, arbitrage sur escalade | `docs/` |
| `ux-ui` | `ux-ui.md` | Parcours, écrans, états, micro-copies, accessibilité, design system, recette visuelle | `docs/` |
| `dev` | `dev.md` | Implémentation front/back, corrections de bugs | `src/`, `docs/sprints/` |
| `reviewer` | `reviewer.md` | Revue de code (sécurité, correction, conformité) **et gestion Git** (branche de sprint, commits, push/merge/PR) | `docs/sprints/`, historique Git |
| `qa` | `qa.md` | Plan de test, tests unitaires/intégration/E2E, vérification des critères, GO/NO-GO | tests, `docs/sprints/` |

**Git** : le `reviewer` est le **seul** agent autorisé à exécuter des commandes Git d'écriture (branche, `add`, `commit`,
`push`, `merge`, `tag`, PR), et uniquement après validation humaine. Les autres agents se limitent à `git status`, `git diff`, `git log`.
Conventions (branche `feature/<sprint-id>`, Conventional Commits en français, fichiers interdits) : voir `.claude/agents/reviewer.md`.

La **session principale** joue le rôle d'**orchestrateur** : elle lance les agents (outil Agent / `@nom-agent`), transmet
les chemins des livrables, relaie leurs To-Do lists dans le terminal et sollicite l'humain aux points de validation.
Les agents ne s'appellent pas entre eux : le relais passe toujours par l'orchestrateur.

## 3. Workflow séquentiel et collaboratif

```
            ┌──────────────┐
 Demande ──▶│ 1. PO        │ backlog.md (stories + Gherkin)
            └──────┬───────┘
                   │  🧑 GATE 1 : validation humaine du backlog
          ┌────────┴────────┐
          ▼                 ▼          (en parallèle)
 ┌────────────────┐ ┌────────────────┐
 │ 2a. Tech Lead  │ │ 2b. UX/UI      │ architecture.md · ux-spec.md
 └───────┬────────┘ └───────┬────────┘
         └────────┬─────────┘
                  │  🧑 GATE 2 : validation humaine de la conception
                  ▼
         ┌────────────────┐
         │ 3a. Reviewer   │ crée la branche feature/<sprint-id>  (🧑 OK requis)
         │   (Git)        │
         └───────┬────────┘
                  ▼
         ┌────────────────┐
         │ 3b. Dev        │ code + dev-notes.md
         └───────┬────────┘
                  ▼
         ┌────────────────┐   Changements requis (CR-n)
         │ 3c. Reviewer   │──────────────▶ retour Dev
         │  (revue code)  │   désaccord / 3ᵉ boucle ──▶ Tech Lead (arbitrage)
         └───────┬────────┘ Approuvé
                  ▼
         ┌────────────────┐   NO-GO (BUG-n)
         │ 4. QA (+UX     │──────────────▶ retour Dev ──▶ Reviewer
         │  recette)      │
         └───────┬────────┘ GO
                  ▼
         ┌────────────────┐
         │ 5. PO          │ validation-po.md
         └───────┬────────┘
                  ▼
         ┌────────────────┐
         │ 6. Reviewer    │ commits atomiques (🧑 OK requis) + git-log.md
         │   (Git)        │
         └───────┬────────┘
                  │  🧑 GATE 3 : validation humaine du push / merge / PR
                  ▼
               Terminé
```

Règles de flux :
- Chaque agent **lit les livrables de l'étape précédente** dans `docs/sprints/<sprint-id>/` et n'avance pas si une entrée obligatoire manque.
- `<sprint-id>` = `AAAA-MM-JJ-<slug>` ; tous les livrables d'un sprint vivent dans ce dossier ; les ADR structurants dans `docs/adr/`.
- Boucles de correction (revue → Dev, QA → Dev) : **3 itérations maximum**, ensuite arbitrage du `tech-lead` puis escalade à l'humain.
- Toute correction du Dev suite au QA repasse par une **revue courte** du `reviewer` avant de retourner au QA.
- Story sans impact visuel : l'étape UX/UI peut être sautée (l'orchestrateur l'indique explicitement).
- Bug simple : `tech-lead` (diagnostic + tâche) → `reviewer` (branche `fix/…`) → `dev` → `reviewer` (revue) → `qa` → `reviewer` (commit),
  le PO n'intervenant que si le comportement attendu est ambigu.

## 4. Protocole To-Do list (obligatoire pour chaque agent)

À **chaque lancement de traitement**, l'agent actif affiche sa To-Do list dans la console :

```
--------------------------------------------------
🤖 [NOM_DE_L_AGENT] - Démarrage du traitement
--------------------------------------------------
- [ ] Étape 1 : Analyse des spécifications / éléments d'entrée
- [ ] Étape 2 : Exécution de la tâche principale
- [ ] Étape 3 : Vérification et génération des livrables
--------------------------------------------------
```

Pendant et en fin de traitement, il **réaffiche le bloc mis à jour** à chaque changement d'étape :

```
--------------------------------------------------
🤖 [NOM_DE_L_AGENT] - Traitement terminé
--------------------------------------------------
- [x] Étape 1 : Analyse des spécifications / éléments d'entrée
- [x] Étape 2 : Exécution de la tâche principale
    - [x] 2.1 …
    - [x] 2.2 …
- [x] Étape 3 : Vérification et génération des livrables
--------------------------------------------------
📁 Fichiers créés / modifiés :
  - docs/sprints/<sprint-id>/backlog.md (créé)
  - src/… (modifié)
➡️ Relais : <agent suivant> — <ce qu'il doit faire>
--------------------------------------------------
```

Légende : `[ ]` à faire · `[-]` en cours · `[x]` terminé · `[!]` bloqué / en échec (raison obligatoire).
Noms d'affichage : `PRODUCT OWNER`, `TECH LEAD`, `UX/UI DESIGNER`, `DEV FULL STACK`, `CODE REVIEWER & GIT`, `QA ENGINEER`, `ORCHESTRATEUR`.
Le `reviewer` ajoute une ligne `🌿 Git :` (branche, commits créés) avant le relais.

L'**orchestrateur** :
- affiche lui aussi un bloc `🤖 [ORCHESTRATEUR]` listant les étapes du sprint (PO, Tech Lead, UX/UI, branche, Dev, revue, QA, validation, commits) ;
- **recopie intégralement** dans le terminal le bloc final de chaque agent (un sous-agent ne s'affiche pas directement à l'utilisateur) ;
- tient à jour le **panneau de tâches natif** selon le § 4 bis (obligatoire).

Un traitement sans bloc final « 📁 Fichiers créés / modifiés » + « ➡️ Relais » est considéré **incomplet**.

## 4 bis. Assignation des tâches et panneau de tâches natif (obligatoire à chaque demande)

Les outils natifs `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` alimentent la liste de tâches affichée par
Claude Code (panneau / zone « tâches », `Ctrl+T` dans le terminal). Ils sont activés pour ce projet par
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` dans `.claude/settings.json`. Les sous-agents lancés en arrière-plan n'ont **pas**
accès à ces outils : **seul l'orchestrateur écrit dans le panneau**, les agents lui renvoient l'état de leurs étapes.

### A. Découpage et assignation (orchestrateur, avant tout lancement d'agent)

À **chaque demande** non triviale, avant de lancer le premier agent, l'orchestrateur :

1. Découpe la demande selon le workflow du § 3 et crée **une tâche native par assignation** (agent × étape), dans l'ordre du flux,
   gates humaines comprises :
   - `subject` : `[AGENT] <action> — <livrable>` — ex. `[PO] Découper l'epic en stories — backlog.md`,
     `[DEV] T-2 Garde SSRF sur /api/connectors — src/server/…`, `🧑 GATE 1 — Validation du backlog` ;
   - `activeForm` : forme en cours — ex. `Le PO découpe l'epic en stories` ;
   - `description` : la **fiche d'assignation** (format B ci-dessous) ;
   - puis `TaskUpdate` : `owner` = nom de l'agent (`po`, `tech-lead`, `ux-ui`, `dev`, `reviewer`, `qa`, ou `humain` pour une gate),
     et `addBlockedBy` reproduisant l'ordre du workflow (ex. Dev bloqué par GATE 2 et la branche).
2. Affiche le bloc `🤖 [ORCHESTRATEUR]` avec les numéros de tâches (`#n`) et leur agent.

### B. Fiche d'assignation transmise à l'agent

Le prompt de lancement de chaque agent **commence** par ce bloc (copie de la `description` de la tâche) :

```
📌 ASSIGNATION — Tâche #<n> — <AGENT>
Sprint      : <sprint-id>
Objectif    : <ce qui est attendu, en une phrase>
Périmètre   : <stories / tâches T-n / CR-n / BUG-n couvertes> — hors périmètre : <…>
Entrées     : <chemins des livrables à lire>
Livrables   : <chemins à créer / modifier>
Fin quand   : <critère de terminaison vérifiable>
Sous-étapes : <2.1 …, 2.2 … — pré-découpées par l'orchestrateur>
```

### C. Cycle de vie dans le panneau

| Moment | Action de l'orchestrateur |
|---|---|
| Lancement de l'agent | `TaskUpdate` → `in_progress` |
| Sous-étapes (si > 1) | une tâche native par sous-étape (`[DEV] 2.1 T-1 …`), cochée au retour de l'agent selon son bloc final |
| Retour de l'agent, bloc final complet et livrables présents | `TaskUpdate` → `completed`, puis recopie du bloc final dans le terminal |
| Agent bloqué / `[!]` / validation humaine attendue | tâche laissée `in_progress`, subject préfixé `⏸️` ; ajout d'une tâche `🧑 VALIDATION — <action>` |
| Boucle de correction (CR-n, BUG-n) | **nouvelles** tâches `[DEV] Corriger CR-1…`, `[REVIEWER] Revue courte itération 2` (on ne rouvre pas une tâche terminée) |
| Gate franchie par l'humain | tâche `🧑 GATE n` → `completed` |
| Tâche devenue sans objet | `TaskUpdate` → `deleted` |

Règles : une seule tâche d'agent `in_progress` à la fois, sauf étapes parallèles (Tech Lead ∥ UX/UI) ; une tâche n'est
`completed` que si le bloc final de l'agent est complet (§ 4) ; le panneau et les blocs terminal doivent toujours concorder.

## 5. ⚠️ Règle impérative : validation humaine obligatoire

Aucun agent ni l'orchestrateur n'exécute les actions suivantes **sans un accord humain explicite donné dans la conversation
pour cette action précise** (un accord précédent ne vaut pas pour la suivante) :

1. **Git** (exécuté par le seul `reviewer`) : création/suppression de branche, `commit`, `push`, `merge`, `rebase`, `reset`,
   `checkout -- / restore` destructif, tag/release, ouverture de PR. Jamais de `push --force` sur `main`, jamais de `--no-verify`.
2. **Suppression ou refactorisation d'ampleur** : suppression de fichiers/dossiers, renommage/déplacement massif, refacto touchant > ~5 fichiers ou une interface partagée (`src/lib/types.ts`, `store.ts`, `actions.ts`).
3. **Déploiement** : `vercel` / `vercel deploy`, publication, toute mise en production ou modification d'environnement distant.
4. **Commandes à fort impact** : `npm install` / `uninstall` / `update` (dépendances), `npx playwright install`, `rm -rf`, scripts modifiant `data/`, commandes réseau vers des services tiers réels, requêtes sur des bases clientes réelles.
5. **Fichiers sensibles** : `package.json`, `next.config.mjs`, `tsconfig.json`, `.env*`, `src/server/auth/**`, `src/lib/vault.ts`, garde-fous lecture seule de `src/server/connectors/**`.

Procédure : l'agent s'arrête, affiche

```
⚠️ VALIDATION HUMAINE REQUISE
Action  : <commande ou modification exacte>
Impact  : <fichiers / systèmes touchés, réversibilité>
Raison  : <pourquoi c'est nécessaire>
→ Répondez « OK » pour exécuter, ou proposez une alternative.
```

puis attend la réponse. Les **3 gates** du workflow (backlog, conception, livraison) sont aussi des validations humaines obligatoires.
Garde-fou technique complémentaire : `.claude/settings.json` force une confirmation pour ces commandes et bloque la lecture des secrets.

## 6. Definition of Done (sprint)

- Critères Gherkin du PO tous ✅ dans `qa-report.md`, avec preuve.
- `npx tsc --noEmit` et `npm run build` passent.
- Revue du `reviewer` « Approuvé » (dernière itération), recette UX « Conforme » (si impact visuel).
- Aucun invariant de sécurité dégradé ; aucun `TODO`, `.skip`, `.only` ou test vide introduit.
- `validation-po.md` : stories acceptées.
- Commits atomiques sur `feature/<sprint-id>`, aucun secret ni fichier interdit indexé, `git-log.md` à jour ; GATE 3 franchie par l'humain.
