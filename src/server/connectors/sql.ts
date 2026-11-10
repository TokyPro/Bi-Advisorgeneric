import net from 'node:net';
import type { TableSchema } from '@/lib/types';
import { assertHostSyntax, assertAddressAllowed, resolveAllowed, NetworkPolicyError, INVALID_HOST } from '../net/policy';
import { assertReadOnly, MAX_ROWS, QUERY_TIMEOUT_MS, QUERY_TIMEOUT_MESSAGE, ReadOnlyError, type SqlDialect } from './sql-guard';
import { resolveSqlitePath } from './sqlite-path';

export { assertReadOnly } from './sql-guard';

type Cfg = Record<string, string>;
const DIALECTS: SqlDialect[] = ['postgres', 'mysql', 'mssql', 'sqlite'];
const DEFAULT_PORT: Record<string, number> = { postgres: 5432, mysql: 3306, mssql: 1433 };
const CONNECTION_STRING_REFUSED = "Chaîne de connexion non prise en charge : renseignez l'hôte, le port et les identifiants.";

/**
 * Destination d'une base serveur : la chaîne de connexion est refusée (elle permettrait des options dangereuses :
 * multipleStatements, socket Unix…), l'hôte est validé puis résolu une seule fois, et le pilote se connecte à l'adresse
 * vérifiée (épinglage, anti DNS-rebinding).
 */
async function sqlTarget(kind: string, c: Cfg): Promise<{ host: string; address: string; port: number; instanceName?: string }> {
  if (c.url) throw new Error(CONNECTION_STRING_REFUSED);
  let raw = String(c.host ?? '').trim();
  let instanceName: string | undefined;
  if (kind === 'mssql' && raw.includes('\\')) {
    const [h, inst, extra] = raw.split('\\');
    if (extra !== undefined || !/^[A-Za-z0-9_$]{1,16}$/.test(inst)) throw new NetworkPolicyError(INVALID_HOST);
    raw = h;
    instanceName = inst;
  }
  const host = assertHostSyntax(raw);
  const p = String(c.port ?? '').trim();
  const port = p ? Number(p) : DEFAULT_PORT[kind];
  if (!/^\d{1,5}$/.test(String(port)) || port < 1 || port > 65535) throw new Error('Port invalide.');
  const { address } = await resolveAllowed(host, port);
  return { host, address, port, instanceName };
}

const timeoutError = () => new Error(QUERY_TIMEOUT_MESSAGE);

/* -------------------------------------------------------------- PostgreSQL */
async function withPg<T>(c: Cfg, fn: (client: import('pg').Client) => Promise<T>) {
  const t = await sqlTarget('postgres', c);
  const { Client } = await import('pg');
  const client = new Client({
    host: t.address, port: t.port, database: c.database, user: c.user, password: c.password,
    // La connexion se fait sur l'IP vérifiée : le nom d'origine est conservé pour le SNI.
    ssl: c.ssl === 'true' ? { rejectUnauthorized: false, ...(net.isIP(t.host) ? {} : { servername: t.host }) } : undefined,
    connectionTimeoutMillis: 8000, statement_timeout: QUERY_TIMEOUT_MS, query_timeout: QUERY_TIMEOUT_MS + 5000,
    idle_in_transaction_session_timeout: 60_000, application_name: 'bi-advisor',
    // L'analyseur de sql-guard suppose `\` littéral hors E'…' : paramètre de démarrage, prioritaire sur les réglages de base et de rôle.
    options: '-c standard_conforming_strings=on',
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    // Un intermédiaire (pooler) peut ignorer le paramètre de démarrage : on vérifie avant toute requête utilisateur,
    // dans la transaction, qui garantit la même connexion serveur que la requête (pooler en mode transaction).
    const scs = (await client.query('SHOW standard_conforming_strings')).rows[0]?.standard_conforming_strings;
    if (scs !== 'on') throw new ReadOnlyError('PostgreSQL : le paramètre standard_conforming_strings doit valoir « on » pour ce connecteur.');
    return await fn(client);
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* connexion déjà rompue (délai, erreur) : rien à annuler */ }
    await client.end();
  }
}

async function queryPg(client: import('pg').Client, sql: string) {
  // Protocole étendu : une seule instruction ; DECLARE … CURSOR FOR n'accepte qu'un SELECT/VALUES (refuse les WITH modifiants).
  await client.query({ text: `DECLARE bia_cur NO SCROLL CURSOR FOR ${sql}`, queryMode: 'extended' } as import('pg').QueryConfig);
  return (await client.query(`FETCH FORWARD ${MAX_ROWS + 1} FROM bia_cur`)).rows as Record<string, unknown>[];
}

