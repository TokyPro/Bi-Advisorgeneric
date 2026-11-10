import { describe, expect, it } from 'vitest';
import { ReadOnlyError, assertReadOnly, maskSql, type SqlDialect } from '@/server/connectors/sql-guard';

/**
 * US-4 : garde-fou lecture seule (ADR-S3-01). Cas portés des scripts de preuve des itérations 2 à 4
 * (guard2, guard3, guard4), des sondes du reviewer (rev2/rev3/rev4) et du prototype d'arbitrage (arb/proto).
 */
const DIALECTS: SqlDialect[] = ['postgres', 'mysql', 'mssql', 'sqlite'];
const BS = String.fromCharCode(92);
const E9 = /^Caractère de contrôle non autorisé/;
const E4 = /^Requête SQL mal formée/;

type Refus = [SqlDialect, string, (RegExp | string)?];

function expectRefused(d: SqlDialect, sql: string, message?: RegExp | string) {
  let error: unknown;
  try { assertReadOnly(sql, d); } catch (e) { error = e; }
  expect(error, `devrait être refusé (${d}) : ${JSON.stringify(sql)}`).toBeInstanceOf(ReadOnlyError);
  if (typeof message === 'string') expect((error as Error).message).toContain(message);
  else if (message) expect((error as Error).message).toMatch(message);
}
const expectAccepted = (d: SqlDialect, sql: string) => { expect(() => assertReadOnly(sql, d), `devrait être accepté (${d}) : ${JSON.stringify(sql)}`).not.toThrow(); };

describe('US-4 / Gherkin « Requêtes refusées avant exécution »', () => {
  const cases: Refus[] = [
    ['mssql', 'SELECT * INTO copie FROM clients', 'Mot-clé ou fonction interdit (INTO)'],
    ['mssql', "SELECT * FROM OPENROWSET('SQLNCLI','...','SELECT 1')", 'Mot-clé ou fonction interdit (OPENROWSET)'],
    ['mssql', "SELECT * FROM OPENQUERY(lnk,'SELECT 1')", 'Mot-clé ou fonction interdit (OPENQUERY)'],
    ['mssql', "SELECT 1; EXEC xp_cmdshell 'dir'", 'Une seule instruction SQL est autorisée.'],
    ['mysql', "SELECT * FROM t INTO DUMPFILE '/tmp/x'", 'Mot-clé ou fonction interdit (INTO)'],
    ['mysql', "SELECT LOAD_FILE('/etc/passwd')", 'Mot-clé ou fonction interdit (LOAD_FILE)'],
    ['mysql', "SELECT 'a" + BS + "'; DELETE FROM t; -- '", 'barre oblique inverse'],
    ['mysql', 'SELECT 1 /*! , SLEEP(10) */', 'Commentaires /* */ non autorisés'],
    ['mysql', 'SELECT * FROM t FOR UPDATE', 'Mot-clé ou fonction interdit (FOR UPDATE)'],
    ['postgres', "SELECT pg_read_file('/etc/passwd')", 'Mot-clé ou fonction interdit (PG_READ_FILE)'],
    ['postgres', 'SELECT pg_terminate_backend(123)', 'Mot-clé ou fonction interdit (PG_TERMINATE_BACKEND)'],
    ['postgres', "SELECT * FROM dblink('host=x','select 1') AS t(a int)", 'Mot-clé ou fonction interdit (DBLINK)'],
    ['postgres', 'SELECT 1; DELETE FROM t', 'Une seule instruction SQL est autorisée.'],
    ['postgres', 'SHOW ALL', 'Seules les requêtes en lecture (SELECT) sont autorisées.'],
    ['sqlite', "SELECT load_extension('x')", 'Mot-clé ou fonction interdit (LOAD_EXTENSION)'],
    ['postgres', "SELECT 'abc", 'Requête SQL mal formée'],
  ];
  it.each(cases)('%s : %s', (d, sql, msg) => expectRefused(d, sql, msg));
});

describe('US-4 / Gherkin « Faux positifs évités »', () => {
  const cases: [SqlDialect, string][] = [
    ['postgres', "SELECT 'delete; drop' AS libelle"],
    ['postgres', 'SELECT "into" FROM t'],
    ['mysql', 'SELECT `update` FROM t'],
    ['mssql', 'SELECT [call] FROM t'],
    ['mssql', 'SELECT * FROM #temp_ventes'],
    ['postgres', 'SELECT $$a;b$$ AS x'],
    ['postgres', "-- total par mois\nSELECT date_trunc('month', d), sum(m) FROM v GROUP BY 1"],
    ['mysql', 'SELECT deleted_at, updated_by FROM t'],
    ['postgres', 'SELECT 1;'],
  ];
  it.each(cases)('%s : %s', expectAccepted);
});

