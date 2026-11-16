'use client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Eye, EyeOff, Info, LogIn, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth, refreshAuth, login, setupAdmin, AuthError, AUTH_TEXT, type SetupMode } from '@/lib/auth-client';
import { Robot } from '../onboarding/illustrations';
import { Field, inputCls, Spinner } from '../ui/primitives';
import { cn } from '@/lib/utils';

export default function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const setupMode = useAuth((s) => s.setupMode);
  const configError = useAuth((s) => s.configError);
  useEffect(() => { refreshAuth(); }, []);
  if (status === 'loading') return <div role="status" aria-label="Chargement" className="flex h-screen items-center justify-center"><div className="skeleton h-12 w-12 !rounded-2xl" /></div>;
  if (status === 'error') return <ErrorCard kind={configError ?? 'storage'} />;
  if (status === 'anon') return <AuthCard key="login" mode="login" />;
  if (status === 'setup') return setupMode === 'disabled' ? <SetupDisabledCard /> : <AuthCard key="setup" mode="setup" setupMode={setupMode ?? 'open'} />;
  return <>{children}</>;
}

const BG = { background: 'radial-gradient(900px 600px at 15% 0%, rgb(var(--glow1) / .45), transparent 60%), radial-gradient(900px 600px at 90% 100%, rgb(var(--glow2) / .5), transparent 60%), rgb(var(--bg))' };
// Carte forcée en clair : les jetons dépendant du thème (`text-muted`, et `bg-surface2` / `border-line` d'`inputCls`)
// sont ramenés à des valeurs lisibles sur blanc, sinon le thème sombre rend les champs illisibles (A-4, UX-1).
const CARD = 'w-full max-w-[400px] overflow-hidden break-words rounded-[2rem] bg-white/90 p-8 text-[#14142b] shadow-soft backdrop-blur [&_.text-muted]:text-slate-600 [&_input]:border-slate-500 [&_input]:bg-slate-50 [&_input]:text-[#14142b] [&_input]:caret-[#14142b]';

function Shell({ children, as = 'div', onSubmit }: { children: ReactNode; as?: 'div' | 'form'; onSubmit?: (e: FormEvent) => void }) {
  const Tag = as;
  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={BG}>
      <Tag onSubmit={onSubmit} className={CARD} style={{ colorScheme: 'light' }}>
        <div className="flex justify-center" aria-hidden="true"><Robot size={110} waving={false} /></div>
        {children}
      </Tag>
    </div>
  );
}

/** Bouton secondaire « Réessayer » / « Vérifier à nouveau » : relance la lecture de l'état d'authentification. */
function RetryButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [still, setStill] = useState(false);
  // Si l'état n'a pas changé, ce composant reste monté : on l'annonce, sinon la vérification passe inaperçue au lecteur d'écran (UX-5).
  const retry = async () => { setStill(false); setBusy(true); await refreshAuth(); setBusy(false); setStill(true); };
  return (
    <>
      <button type="button" onClick={retry} disabled={busy} aria-busy={busy} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-slate-500 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-violet disabled:opacity-60">
        {busy && <Spinner />}{busy ? 'Vérification…' : label}
      </button>
      <p aria-live="polite" className="mt-2 min-h-[1.25rem] text-center text-sm text-slate-600">{still ? 'Toujours indisponible. Réessayez dans un instant.' : ''}</p>
    </>
  );
}

/** É5 : configuration incomplète (5a) ou stockage injoignable (5b). Aucun formulaire. */
function ErrorCard({ kind }: { kind: 'config' | 'storage' }) {
  return (
    <Shell>
      <h1 className="mt-1 text-center text-2xl font-extrabold">Connexion impossible</h1>
      <div role="alert" className="mt-4 flex gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{AUTH_TEXT[kind]}</span></div>
      <RetryButton label="Réessayer" />
    </Shell>
  );
}

/** É4 : déploiement public sans SETUP_TOKEN ni ADMIN_*. Aucun formulaire. */
function SetupDisabledCard() {
  return (
    <Shell>
      <h1 className="mt-1 text-center text-2xl font-extrabold">Initialisation non configurée</h1>
      <div role="status" className="mt-4 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"><Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>L&apos;administrateur doit définir SETUP_TOKEN ou ADMIN_EMAIL / ADMIN_PASSWORD pour ce déploiement.</span></div>
      <p className="mt-3 text-sm text-slate-600">Si vous n&apos;êtes pas l&apos;administrateur, contactez-le : l&apos;application ne peut pas être utilisée tant que ce réglage n&apos;est pas fait.</p>
      <RetryButton label="Vérifier à nouveau" />
    </Shell>
  );
}

