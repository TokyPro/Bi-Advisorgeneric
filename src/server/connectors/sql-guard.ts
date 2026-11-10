/**
 * Garde-fou lecture seule des requêtes SQL utilisateur / LLM (S3). Première ligne de défense seulement :
 * la vraie garantie reste un compte SGBD en lecture seule (doublée d'une transaction lecture seule / annulée côté exécution).
 * Module sans dépendance (exécutable par `node` directement pour les vérifications).
 */
export type SqlDialect = 'postgres' | 'mysql' | 'mssql' | 'sqlite';
export const MAX_ROWS = 1000;
export const QUERY_TIMEOUT_MS = 30_000;
export const QUERY_TIMEOUT_MESSAGE = 'Requête trop longue : délai de 30 s dépassé. Ajoutez des filtres ou une agrégation.';
export class ReadOnlyError extends Error {}

const ONE_STATEMENT = 'Une seule instruction SQL est autorisée.';
const READ_ONLY = 'Seules les requêtes en lecture (SELECT) sont autorisées.';
const MALFORMED = 'Requête SQL mal formée (chaîne, identifiant ou commentaire non terminé).';
const BLOCK_COMMENT = 'Commentaires /* */ non autorisés : utilisez -- en fin de ligne.';
const MYSQL_BACKSLASH = 'MySQL : les chaînes contenant une barre oblique inverse (\\) ne sont pas autorisées.';
const TOO_LONG = 'Requête trop longue (20 000 caractères maximum).';
const MAX_LENGTH = 20_000;
const CONTROL_CHAR = 'Caractère de contrôle non autorisé dans la requête (retour chariot isolé, saut de page, séparateur Unicode…) : utilisez des fins de ligne standard.';
// Caractères sur lesquels les analyseurs SGBD divergent (ex. `\r` isolé termine `--` en PostgreSQL) : refusés partout,
// littéraux compris. Seuls `\t`, `\n` et `\r\n` restent admis.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]|\r(?!\n)/;

const forbidden = (word: string) =>
  new ReadOnlyError(`Mot-clé ou fonction interdit (${word.replace(/\s+/g, ' ').toUpperCase()}) : le connecteur est en lecture seule. Si c'est un nom de colonne, placez-le entre guillemets.`);

// La liste est un minimum : tout ajout doit être couvert par un cas de test.
const SEQUENCES = /\b(for\s+no\s+key\s+update|for\s+key\s+share|for\s+update|for\s+share|lock\s+in\s+share\s+mode)\b/;
// T-SQL : Service Broker (ces instructions modifient ou verrouillent des files de messages).
const MSSQL_SEQUENCES = /\b((end|move|get)\s+conversation)\b/;
const FUNCTION_NAMES = [
  'load_file|load_extension|openrowset|opendatasource|openquery|openxml|xp_\\w+|sp_\\w+',
  // PostgreSQL : fichiers serveur, adminpack, grands objets, administration
  'pg_read_file|pg_read_binary_file|pg_ls_\\w+|pg_stat_file|pg_file_\\w+|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile',
  'pg_sleep\\w*|pg_advisory\\w*|pg_logical_emit_message|pg_notify|pg_stat_reset\\w*|pg_switch_wal|pg_promote|pg_create_restore_point|lo_\\w+',
  'dblink\\w*|query_to_xml\\w*|cursor_to_xml|set_config|nextval|setval',
  // SQL Server : lecture de fichiers serveur et du journal de transactions
  'fn_xe_file_target_read_file|fn_get_audit_file|fn_trace_gettable|fn_dblog',
  // MySQL / MariaDB
  'sleep|benchmark|get_lock|release_lock|master_pos_wait|source_pos_wait|sys_exec|sys_eval',
].join('|');
const FUNCTIONS = new RegExp(`\\b(${FUNCTION_NAMES})\\s*\\(`);
const FUNCTION_NAME = new RegExp(`^(${FUNCTION_NAMES})$`);
// Contrôle transactionnel inclus : en T-SQL, un COMMIT ferait sortir les instructions suivantes du lot de la transaction annulée.
const WORDS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|exec|execute|call|copy|attach|detach|vacuum|reindex|lock|set|reset|declare|prepare|deallocate|listen|notify|handler|shutdown|kill|dbcc|bulk|backup|restore|reconfigure|waitfor|into|commit|rollback|save|savepoint|begin|release)\b/;
// T-SQL : écritures et changements de contexte hors liste commune ; `while`/`goto` permettraient de boucler jusqu'au délai.
// `fetch` est absent : il sert à la pagination (OFFSET … FETCH NEXT n ROWS ONLY) et un curseur exige DECLARE, déjà refusé.
// `raiserror … with log` écrit dans le journal d'erreurs hors transaction ; `add [counter] signature` modifie un module.
const MSSQL_WORDS = /\b(deny|writetext|updatetext|receive|send|disable|enable|use|setuser|revert|checkpoint|open|close|while|goto|raiserror|add)\b/;
const MYSQL_WORDS = /\b(procedure)\b/;
const DIALECT_RULES: Record<SqlDialect, RegExp[]> = {
  postgres: [SEQUENCES, FUNCTIONS, WORDS],
  mysql: [SEQUENCES, FUNCTIONS, WORDS, MYSQL_WORDS],
  mssql: [SEQUENCES, MSSQL_SEQUENCES, FUNCTIONS, WORDS, MSSQL_WORDS],
  sqlite: [SEQUENCES, FUNCTIONS, WORDS],
};

const isIdChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c);

const MSSQL_GLUED_NUMBER = 'SQL Server : séparez les nombres des mots-clés par un espace (« 1 FROM » et non « 1FROM »).';
// Littéraux T-SQL : binaire, puis entier / décimal / monétaire / flottant. Ancré (`y`) à la position testée.
const MSSQL_NUMBER = /0x[0-9a-f]*|\$?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/y;
const isMssqlIdChar = (c: string | undefined) => !!c && /[a-z0-9_@#$]/.test(c);
const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9';

/**
 * Le lexer T-SQL termine un nombre au premier caractère qui n'en fait pas partie : `1COMMIT` se lit `1 COMMIT`.
 * Aucune frontière `\b` n'existe entre le chiffre et la lettre : un littéral numérique collé à un caractère
 * d'identifiant est donc refusé. Reçoit le code masqué en minuscules.
 */
function assertMssqlNumbersSeparated(lower: string) {
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i];
    const startsNumber = isDigit(c)
      || (c === '.' && isDigit(lower[i + 1]))
      || (c === '$' && (isDigit(lower[i + 1]) || (lower[i + 1] === '.' && isDigit(lower[i + 2]))));
    // Un chiffre après un caractère d'identifiant fait partie de l'identifiant (t1, @v2, #tmp3).
    if (!startsNumber || isMssqlIdChar(lower[i - 1])) continue;
    MSSQL_NUMBER.lastIndex = i;
    const len = MSSQL_NUMBER.exec(lower)?.[0].length ?? 1;
    if (isMssqlIdChar(lower[i + len])) throw new ReadOnlyError(MSSQL_GLUED_NUMBER);
    i += len - 1;
  }
}
const isBlankOrControl = (c: string | undefined) => c === undefined || c.charCodeAt(0) <= 32;

interface Lexed { masked: string; idents: { text: string; end: number }[] }

/**
 * Analyse lexicale par dialecte. Le résultat a la même longueur que l'entrée : le contenu des littéraux,
 * identifiants cités et commentaires de ligne est remplacé par des espaces (délimiteurs conservés).
 * Fins de ligne : seul `\n` est séparateur, voir CONTROL_CHARS (pré-contrôle de assertReadOnly).
 */
function lex(sql: string, d: SqlDialect): Lexed {
  const out = sql.split('');
  const idents: Lexed['idents'] = [];
  const n = sql.length;
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) out[k] = ' '; };

  /** Littéral de chaîne ; `backslash` : 'escape' (E'…' PostgreSQL), 'forbid' (MySQL), 'none'. Renvoie l'index après la fermeture. */
  const literal = (start: number, q: string, backslash: 'escape' | 'forbid' | 'none') => {
    let j = start + 1;
    for (;;) {
      if (j >= n) throw new ReadOnlyError(MALFORMED);
      const ch = sql[j];
      if (ch === '\\' && backslash === 'forbid') throw new ReadOnlyError(MYSQL_BACKSLASH);
      if (ch === '\\' && backslash === 'escape') { j += 2; continue; }
      if (ch === q) { if (sql[j + 1] === q) { j += 2; continue; } break; }
      j++;
    }
    blank(start + 1, j);
    return j + 1;
  };
  const identifier = (start: number, close: string) => {
    let j = start + 1;
    for (;;) {
      if (j >= n) throw new ReadOnlyError(MALFORMED);
      if (sql[j] === close) { if (sql[j + 1] === close) { j += 2; continue; } break; }
      j++;
    }
    idents.push({ text: sql.slice(start + 1, j).split(close + close).join(close), end: j + 1 });
    blank(start + 1, j);
    return j + 1;
  };

  let i = 0;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '/' && next === '*') throw new ReadOnlyError(BLOCK_COMMENT);
    const lineComment = (c === '-' && next === '-' && (d !== 'mysql' || isBlankOrControl(sql[i + 2]))) || (d === 'mysql' && c === '#');
    if (lineComment) {
      const eol = sql.indexOf('\n', i);
      const end = eol < 0 ? n : eol;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "'") {
      const escaped = d === 'postgres' && (sql[i - 1] === 'e' || sql[i - 1] === 'E') && !isIdChar(sql[i - 2]);
      i = literal(i, "'", d === 'mysql' ? 'forbid' : escaped ? 'escape' : 'none');
      continue;
    }
    if (c === '"') { i = d === 'mysql' ? literal(i, '"', 'forbid') : identifier(i, '"'); continue; }
    if (c === '`' && (d === 'mysql' || d === 'sqlite')) { i = identifier(i, '`'); continue; }
    if (c === '[' && (d === 'mssql' || d === 'sqlite')) { i = identifier(i, ']'); continue; }
    if (d === 'postgres') {
      // U&'…' / U&"…" : les échappements Unicode permettraient de déguiser un nom de fonction interdit.
      if ((c === 'u' || c === 'U') && next === '&' && (sql[i + 2] === "'" || sql[i + 2] === '"') && !isIdChar(sql[i - 1])) throw forbidden('U&');
      if (c === '$' && !isIdChar(sql[i - 1])) {
        const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
        if (tag) {
          const close = sql.indexOf(tag, i + tag.length);
          if (close < 0) throw new ReadOnlyError(MALFORMED);
          blank(i + tag.length, close);
          i = close + tag.length;
          continue;
        }
      }
    }
    i++;
  }
  return { masked: out.join(''), idents };
}

