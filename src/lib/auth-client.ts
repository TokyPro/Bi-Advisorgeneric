import { create } from 'zustand';
import { useStore } from './store';
import { setVaultUser } from './vault';

export interface AuthUser { id: string; email: string; name: string; role: 'admin' | 'user'; createdAt: number; disabled?: boolean; lastLogin?: number }
export type SetupMode = 'open' | 'token' | 'disabled';
export type ConfigError = 'config' | 'storage';
interface AuthState { status: 'loading' | 'anon' | 'setup' | 'authed' | 'error'; user: AuthUser | null; authDisabled: boolean; setupMode: SetupMode | null; configError: ConfigError | null }
export const useAuth = create<AuthState>(() => ({ status: 'loading', user: null, authDisabled: false, setupMode: null, configError: null }));

/** Textes affichés choisis par le client selon le code serveur : un texte serveur inattendu n'est jamais montré tel quel. */
export const AUTH_TEXT = {
  config: "Configuration incomplète : AUTH_SECRET est requis. Contactez l'administrateur.",
  storage: "Service d'authentification momentanément indisponible. Réessayez dans un instant.",
  setup_token_invalid: "Jeton d'initialisation invalide. Vérifiez-le auprès de la personne qui a déployé l'application.",
  setup_disabled: "Initialisation non configurée. L'administrateur doit définir SETUP_TOKEN ou ADMIN_EMAIL / ADMIN_PASSWORD.",
  already_initialized: "L'application est déjà initialisée.",
  rate_limited: 'Trop de tentatives. Réessayez dans quelques minutes.',
  network: 'Serveur injoignable.',
} as const;
// Codes dont le message serveur est un texte métier sans donnée technique (validation, identifiants) : affiché tel quel.
const SERVER_TEXT = new Set(['invalid', 'invalid_credentials', 'email_taken', 'last_admin', 'not_found', 'unauthenticated', 'forbidden']);

export class AuthError extends Error {
  constructor(readonly code: string, message: string, readonly retryAfterMin?: number) { super(message); this.name = 'AuthError'; }
}
function toAuthError(j: { code?: unknown; error?: unknown; retryAfterMin?: unknown }): AuthError {
  const code = typeof j.code === 'string' ? j.code : 'storage';
  const retry = typeof j.retryAfterMin === 'number' ? j.retryAfterMin : undefined;
  if (Object.hasOwn(AUTH_TEXT, code)) return new AuthError(code, AUTH_TEXT[code as keyof typeof AUTH_TEXT], retry);
  if (SERVER_TEXT.has(code) && typeof j.error === 'string') return new AuthError(code, j.error);
  return new AuthError('storage', AUTH_TEXT.storage); // repli 5b sur tout code inconnu
}

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
  const fail = (configError: ConfigError) => useAuth.setState({ status: 'error', user: null, setupMode: null, configError });
  try {
    const r = await fetch('/api/auth/me', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 503 || j.code === 'config' || j.code === 'storage') return fail(j.code === 'config' ? 'config' : 'storage');
    if (!r.ok) return fail('storage');
    if (j.user) { bindUser(j.user.id); useAuth.setState({ status: 'authed', user: j.user, authDisabled: !!j.authDisabled, setupMode: null, configError: null }); }
    else if (j.needsSetup) {
      const mode: SetupMode = j.setupMode === 'token' || j.setupMode === 'disabled' ? j.setupMode : 'open';
      useAuth.setState({ status: 'setup', user: null, setupMode: mode, configError: null });
    } else useAuth.setState({ status: 'anon', user: null, setupMode: null, configError: null });
  } catch { fail('storage'); }
}

async function call(path: string, body: unknown) {
  let j;
  try { j = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()); }
  catch { throw new AuthError('network', AUTH_TEXT.network); }
  if (!j.ok) throw toAuthError(j);
  return j;
}
/** Après connexion : rechargement complet pour repartir d'un état propre lié au bon utilisateur. */
export async function login(email: string, password: string) { await call('/api/auth/login', { email, password }); location.href = '/'; }
/** Le jeton n'est envoyé que dans le corps POST : jamais dans le store, le stockage du navigateur ni l'URL. */
export async function setupAdmin(name: string, email: string, password: string, token?: string) { await call('/api/auth/setup', token ? { name, email, password, token } : { name, email, password }); location.href = '/'; }
export async function logout() { await call('/api/auth/logout', {}).catch(() => {}); location.href = '/'; }
export const changePassword = (current: string, next: string) => call('/api/auth/password', { current, next });
