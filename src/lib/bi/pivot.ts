import type { Row } from '../types';

/** Pivot simple : lignes = x, colonnes = series (ou y multiples), valeurs = somme. */
export function pivot(rows: Row[], rowKey: string, colKey: string | undefined, valueKey: string) {
  const cols = new Set<string>();
  const m = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const rk = String(r[rowKey] ?? '—');
    const ck = colKey ? String(r[colKey] ?? '—') : valueKey;
    cols.add(ck);
    const rec = m.get(rk) || {};
    rec[ck] = (rec[ck] || 0) + (Number(r[valueKey]) || 0);
    m.set(rk, rec);
  }
  const columns = [...cols];
  const data = [...m.entries()].map(([k, v]) => ({ key: k, values: columns.map((c) => v[c] ?? 0), total: Object.values(v).reduce((a, b) => a + b, 0) }));
  return { columns, data };
}

/** Pivote une table "longue" (x, series, y) en format large pour Recharts. */
export function toWide(rows: Row[], x: string, series: string, y: string) {
  const keys = new Set<string>();
  const m = new Map<string, Row>();
  for (const r of rows) {
    const xv = String(r[x]);
    const s = String(r[series]);
    keys.add(s);
    const rec = m.get(xv) || { [x]: r[x] };
    rec[s] = (Number(rec[s]) || 0) + (Number(r[y]) || 0);
    m.set(xv, rec);
  }
  return { data: [...m.values()], keys: [...keys] };
}
