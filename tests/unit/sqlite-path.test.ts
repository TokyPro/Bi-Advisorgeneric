import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlitePathError, resolveSqlitePath } from '@/server/connectors/sqlite-path';
import { friendly, query, schema, test as testConnector } from '@/server/connectors';

/**
 * US-2 : confinement SQLite. Tout se passe dans un dossier temporaire du système ; ni data/ ni .env* ne sont touchés.
 * Les liens sont créés avec les moyens du système : jonction de répertoire sous Windows (aucun privilège), lien symbolique sinon.
 */
const DISABLED = "SQLite est désactivé sur ce serveur : l'administrateur doit définir BI_SQLITE_DIR.";
const REFUSED = 'Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé.';
const NOT_FOUND = 'Fichier SQLite introuvable dans le dossier autorisé.';
const BAD_CONFIG = 'Configuration SQLite invalide.';
const BS = String.fromCharCode(92);
const pe = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

let tmp = '';
let dir = '';
let env: NodeJS.ProcessEnv;
let junctionOk = false;

const message = (input: string, e: NodeJS.ProcessEnv = env) => { try { resolveSqlitePath(input, e); return 'OK'; } catch (x) { expect(x).toBeInstanceOf(SqlitePathError); return (x as Error).message; } };

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bia-qa-sqlite-')));
  dir = path.join(tmp, 'bases');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ventes.sqlite'), '');
  fs.writeFileSync(path.join(dir, 'sub', 'b.db'), '');
  fs.writeFileSync(path.join(dir, 'v3.SQLITE3'), '');
  fs.writeFileSync(path.join(dir, '..x.db'), '');
  fs.mkdirSync(path.join(tmp, 'outside'));
  fs.writeFileSync(path.join(tmp, 'outside', 'x.sqlite'), '');
  fs.mkdirSync(path.join(tmp, 'data'));
  fs.writeFileSync(path.join(tmp, 'data', 'users.json'), '{}');
  env = pe({ BI_SQLITE_DIR: dir, BI_DATA_DIR: path.join(tmp, 'data') });

  // Jonction de répertoire sortante (Windows : sans privilège ; ailleurs : lien symbolique de dossier).
  try { fs.symlinkSync(path.join(tmp, 'outside'), path.join(dir, 'sous-dossier-lie'), 'junction'); junctionOk = true; } catch { junctionOk = false; }
});
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('US-2 / SQLite désactivé et configuration', () => {
  it('BI_SQLITE_DIR absent ou vide : message de désactivation exact', () => {
    expect(message('demo.sqlite', pe({ BI_DATA_DIR: path.join(tmp, 'data') }))).toBe(DISABLED);
    expect(message('demo.sqlite', pe({ BI_SQLITE_DIR: '   ', BI_DATA_DIR: path.join(tmp, 'data') }))).toBe(DISABLED);
  });
  it('BI_SQLITE_DIR inexistant ou fichier : configuration invalide, sans révéler le chemin', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const bad of [path.join(tmp, 'nexiste-pas'), path.join(dir, 'ventes.sqlite')]) {
      const m = message('ventes.sqlite', pe({ BI_SQLITE_DIR: bad, BI_DATA_DIR: path.join(tmp, 'data') }));
      expect(m).toBe(BAD_CONFIG);
      expect(m).not.toContain(tmp);
    }
    vi.restoreAllMocks();
  });
  it('BI_SQLITE_DIR parent ou enfant de BI_DATA_DIR : configuration invalide', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(message('x.sqlite', pe({ BI_SQLITE_DIR: tmp, BI_DATA_DIR: path.join(tmp, 'data') }))).toBe(BAD_CONFIG); // contient data/
    expect(message('x.sqlite', pe({ BI_SQLITE_DIR: path.join(tmp, 'data'), BI_DATA_DIR: path.join(tmp, 'data') }))).toBe(BAD_CONFIG); // identique
    fs.mkdirSync(path.join(tmp, 'data', 'bases'), { recursive: true });
    expect(message('x.sqlite', pe({ BI_SQLITE_DIR: path.join(tmp, 'data', 'bases'), BI_DATA_DIR: path.join(tmp, 'data') }))).toBe(BAD_CONFIG); // dans data/
    vi.restoreAllMocks();
  });
});

