import { testSql, schemaSql, querySql } from './sql';
import { testMongo, schemaMongo, queryMongo } from './mongo';
import { testOdoo, schemaOdoo, queryOdoo } from './odoo';
import { fetchSaas } from './saas';

type Cfg = Record<string, string>;
const isSql = (k: string) => ['postgres', 'mysql', 'mssql', 'sqlite'].includes(k);

const isSaas = (k: string) => ['rest', 'airtable', 'notion'].includes(k);
export { fetchSaas };
export const test = (kind: string, c: Cfg) => (isSaas(kind) ? fetchSaas(kind, c).then((t) => `${Object.keys(t).length} table(s), ${Object.values(t).reduce((a, r) => a + r.length, 0)} lignes`) : isSql(kind) ? testSql(kind, c) : kind === 'mongodb' ? testMongo(c) : kind === 'odoo' ? testOdoo(c) : Promise.reject(new Error('Connecteur inconnu')));
export const schema = (kind: string, c: Cfg) => (isSql(kind) ? schemaSql(kind, c) : kind === 'mongodb' ? schemaMongo(c) : kind === 'odoo' ? schemaOdoo(c) : Promise.reject(new Error('Connecteur inconnu')));
export async function query(kind: string, c: Cfg, q: { sql?: string; odoo?: Parameters<typeof queryOdoo>[1]; mongo?: Parameters<typeof queryMongo>[1] }) {
  if (isSql(kind)) return querySql(kind, c, q.sql || '');
  if (kind === 'mongodb') return queryMongo(c, q.mongo!);
  if (kind === 'odoo') return queryOdoo(c, q.odoo!);
  throw new Error('Connecteur inconnu');
}

/** Message d'erreur lisible pour les erreurs réseau / driver fréquentes. */
export function friendly(e: unknown): string {
  const m = (e as Error)?.message || String(e);
  if (/ECONNREFUSED/.test(m)) return 'Connexion refusée : vérifiez hôte, port et pare-feu.';
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'Hôte introuvable : vérifiez l’adresse.';
  if (/ETIMEDOUT|timeout/i.test(m)) return 'Délai dépassé : le serveur ne répond pas.';
  if (/password authentication failed|Access denied|Login failed/i.test(m)) return 'Identifiants refusés par la base.';
  if (/Cannot find (module|package)/i.test(m)) return 'Driver non installé côté serveur (npm install).';
  return m;
}
