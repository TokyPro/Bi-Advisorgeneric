# BI Advisor — Conseiller Business Intelligence (BYOK, multi-sources)

Application web Next.js 15 (App Router, React 19, Tailwind) pour interroger, analyser et visualiser des données hétérogènes avec le LLM de votre choix.

## Démarrage

```bash
npm install
npm run dev        # http://localhost:3000
```

L'application est **testable immédiatement** : l'onboarding installe 3 sources de démonstration (Sales DB, Odoo mock, Budget.xlsx) et le moteur « Demo Advisor » répond sans clé API. Essayez : « évolution mensuelle du CA », « marge par catégorie », « erreurs comptables », « budget vs réel ».

Pour de vraies analyses en langage naturel : ⚙️ Paramètres LLM → collez votre clé (Anthropic, OpenAI, Gemini, DeepSeek) → « Enregistrer & tester ».

## Architecture

```
src/
  app/api/llm/{chat,test}        Proxy LLM streaming + testeur de clé (la clé n'est jamais stockée serveur)
  app/api/connectors/{test,schema,query}   Connecteurs distants (lecture seule)
  server/llm.ts                  Adaptateurs Anthropic / OpenAI / Gemini / DeepSeek
  server/connectors/             sql.ts (PG, MySQL, MSSQL, SQLite) · mongo.ts · odoo.ts (JSON-RPC)
  lib/vault.ts                   Chiffrement AES-GCM (clé non exportable en IndexedDB) pour clés API & identifiants
  lib/llm/                       models (contexte/coûts), prompts, client streaming, demo-provider
  lib/connectors/                local-engine (alasql), demo-data, files (xlsx/csv/pdf/docx), google, remote
  lib/bi/                        anomaly (z-score robuste), rag (embeddings locaux), blocks, pivot, export
  lib/actions.ts                 Orchestration : chat → LLM → blocs ```bi-query → exécution → widgets
  components/                    onboarding · layout · chat · canvas · settings · connectors · report
```

### Principe « Text-to-Query »
Le LLM reçoit uniquement le **schéma** (tables, colonnes, FK) des sources actives, jamais les données complètes. Il répond en Markdown avec des blocs ```` ```bi-query ```` (JSON : source, type sql/odoo/mongo, requête, spec de visualisation). L'application exécute la requête, crée le widget (barres, courbe, aire, camembert, KPI, tableau, pivot), détecte les anomalies et renvoie un résumé des résultats au tour suivant. En cas d'erreur : bouton « Corriger avec l'IA ».