describe('Itération 2 — CR-1 (transactions, DENY, WRITETEXT, SELECT multiples…) et CR-6', () => {
  const m = (s: string): Refus => ['mssql', s];
  const cases: Refus[] = [
    m('SELECT 1 COMMIT'), m('SELECT 1 COMMIT DENY SELECT ON t TO public'), m('SELECT 1 ROLLBACK DISABLE TRIGGER ALL ON t'),
    m("SELECT 1 WRITETEXT t.c 0x00 'x'"), m('SELECT 1 RECEIVE * FROM q'), m('SELECT * FROM t SELECT 2'),
    m('SELECT 1 SAVE TRAN x'), m('SELECT 1 BEGIN TRAN'), m('SELECT 1 UPDATETEXT t.c 0 0 x'), m('SELECT 1 SEND ON CONVERSATION @h'),
    m('SELECT 1 END CONVERSATION @h'), m('SELECT 1 USE master'), m('SELECT 1 ENABLE TRIGGER x ON t'), m('SELECT 1 SETUSER'),
    m('SELECT 1 REVERT'), m('SELECT 1 CHECKPOINT'), m('SELECT 1 OPEN SYMMETRIC KEY k DECRYPTION BY PASSWORD = 1'), m('SELECT 1 WHILE 1=1 PRINT 1'),
    m('WITH x AS (SELECT 1 a) SELECT * FROM x SELECT 2'), m('(SELECT 1) SELECT 2'), m('SELECT 1 GRANT SELECT ON t TO public'), m('SELECT 1 REVOKE SELECT ON t FROM public'),
    m("SELECT * FROM sys.fn_xe_file_target_read_file('c:" + BS + "x',null,null,null)"), m('SELECT * FROM fn_dblog(NULL,NULL)'),
    m("SELECT * FROM fn_get_audit_file('x',default,default)"), m("SELECT * FROM fn_trace_gettable('x',1)"),
    ['postgres', 'SELECT 1 COMMIT'], ['postgres', "SELECT pg_notify('c','x')"], ['postgres', "SELECT pg_file_write('x','y',false)"],
    ['postgres', "SELECT pg_file_unlink('x')"], ['postgres', 'SELECT * FROM pg_ls_logdir()'], ['postgres', 'SELECT pg_stat_reset()'],
    ['postgres', 'SELECT pg_switch_wal()'], ['postgres', 'SELECT pg_promote()'], ['postgres', "SELECT pg_create_restore_point('x')"],
    ['postgres', 'SELECT lo_create(0)'], ['postgres', "SELECT lo_from_bytea(0,'x')"], ['postgres', 'SELECT lo_put(1,0,null)'],
    ['mysql', 'SELECT 1 FROM t PROCEDURE ANALYSE()'], ['mysql', "SELECT master_pos_wait('f',1)"], ['mysql', "SELECT source_pos_wait('f',1)"],
    ['sqlite', 'SELECT 1 SAVEPOINT a'], ['mysql', 'SELECT 1 RELEASE SAVEPOINT a'],
    // Durcissements annoncés (dev-notes § 2, écart 12) : identifiant cité suivi de « ( », littéraux U&.
    ['postgres', 'SELECT "pg_sleep"(10)'], ['postgres', "SELECT U&'" + BS + "0070g_sleep'"], ['postgres', 'SELECT U&"d" FROM t'],
  ];
  it.each(cases)('refus %s : %s', (d, sql, msg) => expectRefused(d, sql, msg));

  const accept: [SqlDialect, string][] = [
    ['mssql', 'SELECT a FROM t UNION ALL SELECT b FROM u EXCEPT SELECT c FROM v INTERSECT SELECT d FROM w'],
    ['mssql', 'WITH x AS (SELECT 1 a), y AS (SELECT 2 b) SELECT * FROM x UNION SELECT * FROM y'],
    ['mssql', 'SELECT * FROM t ORDER BY a OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY'],
    ['mssql', 'SELECT * FROM t WITH (NOLOCK) WHERE a IN (SELECT b FROM u)'],
    ['postgres', '(SELECT 1) UNION (SELECT 2)'],
    ['postgres', 'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n < 5) SELECT * FROM r'],
    ['mysql', 'SELECT a FROM t UNION DISTINCT SELECT b FROM u'],
    ['mssql', 'SELECT [open], [close], begin_date, release_date, saved FROM prix'],
    ['postgres', 'SELECT "commit" FROM t'],
    ['mssql', 'SELECT CASE WHEN a > 1 THEN 1 ELSE 0 END FROM t'],
    ['postgres', 'SELECT EXISTS (SELECT 1 FROM t), (SELECT max(a) FROM u)'],
    ['postgres', "SELECT 'a" + BS + "' AS x"],
    // CR-4 : l'analyseur seul accepte ce cas ; la garantie vient de standard_conforming_strings=on imposé et vérifié par sql.ts (non exécutable sans PostgreSQL réel).
    ['postgres', "SELECT 'a" + BS + "'' , pg_sleep(10) -- '"],
    ['postgres', 'WITH a AS (SELECT 1), b AS (WITH c AS (SELECT 2) SELECT * FROM c) SELECT * FROM a, b'],
    ['postgres', 'SELECT * FROM t, LATERAL (SELECT 1) s'],
    ['mssql', 'SELECT a FROM t ORDER BY a OFFSET 0 ROWS FETCH FIRST 5 ROWS ONLY'],
    ['mysql', 'SELECT a FROM t1 UNION ALL (SELECT b FROM t2)'],
    ['postgres', "SELECT x ~ '^" + BS + "d+$' FROM t"],
    ['mssql', "WITH XMLNAMESPACES ('u' AS p) SELECT 1"],
    ['postgres', 'SELECT "release" FROM versions'],
    ['mssql', 'SELECT [enable] FROM flags'],
  ];
  it.each(accept)('accepté %s : %s', expectAccepted);

  // Mots réservés refusés par conception (CR-1) : le message invite à citer l'identifiant (documenté dans les notes de migration du README).
  it.each<[SqlDialect, string, string]>([
    ['postgres', 'SELECT release FROM versions', 'RELEASE'],
    ['mssql', 'SELECT enable FROM flags', 'ENABLE'],
  ])('colonne non citée refusée par conception %s : %s', (d, sql, word) => expectRefused(d, sql, `Mot-clé ou fonction interdit (${word}) : le connecteur est en lecture seule. Si c'est un nom de colonne, placez-le entre guillemets.`));
});

