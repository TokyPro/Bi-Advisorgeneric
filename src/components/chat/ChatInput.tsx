'use client';
import { useMemo, useRef, useState } from 'react';
import { ArrowUp, Square, AtSign, Table2, FileText } from 'lucide-react';
import { useStore } from '@/lib/store';
import { sendMessage, stopGeneration } from '@/lib/actions';
import { cn } from '@/lib/utils';

interface Opt { label: string; insert: string; hint: string; doc?: boolean }

export default function ChatInput() {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = useStore((s) => s.busy);
  const sources = useStore((s) => s.sources);

  const options: Opt[] = useMemo(() => sources.filter((s) => s.enabled).flatMap((s) => s.kind === 'document' ? [{ label: s.name, insert: s.name.replace(/\s+/g, '_'), hint: 'Document', doc: true }] : s.schema.map((t) => ({ label: t.name, insert: t.name, hint: `${s.name} · ${t.columns.length} col.` }))), [sources]);

  // détecte "@mot" avant le curseur
  const m = /(?:^|\s)@([\w.À-ſ-]*)$/.exec(text.slice(0, caret));
  const filtered = m ? options.filter((o) => o.label.toLowerCase().includes(m[1].toLowerCase())).slice(0, 7) : [];
  const open = !!m && filtered.length > 0;

  const pick = (o: Opt) => {
    const start = caret - m![1].length - 1;
    const next = text.slice(0, start) + '@' + o.insert + ' ' + text.slice(caret);
    setText(next); setSel(0);
    requestAnimationFrame(() => { const p = start + o.insert.length + 2; ref.current?.focus(); ref.current?.setSelectionRange(p, p); setCaret(p); });
  };

  const submit = () => {
    if (!text.trim() || busy) return;
    const mentioned = [...text.matchAll(/@([\w.À-ſ-]+)/g)].map((x) => x[1]);
    const t = text; setText('');
    sendMessage(t, mentioned);
  };

  return (
    <div className="relative px-4 pb-4 pt-2">
      {open && (
        <div className="card absolute bottom-full left-4 right-4 z-30 mb-1 overflow-hidden p-1 shadow-soft">
          <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-muted">Tables & documents</div>
          {filtered.map((o, i) => (
            <button key={o.label + i} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setSel(i)}
              className={cn('flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm', i === sel % filtered.length ? 'bg-brand-violet/10' : '')}>
              {o.doc ? <FileText size={14} className="text-brand-pink" /> : <Table2 size={14} className="text-brand-blue" />}
              <span className="font-medium">{o.label}</span><span className="ml-auto text-[11px] text-muted">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
      <div className="card flex items-end gap-2 p-2 shadow-soft focus-within:ring-2 focus-within:ring-brand-violet/25">
        <button onClick={() => { setText((t) => t + (t && !t.endsWith(' ') ? ' @' : '@')); ref.current?.focus(); setTimeout(() => setCaret((ref.current?.value.length) || 0), 0); }} aria-label="Citer une table" title="Citer une table (@)" className="mb-1 rounded-xl p-2 text-muted hover:bg-surface2"><AtSign size={17} /></button>
        <textarea ref={ref} value={text} rows={1} placeholder="Posez une question… (@ pour citer une table)"
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
          onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)} onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % filtered.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + filtered.length) % filtered.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(filtered[sel % filtered.length]); return; }
              if (e.key === 'Escape') { setText((t) => t + ' '); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted/70" />
        {busy ? (
          <button onClick={stopGeneration} aria-label="Arrêter" className="mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-fg text-bg shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_3px_0_rgba(0,0,0,.35)] active:translate-y-0.5"><Square size={14} fill="currentColor" /></button>
        ) : (
          <button onClick={submit} disabled={!text.trim()} aria-label="Envoyer" className="btn-grad mb-1 flex h-9 w-9 items-center justify-center rounded-full shadow-soft transition active:scale-95 disabled:opacity-40"><ArrowUp size={18} /></button>
        )}
      </div>
    </div>
  );
}