/**
 * T-SQL n'exige pas de `;` entre les instructions d'un lot : un SELECT au niveau 0 de parenthèses ouvre une nouvelle
 * instruction, sauf après un opérateur ensembliste ou, une seule fois, après la liste d'une CTE. Appliqué à tous les dialectes.
 */
function assertSingleSelect(lower: string) {
  let cteMainAllowed = /^[(\s]*with\b/.test(lower);
  let depth = 0;
  let prev = '';
  for (const [t] of lower.matchAll(/[a-z0-9_$@#.]+|\S/g)) {
    if (t === '(') depth++;
    else if (t === ')') { if (--depth < 0) throw new ReadOnlyError(MALFORMED); }
    else if (t === 'select' && depth === 0 && prev !== '' && !/^(union|all|distinct|except|intersect)$/.test(prev)) {
      if (!(cteMainAllowed && prev === ')')) throw new ReadOnlyError(ONE_STATEMENT);
      cteMainAllowed = false;
    }
    prev = t;
  }
}

/** Renvoie le code SQL où littéraux, identifiants cités et commentaires de ligne sont neutralisés. Lève ReadOnlyError si mal formé. */
export function maskSql(sql: string, dialect: SqlDialect): string {
  return lex(sql, dialect).masked;
}

/** Renvoie l'instruction prête à exécuter (trim, sans ';' final) ou lève ReadOnlyError. */
export function assertReadOnly(sql: string, dialect: SqlDialect): string {
  const s = typeof sql === 'string' ? sql.trim() : '';
  if (!s) throw new ReadOnlyError(READ_ONLY);
  if (s.length > MAX_LENGTH) throw new ReadOnlyError(TOO_LONG);
  // Sur `s`, avant lex : le texte contrôlé est exactement celui (tronqué) qui sera exécuté.
  if (CONTROL_CHARS.test(s)) throw new ReadOnlyError(CONTROL_CHAR);
  const { masked, idents } = lex(s, dialect);
  // Même longueur que `s` : l'index de fin calculé sur le code masqué vaut pour le texte original (commentaire final inclus).
  const end = masked.replace(/[;\s]+$/, '').length;
  const body = masked.slice(0, end);
  if (body.includes(';')) throw new ReadOnlyError(ONE_STATEMENT);
  if (!/^[(\s]*(select|with)\b/i.test(body)) throw new ReadOnlyError(READ_ONLY);
  const lower = body.toLowerCase();
  if (dialect === 'mssql') assertMssqlNumbersSeparated(lower);
  for (const re of DIALECT_RULES[dialect]) {
    const m = re.exec(lower);
    if (m) throw forbidden(m[1]);
  }
  // PostgreSQL appelle une fonction même citée ("pg_sleep"(10)) : les identifiants cités suivis de '(' sont contrôlés aussi.
  for (const id of idents) {
    if (id.end <= end && FUNCTION_NAME.test(id.text.toLowerCase()) && /^\s*\(/.test(body.slice(id.end))) throw forbidden(id.text);
  }
  // Après les listes : un mot interdit garde son message explicite.
  assertSingleSelect(lower);
  return s.slice(0, end);
}
