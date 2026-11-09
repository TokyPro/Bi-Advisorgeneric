import { create } from 'zustand';
import { useStore } from './store';
import { setVaultUser } from './vault';

export interface AuthUser { id: string; email: string; name: string; role: 'admin' | 'user'; createdAt: number; disabled?: boolean; lastLogin?: number }
interface AuthState { status: 'loading' | 'anon' | 'setup' | 'authed'; user: AuthUser | null; authDisabled: boolean }
export const useAuth = create<AuthState>(() => ({ status: 'loading', user: null, authDisabled: false }));

/** fetch qui renvoie à l'écran de connexion si la session a expiré. */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const r = await fetch(input, init);
  if (r.status === 401 && useAuth.getState().status === 'authed') useAuth.setState({ status: 'anon', user: null });
  return r;
}

/** Isole les données locales (sessions, sources, secrets) par utilisateur et reprend les anciennes données (avant authentification) une seule fois. */
function bindUser(uid: string) {
  setVaultUser(uid);
  try {
    const key = `bi-advisor:state:${uid}`;
    if (localStorage.getItem('bi-advisor:state') && !localStorage.getItem(key) && !localStorage.getItem('bi-advisor:legacy-claimed')) {
      localStorage.setItem(key, localStorage.getItem('bi-advisor:state')!);
      const sec = localStorage.getItem('bi-advisor:secrets');
      if (sec) localStorage.setItem(`bi-advisor:secrets:${uid}`, sec);
      localStorage.setItem('bi-advisor:legacy-claimed', uid);
    }
    useStore.persist.setOptions({ name: key });
  } catch { /* stockage indisponible */ }
}

export async function refreshAuth() {
  try {
    const j = await fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json());
    if (j.user) { bindUser(j.user.id); useAuth.setState({ status: 'authed', user: j.user, authDisabled: !!j.authDisabled }); }
    else useAuth.setState({ status: j.needsSetup ? 'setup' : 'anon', user: null });
  } catch { useAuth.setState({ status: 'anon', user: null }); }
}

async function call(path: string, body: unknown) {
  const j = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Serveur injoignable.' }));
  if (!j.ok) throw new Error(j.error || 'Erreur');
  return j;
}
/** Après connexion : rechargement complet pour repartir d'un état propre lié au bon utilisateur. */
export async function login(email: string, password: string) { await call('/api/auth/login', { email, password }); location.href = '/'; }
export async function setupAdmin(name: string, email: string, password: string) { await call('/api/auth/setup', { name, email, password }); location.href = '/'; }
export async function logout() { await call('/api/auth/logout', {}).catch(() => {}); location.href = '/'; }
export const changePassword = (current: string, next: string) => call('/api/auth/password', { current, next });
