import net from 'node:net';
import dns from 'node:dns';

/**
 * Politique réseau des appels sortants pilotés par l'utilisateur (S1, anti-SSRF).
 * Module sans alias ni dépendance (exécutable par `node` directement pour les vérifications).
 * Variables : BI_NETWORK_POLICY (`public` | `allowlist`), BI_ALLOWED_HOSTS (liste blanche).
 */

export class NetworkPolicyError extends Error {
  readonly code = 'NETWORK_POLICY';
}
export const POLICY_MESSAGE = "Destination refusée par la politique réseau du serveur (adresse interne ou non autorisée). Si cette source est légitime, demandez à l'administrateur de l'ajouter à BI_ALLOWED_HOSTS.";
export const INVALID_HOST = 'Hôte invalide.';
const MONGO_URI_MESSAGE = 'URI MongoDB invalide : mongodb:// ou mongodb+srv:// attendu.';

type Family = 4 | 6;
type Subnet = [address: string, prefix: number];

// Jamais débloquables : métadonnées cloud (link-local), adresse nulle, multicast, broadcast / réservé.
const ALWAYS_V4: Subnet[] = [['0.0.0.0', 8], ['169.254.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]];
const ALWAYS_V6: Subnet[] = [['::', 128], ['fe80::', 10], ['ff00::', 8]];
const INTERNAL_V4: Subnet[] = [
  ...ALWAYS_V4, ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
];
const INTERNAL_V6: Subnet[] = [
  ...ALWAYS_V6, ['::1', 128], ['::ffff:0:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fec0::', 10],
];

function blockList(v4: Subnet[], v6: Subnet[]): net.BlockList {
  const b = new net.BlockList();
  for (const [a, p] of v4) b.addSubnet(a, p, 'ipv4');
  for (const [a, p] of v6) b.addSubnet(a, p, 'ipv6');
  return b;
}
const ALWAYS = blockList(ALWAYS_V4, ALWAYS_V6);
const INTERNAL = blockList(INTERNAL_V4, INTERNAL_V6);

/** Les 8 groupes d'une IPv6 (la forme canonique WHATWG convertit l'IPv4 pointée finale en hexadécimal). */
function v6Groups(ip: string): number[] | null {
  let canon: string;
  try { canon = new URL(`http://[${ip}]/`).hostname.slice(1, -1); } catch { return null; }
  const [head, tail] = canon.includes('::') ? canon.split('::') : [canon, undefined];
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const parts = tail === undefined ? h : [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t];
  return parts.length === 8 ? parts.map((x) => parseInt(x, 16)) : null;
}

/** Normalise une IP (crochets et zone retirés) ; une IPv4 embarquée (`::ffff:a.b.c.d`, `::a.b.c.d`) est classée comme IPv4. */
function normalizeIp(ip: string): { address: string; family: Family } | null {
  const s = ip.trim().replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(s)) return { address: s, family: 4 };
  if (!net.isIPv6(s)) return null;
  const g = v6Groups(s);
  if (!g) return null;
  const embedded = g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || (g[5] === 0 && (g[6] !== 0 || g[7] > 1)));
  if (embedded) return { address: `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`, family: 4 };
  return { address: s, family: 6 };
}

const inList = (list: net.BlockList, ip: string) => {
  const n = normalizeIp(ip);
  // Échec fermé : une adresse non analysable est traitée comme interne / interdite.
  return !n || list.check(n.address, n.family === 4 ? 'ipv4' : 'ipv6');
};
export const isAlwaysBlocked = (ip: string): boolean => inList(ALWAYS, ip);
export const isInternal = (ip: string): boolean => inList(INTERNAL, ip);

/* ------------------------------------------------------------ Configuration */
type Entry =
  | { kind: 'name'; name: string; wildcard: boolean; port?: number }
  | { kind: 'ip'; list: net.BlockList; port?: number };

const HOST_LABELS = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$/;
const parsePort = (p: string | undefined): number | undefined | null => {
  if (p === undefined) return undefined;
  const n = /^\d{1,5}$/.test(p) ? Number(p) : NaN;
  return n >= 1 && n <= 65535 ? n : null;
};

function ipEntry(addr: string, prefix: number | undefined, port: number | undefined): Entry | null {
  const n = normalizeIp(addr);
  if (!n) return null;
  const max = n.family === 4 ? 32 : 128;
  const bits = prefix ?? max;
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return null;
  const list = new net.BlockList();
  list.addSubnet(n.address, bits, n.family === 4 ? 'ipv4' : 'ipv6');
  return { kind: 'ip', list, port };
}

