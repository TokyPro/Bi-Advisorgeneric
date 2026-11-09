'use client';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RefreshCw, FileDown, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { generateReport } from '@/lib/actions';
import { exportPdf } from '@/lib/bi/export';
import { download } from '@/lib/utils';
import { Modal, Spinner } from '../ui/primitives';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import WidgetCard from '../canvas/WidgetCard';

export default function ReportModal() {
  const open = useStore((s) => s.ui.report);
  const setUi = useStore((s) => s.setUi);
  const session = useStore((s) => s.sessions.find((x) => x.id === s.activeId));
  const [md, setMd] = useState('');
  const [loading, setLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const widgets = session?.widgets ?? [];

  const gen = async () => { setLoading(true); setMd(await generateReport(widgets)); setLoading(false); };
  useEffect(() => { if (open && widgets.length) gen(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const pdf = async () => {
    if (!ref.current) return;
    setPdfBusy(true);
    try { await exportPdf(ref.current, 'bilan-strategique-bi-advisor'); toast.success('Rapport PDF généré'); }
    catch (e) { toast.error('Export PDF impossible', { description: (e as Error).message }); }
    setPdfBusy(false);
  };

  return (
    <Modal open={open} onClose={() => setUi({ report: false })} title="Rapport exécutif" subtitle="Bilan stratégique prêt à imprimer ou à exporter" wide>
      <div className="flex items-center gap-2 border-b border-line px-6 py-3">
        <button onClick={gen} disabled={loading} className="flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold hover:bg-surface2"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Régénérer</button>
        <button onClick={pdf} disabled={loading || pdfBusy || !md} className="btn-grad flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold disabled:opacity-50">{pdfBusy ? <Spinner size={13} /> : <FileDown size={14} />}Exporter en PDF</button>
        <button onClick={() => download(new Blob([md], { type: 'text/markdown' }), 'bilan-strategique.md')} disabled={!md} className="flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold hover:bg-surface2"><FileText size={13} />Markdown</button>
      </div>
      <div className="bg-surface2/50 p-6">
        <div ref={ref} className="mx-auto max-w-3xl rounded-2xl bg-white p-8 text-[#14142b]" style={{ colorScheme: 'light' }}>
          <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-4">
            <div><div className="text-xl font-extrabold">Bilan stratégique</div><div className="text-xs text-slate-500">{session?.title} · {new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' })}</div></div>
            <div className="text-right text-sm font-extrabold">BI Advisor</div>
          </div>
          {loading ? <div className="space-y-3">{[90, 70, 85, 60].map((w, i) => <div key={i} className="skeleton h-4" style={{ width: `${w}%` }} />)}</div> : (
            <div className="md text-[13.5px] [&_.md]:text-inherit"><ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown></div>
          )}
          {!loading && widgets.length > 0 && (
            <>
              <h2 className="mb-3 mt-6 text-base font-bold">Annexes — visualisations</h2>
              <DndContext><SortableContext items={widgets.map((w) => w.id)}>
                <div className="grid grid-cols-2 gap-3 [&_.card]:border-slate-200 [&_.card]:bg-white [&_.card]:shadow-none">{widgets.map((w) => <WidgetCard key={w.id} w={w} forReport />)}</div>
              </SortableContext></DndContext>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
