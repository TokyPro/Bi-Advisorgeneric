'use client';
import { useState } from 'react';
import { CheckCircle2, XCircle, Code2, Copy, Wand2, LayoutDashboard } from 'lucide-react';
import { toast } from 'sonner';
import type { BiQuery, QueryRun } from '@/lib/types';
import { Spinner } from '../ui/primitives';
import { sendMessage } from '@/lib/actions';
import { useStore } from '@/lib/store';

export default function QueryCard({ q, raw, run, partial, parseError }: { q?: BiQuery; raw: string; run?: QueryRun; partial?: boolean; parseError?: string }) {
  const [open, setOpen] = useState(false);
  const busy = useStore((s) => s.busy);
  const setUi = useStore((s) => s.setUi);
  const text = q?.sql ?? (q?.odoo ? JSON.stringify(q.odoo, null, 2) : q?.mongo ? JSON.stringify(q.mongo, null, 2) : raw);

  if (partial) return <div className="my-2 flex items-center gap-2 rounded-2xl border border-dashed border-line bg-surface2 px-3 py-2 text-xs text-muted"><Spinner size={14} /> Génération de la requête…</div>;

  const status = parseError ? 'error' : run?.status ?? 'running';
  const err = parseError || run?.error;
  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-2 px-3 py-2">
        {status === 'running' ? <Spinner size={15} /> : status === 'ok' ? <CheckCircle2 size={16} className="text-emerald-500" /> : <XCircle size={16} className="text-red-500" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{q?.viz?.title || 'Requête'}</div>
          <div className="text-[11px] text-muted">{status === 'ok' ? `${run?.rowCount} lignes · ${run?.ms} ms · ajouté au canvas` : status === 'running' ? 'Exécution…' : 'Échec'}</div>
        </div>
        {status === 'ok' && <button onClick={() => setUi({ canvas: true, tab: 'canvas' })} className="flex items-center gap-1 rounded-full bg-brand-violet/10 px-2.5 py-1 text-[11px] font-semibold text-brand-violet"><LayoutDashboard size={12} />Voir</button>}
        <button onClick={() => setOpen(!open)} aria-label="Voir la requête" className="rounded-lg p-1.5 text-muted hover:bg-surface2"><Code2 size={14} /></button>
      </div>
      {open && (
        <div className="relative border-t border-line bg-brand-navy p-3">
          <button onClick={() => { navigator.clipboard.writeText(text); toast.success('Requête copiée'); }} aria-label="Copier" className="absolute right-2 top-2 rounded-md p-1 text-white/60 hover:bg-white/10"><Copy size={13} /></button>
          <pre className="overflow-x-auto pr-6 font-mono text-[11.5px] leading-relaxed text-sky-100">{text}</pre>
        </div>
      )}
      {err && (
        <div className="flex items-start justify-between gap-2 border-t border-red-100 bg-red-50 px-3 py-2 text-[11.5px] text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          <span>{err}</span>
          <button disabled={busy} onClick={() => sendMessage(`La requête a échoué avec l'erreur suivante : « ${err} ». Corrige-la en respectant strictement le schéma et le dialecte, puis relance-la.`)} className="flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-1 font-semibold text-red-600 shadow-sm disabled:opacity-50 dark:bg-surface"><Wand2 size={12} />Corriger avec l’IA</button>
        </div>
      )}
    </div>
  );
}
