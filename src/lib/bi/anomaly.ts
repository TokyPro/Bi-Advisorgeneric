import type { Anomaly, Row, VizSpec } from '../types';

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Détection d'anomalies : z-score robuste (médiane / MAD) + chutes/pics période sur période.
 * Pour les séries temporelles (ordre conservé) et pour les catégories (outliers).
 */
export function detectAnomalies(rows: Row[], viz: VizSpec): Anomaly[] {
  if (!rows.length || !viz.y?.length || rows.length < 5) return [];
  const out: Anomaly[] = [];
  const temporal = viz.type === 'line' || viz.type === 'area' || /date|mois|month|jour|day|periode|period|annee|year|trimestre/i.test(viz.x || '');
  for (const col of viz.y.slice(0, 2)) {
    const vals = rows.map((r) => Number(r[col]));
    if (vals.some((v) => !isFinite(v))) continue;
    const med = median(vals);
    const mad = median(vals.map((v) => Math.abs(v - med))) || (Math.abs(med) * 0.1) || 1;
    vals.forEach((v, i) => {
      const z = (0.6745 * (v - med)) / mad;
      const label = String(rows[i][viz.x || ''] ?? i);
      if (Math.abs(z) >= 3.2) {
        out.push({
          index: i, label, value: v, column: col, kind: z > 0 ? 'spike' : 'drop',
          message: `${z > 0 ? 'Pic' : 'Creux'} atypique sur « ${label} » : ${Math.round(v).toLocaleString('fr-FR')} vs médiane ${Math.round(med).toLocaleString('fr-FR')}`,
        });
      } else if (temporal && i > 0 && vals[i - 1] > 0) {
        const chg = (v - vals[i - 1]) / vals[i - 1];
        if (chg <= -0.35) out.push({ index: i, label, value: v, column: col, kind: 'drop', message: `Baisse de ${Math.abs(Math.round(chg * 100))} % sur « ${label} » vs période précédente` });
        else if (chg >= 0.6) out.push({ index: i, label, value: v, column: col, kind: 'spike', message: `Hausse de +${Math.round(chg * 100)} % sur « ${label} » vs période précédente` });
      }
    });
  }
  // dédoublonne par index
  const seen = new Set<number>();
  return out.filter((a) => (seen.has(a.index) ? false : (seen.add(a.index), true))).slice(0, 6);
}
