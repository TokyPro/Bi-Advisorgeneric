# Guide d'utilisation — Équipe multi-agents Claude Code (BI Advisor)

Ce dépôt est configuré avec 6 agents spécialisés qui travaillent comme une équipe agile. Ce guide explique comment
les invoquer, lancer un sprint complet et lire leur suivi dans le terminal. La gouvernance détaillée (workflow,
validations humaines, Definition of Done) est dans [`CLAUDE.md`](./CLAUDE.md).

## 1. Ce qui a été installé

```
.claude/
  agents/
    po.md          Product Owner          (modèle sonnet, écrit dans docs/sprints/)
    tech-lead.md   Tech Lead & Architecte (modèle opus,   écrit dans docs/)
    ux-ui.md       Designer UX/UI         (modèle sonnet, écrit dans docs/)
    dev.md         Développeur Full Stack (modèle opus,   écrit dans src/)
    reviewer.md    Code Reviewer & Git    (modèle opus,   docs/sprints/ + seul à écrire dans Git)
    qa.md          QA Engineer            (modèle sonnet, tests + docs/sprints/)
  settings.json    Confirmation forcée des commandes critiques + secrets bloqués
CLAUDE.md          Gouvernance & protocole d'orchestration
AGENTS_README.md   Ce guide
docs/sprints/<sprint-id>/   Livrables de chaque sprint (créé au premier sprint)
```

Vérifier que les agents sont chargés : dans Claude Code, tapez `/agents` → les 6 agents apparaissent dans la section *Project*.
(Si la session était ouverte avant la création des fichiers, redémarrez-la.)

## 2. Invoquer un agent individuellement

Trois façons, de la plus explicite à la plus implicite :

