'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth, refreshAuth, login, setupAdmin } from '@/lib/auth-client';
import { Robot } from '../onboarding/illustrations';
import { Field, inputCls, Spinner } from '../ui/primitives';
import { cn } from '@/lib/utils';

export default function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  useEffect(() => { refreshAuth(); }, []);
  // rafraîchit l'état lorsque la session expire en cours d'utilisation
  if (status === 'loading') return <div className="flex h-screen items-center justify-center"><div className="skeleton h-12 w-12 !rounded-2xl" /></div>;
  if (status === 'anon') return <AuthCard mode="login" />;
  if (status === 'setup') return <AuthCard mode="setup" />;
  return <>{children}</>;
}

function AuthCard({ mode }: { mode: 'login' | 'setup' }) {
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setErr(''); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'setup' && f.password !== f.confirm) { setErr('Les mots de passe ne correspondent pas.'); return; }
    setBusy(true);
    try { if (mode === 'login') await login(f.email, f.password); else await setupAdmin(f.name, f.email, f.password); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: 'radial-gradient(900px 600px at 15% 0%, rgb(var(--glow1) / .45), transparent 60%), radial-gradient(900px 600px at 90% 100%, rgb(var(--glow2) / .5), transparent 60%), rgb(var(--bg))' }}>
      <form onSubmit={submit} className="w-full max-w-[400px] overflow-hidden rounded-[2rem] bg-white/90 p-8 text-[#14142b] shadow-soft backdrop-blur" style={{ colorScheme: 'light' }}>
        <div className="flex justify-center"><Robot size={110} waving={false} /></div>
        <h1 className="mt-1 text-center text-2xl font-extrabold">{mode === 'login' ? 'Connexion' : 'Bienvenue sur BI Advisor'}</h1>
        <p className="mb-5 mt-1 text-center text-sm text-slate-500">{mode === 'login' ? 'Connectez-vous pour accéder à vos analyses.' : 'Créez le compte administrateur pour initialiser l’application.'}</p>
        <div className="space-y-3">
          {mode === 'setup' && <Field label="Nom complet"><input required value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} autoComplete="name" /></Field>}
          <Field label="Adresse e-mail"><input required type="email" value={f.email} onChange={(e) => set('email', e.target.value)} className={inputCls} autoComplete="username" autoFocus /></Field>
          <Field label="Mot de passe" hint={mode === 'setup' ? '10 caractères minimum, avec lettres et chiffres.' : undefined}>
            <div className="relative"><input required type={show ? 'text' : 'password'} value={f.password} onChange={(e) => set('password', e.target.value)} className={cn(inputCls, 'pr-9')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              <button type="button" onClick={() => setShow(!show)} aria-label="Afficher" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>
          </Field>
          {mode === 'setup' && <Field label="Confirmer le mot de passe"><input required type={show ? 'text' : 'password'} value={f.confirm} onChange={(e) => set('confirm', e.target.value)} className={inputCls} autoComplete="new-password" /></Field>}
        </div>
        {err && <div role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
        <button disabled={busy} className="btn-grad mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-bold shadow-soft disabled:opacity-60">{busy ? <Spinner /> : mode === 'login' ? <LogIn size={16} /> : <ShieldCheck size={16} />}{mode === 'login' ? 'Se connecter' : 'Créer le compte administrateur'}</button>
      </form>
    </div>
  );
}
