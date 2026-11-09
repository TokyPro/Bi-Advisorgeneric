'use client';
import { useEffect, useState } from 'react';
import { UserPlus, ShieldCheck, Ban, KeyRound, Trash2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch, useAuth, type AuthUser } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { Field, inputCls, Spinner } from '../ui/primitives';

interface AuditRow { at: string; event: string; actor: string; detail: string; ip: string }

export default function UsersAdmin() {
  const me = useAuth((s) => s.user)!;
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'user' });
  const [busy, setBusy] = useState(false);

  const apply = (j: { users: AuthUser[]; audit: AuditRow[] }) => { setUsers(j.users); setAudit(j.audit); };
  useEffect(() => { authFetch('/api/admin/users').then((r) => r.json()).then((j) => { if (j.ok) apply(j); else toast.error(j.error); setLoading(false); }); }, []);

  const act = async (body: object, ok?: string) => {
    setBusy(true);
    const j = await authFetch('/api/admin/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Serveur injoignable.' }));
    setBusy(false);
    if (!j.ok) { toast.error('Opération refusée', { description: j.error }); return false; }
    apply(j); if (ok) toast.success(ok); return true;
  };

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="text-lg font-bold">Utilisateurs</h2>
        <p className="mb-3 text-sm text-muted">Les administrateurs gèrent les comptes ; chaque utilisateur conserve ses propres clés, connexions et analyses (isolées par compte dans le navigateur).</p>
        {loading ? <div className="skeleton h-24" /> : (
          <ul className="space-y-2">
            {users.map((u) => (
              <li key={u.id} className={cn('flex flex-wrap items-center gap-3 rounded-2xl border border-line px-4 py-3', u.disabled && 'opacity-60')}>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-aqua to-brand-pink text-sm font-bold text-[#14142b]">{u.name.slice(0, 1).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-bold">{u.name}{u.id === me.id && <span className="rounded-full bg-surface2 px-2 py-0.5 text-[10px] font-semibold text-muted">vous</span>}{u.disabled && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">désactivé</span>}</div>
                  <div className="truncate text-[11.5px] text-muted">{u.email} · dernière connexion {u.lastLogin ? new Date(u.lastLogin).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais'}</div>
                </div>
                <select value={u.role} disabled={u.id === me.id || busy} onChange={(e) => act({ action: 'update', id: u.id, role: e.target.value }, 'Rôle mis à jour')} className="rounded-xl border border-line bg-surface2 px-2 py-1.5 text-xs font-semibold"><option value="user">Utilisateur</option><option value="admin">Administrateur</option></select>
                <button disabled={busy} onClick={() => { const pw = prompt(`Nouveau mot de passe pour ${u.email} (10 car. min., lettres + chiffres) :`); if (pw) act({ action: 'update', id: u.id, password: pw }, 'Mot de passe réinitialisé — sessions révoquées'); }} title="Réinitialiser le mot de passe" aria-label="Réinitialiser le mot de passe" className="rounded-full p-2 text-muted hover:bg-surface2"><KeyRound size={15} /></button>
                <button disabled={busy || u.id === me.id} onClick={() => act({ action: 'update', id: u.id, disabled: !u.disabled }, u.disabled ? 'Compte réactivé' : 'Compte désactivé')} title={u.disabled ? 'Réactiver' : 'Désactiver'} aria-label="Activer / désactiver" className="rounded-full p-2 text-muted hover:bg-surface2 disabled:opacity-30">{u.disabled ? <CheckCircle2 size={15} /> : <Ban size={15} />}</button>
                <button disabled={busy || u.id === me.id} onClick={() => { if (confirm(`Supprimer ${u.email} ?`)) act({ action: 'delete', id: u.id }, 'Utilisateur supprimé'); }} aria-label="Supprimer" className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-red-500 disabled:opacity-30"><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><UserPlus size={18} />Ajouter un utilisateur</h2>
        <form onSubmit={async (e) => { e.preventDefault(); if (await act({ action: 'create', ...f }, 'Utilisateur créé')) setF({ name: '', email: '', password: '', role: 'user' }); }} className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></Field>
          <Field label="E-mail"><input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={inputCls} autoComplete="off" /></Field>
          <Field label="Mot de passe provisoire" hint="10 caractères min., lettres et chiffres"><input required type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={inputCls} autoComplete="off" /></Field>
          <Field label="Rôle"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className={inputCls}><option value="user">Utilisateur</option><option value="admin">Administrateur</option></select></Field>
          <div className="sm:col-span-2"><button disabled={busy} className="btn-grad flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60">{busy && <Spinner />}Créer le compte</button></div>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><ShieldCheck size={18} />Journal d’audit</h2>
        <p className="mb-3 text-xs text-muted">Connexions, échecs, création et modification de comptes (60 derniers événements).</p>
        <div className="max-h-72 overflow-auto rounded-xl border border-line">
          <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-surface2"><tr>{['Date', 'Événement', 'Compte', 'Détail', 'IP'].map((h) => <th key={h} className="px-3 py-2 font-semibold text-muted">{h}</th>)}</tr></thead>
            <tbody>{audit.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted">Aucun événement.</td></tr>}{audit.map((a, i) => <tr key={i} className="border-t border-line"><td className="whitespace-nowrap px-3 py-1.5">{new Date(a.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}</td><td className={cn('px-3 py-1.5 font-mono', a.event === 'login_failed' && 'text-red-500')}>{a.event}</td><td className="px-3 py-1.5">{a.actor}</td><td className="max-w-[220px] truncate px-3 py-1.5 text-muted" title={a.detail}>{a.detail}</td><td className="px-3 py-1.5 text-muted">{a.ip}</td></tr>)}</tbody></table>
        </div>
      </section>
    </div>
  );
}