describe('US-2 / chemins acceptés', () => {
  it('relatif, absolu à l’intérieur du dossier, sous-dossier, extension en majuscules, nom commençant par « .. »', () => {
    const real = fs.realpathSync(path.join(dir, 'ventes.sqlite'));
    expect(resolveSqlitePath('ventes.sqlite', env)).toBe(real);
    expect(resolveSqlitePath(path.join(dir, 'ventes.sqlite'), env)).toBe(real);
    expect(resolveSqlitePath('  ventes.sqlite  ', env)).toBe(real);
    expect(resolveSqlitePath('sub/b.db', env)).toBe(fs.realpathSync(path.join(dir, 'sub', 'b.db')));
    expect(resolveSqlitePath('v3.SQLITE3', env)).toBe(fs.realpathSync(path.join(dir, 'v3.SQLITE3')));
    expect(resolveSqlitePath('..x.db', env)).toBe(fs.realpathSync(path.join(dir, '..x.db')));
  });
});

describe('US-2 / Gherkin « Chemins refusés » : message exact, sans chemin dans le message', () => {
  const refused: [string, string][] = [
    ['../data/users.json', 'extension non autorisée et hors dossier'],
    ['../../autre-app/app.db', 'remontée hors dossier'],
    ['/etc/passwd', 'chemin absolu hors dossier'],
    [BS + 'Windows' + BS + 'win.ini', 'chemin absolu Windows sans lecteur'],
    ['C:' + BS + 'Windows' + BS + 'win.ini', 'lecteur Windows'],
    [':memory:', 'base en mémoire'],
    ['', 'chaîne vide'],
    ['   ', 'espaces'],
    ['file:ventes.sqlite?mode=rw', 'URI file:'],
    ['ventes.sqlite:flux', 'flux alternatif NTFS'],
    ['ventes.sqlite\0.png', 'octet nul'],
    ['../outside/x.sqlite', 'dossier voisin existant'],
    ['../outside/absent.sqlite', 'dossier voisin, fichier absent (jamais « introuvable »)'],
    ['sub', 'dossier'],
    ['ventes.txt', 'mauvaise extension'],
    ['a'.repeat(300) + '.db', 'chemin trop long'],
  ];
  it.each(refused)('%j (%s)', (input) => {
    const m = message(input);
    expect(m).toBe(REFUSED);
    expect(m).not.toContain(dir);
    expect(m).not.toContain(tmp);
  });

  it('chemin absolu extérieur existant refusé', () => { expect(message(path.join(tmp, 'outside', 'x.sqlite'))).toBe(REFUSED); });
  it('fichier absent dans le dossier : « introuvable »', () => { expect(message('absent.sqlite')).toBe(NOT_FOUND); });
  it('un type non-chaîne est refusé', () => { expect(message(undefined as unknown as string)).toBe(REFUSED); expect(message(42 as unknown as string)).toBe(REFUSED); });
});

