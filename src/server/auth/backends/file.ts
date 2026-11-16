import fs from 'node:fs';
import path from 'node:path';
import { DomainError } from '../errors';
import { ATTEMPT_WINDOW_MS, activeAdmins, assertAdminInvariant, type AuditEntry, type AuthBackend, type User } from './types';

/**
 * Backend fichier (mode local) : format de data/users.json et de audit.log identique à la v1, aucune migration.
 * Un mutex en processus encadre relecture + écriture : corrige S7 dans un même processus
 * (plusieurs processus sur le même dossier ne sont pas supportés, comme avant).
 */
export function createFileBackend(dir: string): AuthBackend {
  const USERS = path.join(dir, 'users.json');
  const AUDIT = path.join(dir, 'audit.log');
  const ensureDir = () => fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const read = (): User[] => { try { return JSON.parse(fs.readFileSync(USERS, 'utf8')); } catch { return []; } };
  const write = (u: User[]) => { ensureDir(); const tmp = USERS + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(u, null, 2), { mode: 0o600 }); fs.renameSync(tmp, USERS); };

  let chain: Promise<unknown> = Promise.resolve();
  const locked = <T>(fn: () => T): Promise<T> => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };

  const fails = new Map<string, { n: number; until: number }>();
  const purge = (now: number) => { for (const [k, f] of fails) if (f.until <= now) fails.delete(k); };

  return {
    kind: 'file',
    count: async () => read().length,
    list: async () => read(),
    findById: async (id) => read().find((u) => u.id === id),
    findByEmail: async (email) => read().find((u) => u.email === email),

    insert: (u, opts) => locked(() => {
      const all = read();
      if (opts?.onlyIfEmpty && all.length) throw new DomainError('already_initialized');
      if (all.some((x) => x.email === u.email)) throw new DomainError('email_taken');
      write([...all, u]);
      return u;
    }),

    update: (id, mutate) => locked(() => {
      const all = read();
      const u = all.find((x) => x.id === id);
      if (!u) throw new DomainError('not_found');
      const next = mutate({ ...u });
      const after = all.map((x) => (x.id === id ? next : x));
      assertAdminInvariant(all, after);
      write(after);
      return next;
    }),

    remove: (id) => locked(() => {
      const all = read();
      const after = all.filter((u) => u.id !== id);
      if (after.length === all.length) throw new DomainError('not_found');
      if (!activeAdmins(after)) throw new DomainError('last_admin');
      write(after);
    }),

    touchLogin: (id, at) => locked(() => {
      const all = read();
      const u = all.find((x) => x.id === id);
      if (!u) throw new DomainError('not_found');
      u.lastLogin = at;
      write(all);
      return u;
    }),

    // Lecture et incrément synchrones : atomiques dans le processus, quelle que soit la concurrence des requêtes.
    attempts: {
      async hit(key, max) {
        const now = Date.now(); purge(now);
        const f = fails.get(key) ?? { n: 0, until: now + ATTEMPT_WINDOW_MS };
        f.n++;
        if (f.n === max) f.until = now + ATTEMPT_WINDOW_MS; // blocage de 10 min à partir de la max-ième tentative
        fails.set(key, f);
        return f.n > max ? Math.ceil((f.until - now) / 60_000) : 0;
      },
      async release(key) { const f = fails.get(key); if (f) f.n = Math.max(0, f.n - 1); },
      async clear(key) { fails.delete(key); },
    },

    // Erreurs propagées : audit() se charge du repli console (le journal n'est jamais bloquant).
    async appendAudit(e: AuditEntry) {
      ensureDir();
      fs.appendFileSync(AUDIT, `${e.at}\t${e.event}\t${e.actor}\t${e.detail}\t${e.ip}\n`, { mode: 0o600 });
    },
    async readAudit(n) {
      try {
        return fs.readFileSync(AUDIT, 'utf8').trim().split('\n').slice(-n).reverse()
          .map((l) => { const [at, event, actor, detail, ip] = l.split('\t'); return { at, event, actor, detail, ip }; });
      } catch { return []; }
    },
  };
}
