import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests QA complémentaires : critères Gherkin du sprint 2026-11-11-compat-vercel non couverts par les tests du Dev.
 * Dossier de données temporaire, aucun réseau. Le mode « hébergé » (VERCEL=1) est simulé avec un backend fichier
 * injecté à la place de Postgres (la vérification Postgres réelle relève de TS-9, en attente d'accord humain).
 */
const TOKEN = 'T0k3n-de-test-factice-0123456789abcdef';
const ADMIN = { name: 'Admin', email: 'admin@ex.fr', password: 'MotDePasseTresSecret2026' };
const MSG_CONFIG = "Configuration incomplète : AUTH_SECRET est requis. Contactez l'administrateur.";
const MSG_DISABLED = "Initialisation non configurée. L'administrateur doit définir SETUP_TOKEN ou ADMIN_EMAIL / ADMIN_PASSWORD.";
let dir = '';

const ENV_KEYS = ['VERCEL', 'BI_HOSTED', 'BI_AUTH_STORE', 'SETUP_TOKEN', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'AUTH_DISABLED', 'AUTH_SECRET'];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bia-qa-'));
  vi.resetModules();
  vi.doUnmock('@/server/auth/backends');
  for (const k of ENV_KEYS) vi.stubEnv(k, '');
  vi.stubEnv('BI_DATA_DIR', dir);
  vi.stubEnv('AUTH_SECRET', 's'.repeat(32));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const post = (url: string, body: unknown, ip = '9.9.9.9') => new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } });
const get = (url: string, cookie?: string) => new NextRequest(`http://localhost${url}`, { headers: cookie ? { cookie } : {} });
const routes = async () => ({
  setup: (await import('@/app/api/auth/setup/route')).POST,
  login: (await import('@/app/api/auth/login/route')).POST,
  me: (await import('@/app/api/auth/me/route')).GET,
});
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];

/** Simule l'hébergement : VERCEL=1 et un backend fichier à la place de Postgres ; `override` altère le backend. */
async function hosted(override?: (b: import('@/server/auth/backends/types').AuthBackend) => void) {
  vi.stubEnv('VERCEL', '1');
  vi.doMock('@/server/auth/backends', async () => {
    const { createFileBackend } = await import('@/server/auth/backends/file');
    const b = createFileBackend(dir);
    override?.(b);
    return { getBackend: async () => b };
  });
}

describe('US-1 : mots de passe jamais en clair', () => {
  it('seuls un hachage et un sel sont écrits dans users.json', async () => {
    const { setup } = await routes();
    expect((await setup(post('/api/auth/setup', ADMIN))).status).toBe(200);
    const raw = fs.readFileSync(path.join(dir, 'users.json'), 'utf8');
    expect(raw).not.toContain(ADMIN.password);
    const [u] = JSON.parse(raw);
    expect(u.hash).toMatch(/^[0-9a-f]{64,}$/i);
    expect(u.salt).toMatch(/^[0-9a-f]{16,}$/i);
  });
});

describe('US-2 : message de configuration exact, sans écriture disque', () => {
  it('hébergé sans AUTH_SECRET : login refusé avec le message exact, aucun secret généré', async () => {
    await hosted();
    vi.stubEnv('SETUP_TOKEN', TOKEN);
    const { setup, login } = await routes();
    expect((await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }))).status).toBe(200);
    vi.stubEnv('AUTH_SECRET', '');
    const r = await login(post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password }));
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body).toMatchObject({ ok: false, code: 'config', error: MSG_CONFIG });
    expect(fs.existsSync(path.join(dir, 'auth-secret'))).toBe(false);
  });

  it('AUTH_SECRET de 15 caractères : même message', async () => {
    await hosted();
    vi.stubEnv('SETUP_TOKEN', TOKEN);
    const { setup, login } = await routes();
    expect((await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }))).status).toBe(200);
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(15));
    const r = await login(post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password }));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe(MSG_CONFIG);
  });

  it('session émise par une instance acceptée par une autre (même AUTH_SECRET)', async () => {
    const a = await routes();
    const cookie = cookieOf(await a.setup(post('/api/auth/setup', ADMIN)));
    vi.resetModules(); // nouvelle « instance » : modules et caches rechargés, même secret et mêmes données
    const b = await routes();
    expect((await (await b.me(get('/api/auth/me', cookie))).json()).user.email).toBe(ADMIN.email);
  });

  it('une session signée avec un autre secret est rejetée', async () => {
    const a = await routes();
    const cookie = cookieOf(await a.setup(post('/api/auth/setup', ADMIN)));
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'z'.repeat(32));
    const b = await routes();
    expect((await (await b.me(get('/api/auth/me', cookie))).json()).user).toBeNull();
  });

  it('local sans AUTH_SECRET : un secret est généré dans le dossier de données', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    const { setup } = await routes();
    expect((await setup(post('/api/auth/setup', ADMIN))).status).toBe(200);
    expect(fs.readFileSync(path.join(dir, 'auth-secret'), 'utf8').trim()).toHaveLength(64);
  });
});

