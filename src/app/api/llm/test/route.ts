import { NextRequest } from 'next/server';
import { testKey, type Provider } from '@/server/llm';

import { requireAuth } from '@/server/auth/session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = requireAuth(req); if (auth instanceof Response) return auth;
  const { provider, apiKey, baseUrl } = await req.json();
  if (!apiKey && !(provider === 'nvidia' && baseUrl)) return Response.json({ ok: false, message: 'Clé vide.' });
  return Response.json(await testKey(provider as Provider, apiKey || '', baseUrl));
}