| Méthode | Exemple |
|---|---|
| Mention `@` | `@po découpe l'epic « export PowerPoint du rapport » en user stories` |
| Demande nominative | `Utilise l'agent tech-lead pour concevoir la solution du sprint 2026-11-10-export-pptx` |
| Délégation automatique | `Rédige les critères Gherkin pour la gestion des rôles` (Claude choisit `po` d'après sa description) |

Exemples par agent :

```text
@po          Priorise le backlog docs/sprints/2026-11-10-export-pptx/backlog.md en MoSCoW
@tech-lead   Conçois la solution technique du sprint 2026-11-10-export-pptx à partir du backlog
@ux-ui       Spécifie les états vide/erreur/chargement de la modale Connecteurs, avec exigences WCAG AA
@dev         Implémente les tâches T-1 à T-3 de docs/sprints/2026-11-10-export-pptx/architecture.md
@reviewer    Fais la revue de code du sprint 2026-11-10-export-pptx (git diff + dev-notes.md)
@reviewer    Crée la branche du sprint 2026-11-10-export-pptx
@reviewer    Prépare les commits du sprint 2026-11-10-export-pptx (montre-moi le plan avant d'exécuter)
@reviewer    Revois mes modifications locales non commitées puis propose un commit
@qa          Vérifie les critères Gherkin du sprint 2026-11-10-export-pptx et produis le qa-report
```

> Le `reviewer` est le **seul** agent qui écrit dans Git. Il affiche toujours le plan exact (branche, messages de commit,
> fichiers) et attend votre « OK » avant d'exécuter. Le push et le merge font l'objet d'une validation séparée.

Astuce : donnez toujours le **`<sprint-id>`** ou le chemin du livrable d'entrée, chaque agent travaille à partir des fichiers de `docs/sprints/`.

## 3. Lancer un sprint / traitement multi-agents complet

Collez dans la session principale (qui devient l'**orchestrateur**) :

```text
Lance un sprint multi-agents complet selon CLAUDE.md.
Sprint : 2026-11-10-export-pptx
Epic : permettre d'exporter le rapport exécutif en PowerPoint, avec un graphique par slide.
```

Déroulé attendu :

| # | Étape | Agent(s) | Livrable | Votre action |
|---|---|---|---|---|
| 1 | Cadrage | `po` | `backlog.md` | **GATE 1** : valider / amender le backlog |
| 2 | Conception (parallèle) | `tech-lead` + `ux-ui` | `architecture.md`, `ux-spec.md` | **GATE 2** : valider la conception, les dépendances, les ⚠️ |
| 3a | Branche de sprint | `reviewer` | `feature/<sprint-id>` | « OK » pour créer la branche |
| 3b | Implémentation | `dev` | code + `dev-notes.md` | Répondre « OK » aux demandes de validation (installs, fichiers sensibles…) |
| 3c | Revue de code | `reviewer` | `code-review.md` | — (boucle automatique vers `dev` si besoin, 3 max, puis arbitrage `tech-lead`) |
| 4 | Tests + recette | `qa` (+ `ux-ui`) | `test-plan.md`, `qa-report.md`, `ux-review.md` | — (boucle vers `dev` → `reviewer` si NO-GO, 3 max) |
| 5 | Validation | `po` | `validation-po.md` | — |
| 6 | Commits | `reviewer` | commits + `git-log.md` | « OK » sur le plan de commits, puis **GATE 3** : autoriser push / merge / PR |

Variantes utiles :

```text
Corrige le bug suivant via le workflow allégé (tech-lead → dev → qa) : <description>
Lance uniquement les étapes 1 et 2 du sprint <id> et arrête-toi à la GATE 2.
Reprends le sprint <id> à l'étape 4 (QA).
```

## 4. Lire le suivi des tâches dans le terminal

Chaque agent ouvre et ferme son traitement avec un encadré :

```
--------------------------------------------------
🤖 [DEV FULL STACK] - Démarrage du traitement
--------------------------------------------------
- [x] Étape 1 : Analyse des spécifications / éléments d'entrée
- [-] Étape 2 : Exécution de la tâche principale (implémentation)
    - [x] 2.1 T-1 Route /api/report/pptx
    - [-] 2.2 T-2 Bouton « Exporter en PowerPoint »
    - [ ] 2.3 T-3 Gestion des erreurs
- [ ] Étape 3 : Vérification et génération des livrables
--------------------------------------------------
```

| Symbole | Signification |
|---|---|
| `[ ]` | À faire |
| `[-]` | En cours |
| `[x]` | Terminé |
| `[!]` | Bloqué ou en échec — la raison est indiquée sur la ligne |

En fin de traitement, l'encadré se termine par :
- **📁 Fichiers créés / modifiés** : la liste exacte des fichiers touchés (à relire avant la gate suivante) ;
- **🌿 Git** (reviewer uniquement) : branche courante et commits créés ;
- **➡️ Relais** : l'agent suivant et ce qu'il doit faire.

L'orchestrateur affiche aussi un encadré `🤖 [ORCHESTRATEUR]` avec l'avancement global du sprint et **recopie le bloc
final de chaque agent** : un sous-agent travaille en arrière-plan et ses messages intermédiaires ne s'affichent pas
directement, c'est donc ce bloc recopié qui fait foi. Le détail complet est toujours disponible dans `docs/sprints/<sprint-id>/`.

## 5. Validation humaine : ce qui vous sera demandé

Vous verrez ce message avant toute action critique :

```
⚠️ VALIDATION HUMAINE REQUISE
Action  : npm install -D vitest
Impact  : package.json, package-lock.json (réversible)
Raison  : aucun framework de test installé, nécessaire pour US-2
→ Répondez « OK » pour exécuter, ou proposez une alternative.
```

Concerné : commits / push / merge, suppressions et grosses refactorisations, déploiements, installations de
dépendances, fichiers sensibles (auth, vault, config, `.env*`). En plus de cette règle, `.claude/settings.json` fait
apparaître la boîte de confirmation de Claude Code pour ces commandes et interdit la lecture des secrets de `data/` et `.env`.

## 6. Bon à savoir

- **Pas encore de tests** dans le projet : au premier sprint, le QA proposera d'installer Vitest (unitaires) et
  Playwright (E2E) — après votre accord. Les E2E s'appuient sur les sources de démo et le moteur « Demo Advisor » (sans clé API).
- Les agents **ne s'appellent pas entre eux** : c'est la session principale qui enchaîne les étapes.
- Personnaliser un agent : éditez son fichier dans `.claude/agents/` (frontmatter `model`, `tools`, `description`), puis redémarrez la session ou utilisez `/agents`.
- Les livrables de `docs/sprints/` sont destinés à être versionnés : ils constituent l'historique des décisions.
