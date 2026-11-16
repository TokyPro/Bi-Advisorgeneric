import { NextRequest } from 'next/server';
import { sessionCookie, getUser } from '@/server/auth/session';
import { audit } from '@/server/auth/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // La déconnexion efface toujours le cookie, même si la session ne peut pas être relue (stockage ou configuration en défaut).
  const u = await getUser(req).catch(() => null);
  if (u) await audit('logout', u.email);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(req, '', 0) } });
}