describe('US-3 : déploiement public sans mécanisme d’initialisation', () => {
  it('hébergé sans SETUP_TOKEN ni ADMIN_* : me = disabled, setup = 403 avec le message exact, aucun compte', async () => {
    await hosted();
    const { me, setup } = await routes();
    const m = await (await me(get('/api/auth/me'))).json();
    expect(m).toMatchObject({ needsSetup: true, setupMode: 'disabled' });
    const r = await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: 'setup_disabled', error: MSG_DISABLED });
    expect(fs.existsSync(path.join(dir, 'users.json'))).toBe(false);
  });

  it('hébergé avec SETUP_TOKEN : refus 403 « Jeton d’initialisation invalide. » sans jeton, succès avec le bon', async () => {
    await hosted();
    vi.stubEnv('SETUP_TOKEN', TOKEN);
    const { setup } = await routes();
    const bad = await setup(post('/api/auth/setup', ADMIN));
    expect(bad.status).toBe(403);
    expect((await bad.json()).error).toBe("Jeton d'initialisation invalide.");
    expect((await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }))).status).toBe(200);
  });

  it('409 « L’application est déjà initialisée. » avec ou sans jeton, rien n’est modifié', async () => {
    await hosted();
    vi.stubEnv('SETUP_TOKEN', TOKEN);
    const { setup } = await routes();
    await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }));
    const before = fs.readFileSync(path.join(dir, 'users.json'), 'utf8');
    for (const body of [{ ...ADMIN, email: 'x@ex.fr' }, { ...ADMIN, email: 'x@ex.fr', token: TOKEN }]) {
      const r = await setup(post('/api/auth/setup', body));
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe("L'application est déjà initialisée.");
    }
    expect(fs.readFileSync(path.join(dir, 'users.json'), 'utf8')).toBe(before);
  });

  it('SETUP_TOKEN et ADMIN_* tous deux définis : initialisation par l’écran impossible', async () => {
    await hosted();
    vi.stubEnv('SETUP_TOKEN', TOKEN); vi.stubEnv('ADMIN_EMAIL', 'env@ex.fr'); vi.stubEnv('ADMIN_PASSWORD', 'Envpass20261');
    const { setup } = await routes();
    expect((await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }))).status).toBe(409);
  });
});

describe('US-4 : journal d’audit', () => {
  it('un journal en échec ne bloque pas la connexion et l’anomalie part en console.warn sans secret', async () => {
    await hosted((b) => { b.appendAudit = async () => { throw new Error(`échec d'écriture mot de passe=${ADMIN.password}`); }; });
    vi.stubEnv('SETUP_TOKEN', TOKEN);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { setup, login } = await routes();
    expect((await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }))).status).toBe(200);
    warn.mockClear();
    const r = await login(post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password }));
    expect(r.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('login');
    expect(logged).not.toContain(ADMIN.password);
  });

  it('le journal ne contient ni mot de passe, ni jeton, ni secret de session', async () => {
    vi.stubEnv('SETUP_TOKEN', TOKEN);
    const { setup, login } = await routes();
    await setup(post('/api/auth/setup', { ...ADMIN, token: 'jeton-faux-assez-long-0123456789abcdef' }));
    const ok = await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }));
    await login(post('/api/auth/login', { email: ADMIN.email, password: 'mauvais-mot-de-passe-qa' }));
    await login(post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password }));
    const log = fs.readFileSync(path.join(dir, 'audit.log'), 'utf8');
    expect(log.length).toBeGreaterThan(0);
    for (const secret of [ADMIN.password, 'mauvais-mot-de-passe-qa', TOKEN, 'jeton-faux', 's'.repeat(32), cookieOf(ok).split('=')[1]]) {
      expect(log).not.toContain(secret);
    }
  });

  it('local : le journal est écrit dans le dossier de données', async () => {
    const { setup } = await routes();
    await setup(post('/api/auth/setup', ADMIN));
    expect(fs.readFileSync(path.join(dir, 'audit.log'), 'utf8')).toContain('setup_admin');
  });
});