/* ------------------------------------------------------------ MySQL/MariaDB */
type MysqlCore = import('mysql2').Connection;
type MysqlQuery = (sql: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;

async function withMysql<T>(c: Cfg, fn: (q: MysqlQuery, db: string, core: MysqlCore, markDestroyed: () => void) => Promise<T>) {
  const t = await sqlTarget('mysql', c);
  const mysql = await import('mysql2');
  // -LOCAL_FILES : un serveur malveillant ne peut pas réclamer la lecture d'un fichier local (LOAD DATA LOCAL).
  const core = mysql.createConnection({ host: t.address, port: t.port, user: c.user, password: c.password, database: c.database, connectTimeout: 8000, multipleStatements: false, flags: ['-LOCAL_FILES'] });
  // Sans écouteur, une erreur fatale hors commande à rappel (flux, connexion coupée) est levée sur l'émetteur et arrête le processus.
  // Les commandes en cours reçoivent déjà l'erreur (rappel ou écouteur de streamMysql) : rien à faire ici.
  core.on('error', () => undefined);
  const conn = core.promise();
  let destroyed = false;
  const q: MysqlQuery = async (sql, p) => { const [rows] = await conn.query(sql, p); return rows as Record<string, unknown>[]; };
  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    await conn.query('START TRANSACTION READ ONLY');
    try { await conn.query('SET SESSION max_execution_time = 30000'); }
    catch {
      // MariaDB : variable différente (en secondes). Si les deux échouent, le délai client de streamMysql s'applique.
      await conn.query('SET SESSION max_statement_time = 30').catch(() => undefined);
    }
    const [[{ db }]] = (await conn.query('SELECT DATABASE() AS db')) as unknown as [[{ db: string }]];
    return await fn(q, db, core, () => { destroyed = true; });
  } finally {
    if (!destroyed) {
      try { await conn.query('ROLLBACK'); } catch { /* connexion déjà rompue : rien à annuler */ }
      await conn.end().catch(() => core.destroy());
    }
  }
}

/** Lecture en flux, interrompue dès MAX_ROWS + 1 lignes (un LIMIT explicite l'emporte sur sql_select_limit). */
function streamMysql(core: MysqlCore, sql: string, markDestroyed: () => void): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, unknown>[] = [];
    let settled = false;
    const stop = () => {
      markDestroyed();
      // destroy() de mysql2 ne fait qu'un end() : la socket doit être détruite pour cesser de recevoir le reste du résultat.
      core.destroy();
      (core as unknown as { stream?: { destroy(): void } }).stream?.destroy();
    };
    const timer = setTimeout(() => { if (!settled) { settled = true; stop(); reject(timeoutError()); } }, QUERY_TIMEOUT_MS + 5000);
    const onFatal = (err: Error) => done(err);
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      core.off('error', onFatal);
      if (err) reject(err); else resolve(rows);
    };
    core.on('error', onFatal);
    core.query(sql)
      .on('result', (row) => {
        if (settled) return;
        rows.push(row as Record<string, unknown>);
        if (rows.length > MAX_ROWS) { stop(); done(); }
      })
      .on('error', (err) => done(err))
      .on('end', () => done());
  });
}

/* --------------------------------------------------------------- SQL Server */
type SqlTarget = Awaited<ReturnType<typeof sqlTarget>>;

/**
 * Connecteur tedious : chaque socket TDS passe par la politique réseau, y compris celle ouverte après un jeton de routage
 * (ENVCHANGE) ou sur le port annoncé par SQL Browser (instance nommée), que tedious ouvrirait sinon sans contrôle.
 */
function mssqlConnector(t: SqlTarget, onRefused: (e: NetworkPolicyError) => void) {
  return async (opts: { host: string; port: number }, _lookup: unknown, signal?: AbortSignal): Promise<net.Socket> => {
    let address: string;
    try {
      if (opts.host === t.address) {
        // Cible épinglée : seul le port peut différer de celui contrôlé dans sqlTarget (instance nommée).
        assertAddressAllowed(t.host, opts.port, t.address);
        address = t.address;
      } else {
        address = (await resolveAllowed(opts.host, opts.port)).address;
      }
    } catch (e) {
      if (e instanceof NetworkPolicyError) onRefused(e);
      throw e;
    }
    signal?.throwIfAborted();
    return new Promise<net.Socket>((resolve, reject) => {
      const socket = net.connect({ host: address, port: opts.port });
      const cleanup = () => { signal?.removeEventListener('abort', onAbort); socket.removeListener('error', onError); };
      const onAbort = () => { cleanup(); socket.destroy(); reject(signal?.reason); };
      const onError = (e: Error) => { cleanup(); reject(e); };
      signal?.addEventListener('abort', onAbort, { once: true });
      socket.once('error', onError);
      socket.once('connect', () => { cleanup(); resolve(socket); });
    });
  };
}

const TX_ESCAPED = 'Requête refusée : elle a modifié l’état transactionnel de la session.';

