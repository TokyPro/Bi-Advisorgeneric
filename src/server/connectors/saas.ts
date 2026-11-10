/** Connecteurs « synchronisés » : API REST générique, Airtable, Notion. Les données sont récupérées côté serveur (CORS, secrets) puis chargées dans le moteur SQL du navigateur. */
import { safeFetch, BAD_URL_MESSAGE, type SafeFetchInit } from '../net/safe-fetch';
import { NetworkPolicyError } from '../net/policy';

type Cfg = Record<string, string>;
type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

const MAX_ROWS = 5000;
const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'table';

// Codes compris par friendly() (index.ts) ; tout autre échec réseau reste générique (jamais de cause brute renvoyée au client).
const NET_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'];

async function jfetch(url: string, init: SafeFetchInit = {}, label = 'API') {
  let res: Response;
  try { res = await safeFetch(url, init); }
  catch (e) {
    if (e instanceof NetworkPolicyError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    if (code && NET_CODES.includes(code)) throw Object.assign(new Error(code), { code });
    throw new Error(`${label} injoignable.`);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error(`${label} : accès refusé (${res.status}) — vérifiez le jeton / les droits.`);
    if (res.status === 404) throw new Error(`${label} : ressource introuvable (404).`);
    throw new Error(`${label} HTTP ${res.status}.`);
  }
  try { return await res.json(); } catch { throw new Error(`${label} : la réponse n'est pas un JSON valide.`); }
}

/** Aplatit un objet imbriqué (a.b.c) ; tableaux de scalaires -> "x, y" ; autres tableaux -> JSON. */
export function flatten(o: unknown, prefix = '', out: Row = {}, depth = 0): Row {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) { out[prefix || 'value'] = Array.isArray(o) ? (o.every((x) => x === null || typeof x !== 'object') ? o.join(', ') : JSON.stringify(o)) : o; return out; }
  for (const [k, v] of Object.entries(o as Row)) {
    const key = prefix ? `${prefix}_${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 3) flatten(v, key, out, depth + 1);
    else if (Array.isArray(v)) out[key] = v.every((x) => x === null || typeof x !== 'object') ? v.join(', ') : JSON.stringify(v);
    else out[key] = v;
  }
  return out;
}

/* ------------------------------------------------------------------- REST */
// En-têtes qui détourneraient la requête (Host forcé, smuggling, proxy) : refusés explicitement.
const FORBIDDEN_HEADERS = ['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'proxy-authorization', 'te', 'trailer', 'keep-alive', 'expect'];
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BAD_HEADERS = 'En-têtes : JSON invalide (ex. {"X-Api-Version":"2"}).';

function checkHeader(name: string, value: unknown) {
  if (!HEADER_NAME.test(name) || typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error(BAD_HEADERS);
  if (FORBIDDEN_HEADERS.includes(name.toLowerCase())) throw new Error(`En-tête non autorisé : ${name}.`);
}

function restHeaders(c: Cfg): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' };
  if (c.headers?.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(c.headers); } catch { throw new Error(BAD_HEADERS); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(BAD_HEADERS);
    for (const [k, v] of Object.entries(parsed)) { checkHeader(k, v); h[k] = v as string; }
  }
  if (c.authType === 'bearer' && c.token) h.authorization = `Bearer ${c.token}`;
  if (c.authType === 'basic') h.authorization = 'Basic ' + Buffer.from(`${c.username || ''}:${c.token || ''}`).toString('base64');
  if (c.authType === 'header' && c.authHeader && c.token) { checkHeader(c.authHeader, c.token); h[c.authHeader] = c.token; }
  return h;
}
const dig = (o: unknown, path?: string) => (path?.trim() ? path.trim().split('.').reduce((a: unknown, k) => (a as Row | undefined)?.[k], o) : o);

export async function fetchRest(c: Cfg): Promise<Tables> {
  // La validation complète (schéma, identifiants, destination) est faite par safeFetch à chaque page.
  if (!c.url?.trim()) throw new NetworkPolicyError(BAD_URL_MESSAGE);
  const headers = restHeaders(c);
  const maxPages = Math.min(Number(c.maxPages || 1), 20);
  let url = c.url + (c.authType === 'query' && c.authHeader && c.token ? `${c.url.includes('?') ? '&' : '?'}${encodeURIComponent(c.authHeader)}=${encodeURIComponent(c.token)}` : '');
  const rows: Row[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = c.pageParam && page > 1 ? `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(c.pageParam)}=${page}` : url;
    const body = await jfetch(u, { method: c.method === 'POST' ? 'POST' : 'GET', headers: c.method === 'POST' ? { ...headers, 'content-type': 'application/json' } : headers, body: c.method === 'POST' && c.body ? c.body : undefined }, 'API REST');
    const data = dig(body, c.dataPath);
    const arr = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : null;
    if (!arr) throw new Error(`Aucun tableau trouvé${c.dataPath ? ` au chemin « ${c.dataPath} »` : ''}. Renseignez « Chemin des données » (ex. data.items).`);
    if (!arr.length) break;
    rows.push(...arr.map((x) => flatten(x)));
    if (rows.length >= MAX_ROWS) break;
    if (!c.pageParam) break;
  }
  if (!rows.length) throw new Error('La réponse ne contient aucune ligne.');
  return { [safe(c.table || new URL(c.url).pathname.split('/').filter(Boolean).pop() || 'api')]: rows.slice(0, MAX_ROWS) };
}

/* --------------------------------------------------------------- Airtable */
const AT = 'https://api.airtable.com/v0';
const atH = (c: Cfg) => ({ authorization: `Bearer ${c.token}` });

export async function fetchAirtable(c: Cfg): Promise<Tables> {
  if (!c.token || !c.baseId) throw new Error('Jeton d’accès personnel et ID de base (appXXXX) requis.');
  const meta = await jfetch(`${AT}/meta/bases/${c.baseId}/tables`, { headers: atH(c) }, 'Airtable');
  const out: Tables = {};
  for (const t of meta.tables as { id: string; name: string }[]) {
    const rows: Row[] = [];
    let offset = '';
    do {
      const j = await jfetch(`${AT}/${c.baseId}/${t.id}?pageSize=100${offset ? `&offset=${offset}` : ''}`, { headers: atH(c) }, 'Airtable');
      for (const r of j.records) rows.push({ id: r.id, ...flatten(r.fields) });
      offset = j.offset || '';
    } while (offset && rows.length < MAX_ROWS);
    if (rows.length) out[safe(t.name)] = rows;
  }
  if (!Object.keys(out).length) throw new Error('Base vide ou aucune table accessible.');
  return out;
}

/* ----------------------------------------------------------------- Notion */
const NV = { 'Notion-Version': '2022-06-28' };
const nH = (c: Cfg) => ({ authorization: `Bearer ${c.token}`, 'content-type': 'application/json', ...NV });
const plain = (rt: { plain_text: string }[] = []) => rt.map((x) => x.plain_text).join('');

function notionValue(p: Record<string, any>): unknown { // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (p.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'number': return p.number;
    case 'select': return p.select?.name ?? null;
    case 'status': return p.status?.name ?? null;
    case 'multi_select': return p.multi_select.map((x: { name: string }) => x.name).join(', ');
    case 'date': return p.date?.start ?? null;
    case 'checkbox': return p.checkbox;
    case 'url': case 'email': case 'phone_number': return p[p.type];
    case 'people': return p.people.map((x: { name?: string }) => x.name).filter(Boolean).join(', ');
    case 'relation': return p.relation.length;
    case 'created_time': case 'last_edited_time': return p[p.type];
    case 'formula': return p.formula[p.formula.type]?.start ?? p.formula[p.formula.type];
    case 'rollup': return p.rollup[p.rollup.type] && typeof p.rollup[p.rollup.type] !== 'object' ? p.rollup[p.rollup.type] : null;
    default: return null;
  }
}

export async function fetchNotion(c: Cfg): Promise<Tables> {
  if (!c.token) throw new Error('Jeton d’intégration Notion requis (secret_… / ntn_…).');
  const wanted = (c.databaseIds || '').split(/[\s,;]+/).map((x) => x.replace(/-/g, '')).filter(Boolean);
  const s = await jfetch('https://api.notion.com/v1/search', { method: 'POST', headers: nH(c), body: JSON.stringify({ filter: { property: 'object', value: 'database' }, page_size: 50 }) }, 'Notion');
  let dbs = s.results as { id: string; title: { plain_text: string }[] }[];
  if (wanted.length) dbs = dbs.filter((d) => wanted.includes(d.id.replace(/-/g, '')));
  if (!dbs.length) throw new Error('Aucune base Notion accessible : partagez-la avec votre intégration (menu « Connexions » de la base).');
  const out: Tables = {};
  for (const d of dbs.slice(0, 15)) {
    const rows: Row[] = [];
    let cursor: string | undefined;
    do {
      const j = await jfetch(`https://api.notion.com/v1/databases/${d.id}/query`, { method: 'POST', headers: nH(c), body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) }, 'Notion');
      for (const pg of j.results) { const r: Row = {}; for (const [k, v] of Object.entries(pg.properties as Record<string, any>)) r[k.replace(/\s+/g, '_')] = notionValue(v); rows.push(r); } // eslint-disable-line @typescript-eslint/no-explicit-any
      cursor = j.has_more ? j.next_cursor : undefined;
    } while (cursor && rows.length < MAX_ROWS);
    if (rows.length) out[safe(plain(d.title) || d.id)] = rows;
  }
  if (!Object.keys(out).length) throw new Error('Les bases Notion accessibles sont vides.');
  return out;
}

export const fetchSaas = (kind: string, c: Cfg) => (kind === 'rest' ? fetchRest(c) : kind === 'airtable' ? fetchAirtable(c) : kind === 'notion' ? fetchNotion(c) : Promise.reject(new Error('Connecteur inconnu')));
