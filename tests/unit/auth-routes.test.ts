import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Routes d'authentification en mode fichier (TS-7, partiel) : dossier de données temporaire, modules rechargés
 * à chaque test (état mémoïsé : seed, backends, limiteur). Aucun accès réseau.
 */
const TOKEN = 'T0k3n-de-test-factice-0123456789abcdef';
const ADMIN = { name: 'Admin', email: 'admin@ex.fr', password: 'Motdepasse2026' };
let dir = '';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bia-routes-'));
  vi.resetModules();
  for (const k of ['VERCEL', 'BI_HOSTED', 'BI_AUTH_STORE', 'SETUP_TOKEN', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'AUTH_DISABLED', 'AUTH_SECRET']) vi.stubEnv(k, '');
  vi.stubEnv('BI_DATA_DIR', dir);
  vi.stubEnv('AUTH_SECRET', 's'.repeat(32));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });

const post = (url: string, body: unknown, ip = '9.9.9.9') => new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } });
const get = (url: string, cookie?: string) => new NextRequest(`http://localhost${url}`, { headers: cookie ? { cookie } : {} });
const routes = async () => ({
  setup: (await import('@/app/api/auth/setup/route')).POST,
  login: (await import('@/app/api/auth/login/route')).POST,
  me: (await import('@/app/api/auth/me/route')).GET,
  users: await import('@/app/api/admin/users/route'),
});
const users = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8')); } catch { return []; } };
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];

describe('setup avec SETUP_TOKEN (US-3)', () => {
  beforeEach(() => vi.stubEnv('SETUP_TOKEN', TOKEN));

  it('/api/auth/me expose setupMode=token, jamais la valeur', async () => {
    const r = await (await routes()).me(get('/api/auth/me'));
    const text = await r.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, needsSetup: true, setupMode: 'token' });
    expect(text).not.toContain(TOKEN);
  });

  it('jeton absent ou faux : 403 identique, aucun compte, jeton absent du journal', async () => {
    const { setup } = await routes();
    const a = await setup(post('/api/auth/setup', ADMIN));
    const b = await setup(post('/api/auth/setup', { ...ADMIN, token: 'faux-jeton-mais-assez-long-0123456789' }));
    expect(a.status).toBe(403);
    expect(await a.json()).toEqual(await b.json());
    expect(users()).toHaveLength(0);
    const log = fs.readFileSync(path.join(dir, 'audit.log'), 'utf8');
    expect(log).toContain('setup_denied');
    expect(log).not.toContain('faux-jeton');
  });

  it('bon jeton : admin créé, connecté ; second appel : 409', async () => {
    const { setup, me } = await routes();
    const r = await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }));
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain(TOKEN);
    expect(users()).toHaveLength(1);
    const m = await (await me(get('/api/auth/me', cookieOf(r)))).json();
    expect(m.user.email).toBe(ADMIN.email);
    expect(m.setupMode).toBeUndefined();
    const again = await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }));
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('already_initialized');
  });

  it('limiteur : 5 jetons faux puis 429 rate_limited', async () => {
    const { setup } = await routes();
    for (let i = 0; i < 5; i++) expect((await setup(post('/api/auth/setup', { ...ADMIN, token: 'x' }))).status).toBe(403);
    const r = await setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN }));
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ code: 'rate_limited', retryAfterMin: 10 });
  });

  it('deux initialisations simultanées : un seul admin, l’autre 409', async () => {
    const { setup } = await routes();
    const rs = await Promise.all([setup(post('/api/auth/setup', { ...ADMIN, token: TOKEN })), setup(post('/api/auth/setup', { ...ADMIN, email: 'autre@ex.fr', token: TOKEN }))]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(users()).toHaveLength(1);
  });
});

describe('mode local sans jeton (US-3, US-6)', () => {
  it('setupMode=open et initialisation sans jeton', async () => {
    const { setup, me } = await routes();
    expect((await (await me(get('/api/auth/me'))).json()).setupMode).toBe('open');
    expect((await setup(post('/api/auth/setup', ADMIN))).status).toBe(200);
  });

  it('ADMIN_EMAIL/ADMIN_PASSWORD : admin créé au premier accès, écran de setup jamais proposé', async () => {
    vi.stubEnv('ADMIN_EMAIL', 'env@ex.fr'); vi.stubEnv('ADMIN_PASSWORD', 'Envpass20261');
    const { me, setup } = await routes();
    expect(await (await me(get('/api/auth/me'))).json()).toMatchObject({ needsSetup: false });
    expect(users().map((u: { email: string }) => u.email)).toEqual(['env@ex.fr']);
    expect((await setup(post('/api/auth/setup', ADMIN))).status).toBe(409);
  });

  it('BUG-1 : données vides, ADMIN_* valides, premier appel = login → admin créé et connexion 200', async () => {
    vi.stubEnv('ADMIN_EMAIL', 'env@ex.fr'); vi.stubEnv('ADMIN_PASSWORD', 'Envpass20261');
    const { login, me } = await routes();
    expect(users()).toHaveLength(0);
    const r = await login(post('/api/auth/login', { email: 'env@ex.fr', password: 'Envpass20261' }));
    expect(r.status).toBe(200);
    expect(users().map((u: { email: string }) => u.email)).toEqual(['env@ex.fr']);
    expect((await (await me(get('/api/auth/me', cookieOf(r)))).json()).user.email).toBe('env@ex.fr');
  });
});

