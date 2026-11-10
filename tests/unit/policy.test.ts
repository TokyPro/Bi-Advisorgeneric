import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVALID_HOST, NetworkPolicyError, POLICY_MESSAGE, assertAddressAllowed, assertHostSyntax, assertMongoUriAllowed,
  guardedLookup, isAllowlisted, isAlwaysBlocked, isInternal, resolveAllowed, type Resolver,
} from '@/server/net/policy';

/** US-3 : politique réseau (anti-SSRF). Aucune résolution DNS réelle : les résolveurs sont injectés. */
const GOLD = "Destination refusée par la politique réseau du serveur (adresse interne ou non autorisée). Si cette source est légitime, demandez à l'administrateur de l'ajouter à BI_ALLOWED_HOSTS.";
const fixed = (...addrs: string[]): Resolver => async () => addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

let savedHosts: string | undefined;
let savedPolicy: string | undefined;
beforeEach(() => { savedHosts = process.env.BI_ALLOWED_HOSTS; savedPolicy = process.env.BI_NETWORK_POLICY; delete process.env.BI_ALLOWED_HOSTS; delete process.env.BI_NETWORK_POLICY; });
afterEach(() => {
  if (savedHosts === undefined) delete process.env.BI_ALLOWED_HOSTS; else process.env.BI_ALLOWED_HOSTS = savedHosts;
  if (savedPolicy === undefined) delete process.env.BI_NETWORK_POLICY; else process.env.BI_NETWORK_POLICY = savedPolicy;
  vi.restoreAllMocks();
});

const refusal = async (p: Promise<unknown>) => { const e = await p.then(() => null, (x: unknown) => x); expect(e).toBeInstanceOf(NetworkPolicyError); return (e as Error).message; };

describe('message de politique', () => {
  it('est identique au Gherkin (§ 6 E-NET-1)', () => { expect(POLICY_MESSAGE).toBe(GOLD); });
});

describe('classification des adresses', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '192.168.1.1', '172.16.0.1', '172.31.255.255', '100.64.0.1', '169.254.169.254', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9',
    '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '64:ff9b::7f00:1', '64:ff9b:1::a00:1', 'fec0::1', '2001:0:4136:e378::1', '2001:db8::1', '2002:7f00:1::1',
  ])('interne : %s', (ip) => { expect(isInternal(ip)).toBe(true); });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2001:4860:4860::8888', '2606:4700::1111'])('publique : %s', (ip) => { expect(isInternal(ip)).toBe(false); });

  it('une adresse non analysable est traitée comme interne (échec fermé)', () => {
    for (const bad of ['', 'abc', '999.1.1.1', '1.2.3', 'http://x']) expect(isInternal(bad), bad).toBe(true);
  });

  it('les métadonnées cloud, adresse nulle, multicast et réservé sont « toujours bloqués »', () => {
    for (const ip of ['169.254.169.254', '169.254.0.1', '0.0.0.0', '224.0.0.1', '240.0.0.1', 'fe80::1', 'ff02::1', '::', '::ffff:169.254.169.254']) expect(isAlwaysBlocked(ip), ip).toBe(true);
    for (const ip of ['127.0.0.1', '10.0.0.1', '8.8.8.8']) expect(isAlwaysBlocked(ip), ip).toBe(false);
  });

  it('plages IPv6 ajoutées en CR-12 : internes ; adresses publiques voisines : non', () => {
    for (const [ip, internal] of [['64:ff9b:1::a00:1', true], ['fec0::1', true], ['2001:0:4136:e378::1', true], ['2001:db8::1', true], ['2001:4860:4860::8888', false], ['2606:4700::1111', false]] as const) {
      expect(isInternal(ip), ip).toBe(internal);
    }
  });
});

