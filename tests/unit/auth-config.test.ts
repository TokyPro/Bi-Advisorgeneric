import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authSecret, isHosted, setupMode, setupTokenMatches, storeKind } from '@/server/auth/config';
import { AuthConfigError } from '@/server/auth/errors';
import { checkPassword, hashPassword } from '@/server/auth/password';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const TOKEN = 'a'.repeat(40);
const tmps: string[] = [];
const tmpDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bia-auth-')); tmps.push(d); return d; };
afterEach(() => { while (tmps.length) fs.rmSync(tmps.pop()!, { recursive: true, force: true }); });

describe('isHosted / storeKind (TS-1)', () => {
  it('détecte Vercel et BI_HOSTED', () => {
    expect(isHosted(env({}))).toBe(false);
    expect(isHosted(env({ VERCEL: '1' }))).toBe(true);
    expect(isHosted(env({ BI_HOSTED: 'true' }))).toBe(true);
  });
  it('local : fichier, même si DATABASE_URL est défini', () => {
    expect(storeKind(env({}))).toBe('file');
    expect(storeKind(env({ DATABASE_URL: 'postgres://x' }))).toBe('file');
  });
  it('hébergé : postgres ; BI_AUTH_STORE=postgres force postgres en local', () => {
    expect(storeKind(env({ VERCEL: '1' }))).toBe('postgres');
    expect(storeKind(env({ BI_AUTH_STORE: 'postgres' }))).toBe('postgres');
  });
  it('hébergé + BI_AUTH_STORE=file : refusé (config)', () => {
    expect(() => storeKind(env({ VERCEL: '1', BI_AUTH_STORE: 'file' }))).toThrow(AuthConfigError);
  });
});

describe('authSecret (TS-2)', () => {
  it('absent en hébergé : AuthConfigError sans aucune écriture disque', () => {
    const dir = tmpDir();
    expect(() => authSecret(env({ VERCEL: '1', BI_DATA_DIR: dir }))).toThrow(AuthConfigError);
    expect(fs.existsSync(path.join(dir, 'auth-secret'))).toBe(false);
  });
  it('15 caractères : refusé partout, y compris en local', () => {
    expect(() => authSecret(env({ AUTH_SECRET: 'x'.repeat(15) }))).toThrow(AuthConfigError);
    expect(() => authSecret(env({ AUTH_SECRET: 'x'.repeat(15), VERCEL: '1' }))).toThrow(AuthConfigError);
  });
  it('16 caractères ou plus : accepté', () => {
    expect(authSecret(env({ AUTH_SECRET: 'y'.repeat(16), VERCEL: '1' }))).toBe('y'.repeat(16));
  });
  it('local sans secret : généré dans le dossier de données puis relu', () => {
    const dir = tmpDir();
    const s = authSecret(env({ BI_DATA_DIR: dir }));
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(dir, 'auth-secret'), 'utf8')).toBe(s);
  });
});

describe('setupMode (TS-3)', () => {
  it('matrice § 4.3', () => {
    expect(setupMode(env({}))).toBe('open');
    expect(setupMode(env({ SETUP_TOKEN: TOKEN }))).toBe('token');
    expect(setupMode(env({ VERCEL: '1', SETUP_TOKEN: TOKEN }))).toBe('token');
    expect(setupMode(env({ VERCEL: '1' }))).toBe('disabled');
    expect(setupMode(env({ ADMIN_EMAIL: 'a@b.fr', ADMIN_PASSWORD: 'x', SETUP_TOKEN: TOKEN }))).toBe('disabled');
    expect(setupMode(env({ VERCEL: '1', ADMIN_EMAIL: 'a@b.fr', ADMIN_PASSWORD: 'x' }))).toBe('disabled');
  });
  it('jeton de 31 caractères : non configuré', () => {
    expect(setupMode(env({ SETUP_TOKEN: 'b'.repeat(31) }))).toBe('disabled');
  });
});

describe('setupTokenMatches (TS-4)', () => {
  const e = env({ SETUP_TOKEN: TOKEN });
  it('bon jeton accepté ; mauvais, vide, absent, non chaîne ou de longueur différente refusés sans exception', () => {
    expect(setupTokenMatches(TOKEN, e)).toBe(true);
    for (const bad of ['a'.repeat(39), 'a'.repeat(41), '', undefined, null, 42, { t: TOKEN }]) expect(setupTokenMatches(bad, e)).toBe(false);
  });
  it('aucun jeton configuré : tout est refusé', () => {
    expect(setupTokenMatches('', env({}))).toBe(false);
  });
});

describe('password.ts (TS-5)', () => {
  it('vérifie un hachage produit par l’ancien scryptSync (non-régression US-6)', async () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('Ancien2026pass', salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
    expect(await checkPassword({ hash, salt }, 'Ancien2026pass')).toBe(true);
    expect(await checkPassword({ hash, salt }, 'Mauvais2026pass')).toBe(false);
    expect(await checkPassword(undefined, 'Ancien2026pass')).toBe(false);
  });
  it('produit le même hachage que l’ancien code pour un sel donné', async () => {
    const salt = 'c'.repeat(32);
    const old = crypto.scryptSync('Motdepasse123', salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
    expect((await hashPassword('Motdepasse123', salt)).hash).toBe(old);
  });
});
