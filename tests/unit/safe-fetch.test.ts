import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkPolicyError, POLICY_MESSAGE } from '@/server/net/policy';
import { BAD_URL_MESSAGE, HTTP_BASEURL_MESSAGE, REDIRECT_MESSAGE, TOO_LARGE_MESSAGE, safeFetch } from '@/server/net/safe-fetch';
import { fetchRest } from '@/server/connectors/saas';
import { friendly, test as testConnector } from '@/server/connectors';
import { BASEURL_PROVIDERS, BASEURL_UNSUPPORTED, resolveBase, testKey } from '@/server/llm';

/**
 * US-3 : safeFetch contre de faux serveurs HTTP locaux (127.0.0.1 uniquement). Aucun appel réseau externe.
 * Le serveur « témoin » compte les requêtes reçues : un refus de politique doit laisser ce compteur à 0.
 */
let server: http.Server;
let port = 0;
let hits = 0;
let lastHeaders: http.IncomingHttpHeaders = {};
let lastMethod = '';
let lastBody = '';

const BIG = 21 * 1024 * 1024;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++;
    lastHeaders = req.headers;
    lastMethod = req.method || '';
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      lastBody = Buffer.concat(chunks).toString();
      const url = new URL(req.url || '/', 'http://x');
      switch (url.pathname) {
        case '/json': res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ a: 1, b: 'x' }, { a: 2, b: 'y' }] })); break;
        case '/redirect': res.writeHead(302, { location: `http://127.0.0.1:${port}/secret` }); res.end(); break;
        case '/secret': res.writeHead(200); res.end('SECRET-ATTEINT'); break;
        case '/err500': res.writeHead(500, { 'content-type': 'text/plain' }); res.end('SECRET-INTERNE'); break;
        case '/notjson': res.writeHead(200, { 'content-type': 'text/plain' }); res.end('SECRET-INTERNE-PAS-JSON'); break;
        case '/big': { res.writeHead(200); const buf = Buffer.alloc(1024 * 1024, 97); let n = 0; const pump = () => { while (n < 21) { n++; if (!res.write(buf)) { res.once('drain', pump); return; } } res.end(); }; pump(); break; }
        case '/bomb': { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end(zlib.gzipSync(Buffer.alloc(30 * 1024 * 1024, 48))); break; }
        case '/gzip': res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'application/json' }); res.end(zlib.gzipSync(JSON.stringify({ ok: true }))); break;
        case '/hang': /* jamais de réponse */ break;
        case '/slowbody': res.writeHead(200); res.write('{"a":'); /* corps jamais terminé */ break;
        case '/sse': { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: un\n\n'); setTimeout(() => { res.write('data: deux\n\n'); res.end(); }, 50); break; }
        case '/204': res.writeHead(204); res.end(); break;
        default: res.writeHead(404); res.end('nf');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); });

let savedHosts: string | undefined;
let savedPolicy: string | undefined;
beforeEach(() => { hits = 0; savedHosts = process.env.BI_ALLOWED_HOSTS; savedPolicy = process.env.BI_NETWORK_POLICY; delete process.env.BI_ALLOWED_HOSTS; delete process.env.BI_NETWORK_POLICY; });
afterEach(() => {
  if (savedHosts === undefined) delete process.env.BI_ALLOWED_HOSTS; else process.env.BI_ALLOWED_HOSTS = savedHosts;
  if (savedPolicy === undefined) delete process.env.BI_NETWORK_POLICY; else process.env.BI_NETWORK_POLICY = savedPolicy;
});
const allow = () => { process.env.BI_ALLOWED_HOSTS = `127.0.0.1:${port}`; };
const base = () => `http://127.0.0.1:${port}`;

