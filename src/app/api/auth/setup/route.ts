import { NextRequest } from 'next/server';
import { countUsers, createUser, updateUser } from '@/server/auth/store';
import { signSession, sessionCookie, clientIp } from '@/server/auth/session';
import { audit } from '@/server/auth/audit';

export const runtime = 'nodejs';

/** Création du premier compte administrateur (possible uniquement tant qu'aucun utilisateur n'existe). */
export async function POST(req: NextRequest) {
  if (countUsers() > 0) return Response.json({ ok: false, error: 'L’application est déjà initialisée.' }, { status: 409 });
  const { email, name, password } = await req.json().catch(() => ({}));
  try {
    const created = createUser({ email, name, password, role: 'admin' });
    const u = updateUser(created.id, { lastLogin: Date.now() });
    audit('setup_admin', u.email, '', clientIp(req));
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(req, signSession(u.id, u.tokenVersion)) } });
  } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 400 }); }
}
