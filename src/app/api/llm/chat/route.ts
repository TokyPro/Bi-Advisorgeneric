import { NextRequest } from 'next/server';
import { streamChat, ProviderError, BASEURL_PROVIDERS, BASEURL_UNSUPPORTED, type Provider } from '@/server/llm';
import { NetworkPolicyError } from '@/server/net/policy';

import { requireAuth } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = requireAuth(req); if (auth instanceof Response) return auth;
  try {
    const { provider, model, apiKey, system, messages, maxTokens, temperature, baseUrl } = await req.json();
    if (!apiKey && !(provider === 'nvidia' && baseUrl)) return Response.json({ error: 'Clé API manquante. Configurez votre LLM.' }, { status: 400 });
    if (!['anthropic', 'openai', 'google', 'deepseek', 'nvidia'].includes(provider)) return Response.json({ error: 'Fournisseur inconnu.' }, { status: 400 });
    if (typeof baseUrl === 'string' && baseUrl.trim() && !BASEURL_PROVIDERS.includes(provider)) return Response.json({ error: BASEURL_UNSUPPORTED }, { status: 400 });
    const stream = await streamChat({ provider: provider as Provider, model, apiKey: apiKey || '', system, messages, maxTokens, temperature, baseUrl });
    return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof ProviderError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof NetworkPolicyError) return Response.json({ error: e.message }, { status: 400 });
    // Message brut jamais renvoyé : avec une URL de base personnalisée, il exposerait IP résolue, port ou détail TLS (E-LLM-3).
    return Response.json({ error: 'Réseau indisponible : fournisseur injoignable.' }, { status: 502 });
  }
}