describe('Itération 3 — CR-13 (nombres collés aux mots-clés, T-SQL) et CR-15 (RAISERROR, ADD)', () => {
  const m = (s: string): Refus => ['mssql', s];
  const cases: Refus[] = [
    m('SELECT 1COMMIT'), m('SELECT 1ROLLBACK'), m('SELECT 1COMMIT PRINT 1DELETE t'), m('SELECT 1COMMIT IF 1=1TRUNCATE TABLE t'),
    m('SELECT 1COMMIT IF 1=1DROP TABLE t'), m('SELECT 1COMMIT IF 1=0x00TRUNCATE TABLE t'), m('SELECT 1COMMIT IF 1=1UPDATETEXT t.c 0 0 0x00'),
    m("SELECT 1WRITETEXT t.c 0x00 'x'"), m('SELECT .5COMMIT'), m('SELECT 1e1COMMIT'), m('SELECT 1.5COMMIT'), m('SELECT $1COMMIT'),
    m('SELECT 1 FROM t WHERE a=1SELECT 2'),
    m('SELECT 0x1FTRUNCATE TABLE t'), m('SELECT 0xTRUNCATE TABLE t'), m('SELECT 1.COMMIT'), m('SELECT 1e+5COMMIT'), m('SELECT 1.5E-3COMMIT'),
    m('SELECT $.5COMMIT'), m('SELECT $1.50COMMIT'), m('SELECT €1COMMIT'), m('SELECT t.1COMMIT'), m('SELECT 1_x'), m('SELECT 0x00SELECT 2'),
    m('SELECT a FROM t WHERE b IN (1,2)2SELECT 2'), m('SELECT 1e'), m('SELECT 1@x'), m('SELECT 1#x'),
    m("SELECT N'x'COMMIT"), m("SELECT 'x'COMMIT"), m('SELECT [a]COMMIT'), m('SELECT "a"COMMIT'), m('SELECT $COMMIT'), m("SELECT 'x'SELECT 2"), m('SELECT [a]SELECT 2'),
    m("SELECT 1 RAISERROR('x',10,1) WITH LOG"), m('SELECT 1 ADD SIGNATURE TO p BY CERTIFICATE c'), m('SELECT 1 ADD COUNTER SIGNATURE TO p BY CERTIFICATE c'),
    // Sondes rev3 : variantes Unicode / casse
    m('SELECT 0X1FCOMMIT'), m('SELECT 1E1COMMIT'), m('SELECT ١COMMIT'), m('SELECT １COMMIT'), m('SELECT 1KCOMMIT'), m('SELECT 1.5.5COMMIT'), m('SELECT 1-1COMMIT'),
  ];
  it.each(cases)('refus %s : %s', (d, sql, msg) => expectRefused(d, sql, msg));

  const accept: [SqlDialect, string][] = [
    ['mssql', 'SELECT 1e5, 0x1F, $10, .5, t1.col2 FROM t3'], ['mssql', 'SELECT TOP 10 col2 FROM t3 WHERE c1=0x1F'],
    ['mssql', 'SELECT 1e3, 0x1F, .5, $1.50, 1.5E-3, 1.5e+3, $.5, 1.'],
    ['mssql', 'SELECT * FROM t ORDER BY a OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY'], ['mssql', 'SELECT a FROM t3 WHERE b=-1 AND c<>2 AND d IN (1,2,3)'],
    ['mssql', 'SELECT @v1, @@ROWCOUNT, a$1, t2.c3 FROM #tmp1 JOIN ##g2 ON 1=1'], ['mssql', 'SELECT [2023_ventes].[1col] FROM [2023_ventes]'],
    ['mssql', "SELECT DATEADD(day, 1, d), 'x1commit' AS l FROM t"], ['mssql', 'SELECT 1+1, 2*3, 4/2, 5%2, (1) FROM t'], ['mssql', 'SELECT 0x, 0xABCDEF FROM t'],
    ['mssql', 'SELECT a FROM t WHERE x = 1 -- 1commit'], ['mssql', "SELECT N'1COMMIT' AS t"], ['mssql', 'SELECT $PARTITION.pf(c), $IDENTITY FROM t'],
    ['mysql', 'SELECT 2023_ventes FROM t'], ['postgres', 'SELECT 1e5, 0x1F FROM t'], ['sqlite', 'SELECT 1, 2.5 FROM t'],
    ['mssql', 'SELECT DATEADD(day,1,d), date_add_x, added, address, add_col FROM t'], ['mssql', 'SELECT [add], [raiserror] FROM t'],
    ['mssql', 'SELECT TOP 5 * FROM t WHERE c >= 1.5e-3 AND d=0xFF'], ['mssql', 'SELECT CAST(1 AS decimal(10,2)), 1.0/3 FROM t'],
    ['mssql', 'SELECT année1x FROM t'], ['mssql', "SELECT N'é' FROM t2"], ['mssql', 'SELECT x.[1a] FROM t x'], ['mssql', 'SELECT 1 AS [1x]'],
  ];
  it.each(accept)('accepté %s : %s', expectAccepted);
});

