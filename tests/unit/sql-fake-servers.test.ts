import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POLICY_MESSAGE } from '@/server/net/policy';
import { querySql, testSql } from '@/server/connectors/sql';
import { friendly } from '@/server/connectors';

/**
 * US-3 / US-4 : connecteurs SQL Server (tedious) et MySQL (mysql2) contre de FAUX serveurs locaux (127.0.0.1).
 * Aucun SGBD réel : ces tests prouvent le comportement du CLIENT (politique réseau sur chaque socket, routage TDS,
 * SQL Browser, coupure en plein flux, arrêt de lecture au-delà de 1000 lignes, refus de LOCAL INFILE).
 * Ils ne prouvent PAS la sémantique serveur (READ ONLY, ROLLBACK, @@TRANCOUNT, statement_timeout) : voir qa-report.md (⏳).
 */
let savedHosts: string | undefined;
beforeEach(() => { savedHosts = process.env.BI_ALLOWED_HOSTS; });
afterEach(() => { if (savedHosts === undefined) delete process.env.BI_ALLOWED_HOSTS; else process.env.BI_ALLOWED_HOSTS = savedHosts; });

const listen = (srv: net.Server) => new Promise<number>((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as AddressInfo).port)));
const close = (srv: net.Server) => new Promise<void>((r) => srv.close(() => r()));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ TDS */
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const ucs = (s: string) => Buffer.from(s, 'ucs2');
const tdsPacket = (payload: Buffer) => { const h = Buffer.alloc(8); h[0] = 4; h[1] = 1; h.writeUInt16BE(8 + payload.length, 2); h[6] = 1; return Buffer.concat([h, payload]); };
const prelogin = () => { const b = Buffer.alloc(18); b[0] = 0; b.writeUInt16BE(11, 1); b.writeUInt16BE(6, 3); b[5] = 1; b.writeUInt16BE(17, 6); b.writeUInt16BE(1, 8); b[10] = 0xff; b[11] = 15; b[17] = 2; return b; };
function loginResponse(routeHost: string, routePort: number) {
  const name = 'fake';
  const la = Buffer.concat([Buffer.from([1]), Buffer.from([0x74, 0, 0, 4]), Buffer.from([name.length]), ucs(name), Buffer.from([15, 0, 0, 1])]);
  const loginack = Buffer.concat([Buffer.from([0xad]), u16(la.length), la]);
  const route = Buffer.concat([Buffer.from([0]), u16(routePort), u16(routeHost.length), ucs(routeHost)]);
  const envBody = Buffer.concat([Buffer.from([20]), u16(route.length), route, u16(0)]);
  const env = Buffer.concat([Buffer.from([0xe3]), u16(envBody.length), envBody]);
  return Buffer.concat([loginack, env, Buffer.concat([Buffer.from([0xfd]), Buffer.alloc(12)])]);
}

