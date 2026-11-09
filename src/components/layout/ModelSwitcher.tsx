'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useStore } from '@/lib/store';
import { PROVIDERS, provider, fmtCtx, catalogOf, modelLabel, DEMO_MODEL } from '@/lib/llm/models';
import { hasSecret } from '@/lib/vault';
import { Dot } from '../ui/primitives';
import { toast } from 'sonner';

/** Bascule instantanée de fournisseur / modèle, même au milieu d'une conversation. */
export default function ModelSwitcher() {
  const { llm, keyStatus } = useStore();
  useStore((s) => s.catalog);
  const setLlm = useStore((s) => s.setLlm);
  const setUi = useStore((s) => s.setUi);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const p = provider(llm.provider);
  const label = llm.customModel || (llm.provider === 'demo' ? DEMO_MODEL.label : modelLabel(llm.provider, llm.model)) || 'Choisir un modèle';

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="card flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold shadow-none hover:shadow-card">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{label}<ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div className="card absolute right-0 top-full z-40 mt-2 w-72 overflow-hidden p-1.5 shadow-soft">
          {PROVIDERS.filter((pr) => pr.id === 'demo' || (catalogOf(pr.id).length > 0 && (keyStatus[pr.id] === 'ok' || hasSecret('llm:' + pr.id)))).map((pr) => {
            const ok = pr.id === 'demo' || keyStatus[pr.id] === 'ok' || hasSecret('llm:' + pr.id);
            return (
              <div key={pr.id} className="mb-1">
                <div className="flex items-center gap-2 px-2.5 pb-0.5 pt-1.5 text-[10.5px] font-bold uppercase tracking-wide text-muted"><span className="h-2 w-2 rounded-full" style={{ background: pr.color }} />{pr.label}<span className="ml-auto"><Dot status={pr.id === 'demo' ? 'ok' : keyStatus[pr.id] ?? (ok ? 'unknown' : 'unknown')} /></span></div>
                {catalogOf(pr.id).slice(0, 30).map((m) => (
                  <button key={m.id} onClick={() => {
                    if (!ok) { toast.info(`Ajoutez d’abord votre clé ${pr.label}`); setUi({ settings: true }); setOpen(false); return; }
                    setLlm({ provider: pr.id, model: m.id, customModel: '' }); setOpen(false);
                  }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] hover:bg-surface2">
                    <span className="flex-1">{m.label}{m.context ? <span className="ml-1.5 text-[10.5px] text-muted">{fmtCtx(m.context)} ctx</span> : null}</span>
                    {llm.provider === pr.id && llm.model === m.id && !llm.customModel && <Check size={14} className="text-brand-violet" />}
                  </button>
                ))}
              </div>
            );
          })}
          <button onClick={() => { setUi({ settings: true }); setOpen(false); }} className="w-full rounded-xl px-2.5 py-1.5 text-left text-[12px] font-semibold text-brand-violet hover:bg-surface2">Configurer / valider une clé API…</button>
        </div>
      )}
    </div>
  );
}
