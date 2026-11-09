'use client';
import { useCallback, useState } from 'react';
import { Database, Boxes, Cloud, Plug, UploadCloud, Sparkles, CheckCircle2, XCircle, Search, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { SourceKind } from '@/lib/types';
import { loadDemo, connectLocal, connectRemote, connectSynced } from '@/lib/actions';
import { testRemote, schemaRemote, fetchTables } from '@/lib/connectors/remote';
import { parseFile, baseName } from '@/lib/connectors/files';
import { googleAuth, listSheets, loadSpreadsheet, sheetIdFromUrl, type DriveFile } from '@/lib/connectors/google';
import { buildExcelDemo } from '@/lib/connectors/demo-data';
import { Modal, Field, inputCls, Spinner } from '../ui/primitives';

type Tab = 'demo' | 'db' | 'odoo' | 'google' | 'api' | 'files';
const TABS: { id: Tab; label: string; icon: typeof Database }[] = [
  { id: 'demo', label: 'Démo', icon: Sparkles }, { id: 'db', label: 'Bases de données', icon: Database }, { id: 'odoo', label: 'Odoo', icon: Boxes },
  { id: 'google', label: 'Google', icon: Cloud }, { id: 'api', label: 'API & SaaS', icon: Plug }, { id: 'files', label: 'Fichiers', icon: UploadCloud },
];

export default function ConnectorsModal() {
  const open = useStore((s) => s.ui.connectors);
  const setUi = useStore((s) => s.setUi);
  const [tab, setTab] = useState<Tab>('demo');
  return (
    <Modal open={open} onClose={() => setUi({ connectors: false })} title="Connecter une source" subtitle="Bases SQL/NoSQL, Odoo, Google, fichiers locaux ou jeux de démonstration" wide>
      <div className="flex min-h-[420px] max-md:flex-col">
        <nav className="flex shrink-0 gap-1 border-r border-line p-3 max-md:flex-row max-md:overflow-x-auto max-md:border-b max-md:border-r-0 md:w-48 md:flex-col">
          {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition', tab === t.id ? 'bg-brand-violet/10 text-brand-violet' : 'text-muted hover:bg-surface2')}><t.icon size={16} />{t.label}</button>)}
        </nav>
        <div className="flex-1 p-6">
          {tab === 'demo' && <DemoTab />}{tab === 'db' && <DbTab done={() => setUi({ connectors: false })} />}
          {tab === 'odoo' && <OdooTab done={() => setUi({ connectors: false })} />}{tab === 'google' && <GoogleTab done={() => setUi({ connectors: false })} />}{tab === 'api' && <ApiTab done={() => setUi({ connectors: false })} />}
          {tab === 'files' && <FilesTab done={() => setUi({ connectors: false })} />}
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- démo */
export function DemoTab() {
  const sources = useStore((s) => s.sources);
  const items: { kind: SourceKind; id: string; title: string; desc: string }[] = [
    { kind: 'demo-sales', id: 'demo-sales', title: 'Sales DB', desc: 'Base relationnelle : clients, produits, commandes, lignes (≈ 1 800 commandes sur 22 mois, avec pics et creux).' },
    { kind: 'demo-odoo', id: 'demo-odoo', title: 'Odoo ERP (mock)', desc: 'Ventes, achats, comptabilité (avec erreurs injectées), CRM et stock au format Odoo.' },
    { kind: 'demo-excel', id: 'demo-excel', title: 'Budget.xlsx', desc: 'Classeur multi-onglets : budget vs réel par département et effectifs.' },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Données d’exemple prêtes à l’emploi, 100 % locales. Idéal avec le moteur « Démo » ou votre propre LLM.</p>
      {items.map((it) => {
        const on = sources.some((s) => s.id === it.id);
        return (
          <div key={it.id} className="card flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1"><div className="text-sm font-bold">{it.title}</div><div className="text-xs text-muted">{it.desc}</div></div>
            <button disabled={on} onClick={() => loadDemo(it.kind)} className={cn('rounded-full px-4 py-1.5 text-xs font-semibold', on ? 'bg-emerald-50 text-emerald-700' : 'btn-grad')}>{on ? 'Connectée' : 'Activer'}</button>
          </div>
        );
      })}
      <button onClick={async () => { const { tables } = buildExcelDemo(); const { exportXlsx } = await import('@/lib/bi/export'); await exportXlsx(Object.entries(tables).map(([name, rows]) => ({ name, rows })), 'exemple-budget'); }} className="flex items-center gap-2 text-xs font-semibold text-brand-blue hover:underline"><FileSpreadsheet size={14} />Télécharger le fichier Excel d’exemple (pour tester l’upload)</button>
    </div>
  );
}

/* ----------------------------------------------------- formulaire générique */
function useRemoteForm(kind: SourceKind, buildName: (c: Record<string, string>) => string, done: () => void) {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [state, setState] = useState<{ s: 'idle' | 'testing' | 'ok' | 'error' | 'connecting'; msg?: string }>({ s: 'idle' });
  const set = (k: string, v: string) => { setCfg((c) => ({ ...c, [k]: v })); setState({ s: 'idle' }); };
  const test = async () => {
    setState({ s: 'testing' });
    try { const r = await testRemote(kind, cfg); setState({ s: 'ok', msg: r.message }); return true; }
    catch (e) { setState({ s: 'error', msg: (e as Error).message }); toast.error('Connexion échouée', { description: (e as Error).message }); return false; }
  };
  const connect = async () => {
    if (!(await test())) return;
    setState({ s: 'connecting' });
    try {
      const schema = await schemaRemote(kind, cfg);
      await connectRemote(buildName(cfg), kind, cfg, schema);
      done();
    } catch (e) { setState({ s: 'error', msg: (e as Error).message }); toast.error('Inspection du schéma impossible', { description: (e as Error).message }); }
  };
  return { cfg, set, state, test, connect };
}

function Status({ state }: { state: { s: string; msg?: string } }) {
  if (state.s === 'ok') return <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700"><CheckCircle2 size={16} />{state.msg}</div>;
  if (state.s === 'error') return <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><XCircle size={16} className="mt-0.5 shrink-0" />{state.msg}</div>;
  return null;
}
function Actions({ f }: { f: ReturnType<typeof useRemoteForm> }) {
  const busy = f.state.s === 'testing' || f.state.s === 'connecting';
  return (
    <div className="flex items-center gap-2 pt-1">
      <button onClick={f.test} disabled={busy} className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-surface2 disabled:opacity-50">Tester</button>
      <button onClick={f.connect} disabled={busy} className="btn-grad flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60">{busy && <Spinner />}{f.state.s === 'connecting' ? 'Inspection du schéma…' : 'Connecter'}</button>
    </div>
  );
}

const DB_KINDS: { id: SourceKind; label: string; port?: string }[] = [
  { id: 'postgres', label: 'PostgreSQL', port: '5432' }, { id: 'mysql', label: 'MySQL', port: '3306' }, { id: 'mssql', label: 'SQL Server', port: '1433' },
  { id: 'sqlite', label: 'SQLite' }, { id: 'mongodb', label: 'MongoDB' },
];

export function DbTab({ done }: { done: () => void }) {
  const [kind, setKind] = useState<SourceKind>('postgres');
  return <DbForm key={kind} kind={kind} setKind={setKind} done={done} />;
}
function DbForm({ kind, setKind, done }: { kind: SourceKind; setKind: (k: SourceKind) => void; done: () => void }) {
  const f = useRemoteForm(kind, (c) => `${DB_KINDS.find((k) => k.id === kind)!.label} · ${c.database || c.path?.split('/').pop() || c.host || 'base'}`, done);
  const i = (k: string, label: string, ph = '', type = 'text') => <Field label={label}><input type={type} value={f.cfg[k] ?? ''} onChange={(e) => f.set(k, e.target.value)} placeholder={ph} className={inputCls} autoComplete="off" /></Field>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">{DB_KINDS.map((k) => <button key={k.id} onClick={() => setKind(k.id)} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', kind === k.id ? 'border-brand-violet bg-brand-violet/10 text-brand-violet' : 'border-line text-muted hover:bg-surface2')}>{k.label}</button>)}</div>
      {kind === 'sqlite' ? i('path', 'Chemin du fichier (sur le serveur)', '/data/ma_base.sqlite')
        : kind === 'mongodb' ? <>{i('url', 'URI de connexion', 'mongodb+srv://user:pass@cluster/…')}{i('database', 'Base (optionnel)', 'ma_base')}</>
          : <>
            <div className="grid grid-cols-3 gap-3"><div className="col-span-2">{i('host', 'Hôte', 'db.exemple.com')}</div>{i('port', 'Port', DB_KINDS.find((k) => k.id === kind)?.port)}</div>
            <div className="grid grid-cols-3 gap-3">{i('database', 'Base', 'ma_base')}{i('user', 'Utilisateur', 'lecteur_bi')}{i('password', 'Mot de passe', '••••••', 'password')}</div>
            <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={f.cfg.ssl === 'true'} onChange={(e) => f.set('ssl', String(e.target.checked))} />Connexion chiffrée (SSL/TLS)</label>
          </>}
      <p className="text-[11.5px] text-muted">🔒 Accès <b>lecture seule</b> forcé (SELECT uniquement). Utilisez de préférence un compte dédié en lecture. Seul le schéma (tables, colonnes, clés étrangères) est transmis au LLM, jamais l’intégralité des données.</p>
      <Status state={f.state} /><Actions f={f} />
    </div>
  );
}

export function OdooTab({ done }: { done: () => void }) {
  const f = useRemoteForm('odoo', (c) => `Odoo · ${c.database}`, done);
  const i = (k: string, label: string, ph = '', type = 'text') => <Field label={label}><input type={type} value={f.cfg[k] ?? ''} onChange={(e) => f.set(k, e.target.value)} placeholder={ph} className={inputCls} autoComplete="off" /></Field>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Connexion via l’API JSON-RPC d’Odoo (v10 → 19). Analyse automatique des modules Ventes, Achats, Comptabilité, CRM et Stock.</p>
      {i('url', 'URL Odoo', 'https://mon-entreprise.odoo.com')}
      <div className="grid grid-cols-2 gap-3">{i('database', 'Base de données', 'mon-entreprise')}{i('username', 'Utilisateur', 'admin@exemple.com')}</div>
      {i('password', 'Clé API / mot de passe', '••••••', 'password')}
      <Status state={f.state} /><Actions f={f} />
    </div>
  );
}

/* --------------------------------------------------------------- google */
export function GoogleTab({ done }: { done: () => void }) {
  const [clientId, setClientId] = useState(() => { try { return localStorage.getItem('bi-advisor:gclient') || ''; } catch { return ''; } });
  const [token, setToken] = useState('');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(''); const [apiKey, setApiKey] = useState('');

  const wrap = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.error('Google', { description: (e as Error).message }); } finally { setBusy(false); } };
  const login = () => wrap(async () => { try { localStorage.setItem('bi-advisor:gclient', clientId); } catch { /* */ } const t = await googleAuth(clientId.trim()); setToken(t); setFiles(await listSheets(t)); toast.success('Connecté à Google Drive'); });
  const search = () => wrap(async () => setFiles(await listSheets(token, q)));
  const importSheet = (id: string, opts: { token?: string; apiKey?: string }) => wrap(async () => {
    const { title, tables } = await loadSpreadsheet(id, opts);
    await connectLocal(`Sheets · ${title}`, 'gsheets', tables, { ephemeral: true });
    toast.success('Feuille importée', { description: `${Object.keys(tables).length} onglet(s)` }); done();
  });

  return (
    <div className="space-y-5">
      <div>
        <Field label="OAuth Client ID Google" hint="Console Google Cloud → Identifiants → ID client OAuth (Application Web). Activez les API Drive et Sheets, puis ajoutez l’URL de l’app dans « Origines JavaScript autorisées »."><input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" className={inputCls} /></Field>
        <button onClick={login} disabled={busy || !clientId.trim()} className="btn-grad mt-3 flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-50">{busy && <Spinner />}{token ? 'Reconnecter' : 'Se connecter à Google'}</button>
      </div>
      {token && (
        <div>
          <div className="mb-2 flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Rechercher une feuille…" className={inputCls} /><button onClick={search} aria-label="Rechercher" className="rounded-xl border border-line px-3"><Search size={15} /></button></div>
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {files.length === 0 && <p className="py-3 text-center text-xs text-muted">Aucune feuille trouvée.</p>}
            {files.map((f) => <button key={f.id} onClick={() => importSheet(f.id, { token })} className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2 text-left text-sm hover:bg-surface2"><FileSpreadsheet size={16} className="text-emerald-500" /><span className="flex-1 truncate font-medium">{f.name}</span><span className="text-[11px] text-muted">{f.modifiedTime?.slice(0, 10)}</span></button>)}
          </div>
        </div>
      )}
      <div className="border-t border-line pt-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Ou : feuille partagée publiquement + clé API</div>
        <div className="grid gap-3 sm:grid-cols-2"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL ou ID de la feuille" className={inputCls} /><input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Clé API Google" type="password" className={inputCls} /></div>
        <button onClick={() => importSheet(sheetIdFromUrl(url), { apiKey })} disabled={busy || !url || !apiKey} className="mt-3 rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-surface2 disabled:opacity-50">Importer</button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- fichiers */
export function FilesTab({ done }: { done: () => void }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const handle = useCallback(async (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      setBusy(file.name);
      try {
        const r = await parseFile(file);
        await connectLocal(file.name, r.kind, r.tables, { text: r.text });
        r.warnings.forEach((w) => toast.warning(w));
        toast.success(`${file.name} importé`, { description: Object.keys(r.tables).length ? `${Object.keys(r.tables).length} table(s) : ${Object.keys(r.tables).slice(0, 3).join(', ')}` : 'Texte indexé pour la recherche (RAG)' });
      } catch (e) { toast.error('Import impossible', { description: (e as Error).message }); }
    }
    setBusy(null); done();
  }, [done]);
  void baseName;
  return (
    <div>
      <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files); }}
        className={cn('flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition', drag ? 'border-brand-violet bg-brand-violet/10' : 'border-line hover:bg-surface2')}>
        <input type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.docx,.txt,.md" className="hidden" onChange={(e) => e.target.files && handle(e.target.files)} />
        {busy ? <><Spinner size={28} /><p className="mt-3 text-sm font-semibold">Analyse de {busy}…</p></> : <>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-aqua/50 to-brand-pink/50"><UploadCloud size={26} /></div>
          <p className="mt-3 text-sm font-bold">Glissez-déposez vos fichiers ici</p>
          <p className="mt-1 text-xs text-muted">Excel (.xlsx, .xls, .csv) · PDF · Word (.docx) · Texte (.txt)</p>
        </>}
      </label>
      <ul className="mt-4 space-y-1.5 text-xs text-muted">
        <li>• <b>Excel / CSV</b> : multi-onglets, types de colonnes détectés automatiquement, interrogeables en SQL.</li>
        <li>• <b>PDF / Word</b> : texte extrait, tableaux PDF détectés, recherche sémantique temporaire (RAG) — tout reste dans votre navigateur.</li>
      </ul>
    </div>
  );
}