describe('US-3 / destinations internes refusées sans aucune connexion', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://100.64.0.1/',
    'http://0.0.0.0:3000/', 'http://[fd00::1]/', 'http://[::1]:3000/',
  ])('%s', async (url) => {
    const e = await safeFetch(url, { timeoutMs: 2000 }).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(NetworkPolicyError);
    expect((e as Error).message).toBe(POLICY_MESSAGE);
  });

  // Variantes d'écriture de 127.0.0.1 : le serveur témoin écoute réellement sur cette adresse, il doit rester à 0 requête.
  it.each([
    () => `http://127.0.0.1:${port}/json`,
    () => `http://2130706433:${port}/json`,
    () => `http://0x7f000001:${port}/json`,
    () => `http://0177.0.0.1:${port}/json`,
    () => `http://[::ffff:127.0.0.1]:${port}/json`,
    () => `http://[::ffff:7f00:1]:${port}/json`,
    () => `http://127.1:${port}/json`,
    () => `http://localhost:${port}/json`,
  ])('variante de loopback n° %#', async (mk) => {
    const e = await safeFetch(mk(), { timeoutMs: 2000 }).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(NetworkPolicyError);
    expect((e as Error).message).toBe(POLICY_MESSAGE);
    expect(hits).toBe(0);
  });

  it('le serveur témoin répond bien quand la destination est explicitement autorisée (le témoin fonctionne)', async () => {
    allow();
    const res = await safeFetch(`${base()}/json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ a: 1, b: 'x' }, { a: 2, b: 'y' }] });
    expect(hits).toBe(1);
  });

  it('liste blanche : un autre port du même hôte reste refusé', async () => {
    process.env.BI_ALLOWED_HOSTS = `127.0.0.1:${port + 1}`;
    await expect(safeFetch(`${base()}/json`)).rejects.toThrow(POLICY_MESSAGE);
    expect(hits).toBe(0);
  });

  it('mode allowlist : refus d’une IP publique littérale hors liste (sans connexion)', async () => {
    process.env.BI_NETWORK_POLICY = 'allowlist';
    process.env.BI_ALLOWED_HOSTS = 'api.exemple.com';
    await expect(safeFetch('https://93.184.216.34/x', { timeoutMs: 2000 })).rejects.toThrow(POLICY_MESSAGE);
  });

  it('métadonnées cloud refusées même avec une liste blanche qui les couvre', async () => {
    process.env.BI_ALLOWED_HOSTS = '169.254.0.0/16';
    await expect(safeFetch('http://169.254.169.254/latest/meta-data/', { timeoutMs: 2000 })).rejects.toThrow(POLICY_MESSAGE);
  });
});

describe('US-3 / validation de l’URL', () => {
  it.each(['https://user:pass@api.exemple.com/x', 'https://user@api.exemple.com/x', 'ftp://exemple.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'pas une url', ''])('refuse %j', async (url) => {
    await expect(safeFetch(url)).rejects.toThrow(BAD_URL_MESSAGE);
  });
});

describe('US-3 / redirections, taille, délais', () => {
  it('une redirection 302 n’est pas suivie (la cible n’est jamais contactée)', async () => {
    allow();
    await expect(safeFetch(`${base()}/redirect`)).rejects.toThrow(REDIRECT_MESSAGE);
    expect(hits).toBe(1); // uniquement /redirect, jamais /secret
  });

  it('un corps de plus de 20 Mo est refusé (E-NET-4)', async () => {
    allow();
    await expect(safeFetch(`${base()}/big`)).rejects.toThrow(TOO_LARGE_MESSAGE);
    expect(BIG).toBeGreaterThan(20 * 1024 * 1024);
  });

  it('une bombe gzip (30 Mo décompressés pour quelques Ko) est refusée : le plafond s’applique après décompression', async () => {
    allow();
    await expect(safeFetch(`${base()}/bomb`)).rejects.toThrow(TOO_LARGE_MESSAGE);
  });

  it('le plafond est paramétrable (maxBytes)', async () => {
    allow();
    await expect(safeFetch(`${base()}/json`, { maxBytes: 10 })).rejects.toThrow(TOO_LARGE_MESSAGE);
  });

  it('un corps gzip est décompressé', async () => {
    allow();
    const res = await safeFetch(`${base()}/gzip`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('un serveur qui ne répond jamais déclenche ETIMEDOUT', async () => {
    allow();
    const e = await safeFetch(`${base()}/hang`, { timeoutMs: 300 }).then(() => null, (x: unknown) => x);
    expect((e as NodeJS.ErrnoException).code).toBe('ETIMEDOUT');
  });

  it('le délai couvre aussi la lecture d’un corps plafonné qui n’en finit pas', async () => {
    allow();
    const e = await safeFetch(`${base()}/slowbody`, { timeoutMs: 300 }).then(() => null, (x: unknown) => x);
    expect((e as NodeJS.ErrnoException).code).toBe('ETIMEDOUT');
  });

  it('mode flux (maxBytes null) : un flux SSE est lu progressivement', async () => {
    allow();
    const res = await safeFetch(`${base()}/sse`, { maxBytes: null, timeoutMs: 5000 });
    const text = await res.text();
    expect(text).toContain('data: un');
    expect(text).toContain('data: deux');
  });

  it('réponse 204 sans corps', async () => {
    allow();
    const res = await safeFetch(`${base()}/204`);
    expect(res.status).toBe(204);
  });
});

describe('US-3 / en-têtes', () => {
  it('l’en-tête Host forcé est ignoré : le serveur reçoit l’hôte réel', async () => {
    allow();
    await safeFetch(`${base()}/json`, { headers: { Host: 'localhost', 'Content-Length': '999', 'Transfer-Encoding': 'chunked', 'X-Test': 'ok' } });
    expect(lastHeaders.host).toBe(`127.0.0.1:${port}`);
    expect(lastHeaders['x-test']).toBe('ok');
    expect(lastHeaders['transfer-encoding']).toBeUndefined();
  });

  it('POST : méthode et corps transmis avec la bonne longueur', async () => {
    allow();
    await safeFetch(`${base()}/json`, { method: 'POST', body: '{"a":"é"}', headers: { 'content-type': 'application/json' } });
    expect(lastMethod).toBe('POST');
    expect(lastBody).toBe('{"a":"é"}');
    expect(lastHeaders['content-length']).toBe(String(Buffer.byteLength('{"a":"é"}')));
  });
});

describe('US-3 / http:// pour une URL de base LLM (httpsRequiredUnlessAllowlisted)', () => {
  it('http:// refusé hors liste blanche (E-LLM-2), sans connexion', async () => {
    await expect(safeFetch('http://proxy.exemple.com/v1', { httpsRequiredUnlessAllowlisted: true })).rejects.toThrow(HTTP_BASEURL_MESSAGE);
  });
  it('http:// accepté si l’hôte est en liste blanche', async () => {
    allow();
    const res = await safeFetch(`${base()}/json`, { httpsRequiredUnlessAllowlisted: true });
    expect(res.status).toBe(200);
  });
});

describe('US-3 / connecteur REST (saas.ts) : messages exacts du Gherkin', () => {
  const rest = (over: Record<string, string> = {}) => ({ url: `${base()}/json`, dataPath: 'data', ...over });
  const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return friendly(e); } return 'AUCUNE ERREUR'; };

  it('synchronisation nominale (liste blanche) : lignes aplaties', async () => {
    allow();
    const t = await fetchRest(rest());
    expect(Object.values(t)[0]).toHaveLength(2);
  });
  it('URL interne refusée avec le message de politique et sans requête', async () => {
    expect(await err(fetchRest(rest()))).toBe(POLICY_MESSAGE);
    expect(hits).toBe(0);
  });
  it('identifiants dans l’URL refusés', async () => { expect(await err(fetchRest({ url: 'https://user:pass@api.exemple.com/x' }))).toBe(BAD_URL_MESSAGE); });
  it('redirection : message dédié', async () => { allow(); expect(await err(fetchRest(rest({ url: `${base()}/redirect` })))).toBe(REDIRECT_MESSAGE); });
  it('le corps d’une erreur distante n’est pas renvoyé : « API REST HTTP 500. »', async () => {
    allow();
    const m = await err(fetchRest(rest({ url: `${base()}/err500` })));
    expect(m).toBe('API REST HTTP 500.');
    expect(m).not.toContain('SECRET-INTERNE');
  });
  it('une réponse non JSON n’expose pas d’extrait du corps', async () => {
    allow();
    const m = await err(fetchRest(rest({ url: `${base()}/notjson` })));
    expect(m).toContain("la réponse n'est pas un JSON valide.");
    expect(m).not.toContain('SECRET-INTERNE');
  });
  it('en-tête Host refusé explicitement : « En-tête non autorisé : Host. »', async () => {
    allow();
    expect(await err(fetchRest(rest({ headers: '{"Host":"localhost"}' })))).toBe('En-tête non autorisé : Host.');
    expect(hits).toBe(0);
  });
  it.each(['Content-Length', 'Transfer-Encoding', 'Connection', 'Upgrade', 'Proxy-Authorization', 'TE', 'Trailer', 'Keep-Alive', 'Expect'])('en-tête interdit : %s', async (h) => {
    allow();
    expect(await err(fetchRest(rest({ headers: JSON.stringify({ [h]: 'x' }) })))).toBe(`En-tête non autorisé : ${h}.`);
  });
  it('en-tête d’authentification interdit (authHeader=Host) ; valeur avec retour ligne refusée', async () => {
    allow();
    expect(await err(fetchRest(rest({ authType: 'header', authHeader: 'Host', token: 'x' })))).toBe('En-tête non autorisé : Host.');
    expect(await err(fetchRest(rest({ headers: JSON.stringify({ 'X-A': 'a\r\nHost: evil' }) })))).toMatch(/JSON invalide/);
  });
  it('délai : message « Délai dépassé » (ETIMEDOUT traduit par friendly)', async () => {
    allow();
    // timeout par défaut de 25 s trop long pour un test : on valide la traduction du code, la mécanique est couverte plus haut.
    expect(friendly(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }))).toBe('Délai dépassé : le serveur ne répond pas.');
  });
});

describe('US-3 / route /api/connectors/test, en-processus (kind SQL, Mongo, REST)', () => {
  const run = async (kind: string, cfg: Record<string, string>) => { try { await testConnector(kind, cfg); return 'OK'; } catch (e) { return friendly(e); } };

  it.each([['postgres', '5432'], ['mysql', '3306'], ['mssql', '1433']])('hôte SQL interne refusé (%s:%s) sans connexion', async (kind, p) => {
    const m = await run(kind, { host: '127.0.0.1', port: p, user: 'u', password: 'p', database: 'd' });
    expect(m).toBe(POLICY_MESSAGE);
  });

  it('hôte SQL interne refusé même sur un port où un serveur écoute réellement (0 connexion TCP)', async () => {
    let conns = 0;
    const tcp = net.createServer((s) => { conns++; s.destroy(); });
    await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
    const p = (tcp.address() as AddressInfo).port;
    for (const kind of ['postgres', 'mysql', 'mssql']) {
      expect(await run(kind, { host: '127.0.0.1', port: String(p), user: 'u', password: 'p', database: 'd' }), kind).toBe(POLICY_MESSAGE);
    }
    await new Promise<void>((r) => tcp.close(() => r()));
    expect(conns).toBe(0);
  });

  it('chaîne de connexion SQL refusée', async () => {
    // Texte exact d'E-SQL-7 (architecture.md § 6), apostrophe droite comprise (BUG-1) : aucune normalisation.
    const m = await run('postgres', { url: 'postgres://u:p@127.0.0.1/d' });
    expect(m).toBe("Chaîne de connexion non prise en charge : renseignez l'hôte, le port et les identifiants.");
  });
  it('hôte de type socket Unix refusé : « Hôte invalide. »', async () => {
    expect(await run('postgres', { host: '/var/run/postgresql', port: '5432' })).toBe('Hôte invalide.');
  });
  it('MongoDB : URI interne et options dangereuses refusées (sans DNS : IP littérales)', async () => {
    expect(await run('mongodb', { url: 'mongodb://127.0.0.1:27017/db' })).toBe(POLICY_MESSAGE);
    expect(await run('mongodb', { url: 'mongodb://127.0.0.1,10.0.0.5:27017/db' })).toBe(POLICY_MESSAGE);
    expect(await run('mongodb', { url: 'mongodb://8.8.8.8/db?proxyHost=127.0.0.1' })).toBe('Option de connexion MongoDB non autorisée (proxyHost).');
    expect(await run('mongodb', { url: 'mongodb://8.8.8.8/db?authMechanism=MONGODB-AWS' })).toBe('Option de connexion MongoDB non autorisée (authMechanism).');
    expect(await run('mongodb', { url: 'mongodb://8.8.8.8/db?tlsCAFile=/etc/passwd' })).toBe('Option de connexion MongoDB non autorisée (tlsCAFile).');
    expect(await run('mongodb', { url: 'mongodb://%2Ftmp%2Fmongodb-27017.sock/db' })).toBe('Hôte invalide.');
  });
  it('REST via test() : destination interne refusée', async () => {
    expect(await run('rest', { url: 'http://[::ffff:127.0.0.1]:3000/' })).toBe(POLICY_MESSAGE);
  });
  it('Odoo : URL interne refusée', async () => {
    expect(await run('odoo', { url: `http://127.0.0.1:${port}`, database: 'd', username: 'u', password: 'p' })).toBe(POLICY_MESSAGE);
    expect(hits).toBe(0);
  });
});