describe('connexion et révocation (US-1, US-5)', () => {
  it('login, limiteur 5 échecs → 429, désactivation révoque la session', async () => {
    const { setup, login, users: admin, me } = await routes();
    const adminCookie = cookieOf(await setup(post('/api/auth/setup', ADMIN)));
    const create = await admin.POST(new NextRequest('http://localhost/api/admin/users', { method: 'POST', body: JSON.stringify({ action: 'create', email: 'u@ex.fr', name: 'U', role: 'user', password: 'Userpass2026' }), headers: { cookie: adminCookie } }));
    const uid = (await create.json()).users.find((u: { email: string }) => u.email === 'u@ex.fr').id;

    const ok = await login(post('/api/auth/login', { email: 'U@ex.fr', password: 'Userpass2026' }));
    expect(ok.status).toBe(200);
    const userCookie = cookieOf(ok);
    expect((await (await me(get('/api/auth/me', userCookie))).json()).user.email).toBe('u@ex.fr');

    await admin.POST(new NextRequest('http://localhost/api/admin/users', { method: 'POST', body: JSON.stringify({ action: 'update', id: uid, disabled: true }), headers: { cookie: adminCookie } }));
    expect((await (await me(get('/api/auth/me', userCookie))).json()).user).toBeNull();

    for (let i = 0; i < 5; i++) expect((await login(post('/api/auth/login', { email: 'admin@ex.fr', password: 'mauvais' }, '1.1.1.1'))).status).toBe(401);
    const locked = await login(post('/api/auth/login', { email: 'admin@ex.fr', password: ADMIN.password }, '1.1.1.1'));
    expect(locked.status).toBe(429);
    expect((await locked.json()).code).toBe('rate_limited');
  });

  it('CR-2 : 20 connexions concurrentes au mauvais mot de passe, au plus 5 vérifiées, les autres 429', async () => {
    const { setup, login } = await routes();
    await setup(post('/api/auth/setup', ADMIN));
    const rs = await Promise.all(Array.from({ length: 20 }, () => login(post('/api/auth/login', { email: 'admin@ex.fr', password: 'mauvais' }, '2.2.2.2'))));
    const st = rs.map((x) => x.status);
    expect(st.filter((s) => s === 401)).toHaveLength(5);
    expect(st.filter((s) => s === 429)).toHaveLength(15);
    // Bon mot de passe depuis cette IP : toujours bloqué (le seuil tient malgré la rafale)
    expect((await login(post('/api/auth/login', { email: 'admin@ex.fr', password: ADMIN.password }, '2.2.2.2'))).status).toBe(429);
  });

  it('une connexion réussie remet à zéro le compteur IP+e-mail', async () => {
    const { setup, login } = await routes();
    await setup(post('/api/auth/setup', ADMIN));
    for (let i = 0; i < 4; i++) expect((await login(post('/api/auth/login', { email: 'admin@ex.fr', password: 'mauvais' }, '3.3.3.3'))).status).toBe(401);
    expect((await login(post('/api/auth/login', { email: 'admin@ex.fr', password: ADMIN.password }, '3.3.3.3'))).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await login(post('/api/auth/login', { email: 'admin@ex.fr', password: 'mauvais' }, '3.3.3.3'))).status).toBe(401);
  });

  it('CR-4 : journal illisible, la gestion des comptes répond quand même', async () => {
    const { setup, users: admin } = await routes();
    const cookie = cookieOf(await setup(post('/api/auth/setup', ADMIN)));
    const audit = await import('@/server/auth/audit');
    vi.spyOn(audit, 'readAudit').mockRejectedValue(new Error('lecture impossible'));
    const r = await admin.POST(new NextRequest('http://localhost/api/admin/users', { method: 'POST', body: JSON.stringify({ action: 'create', email: 'v@ex.fr', name: 'V', role: 'user', password: 'Userpass2026' }), headers: { cookie } }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, audit: [] });
  });

  it('une route protégée sans session répond 401', async () => {
    const { users: admin } = await routes();
    expect((await admin.GET(get('/api/admin/users'))).status).toBe(401);
  });
});

describe('configuration (US-2)', () => {
  it('hébergé sans AUTH_SECRET : 503 config, sans rien écrire sur disque', async () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('AUTH_SECRET', '');
    const { me } = await routes();
    const r = await me(get('/api/auth/me'));
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe('config');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('AUTH_SECRET trop court en local : 503 config sur une route protégée', async () => {
    vi.stubEnv('AUTH_SECRET', 'court');
    const { users: admin } = await routes();
    const r = await admin.GET(get('/api/admin/users', 'bia_session=abc.def'));
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe('config');
  });
});
