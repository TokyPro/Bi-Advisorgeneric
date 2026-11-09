'use client';
import { Bar, BarChart, Line, LineChart, Area, AreaChart, Pie, PieChart, Cell, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceDot, ResponsiveContainer } from 'recharts';
import type { Widget, Row } from '@/lib/types';
import { fmtNum, fmtCompact } from '@/lib/utils';
import { toWide, pivot } from '@/lib/bi/pivot';

export const PALETTE = ['rgb(var(--b-blue))', 'rgb(var(--b-pink))', '#2bb5a0', '#f2a93b', 'rgb(var(--b-violet))', '#ef6b7b', '#4dc3e8', '#9bcf53'];

const trunc = (v: unknown, n = 12) => { const s = String(v ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function DataTable({ rows, format, max = 100 }: { rows: Row[]; format?: Widget['viz']['format']; max?: number }) {
  const cols = Object.keys(rows[0] || {});
  return (
    <div className="max-h-[300px] overflow-auto rounded-xl border border-line">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface2"><tr>{cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-semibold text-muted">{c}</th>)}</tr></thead>
        <tbody>{rows.slice(0, max).map((r, i) => (
          <tr key={i} className="border-t border-line hover:bg-surface2/60">{cols.map((c) => <td key={c} className="whitespace-nowrap px-3 py-1.5">{typeof r[c] === 'number' ? fmtNum(r[c], c === 'taux' || /pct|%|taux/i.test(c) ? 'number' : format) : String(r[c] ?? '—')}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function ChartRenderer({ w, height = 260 }: { w: Widget; height?: number }) {
  const { viz, rows } = w;
  const fmt = viz.format;

  if (viz.type === 'kpi') {
    const v = rows[0]?.[viz.y?.[0] || ''];
    return (
      <div className="flex h-full min-h-[96px] flex-col justify-center">
        <div className="text-grad text-4xl font-extrabold tracking-tight">{fmtNum(v, fmt)}</div>
      </div>
    );
  }
  if (viz.type === 'table') return <DataTable rows={rows} format={fmt} />;
  if (viz.type === 'pivot') {
    const p = pivot(rows, viz.x || Object.keys(rows[0])[0], viz.series, viz.y?.[0] || Object.keys(rows[0])[1]);
    return (
      <div className="max-h-[300px] overflow-auto rounded-xl border border-line">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface2"><tr><th className="px-3 py-2 font-semibold text-muted">{viz.x}</th>{p.columns.map((c) => <th key={c} className="px-3 py-2 text-right font-semibold text-muted">{c}</th>)}<th className="px-3 py-2 text-right font-bold">Total</th></tr></thead>
          <tbody>{p.data.map((r) => (
            <tr key={r.key} className="border-t border-line"><td className="px-3 py-1.5 font-medium">{r.key}</td>{r.values.map((v, i) => <td key={i} className="px-3 py-1.5 text-right tabular-nums" style={{ background: `rgba(95,156,241,${Math.min(0.3, v / (r.total || 1) * 0.5)})` }}>{fmtNum(v, fmt)}</td>)}<td className="px-3 py-1.5 text-right font-bold tabular-nums">{fmtNum(r.total, fmt)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    );
  }

  const x = viz.x!;
  let data: Row[] = rows;
  let keys = viz.y || [];
  if (viz.series && viz.y?.length === 1 && rows.some((r) => r[viz.series!] != null)) { const wide = toWide(rows, x, viz.series, viz.y[0]); data = wide.data; keys = wide.keys; }

  if (viz.type === 'pie') {
    const y = keys[0];
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey={y} nameKey={x} innerRadius="52%" outerRadius="82%" paddingAngle={2} stroke="none" label={({ percent }) => (percent && percent > 0.06 ? `${Math.round(percent * 100)}%` : '')} labelLine={false}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => fmtNum(v as number, fmt)} contentStyle={tt} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const horizontal = viz.type === 'bar' && data.length > 8 && !viz.stacked;
  const common = { data, margin: { top: 10, right: 12, left: 0, bottom: 0 } };
  const xAxis = <XAxis dataKey={x} tickFormatter={(v) => trunc(v, 10)} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />;
  const yAxis = <YAxis tickFormatter={(v) => fmtCompact(v)} tickLine={false} axisLine={false} width={46} />;
  const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} />;
  const tip = <Tooltip formatter={(v) => fmtNum(v as number, fmt)} contentStyle={tt} cursor={{ fill: 'rgba(139,108,240,.08)' }} />;
  const legend = keys.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /> : null;
  const marks = !horizontal && viz.type !== 'bar'
    ? w.anomalies.filter((a) => keys.includes(a.column)).map((a) => <ReferenceDot key={a.index + a.column} x={a.label} y={a.value} r={6} fill={a.kind === 'drop' ? '#ef4444' : '#f59e0b'} stroke="#fff" strokeWidth={2} ifOverflow="extendDomain" />)
    : [];

  return (
    <ResponsiveContainer width="100%" height={horizontal ? Math.max(height, data.length * 26) : height}>
      {viz.type === 'line' ? (
        <LineChart {...common}>{grid}{xAxis}{yAxis}{tip}{legend}{keys.map((k, i) => <Line key={k} dataKey={k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />)}{marks}</LineChart>
      ) : viz.type === 'area' ? (
        <AreaChart {...common}>
          <defs>{keys.map((k, i) => <linearGradient key={k} id={`ag-${w.id}-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.4} /><stop offset="1" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.02} /></linearGradient>)}</defs>
          {grid}{xAxis}{yAxis}{tip}{legend}{keys.map((k, i) => <Area key={k} dataKey={k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} fill={`url(#ag-${w.id}-${i})`} stackId={viz.stacked ? 's' : undefined} />)}{marks}
        </AreaChart>
      ) : horizontal ? (
        <BarChart {...common} layout="vertical">{<CartesianGrid strokeDasharray="3 3" horizontal={false} />}<XAxis type="number" tickFormatter={(v) => fmtCompact(v)} tickLine={false} axisLine={false} /><YAxis type="category" dataKey={x} width={110} tickFormatter={(v) => trunc(v, 16)} tickLine={false} axisLine={false} />{tip}{legend}{keys.map((k, i) => <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} radius={[0, 6, 6, 0]} />)}</BarChart>
      ) : (
        <BarChart {...common}>{grid}{xAxis}{yAxis}{tip}{legend}{keys.map((k, i) => <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} radius={[6, 6, 0, 0]} stackId={viz.stacked ? 's' : undefined} maxBarSize={48} />)}</BarChart>
      )}
    </ResponsiveContainer>
  );
}

const tt = { borderRadius: 12, border: '1px solid rgb(227,229,245)', fontSize: 12, boxShadow: '0 8px 24px -8px rgba(60,60,120,.25)' } as const;