describe('US-3 / SQL Server : routage TDS et SQL Browser soumis à la politique réseau (CR-2, CR-11)', () => {
  let s1: net.Server; let s2: net.Server; let p1 = 0; let p2 = 0; let hits1 = 0; let hits2 = 0;
  beforeEach(async () => {
    hits1 = 0; hits2 = 0;
    // s1 : « SQL Server » qui répond à PRELOGIN puis à LOGIN7 par un jeton de routage vers s2.
    s1 = net.createServer((sock) => {
      hits1++;
      sock.on('data', (d) => {
        if (d[0] === 0x12) sock.write(tdsPacket(prelogin()));
        else if (d[0] === 0x10) sock.write(tdsPacket(loginResponse('127.0.0.1', p2)));
      });
      sock.on('error', () => undefined);
    });
    s2 = net.createServer((sock) => { hits2++; sock.destroy(); });
    p1 = await listen(s1);
    p2 = await listen(s2);
  });
  afterEach(async () => { await close(s1); await close(s2); });

  const cfg = () => ({ host: '127.0.0.1', port: String(p1), user: 'u', password: 'p', database: 'd', ssl: 'false' });
  const attempt = async (c: Record<string, string>) => { try { await testSql('mssql', c); return 'RÉSOLU (inattendu)'; } catch (e) { return friendly(e); } };

  it('A : routage vers un port non autorisé → refus de politique, 0 connexion sur la cible du routage', async () => {
    process.env.BI_ALLOWED_HOSTS = `127.0.0.1:${p1}`;
    expect(await attempt(cfg())).toBe(POLICY_MESSAGE);
    expect(hits1).toBe(1);
    expect(hits2).toBe(0);
  });

  it('B (témoin) : routage vers un port autorisé → la connexion de routage est bien ouverte via le connecteur', async () => {
    process.env.BI_ALLOWED_HOSTS = `127.0.0.1:${p1},127.0.0.1:${p2}`;
    const m = await attempt(cfg());
    expect(m).not.toBe(POLICY_MESSAGE);
    expect(hits2).toBe(1);
  });

  it('refus d’emblée : sans liste blanche, aucune des deux sockets n’est ouverte', async () => {
    delete process.env.BI_ALLOWED_HOSTS;
    expect(await attempt(cfg())).toBe(POLICY_MESSAGE);
    expect(hits1).toBe(0);
    expect(hits2).toBe(0);
  });

  describe('instance nommée : port annoncé par un faux SQL Browser (UDP 1434)', () => {
    let udp: dgram.Socket;
    beforeEach(async () => {
      udp = dgram.createSocket('udp4');
      await new Promise<void>((resolve, reject) => { udp.once('error', reject); udp.bind(1434, '127.0.0.1', () => resolve()); });
      udp.on('message', (_m, rinfo) => {
        const body = Buffer.from(`ServerName;X;InstanceName;INST;IsClustered;No;Version;15.0;tcp;${p1};;`);
        const h = Buffer.alloc(3); h[0] = 5; h.writeUInt16LE(body.length, 1);
        udp.send(Buffer.concat([h, body]), rinfo.port, rinfo.address);
      });
    });
    afterEach(() => { udp.close(); });
    const named = () => ({ ...cfg(), host: '127.0.0.1' + String.fromCharCode(92) + 'INST', port: '' });

    it('C : port annoncé hors liste blanche → refus, 0 connexion', async () => {
      process.env.BI_ALLOWED_HOSTS = '127.0.0.1:1433';
      expect(await attempt(named())).toBe(POLICY_MESSAGE);
      expect(hits1).toBe(0);
    });
    it('D (témoin) : port annoncé autorisé → connexion établie, puis routage vers un port non autorisé refusé', async () => {
      process.env.BI_ALLOWED_HOSTS = `127.0.0.1:1433,127.0.0.1:${p1}`;
      expect(await attempt(named())).toBe(POLICY_MESSAGE);
      expect(hits1).toBe(1);
      expect(hits2).toBe(0);
    });
  });
});

/* ---------------------------------------------------------------- MySQL */
const pk = (seq: number, body: Buffer) => { const h = Buffer.alloc(4); h.writeUIntLE(body.length, 0, 3); h[3] = seq; return Buffer.concat([h, body]); };
const lenStr = (s: string) => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)]);
const ok = (seq: number) => pk(seq, Buffer.from([0, 0, 0, 2, 0, 0, 0]));
const eof = (seq: number) => pk(seq, Buffer.from([0xfe, 0, 0, 2, 0]));
const colDef = (seq: number, name: string) => pk(seq, Buffer.concat([lenStr('def'), lenStr(''), lenStr(''), lenStr(''), lenStr(name), lenStr(''), Buffer.from([0x0c, 0x21, 0, 0, 1, 0, 0, 0xfd, 0, 0, 0, 0, 0])]));
function handshake() {
  const caps = 0x1 | 0x8 | 0x200 | 0x2000 | 0x8000 | 0x80000 | 0x80; // 0x80 = CLIENT_LOCAL_FILES annoncé par le serveur
  return pk(0, Buffer.concat([
    Buffer.from([10]), Buffer.from('8.0.0\0'), Buffer.from([1, 0, 0, 0]), Buffer.from('abcdefgh'), Buffer.from([0]),
    Buffer.from([caps & 0xff, (caps >> 8) & 0xff, 0x21, 2, 0, (caps >> 16) & 0xff, (caps >> 24) & 0xff, 21]), Buffer.alloc(10),
    Buffer.from('ijklmnopqrst\0'), Buffer.from('mysql_native_password\0'),
  ]));
}

