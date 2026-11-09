'use client';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '@/lib/store';
import { loadDemo } from '@/lib/actions';
import { Robot, Bulb, Bubbles } from './illustrations';

const STEPS = [
  { title: ['Posez vos questions.', 'Obtenez des réponses.'], text: 'Plus vous échangez, mieux nous comprenons vos besoins et gardons le contexte de vos analyses.', art: <Robot size={210} /> },
  { title: ['Situations complexes.', 'Solutions intelligentes.'], text: 'Posez des questions complexes sur vos bases, votre ERP ou vos fichiers et obtenez des réponses instantanées.', art: <Bulb size={190} /> },
  { title: ['Tout ce qu’il vous faut.', 'Au même endroit.'], text: 'Connectez vos données, générez des graphiques interactifs, des rapports exécutifs et dialoguez avec le LLM de votre choix.', art: <Bubbles size={250} /> },
];

export default function Onboarding() {
  const [i, setI] = useState(0);
  const set = useStore((s) => s.set);
  const finish = () => {
    set({ onboarded: true });
    if (!useStore.getState().sources.length) (['demo-sales', 'demo-odoo', 'demo-excel'] as const).forEach((k) => loadDemo(k, true));
  };
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden p-4" style={{ background: 'radial-gradient(900px 600px at 15% 0%, rgb(var(--glow1) / .45), transparent 60%), radial-gradient(900px 600px at 90% 100%, rgb(var(--glow2) / .5), transparent 60%), rgb(var(--bg))' }}>
      <div className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-brand-blue/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-10 h-72 w-72 rounded-full bg-brand-pink/25 blur-3xl" />
      <div className="relative flex w-full max-w-[400px] flex-col overflow-hidden rounded-[2rem] bg-white/85 shadow-soft backdrop-blur" style={{ minHeight: 640 }}>
        <div className="absolute inset-x-0 top-0 h-72" style={{ background: 'linear-gradient(180deg, rgb(var(--glow1) / .45) 0%, rgba(255,255,255,0) 100%)' }} />
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.28 }} className="relative flex flex-1 flex-col items-center px-8 pt-10">
            <div className="flex h-[290px] items-center justify-center">{step.art}</div>
            <h1 className="mt-2 text-center text-[26px] font-extrabold leading-tight text-[#14142b]">{step.title[0]}<br />{step.title[1]}</h1>
            <p className="mt-3 text-center text-sm leading-relaxed text-[#4c4f6b]">{step.text}</p>
          </motion.div>
        </AnimatePresence>
        <div className="relative px-8 pb-8">
          <div className="mb-5 flex justify-center gap-2">
            {STEPS.map((_, k) => <span key={k} className={`h-2 rounded-full transition-all ${k === i ? 'w-5 bg-[#14142b]' : 'w-2 bg-slate-300'}`} />)}
          </div>
          <button onClick={finish} className="mb-3 h-12 w-full rounded-full bg-slate-200/70 text-sm font-semibold text-[#14142b] transition hover:bg-slate-200">Passer</button>
          <button onClick={() => (last ? finish() : setI(i + 1))} className="btn-grad h-12 w-full rounded-full text-sm font-bold shadow-soft transition active:scale-[.98]">{last ? 'Commencer' : 'Continuer'}</button>
        </div>
      </div>
    </div>
  );
}
