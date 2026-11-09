import type { ModelInfo, ProviderId } from '../types';
import { useStore } from '../store';

/** Fournisseurs supportés. Les MODÈLES ne sont jamais listés ici : ils sont chargés depuis l'API du fournisseur après validation de la clé. */
export interface ProviderMeta { id: ProviderId; label: string; color: string; keyHint: string; docs: string; baseUrlHint?: string }

export const DEMO_MODEL: ModelInfo = { id: 'demo-advisor', label: 'Demo Advisor (moteur local)' };

export const PROVIDERS: ProviderMeta[] = [
  { id: 'demo', label: 'Démo (hors-ligne)', color: '#2bb5a0', keyHint: 'Aucune clé requise', docs: '' },
  { id: 'anthropic', label: 'Anthropic', color: '#d97757', keyHint: 'sk-ant-…', docs: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI', color: '#10a37f', keyHint: 'sk-…', docs: 'https://platform.openai.com/api-keys' },
  { id: 'google', label: 'Google Gemini', color: '#4285f4', keyHint: 'AIza…', docs: 'https://aistudio.google.com/apikey' },
  { id: 'nvidia', label: 'NVIDIA NIM', color: '#76b900', keyHint: 'nvapi-… (vide si NIM auto-hébergé)', docs: 'https://build.nvidia.com', baseUrlHint: 'https://integrate.api.nvidia.com/v1 — ou http://localhost:8000/v1 pour un NIM auto-hébergé' },
  { id: 'deepseek', label: 'DeepSeek', color: '#4d6bfe', keyHint: 'sk-…', docs: 'https://platform.deepseek.com/api_keys' },
];

export const provider = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;

/** Modèles chargés pour un fournisseur (cache persistant, alimenté par la validation de la clé). */
export const catalogOf = (p: ProviderId): ModelInfo[] => (p === 'demo' ? [DEMO_MODEL] : useStore.getState().catalog[p]?.models ?? []);
export const modelInfo = (p: ProviderId, m: string) => catalogOf(p).find((x) => x.id === m);
export const modelLabel = (p: ProviderId, m: string) => modelInfo(p, m)?.label || m;

export const estTokens = (s: string) => Math.ceil(s.length / 4);
/** Les API ne publient pas les tarifs : le coût n'est estimé que si l'administrateur a saisi les prix du modèle ($ / M tokens). */
export const estCost = (p: ProviderId, m: string, inTok: number, outTok: number) => {
  const pr = useStore.getState().llm.pricing?.[`${p}:${m}`];
  return pr ? (inTok * pr.in + outTok * pr.out) / 1_000_000 : 0;
};
export const fmtCtx = (n?: number) => (!n ? '' : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

/** Choix par défaut après chargement : premier modèle « généraliste » récent. */
export function pickDefaultModel(models: ModelInfo[]): string {
  return (models.find((m) => /(sonnet|gpt-?\d|gemini.*(pro|flash)|chat|llama.*instruct|nemotron)/i.test(m.id)) ?? models[0])?.id ?? '';
}
