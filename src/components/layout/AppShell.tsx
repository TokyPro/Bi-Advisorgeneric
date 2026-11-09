'use client';
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Menu, Plug, PanelRightClose, PanelRightOpen, MessageSquare, LayoutDashboard } from 'lucide-react';
import { useStore } from '@/lib/store';
import { initApp } from '@/lib/actions';
import { cn } from '@/lib/utils';
import Onboarding from '../onboarding/Onboarding';
import Sidebar from './Sidebar';
import ModelSwitcher from './ModelSwitcher';
import ChatPanel from '../chat/ChatPanel';
import CanvasPanel from '../canvas/CanvasPanel';
import LLMDrawer from '../settings/LLMDrawer';
import ConnectorsModal from '../connectors/ConnectorsModal';
import ReportModal from '../report/ReportModal';

export default function AppShell() {
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  const ui = useStore((s) => s.ui);
  const setUi = useStore((s) => s.setUi);
  const widgets = useStore((s) => s.sessions.find((x) => x.id === s.activeId)?.widgets.length ?? 0);
  useEffect(() => { initApp(); try { if (localStorage.getItem('bia_nav') === '1') useStore.getState().setUi({ navCollapsed: true }); } catch {} }, []);
  const toggleNav = () => { const v = !ui.navCollapsed; setUi({ navCollapsed: v }); try { localStorage.setItem('bia_nav', v ? '1' : '0'); } catch {} };

  if (!hydrated) return <div className="flex h-screen items-center justify-center"><div className="skeleton h-12 w-12 !rounded-2xl" /></div>;
  if (!onboarded) return <Onboarding />;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* sidebar desktop */}
      <motion.div initial={false} animate={{ width: ui.navCollapsed ? 72 : 288 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }} className="hidden shrink-0 overflow-hidden shadow-[6px_0_24px_-10px_rgba(20,20,43,.5)] lg:block"><Sidebar collapsed={ui.navCollapsed} onToggle={toggleNav} /></motion.div>
      {/* sidebar mobile */}
      {ui.sidebar && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-black/40" onClick={() => setUi({ sidebar: false })} /><div className="absolute left-0 top-0 h-full w-72"><Sidebar onNavigate={() => setUi({ sidebar: false })} /></div></div>}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="glass flex items-center gap-2 border-b border-line px-4 py-2.5">
          <button onClick={() => setUi({ sidebar: true })} aria-label="Menu" className="rounded-xl p-2 hover:bg-surface2 lg:hidden"><Menu size={18} /></button>
          <div className="flex rounded-full bg-surface2 p-0.5 lg:hidden">
            {([['chat', MessageSquare], ['canvas', LayoutDashboard]] as const).map(([t, I]) => (
              <button key={t} onClick={() => setUi({ tab: t })} className={cn('flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold', ui.tab === t ? 'bg-surface shadow-sm' : 'text-muted')}><I size={13} />{t === 'chat' ? 'Chat' : `Canvas${widgets ? ` (${widgets})` : ''}`}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setUi({ connectors: true })} className="card flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-none hover:shadow-card"><Plug size={14} />Sources</button>
            <ModelSwitcher />
            <button onClick={() => setUi({ canvas: !ui.canvas })} aria-label="Afficher/masquer le canvas" className="hidden rounded-xl p-2 text-muted hover:bg-surface2 lg:block">{ui.canvas ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className={cn('min-w-0 flex-1', ui.tab !== 'chat' && 'max-lg:hidden', ui.canvas && 'lg:max-w-[48%] lg:basis-[48%]')}><ChatPanel /></div>
          {ui.canvas && <div className={cn('min-w-0 flex-1 border-l border-line bg-surface/50', ui.tab !== 'canvas' && 'max-lg:hidden')}><CanvasPanel /></div>}
        </div>
      </main>

      <LLMDrawer />
      <ConnectorsModal />
      <ReportModal />
    </div>
  );
}
