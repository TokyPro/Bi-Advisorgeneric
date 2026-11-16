import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPostgresBackend, type PgPoolLike } from '@/server/auth/backends/postgres';
import type { User } from '@/server/auth/backends/types';
import { AuthStorageError, DomainError, authErrorResponse } from '@/server/auth/errors';

/**
 * Backend Postgres sans réseau : pool simulé qui enregistre les requêtes. Vérifie les transactions + verrou,
 * le paramétrage, le mapping des erreurs sans fuite. La vérification sur une vraie base (TS-9) attend V-7.
 */
type Call = { sql: string; params?: unknown[] };
type Handler = (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] } | Promise<{ rows: Record<string, unknown>[] }>;

function fakePool(handler: Handler) {
  const calls: Call[] = [];
  const query = async (sql: string, params?: unknown[]) => { calls.push({ sql: sql.trim(), params }); const r = await handler(sql.trim(), params); return { rows: r.rows, rowCount: r.rows.length }; };
  const pool: PgPoolLike = { query, connect: async () => ({ query, release: () => undefined }) };
  return { pool, calls };
}
const row = (u: Partial<User> & { id: string }) => ({ id: u.id, email: u.email ?? `${u.id}@ex.fr`, name: 'N', role: u.role ?? 'user', hash: 'h', salt: 's', created_at: '1', disabled: !!u.disabled, token_version: 1, last_login: null });
const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });
const user = (o: Partial<User> = {}): User => ({ id: 'u1', email: 'u1@ex.fr', name: 'N', role: 'user', hash: 'h', salt: 's', createdAt: 1, tokenVersion: 1, ...o });

afterEach(() => vi.restoreAllMocks());