async function withMssql<T>(c: Cfg, fn: (tx: import('mssql').Transaction, mssql: typeof import('mssql')) => Promise<T>) {
  const t = await sqlTarget('mssql', c);
  const mssql = await import('mssql');
  // tedious enveloppe l'erreur du connecteur dans un message citant hôte et port : on renvoie le refus d'origine.
  let refused: NetworkPolicyError | undefined;
  const pool = await new mssql.ConnectionPool({
    server: t.address, port: t.instanceName ? undefined : t.port, database: c.database, user: c.user, password: c.password,
    pool: { max: 1 },
    options: {
      encrypt: c.ssl !== 'false', trustServerCertificate: true, readOnlyIntent: true, instanceName: t.instanceName,
      // SNI sur le nom d'origine malgré l'IP épinglée (passerelles qui routent par nom, ex. Azure SQL).
      ...(net.isIP(t.host) ? {} : { serverName: t.host }),
      // Le typage de tedious déclare `() => Promise<Socket>`, mais le pilote appelle bien connector(options, lookup, signal).
      connector: mssqlConnector(t, (e) => { refused = e; }) as unknown as () => Promise<net.Socket>,
    },
    connectionTimeout: 8000, requestTimeout: QUERY_TIMEOUT_MS,
  }).connect().catch((e: unknown) => { throw refused ?? e; });
  try {
    const tx = new mssql.Transaction(pool);
    await tx.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED);
    try {
      const result = await fn(tx, mssql);
      // Défense en profondeur : un COMMIT / ROLLBACK / BEGIN échappé au filtre change @@TRANCOUNT ; le résultat est alors rejeté.
      const [state] = await mssqlRows(tx, mssql, 'SELECT @@TRANCOUNT AS n');
      if (state?.n !== 1) throw new ReadOnlyError(TX_ESCAPED);
      return result;
    }
    // Toujours annulée : une écriture qui aurait échappé au filtre (ex. SELECT INTO) n'est jamais validée.
    finally { try { await tx.rollback(); } catch { /* transaction déjà annulée par le serveur (erreur, délai) */ } }
  } finally {
    await pool.close();
  }
}
const mssqlRows = async (tx: import('mssql').Transaction, mssql: typeof import('mssql'), sql: string) =>
  (await new mssql.Request(tx).query(sql)).recordset as Record<string, unknown>[];

/* ------------------------------------------------------------------- SQLite */
async function withSqlite<T>(c: Cfg, fn: (db: import('better-sqlite3').Database) => T): Promise<T> {
  // Seul le chemin réel confiné à BI_SQLITE_DIR est ouvert, jamais la saisie brute.
  const file = resolveSqlitePath(c.path);
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try { db.pragma('query_only = ON'); return fn(db); } finally { db.close(); }
}

/* ------------------------------------------------------------------- Accès */
export async function testSql(kind: string, c: Cfg) {
  if (kind === 'postgres') return withPg(c, async (client) => String((await client.query('select version() v')).rows[0].v).slice(0, 60));
  if (kind === 'mysql') return withMysql(c, async (q) => String((await q('select version() v'))[0].v));
  if (kind === 'mssql') return withMssql(c, async (tx, mssql) => String((await mssqlRows(tx, mssql, 'select @@version v'))[0].v).split('\n')[0]);
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
    return withPg(c, async (client) => {
      const cols = await client.query(`select table_name t, column_name c, data_type ty from information_schema.columns where table_schema=$1 order by table_name, ordinal_position`, [schema]);
      const fks = await client.query(`select kcu.table_name t, kcu.column_name c, ccu.table_name||'.'||ccu.column_name fk
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
    return withMssql(c, async (tx, mssql) => {
      const cols = await mssqlRows(tx, mssql, `select table_name t, column_name c, data_type ty from information_schema.columns order by table_name, ordinal_position`);
      const fks = await mssqlRows(tx, mssql, `select tp.name t, cp.name c, tr.name+'.'+cr.name fk from sys.foreign_key_columns fkc
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
  const dialect = DIALECTS.find((d) => d === kind);
  if (!dialect) throw new Error('Type SQL inconnu');
  const sql = assertReadOnly(sqlRaw, dialect);
  let rows: Record<string, unknown>[];
  if (dialect === 'postgres') rows = await withPg(c, (client) => queryPg(client, sql));
  else if (dialect === 'mysql') {
    rows = await withMysql(c, async (q, _db, core, markDestroyed) => {
      await q(`SET SESSION sql_select_limit = ${MAX_ROWS + 1}`);
      return streamMysql(core, sql, markDestroyed);
    });
  } else if (dialect === 'mssql') {
    rows = await withMssql(c, async (tx, mssql) => {
      await new mssql.Request(tx).batch(`SET ROWCOUNT ${MAX_ROWS + 1}`);
      return mssqlRows(tx, mssql, sql);
    });
  } else {
    rows = await withSqlite(c, (db) => {
      const stmt = db.prepare(sql); // lève si plusieurs instructions
      if (!stmt.reader || !stmt.readonly) throw new ReadOnlyError('Seules les requêtes en lecture (SELECT) sont autorisées.');
      const out: Record<string, unknown>[] = [];
      for (const r of stmt.iterate()) { out.push(r as Record<string, unknown>); if (out.length > MAX_ROWS) break; }
      return out;
    });
  }
  // La ligne MAX_ROWS + 1 ne sert qu'à détecter la troncature (indicateur UI prévu en suite).
  return rows.slice(0, MAX_ROWS).map(sanitize);
}

function sanitize(r: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) o[k] = typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString().slice(0, 10) : Buffer.isBuffer(v) ? '[binary]' : v;
  return o;
}
