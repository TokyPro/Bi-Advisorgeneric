import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AuthConfigError, AuthStorageError } from './errors';

/**
 * Configuration de l'authentification. Tout est évalué paresseusement : `VERCEL=1` est aussi présent au build,
 * un effet de bord au chargement du module (lecture de secret, `throw`) ferait échouer `next build`.
 */

type Env = NodeJS.ProcessEnv;

export const dataDir = (env: Env = process.env) => env.BI_DATA_DIR || path.join(process.cwd(), 'data');

/** Hébergement sans disque persistant : Vercel (automatique) ou déclaré par l'administrateur. */
export const isHosted = (env: Env = process.env) => env.VERCEL === '1' || env.BI_HOSTED === 'true';

export type StoreKind = 'file' | 'postgres';
export function storeKind(env: Env = process.env): StoreKind {
  const v = env.BI_AUTH_STORE;
  // Le disque d'un hébergement serverless n'est pas persistant : on refuse plutôt que de perdre les comptes.
  if (v === 'file') { if (isHosted(env)) throw new AuthConfigError(); return 'file'; }
  if (v === 'postgres') return 'postgres';
  return isHosted(env) ? 'postgres' : 'file';
}

/** URL de la base des comptes. `DATABASE_URL` seule n'active jamais Postgres en local (voir storeKind). */
let missingUrlLogged = false;
export function authDatabaseUrl(env: Env = process.env): string {
  const u = env.BI_AUTH_DATABASE_URL || env.DATABASE_URL;
  if (!u) {
    // Une seule fois par instance : getBackend() est appelé plusieurs fois par requête.
    if (!missingUrlLogged) { missingUrlLogged = true; console.error('[auth] BI_AUTH_DATABASE_URL ou DATABASE_URL requis pour le stockage postgres'); }
    throw new AuthStorageError();
  }
  return u;
}

let localSecret: { dir: string; value: string } | null = null;
function localFileSecret(dir: string) {
  if (localSecret?.dir === dir) return localSecret.value;
  const f = path.join(dir, 'auth-secret');
  let value: string;
  try { value = fs.readFileSync(f, 'utf8').trim(); }
  catch {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    value = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, value, { mode: 0o600 });
  }
  localSecret = { dir, value };
  return value;
}

/** Secret de signature des sessions. Défini mais trop court : refusé partout (y compris en local). */
export function authSecret(env: Env = process.env): string {
  const s = env.AUTH_SECRET;
  if (s !== undefined && s !== '') { if (s.length >= 16) return s; throw new AuthConfigError(); }
  if (isHosted(env)) throw new AuthConfigError(); // jamais de génération ni d'écriture disque en hébergé
  return localFileSecret(dataDir(env));
}

export type SetupMode = 'open' | 'token' | 'disabled';
let shortTokenLogged = false;
export function setupMode(env: Env = process.env): SetupMode {
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) return 'disabled';
  if (env.SETUP_TOKEN) {
    if (env.SETUP_TOKEN.length >= 32) return 'token';
    if (!shortTokenLogged) { shortTokenLogged = true; console.error('[auth] SETUP_TOKEN trop court (32 caractères minimum) : initialisation désactivée'); }
    return 'disabled';
  }
  return isHosted(env) ? 'disabled' : 'open';
}

let hmacKey: Buffer | null = null;
const digest = (v: string) => crypto.createHmac('sha256', (hmacKey ??= crypto.randomBytes(32))).update(v).digest();

/** Comparaison à temps constant : HMAC des deux valeurs (longueurs égales par construction), aucune fuite de longueur. */
export function setupTokenMatches(received: unknown, env: Env = process.env): boolean {
  const expected = env.SETUP_TOKEN ?? '';
  const ok = crypto.timingSafeEqual(digest(typeof received === 'string' ? received : ''), digest(expected));
  return ok && expected.length >= 32;
}
