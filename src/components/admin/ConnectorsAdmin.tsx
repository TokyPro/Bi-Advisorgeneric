'use client';
import { useEffect, useState } from 'react';
import { Database, Boxes, Cloud, FileSpreadsheet, FileText, Globe, Table2, NotebookText, Sparkles, UploadCloud, RefreshCw, Trash2, FlaskConical, Eye, EyeOff, ChevronDown, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import type { DataSource, SourceKind } from '@/lib/types';
import { disconnectSource, refreshSource, testSource } from '@/lib/actions';
import { loadConfig } from '@/lib/connectors/remote';
import { cn } from '@/lib/utils';
import { Dot, Spinner } from '../ui/primitives';
import { DemoTab, DbTab, OdooTab, GoogleTab, ApiTab, FilesTab } from '../connectors/ConnectorsModal';

const KIND: Record<SourceKind, { label: string; icon: typeof Database }> = {
  postgres: { label: 'PostgreSQL', icon: Database }, mysql: { label: 'MySQL', icon: Database }, mssql: { label: 'SQL Server', icon: Database }, sqlite: { label: 'SQLite', icon: Database }, mongodb: { label: 'MongoDB', icon: Database },
  odoo: { label: 'Odoo', icon: Boxes }, gsheets: { label: 'Google Sheets', icon: Cloud }, rest: { label: 'API REST', icon: Globe }, airtable: { label: 'Airtable', icon: Table2 }, notion: { label: 'Notion', icon: NotebookText },
  file: { label: 'Fichier', icon: FileSpreadsheet }, document: { label: 'Document', icon: FileText }, 'demo-sales': { label: 'Démo', icon: Sparkles }, 'demo-odoo': { label: 'Démo', icon: Sparkles }, 'demo-excel': { label: 'Démo', icon: Sparkles },
};

type Add = 'db' | 'odoo' | 'google' | 'rest' | 'airtable' | 'notion' | 'files' | 'demo';
const CATALOG: { id: Add; label: string; desc: string; icon: typeof Database }[] = [
  { id: 'db', label: 'Base de données', desc: 'PostgreSQL, MySQL, SQL Server, SQLite, MongoDB', icon: Database },
  { id: 'odoo', label: 'Odoo ERP', desc: 'JSON-RPC : ventes, achats, compta, CRM, stock', icon: Boxes },
  { id: 'google', label: 'Google Drive / Sheets', desc: 'OAuth2 ou feuille publique + clé API', icon: Cloud },
  { id: 'rest', label: 'API REST / JSON', desc: 'Tout endpoint HTTP, auth Bearer/Basic/clé', icon: Globe },
  { id: 'airtable', label: 'Airtable', desc: 'Toutes les tables d’une base', icon: Table2 },
  { id: 'notion', label: 'Notion', desc: 'Bases de données partagées avec l’intégration', icon: NotebookText },
  { id: 'files', label: 'Fichiers', desc: 'Excel, CSV, PDF, Word, TXT', icon: UploadCloud },
  { id: 'demo', label: 'Données de démo', desc: 'Sales DB, Odoo mock, Budget.xlsx', icon: Sparkles },
];

const SECRET = /pass|token|key|secret|pwd|url$/i;
const mask = (k: string, v: string) => (/^url$/i.test(k) && /@/.test(v) ? v.replace(/\/\/[^@]+@/, '//••••@') : /pass|token|key|secret|pwd/i.test(k) ? '••••••••' : v);

function SourceRow({ s }: { s: DataSource }) {
  const patch = useStore((st) => st.patchSource);
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState<'' | 'test' | 'refresh'>('');
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  const K = KIND[s.kind];
  useEffect(() => { if (open && !cfg) loadConfig(s.id).then(setCfg); }, [open, cfg, s.id]);
  const canRefresh = s.engine === 'remote' || ['rest', 'airtable', 'notion'].includes(s.kind);
  void SECRET;

  return (
    <li className="rounded-2xl border border-line">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <K.icon size={18} className="shrink-0 text-brand-violet" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-bold"><span className="truncate">{s.name}</span><Dot status={s.status} /></div>
          <div className="text-[11.5px] text-muted">{K.label} · {s.schema.length} table(s){s.lastSync ? ` · synchro ${new Date(s.lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}{s.ephemeral ? ' · session uniquement' : ''}</div>
          {s.status === 'error' && s.error && <div className="mt-0.5 text-[11.5px] text-red-500">{s.error}</div>}
          {res && <div className={cn('mt-0.5 text-[11.5px]', res.ok ? 'text-emerald-600' : 'text-red-500')}>{res.ok ? '✓ ' : '✗ '}{res.message}</div>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={async () => { setBusy('test'); setRes(await testSource(s.id)); setBusy(''); }} disabled={!!busy} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface2">{busy === 'test' ? <Spinner size={12} /> : <FlaskConical size={12} />}Tester</button>
          {canRefresh && <button onClick={async () => { setBusy('refresh'); await refreshSource(s.id); setBusy(''); }} disabled={!!busy} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface2">{busy === 'refresh' ? <Spinner size={12} /> : <RefreshCw size={12} />}Actualiser</button>}
          <button onClick={() => patch(s.id, { enabled: !s.enabled })} title={s.enabled ? 'Exclure du contexte du LLM' : 'Inclure dans le contexte'} aria-label="Activer / désactiver" className="rounded-full p-2 text-muted hover:bg-surface2">{s.enabled ? <Eye size={15} /> : <EyeOff size={15} />}</button>
          <button onClick={() => setOpen(!open)} aria-label="Détails" className="rounded-full p-2 text-muted hover:bg-surface2"><ChevronDown size={15} className={cn('transition', open && 'rotate-180')} /></button>
          <button onClick={() => { if (confirm(`Supprimer « ${s.name} » et ses identifiants ?`)) disconnectSource(s.id); }} aria-label="Supprimer" className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t border-line bg-surface2/50 px-4 py-3 text-xs">
          {cfg ? <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">{Object.entries(cfg).filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex gap-2"><span className="w-28 shrink-0 font-semibold text-muted">{k}</span><span className="truncate font-mono">{mask(k, String(v))}</span></div>)}</div> : s.engine === 'remote' || ['rest', 'airtable', 'notion'].includes(s.kind) ? <span className="text-muted">Chargement…</span> : <span className="text-muted">Aucun identifiant (source locale).</span>}
          <div className="flex flex-wrap gap-1.5">{s.schema.slice(0, 30).map((t) => <span key={t.name} className="rounded-full bg-surface px-2.5 py-1 font-mono text-[11px]" title={t.columns.map((c) => c.name).join(', ')}>{t.name}{t.rowCount != null ? ` · ${t.rowCount}` : ''}</span>)}</div>
        </div>
      )}
    </li>
  );
}

export default function ConnectorsAdmin() {
  const sources = useStore((s) => s.sources);
  const [add, setAdd] = useState<Add | null>(null);
  const done = () => setAdd(null);

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="mb-3"><h2 className="text-lg font-bold">Connexions enregistrées</h2><p className="text-sm text-muted">Identifiants chiffrés (AES-GCM) dans ce navigateur. « Actualiser » relit le schéma ou resynchronise les données.</p></div>
        {sources.length === 0 ? <p className="rounded-2xl border border-dashed border-line py-8 text-center text-sm text-muted">Aucune connexion. Ajoutez-en une ci-dessous.</p> : <ul className="space-y-2">{sources.map((s) => <SourceRow key={s.id} s={s} />)}</ul>}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-lg font-bold">Ajouter une connexion</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {CATALOG.map((c) => (
            <button key={c.id} onClick={() => setAdd(add === c.id ? null : c.id)} className={cn('rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-card', add === c.id ? 'border-brand-violet bg-brand-violet/10' : 'border-line')}>
              <c.icon size={20} className="text-brand-violet" /><div className="mt-2 text-sm font-bold">{c.label}</div><div className="text-[11.5px] leading-snug text-muted">{c.desc}</div>
            </button>
          ))}
        </div>
        {add && (
          <div className="relative mt-4 rounded-2xl border border-line p-5">
            <button onClick={done} aria-label="Fermer" className="absolute right-3 top-3 rounded-full p-1.5 text-muted hover:bg-surface2"><X size={16} /></button>
            {add === 'db' && <DbTab done={done} />}{add === 'odoo' && <OdooTab done={done} />}{add === 'google' && <GoogleTab done={done} />}
            {add === 'rest' && <ApiTab done={done} initial="rest" />}{add === 'airtable' && <ApiTab done={done} initial="airtable" />}{add === 'notion' && <ApiTab done={done} initial="notion" />}
            {add === 'files' && <FilesTab done={done} />}{add === 'demo' && <DemoTab />}
          </div>
        )}
      </section>
    </div>
  );
}
