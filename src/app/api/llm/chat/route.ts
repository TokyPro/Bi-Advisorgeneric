import { NextRequest } from 'next/server';
import { streamChat, ProviderError, type Provider } from '@/server/llm';

import { requireAuth } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = requireAuth(req); if (auth instanceof Response) return auth;
  try {
    const { provider, model, apiKey, system, messages, maxTokens, temperature, baseUrl } = await req.json();
    if (!apiKey && !(provider === 'nvidia' && baseUrl)) return Response.json({ error: 'Clé API manquante. Configurez votre LLM.' }, { status: 400 });
    if (!['anthropic', 'openai', 'google', 'deepseek', 'nvidia'].includes(provider)) return Response.json({ error: 'Fournisseur inconnu.' }, { status: 400 });
    const stream = await streamChat({ provider: provider as Provider, model, apiKey: apiKey || '', system, messages, maxTokens, temperature, baseUrl });
    return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (e) {
    const status = e instanceof ProviderError ? e.status : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