type Mode = 'cut' | 'flood' | 'infile';
describe('US-4 / MySQL : comportement du client contre un faux serveur', () => {
  let server: net.Server; let port = 0; let mode: Mode = 'cut';
  let rowsSent = 0; let infileAsked = 0; let received = Buffer.alloc(0); let sockets: net.Socket[] = [];
  const secret = `SECRET-FICHIER-LOCAL-${process.pid}`;
  let secretFile = '';

  beforeEach(async () => {
    rowsSent = 0; infileAsked = 0; received = Buffer.alloc(0); sockets = []; mode = 'cut';
    secretFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bia-qa-infile-')), 'secret.txt');
    fs.writeFileSync(secretFile, secret);
    server = net.createServer((sock) => {
      sockets.push(sock);
      sock.on('error', () => undefined);
      sock.write(handshake());
      let authed = false;
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        received = Buffer.concat([received, d]);
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 4) {
          const len = buf.readUIntLE(0, 3);
          if (buf.length < 4 + len) return;
          const body = buf.subarray(4, 4 + len);
          buf = buf.subarray(4 + len);
          if (!authed) { authed = true; sock.write(ok(2)); continue; }
          const q = body.subarray(1).toString();
          if (/DATABASE\(\)/.test(q)) { sock.write(Buffer.concat([pk(1, Buffer.from([1])), colDef(2, 'db'), eof(3), pk(4, lenStr('d')), eof(5)])); continue; }
          if (/FROM t\b/.test(q)) {
            if (mode === 'infile') { infileAsked++; sock.write(pk(1, Buffer.concat([Buffer.from([0xfb]), Buffer.from(secretFile)]))); continue; }
            sock.write(Buffer.concat([pk(1, Buffer.from([1])), colDef(2, 'a'), eof(3)]));
            let seq = 4;
            if (mode === 'cut') { sock.write(pk(seq++, lenStr('x'))); setTimeout(() => sock.destroy(), 50); continue; }
            const pump = () => {
              if (sock.destroyed || !sock.writable) return;
              for (let k = 0; k < 500; k++) { sock.write(pk(seq & 0xff, lenStr('y'))); seq++; rowsSent++; }
              if (rowsSent < 200_000) setImmediate(pump);
            };
            pump();
            continue;
          }
          sock.write(ok(1));
        }
      });
    });
    port = await listen(server);
    process.env.BI_ALLOWED_HOSTS = `127.0.0.1:${port}`;
  });
  afterEach(async () => { sockets.forEach((s) => s.destroy()); await close(server); fs.rmSync(path.dirname(secretFile), { recursive: true, force: true }); });

  const cfg = () => ({ host: '127.0.0.1', port: String(port), user: 'u', password: 'p', database: 'd' });

  it('CR-3 : coupure de connexion en plein résultat → rejet propre, aucune exception non interceptée, processus vivant', async () => {
    const uncaught: Error[] = [];
    const onUncaught = (e: Error) => uncaught.push(e);
    process.on('uncaughtException', onUncaught);
    try {
      mode = 'cut';
      const e = await querySql('mysql', cfg(), 'SELECT a FROM t').then(() => null, (x: unknown) => x as Error);
      expect(e).toBeInstanceOf(Error);
      expect(e?.message).toMatch(/Connection lost|closed the connection|ECONNRESET/i);
      await wait(300);
      expect(uncaught).toEqual([]);
    } finally { process.off('uncaughtException', onUncaught); }
  });

  it('CR-9 : flux continu → exactement 1000 lignes renvoyées, la socket est fermée et le serveur cesse d’émettre', async () => {
    mode = 'flood';
    const rows = await querySql('mysql', cfg(), 'SELECT a FROM t LIMIT 500000');
    expect(rows).toHaveLength(1000);
    await wait(300);
    const settled = rowsSent;
    await wait(1200);
    expect(rowsSent, 'le serveur doit avoir cessé d’émettre après la fermeture').toBe(settled);
    expect(settled).toBeLessThan(200_000);
  });

  it('LOCAL INFILE : un serveur qui réclame un fichier local ne reçoit jamais son contenu', async () => {
    mode = 'infile';
    const e = await querySql('mysql', cfg(), 'SELECT a FROM t').then(() => null, (x: unknown) => x as Error);
    await wait(300);
    expect(infileAsked, 'le faux serveur a bien émis la demande LOCAL INFILE').toBe(1);
    expect(received.toString('latin1')).not.toContain(secret);
    expect(e === null || e instanceof Error).toBe(true);
  });

  it('mode lecture seule demandé avant la requête utilisateur (SET SESSION TRANSACTION READ ONLY, START TRANSACTION READ ONLY, max_execution_time)', async () => {
    mode = 'cut';
    await querySql('mysql', cfg(), 'SELECT a FROM t').catch(() => undefined);
    const wire = received.toString('latin1');
    const iRo = wire.indexOf('SET SESSION TRANSACTION READ ONLY');
    const iTx = wire.indexOf('START TRANSACTION READ ONLY');
    const iUser = wire.indexOf('SELECT a FROM t');
    expect(iRo).toBeGreaterThan(-1);
    expect(iTx).toBeGreaterThan(iRo);
    expect(wire).toContain('max_execution_time');
    expect(wire).toContain('sql_select_limit = 1001');
    expect(iUser).toBeGreaterThan(iTx);
  });

  it('une requête d’écriture n’atteint jamais le serveur (refus avant exécution)', async () => {
    await expect(querySql('mysql', cfg(), 'DELETE FROM t')).rejects.toThrow();
    await expect(querySql('mysql', cfg(), "SELECT * FROM t INTO DUMPFILE '/tmp/x'")).rejects.toThrow();
    expect(received.length).toBe(0); // aucune connexion ouverte : la garde refuse avant tout accès réseau
    expect(sockets).toHaveLength(0);
  });
});
