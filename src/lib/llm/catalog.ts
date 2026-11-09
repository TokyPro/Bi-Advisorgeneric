import { authFetch } from '../auth-client';
import { useStore } from '../store';
import { getSecret } from '../vault';
import type { ModelInfo, ProviderId } from '../types';
import { pickDefaultModel } from './models';

/** Valide la clé auprès du fournisseur et charge la liste réelle des modèles. */
export async function validateKey(pid: ProviderId, apiKey: string, baseUrl?: string): Promise<{ ok: boolean; message: string; models: ModelInfo[] }> {
  const st = useStore.getState();
  st.setKeyStatus(pid, 'testing');
  try {
    const r = await authFetch('/api/llm/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: pid, apiKey: apiKey.trim(), baseUrl: baseUrl?.trim() || undefined }) }).then((x) => x.json());
    const models: ModelInfo[] = r.ok ? r.models || [] : [];
    st.setKeyStatus(pid, r.ok ? 'ok' : 'error');
    if (r.ok) st.setCatalog(pid, models);
    return { ok: !!r.ok, message: r.message || (r.ok ? 'Connexion établie' : 'Clé invalide'), models };
  } catch {
    st.setKeyStatus(pid, 'error');
    return { ok: false, message: 'Serveur injoignable.', models: [] };
  }
}

/** Recharge les modèles avec la clé enregistrée (coffre chiffré). */
export async function refreshCatalog(pid: ProviderId) {
  const { llm } = useStore.getState();
  const key = (await getSecret('llm:' + pid)) || '';
  return validateKey(pid, key, llm.baseUrls?.[pid]);
}

/** Après validation : si le modèle actif n'existe pas chez ce fournisseur, en choisit un par défaut. */
export function ensureModel(pid: ProviderId, models: ModelInfo[]) {
  const { llm, setLlm } = useStore.getState();
  if (llm.provider === pid && (llm.customModel || models.some((m) => m.id === llm.model))) return;
  setLlm({ provider: pid, model: pickDefaultModel(models), customModel: '' });
}
