import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { authSecret, findById, seedFromEnv, pub, type PublicUser, type Role } from './store';

export const COOKIE = 'bia_session';
export const MAX_AGE = 60 * 60 * 24 * 7;
export const authDisabled = () => process.env.AUTH_DISABLED === 'true';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (s: string) => crypto.createHmac('sha256', authSecret()).update(s).digest('base64url');

export function signSession(uid: string, tokenVersion: number) {
  const body = b64u(JSON.stringify({ uid, v: tokenVersion, exp: Math.floor(Date.now() / 1000) + MAX_AGE }));
  return `${body}.${mac(body)}`;
}

export function getUser(req: NextRequest): PublicUser | null {
  if (authDisabled()) return { id: 'local', email: 'local@localhost', name: 'Utilisateur local', role: 'admin', createdAt: 0 };
  seedFromEnv();
  const tok = req.cookies.get(COOKIE)?.value;
  if (!tok) return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(mac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now() / 1000) return null;
    const u = findById(p.uid);
    if (!u || u.disabled || u.tokenVersion !== p.v) return null;
    return pub(u);
  } catch { return null; }
}

/** Protection CSRF : pour les requêtes modifiantes, l'Origin doit correspondre à l'hôte. */
function sameOrigin(req: NextRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.get('origin');
  if (!origin) return true; // clients non-navigateur : le cookie SameSite=Lax suffit
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try { return new URL(origin).host === host; } catch { return false; }
}

export function requireAuth(req: NextRequest, role?: Role): { user: PublicUser } | Response {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: 'Origine refusée.' }, { status: 403 });
  const user = getUser(req);
  if (!user) return Response.json({ ok: false, error: 'Non authentifié.', code: 'unauthenticated' }, { status: 401 });
  if (role && user.role !== role) return Response.json({ ok: false, error: 'Droits insuffisants.' }, { status: 403 });
  return { user };
}

export const clientIp = (req: NextRequest) => (req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'local').trim();

/** Limiteur de tentatives de connexion (mémoire) : 5 échecs -> blocage 10 min. */
const fails = new Map<string, { n: number; until: number }>();
export const lockedFor = (key: string) => { const f = fails.get(key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0; };
export function recordFail(key: string) { const f = fails.get(key) ?? { n: 0, until: 0 }; f.n++; if (f.n >= 5) { f.until = Date.now() + 10 * 60000; f.n = 0; } fails.set(key, f); }
export const clearFails = (key: string) => fails.delete(key);

export function sessionCookie(req: NextRequest, value: string, maxAge = MAX_AGE) {
  const secure = (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')) === 'https';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
