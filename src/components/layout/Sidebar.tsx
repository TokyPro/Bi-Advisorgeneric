'use client';
import Link from 'next/link';
import { LogOut, PanelLeftClose, PanelLeftOpen, PlayCircle } from 'lucide-react';
import ThemePicker from './ThemePicker';
import { RobotMark } from '../onboarding/illustrations';
import { useAuth, logout } from '@/lib/auth-client';
import { Plus, Plug, Settings2, ShieldCheck, Trash2, Eye, EyeOff, Database, FileSpreadsheet, FileText, Cloud, Boxes, MessageSquare, Sparkles, Sun, Moon, Globe, Table2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { disconnectSource, sendMessage } from '@/lib/actions';
import { provider } from '@/lib/llm/models';
import type { SourceKind } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Dot } from '../ui/primitives';

const icon = (k: SourceKind) => k === 'rest' ? Globe : k === 'airtable' || k === 'notion' ? Table2 : k === 'gsheets' ? Cloud : k === 'odoo' || k === 'demo-odoo' ? Boxes : k === 'file' || k === 'demo-excel' ? FileSpreadsheet : k === 'document' ? FileText : Database;

export default function Sidebar({ onNavigate, collapsed = false, onToggle }: { onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const { sources, sessions, activeId, llm, keyStatus, theme } = useStore();
  const st = useStore.getState;
  const setUi = useStore((s) => s.setUi);
  const me = useAuth((a) => a.user);
  const authOff = useAuth((a) => a.authDisabled);
  const ks = llm.provider === 'demo' ? 'ok' : keyStatus[llm.provider] ?? 'unknown';

  return (
    <aside className="flex h-full w-full flex-col bg-brand-navy text-white">
      <div className={cn('flex items-center pb-3 pt-5', collapsed ? 'flex-col gap-3 px-2' : 'gap-2.5 px-4')}>
        <div className="drop-shadow-[0_6px_10px_rgba(0,0,0,.35)]"><RobotMark size={38} /></div>
        {!collapsed && <div className="min-w-0 flex-1"><div className="text-[15px] font-extrabold leading-tight">BI Advisor</div><div className="truncate text-[10.5px] text-white/50">Conseiller Business Intelligence</div></div>}
        {onToggle && <button onClick={onToggle} aria-label={collapsed ? 'Déployer le panneau' : 'Réduire le panneau'} title={collapsed ? 'Déployer' : 'Réduire'} className="rounded-xl p-2 text-white/60 transition hover:bg-white/10 hover:text-white">{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>}
      </div>

      <div className={collapsed ? 'px-2' : 'px-4'}>
        <button onClick={() => { st().newSession(); onNavigate?.(); }} title="Nouvelle analyse" aria-label="Nouvelle analyse" className={cn('btn-grad flex w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold', collapsed ? 'h-11' : 'py-2.5')}><Plus size={16} />{!collapsed && 'Nouvelle analyse'}</button>
      </div>

      {collapsed ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-2">
          <button onClick={() => setUi({ connectors: true })} title="Connecter une source" aria-label="Connecter une source" className="flex h-10 w-10 items-center justify-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white"><Plug size={17} /></button>
          {sources.map((s) => { const I = icon(s.kind); return (
            <button key={s.id} onClick={() => setUi({ connectors: true })} title={`${s.name} — ${s.status === 'active' ? 'active' : s.status}`} className={cn('relative flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/10', !s.enabled && 'opacity-40')}><I size={17} className="text-brand-aqua" /><span className="absolute right-1.5 top-1.5"><Dot status={s.status} /></span></button>
          ); })}
          <div className="my-1 h-px w-6 bg-white/10" />
          {sessions.slice(0, 8).map((s) => (
            <button key={s.id} onClick={() => { st().selectSession(s.id); onNavigate?.(); }} title={s.title} className={cn('flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/10', s.id === activeId && 'bg-white/10')}><MessageSquare size={16} className="text-white/60" /></button>
          ))}
        </div>
      ) : (
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3">
        <div className="mb-1.5 flex items-center justify-between px-2 text-[10.5px] font-bold uppercase tracking-wider text-white/40">
          <span>Sources de données</span>
          <button onClick={() => setUi({ connectors: true })} aria-label="Connecter une source" className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"><Plug size={13} /></button>
        </div>
        <ul className="space-y-1">
          {sources.length === 0 && <li className="px-2 py-2 text-xs text-white/40">Aucune source. Cliquez sur la prise pour en ajouter.</li>}
          {sources.map((s) => {
            const I = icon(s.kind);
            return (
              <li key={s.id} className={cn('group rounded-xl px-2 py-1.5 transition hover:bg-white/5', !s.enabled && 'opacity-50')}>
                <div className="flex items-center gap-2">
                  <I size={15} className="shrink-0 text-brand-aqua" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
                  <span title={s.status === 'active' ? 'Active' : s.status === 'syncing' ? 'Synchronisation…' : s.error || 'Erreur'}><Dot status={s.status} /></span>
                  <button onClick={() => st().patchSource(s.id, { enabled: !s.enabled })} aria-label="Activer / désactiver dans le contexte" className="rounded p-0.5 text-white/40 opacity-0 hover:text-white group-hover:opacity-100">{s.enabled ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                  <button onClick={() => disconnectSource(s.id)} aria-label="Déconnecter" className="rounded p-0.5 text-white/40 opacity-0 hover:text-red-300 group-hover:opacity-100"><Trash2 size={13} /></button>
                </div>
                {s.insights?.length ? (
                  <button onClick={() => { sendMessage(s.insights![0]); onNavigate?.(); }} className="ml-6 mt-0.5 flex items-center gap-1 text-[10.5px] text-brand-pink/90 hover:underline"><Sparkles size={10} />{s.insights.length} piste{s.insights.length > 1 ? 's' : ''} d’analyse</button>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="mb-1.5 mt-6 px-2 text-[10.5px] font-bold uppercase tracking-wider text-white/40">Historique</div>
        <ul className="space-y-0.5">
          {sessions.map((s) => (
            <li key={s.id} className={cn('group flex items-center gap-2 rounded-xl px-2 py-1.5 text-[13px] transition', s.id === activeId ? 'bg-white/10' : 'hover:bg-white/5')}>
              <button onClick={() => { st().selectSession(s.id); onNavigate?.(); }} className="flex min-w-0 flex-1 items-center gap-2 text-left"><MessageSquare size={13} className="shrink-0 text-white/40" /><span className="truncate">{s.title}</span></button>
              <button onClick={() => st().deleteSession(s.id)} aria-label="Supprimer la session" className="rounded p-0.5 text-white/40 opacity-0 hover:text-red-300 group-hover:opacity-100"><Trash2 size={12} /></button>
            </li>
          ))}
        </ul>
      </div>
      )}

      {collapsed ? (
        <div className="flex flex-col items-center gap-1 border-t border-white/10 p-2">
          <Link href="/admin" title="Administration" className="flex h-10 w-10 items-center justify-center rounded-xl text-brand-aqua hover:bg-white/10"><ShieldCheck size={17} /></Link>
          <button onClick={() => setUi({ settings: true })} title={`Paramètres LLM — ${provider(llm.provider).label}`} className="relative flex h-10 w-10 items-center justify-center rounded-xl text-white/70 hover:bg-white/10"><Settings2 size={17} /><span className="absolute right-1.5 top-1.5"><Dot status={ks} /></span></button>
          <button onClick={() => st().set({ onboarded: false })} title="Revoir l'introduction" className="flex h-10 w-10 items-center justify-center rounded-xl text-white/70 hover:bg-white/10"><PlayCircle size={17} /></button>
          <ThemePicker collapsed />
          {me && !authOff && <button onClick={logout} title={`Se déconnecter (${me.name})`} className="flex h-10 w-10 items-center justify-center rounded-xl text-white/60 hover:bg-white/10"><LogOut size={16} /></button>}
        </div>
      ) : (
      <div className="space-y-1 border-t border-white/10 p-3">
        <Link href="/admin" className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] text-white/80 hover:bg-white/10"><ShieldCheck size={16} className="text-brand-aqua" />Administration</Link>
        <button onClick={() => setUi({ settings: true })} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] hover:bg-white/10">
          <Settings2 size={16} className="text-white/70" />
          <div className="min-w-0 flex-1"><div className="font-semibold">Paramètres LLM</div><div className="truncate text-[11px] text-white/50">{provider(llm.provider).label}</div></div>
          <Dot status={ks} />
        </button>
        <button onClick={() => st().set({ onboarded: false })} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] text-white/70 hover:bg-white/10"><PlayCircle size={16} />Revoir l’introduction</button>
        <ThemePicker />
        {me && !authOff && (
          <div className="mt-1 flex items-center gap-2.5 rounded-xl bg-white/5 px-2.5 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-aqua to-brand-pink text-xs font-bold text-brand-navy">{me.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold">{me.name}</div><div className="truncate text-[10.5px] text-white/50">{me.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</div></div>
            <button onClick={logout} aria-label="Se déconnecter" title="Se déconnecter" className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"><LogOut size={15} /></button>
          </div>
        )}
      </div>
      )}
    </aside>
  );
}
