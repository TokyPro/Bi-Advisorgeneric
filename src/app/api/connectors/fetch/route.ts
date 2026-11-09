import { NextRequest } from 'next/server';
import { fetchSaas, friendly } from '@/server/connectors';

import { requireAuth } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = requireAuth(req); if (auth instanceof Response) return auth;
  try {
    const { kind, config } = await req.json();
    return Response.json({ ok: true, tables: await fetchSaas(kind, config || {}) });
  } catch (e) {
    return Response.json({ ok: false, error: friendly(e) });
  }
}
