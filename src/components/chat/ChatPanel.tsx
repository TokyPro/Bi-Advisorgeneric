'use client';
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Plug } from 'lucide-react';
import { useStore } from '@/lib/store';
import { sendMessage } from '@/lib/actions';
import { Robot } from '../onboarding/illustrations';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';

export default function ChatPanel() {
  const messages = useStore((s) => s.sessions.find((x) => x.id === s.activeId)?.messages) ?? [];
  const sources = useStore((s) => s.sources);
  const setUi = useStore((s) => s.setUi);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, messages[messages.length - 1]?.content.length]);

  const suggestions = sources.filter((s) => s.enabled).flatMap((s) => (s.insights || []).slice(0, 3).map((q) => ({ q, src: s.name }))).slice(0, 6);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
            <Robot size={150} />
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Posez vos questions. <span className="text-grad">Obtenez des réponses.</span></h1>
            <p className="mt-2 max-w-md text-sm text-muted">Je suis Bibo, votre conseiller BI. Interrogez vos bases, votre ERP Odoo, vos Sheets et vos fichiers en langage naturel.</p>
            {suggestions.length > 0 ? (
              <div className="mt-6 w-full text-left">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted"><Sparkles size={13} className="text-brand-pink" />Suggestions d’analyse (Auto-EDA)</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {suggestions.map((s, i) => (
                    <motion.button key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} onClick={() => sendMessage(s.q)}
                      className="card p-3 text-left text-[13px] transition hover:-translate-y-0.5 hover:border-brand-violet/40 hover:shadow-soft">
                      {s.q}<div className="mt-1 text-[10.5px] text-muted">{s.src}</div>
                    </motion.button>
                  ))}
                </div>
              </div>
            ) : (
              <button onClick={() => setUi({ connectors: true })} className="btn-grad mt-6 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold shadow-soft"><Plug size={16} />Connecter une source</button>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((m) => <MessageBubble key={m.id} m={m} />)}
            <div ref={endRef} />
          </div>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl"><ChatInput /></div>
    </section>
  );
}
