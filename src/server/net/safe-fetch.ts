import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { Readable, Transform, pipeline } from 'node:stream';
import { NetworkPolicyError, guardedLookup, isAllowlisted, resolveAllowed } from './policy';

/**
 * Client HTTP(S) des appels sortants pilotés par l'utilisateur (S1). Contrairement au `fetch` global, la socket se connecte
 * à l'adresse vérifiée par la politique réseau (option `lookup`), sans suivre de redirection et avec une taille plafonnée.
 * Ne journalise jamais l'URL ni les en-têtes (secrets possibles en query string / en-têtes).
 */
export interface SafeFetchInit {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Défaut 25 000 ms. Couvre connexion + en-têtes, et aussi la lecture du corps quand celui-ci est plafonné. `null` = aucun délai. */
  timeoutMs?: number | null;
  /** Défaut 20 Mo (après décompression). `null` = illimité : le corps est alors transmis en flux (LLM). */
  maxBytes?: number | null;
  /** Pour les URL de base LLM personnalisées : `http:` refusé sauf hôte en liste blanche. */
  httpsRequiredUnlessAllowlisted?: boolean;
}

export const REDIRECT_MESSAGE = "Redirection refusée : indiquez directement l'URL finale (les redirections ne sont pas suivies).";
export const BAD_URL_MESSAGE = 'Adresse invalide : seules les URL http(s) sans identifiants intégrés sont acceptées.';
export const TOO_LARGE_MESSAGE = 'Réponse trop volumineuse (limite 20 Mo).';
export const HTTP_BASEURL_MESSAGE = "URL de base en http:// refusée : utilisez https:// ou faites autoriser l'hôte par l'administrateur.";

const DEFAULT_TIMEOUT = 25_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
// En-têtes qui permettraient de détourner la requête (Host forcé, smuggling) : jamais transmis.
const DROPPED_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'proxy-authorization', 'te', 'trailer', 'keep-alive', 'expect', 'accept-encoding']);

const timeoutError = () => Object.assign(new Error('ETIMEDOUT : délai dépassé.'), { code: 'ETIMEDOUT' });

function decoder(encoding: string): Transform | null {
  const e = encoding.trim().toLowerCase();
  if (e === 'gzip' || e === 'x-gzip') return zlib.createGunzip();
  if (e === 'deflate') return zlib.createInflate();
  if (e === 'br') return zlib.createBrotliDecompress();
  return null;
}

function responseHeaders(res: http.IncomingMessage): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined || k === 'content-encoding' || k === 'content-length') continue;
    for (const item of Array.isArray(v) ? v : [v]) {
      try { h.append(k, item); } catch { /* valeur d'en-tête non conforme : ignorée plutôt que de faire échouer la réponse */ }
    }
  }
  return h;
}

export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<Response> {
  let u: URL;
  try { u = new URL(url); } catch { throw new NetworkPolicyError(BAD_URL_MESSAGE); }
  // Le parseur WHATWG normalise déjà 2130706433, 0x7f000001, 0177.0.0.1… en 127.0.0.1.
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || !u.hostname) throw new NetworkPolicyError(BAD_URL_MESSAGE);
  const secure = u.protocol === 'https:';
  const port = Number(u.port) || (secure ? 443 : 80);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (init.httpsRequiredUnlessAllowlisted && !secure && !isAllowlisted(host, port)) throw new NetworkPolicyError(HTTP_BASEURL_MESSAGE);

  // Node n'appelle pas `lookup` pour une IP littérale : contrôle direct dans ce cas.
  const literal = net.isIP(host) !== 0;
  if (literal) await resolveAllowed(host, port);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers || {})) if (!DROPPED_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  headers['accept-encoding'] = 'gzip, deflate, br';
  headers['user-agent'] = 'bi-advisor';
  if (init.body !== undefined) headers['content-length'] = String(Buffer.byteLength(init.body));

  const timeoutMs = init.timeoutMs === undefined ? DEFAULT_TIMEOUT : init.timeoutMs;
  const maxBytes = init.maxBytes === undefined ? DEFAULT_MAX_BYTES : init.maxBytes;
  const method = init.method || 'GET';

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let body: Readable | undefined;
    const stopTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const fail = (err: Error) => { stopTimer(); if (!settled) { settled = true; reject(err); } };
    const succeed = (r: Response) => { if (!settled) { settled = true; resolve(r); } };

    const onResponse = (res: http.IncomingMessage) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && status !== 304) { res.destroy(); fail(new NetworkPolicyError(REDIRECT_MESSAGE)); return; }

      const statusText = /^[\t\x20-\x7e]*$/.test(res.statusMessage || '') ? res.statusMessage || '' : '';
      const meta = { status, statusText, headers: responseHeaders(res) };
      if (status === 204 || status === 304) { res.resume(); stopTimer(); succeed(new Response(null, meta)); return; }

      // Le compteur est placé APRÈS la décompression : protège des bombes gzip/brotli.
      let total = 0;
      const limiter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          total += chunk.length;
          if (maxBytes !== null && total > maxBytes) cb(new NetworkPolicyError(TOO_LARGE_MESSAGE));
          else cb(null, chunk);
        },
      });
      const dec = decoder(String(res.headers['content-encoding'] || ''));
      const streams: NodeJS.ReadWriteStream[] = dec ? [dec, limiter] : [limiter];
      body = pipeline([res, ...streams], (err) => { if (err) fail(err); }) as unknown as Readable;

      if (maxBytes === null) {
        // Flux (LLM) : le délai ne porte que sur l'obtention des en-têtes.
        stopTimer();
        succeed(new Response(Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>, meta));
        return;
      }
      const chunks: Buffer[] = [];
      body.on('data', (c: Buffer) => chunks.push(c));
      body.on('end', () => { stopTimer(); succeed(new Response(new Uint8Array(Buffer.concat(chunks)), meta)); });
    };

    const req = (secure ? https : http).request(u, { method, headers, agent: false, lookup: literal ? undefined : guardedLookup(port) }, (res) => {
      // `new Response` lève sur un statut hors 200–599 : on ne laisse jamais une exception s'échapper du rappel.
      try { onResponse(res); } catch (e) { res.destroy(); fail(e as Error); }
    });

    if (timeoutMs !== null) {
      timer = setTimeout(() => { const e = timeoutError(); req.destroy(e); body?.destroy(e); fail(e); }, timeoutMs);
    }
    req.on('error', fail);
    req.end(init.body);
  });
}
