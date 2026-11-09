/**
 * Proxy LLM (serveur). La clé API arrive par requête (BYOK) et n'est JAMAIS stockée ni loggée.
 * Chaque fournisseur est normalisé en flux de texte brut.
 */
export type Provider = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'nvidia';

/** Fournisseurs compatibles API OpenAI (chat/completions). NVIDIA NIM : cloud (build.nvidia.com) ou NIM auto-hébergé via baseUrl. */
const OPENAI_BASES: Record<string, string> = { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com', nvidia: 'https://integrate.api.nvidia.com/v1' };
const LABEL: Record<string, string> = { openai: 'OpenAI', deepseek: 'DeepSeek', nvidia: 'NVIDIA NIM' };
export function resolveBase(provider: string, baseUrl?: string) {
  const b = (baseUrl?.trim() || OPENAI_BASES[provider] || '').replace(/\/+$/, '');
  if (b && !/^https?:\/\//i.test(b)) throw new ProviderError(400, 'URL de base invalide (http:// ou https:// attendu).');
  return b;
}
export interface Msg { role: 'user' | 'assistant'; content: string }

const enc = new TextEncoder();

async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

export class ProviderError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function ensureOk(res: Response, provider: string) {
  if (res.ok) return;
  let detail = '';
  try { const j = await res.json(); detail = j?.error?.message || j?.error || j?.message || JSON.stringify(j); } catch { detail = res.statusText; }
  const hint = res.status === 401 || res.status === 403 ? 'Clé API invalide ou non autorisée.' : res.status === 429 ? 'Quota / limite de débit atteint.' : res.status === 404 ? 'Modèle indisponible pour votre compte (listé par le fournisseur mais non activé / non déployé).' : '';
  throw new ProviderError(res.status, `${provider} (${res.status}) ${hint} ${typeof detail === 'string' ? detail : ''}`.trim());
}

export async function streamChat(p: { provider: Provider; model: string; apiKey: string; system: string; messages: Msg[]; maxTokens?: number; temperature?: number; baseUrl?: string }): Promise<ReadableStream<Uint8Array>> {
  const { provider, model, apiKey, system, messages } = p;
  const maxTokens = p.maxTokens ?? 4096;

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true, ...(p.temperature != null ? { temperature: p.temperature } : {}) }),
    });
    await ensureOk(res, 'Anthropic');
    return new ReadableStream({
      async start(ctrl) {
        try {
          for await (const d of sseLines(res)) {
            try { const j = JSON.parse(d); if (j.type === 'content_block_delta' && j.delta?.text) ctrl.enqueue(enc.encode(j.delta.text)); } catch { /* ignore */ }
          }
          ctrl.close();
        } catch (e) { ctrl.error(e); }
      },
    });
  }

  if (provider === 'openai' || provider === 'deepseek' || provider === 'nvidia') {
    const url = `${resolveBase(provider, p.baseUrl)}/chat/completions`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ model, stream: true, max_tokens: maxTokens, ...(p.temperature != null ? { temperature: p.temperature } : {}), messages: [{ role: 'system', content: system }, ...messages] }),
    });
    await ensureOk(res, LABEL[provider]);
    return new ReadableStream({
      async start(ctrl) {
        try {
          for await (const d of sseLines(res)) {
            if (d === '[DONE]') break;
            try { const j = JSON.parse(d); const t = j.choices?.[0]?.delta?.content; if (t) ctrl.enqueue(enc.encode(t)); } catch { /* ignore */ }
          }
          ctrl.close();
        } catch (e) { ctrl.error(e); }
      },
    });
  }

  // google gemini
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens, ...(p.temperature != null ? { temperature: p.temperature } : {}) },
    }),
  });
  await ensureOk(res, 'Google Gemini');
  return new ReadableStream({
    async start(ctrl) {
      try {
        for await (const d of sseLines(res)) {
          try { const j = JSON.parse(d); const t = j.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text || '').join(''); if (t) ctrl.enqueue(enc.encode(t)); } catch { /* ignore */ }
        }
        ctrl.close();
      } catch (e) { ctrl.error(e); }
    },
  });
}

export interface RemoteModel { id: string; label: string; context?: number; created?: number }

/** Modèles non conversationnels (embeddings, audio, image, modération…) exclus de la liste. */
const NOT_CHAT = /(embed|whisper|tts|dall-e|audio|realtime|transcri|moderation|image|imagen|veo|rerank|guard|safety|reward|clip|parse|aqa|speech|vision-preview|babbage|davinci|-instruct-\d{4}$)/i;

async function getJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new ProviderError(res.status, res.status === 401 || res.status === 403 || res.status === 400 ? 'Clé API refusée par le fournisseur.' : res.status === 429 ? 'Limite de débit atteinte, réessayez dans un instant.' : `Erreur fournisseur (${res.status}).`);
  return res.json();
}

/**
 * Valide la clé ET charge dynamiquement les modèles réellement disponibles pour ce compte
 * (aucune liste statique : l'API du fournisseur fait foi).
 */
export async function testKey(provider: Provider, apiKey: string, baseUrl?: string): Promise<{ ok: boolean; message: string; models?: RemoteModel[] }> {
  try {
    let models: RemoteModel[] = [];
    if (provider === 'anthropic') {
      let after = '';
      for (let page = 0; page < 5; page++) {
        const j = await getJson(`https://api.anthropic.com/v1/models?limit=100${after ? `&after_id=${after}` : ''}`, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' });
        for (const m of j.data || []) models.push({ id: m.id, label: m.display_name || m.id, context: m.max_input_tokens, created: m.created_at ? Date.parse(m.created_at) : undefined });
        if (!j.has_more) break; after = j.last_id;
      }
    } else if (provider === 'google') {
      let token = '';
      for (let page = 0; page < 4; page++) {
        const j = await getJson(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${token ? `&pageToken=${token}` : ''}`, { 'x-goog-api-key': apiKey });
        for (const m of j.models || []) if ((m.supportedGenerationMethods || []).includes('generateContent')) models.push({ id: String(m.name).replace('models/', ''), label: m.displayName || m.name, context: m.inputTokenLimit });
        if (!j.nextPageToken) break; token = j.nextPageToken;
      }
    } else {
      const j = await getJson(`${resolveBase(provider, baseUrl)}/models`, apiKey ? { authorization: `Bearer ${apiKey}` } : {});
      models = (j.data || []).map((m: { id: string; created?: number }) => ({ id: m.id, label: m.id, created: m.created ? m.created * 1000 : undefined }));
    }
    const seen = new Set<string>();
    models = models.filter((m) => m.id && !NOT_CHAT.test(m.id) && !seen.has(m.id) && seen.add(m.id));
    models.sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id));
    return { ok: true, message: models.length ? `Connexion établie · ${models.length} modèle(s) disponible(s)` : 'Clé valide, mais aucun modèle de conversation n’est listé pour ce compte.', models };
  } catch (e) {
    return { ok: false, message: e instanceof ProviderError ? e.message : `Réseau indisponible : ${(e as Error).message}` };
  }
}
