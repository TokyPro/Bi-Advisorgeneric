'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Cpu, Plug, Server } from 'lucide-react';
import { useStore } from '@/lib/store';
import { provider } from '@/lib/llm/models';
import { hasSecret } from '@/lib/vault';
import { Dot } from '../ui/primitives';
import { authFetch, useAuth } from '@/lib/auth-client';

interface Health { node: string; platform: string; uptime: number; drivers: { pkg: string; label: string; ok: boolean; error?: string }[] }

export default function Overview({ go }: { go: (t: 'llm' | 'connectors' | 'data') => void }) {
  const { llm, keyStatus, sources, sessions } = useStore();
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState(false);
  const isAdmin = useAuth((x) => x.user?.role === 'admin');
  useEffect(() => { if (isAdmin) authFetch('/api/admin/health').then((r) => r.json()).then(setHealth).catch(() => setErr(true)); }, [isAdmin]);
  const p = provider(llm.provider);
  const ks = llm.provider === 'demo' ? 'ok' : keyStatus[llm.provider] ?? (hasSecret('llm:' + llm.provider) ? 'unknown' : 'error');
  const errors = sources.filter((s) => s.status === 'error');

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <button onClick={() => go('llm')} className="card p-5 text-left transition hover:-translate-y-0.5 hover:shadow-soft">
          <Cpu size={20} className="text-brand-violet" /><div className="mt-3 text-xs font-semibold text-muted">LLM actif</div>
          <div className="text-lg font-extrabold">{p.label}</div>
          <div className="mt-1 flex items-center gap-2 truncate text-xs text-muted"><Dot status={ks} />{llm.customModel || llm.model}</div>
        </button>
        <button onClick={() => go('connectors')} className="card p-5 text-left transition hover:-translate-y-0.5 hover:shadow-soft">
          <Plug size={20} className="text-brand-blue" /><div className="mt-3 text-xs font-semibold text-muted">Sources connectées</div>
          <div className="text-lg font-extrabold">{sources.length}</div>
          <div className="mt-1 text-xs text-muted">{errors.length ? <span className="text-red-500">{errors.length} en erreur</span> : 'Toutes opérationnelles'}</div>
        </button>
        <button onClick={() => go('data')} className="card p-5 text-left transition hover:-translate-y-0.5 hover:shadow-soft">
          <Server size={20} className="text-brand-pink" /><div className="mt-3 text-xs font-semibold text-muted">Sessions d’analyse</div>
          <div className="text-lg font-extrabold">{sessions.length}</div>
          <div className="mt-1 text-xs text-muted">Sauvegarde & sécurité →</div>
        </button>
      </div>

      {isAdmin && <section className="card p-5">
        <h2 className="mb-1 text-base font-bold">Serveur & pilotes de bases de données</h2>
        <p className="mb-3 text-xs text-muted">Les connecteurs SQL / MongoDB nécessitent leur pilote Node côté serveur (installé par <code>npm install</code>).</p>
        {err && <p className="text-sm text-red-500">Serveur injoignable.</p>}
        {!health && !err && <div className="skeleton h-20" />}
        {health && (
          <>
            <div className="mb-3 text-xs text-muted">Node {health.node} · {health.platform} · actif depuis {Math.round(health.uptime / 60)} min</div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {health.drivers.map((d) => (
                <li key={d.pkg} className="flex items-start gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                  {d.ok ? <CheckCircle2 size={16} className="mt-0.5 text-emerald-500" /> : <XCircle size={16} className="mt-0.5 text-red-500" />}
                  <div className="min-w-0"><div className="font-semibold">{d.label} <span className="font-mono text-[11px] text-muted">{d.pkg}</span></div>{!d.ok && <div className="truncate text-[11px] text-red-500" title={d.error}>{d.error}</div>}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>}
      {errors.length > 0 && (
        <section className="card border-red-200 p-5">
          <h2 className="mb-2 text-base font-bold text-red-600">Sources à vérifier</h2>
          <ul className="space-y-1 text-sm">{errors.map((s) => <li key={s.id}><b>{s.name}</b> — <span className="text-muted">{s.error}</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}
