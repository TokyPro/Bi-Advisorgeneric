import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileBackend } from '@/server/auth/backends/file';
import type { User } from '@/server/auth/backends/types';
import { DomainError } from '@/server/auth/errors';

/** Backend fichier (TS-6) : tout se passe dans un dossier temporaire ; data/ n'est jamais lu ni écrit. */
let dir = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bia-file-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });

const mk = (o: Partial<User> = {}): User => ({ id: crypto.randomUUID(), email: `${crypto.randomUUID()}@ex.fr`, name: 'N', role: 'user', hash: 'h', salt: 's', createdAt: 1, tokenVersion: 1, ...o });
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof DomainError ? e.code : String(e); } };

describe('backend fichier', () => {
  it('relit un users.json existant sans migration et conserve le format', async () => {
    const legacy = [mk({ role: 'admin', email: 'admin@ex.fr', lastLogin: 5 })];
    fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify(legacy, null, 2));
    const b = createFileBackend(dir);
    expect(await b.findByEmail('admin@ex.fr')).toEqual(legacy[0]);
    await b.insert(mk({ email: 'b@ex.fr' }));
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8'));
    expect(raw).toHaveLength(2);
    expect(Object.keys(raw[1]).sort()).toEqual(['createdAt', 'email', 'hash', 'id', 'name', 'role', 'salt', 'tokenVersion']);
  });

  it('CRUD et invariant du dernier administrateur', async () => {
    const b = createFileBackend(dir);
    const admin = await b.insert(mk({ role: 'admin' }));
    const user = await b.insert(mk());
    expect(await b.count()).toBe(2);
    expect(await code(b.update(admin.id, (u) => ({ ...u, disabled: true })))).toBe('last_admin');
    expect(await code(b.remove(admin.id))).toBe('last_admin');
    await b.remove(user.id);
    expect(await code(b.remove(user.id))).toBe('not_found');
    expect(await b.list()).toHaveLength(1);
  });

  it('concurrence : une désactivation n’est pas écrasée par une connexion simultanée (S7)', async () => {
    const b = createFileBackend(dir);
    await b.insert(mk({ role: 'admin' }));
    const u = await b.insert(mk());
    await Promise.all([b.update(u.id, (x) => ({ ...x, disabled: true, tokenVersion: x.tokenVersion + 1 })), b.touchLogin(u.id, 99)]);
    const after = await b.findById(u.id);
    expect(after?.disabled).toBe(true);
    expect(after?.lastLogin).toBe(99);
  });

  it('concurrence : deux créations avec le même e-mail → une seule réussit (email_taken)', async () => {
    const b = createFileBackend(dir);
    const r = await Promise.all([code(b.insert(mk({ email: 'x@ex.fr' }))), code(b.insert(mk({ email: 'x@ex.fr' })))]);
    expect(r.sort()).toEqual(['email_taken', 'ok']);
    expect(await b.count()).toBe(1);
  });

  it('concurrence : désactivation croisée de deux admins → un admin actif subsiste (last_admin)', async () => {
    const b = createFileBackend(dir);
    const a1 = await b.insert(mk({ role: 'admin' }));
    const a2 = await b.insert(mk({ role: 'admin' }));
    const r = await Promise.all([code(b.update(a1.id, (u) => ({ ...u, disabled: true }))), code(b.update(a2.id, (u) => ({ ...u, disabled: true })))]);
    expect(r.sort()).toEqual(['last_admin', 'ok']);
    expect((await b.list()).filter((u) => u.role === 'admin' && !u.disabled)).toHaveLength(1);
  });

  it('concurrence : double initialisation → un seul admin (already_initialized)', async () => {
    const b = createFileBackend(dir);
    const r = await Promise.all([code(b.insert(mk({ role: 'admin' }), { onlyIfEmpty: true })), code(b.insert(mk({ role: 'admin' }), { onlyIfEmpty: true }))]);
    expect(r.sort()).toEqual(['already_initialized', 'ok']);
    expect(await b.count()).toBe(1);
  });

  it('limiteur : max tentatives autorisées, blocage de 10 min, levée et purge ensuite', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const b = createFileBackend(dir);
    for (let i = 0; i < 5; i++) expect(await b.attempts.hit('k', 5)).toBe(0);
    expect(await b.attempts.hit('k', 5)).toBe(10);
    vi.setSystemTime(1_000_000 + 10 * 60_000 + 1);
    expect(await b.attempts.hit('k', 5)).toBe(0); // entrée purgée, compteur reparti de zéro
    await b.attempts.clear('k');
    expect(await b.attempts.hit('k', 5)).toBe(0);
  });

  it('limiteur : release décrémente sans remettre à zéro', async () => {
    const b = createFileBackend(dir);
    for (let i = 0; i < 5; i++) await b.attempts.hit('e', 5);
    await b.attempts.release('e');
    expect(await b.attempts.hit('e', 5)).toBe(0); // 5e tentative de nouveau autorisée
    expect(await b.attempts.hit('e', 5)).toBeGreaterThan(0);
  });

  it('limiteur (CR-2) : 20 tentatives concurrentes, exactement 5 autorisées', async () => {
    const b = createFileBackend(dir);
    const r = await Promise.all(Array.from({ length: 20 }, () => b.attempts.hit('rafale', 5)));
    expect(r.filter((m) => m === 0)).toHaveLength(5);
  });

  it('journal : écrit au format TSV et relu du plus récent au plus ancien', async () => {
    const b = createFileBackend(dir);
    await b.appendAudit({ at: '2026-01-01T00:00:00.000Z', event: 'login', actor: 'a@ex.fr', detail: '', ip: '1.2.3.4' });
    await b.appendAudit({ at: '2026-01-02T00:00:00.000Z', event: 'logout', actor: 'a@ex.fr', detail: 'd', ip: '' });
    expect(fs.readFileSync(path.join(dir, 'audit.log'), 'utf8').split('\n')[0]).toBe('2026-01-01T00:00:00.000Z\tlogin\ta@ex.fr\t\t1.2.3.4');
    expect((await b.readAudit(10)).map((e) => e.event)).toEqual(['logout', 'login']);
  });
});
