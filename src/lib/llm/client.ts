import { authFetch } from '../auth-client';
import type { DataSource } from '../types';
import { useStore } from '../store';
import { getSecret } from '../vault';
import { demoRespond, demoStream } from './demo-provider';

export interface LlmMessage { role: 'user' | 'assistant'; content: string }

export function activeModelId() {
  const { llm } = useStore.getState();
  return llm.customModel.trim() || llm.model;
}

/** Flux de texte depuis le fournisseur actif (ou le moteur démo). */
export async function* streamLLM(p: { system: string; messages: LlmMessage[]; sources: DataSource[]; signal?: AbortSignal }): AsyncGenerator<string> {
  const { llm } = useStore.getState();
  if (llm.provider === 'demo') {
    const last = [...p.messages].reverse().find((m) => m.role === 'user')?.content || '';
    yield* demoStream(demoRespond(last, p.sources), p.signal);
    return;
  }
  const apiKey = (await getSecret('llm:' + llm.provider)) || '';
  const baseUrl = llm.baseUrls?.[llm.provider]?.trim() || undefined;
  if (!apiKey && !(llm.provider === 'nvidia' && baseUrl)) throw new Error(`Aucune clé API enregistrée pour ${llm.provider}. Ouvrez les paramètres LLM (⚙️).`);
  let res: Response;
  try {
    res = await authFetch('/api/llm/chat', {
      method: 'POST', signal: p.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: llm.provider, model: activeModelId(), apiKey, baseUrl, temperature: llm.temperature, maxTokens: llm.maxTokens, system: p.system, messages: p.messages }),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    throw new Error('Serveur injoignable.');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    if (res.status === 404) {
      // Le fournisseur liste ce modèle mais il n'est pas utilisable avec ce compte : on le retire de la liste chargée.
      const st = useStore.getState();
      const bad = activeModelId();
      const rest = (st.catalog[llm.provider]?.models ?? []).filter((m) => m.id !== bad);
      st.setCatalog(llm.provider, rest);
      st.setLlm({ model: '', customModel: '' });
      throw new Error(`Le modèle « ${bad} » n’est pas utilisable avec votre compte ${llm.provider} (retiré de la liste). Choisissez-en un autre dans le sélecteur de modèle.`);
    }
    throw new Error(j.error || `Erreur ${res.status}`);
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield dec.decode(value, { stream: true });
  }
}

export async function completeOnce(system: string, prompt: string, sources: DataSource[]): Promise<string> {
  let out = '';
  for await (const t of streamLLM({ system, messages: [{ role: 'user', content: prompt }], sources })) out += t;
  return out;
}
