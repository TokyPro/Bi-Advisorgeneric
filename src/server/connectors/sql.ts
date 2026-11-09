import type { TableSchema } from '@/lib/types';

type Cfg = Record<string, string>;
const MAX_ROWS = 1000;

/** Garde-fou lecture seule : une seule instruction, SELECT/WITH/SHOW/DESCRIBE/EXPLAIN uniquement. */
export function assertReadOnly(sql: string) {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (s.includes(';')) throw new Error('Une seule instruction SQL est autorisée.');
  if (!/^(select|with|show|describe|explain|pragma\s+table_info)\b/i.test(s)) throw new Error('Seules les requêtes en lecture (SELECT) sont autorisées.');
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|exec|execute|call|into\s+outfile)\b/i.test(s.replace(/'[^']*'/g, "''")))
    throw new Error('Mot-clé interdit détecté : le connecteur est en lecture seule.');
  return s;
}

function pgConfig(c: Cfg) {
  if (c.url) return { connectionString: c.url, ssl: c.ssl === 'true' ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: 8000 };
  return { host: c.host, port: Number(c.port || 5432), database: c.database, user: c.user, password: c.password, ssl: c.ssl === 'true' ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: 8000 };
}

async function withPg<T>(c: Cfg, fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>) {
  const { Client } = await import('pg');
  const client = new Client(pgConfig(c));
  await client.connect();
  try { await client.query('BEGIN READ ONLY'); return await fn((sql, p) => client.query(sql, p)); }
  finally { try { await client.query('ROLLBACK'); } catch { /* */ } await client.end(); }
}

async function withMysql<T>(c: Cfg, fn: (q: (sql: string, p?: unknown[]) => Promise<Record<string, unknown>[]>, db: string) => Promise<T>) {
  const mysql = await import('mysql2/promise');
  const conn = c.url
    ? await mysql.createConnection(c.url)
    : await mysql.createConnection({ host: c.host, port: Number(c.port || 3306), user: c.user, password: c.password, database: c.database, connectTimeout: 8000 });
  try {
    const [[{ db }]] = (await conn.query('SELECT DATABASE() AS db')) as unknown as [[{ db: string }]];
    return await fn(async (sql, p) => { const [rows] = await conn.query(sql, p); return rows as Record<string, unknown>[]; }, db);
  } finally { await conn.end(); }
}