function parseEntry(raw: string): Entry | null {
  const e = raw.trim().toLowerCase().replace(/\.$/, '');
  if (e.includes('/')) {
    const [addr, bits] = e.split('/');
    return /^\d{1,3}$/.test(bits) ? ipEntry(addr.replace(/^\[|\]$/g, ''), Number(bits), undefined) : null;
  }
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(e);
  if (bracket) { const port = parsePort(bracket[2]); return port === null ? null : ipEntry(bracket[1], undefined, port); }
  if (net.isIPv6(e)) return ipEntry(e, undefined, undefined);
  const [host, p, extra] = e.split(':');
  const port = parsePort(p);
  if (extra !== undefined || port === null || !host) return null;
  if (net.isIPv4(host)) return ipEntry(host, undefined, port);
  const wildcard = host.startsWith('*.');
  const name = wildcard ? host.slice(2) : host;
  return HOST_LABELS.test(name) ? { kind: 'name', name, wildcard, port } : null;
}

let allowCache: { raw: string; entries: Entry[] } | null = null;
function allowEntries(): Entry[] {
  const raw = process.env.BI_ALLOWED_HOSTS || '';
  if (allowCache?.raw === raw) return allowCache.entries;
  const entries: Entry[] = [];
  raw.split(',').map((x) => x.trim()).filter(Boolean).forEach((x, i) => {
    const entry = parseEntry(x);
    if (entry) entries.push(entry);
    else console.warn(`[net] BI_ALLOWED_HOSTS : entrée n° ${i + 1} ignorée (syntaxe invalide).`);
  });
  allowCache = { raw, entries };
  return entries;
}

let warnedPolicy = '';
export function isAllowlistMode(): boolean {
  const raw = process.env.BI_NETWORK_POLICY || '';
  const v = raw.trim().toLowerCase();
  if (v === '' || v === 'public') return false;
  if (v !== 'allowlist' && warnedPolicy !== raw) {
    warnedPolicy = raw;
    console.warn('[net] BI_NETWORK_POLICY inconnue : application de la politique « allowlist ».');
  }
  return true;
}

/** Vrai si l'hôte (nom) ou l'IP (fournie ou littérale) figure dans BI_ALLOWED_HOSTS pour ce port. */
export function isAllowlisted(host: string, port: number, ip?: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const addr = normalizeIp(ip ?? h);
  return allowEntries().some((e) => {
    if (e.port !== undefined && e.port !== port) return false;
    if (e.kind === 'name') return e.wildcard ? h.endsWith(`.${e.name}`) : h === e.name;
    return !!addr && e.list.check(addr.address, addr.family === 4 ? 'ipv4' : 'ipv6');
  });
}

function addressAllowed(host: string, port: number, ip: string): boolean {
  if (isAlwaysBlocked(ip)) return false;
  if (isAllowlisted(host, port, ip)) return true;
  if (isAllowlistMode()) return false;
  return !isInternal(ip);
}

/** Contrôle sans nouvelle résolution une adresse déjà résolue pour `host` (ex. port découvert après coup). Lève NetworkPolicyError. */
export function assertAddressAllowed(host: string, port: number, ip: string): void {
  if (!addressAllowed(assertHostSyntax(host), port, ip)) throw new NetworkPolicyError(POLICY_MESSAGE);
}