function EyeButton({ shown, onToggle, what }: { shown: boolean; onToggle: () => void; what: 'le mot de passe' | 'le jeton' }) {
  return (
    <button type="button" onClick={onToggle} aria-label={`${shown ? 'Masquer' : 'Afficher'} ${what}`} aria-pressed={shown} className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-violet">
      {shown ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  );
}

type ErrField = 'token' | 'confirm' | null;
const ERR_ID = 'auth-error';
const TOKEN_HINT_ID = 'auth-token-hint';
const PASSWORD_HINT_ID = 'auth-password-hint';
const HINT_CLS = 'mt-1 block text-[11px] text-muted'; // même rendu que l'aide de `Field`

function AuthCard({ mode, setupMode = 'open' }: { mode: 'login' | 'setup'; setupMode?: SetupMode }) {
  const withToken = mode === 'setup' && setupMode === 'token';
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  // Jeton : état local uniquement (jamais dans le store, le stockage du navigateur ni l'URL), vidé après un refus.
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [err, setErr] = useState('');
  const [errField, setErrField] = useState<ErrField>(null);
  const [busy, setBusy] = useState(false);
  const tokenRef = useRef<HTMLInputElement>(null);
  const clearErr = () => { setErr(''); setErrField(null); };
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); clearErr(); };
  const fieldErr = (k: ErrField, hintId?: string) => {
    const ids = [hintId, errField === k ? ERR_ID : undefined].filter(Boolean).join(' ');
    return { ...(errField === k ? { 'aria-invalid': true } : {}), ...(ids ? { 'aria-describedby': ids } : {}) };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'setup' && f.password !== f.confirm) { setErr('Les mots de passe ne correspondent pas.'); setErrField('confirm'); return; }
    setBusy(true);
    try { if (mode === 'login') await login(f.email, f.password); else await setupAdmin(f.name, f.email, f.password, withToken ? token : undefined); }
    catch (x) {
      setBusy(false);
      const code = x instanceof AuthError ? x.code : '';
      if (code === 'already_initialized') {
        toast.info("L'application est déjà initialisée. Connectez-vous avec votre compte.");
        await refreshAuth();
        if (useAuth.getState().status !== 'anon') setErr(AUTH_TEXT.already_initialized); // la bascule vers la connexion a échoué
        return;
      }
      if (code === 'setup_token_invalid') { setToken(''); setErrField('token'); setErr(x instanceof Error ? x.message : ''); tokenRef.current?.focus(); return; }
      setErrField(null);
      setErr(x instanceof Error ? x.message : AUTH_TEXT.storage);
    }
  };

  return (
    <Shell as="form" onSubmit={submit}>
      <h1 className="mt-1 text-center text-2xl font-extrabold">{mode === 'login' ? 'Connexion' : 'Bienvenue sur BI Advisor'}</h1>
      <p className="mb-5 mt-1 text-center text-sm text-slate-600">{mode === 'login' ? 'Connectez-vous pour accéder à vos analyses.' : 'Créez le compte administrateur pour initialiser l’application.'}</p>
      <div className="space-y-3">
        {withToken && (
          // `Field` englobe aussi le bouton œil et l'aide dans le <label> : nom accessible court + aide reliée par aria-describedby (UX-2).
          <Field label="Jeton d'initialisation">
            <div className="relative"><input ref={tokenRef} required name="setup-token" aria-label="Jeton d'initialisation" type={showToken ? 'text' : 'password'} value={token} onChange={(e) => { setToken(e.target.value); clearErr(); }} className={cn(inputCls, 'pr-10')} autoComplete="off" spellCheck={false} autoFocus {...fieldErr('token', TOKEN_HINT_ID)} />
              <EyeButton shown={showToken} onToggle={() => setShowToken(!showToken)} what="le jeton" /></div>
            <span id={TOKEN_HINT_ID} className={HINT_CLS}>Fourni par la personne qui a déployé l&apos;application (variable SETUP_TOKEN).</span>
          </Field>
        )}
        {mode === 'setup' && <Field label="Nom complet"><input required value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} autoComplete="name" /></Field>}
        <Field label="Adresse e-mail"><input required type="email" value={f.email} onChange={(e) => set('email', e.target.value)} className={inputCls} autoComplete="username" autoFocus={!withToken} /></Field>
        <Field label="Mot de passe">
          <div className="relative"><input required aria-label="Mot de passe" type={show ? 'text' : 'password'} value={f.password} onChange={(e) => set('password', e.target.value)} className={cn(inputCls, 'pr-10')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} {...(mode === 'setup' ? { 'aria-describedby': PASSWORD_HINT_ID } : {})} />
            <EyeButton shown={show} onToggle={() => setShow(!show)} what="le mot de passe" /></div>
          {mode === 'setup' && <span id={PASSWORD_HINT_ID} className={HINT_CLS}>10 caractères minimum, avec lettres et chiffres.</span>}
        </Field>
        {mode === 'setup' && <Field label="Confirmer le mot de passe"><input required type={show ? 'text' : 'password'} value={f.confirm} onChange={(e) => set('confirm', e.target.value)} className={inputCls} autoComplete="new-password" {...fieldErr('confirm')} /></Field>}
      </div>
      {err && <div id={ERR_ID} role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <button disabled={busy} aria-busy={busy} className="btn-grad mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-bold shadow-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-violet disabled:opacity-60">{busy ? <Spinner /> : mode === 'login' ? <LogIn size={16} /> : <ShieldCheck size={16} />}{mode === 'login' ? 'Se connecter' : 'Créer le compte administrateur'}</button>
    </Shell>
  );
}