describe('backend postgres (pool simulé)', () => {
  it('crée le schéma une seule fois, dans une transaction sous verrou transactionnel (CR-1, compatible pooler)', async () => {
    const { pool, calls } = fakePool(() => ({ rows: [{ n: '0' }] }));
    const b = createPostgresBackend('postgres://ignore', { pool });
    expect(await b.count()).toBe(0);
    expect(await b.count()).toBe(0);
    expect(calls.filter((c) => c.sql.includes('CREATE TABLE IF NOT EXISTS bia_users'))).toHaveLength(1);
    expect(calls.slice(0, 5).map((c) => c.sql.split('\n')[0].trim())).toEqual([
      'BEGIN', "SET LOCAL statement_timeout = '5s'", 'SELECT pg_advisory_xact_lock($1)', 'CREATE TABLE IF NOT EXISTS bia_users (', 'COMMIT',
    ]);
    expect(calls.some((c) => /pg_advisory_(un)?lock\(/.test(c.sql))).toBe(false);
  });

  it('échec du DDL : ROLLBACK, puis nouvelle tentative au prochain appel', async () => {
    let fail = true;
    const { pool, calls } = fakePool((sql) => { if (fail && sql.startsWith('CREATE TABLE')) throw pgError('42501', 'permission denied'); return { rows: [{ n: '0' }] }; });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = createPostgresBackend('x', { pool });
    await expect(b.count()).rejects.toBeInstanceOf(AuthStorageError);
    expect(calls.map((c) => c.sql)).toContain('ROLLBACK');
    fail = false;
    expect(await b.count()).toBe(0);
  });

  it('mutation : BEGIN, verrou de transaction, puis COMMIT ; requêtes paramétrées', async () => {
    const { pool, calls } = fakePool((sql) => (sql.startsWith('SELECT 1') ? { rows: [] } : { rows: [] }));
    const b = createPostgresBackend('postgres://ignore', { pool });
    await b.insert(user({ email: "o'hara@ex.fr" }));
    const seq = calls.map((c) => c.sql.split(/\s+/).slice(0, 2).join(' '));
    expect(seq.slice(seq.lastIndexOf('BEGIN'))).toEqual(['BEGIN', 'SET LOCAL', 'SELECT pg_advisory_xact_lock($1)', 'SELECT 1', 'INSERT INTO', 'COMMIT']);
    const ins = calls.find((c) => c.sql.startsWith('INSERT INTO bia_users'))!;
    expect(ins.sql).not.toContain("o'hara");
    expect(ins.params).toContain("o'hara@ex.fr");
  });

  it('onlyIfEmpty : already_initialized vérifié après le verrou, puis ROLLBACK', async () => {
    const { pool, calls } = fakePool((sql) => (sql === 'SELECT 1 FROM bia_users LIMIT 1' ? { rows: [{ '?column?': 1 }] } : { rows: [] }));
    const b = createPostgresBackend('postgres://ignore', { pool });
    await expect(b.insert(user(), { onlyIfEmpty: true })).rejects.toMatchObject({ code: 'already_initialized' });
    const all = calls.map((c) => c.sql);
    const sqls = all.slice(all.lastIndexOf('BEGIN')); // transaction de l'insertion (la précédente crée le schéma)
    expect(sqls.indexOf('SELECT pg_advisory_xact_lock($1)')).toBeLessThan(sqls.indexOf('SELECT 1 FROM bia_users LIMIT 1'));
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });

  it('violation d’unicité (23505) → email_taken', async () => {
    const { pool } = fakePool((sql) => { if (sql.startsWith('INSERT INTO bia_users')) throw pgError('23505', 'duplicate key'); return { rows: [] }; });
    await expect(createPostgresBackend('x', { pool }).insert(user())).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('dernier administrateur : invariant vérifié sous verrou', async () => {
    const { pool } = fakePool((sql) => (sql.startsWith('SELECT * FROM bia_users ORDER BY') ? { rows: [row({ id: 'a', role: 'admin' })] } : { rows: [] }));
    const b = createPostgresBackend('x', { pool });
    await expect(b.update('a', (u) => ({ ...u, disabled: true }))).rejects.toMatchObject({ code: 'last_admin' });
    await expect(b.remove('a')).rejects.toMatchObject({ code: 'last_admin' });
  });

  it('update ne réécrit pas last_login ; touchLogin ne modifie que last_login', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.startsWith('SELECT * FROM bia_users ORDER BY')) return { rows: [row({ id: 'a', role: 'admin' }), row({ id: 'u' })] };
      if (sql.startsWith('UPDATE bia_users SET last_login')) return { rows: [row({ id: 'u', disabled: true })] };
      return { rows: [] };
    });
    const b = createPostgresBackend('x', { pool });
    await b.update('u', (u) => ({ ...u, disabled: true }));
    const upd = calls.find((c) => c.sql.startsWith('UPDATE bia_users SET name'))!;
    expect(upd.sql).not.toContain('last_login');
    const t = await b.touchLogin('u', 42);
    expect(t.disabled).toBe(true);
    expect(calls.at(-1)).toEqual({ sql: 'UPDATE bia_users SET last_login = $1 WHERE id = $2 RETURNING *', params: [42, 'u'] });
  });

  it('base injoignable : AuthStorageError, réponse 503 sans hôte ni message pg, log limité au code', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secretHost = 'db-secret-host.example.internal';
    const { pool } = fakePool(() => { throw pgError('ECONNREFUSED', `connect ECONNREFUSED ${secretHost}:5432 password=hunter2`); });
    const b = createPostgresBackend(`postgres://u:hunter2@${secretHost}/db`, { pool });
    const e = await b.count().catch((x) => x);
    expect(e).toBeInstanceOf(AuthStorageError);
    const res = authErrorResponse(e);
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toContain('"code":"storage"');
    const logged = JSON.stringify(err.mock.calls);
    for (const leak of [secretHost, 'hunter2', '5432']) { expect(body).not.toContain(leak); expect(logged).not.toContain(leak); }
    expect(logged).toContain('ECONNREFUSED');
  });

  it('les erreurs métier ne sont pas converties en erreur de stockage', async () => {
    const { pool } = fakePool((sql) => (sql.startsWith('UPDATE bia_users SET last_login') ? { rows: [] } : { rows: [] }));
    const e = await createPostgresBackend('x', { pool }).touchLogin('absent', 1).catch((x) => x);
    expect(e).toBeInstanceOf(DomainError);
  });

  it('limiteur (CR-2) : incrément et lecture en une seule requête atomique (RETURNING), paramétrée', async () => {
    let n = 0;
    // until_ms dérivé du `now` transmis ($2), comme le SQL réel : un Date.now() ici décalerait l'arrondi au ms près (CR-7).
    const { pool, calls } = fakePool((sql, params) => (sql.startsWith('INSERT INTO bia_login_attempts') ? { rows: [{ n: ++n, until_ms: String(Number(params?.[1]) + 10 * 60_000) }] } : { rows: [] }));
    const b = createPostgresBackend('x', { pool });
    const r = await Promise.all(Array.from({ length: 20 }, () => b.attempts.hit('1.2.3.4|a@ex.fr', 5)));
    expect(r.filter((m) => m === 0)).toHaveLength(5);
    expect(r.filter((m) => m === 10)).toHaveLength(15);
    const hits = calls.filter((c) => c.sql.startsWith('INSERT INTO bia_login_attempts'));
    expect(hits).toHaveLength(20);
    expect(hits[0].sql).toContain('ON CONFLICT (key) DO UPDATE');
    expect(hits[0].sql).toContain('RETURNING n, until_ms');
    expect(hits[0].params?.[0]).toBe('1.2.3.4|a@ex.fr');
    expect(calls.some((c) => c.sql.startsWith('SELECT n, until_ms'))).toBe(false);
  });

  it('limiteur : release décrémente sans remettre à zéro', async () => {
    const { pool, calls } = fakePool(() => ({ rows: [] }));
    await createPostgresBackend('x', { pool }).attempts.release('email|a@ex.fr');
    expect(calls.at(-1)).toEqual({ sql: 'UPDATE bia_login_attempts SET n = greatest(n - 1, 0) WHERE key = $1', params: ['email|a@ex.fr'] });
  });
});
