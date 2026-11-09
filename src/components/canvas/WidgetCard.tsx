'use client';
import { useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, BarChart3, LineChart, AreaChart, PieChart, Table2, Grid3x3, Maximize2, Minimize2, Trash2, Download, AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import type { VizType, Widget } from '@/lib/types';
import { cn } from '@/lib/utils';
import { exportCsv, exportPng, exportXlsx } from '@/lib/bi/export';
import { detectAnomalies } from '@/lib/bi/anomaly';
import ChartRenderer from './ChartRenderer';

const TYPES: { t: VizType; icon: typeof BarChart3; label: string }[] = [
  { t: 'bar', icon: BarChart3, label: 'Barres' }, { t: 'line', icon: LineChart, label: 'Courbe' }, { t: 'area', icon: AreaChart, label: 'Aire' },
  { t: 'pie', icon: PieChart, label: 'Camembert' }, { t: 'table', icon: Table2, label: 'Tableau' }, { t: 'pivot', icon: Grid3x3, label: 'Pivot' },
];

export default function WidgetCard({ w, forReport = false }: { w: Widget; forReport?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id, disabled: forReport });
  const patch = useStore((s) => s.patchWidget);
  const remove = useStore((s) => s.removeWidget);
  const source = useStore((s) => s.sources.find((x) => x.id === w.sourceId));
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const file = w.title.replace(/\W+/g, '_').slice(0, 40) || 'analyse';
  const canChart = w.viz.type !== 'kpi' && w.rows.length > 0;

  const switchType = (t: VizType) => {
    const viz = { ...w.viz, type: t };
    const cols = Object.keys(w.rows[0] || {});
    if (!viz.x) viz.x = cols[0];
    if (!viz.y?.length) viz.y = cols.slice(1, 2);
    patch(w.id, { viz, anomalies: detectAnomalies(w.rows, viz) });
  };
  const run = async (fn: () => Promise<void> | void, ok: string) => { try { await fn(); toast.success(ok); } catch (e) { toast.error('Export impossible', { description: (e as Error).message }); } setMenu(false); };

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined }}
      className={cn(w.span === 2 ? 'col-span-2' : 'col-span-1', isDragging && 'opacity-80')}>
      <div ref={ref} className="card group relative h-full p-4 transition hover:shadow-soft">
        <div className="mb-2 flex items-start gap-2">
          {!forReport && <button {...attributes} {...listeners} aria-label="Réorganiser" className="mt-0.5 cursor-grab rounded p-0.5 text-muted/60 hover:text-fg active:cursor-grabbing" data-no-export="1"><GripVertical size={16} /></button>}
          <div className="min-w-0 flex-1">
            {editing ? (
              <input autoFocus defaultValue={w.title} onBlur={(e) => { patch(w.id, { title: e.target.value || w.title }); setEditing(false); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="w-full rounded-lg border border-line bg-surface2 px-2 py-0.5 text-sm font-bold outline-none" />
            ) : (
              <h3 onDoubleClick={() => !forReport && setEditing(true)} title="Double-clic pour renommer" className="truncate text-sm font-bold">{w.title}</h3>
            )}
            <p className="truncate text-[11px] text-muted">{source?.name ?? 'Source supprimée'} · {w.rows.length} ligne{w.rows.length > 1 ? 's' : ''}</p>
          </div>
          {!forReport && (
            <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100" data-no-export="1">
              {canChart && <button onClick={() => patch(w.id, { span: w.span === 2 ? 1 : 2 })} aria-label="Taille" className="rounded-lg p-1.5 text-muted hover:bg-surface2">{w.span === 2 ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>}
              <div className="relative">
                <button onClick={() => setMenu(!menu)} aria-label="Exporter" className="rounded-lg p-1.5 text-muted hover:bg-surface2"><Download size={14} /></button>
                {menu && (
                  <div className="card absolute right-0 top-8 z-30 w-44 overflow-hidden p-1 text-xs shadow-soft">
                    <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-surface2" onClick={() => run(() => exportPng(ref.current!, file), 'Image PNG exportée')}>Image PNG</button>
                    <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-surface2" onClick={() => run(() => exportCsv(w.rows, file), 'CSV exporté')}>CSV</button>
                    <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-surface2" onClick={() => run(() => exportXlsx([{ name: w.title, rows: w.rows }], file), 'Excel exporté')}>Excel (données propres)</button>
                  </div>
                )}
              </div>
              <button onClick={() => remove(w.id)} aria-label="Supprimer" className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          )}
        </div>

        {canChart && !forReport && (
          <div className="mb-2 flex gap-0.5" data-no-export="1">
            {TYPES.map(({ t, icon: I, label }) => (
              <button key={t} onClick={() => switchType(t)} title={label} aria-label={label} className={cn('rounded-lg p-1.5 transition', w.viz.type === t ? 'bg-brand-violet/15 text-brand-violet' : 'text-muted/70 hover:bg-surface2')}><I size={14} /></button>
            ))}
          </div>
        )}

        <ChartRenderer w={w} height={forReport ? 220 : 250} />

        {w.anomalies.length > 0 && (
          <div className="mt-2 space-y-1">
            {w.anomalies.slice(0, forReport ? 6 : 3).map((a, i) => (
              <div key={i} className={cn('flex items-start gap-1.5 rounded-lg px-2 py-1 text-[11px]', a.kind === 'drop' ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300')}>
                {a.kind === 'drop' ? <TrendingDown size={13} className="mt-0.5 shrink-0" /> : a.kind === 'spike' ? <TrendingUp size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
                <span>{a.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
