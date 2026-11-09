import { NextRequest } from 'next/server';
import { query, friendly } from '@/server/connectors';

import { requireAuth } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = requireAuth(req); if (auth instanceof Response) return auth;
  try {
    const { kind, config, query: q } = await req.json();
    const rows = await query(kind, config || {}, q || {});
    return Response.json({ ok: true, rows });
  } catch (e) {
    return Response.json({ ok: false, error: friendly(e) }, { status: 200 });
  }
}
