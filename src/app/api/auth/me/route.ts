import { NextRequest } from 'next/server';
import { getUser, authDisabled } from '@/server/auth/session';
import { countUsers, seedFromEnv } from '@/server/auth/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  seedFromEnv();
  const user = getUser(req);
  return Response.json({ ok: true, user, needsSetup: !authDisabled() && countUsers() === 0, authDisabled: authDisabled() }, { headers: { 'cache-control': 'no-store' } });
}
