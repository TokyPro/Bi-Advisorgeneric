import { useStore } from './store';
import { getSecret, setSecret, listSecretNames } from './vault';
import { download } from './utils';

/**
 * Sauvegarde / restauration de la configuration (réglages LLM, sources, secrets) dans un fichier
 * chiffré par mot de passe (PBKDF2 600k itérations + AES-GCM). Permet de migrer d'un navigateur à l'autre.
 */
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 600_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function exportConfig(pass: string) {
  const st = useStore.getState();
  const secrets: Record<string, string> = {};
  for (const n of listSecretNames()) { const v = await getSecret(n); if (v != null) secrets[n] = v; }
  const payload = JSON.stringify({ v: 1, llm: st.llm, keyStatus: st.keyStatus, theme: st.theme, sources: st.sources.filter((s) => !s.ephemeral && !s.kind.startsWith('demo')).map((s) => ({ ...s, config: undefined, status: 'active' })), secrets });
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(pass, salt), new TextEncoder().encode(payload)));
  download(new Blob([JSON.stringify({ app: 'bi-advisor', v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct) })], { type: 'application/json' }), `bi-advisor-config-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function importConfig(file: File, pass: string) {
  let env: { app?: string; salt: string; iv: string; data: string };
  try { env = JSON.parse(await file.text()); } catch { throw new Error('Fichier illisible.'); }
  if (env.app !== 'bi-advisor') throw new Error('Ce fichier n’est pas une sauvegarde BI Advisor.');
  let plain: string;
  try { plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) as BufferSource }, await deriveKey(pass, unb64(env.salt)), unb64(env.data) as BufferSource)); }
  catch { throw new Error('Mot de passe incorrect ou fichier corrompu.'); }
  const d = JSON.parse(plain);
  for (const [k, v] of Object.entries(d.secrets as Record<string, string>)) await setSecret(k, v);
  const cur = useStore.getState();
  const known = new Set(cur.sources.map((s) => s.id));
  useStore.setState({ llm: { ...cur.llm, ...d.llm }, keyStatus: d.keyStatus || {}, sources: [...cur.sources, ...(d.sources as typeof cur.sources).filter((s) => !known.has(s.id))] });
  return { secrets: Object.keys(d.secrets).length, sources: d.sources.length };
}
