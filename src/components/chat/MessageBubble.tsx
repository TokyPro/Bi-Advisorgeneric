'use client';
import { memo, useMemo } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage } from '@/lib/types';
import { splitContent } from '@/lib/bi/blocks';
import { provider } from '@/lib/llm/models';
import QueryCard from './QueryCard';
import { RobotMark } from '../onboarding/illustrations';
import SafeMarkdown from '../ui/SafeMarkdown';

function Bubble({ m }: { m: ChatMessage }) {
  const segs = useMemo(() => (m.role === 'assistant' ? splitContent(m.content) : []), [m.content, m.role]);

  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bubble-user max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg px-4 py-2.5 text-[13.5px]">{m.content}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0 drop-shadow-[0_4px_6px_rgba(95,107,216,.35)]" aria-hidden><RobotMark size={34} /></div>
      <div className="min-w-0 max-w-[92%] flex-1">
        <div className={m.error ? 'rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300' : ''}>
          {segs.map((s, i) => s.type === 'text'
            ? s.text.trim() && <SafeMarkdown key={i} text={s.text} variant="chat" className="md text-[13.5px]" />
            : <QueryCard key={i} q={s.query} raw={s.raw} partial={s.partial} parseError={s.parseError} run={m.runs?.[s.index]} />)}
          {m.streaming && !m.content && <div className="flex gap-1 py-2">{[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-pulseDot rounded-full bg-brand-violet/60" style={{ animationDelay: `${i * 0.2}s` }} />)}</div>}
          {m.streaming && m.content && <span className="inline-block h-4 w-1.5 animate-pulseDot rounded-sm bg-brand-violet align-middle" />}
        </div>
        {!m.streaming && m.content && !m.error && (
          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted">
            <span>{m.provider ? provider(m.provider).label : ''}{m.model && m.provider !== 'demo' ? ` · ${m.model}` : ''}</span>
            {m.costUsd ? <span>≈ ${m.costUsd < 0.01 ? m.costUsd.toFixed(4) : m.costUsd.toFixed(3)}</span> : null}
            <button onClick={() => { navigator.clipboard.writeText(m.content); toast.success('Réponse copiée'); }} className="flex items-center gap-1 hover:text-fg"><Copy size={11} />Copier</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(Bubble);