describe('US-3 / fournisseurs LLM (baseUrl)', () => {
  it('resolveBase : bases officielles constantes ; URL personnalisée marquée « custom »', () => {
    expect(resolveBase('openai', '')).toEqual({ url: 'https://api.openai.com/v1', custom: false });
    expect(resolveBase('openai', 'https://api.openai.com/v1/')).toEqual({ url: 'https://api.openai.com/v1', custom: false });
    expect(resolveBase('nvidia', 'http://localhost:8000/v1')).toEqual({ url: 'http://localhost:8000/v1', custom: true });
  });
  it('baseUrl réservée aux fournisseurs compatibles OpenAI ; message exact pour les autres (la route /api/llm/test applique ce contrôle)', () => {
    expect(BASEURL_PROVIDERS.sort()).toEqual(['deepseek', 'nvidia', 'openai']);
    for (const p of ['anthropic', 'google']) expect(BASEURL_PROVIDERS.includes(p)).toBe(false);
    expect(BASEURL_UNSUPPORTED).toBe('URL de base non prise en charge pour ce fournisseur.');
  });
  it('baseUrl http:// refusée hors liste blanche, sans connexion (message exact du Gherkin)', async () => {
    const r = await testKey('openai', 'x', 'http://proxy.exemple.com/v1');
    expect(r.ok).toBe(false);
    expect(r.message).toBe("URL de base en http:// refusée : utilisez https:// ou faites autoriser l'hôte par l'administrateur.");
  });
  it('baseUrl interne refusée (https://127.0.0.1) avec le message de politique', async () => {
    const r = await testKey('openai', 'x', `https://127.0.0.1:${port}/v1`);
    expect(r).toEqual({ ok: false, message: POLICY_MESSAGE });
    expect(hits).toBe(0);
  });
  it('liste blanche : NIM auto-hébergé joignable (/models servi par le faux serveur) ; port voisin refusé', async () => {
    allow();
    // /v1/models n'existe pas sur le faux serveur : 404 → erreur fournisseur propre, ce qui prouve que l'appel a bien été émis vers l'hôte autorisé.
    const ok = await testKey('nvidia', 'x', `${base()}/v1`);
    expect(hits).toBe(1);
    expect(ok.ok).toBe(false);
    expect(ok.message).toContain('404');
    // Port voisin : http:// hors liste blanche → refus E-LLM-2 ; en https:// → refus de politique (E-NET-1). Dans les deux cas, aucune connexion.
    expect((await testKey('nvidia', 'x', `http://127.0.0.1:${port + 1}/v1`)).message).toBe(HTTP_BASEURL_MESSAGE);
    expect((await testKey('nvidia', 'x', `https://127.0.0.1:${port + 1}/v1`)).message).toBe(POLICY_MESSAGE);
    expect(hits).toBe(1);
  });
  it('aucune fuite de cause brute pour une erreur réseau inattendue', async () => {
    allow();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const closed = await new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); });
    process.env.BI_ALLOWED_HOSTS = `127.0.0.1:${closed}`;
    const r = await testKey('nvidia', 'x', `http://127.0.0.1:${closed}/v1`);
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Réseau indisponible : fournisseur injoignable.');
    expect(r.message).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
  });
});
