import type { TableSchema } from '@/lib/types';

type Cfg = Record<string, string>;

/** Modules métier analysés automatiquement (Ventes, Achats, Compta, CRM, Stock). */
export const ODOO_MODELS: Record<string, string> = {
  'sale.order': 'Ventes — commandes', 'sale.order.line': 'Ventes — lignes',
  'purchase.order': 'Achats — commandes', 'purchase.order.line': 'Achats — lignes',
  'account.move': 'Comptabilité — pièces/factures', 'account.move.line': 'Comptabilité — écritures',
  'crm.lead': 'CRM — pistes/opportunités', 'stock.quant': 'Stock — quantités',
  'product.product': 'Produits', 'res.partner': 'Contacts',
};

let rpcId = 1;
async function rpc(url: string, service: string, method: string, args: unknown[]) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/jsonrpc`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: rpcId++ }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.data?.message || j.error.message || 'Erreur Odoo');
  return j.result;
}

async function login(c: Cfg) {
  if (!c.url || !c.database || !c.username || !c.password) throw new Error('URL, base, utilisateur et clé API requis.');
  const uid = await rpc(c.url, 'common', 'authenticate', [c.database, c.username, c.password, {}]);
  if (!uid) throw new Error('Authentification Odoo refusée (utilisateur / clé API / base).');
  return uid as number;
}

const exec = (c: Cfg, uid: number, model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) =>
  rpc(c.url, 'object', 'execute_kw', [c.database, uid, c.password, model, method, args, kwargs]);

export async function testOdoo(c: Cfg) {
  const uid = await login(c);
  const v = await rpc(c.url, 'common', 'version', []);
  return `Odoo ${v.server_version} · uid ${uid}`;
}

export async function schemaOdoo(c: Cfg): Promise<TableSchema[]> {
  const uid = await login(c);
  const out: TableSchema[] = [];
  for (const [model, description] of Object.entries(ODOO_MODELS)) {
    try {
      const fields = await exec(c, uid, model, 'fields_get', [], { attributes: ['string', 'type', 'relation', 'store'] });
      const cols = Object.entries(fields as Record<string, { type: string; relation?: string; store?: boolean; string: string }>)
        .filter(([, f]) => f.store !== false && !['binary', 'html'].includes(f.type))
        .slice(0, 60)
        .map(([name, f]) => ({ name, type: f.type, fk: f.relation }));
      let rowCount: number | undefined;
      try { rowCount = await exec(c, uid, model, 'search_count', [[]]); } catch { /* droits */ }
      out.push({ name: model, columns: cols, rowCount, description });
    } catch { /* module non installé ou accès refusé : on ignore */ }
  }
  if (!out.length) throw new Error('Aucun modèle accessible (modules non installés ou droits insuffisants).');
  return out;
}

export async function queryOdoo(c: Cfg, q: { model: string; domain?: unknown[]; fields?: string[]; groupby?: string[]; order?: string; limit?: number; method?: string }) {
  const uid = await login(c);
  const limit = Math.min(q.limit ?? 500, 1000);
  if (q.method === 'read_group' || q.groupby?.length) {
    const res = await exec(c, uid, q.model, 'read_group', [q.domain || [], q.fields || [], q.groupby || []], { lazy: false, orderby: q.order, limit });
    return (res as Record<string, unknown>[]).map((r) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k.startsWith('__') || k === '__domain') continue;
        o[k] = Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' ? v[1] : v;
      }
      return o;
    });
  }
  const rows = await exec(c, uid, q.model, 'search_read', [q.domain || []], { fields: q.fields || [], limit, order: q.order });
  return (rows as Record<string, unknown>[]).map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k] = Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' ? v[1] : v;
    return o;
  });
}
