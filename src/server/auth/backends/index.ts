import { authDatabaseUrl, dataDir, storeKind } from '../config';
import { createFileBackend } from './file';
import type { AuthBackend } from './types';

/** Une instance par configuration (le mutex du backend fichier doit être unique par dossier). */
const backends = new Map<string, Promise<AuthBackend>>();

export function getBackend(): Promise<AuthBackend> {
  const kind = storeKind();
  const key = kind === 'file' ? `file:${dataDir()}` : `postgres:${authDatabaseUrl()}`;
  let b = backends.get(key);
  if (!b) {
    // `pg` n'est chargé que dans ce cas : le mode local n'importe jamais le pilote ni n'ouvre de connexion.
    b = kind === 'file'
      ? Promise.resolve(createFileBackend(dataDir()))
      : import('./postgres').then((m) => m.createPostgresBackend(authDatabaseUrl()));
    b.catch(() => backends.delete(key));
    backends.set(key, b);
  }
  return b;
}
