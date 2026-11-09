import { NextRequest } from 'next/server';
import { test, friendly } from '@/server/connectors';

import { requireAuth } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = requireAuth(req); if (auth instanceof Response) return auth;
  try {
    const { kind, config } = await req.json();
    const message = await test(kind, config || {});
    return Response.json({ ok: true, message });
  } catch (e) {
    return Response.json({ ok: false, error: friendly(e) }, { status: 200 });
  }
}