async function withMssql<T>(c: Cfg, fn: (q: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<T>) {
  const mssql = await import('mssql');
  const pool = await new mssql.ConnectionPool({
    server: c.host, port: Number(c.port || 1433), database: c.database, user: c.user, password: c.password,
    options: { encrypt: c.ssl !== 'false', trustServerCertificate: true }, connectionTimeout: 8000, requestTimeout: 30000,
  }).connect();
  try { return await fn(async (sql) => (await pool.request().query(sql)).recordset as Record<string, unknown>[]); } finally { await pool.close(); }
}

async function withSqlite<T>(c: Cfg, fn: (db: import('better-sqlite3').Database) => T): Promise<T> {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(c.path, { readonly: true, fileMustExist: true });
  try { return fn(db); } finally { db.close(); }
}

export async function testSql(kind: string, c: Cfg) {
  if (kind === 'postgres') return withPg(c, async (q) => { const r = await q('select version() v'); return String(r.rows[0].v).slice(0, 60); });
  if (kind === 'mysql') return withMysql(c, async (q) => String((await q('select version() v'))[0].v));
  if (kind === 'mssql') return withMssql(c, async (q) => String((await q('select @@version v'))[0].v).split('\n')[0]);
  if (kind === 'sqlite') return withSqlite(c, (db) => 'SQLite ' + (db.prepare('select sqlite_version() v').get() as { v: string }).v);
  throw new Error('Type SQL inconnu');
}

function group(rows: { t: string; c: string; ty: string; fk?: string | null }[]): TableSchema[] {
  const m = new Map<string, TableSchema>();
  for (const r of rows) {
    if (!m.has(r.t)) m.set(r.t, { name: r.t, columns: [] });
    m.get(r.t)!.columns.push({ name: r.c, type: r.ty, fk: r.fk || undefined });
  }
  return [...m.values()];
}

export async function schemaSql(kind: string, c: Cfg): Promise<TableSchema[]> {
  if (kind === 'postgres') {
    const schema = c.schema || 'public';
    return withPg(c, async (q) => {
      const cols = await q(`select table_name t, column_name c, data_type ty from information_schema.columns where table_schema=$1 order by table_name, ordinal_position`, [schema]);
      const fks = await q(`select kcu.table_name t, kcu.column_name c, ccu.table_name||'.'||ccu.column_name fk
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name and tc.table_schema=kcu.table_schema
        join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name and ccu.table_schema=tc.table_schema
        where tc.constraint_type='FOREIGN KEY' and tc.table_schema=$1`, [schema]);
      const fkm = new Map(fks.rows.map((r) => [`${r.t}.${r.c}`, r.fk as string]));
      return group(cols.rows.map((r) => ({ t: r.t as string, c: r.c as string, ty: r.ty as string, fk: fkm.get(`${r.t}.${r.c}`) })));
    });
  }
  if (kind === 'mysql') {
    return withMysql(c, async (q, db) => {
      const cols = await q('select table_name t, column_name c, data_type ty, column_key k from information_schema.columns where table_schema=? order by table_name, ordinal_position', [db]);
      const fks = await q('select table_name t, column_name c, concat(referenced_table_name,".",referenced_column_name) fk from information_schema.key_column_usage where table_schema=? and referenced_table_name is not null', [db]);
      const fkm = new Map(fks.map((r) => [`${r.t}.${r.c}`, r.fk as string]));
      return group(cols.map((r) => ({ t: r.t as string, c: r.c as string, ty: r.ty as string, fk: fkm.get(`${r.t}.${r.c}`) })));
    });
  }
  if (kind === 'mssql') {
    return withMssql(c, async (q) => {
      const cols = await q(`select table_name t, column_name c, data_type ty from information_schema.columns order by table_name, ordinal_position`);
      const fks = await q(`select tp.name t, cp.name c, tr.name+'.'+cr.name fk from sys.foreign_key_columns fkc
        join sys.tables tp on fkc.parent_object_id=tp.object_id join sys.columns cp on cp.object_id=tp.object_id and cp.column_id=fkc.parent_column_id
        join sys.tables tr on fkc.referenced_object_id=tr.object_id join sys.columns cr on cr.object_id=tr.object_id and cr.column_id=fkc.referenced_column_id`);
      const fkm = new Map(fks.map((r) => [`${r.t}.${r.c}`, r.fk as string]));
      return group(cols.map((r) => ({ t: r.t as string, c: r.c as string, ty: r.ty as string, fk: fkm.get(`${r.t}.${r.c}`) })));
    });
  }
  if (kind === 'sqlite') {
    return withSqlite(c, (db) => {
      const tables = db.prepare("select name from sqlite_master where type in ('table','view') and name not like 'sqlite_%'").all() as { name: string }[];
      return tables.map((t) => {
        const cols = db.prepare(`pragma table_info("${t.name.replace(/"/g, '')}")`).all() as { name: string; type: string }[];
        const fks = db.prepare(`pragma foreign_key_list("${t.name.replace(/"/g, '')}")`).all() as { from: string; table: string; to: string }[];
        return { name: t.name, columns: cols.map((x) => ({ name: x.name, type: x.type || 'any', fk: fks.find((f) => f.from === x.name) ? `${fks.find((f) => f.from === x.name)!.table}.${fks.find((f) => f.from === x.name)!.to}` : undefined })) };
      });
    });
  }
  throw new Error('Type SQL inconnu');
}

export async function querySql(kind: string, c: Cfg, sqlRaw: string): Promise<Record<string, unknown>[]> {
  const sql = assertReadOnly(sqlRaw);
  let rows: Record<string, unknown>[] = [];
  if (kind === 'postgres') rows = await withPg(c, async (q) => (await q(sql)).rows);
  else if (kind === 'mysql') rows = await withMysql(c, async (q) => q(sql));
  else if (kind === 'mssql') rows = await withMssql(c, async (q) => q(sql));
  else if (kind === 'sqlite') rows = await withSqlite(c, (db) => db.prepare(sql).all() as Record<string, unknown>[]);
  else throw new Error('Type SQL inconnu');
  return rows.slice(0, MAX_ROWS).map(sanitize);
}

function sanitize(r: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) o[k] = typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString().slice(0, 10) : Buffer.isBuffer(v) ? '[binary]' : v;
  return o;
}
