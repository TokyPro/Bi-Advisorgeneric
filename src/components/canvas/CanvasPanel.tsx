'use client';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { FileText, FileSpreadsheet, Trash2, LayoutDashboard } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { exportXlsx } from '@/lib/bi/export';
import { Bulb } from '../onboarding/illustrations';
import WidgetCard from './WidgetCard';

export default function CanvasPanel() {
  const widgets = useStore((s) => s.sessions.find((x) => x.id === s.activeId)?.widgets) ?? [];
  const setWidgets = useStore((s) => s.setWidgets);
  const setUi = useStore((s) => s.setUi);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const a = widgets.findIndex((w) => w.id === e.active.id), b = widgets.findIndex((w) => w.id === e.over!.id);
    setWidgets(arrayMove(widgets, a, b));
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div className="flex items-center gap-2"><LayoutDashboard size={17} className="text-brand-violet" /><h2 className="text-sm font-bold">Canvas</h2><span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-semibold text-muted">{widgets.length}</span></div>
        <div className="flex items-center gap-1.5">
          <button disabled={!widgets.length} onClick={() => setUi({ report: true })} className="btn-grad flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-40"><FileText size={14} />Rapport exécutif</button>
          <button disabled={!widgets.length} onClick={() => exportXlsx(widgets.map((w) => ({ name: w.title, rows: w.rows })), 'bi-advisor-donnees').then(() => toast.success('Classeur Excel exporté'))} title="Exporter toutes les données (Excel)" className="rounded-full border border-line p-2 text-muted hover:bg-surface2 disabled:opacity-40"><FileSpreadsheet size={14} /></button>
          <button disabled={!widgets.length} onClick={() => setWidgets([])} title="Vider le canvas" className="rounded-full border border-line p-2 text-muted hover:bg-red-50 hover:text-red-500 disabled:opacity-40"><Trash2 size={14} /></button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {widgets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Bulb size={130} />
            <h3 className="mt-3 text-base font-bold">Votre tableau de bord vit ici</h3>
            <p className="mt-1 max-w-xs text-sm text-muted">Posez une question dans le chat : graphiques, KPI et tableaux s’affichent instantanément, réorganisables par glisser-déposer.</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
            <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-4">{widgets.map((w) => <WidgetCard key={w.id} w={w} />)}</div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </section>
  );
}