describe('Itération 4 — CR-16 (caractères de contrôle, E-SQL-9) et CR-17 (parenthèses, E-SQL-4)', () => {
  const cases: Refus[] = [
    ['postgres', "SELECT 1 AS a --x\r, pg_read_file('/etc/passwd') AS b\nFROM t", E9],
    ['postgres', "SELECT 1 AS a --x\r, dblink('host=10.0.0.1 dbname=x','select 1') AS b\nFROM t", E9],
    ['postgres', "SELECT 1 AS a --x\r, dblink_exec('dbname=x','DELETE FROM t') AS b\nFROM t", E9],
    ['postgres', 'SELECT 1 AS a --x\r, pg_terminate_backend(pid) AS b FROM pg_stat_activity\nLIMIT 10', E9],
    ['mssql', 'SELECT 1 AS a --x\rCOMMIT DELETE t\nFROM u', E9],
    ['mysql', "SELECT 1 -- x\r' \n, sleep(10) -- '", E9],
    ...DIALECTS.flatMap((d): Refus[] => [
      [d, "SELECT 'a\rb' AS x", E9],
      ...['\u0085', '\u{2028}', '\u{2029}', '\f', '\v', '\0'].map((c): Refus => [d, `SELECT 1 AS a --x${c}, 2\nFROM t`, E9]),
      [d, 'SELECT 1\0 FROM t', E9],
      [d, 'SELECT 1) SELECT 2', E4],
      [d, 'SELECT 1)) SELECT 2 ((', E4],
      [d, 'SELECT 1)SELECT 2', E4],
      // Sondes rev4 : variantes (\r\r\n, DEL, C1, ESC, \r au milieu)
      [d, 'SELECT 1 AS a --x\r\r\nFROM t', E9], [d, 'SELECT 1 AS a --x\u{2028}\nFROM t', E9], [d, 'SELECT 1 AS a\u0085FROM t', E9],
      [d, 'SELECT 1 AS a\u007f FROM t', E9], [d, 'SELECT 1 AS a\u009f FROM t', E9], [d, 'SELECT 1 AS a\u001b FROM t', E9],
      [d, 'SELECT 1 AS a \r FROM t', E9], [d, 'SELECT 1 FROM t) UNION (SELECT 2', E4],
    ]),
  ];
  it.each(cases)('refus %s : %j', (d, sql, msg) => expectRefused(d, sql, msg));

  const accept = DIALECTS.flatMap((d): [SqlDialect, string, string?][] => [
    [d, 'SELECT 1 AS n -- note\r\nFROM t'],
    [d, 'SELECT a,\r\n  b\r\nFROM t\r\nWHERE x IN (1,2)\r\n', 'SELECT a,\r\n  b\r\nFROM t\r\nWHERE x IN (1,2)'],
    [d, 'SELECT\tx FROM t\n', 'SELECT\tx FROM t'],
    [d, 'SELECT 1 AS a\r', 'SELECT 1 AS a'],
    [d, 'WITH c AS (SELECT 1 AS x) SELECT x FROM c'],
    [d, '(SELECT 1) UNION (SELECT 2)'],
    [d, 'SELECT \')\' AS p, "a)" FROM t'],
    [d, 'SELECT 1 -- )\nFROM t'],
    [d, "SELECT 'é ✓ 中文' AS u"],
    // Sondes rev4
    [d, '\r\n\u{2028}SELECT 1 AS a\u{2029}\r', 'SELECT 1 AS a'],
    [d, 'SELECT 1 AS a -- x\r\n-- y\r\nFROM t'],
    [d, "SELECT '(' AS p FROM t"],
    [d, 'SELECT (((1))) FROM t'],
  ]);
  it.each(accept)('acceptation %s : %j', (d, sql, expected) => { expect(assertReadOnly(sql, d)).toBe(expected ?? sql); });

  it('invariant : le texte renvoyé pour exécution ne contient jamais de caractère interdit (4 dialectes)', () => {
    const forbidden = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u{2028}\u{2029}]|\r(?!\n)/u;
    for (const d of DIALECTS) {
      for (const q of ['SELECT 1 AS a\r\n', '\r\n\u{2028}SELECT 1 AS a\u{2029}\r', 'SELECT 1 AS a -- x\r\n-- y\r\nFROM t', 'SELECT\tx FROM t\n']) {
        expect(assertReadOnly(q, d)).not.toMatch(forbidden);
      }
    }
  });
});