describe('US-2 / UNC et chemins de périphérique : refus lexical, zéro accès disque', () => {
  const unc = [
    BS + BS + 'attaquant.tld' + BS + 'partage' + BS + 'x.db', '//attaquant.tld/p/x.db', BS + BS + '?' + BS + 'C:' + BS + 'x.db',
    BS + BS + '.' + BS + 'PhysicalDrive0' + BS + 'x.db', '/' + BS + 'hote' + BS + 'p' + BS + 'x.db',
  ];
  it.each(unc)('%j', (input) => {
    const spy = vi.spyOn(fs, 'lstatSync');
    const spy2 = vi.spyOn(fs, 'statSync');
    const spy3 = vi.spyOn(fs, 'existsSync');
    const spy4 = vi.spyOn(fs, 'realpathSync');
    const before = [spy, spy2, spy3, spy4].map((s) => s.mock.calls.length);
    // Seul allowedRoot touche le disque (realpath/stat du dossier configuré) ; aucun accès au chemin demandé.
    expect(message(input)).toBe(REFUSED);
    const touched = [...spy.mock.calls, ...spy2.mock.calls, ...spy3.mock.calls, ...spy4.mock.calls].map((c) => String(c[0]));
    expect(touched.filter((p) => /attaquant|PhysicalDrive|hote/i.test(p))).toEqual([]);
    expect(spy.mock.calls.length).toBe(before[0]); // lstat jamais appelé sur le candidat
    vi.restoreAllMocks();
  });

  it('chemins extérieurs (../outside/…, absolu) : aucun lstat sur un chemin hors du dossier autorisé', () => {
    const spy = vi.spyOn(fs, 'lstatSync');
    for (const input of ['../outside/x.sqlite', '../outside/absent.sqlite', path.join(tmp, 'outside', 'x.sqlite')]) message(input);
    const root = fs.realpathSync(dir);
    expect(spy.mock.calls.map((c) => String(c[0])).filter((p) => !p.startsWith(root))).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe('US-2 / liens symboliques et jonctions (créés dans un dossier temporaire)', () => {
  it('jonction de répertoire sortante : sous-dossier-lie/x.sqlite refusé (le realpath sort de la racine)', () => {
    expect(junctionOk, 'précondition : la jonction de répertoire doit pouvoir être créée sur ce poste').toBe(true);
    expect(fs.existsSync(path.join(dir, 'sous-dossier-lie', 'x.sqlite'))).toBe(true); // la jonction fonctionne bien
    expect(message('sous-dossier-lie/x.sqlite')).toBe(REFUSED);
    expect(message(path.join(dir, 'sous-dossier-lie', 'x.sqlite'))).toBe(REFUSED);
  });
  // Un vrai lien symbolique de fichier exige le mode développeur sous Windows (EPERM sur le poste de recette) : le cas réel est donc ⏳ (voir qa-report.md).
  // Ici, le chemin de code « lstat → lien symbolique » est exercé par simulation de lstatSync, à ne pas compter comme preuve du cas réel.
  it('SIMULATION : lstat signalant un lien symbolique sur le candidat → refus', () => {
    const real = fs.lstatSync.bind(fs);
    const spy = vi.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike, ...a: unknown[]) => {
      const st = (real as (p: fs.PathLike, ...a: unknown[]) => fs.Stats)(p, ...a);
      return String(p).endsWith('ventes.sqlite') ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { isSymbolicLink: () => true }) : st;
    }) as unknown as typeof fs.lstatSync);
    expect(message('ventes.sqlite')).toBe(REFUSED);
    spy.mockRestore();
    expect(message('ventes.sqlite')).toBe('OK');
  });
  it('BI_SQLITE_DIR lui-même accessible via une jonction : le realpath de la racine est utilisé', () => {
    expect(junctionOk).toBe(true);
    const viaLink = path.join(tmp, 'racine-liee');
    fs.symlinkSync(dir, viaLink, 'junction');
    const e = pe({ BI_SQLITE_DIR: viaLink, BI_DATA_DIR: path.join(tmp, 'data') });
    expect(resolveSqlitePath('ventes.sqlite', e)).toBe(fs.realpathSync(path.join(dir, 'ventes.sqlite')));
    expect(message('sous-dossier-lie/x.sqlite', e)).toBe(REFUSED);
  });
});

