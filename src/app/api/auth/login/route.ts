import { NextRequest } from 'next/server';
import { checkPassword, findByEmail, normalizeEmail, seedFromEnv, touchLogin, pub } from '@/server/auth/store';
import { signSession, sessionCookie, clientIp, hitLimit, releaseLimit, clearLimit, authDisabled, LOGIN_MAX, EMAIL_MAX } from '@/server/auth/session';
import { audit } from '@/server/auth/audit';
import { DomainError, authErrorResponse } from '@/server/auth/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BAD = () => Response.json({ ok: false, code: 'invalid_credentials', error: 'Identifiants incorrects.' }, { status: 401 });

export async function POST(req: NextRequest) {
  if (authDisabled()) return Response.json({ ok: true });
  const { email = '', password = '' } = await req.json().catch(() => ({}));
  const ip = clientIp(req), em = normalizeEmail(email).slice(0, 200);
  const ipKey = `${ip}|${em}`, emailKey = `email|${em}`;
  try {
    // Le login peut être la première requête de l'instance : l'admin ADMIN_* doit exister avant la vérification (BUG-1).
    await seedFromEnv();
    // Tentative comptée AVANT le hachage (atomique) : une rafale concurrente ne peut pas dépasser le seuil.
    const wait = Math.max(await hitLimit(ipKey, LOGIN_MAX), await hitLimit(emailKey, EMAIL_MAX));
    if (wait) throw new DomainError('rate_limited', undefined, { retryAfterMin: wait });
    const u = await findByEmail(em);
    const ok = await checkPassword(u, String(password));
    if (!ok || !u || u.disabled) {
      await audit('login_failed', em.slice(0, 80), '', ip);
      return BAD();
    }
    // Succès : remise à zéro de la clé IP+e-mail ; la clé e-mail seule est seulement décrémentée (jamais remise à zéro).
    await clearLimit(ipKey); await releaseLimit(emailKey);
    const fresh = await touchLogin(u.id);
    if (fresh.disabled) return BAD(); // désactivé entre la vérification et la connexion (S7)
    const cookie = sessionCookie(req, signSession(u.id, fresh.tokenVersion));
    await audit('login', u.email, '', ip);
    return new Response(JSON.stringify({ ok: true, user: pub(fresh) }), { headers: { 'content-type': 'application/json', 'set-cookie': cookie } });
  } catch (e) { return authErrorResponse(e); }
}
