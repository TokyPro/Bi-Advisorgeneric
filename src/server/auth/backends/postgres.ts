import { AuthStorageError, DomainError, errCode } from '../errors';
import { ATTEMPT_WINDOW_MS, activeAdmins, assertAdminInvariant, type AuditEntry, type AuthBackend, type User } from './types';

/**
 * Backend PostgreSQL (mode hébergé). Base applicative DÉDIÉE aux comptes, configurée par l'administrateur :
 * sans lien avec les connecteurs (ni import, ni garde-fous lecture seule). Requêtes toutes paramétrées.
 * Les messages d'erreur de `pg` ne sont jamais renvoyés ni loggués (ils peuvent contenir l'hôte) : seul `err.code`.
 */

type Row = Record<string, unknown>;
export interface PgClientLike { query(text: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>; release(err?: Error | boolean): void }
export interface PgPoolLike { query: PgClientLike['query']; connect(): Promise<PgClientLike> }

const LOCK_SCHEMA = 0x42494130; // « BIA0 »
const LOCK_USERS = 0x42494131;  // « BIA1 »

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bia_users (
  id text PRIMARY KEY, email text NOT NULL, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','user')), hash text NOT NULL, salt text NOT NULL,
  created_at bigint NOT NULL, disabled boolean NOT NULL DEFAULT false,
  token_version integer NOT NULL DEFAULT 1, last_login bigint);
CREATE UNIQUE INDEX IF NOT EXISTS bia_users_email_uq ON bia_users (email);
CREATE TABLE IF NOT EXISTS bia_login_attempts (key text PRIMARY KEY, n integer NOT NULL, until_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS bia_auth_audit (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL, actor text NOT NULL, detail text NOT NULL DEFAULT '', ip text NOT NULL DEFAULT '');`;

const toUser = (r: Row): User => ({
  id: String(r.id), email: String(r.email), name: String(r.name), role: r.role === 'admin' ? 'admin' : 'user',
  hash: String(r.hash), salt: String(r.salt), createdAt: Number(r.created_at), disabled: !!r.disabled,
  tokenVersion: Number(r.token_version), lastLogin: r.last_login == null ? undefined : Number(r.last_login),
});

// Pool mémoïsé sur globalThis : survit au rechargement à chaud en dev et est partagé par les requêtes d'une instance.
const G = globalThis as unknown as { __biaAuthPools?: Map<string, Promise<PgPoolLike>> };

async function createPool(url: string): Promise<PgPoolLike> {
  let Pool: typeof import('pg').Pool;
  try { ({ Pool } = await import('pg')); }
  catch { console.error('[auth] pilote pg absent'); throw new AuthStorageError(); }
  // TLS : configuré par l'URL (sslmode=require) ; la vérification du certificat n'est jamais désactivée.
  // Pas de statement_timeout en paramètre de démarrage : un pooler PgBouncer peut le refuser (CR-3). Délai client
  // (query_timeout) ici, délai serveur par SET LOCAL dans les transactions.
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
  pool.on('error', (e) => console.error('[auth] connexion postgres perdue :', errCode(e)));
  return pool as unknown as PgPoolLike;
}

function sharedPool(url: string) {
  const pools = (G.__biaAuthPools ??= new Map());
  let p = pools.get(url);
  if (!p) { p = createPool(url); p.catch(() => pools.delete(url)); pools.set(url, p); }
  return p;
}

/**
 * Transaction + verrou consultatif TRANSACTIONNEL : compatible avec un pooler en mode transaction (URL « pooled » Neon),
 * où un verrou de session pourrait être pris et relâché sur deux connexions serveur différentes (CR-1).
 */
async function transaction<T>(pool: PgPoolLike, lock: number, fn: (c: PgClientLike) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '5s'");
    await c.query('SELECT pg_advisory_xact_lock($1)', [lock]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { c.release(); }
}

export function createPostgresBackend(url: string, opts: { pool?: PgPoolLike } = {}): AuthBackend {
  const getPool = () => (opts.pool ? Promise.resolve(opts.pool) : sharedPool(url));

  let schema: Promise<void> | null = null;
  // DDL transactionnel en PostgreSQL : création du schéma atomique et sérialisée entre instances.
  const ready = () => (schema ??= (async () => {
    await transaction(await getPool(), LOCK_SCHEMA, async (c) => { await c.query(SCHEMA); });
  })().catch((e) => { schema = null; throw e; }));

  /** Toute erreur non métier devient `storage` (503), sans message d'origine. */
  const guard = async <T>(fn: (pool: PgPoolLike) => Promise<T>): Promise<T> => {
    try { await ready(); return await fn(await getPool()); }
    catch (e) {
      if (e instanceof DomainError || e instanceof AuthStorageError) throw e;
      console.error('[auth] erreur postgres :', errCode(e));
      throw new AuthStorageError();
    }
  };

  /** Mutations de comptes sérialisées : transaction + verrou consultatif ; invariants vérifiés APRÈS la prise du verrou. */
  const tx = <T>(fn: (c: PgClientLike) => Promise<T>) => guard(async (pool) => {
    try { return await transaction(pool, LOCK_USERS, fn); }
    catch (e) { if ((e as { code?: string }).code === '23505') throw new DomainError('email_taken'); throw e; }
  });

  const all = async (c: PgClientLike | PgPoolLike) => (await c.query('SELECT * FROM bia_users ORDER BY created_at')).rows.map(toUser);
  const one = async (sql: string, params: unknown[]) => {
    const r = await guard((p) => p.query(sql, params));
    return r.rows[0] ? toUser(r.rows[0]) : undefined;
  };

  return {
    kind: 'postgres',
    count: () => guard(async (p) => Number((await p.query('SELECT count(*) AS n FROM bia_users')).rows[0]?.n ?? 0)),
    list: () => guard((p) => all(p)),
    findById: (id) => one('SELECT * FROM bia_users WHERE id = $1', [id]),
    findByEmail: (email) => one('SELECT * FROM bia_users WHERE email = $1', [email]),

    insert: (u, o) => tx(async (c) => {
      if (o?.onlyIfEmpty && (await c.query('SELECT 1 FROM bia_users LIMIT 1')).rows.length) throw new DomainError('already_initialized');
      if ((await c.query('SELECT 1 FROM bia_users WHERE email = $1', [u.email])).rows.length) throw new DomainError('email_taken');
      await c.query(
        'INSERT INTO bia_users (id, email, name, role, hash, salt, created_at, disabled, token_version, last_login) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [u.id, u.email, u.name, u.role, u.hash, u.salt, u.createdAt, !!u.disabled, u.tokenVersion, u.lastLogin ?? null],
      );
      return u;
    }),

    update: (id, mutate) => tx(async (c) => {
      const before = await all(c);
      const u = before.find((x) => x.id === id);
      if (!u) throw new DomainError('not_found');
      const next = mutate({ ...u });
      assertAdminInvariant(before, before.map((x) => (x.id === id ? next : x)));
      // last_login n'est pas réécrit : un touchLogin concurrent (sans verrou) n'est pas perdu.
      await c.query(
        'UPDATE bia_users SET name = $2, role = $3, hash = $4, salt = $5, disabled = $6, token_version = $7 WHERE id = $1',
        [id, next.name, next.role, next.hash, next.salt, !!next.disabled, next.tokenVersion],
      );
      return next;
    }),

    remove: (id) => tx(async (c) => {
      const before = await all(c);
      const after = before.filter((u) => u.id !== id);
      if (after.length === before.length) throw new DomainError('not_found');
      if (!activeAdmins(after)) throw new DomainError('last_admin');
      await c.query('DELETE FROM bia_users WHERE id = $1', [id]);
    }),

    touchLogin: async (id, at) => {
      const u = await one('UPDATE bia_users SET last_login = $1 WHERE id = $2 RETURNING *', [at, id]);
      if (!u) throw new DomainError('not_found');
      return u;
    },

    attempts: {
      // Incrément et lecture en UNE instruction atomique (CR-2) : fenêtre de 10 min, blocage de 10 min à partir de la max-ième tentative.
      hit: (key, max) => guard(async (p) => {
        const now = Date.now();
        const r = (await p.query(
          `INSERT INTO bia_login_attempts AS a (key, n, until_ms) VALUES ($1, 1, $2::bigint + $3::bigint)
           ON CONFLICT (key) DO UPDATE SET
             n = CASE WHEN a.until_ms <= $2::bigint THEN 1 ELSE a.n + 1 END,
             until_ms = CASE WHEN a.until_ms <= $2::bigint OR a.n + 1 = $4::int THEN $2::bigint + $3::bigint ELSE a.until_ms END
           RETURNING n, until_ms`,
          [key, now, ATTEMPT_WINDOW_MS, max],
        )).rows[0];
        return r && Number(r.n) > max ? Math.max(1, Math.ceil((Number(r.until_ms) - now) / 60_000)) : 0;
      }),
      release: (key) => guard(async (p) => {
        await p.query('UPDATE bia_login_attempts SET n = greatest(n - 1, 0) WHERE key = $1', [key]);
      }),
      clear: (key) => guard(async (p) => {
        await p.query('DELETE FROM bia_login_attempts WHERE key = $1 OR until_ms < $2', [key, Date.now()]);
      }),
    },

    appendAudit: (e: AuditEntry) => guard(async (p) => {
      await p.query('INSERT INTO bia_auth_audit (at, event, actor, detail, ip) VALUES ($1, $2, $3, $4, $5)', [e.at, e.event, e.actor, e.detail, e.ip]);
    }),
    readAudit: (n) => guard(async (p) => (await p.query('SELECT at, event, actor, detail, ip FROM bia_auth_audit ORDER BY id DESC LIMIT $1', [n])).rows
      .map((r) => ({ at: r.at instanceof Date ? r.at.toISOString() : String(r.at), event: String(r.event), actor: String(r.actor), detail: String(r.detail), ip: String(r.ip) }))),
  };
}