/* ---------------------------------------------------------------- Contrôles */
/** Valide la syntaxe d'un hôte (nom DNS ou IP littérale, sans '/', '\\', '@', espace, '%'). Renvoie l'hôte normalisé (minuscules, sans point final, crochets IPv6 retirés). */
export function assertHostSyntax(host: string): string {
  if (typeof host !== 'string') throw new NetworkPolicyError(INVALID_HOST);
  let h = host.trim().toLowerCase();
  if (!h || /[/\\@%\s]/.test(h)) throw new NetworkPolicyError(INVALID_HOST);
  if (h.startsWith('[') || h.endsWith(']')) {
    const inner = h.replace(/^\[|\]$/g, '');
    if (!(h.startsWith('[') && h.endsWith(']')) || !net.isIPv6(inner)) throw new NetworkPolicyError(INVALID_HOST);
    return inner;
  }
  if (net.isIP(h)) return h;
  h = h.replace(/\.$/, '');
  if (!HOST_LABELS.test(h)) throw new NetworkPolicyError(INVALID_HOST);
  return h;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const defaultResolver: Resolver = (host) => dns.promises.lookup(host, { all: true, order: 'verbatim' });

/** Résout et vérifie TOUTES les adresses ; renvoie la première autorisée (préférence IPv4). Lève NetworkPolicyError(POLICY_MESSAGE). */
export async function resolveAllowed(host: string, port: number, resolver: Resolver = defaultResolver): Promise<{ address: string; family: Family }> {
  const h = assertHostSyntax(host);
  if (net.isIP(h)) {
    if (!addressAllowed(h, port, h)) throw new NetworkPolicyError(POLICY_MESSAGE);
    return { address: h, family: net.isIPv4(h) ? 4 : 6 };
  }
  // Les erreurs DNS (ENOTFOUND…) sont propagées telles quelles : elles ne révèlent rien d'interne et donnent un message utile.
  const addrs = await resolver(h);
  if (!addrs.length) throw new NetworkPolicyError(POLICY_MESSAGE);
  // Un enregistrement mixte (public + interne) est refusé en bloc.
  if (!addrs.every((a) => addressAllowed(h, port, a.address))) throw new NetworkPolicyError(POLICY_MESSAGE);
  const chosen = addrs.find((a) => net.isIPv4(a.address)) ?? addrs[0];
  return { address: chosen.address, family: net.isIPv4(chosen.address) ? 4 : 6 };
}

/** Fonction `lookup` pour http(s).request / net.connect : la socket se connecte à l'adresse vérifiée (anti DNS-rebinding). */
export function guardedLookup(port: number, resolver?: Resolver): net.LookupFunction {
  return (hostname, options, callback) => {
    resolveAllowed(hostname, port, resolver).then(
      ({ address, family }) => {
        if (options.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
      (err: NodeJS.ErrnoException) => callback(err, '', 0),
    );
  };
}

/* ------------------------------------------------------------------ MongoDB */
// MONGODB-AWS/OIDC/GSSAPI/X509 feraient utiliser au pilote les identités ou fichiers du serveur ; proxy* contournerait la garde (SOCKS5) ;
// srvServiceName ferait résoudre au pilote un autre enregistrement SRV que `_mongodb._tcp`, le seul contrôlé ici.
const MONGO_FORBIDDEN = ['proxyHost', 'proxyPort', 'proxyUsername', 'proxyPassword', 'tlsCAFile', 'tlsCertificateKeyFile', 'tlsCertificateKeyFilePassword', 'tlsCRLFile', 'authMechanismProperties', 'srvServiceName'];
const MONGO_FORBIDDEN_MECHANISMS = ['MONGODB-AWS', 'MONGODB-OIDC', 'GSSAPI', 'MONGODB-X509', 'PLAIN'];
const mongoOptionError = (name: string) => new NetworkPolicyError(`Option de connexion MongoDB non autorisée (${name}).`);

export type SrvResolver = (name: string) => Promise<{ name: string; port: number }[]>;
const defaultSrv: SrvResolver = (name) => dns.promises.resolveSrv(name);

function splitHostPort(spec: string): { host: string; port: number } {
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(spec);
  const [host, p] = bracket ? [bracket[1], bracket[2]] : spec.split(/:(?=[^:]*$)/);
  const port = parsePort(p) ?? (p === undefined ? 27017 : null);
  if (!host || port === null || (!bracket && spec.split(':').length > 2)) throw new NetworkPolicyError(INVALID_HOST);
  return { host, port };
}

/** Analyse une URI MongoDB : hôtes (multi-hôtes, IPv6, SRV), options interdites. */
export async function assertMongoUriAllowed(uri: string, resolver?: Resolver, srv: SrvResolver = defaultSrv): Promise<void> {
  const m = /^(mongodb(\+srv)?):\/\/([^/?]*)(?:\/[^?]*)?(?:\?(.*))?$/i.exec(typeof uri === 'string' ? uri.trim() : '');
  if (!m) throw new NetworkPolicyError(MONGO_URI_MESSAGE);
  const isSrv = !!m[2];
  const authority = m[3].slice(m[3].lastIndexOf('@') + 1);

  for (const pair of (m[4] || '').split('&').filter(Boolean)) {
    const [k, v = ''] = pair.split('=');
    let key: string, value: string;
    try { key = decodeURIComponent(k).trim(); value = decodeURIComponent(v).trim(); } catch { throw new NetworkPolicyError(MONGO_URI_MESSAGE); }
    const forbidden = MONGO_FORBIDDEN.find((f) => f.toLowerCase() === key.toLowerCase());
    if (forbidden) throw mongoOptionError(forbidden);
    if (key.toLowerCase() === 'authmechanism' && MONGO_FORBIDDEN_MECHANISMS.includes(value.toUpperCase())) throw mongoOptionError('authMechanism');
  }

  const specs = authority.split(',').map((s) => s.trim());
  // Socket Unix (`/tmp/x.sock` encodé en `%2F…`) : jamais autorisée.
  if (!specs.length || specs.some((s) => !s || /^(%2f|\/)/i.test(s) || /\.sock$/i.test(s))) throw new NetworkPolicyError(INVALID_HOST);

  if (isSrv) {
    if (specs.length !== 1 || specs[0].includes(':')) throw new NetworkPolicyError(INVALID_HOST);
    const name = assertHostSyntax(specs[0]);
    const targets = await srv(`_mongodb._tcp.${name}`);
    if (!targets.length) throw new NetworkPolicyError(POLICY_MESSAGE);
    for (const t of targets) await resolveAllowed(t.name, t.port, resolver);
    return;
  }
  for (const s of specs) {
    const { host, port } = splitHostPort(s);
    await resolveAllowed(host, port, resolver);
  }
}
