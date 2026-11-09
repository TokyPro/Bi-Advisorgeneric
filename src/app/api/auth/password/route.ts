import { NextRequest } from 'next/server';
import { requireAuth, signSession, sessionCookie, authDisabled } from '@/server/auth/session';
import { checkPassword, findById, updateUser } from '@/server/auth/store';
import { audit } from '@/server/auth/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const a = requireAuth(req); if (a instanceof Response) return a;
  if (authDisabled()) return Response.json({ ok: false, error: 'Authentification désactivée.' }, { status: 400 });
  const { current = '', next = '' } = await req.json().catch(() => ({}));
  const u = findById(a.user.id);
  if (!checkPassword(u, String(current))) return Response.json({ ok: false, error: 'Mot de passe actuel incorrect.' }, { status: 400 });
  try {
    const fresh = updateUser(a.user.id, { password: String(next) });
    audit('password_changed', fresh.email);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(req, signSession(fresh.id, fresh.tokenVersion)) } });
  } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 400 }); }
}