describe("Cas résiduels documentés (acceptés par la revue / l'arbitrage, non exploitables)", () => {
  // Acceptations connues (dev-notes it.3 écart 2, it.4 écart 2) : le test les fige pour détecter tout changement de comportement.
  it.each<[SqlDialect, string]>([
    ['postgres', 'SELECT 1pg_sleep(10)'],
    ['mssql', 'SELECT 1 IF 1=1 PRINT 1'],
    ['mssql', 'SELECT 1 FETCH NEXT FROM gcur'],
    ['mssql', 'SELECT a$1COMMIT'],
  ])('accepté (résiduel connu) %s : %s', expectAccepted);
});

describe('Limites et masquage', () => {
  it('refuse une requête vide', () => { for (const d of DIALECTS) expectRefused(d, '   '); });
  it('refuse une requête de plus de 20 000 caractères', () => {
    expectRefused('postgres', 'SELECT ' + '1,'.repeat(10_001) + '1', 'Requête trop longue (20 000 caractères maximum).');
  });
  it('maskSql neutralise littéraux, identifiants cités et commentaires', () => {
    const masked = maskSql("SELECT 'delete' AS \"drop\" -- truncate\nFROM t", 'postgres');
    expect(masked).not.toMatch(/delete|drop|truncate/i);
    expect(masked).toMatch(/FROM t/);
  });
});
