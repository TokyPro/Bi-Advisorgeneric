/* eslint-disable @typescript-eslint/no-explicit-any */
import alasql from 'alasql';
import type { Row, TableSchema } from '../types';

/** Moteur SQL local (alasql) : une base isolée par source (démo, fichiers, Sheets). */
const dbs = new Map<string, any>();
const rawTables = new Map<string, Record<string, Row[]>>();

export function registerLocal(sourceId: string, tables: Record<string, Row[]>) {
  const db = new (alasql as any).Database('db_' + sourceId.replace(/\W/g, '_'));
  for (const [name, rows] of Object.entries(tables)) {
    db.exec(`CREATE TABLE \`${name}\``);
    db.tables[name].data = rows;
  }
  dbs.set(sourceId, db);
  rawTables.set(sourceId, tables);
}

export const hasLocal = (id: string) => dbs.has(id);
export const getLocalTables = (id: string) => rawTables.get(id);
export function dropLocal(id: string) { dbs.delete(id); rawTables.delete(id); }

export function queryLocal(sourceId: string, sql: string): Row[] {
  const db = dbs.get(sourceId);
  if (!db) throw new Error('Données locales indisponibles (rechargez le fichier ou la source).');
  const s = sql.trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(s)) throw new Error('Seules les requêtes SELECT sont autorisées.');
  try {
    const res = db.exec(s);
    const rows: Row[] = Array.isArray(res) ? res : [];
    return rows.slice(0, 2000);
  } catch (e) {
    throw new Error(`Erreur SQL : ${(e as Error).message}`);
  }
}

export function sampleRows(sourceId: string, table: string, n = 5): Row[] {
  return (rawTables.get(sourceId)?.[table] || []).slice(0, n);
}

/** Détection automatique du type de colonne. */
export function detectType(values: unknown[]): string {
  const v = values.filter((x) => x !== null && x !== undefined && x !== '').slice(0, 200);
  if (!v.length) return 'text';
  if (v.every((x) => typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && isFinite(Number(x.replace(/\s/g, '').replace(',', '.')))))) return v.every((x) => Number.isInteger(Number(String(x).replace(',', '.')))) ? 'int' : 'number';
  if (v.every((x) => typeof x === 'boolean')) return 'boolean';
  if (v.every((x) => x instanceof Date || (typeof x === 'string' && /^\d{4}-\d{2}(-\d{2})?([T ]|$)/.test(x)))) return 'date (YYYY-MM-DD texte)';
  return 'text';
}

export function inferSchema(tables: Record<string, Row[]>): TableSchema[] {
  return Object.entries(tables).map(([name, rows]) => ({
    name,
    rowCount: rows.length,
    columns: Object.keys(rows[0] || {}).map((c) => ({ name: c, type: detectType(rows.map((r) => r[c])) })),
  }));
}

/** Normalise les valeurs numériques en string ("1 234,5") vers number, selon le type détecté. */
export function coerceTable(rows: Row[], schema: TableSchema): Row[] {
  const numeric = schema.columns.filter((c) => c.type === 'int' || c.type === 'number').map((c) => c.name);
  const dates = schema.columns.filter((c) => c.type.startsWith('date')).map((c) => c.name);
  return rows.map((r) => {
    const o: Row = { ...r };
    for (const c of numeric) if (typeof o[c] === 'string') o[c] = Number((o[c] as string).replace(/\s/g, '').replace(',', '.'));
    for (const c of dates) if (o[c] instanceof Date) o[c] = (o[c] as Date).toISOString().slice(0, 10);
    return o;
  });
}
