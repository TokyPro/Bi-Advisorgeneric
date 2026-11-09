import { NextRequest } from 'next/server';
import { sessionCookie, getUser } from '@/server/auth/session';
import { audit } from '@/server/auth/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const u = getUser(req); if (u) audit('logout', u.email);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(req, '', 0) } });
}
