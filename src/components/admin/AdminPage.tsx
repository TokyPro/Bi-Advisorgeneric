'use client';
import { useEffect, useState } from 'react';
import ThemePicker from '../layout/ThemePicker';
import { RobotMark } from '../onboarding/illustrations';
import Link from 'next/link';
import { ArrowLeft, LayoutGrid, Cpu, Plug, DatabaseBackup, Sun, Moon, Users, UserCircle } from 'lucide-react';
import { useStore } from '@/lib/store';
import { initApp } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { LLMPanel } from '../settings/LLMDrawer';
import Overview from './Overview';
import ConnectorsAdmin from './ConnectorsAdmin';
import DataSecurity from './DataSecurity';
import UsersAdmin from './UsersAdmin';
import AccountPanel from './AccountPanel';
import { useAuth } from '@/lib/auth-client';

const TABS = [
  { id: 'overview', label: 'Vue d’ensemble', icon: LayoutGrid },
  { id: 'llm', label: 'Modèles LLM', icon: Cpu },
  { id: 'connectors', label: 'Connecteurs', icon: Plug },
  { id: 'data', label: 'Données & sécurité', icon: DatabaseBackup },
  { id: 'users', label: 'Utilisateurs', icon: Users, admin: true },
  { id: 'account', label: 'Mon compte', icon: UserCircle },
] as { id: 'overview' | 'llm' | 'connectors' | 'data' | 'users' | 'account'; label: string; icon: typeof Cpu; admin?: boolean }[];
type Tab = (typeof TABS)[number]['id'];

export default function AdminPage() {
  const hydrated = useStore((s) => s.hydrated);
  const theme = useStore((s) => s.theme);
  const role = useAuth((x) => x.user?.role);
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    initApp();
    const h = window.location.hash.replace('#', '') as Tab;
    if (TABS.some((t) => t.id === h)) setTab(h);
  }, []);
  const go = (t: Tab) => { setTab(t); history.replaceState(null, '', `#${t}`); };

  if (!hydrated) return <div className="flex h-screen items-center justify-center"><div className="skeleton h-12 w-12 !rounded-2xl" /></div>;

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-30 flex items-center gap-3 border-b border-line px-5 py-3">
        <Link href="/" className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface2"><ArrowLeft size={14} />Retour à l’application</Link>
        <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-aqua to-brand-pink"><RobotMark size={32} /></div><h1 className="text-base font-extrabold">Administration</h1></div>
        <div className="ml-auto"><ThemePicker variant="icon" /></div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-6 p-5 max-md:flex-col">
        <nav className="flex shrink-0 gap-1 md:w-56 md:flex-col max-md:overflow-x-auto">
          {TABS.filter((t) => !t.admin || role === 'admin').map((t) => (
            <button key={t.id} onClick={() => go(t.id)} className={cn('flex items-center gap-2.5 whitespace-nowrap rounded-2xl px-4 py-2.5 text-left text-sm font-semibold transition', tab === t.id ? 'btn-grad shadow-soft' : 'text-muted hover:bg-surface2')}><t.icon size={17} />{t.label}</button>
          ))}
        </nav>
        <main className="min-w-0 flex-1">
          {tab === 'overview' && <Overview go={go} />}
          {tab === 'llm' && <section className="card max-w-2xl"><div className="border-b border-line px-6 py-4"><h2 className="text-lg font-bold">Modèles LLM</h2><p className="text-sm text-muted">Fournisseurs, clés (BYOK), NVIDIA NIM, modèle actif et réglages de génération.</p></div><LLMPanel /></section>}
          {tab === 'connectors' && <ConnectorsAdmin />}
          {tab === 'data' && <DataSecurity />}
          {tab === 'users' && role === 'admin' && <UsersAdmin />}
          {tab === 'account' && <AccountPanel />}
        </main>
      </div>
    </div>
  );
}
