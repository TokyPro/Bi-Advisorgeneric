# ADR-001 — Stockage des comptes, des tentatives et du journal d'audit hors disque local

- **Statut** : Proposé (à valider en GATE 2 du sprint `2026-11-11-compat-vercel`)
- **Date** : 2026-11-11 · **Auteur** : Tech Lead
- **Stories** : US-1, US-4, US-5, US-6 (question Q1 du backlog)

## Contexte

L'authentification stocke aujourd'hui tout sur disque, dans `BI_DATA_DIR` (`./data`) : `users.json`, `auth-secret`
et `audit.log`. Le limiteur de tentatives tient en mémoire. Sur Vercel :

- le système de fichiers est en lecture seule, sauf `/tmp`, qui est éphémère et propre à chaque instance ;
- plusieurs instances servent les requêtes en parallèle (Fluid compute : plusieurs requêtes concurrentes par instance) ;
- ce qui est en mémoire n'est ni partagé ni durable.

Il faut un stockage **persistant**, **partagé**, offrant des **écritures atomiques** (pour S7 : dernier administrateur,
unicité de l'e-mail, initialisation unique), **joignable depuis une fonction Vercel**, avec une **offre gratuite
ou peu chère**. Il doit rester **facultatif en local** (US-6 : aucun accès réseau tiers).

## Options étudiées

| Critère | **A. PostgreSQL (Neon via Vercel Marketplace, ou tout Postgres)** | B. Upstash Redis (Marketplace) | C. Vercel Blob | D. Edge Config |
|---|---|---|---|---|
| Persistance / partage | Oui | Oui | Oui | Oui |
| Atomicité multi-enregistrements (dernier admin, init unique) | **Transactions + `pg_advisory_xact_lock` + index unique** | Uniquement via scripts Lua (`EVAL`) à écrire et maintenir | **Non** : objets entiers, pas de comparaison-échange fiable, lecture via cache/CDN (risque de données périmées : un compte désactivé pourrait rester accepté) | Non : conçu pour une configuration lue souvent et écrite rarement, propagation différée |
| Nouvelle dépendance npm | **Aucune** : `pg` 8.x est déjà dans `optionalDependencies` et `serverExternalPackages` | `@upstash/redis`, ou un client REST écrit à la main | `@vercel/blob` | `@vercel/edge-config` |
| Modèle de données | Relationnel (tables `bia_*`), contraintes en base | Clés/valeurs, index e-mail géré à la main | Un fichier JSON (reproduit S7) | Inadapté |
| Connexions serverless | Pool `pg` réduit + URL « pooled » de Neon (PgBouncer) | HTTP, sans connexion persistante (avantage) | HTTP | HTTP |
| Portabilité (Docker, autre hébergeur, Q3) | **Tout PostgreSQL** (Neon, Supabase, RDS, auto-hébergé) | Redis compatible REST Upstash seulement | Vercel seulement | Vercel seulement |
| Coût PME | Offre gratuite Neon (à confirmer sur la page tarifaire au moment de la GATE 2) | Offre gratuite (à confirmer) | Offre gratuite (à confirmer) | — |
| Audit (US-4) | Table `bia_auth_audit` | Liste plafonnée (`LPUSH`/`LTRIM`) | Ajout impossible sans réécrire l'objet | Non |

Note : « Vercel KV » et « Vercel Postgres » ne sont plus proposés en propre. Ils sont remplacés par les intégrations
Marketplace (Upstash, Neon). Je l'écris de mémoire, sans accès réseau pendant cette tâche : **à vérifier sur
vercel.com/docs (Storage / Marketplace) avant la GATE 2**.

## Décision

**Option A : PostgreSQL, avec Neon (intégration Vercel Marketplace) comme fournisseur recommandé.** Le pilote est
`pg`, déjà présent dans le projet. Toute base PostgreSQL ≥ 13 joignable convient.

- Abstraction `AuthBackend`, avec deux implémentations : `file` (défaut local, comportement actuel) et `postgres`.
- Sélection : `BI_AUTH_STORE=file|postgres` si la variable est définie. Sinon `postgres` en mode hébergé
  (`VERCEL=1` ou `BI_HOSTED=true`) et `file` partout ailleurs. **En local, une variable `DATABASE_URL` présente
  dans l'environnement n'active jamais Postgres** à elle seule (US-6).
- URL : `BI_AUTH_DATABASE_URL`, à défaut `DATABASE_URL` (nom injecté par l'intégration Neon). L'URL n'est jamais
  logguée, ni renvoyée au client, ni utilisée par les connecteurs.
- **La base d'authentification est dédiée.** Ce n'est jamais une base cliente analysée par BI Advisor, et elle
  n'est jamais exposée au LLM ni aux connecteurs.
- Schéma créé à la volée (`CREATE TABLE IF NOT EXISTS`, idempotent) au premier accès. Le SQL est documenté dans
  le README pour les rôles sans droit `CREATE`.

## Conséquences

- (+) Aucune dépendance npm ajoutée, `package.json` inchangé. S7 est corrigé par construction (transactions,
  contraintes). Le journal d'audit et le limiteur de tentatives sont partagés.
- (+) Fonctionne aussi pour Docker ou un hébergeur sans disque persistant (`BI_HOSTED=true` + URL).
- (−) Une **création de compte chez un service tiers** (Neon) et l'ajout de variables d'environnement Vercel :
  validation humaine (CLAUDE.md § 5).
- (−) Toute l'API d'authentification devient **asynchrone**. C'est une refactorisation de 13 routes et de
  l'interface partagée `requireAuth` : validation humaine (refacto > 5 fichiers).
- (−) Latence : une requête SQL par appel authentifié (relecture de `tokenVersion`/`disabled`, indispensable
  pour une révocation immédiate sur toutes les instances), plus un réveil à froid possible de Neon après inactivité.
- (−) `pg` reste une dépendance **optionnelle**. Si son installation échoue sur Vercel, le mode hébergé renvoie
  « Service d'authentification momentanément indisponible » (503 `storage`) et le journal de la plateforme
  indique « pilote pg absent ». Si l'humain le souhaite, `pg` peut passer en `dependencies` (alternative soumise
  à validation, non retenue par défaut).

## Alternatives rejetées

- **B (Upstash Redis)** : acceptable techniquement, mais elle ajoute une dépendance et oblige à réécrire les
  invariants transactionnels en Lua. À retenir seulement si l'humain refuse Postgres.
- **C (Blob)** et **D (Edge Config)** : pas d'atomicité, lectures possiblement périmées. Incompatibles avec
  US-1 (désactivation effective partout) et US-5.
- **SQLite sur `/tmp`** : éphémère et non partagé, ne répond pas au besoin.
