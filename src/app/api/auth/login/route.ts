import { NextRequest } from 'next/server';
import { checkPassword, findByEmail, updateUser, pub } from '@/server/auth/store';
import { signSession, sessionCookie, clientIp, lockedFor, recordFail, clearFails, authDisabled } from '@/server/auth/session';
import { audit } from '@/server/auth/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (authDisabled()) return Response.json({ ok: true });
  const { email = '', password = '' } = await req.json().catch(() => ({}));
  const ip = clientIp(req), key = `${ip}|${String(email).toLowerCase()}`;
  const wait = lockedFor(key);
  if (wait) return Response.json({ ok: false, error: `Trop de tentatives. Réessayez dans ${wait} min.` }, { status: 429 });
  const u = findByEmail(String(email));
  const ok = checkPassword(u, String(password));
  if (!ok || !u || u.disabled) {
    recordFail(key); audit('login_failed', String(email).slice(0, 80), '', ip);
    return Response.json({ ok: false, error: 'Identifiants incorrects.' }, { status: 401 });
  }
  clearFails(key);
  const fresh = updateUser(u.id, { lastLogin: Date.now() });
  audit('login', u.email, '', ip);
  return new Response(JSON.stringify({ ok: true, user: pub(fresh) }), { headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(req, signSession(u.id, fresh.tokenVersion)) } });
}
