'use client';
import { useState } from 'react';
import { LogOut, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth, changePassword, logout } from '@/lib/auth-client';
import { Field, inputCls, Spinner } from '../ui/primitives';

export default function AccountPanel() {
  const { user, authDisabled } = useAuth();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  return (
    <div className="max-w-xl space-y-5">
      <section className="card flex items-center gap-4 p-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-aqua to-brand-pink text-lg font-bold text-[#14142b]">{user.name.slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0 flex-1"><div className="font-bold">{user.name}</div><div className="truncate text-sm text-muted">{user.email} · {user.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</div></div>
        <button onClick={logout} className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-surface2"><LogOut size={15} />Se déconnecter</button>
      </section>
      {authDisabled ? <p className="card p-5 text-sm text-muted">L’authentification est désactivée (<code>AUTH_DISABLED=true</code>) : mode local mono-utilisateur.</p> : (
        <section className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><KeyRound size={18} />Changer le mot de passe</h2>
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            if (f.next !== f.confirm) { toast.error('Les mots de passe ne correspondent pas'); return; }
            setBusy(true);
            try { await changePassword(f.current, f.next); toast.success('Mot de passe modifié', { description: 'Vos autres sessions ont été déconnectées.' }); setF({ current: '', next: '', confirm: '' }); }
            catch (x) { toast.error('Changement refusé', { description: (x as Error).message }); }
            setBusy(false);
          }}>
            <Field label="Mot de passe actuel"><input required type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} className={inputCls} autoComplete="current-password" /></Field>
            <Field label="Nouveau mot de passe" hint="10 caractères min., lettres et chiffres"><input required type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} className={inputCls} autoComplete="new-password" /></Field>
            <Field label="Confirmer"><input required type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} className={inputCls} autoComplete="new-password" /></Field>
            <button disabled={busy} className="btn-grad flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60">{busy && <Spinner />}Mettre à jour</button>
          </form>
        </section>
      )}
    </div>
  );
}