### Sécurité
- BYOK : clés chiffrées localement ; envoyées au proxy uniquement le temps d'un appel, jamais loguées.
- Connecteurs SQL/Mongo/Odoo : **lecture seule** forcée (une seule instruction SELECT, mots-clés d'écriture bloqués, `BEGIN READ ONLY` sur PostgreSQL, pipelines Mongo sans `$out/$merge`, 1000 lignes max).
- Les identifiants de connecteurs sont chiffrés dans le vault ; les fichiers uploadés restent dans le navigateur (non persistés).
- Pour la production : ajoutez une authentification, un rate-limit sur `/api/*`, et exécutez le serveur dans votre réseau si les bases ne sont pas publiques.

## Authentification & utilisateurs
- **Premier accès** : un écran vous demande de créer le compte administrateur (ou définissez `ADMIN_EMAIL` / `ADMIN_PASSWORD`, voir `.env.example`).
- Comptes stockés dans `data/users.json` (mots de passe hachés **scrypt**, fichier en 600) ; session par cookie **HttpOnly / SameSite=Lax** signé HMAC (7 jours, `Secure` automatique en HTTPS). Changer ou réinitialiser un mot de passe, désactiver un compte ou changer un rôle **révoque immédiatement** les sessions concernées.
- Toutes les routes `/api/*` exigent une session valide ; `/api/admin/*` exige le rôle administrateur ; contrôle d'origine (anti-CSRF) sur les requêtes modifiantes ; blocage 10 min après 5 échecs de connexion (par IP + e-mail) ; journal d'audit `data/audit.log`.
- **Rôles** : *Administrateur* (gestion des comptes, journal d'audit, diagnostic serveur) et *Utilisateur*. Chaque utilisateur a ses propres clés LLM, connexions et analyses : les données du navigateur sont **isolées par compte** (clés de stockage et coffre séparés).
- Les données déjà présentes avant l'authentification sont reprises par le premier compte qui se connecte sur ce navigateur.
- Mot de passe : 10 caractères minimum avec lettres et chiffres.
- `AUTH_DISABLED=true` désactive l'authentification (poste local uniquement). En production : HTTPS obligatoire (reverse-proxy) et sauvegarde du dossier `data/`.

## Page d'administration (`/admin`)
Accessible depuis la barre latérale (« Administration »). Quatre sections :
- **Vue d'ensemble** : LLM actif et état de la clé, nombre de sources et erreurs, diagnostic serveur (version Node, pilotes PostgreSQL/MySQL/SQL Server/SQLite/MongoDB installés ou non).
- **Modèles LLM** : Anthropic, OpenAI, Gemini, DeepSeek et **NVIDIA NIM** (cloud `https://integrate.api.nvidia.com/v1` ou NIM auto-hébergé : saisir l'URL de base, clé facultative). URL de base aussi disponible pour OpenAI/DeepSeek (proxys compatibles). **Modèles chargés dynamiquement** : à la validation de la clé, la liste réelle des modèles du compte est récupérée via l'API du fournisseur (aucun modèle codé en dur ; bouton « Actualiser », filtre de recherche), modèle actif, ID de modèle personnalisé, température, tokens max et **consignes d'administrateur** injectées dans le prompt système.
- **Connecteurs** : liste des connexions enregistrées (tester, actualiser le schéma / resynchroniser, inclure/exclure du contexte, voir la configuration masquée, supprimer) et catalogue d'ajout (bases SQL/Mongo, Odoo, Google, API REST, Airtable, Notion, fichiers, démo).
- **Utilisateurs** (administrateurs) : créer / désactiver / supprimer des comptes, rôles, réinitialisation de mot de passe, journal d'audit. **Mon compte** : changement de mot de passe, déconnexion.
- **Données & sécurité** : export / import chiffré (PBKDF2 + AES-GCM) de toute la configuration pour migrer de navigateur, effacement des secrets, réinitialisation.

Stockage : clés et identifiants restent chiffrés **dans le navigateur** de chaque utilisateur ; seuls les comptes sont côté serveur.

## Connecteurs
| Source | Détails |
|---|---|
| PostgreSQL / MySQL / SQL Server / SQLite / MongoDB | Test de connexion, inspection du schéma (FK incluses), requêtes lecture seule. SQLite : chemin de fichier **côté serveur**. |
| Odoo | JSON-RPC (URL, base, utilisateur, clé API). Modèles analysés : sale.order(.line), purchase.order(.line), account.move(.line), crm.lead, stock.quant, product.product, res.partner. Requêtes `search_read` / `read_group`. |
| Google Sheets / Drive | OAuth2 (Google Identity Services) avec **votre** Client ID, sélecteur de feuilles Drive ; ou feuille publique + clé API. Nécessite d'ajouter l'URL de l'app aux origines JS autorisées. |
| API REST / JSON | Tout endpoint HTTP (GET/POST), auth Bearer / Basic / en-tête / paramètre d'URL, chemin des données (`data.items`), pagination par paramètre, objets imbriqués aplatis (`client_name`). |
| Airtable | Jeton d'accès personnel + ID de base : toutes les tables et leurs enregistrements. |
| Notion | Jeton d'intégration : bases de données partagées avec l'intégration (propriétés aplaties). |
| Fichiers | Excel multi-onglets, CSV (types auto), PDF (texte + tableaux détectés), DOCX, TXT. Texte → RAG local (embeddings hachés, sans réseau). |

Les sources API (REST, Airtable, Notion) sont lues côté serveur (5 000 lignes max/table), chargées dans le moteur SQL du navigateur et **resynchronisées à chaque démarrage**.

## Fonctionnalités BI
Auto-EDA à la connexion (3–5 questions, générées par le LLM ou heuristique), détection d'anomalies (pics/creux/baisses signalés sur les graphiques), rapport exécutif (Markdown + annexes graphiques, export PDF), exports PNG / CSV / Excel, widgets réorganisables par glisser-déposer, citation de tables avec `@`, bascule de modèle à chaud, thème clair/sombre.

## Notes
- Les modèles ne sont jamais codés en dur : ils sont chargés depuis l'API du fournisseur après validation de la clé. Les API ne publiant pas les tarifs, les coûts ne sont estimés que si vous saisissez les prix ($/M tokens) du modèle dans la configuration LLM.
- Les drivers de bases sont des `optionalDependencies` : l'app fonctionne même si l'un d'eux ne s'installe pas.
- Polices : Plus Jakarta Sans via Google Fonts (repli sur la police système hors-ligne).
- Mascotte « Bibo » : illustration SVG originale, inspirée de l'ambiance de la maquette fournie.
