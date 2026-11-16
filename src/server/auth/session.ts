import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getBackend } from './backends';
import { authSecret } from './config';
import { authErrorResponse } from './errors';
import { findById, seedFromEnv, pub, type PublicUser, type Role } from './store';

export const COOKIE = 'bia_session';
export const MAX_AGE = 60 * 60 * 24 * 7;
export const authDisabled = () => process.env.AUTH_DISABLED === 'true';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
// authSecret() peut lever AuthConfigError (secret absent en hébergé ou trop court) : propagée jusqu'à authorize / la route.
const mac = (s: string) => crypto.createHmac('sha256', authSecret()).update(s).digest('base64url');

export function signSession(uid: string, tokenVersion: number) {
  const body = b64u(JSON.stringify({ uid, v: tokenVersion, exp: Math.floor(Date.now() / 1000) + MAX_AGE }));
  return `${body}.${mac(body)}`;
}

/** Utilisateur de la session. Relu à chaque requête, sans cache : révocation immédiate sur toutes les instances. */
export async function getUser(req: NextRequest): Promise<PublicUser | null> {
  if (authDisabled()) return { id: 'local', email: 'local@localhost', name: 'Utilisateur local', role: 'admin', createdAt: 0 };
  await seedFromEnv();
  const tok = req.cookies.get(COOKIE)?.value;
  if (!tok) return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(mac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p: { uid?: unknown; v?: unknown; exp?: unknown };
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (typeof p.exp !== 'number' || p.exp < Date.now() / 1000 || typeof p.uid !== 'string') return null;
  const u = await findById(p.uid); // erreur de stockage propagée (503), jamais confondue avec « non authentifié »
  if (!u || u.disabled || u.tokenVersion !== p.v) return null;
  return pub(u);
}

/** Protection CSRF : pour les requêtes modifiantes, l'Origin doit correspondre à l'hôte. */
function sameOrigin(req: NextRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.get('origin');
  if (!origin) return true; // clients non-navigateur : le cookie SameSite=Lax suffit
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try { return new URL(origin).host === host; } catch { return false; }
}

/**
 * Garde des routes protégées : contrôle d'origine, puis session, puis rôle.
 * Toujours `const a = await authorize(req); if (a instanceof Response) return a;` — l'oubli du `await` est détecté
 * par tests/unit/route-guard.test.ts (sans lui, `instanceof Response` serait toujours faux : contournement silencieux).
 */
export async function authorize(req: NextRequest, role?: Role): Promise<{ user: PublicUser } | Response> {
  if (!sameOrigin(req)) return Response.json({ ok: false, code: 'forbidden', error: 'Origine refusée.' }, { status: 403 });
  let user: PublicUser | null;
  try { user = await getUser(req); } catch (e) { return authErrorResponse(e); }
  if (!user) return Response.json({ ok: false, error: 'Non authentifié.', code: 'unauthenticated' }, { status: 401 });
  if (role && user.role !== role) return Response.json({ ok: false, code: 'forbidden', error: 'Droits insuffisants.' }, { status: 403 });
  return { user };
}

export const clientIp = (req: NextRequest) => (req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'local').trim();

/** Limiteur partagé via le backend (table Postgres en hébergé, mémoire en local). */
export const LOGIN_MAX = 5;
export const EMAIL_MAX = 10; // clé e-mail seule : limite le contournement par changement d'IP
export const SETUP_MAX = 5;
/** Compte la tentative avant tout calcul coûteux ; renvoie les minutes de blocage (0 : autorisée). */
export const hitLimit = async (key: string, max: number) => (await getBackend()).attempts.hit(key, max);
export const releaseLimit = async (key: string) => (await getBackend()).attempts.release(key);
export const clearLimit = async (key: string) => (await getBackend()).attempts.clear(key);

export function sessionCookie(req: NextRequest, value: string, maxAge = MAX_AGE) {
  const secure = (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')) === 'https';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
