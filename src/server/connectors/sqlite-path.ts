import fs from 'node:fs';
import path from 'node:path';

/** Confinement des bases SQLite au dossier BI_SQLITE_DIR (S2). Messages volontairement sans chemin (ni racine, ni entrée). */
export class SqlitePathError extends Error {}

const DISABLED = "SQLite est désactivé sur ce serveur : l'administrateur doit définir BI_SQLITE_DIR.";
const REFUSED = 'Chemin SQLite refusé : indiquez un fichier .sqlite, .sqlite3 ou .db situé dans le dossier autorisé.';
const NOT_FOUND = 'Fichier SQLite introuvable dans le dossier autorisé.';
const BAD_CONFIG = 'Configuration SQLite invalide.';
// Exclut `:memory:`, les URI `file:…` et les flux alternatifs NTFS (`x.db:flux`).
const FILE_NAME = /^[\p{L}\p{N} _.\-]+\.(sqlite3?|db)$/iu;

const realOrResolved = (p: string) => {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
};
// `path.relative` gère la casse Windows et les lecteurs différents (résultat absolu) ; un nom comme `..x.db` reste légitime.
const escapes = (rel: string) => rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
/** Vrai si `child` est `parent` lui-même ou situé dessous. */
const within = (parent: string, child: string) => !escapes(path.relative(parent, child));

function allowedRoot(env: NodeJS.ProcessEnv): string {
  const root = env.BI_SQLITE_DIR?.trim();
  if (!root) throw new SqlitePathError(DISABLED);
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(path.resolve(root));
    if (!fs.statSync(rootReal).isDirectory()) throw new Error('not a directory');
  } catch {
    console.error('[sqlite] BI_SQLITE_DIR ne désigne pas un dossier existant.');
    throw new SqlitePathError(BAD_CONFIG);
  }
  // Le dossier des comptes et secrets ne doit jamais être atteignable, ni dans un sens ni dans l'autre.
  const dataDir = realOrResolved(path.resolve(env.BI_DATA_DIR || './data'));
  if (within(dataDir, rootReal) || within(rootReal, dataDir)) {
    console.error('[sqlite] BI_SQLITE_DIR ne doit ni contenir le dossier de données (BI_DATA_DIR) ni s\'y trouver.');
    throw new SqlitePathError(BAD_CONFIG);
  }
  return rootReal;
}

/** Renvoie le chemin réel (realpath) du fichier autorisé ou lève SqlitePathError avec un message générique. */
export function resolveSqlitePath(input: string, env: NodeJS.ProcessEnv = process.env): string {
  const rootReal = allowedRoot(env);
  if (typeof input !== 'string') throw new SqlitePathError(REFUSED);
  const p = input.trim();
  // UNC (`\\hote\partage`, `//hote/p`) et chemins de périphérique (`\\?\`, `\\.\`) : sous Windows, un simple lstat ouvrirait une session SMB sortante.
  if (!p || p.length > 260 || p.includes('\0') || /^[\\/]{2}/.test(p)) throw new SqlitePathError(REFUSED);

  const candidate = path.resolve(rootReal, p);
  if (!FILE_NAME.test(path.basename(candidate))) throw new SqlitePathError(REFUSED);
  // Confinement lexical avant tout accès disque : aucun chemin extérieur n'est sondé (existence, temps de réponse, réseau).
  if (!within(rootReal, candidate)) throw new SqlitePathError(REFUSED);

  let st: fs.Stats;
  try { st = fs.lstatSync(candidate); } catch (e) {
    throw new SqlitePathError((e as NodeJS.ErrnoException).code === 'ENOENT' ? NOT_FOUND : REFUSED);
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new SqlitePathError(REFUSED);

  let real: string;
  try { real = fs.realpathSync(candidate); } catch { throw new SqlitePathError(REFUSED); }
  const rel = path.relative(rootReal, real);
  if (rel === '' || escapes(rel)) throw new SqlitePathError(REFUSED);
  return real;
}
