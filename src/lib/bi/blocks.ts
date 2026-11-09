import type { BiQuery, Row, VizSpec } from '../types';

export type Segment =
  | { type: 'text'; text: string }
  | { type: 'query'; index: number; raw: string; query?: BiQuery; partial?: boolean; parseError?: string };

/** Découpe une réponse LLM en texte Markdown et blocs ```bi-query (supporte le streaming partiel). */
export function splitContent(content: string): Segment[] {
  const out: Segment[] = [];
  const re = /```bi-query\s*\n?([\s\S]*?)(```|$)/g;
  let last = 0, idx = 0, m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index > last) out.push({ type: 'text', text: content.slice(last, m.index) });
    const closed = m[2] === '```';
    const raw = m[1].trim();
    const seg: Segment = { type: 'query', index: idx++, raw, partial: !closed };
    if (closed) {
      try { seg.query = JSON.parse(raw) as BiQuery; } catch (e) { seg.parseError = 'JSON de requête invalide : ' + (e as Error).message; }
    }
    out.push(seg);
    last = m.index + m[0].length;
    if (!closed) break;
  }
  if (last < content.length) out.push({ type: 'text', text: content.slice(last) });
  return out;
}

const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)));

/** Rend la spec de visualisation cohérente avec les colonnes réellement renvoyées. */
export function normalizeViz(rows: Row[], viz?: VizSpec): VizSpec {
  const cols = Object.keys(rows[0] || {});
  const numeric = cols.filter((c) => rows.slice(0, 20).every((r) => r[c] == null || isNum(r[c])) && rows.some((r) => r[c] != null));
  const text = cols.filter((c) => !numeric.includes(c));
  const v: VizSpec = { ...(viz || { type: rows.length === 1 ? 'kpi' : 'table' }) };
  if (!cols.length) return { type: 'table' };
  if (v.type === 'table') return v;
  if (v.type === 'kpi') { v.y = [v.y?.find((c) => cols.includes(c)) || numeric[0] || cols[0]]; return v; }
  if (v.type === 'pivot') {
    v.x = cols.includes(v.x || '') ? v.x : text[0] || cols[0];
    v.series = v.series && cols.includes(v.series) ? v.series : text[1];
    v.y = [v.y?.find((c) => cols.includes(c)) || numeric[0]];
    return v;
  }
  v.x = v.x && cols.includes(v.x) ? v.x : text[0] || cols[0];
  const ys = (v.y || []).filter((c) => cols.includes(c) && c !== v.x);
  v.y = ys.length ? ys : numeric.filter((c) => c !== v.x).slice(0, 3);
  if (!v.y.length) return { ...v, type: 'table' };
  return v;
}
