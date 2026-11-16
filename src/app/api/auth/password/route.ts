import { NextRequest } from 'next/server';
import { authorize, signSession, sessionCookie, authDisabled } from '@/server/auth/session';
import { checkPassword, findById, updateUser } from '@/server/auth/store';
import { audit } from '@/server/auth/audit';
import { DomainError, authErrorResponse } from '@/server/auth/errors';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const a = await authorize(req); if (a instanceof Response) return a;
  if (authDisabled()) return Response.json({ ok: false, code: 'invalid', error: 'Authentification désactivée.' }, { status: 400 });
  const { current = '', next = '' } = await req.json().catch(() => ({}));
  try {
    const u = await findById(a.user.id);
    if (!(await checkPassword(u, String(current)))) throw new DomainError('invalid', 'Mot de passe actuel incorrect.');
    const fresh = await updateUser(a.user.id, { password: String(next) });
    const cookie = sessionCookie(req, signSession(fresh.id, fresh.tokenVersion));
    await audit('password_changed', fresh.email);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': cookie } });
  } catch (e) { return authErrorResponse(e); }
}