describe('US-2 / lecture seule effective (better-sqlite3 réel, via les connecteurs)', () => {
  const saved = { dir: process.env.BI_SQLITE_DIR, data: process.env.BI_DATA_DIR };
  let dbPath = '';
  const sha = () => crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
  const run = async (fn: () => Promise<unknown>) => { try { return { ok: true as const, value: await fn() }; } catch (e) { return { ok: false as const, error: friendly(e) }; } };

  beforeAll(async () => {
    dbPath = path.join(dir, 'reel.sqlite');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, nom TEXT); CREATE TABLE gros (n INTEGER);');
    const ins = db.prepare('INSERT INTO t (nom) VALUES (?)');
    for (const n of ['a', 'b', 'c']) ins.run(n);
    db.exec('WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n < 5000) INSERT INTO gros SELECT n FROM s;');
    db.close();
  });
  beforeEach(() => { process.env.BI_SQLITE_DIR = dir; process.env.BI_DATA_DIR = path.join(tmp, 'data'); });
  afterEach(() => {
    if (saved.dir === undefined) delete process.env.BI_SQLITE_DIR; else process.env.BI_SQLITE_DIR = saved.dir;
    if (saved.data === undefined) delete process.env.BI_DATA_DIR; else process.env.BI_DATA_DIR = saved.data;
  });

  it('SQLite désactivé sans BI_SQLITE_DIR : ok:false + message exact (route /api/connectors/test)', async () => {
    delete process.env.BI_SQLITE_DIR;
    const r = await run(() => testConnector('sqlite', { path: 'demo.sqlite' }));
    expect(r).toEqual({ ok: false, error: DISABLED });
  });
  it('test + schéma d’un fichier autorisé : le message commence par « SQLite »', async () => {
    const t = await run(() => testConnector('sqlite', { path: 'reel.sqlite' }));
    expect(t.ok).toBe(true);
    expect(String((t as { value: string }).value).startsWith('SQLite ')).toBe(true);
    const s = await run(() => schema('sqlite', { path: 'reel.sqlite' }));
    expect(s.ok).toBe(true);
    expect((s as { value: { name: string }[] }).value.map((x) => x.name).sort()).toEqual(['gros', 't']);
  });
  it('chemin absolu à l’intérieur du dossier accepté', async () => {
    expect((await run(() => testConnector('sqlite', { path: dbPath }))).ok).toBe(true);
  });
  it('chemins refusés via le connecteur : message du Gherkin, jamais de chemin', async () => {
    for (const p of ['../data/users.json', '/etc/passwd', ':memory:', '', 'file:reel.sqlite?mode=rw']) {
      const r = await run(() => testConnector('sqlite', { path: p }));
      expect(r, p).toEqual({ ok: false, error: REFUSED });
    }
    expect(await run(() => testConnector('sqlite', { path: 'absent.sqlite' }))).toEqual({ ok: false, error: NOT_FOUND });
  });
  it('SELECT renvoie les lignes ; le fichier n’est pas modifié (empreinte SHA-256 et horodatage identiques)', async () => {
    const h0 = sha(); const m0 = fs.statSync(dbPath).mtimeMs;
    const r = await run(() => query('sqlite', { path: 'reel.sqlite' }, { sql: 'SELECT * FROM t ORDER BY id' }));
    expect(r.ok).toBe(true);
    expect((r as { value: { nom: string }[] }).value.map((x) => x.nom)).toEqual(['a', 'b', 'c']);
    expect(sha()).toBe(h0);
    expect(fs.statSync(dbPath).mtimeMs).toBe(m0);
  });
  it.each([
    "INSERT INTO t (nom) VALUES ('x')", 'DELETE FROM t', 'UPDATE t SET nom = 1', 'DROP TABLE t', "ATTACH DATABASE 'x.db' AS y", 'PRAGMA query_only = OFF',
    'CREATE TABLE z (a)', "SELECT 1; DELETE FROM t", "SELECT load_extension('x')", 'VACUUM',
  ])('écriture refusée sans modifier le fichier : %s', async (sql) => {
    const h0 = sha();
    const r = await run(() => query('sqlite', { path: 'reel.sqlite' }, { sql }));
    expect(r.ok).toBe(false);
    expect(sha()).toBe(h0);
  });
  it('le volume est borné à 1000 lignes (table de 5000 lignes)', async () => {
    const r = await run(() => query('sqlite', { path: 'reel.sqlite' }, { sql: 'SELECT * FROM gros' }));
    expect(r.ok).toBe(true);
    expect((r as { value: unknown[] }).value).toHaveLength(1000);
  });
  it('un ancien chemin hors dossier ne peut plus être ouvert via le connecteur (data/users.json)', async () => {
    const r = await run(() => query('sqlite', { path: path.join(tmp, 'data', 'users.json') }, { sql: 'SELECT 1' }));
    expect(r).toEqual({ ok: false, error: REFUSED });
  });
});
