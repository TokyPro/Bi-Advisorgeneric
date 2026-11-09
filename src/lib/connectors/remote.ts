import { authFetch } from '../auth-client';
import type { DataSource, Row, TableSchema, BiQuery } from '../types';
import { getSecret, setSecret, removeSecret } from '../vault';
import { queryLocal } from './local-engine';

/** Configs des connecteurs distants : en mémoire + chiffrées dans le vault (jamais en clair dans localStorage). */
const configs = new Map<string, Record<string, string>>();

export async function saveConfig(id: string, cfg: Record<string, string>) { configs.set(id, cfg); await setSecret('src:' + id, JSON.stringify(cfg)); }
export async function loadConfig(id: string) {
  if (configs.has(id)) return configs.get(id)!;
  const s = await getSecret('src:' + id);
  if (!s) return null;
  const c = JSON.parse(s); configs.set(id, c); return c as Record<string, string>;
}
export function deleteConfig(id: string) { configs.delete(id); removeSecret('src:' + id); }

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try { res = await authFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('Serveur injoignable. Vérifiez que l’application tourne.'); }
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.error || `Erreur serveur (${res.status})`);
  return j as T;
}

export const testRemote = (kind: string, config: Record<string, string>) => post<{ message: string }>('/api/connectors/test', { kind, config });
export const fetchTables = async (kind: string, config: Record<string, string>) => (await post<{ tables: Record<string, Row[]> }>('/api/connectors/fetch', { kind, config })).tables;
export const schemaRemote = async (kind: string, config: Record<string, string>) => (await post<{ schema: TableSchema[] }>('/api/connectors/schema', { kind, config })).schema;

/** Résout une source par id ou par nom (le LLM peut citer l'un ou l'autre). */
export function resolveSource(sources: DataSource[], ref: string): DataSource {
  const r = (ref || '').toLowerCase();
  const s = sources.find((x) => x.id === ref) || sources.find((x) => x.name.toLowerCase() === r) || sources.find((x) => x.name.toLowerCase().includes(r) && r.length > 2);
  if (s) return s;
  const enabled = sources.filter((x) => x.enabled && x.kind !== 'document');
  if (enabled.length === 1) return enabled[0];
  throw new Error(`Source « ${ref} » introuvable.`);
}

export async function runBiQuery(sources: DataSource[], q: BiQuery): Promise<{ rows: Row[]; source: DataSource; text: string }> {
  const source = resolveSource(sources, q.source);
  if (source.engine === 'local') {
    if (!q.sql) throw new Error('Requête SQL manquante.');
    return { rows: queryLocal(source.id, q.sql), source, text: q.sql };
  }
  const config = await loadConfig(source.id);
  if (!config) throw new Error('Identifiants de la source introuvables : reconnectez-la.');
  const payload = source.kind === 'odoo' ? { odoo: q.odoo } : source.kind === 'mongodb' ? { mongo: q.mongo } : { sql: q.sql };
  if (source.kind === 'odoo' && !q.odoo) throw new Error('Requête Odoo manquante.');
  if (source.kind === 'mongodb' && !q.mongo) throw new Error('Pipeline Mongo manquant.');
  const { rows } = await post<{ rows: Row[] }>('/api/connectors/query', { kind: source.kind, config, query: payload });
  const text = source.kind === 'odoo' ? JSON.stringify(q.odoo, null, 2) : source.kind === 'mongodb' ? JSON.stringify(q.mongo, null, 2) : q.sql!;
  return { rows, source, text };
}