/* --------------------------------------------------- API REST / Airtable / Notion */
const API_KINDS: { id: 'rest' | 'airtable' | 'notion'; label: string }[] = [{ id: 'rest', label: 'API REST / JSON' }, { id: 'airtable', label: 'Airtable' }, { id: 'notion', label: 'Notion' }];

export function ApiTab({ done, initial = 'rest' }: { done: () => void; initial?: 'rest' | 'airtable' | 'notion' }) {
  const [kind, setKind] = useState<'rest' | 'airtable' | 'notion'>(initial);
  return <ApiForm key={kind} kind={kind} setKind={setKind} done={done} />;
}

function ApiForm({ kind, setKind, done }: { kind: 'rest' | 'airtable' | 'notion'; setKind: (k: 'rest' | 'airtable' | 'notion') => void; done: () => void }) {
  const [cfg, setCfg] = useState<Record<string, string>>({ authType: 'none', method: 'GET', maxPages: '1' });
  const [state, setState] = useState<{ s: 'idle' | 'testing' | 'ok' | 'error' | 'connecting'; msg?: string }>({ s: 'idle' });
  const set = (k: string, v: string) => { setCfg((c) => ({ ...c, [k]: v })); setState({ s: 'idle' }); };
  const i = (k: string, label: string, ph = '', type = 'text', hint?: string) => <Field label={label} hint={hint}><input type={type} value={cfg[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder={ph} className={inputCls} autoComplete="off" /></Field>;
  const label = () => kind === 'rest' ? `API · ${cfg.table || (() => { try { return new URL(cfg.url).hostname; } catch { return 'REST'; } })()}` : kind === 'airtable' ? `Airtable · ${cfg.baseId}` : 'Notion';
  const run = async (connect: boolean) => {
    setState({ s: connect ? 'connecting' : 'testing' });
    try {
      const tables = await fetchTables(kind, cfg);
      const n = Object.values(tables).reduce((a, r) => a + r.length, 0);
      if (connect) { await connectSynced(label(), kind, cfg, tables); done(); }
      else setState({ s: 'ok', msg: `${Object.keys(tables).length} table(s) · ${n} lignes lues` });
    } catch (e) { setState({ s: 'error', msg: (e as Error).message }); toast.error('Connexion échouée', { description: (e as Error).message }); }
  };
  const busy = state.s === 'testing' || state.s === 'connecting';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">{API_KINDS.map((k) => <button key={k.id} onClick={() => setKind(k.id)} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', kind === k.id ? 'border-brand-violet bg-brand-violet/10 text-brand-violet' : 'border-line text-muted hover:bg-surface2')}>{k.label}</button>)}</div>
      {kind === 'rest' && <>
        <div className="grid grid-cols-4 gap-3"><div className="col-span-3">{i('url', 'URL de l’endpoint', 'https://api.exemple.com/v1/orders')}</div>
          <Field label="Méthode"><select value={cfg.method} onChange={(e) => set('method', e.target.value)} className={inputCls}><option>GET</option><option>POST</option></select></Field></div>
        <div className="grid grid-cols-2 gap-3">{i('table', 'Nom de la table SQL', 'commandes')}{i('dataPath', 'Chemin des données', 'data.items', 'text', 'Vide si la réponse est déjà un tableau')}</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Authentification"><select value={cfg.authType} onChange={(e) => set('authType', e.target.value)} className={inputCls}><option value="none">Aucune</option><option value="bearer">Bearer token</option><option value="basic">Basic</option><option value="header">En-tête perso</option><option value="query">Paramètre d’URL</option></select></Field>
          {cfg.authType === 'basic' && i('username', 'Utilisateur')}
          {(cfg.authType === 'header' || cfg.authType === 'query') && i('authHeader', 'Nom (X-Api-Key / api_key)')}
          {cfg.authType !== 'none' && i('token', cfg.authType === 'basic' ? 'Mot de passe' : 'Jeton / clé', '••••••', 'password')}
        </div>
        <div className="grid grid-cols-2 gap-3">{i('pageParam', 'Paramètre de pagination (optionnel)', 'page')}{i('maxPages', 'Pages max', '1', 'number')}</div>
        {i('headers', 'En-têtes JSON (optionnel)', '{"X-Version":"2"}')}
        {cfg.method === 'POST' && <Field label="Corps JSON"><textarea rows={3} value={cfg.body ?? ''} onChange={(e) => set('body', e.target.value)} className={cn(inputCls, 'font-mono')} /></Field>}
      </>}
      {kind === 'airtable' && <>{i('token', 'Jeton d’accès personnel', 'pat…', 'password', 'airtable.com/create/tokens — scopes : data.records:read, schema.bases:read')}{i('baseId', 'ID de base', 'appXXXXXXXXXXXXXX')}</>}
      {kind === 'notion' && <>{i('token', 'Jeton d’intégration interne', 'ntn_… / secret_…', 'password', 'notion.so/profile/integrations — puis partagez chaque base avec l’intégration')}{i('databaseIds', 'IDs de bases (optionnel)', 'vide = toutes les bases accessibles')}</>}
      <p className="text-[11.5px] text-muted">Les données sont lues côté serveur puis chargées dans le moteur SQL du navigateur (5 000 lignes max par table) et <b>resynchronisées à chaque démarrage</b>. Les identifiants sont chiffrés localement.</p>
      <Status state={state} />
      <div className="flex items-center gap-2 pt-1">
        <button onClick={() => run(false)} disabled={busy} className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-surface2 disabled:opacity-50">Tester</button>
        <button onClick={() => run(true)} disabled={busy} className="btn-grad flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60">{busy && <Spinner />}Connecter</button>
      </div>
    </div>
  );
}