describe('syntaxe des hôtes', () => {
  it.each(['', '  ', '/var/run/postgresql', 'a/b', 'a\\b', 'user@host', 'a b', 'h%25x', '[::1', '::1]', '[nope]', 'bad_host!', '-x.com'])('refuse %j', (h) => {
    expect(() => assertHostSyntax(h)).toThrow(INVALID_HOST);
  });
  it('normalise (minuscules, point final, crochets IPv6)', () => {
    expect(assertHostSyntax(' Api.Exemple.COM. ')).toBe('api.exemple.com');
    expect(assertHostSyntax('[::1]')).toBe('::1');
    expect(assertHostSyntax('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('resolveAllowed (contrôle après résolution)', () => {
  it('refuse une IP littérale interne sans aucune résolution', async () => {
    const resolver = vi.fn(fixed('8.8.8.8'));
    expect(await refusal(resolveAllowed('127.0.0.1', 80, resolver))).toBe(GOLD);
    expect(resolver).not.toHaveBeenCalled();
  });
  it('accepte une IP publique littérale', async () => { expect(await resolveAllowed('8.8.8.8', 443)).toEqual({ address: '8.8.8.8', family: 4 }); });
  it('refuse un nom résolvant vers une IP interne (ex. localhost)', async () => { expect(await refusal(resolveAllowed('localhost', 80, fixed('127.0.0.1')))).toBe(GOLD); });
  it('refuse en bloc un enregistrement mixte public + interne', async () => { expect(await refusal(resolveAllowed('mixte.exemple.com', 80, fixed('8.8.8.8', '10.0.0.5')))).toBe(GOLD); });
  it('refuse une résolution vide', async () => { expect(await refusal(resolveAllowed('vide.exemple.com', 80, fixed()))).toBe(GOLD); });
  it('privilégie IPv4 quand le nom est public', async () => { expect(await resolveAllowed('x.exemple.com', 80, fixed('2606:4700::1111', '1.1.1.1'))).toEqual({ address: '1.1.1.1', family: 4 }); });
  it('propage les erreurs DNS telles quelles (ENOTFOUND) pour un message utile', async () => {
    const resolver: Resolver = async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' }); };
    const e = await resolveAllowed('inconnu.exemple.com', 80, resolver).then(() => null, (x: unknown) => x);
    expect(e).not.toBeInstanceOf(NetworkPolicyError);
    expect((e as NodeJS.ErrnoException).code).toBe('ENOTFOUND');
  });
});

describe('liste blanche BI_ALLOWED_HOSTS / mode BI_NETWORK_POLICY', () => {
  it('localhost:8000 est autorisé, le port 3000 reste refusé', async () => {
    process.env.BI_ALLOWED_HOSTS = 'localhost:8000,10.0.0.0/8';
    expect(await resolveAllowed('localhost', 8000, fixed('127.0.0.1'))).toEqual({ address: '127.0.0.1', family: 4 });
    expect(await refusal(resolveAllowed('localhost', 3000, fixed('127.0.0.1')))).toBe(GOLD);
  });
  it('un CIDR autorise tout le sous-réseau, tous ports', async () => {
    process.env.BI_ALLOWED_HOSTS = '10.0.0.0/8';
    expect((await resolveAllowed('10.1.2.3', 9999)).address).toBe('10.1.2.3');
    expect(await refusal(resolveAllowed('h.exemple.com', 80, fixed('127.0.0.1')))).toBe(GOLD);
  });
  it('les adresses de métadonnées cloud restent refusées même en liste blanche', async () => {
    process.env.BI_ALLOWED_HOSTS = '169.254.0.0/16,169.254.169.254:80,0.0.0.0/0';
    expect(await refusal(resolveAllowed('169.254.169.254', 80))).toBe(GOLD);
    expect(() => assertAddressAllowed('169.254.169.254', 80, '169.254.169.254')).toThrow(NetworkPolicyError);
  });
  it('mode allowlist : un hôte public hors liste est refusé, un hôte listé est accepté', async () => {
    process.env.BI_NETWORK_POLICY = 'allowlist';
    process.env.BI_ALLOWED_HOSTS = 'api.exemple.com';
    expect(await refusal(resolveAllowed('api.autre.com', 443, fixed('93.184.216.34')))).toBe(GOLD);
    expect((await resolveAllowed('api.exemple.com', 443, fixed('93.184.216.34'))).address).toBe('93.184.216.34');
  });
  it('valeur inconnue de BI_NETWORK_POLICY : application de « allowlist » (échec fermé)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.BI_NETWORK_POLICY = 'nimporte-quoi';
    expect(await refusal(resolveAllowed('api.autre.com', 443, fixed('93.184.216.34')))).toBe(GOLD);
  });
  it('générique *.domaine ; entrée invalide ignorée avec avertissement sans détail', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.BI_ALLOWED_HOSTS = '*.exemple.com,pas valide!,:::';
    expect(isAllowlisted('a.exemple.com', 443)).toBe(true);
    expect(isAllowlisted('exemple.com', 443)).toBe(false);
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) expect(String(call[0])).not.toMatch(/pas valide/);
  });
  it('assertAddressAllowed contrôle un port découvert après coup', () => {
    process.env.BI_ALLOWED_HOSTS = '10.0.0.5:1433';
    expect(() => assertAddressAllowed('10.0.0.5', 1433, '10.0.0.5')).not.toThrow();
    expect(() => assertAddressAllowed('10.0.0.5', 14330, '10.0.0.5')).toThrow(NetworkPolicyError);
  });
});

describe('anti DNS-rebinding : guardedLookup', () => {
  const run = (lookup: ReturnType<typeof guardedLookup>, host: string, all: boolean) =>
    new Promise<{ err: NodeJS.ErrnoException | null; res: unknown }>((resolve) => {
      (lookup as (h: string, o: object, cb: (e: NodeJS.ErrnoException | null, a?: unknown, f?: number) => void) => void)(host, { all }, (err, a, f) => resolve({ err, res: all ? a : [a, f] }));
    });

  it('la socket se connecte à l’adresse vérifiée : le résolveur n’est interrogé qu’une fois par connexion', async () => {
    // Premier appel : IP publique ; tout appel suivant : 127.0.0.1 (rebinding). Seule la première réponse doit être utilisée.
    const resolver = vi.fn<Resolver>().mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const lookup = guardedLookup(443, resolver);
    const r = await run(lookup, 'rebind.exemple.com', true);
    expect(r.err).toBeNull();
    expect(r.res).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });
  it('forme adresse simple (all=false) et forme tableau (all=true)', async () => {
    const lookup = guardedLookup(443, fixed('93.184.216.34'));
    expect((await run(lookup, 'a.exemple.com', false)).res).toEqual(['93.184.216.34', 4]);
    expect((await run(lookup, 'a.exemple.com', true)).res).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });
  it('une résolution vers une adresse interne est refusée avec le message de politique', async () => {
    const r = await run(guardedLookup(80, fixed('127.0.0.1')), 'localhost', true);
    expect(r.err).toBeInstanceOf(NetworkPolicyError);
    expect(r.err?.message).toBe(GOLD);
  });
});

describe('URI MongoDB', () => {
  const pub = fixed('93.184.216.34');
  const srv = async () => [{ name: 'shard0.exemple.com', port: 27017 }];
  const msg = (uri: string, resolver: Resolver = pub, s = srv) => refusal(assertMongoUriAllowed(uri, resolver, s));

  it('hôte interne refusé', async () => { expect(await msg('mongodb://127.0.0.1:27017/db')).toBe(GOLD); });
  it('multi-hôtes : un seul hôte interne suffit au refus', async () => {
    const resolver: Resolver = async (h) => (h === 'public.exemple.com' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: h, family: 4 }]);
    expect(await msg('mongodb://public.exemple.com,10.0.0.5:27017/db', resolver)).toBe(GOLD);
  });
  it.each([
    ['mongodb://h.exemple.com/db?proxyHost=127.0.0.1', 'Option de connexion MongoDB non autorisée (proxyHost).'],
    ['mongodb://h.exemple.com/db?authMechanism=MONGODB-AWS', 'Option de connexion MongoDB non autorisée (authMechanism).'],
    ['mongodb://h.exemple.com/db?tlsCAFile=/etc/passwd', 'Option de connexion MongoDB non autorisée (tlsCAFile).'],
    ['mongodb://h.exemple.com/db?AUTHMECHANISM=gssapi', 'Option de connexion MongoDB non autorisée (authMechanism).'],
    ['mongodb://h.exemple.com/db?authMechanismProperties=AWS_SESSION_TOKEN:x', 'Option de connexion MongoDB non autorisée (authMechanismProperties).'],
    ['mongodb+srv://c.exemple.com/db?srvServiceName=x', 'Option de connexion MongoDB non autorisée (srvServiceName).'],
    ['mongodb+srv://c.exemple.com/db?SRVSERVICENAME=x', 'Option de connexion MongoDB non autorisée (srvServiceName).'],
    ['mongodb://%2Ftmp%2Fmongodb-27017.sock/db', INVALID_HOST],
    ['mongodb:///tmp/x.sock', INVALID_HOST],
    ['http://exemple.com/db', 'URI MongoDB invalide : mongodb:// ou mongodb+srv:// attendu.'],
    ['', 'URI MongoDB invalide : mongodb:// ou mongodb+srv:// attendu.'],
  ])('refuse %s', async (uri, expected) => { expect(await msg(uri)).toBe(expected); });

  it('srvServiceName encodé en %3D : non filtré par la politique, mais rejeté par le pilote MongoDB (sans connexion)', async () => {
    const uri = 'mongodb+srv://c.exemple.com/db?srvServiceName%3Dx';
    await expect(assertMongoUriAllowed(uri, pub, srv)).resolves.toBeUndefined();
    const { MongoClient } = await import('mongodb');
    expect(() => new MongoClient(uri)).toThrow(/cannot be specified with no value/);
  });
  it('mongodb+srv : les cibles SRV sont contrôlées ; une cible interne est refusée', async () => {
    expect(await msg('mongodb+srv://c.exemple.com/db', fixed('10.0.0.9'))).toBe(GOLD);
    await expect(assertMongoUriAllowed('mongodb+srv://c.exemple.com/db', pub, srv)).resolves.toBeUndefined();
  });
  it('accepte une URI publique avec identifiants et options sûres', async () => {
    await expect(assertMongoUriAllowed('mongodb://user:pw@h.exemple.com:27017/db?retryWrites=true&tls=true', pub)).resolves.toBeUndefined();
  });
});
