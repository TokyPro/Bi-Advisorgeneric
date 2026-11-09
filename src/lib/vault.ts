/**
 * Vault BYOK : chiffre les secrets (clés API, mots de passe de connexion) avec AES-GCM.
 * La CryptoKey est NON exportable et conservée dans IndexedDB ; seul le chiffré va dans localStorage.
 * Les secrets ne quittent jamais le navigateur, sauf l'envoi ponctuel au proxy lors d'un appel.
 */
const DB = 'bi-advisor-vault';
const STORE = 'keys';

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function getKey(): Promise<CryptoKey> {
  const db = await openDb();
  const existing = await new Promise<CryptoKey | undefined>((res) => {
    const q = db.transaction(STORE).objectStore(STORE).get('master');
    q.onsuccess = () => res(q.result);
    q.onerror = () => res(undefined);
  });
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(key, 'master');
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  return key;
}

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function seal(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function open(sealed: string): Promise<string | null> {
  try {
    const [iv, ct] = sealed.split('.');
    const key = await getKey();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

let LS = 'bi-advisor:secrets';
/** Isole les secrets par utilisateur (navigateur partagé). */
export function setVaultUser(uid: string) { LS = `bi-advisor:secrets:${uid}`; }
type Bag = Record<string, string>;
const readBag = (): Bag => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };

export async function setSecret(name: string, value: string) {
  const bag = readBag();
  bag[name] = await seal(value);
  localStorage.setItem(LS, JSON.stringify(bag));
}
export async function getSecret(name: string): Promise<string | null> {
  const s = readBag()[name];
  return s ? open(s) : null;
}
export function removeSecret(name: string) {
  const bag = readBag(); delete bag[name]; localStorage.setItem(LS, JSON.stringify(bag));
}
export const hasSecret = (name: string) => !!readBag()[name];

export const listSecretNames = () => Object.keys(readBag());
export function clearSecrets() { localStorage.removeItem(LS); }
