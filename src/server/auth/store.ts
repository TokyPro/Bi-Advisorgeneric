import crypto from 'node:crypto';
import { getBackend } from './backends';
import type { PublicUser, Role, User } from './backends/types';
import { DomainError } from './errors';
import { hashPassword, validatePassword } from './password';

/**
 * Façade domaine des comptes (asynchrone) : validation, hachage HORS section critique, invariants délégués au backend
 * (fichier en local, PostgreSQL en hébergé — voir config.ts).
 */
export type { PublicUser, Role, User };
export { checkPassword, validatePassword } from './password';

export const pub = (u: User): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, disabled: u.disabled, lastLogin: u.lastLogin });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();

export const listUsers = async () => (await getBackend()).list();
export const countUsers = async () => (await getBackend()).count();
export const findByEmail = async (e: string) => (await getBackend()).findByEmail(normalizeEmail(e));
export const findById = async (id: string) => (await getBackend()).findById(String(id));

async function buildUser(p: { email: unknown; name: unknown; role: unknown; password: unknown }): Promise<User> {
  const email = normalizeEmail(p.email);
  const name = String(p.name ?? '').trim();
  const password = String(p.password ?? '');
  if (!EMAIL.test(email)) throw new DomainError('invalid', 'Adresse e-mail invalide.');
  if (!name) throw new DomainError('invalid', 'Nom requis.');
  const bad = validatePassword(password); if (bad) throw new DomainError('invalid', bad);
  return { id: crypto.randomUUID(), email, name: name.slice(0, 80), role: p.role === 'admin' ? 'admin' : 'user', ...(await hashPassword(password)), createdAt: Date.now(), tokenVersion: 1 };
}

export async function createUser(p: { email: unknown; name: unknown; role: unknown; password: unknown }): Promise<User> {
  const u = await buildUser(p);
  return (await getBackend()).insert(u);
}

/** Premier administrateur (setup ou seed) : atomique, le perdant d'une course reçoit `already_initialized`. */
export async function createFirstAdmin(p: { email: unknown; name: unknown; password: unknown }): Promise<User> {
  const u = await buildUser({ ...p, role: 'admin' });
  return (await getBackend()).insert(u, { onlyIfEmpty: true });
}

export async function updateUser(id: string, patch: { name?: unknown; role?: unknown; disabled?: unknown; password?: unknown }): Promise<User> {
  if (patch.role !== undefined && patch.role !== 'admin' && patch.role !== 'user') throw new DomainError('invalid', 'Rôle invalide.');
  const role = patch.role as Role | undefined;
  const name = patch.name === undefined ? undefined : String(patch.name);
  const disabled = patch.disabled === undefined ? undefined : !!patch.disabled;
  const password = patch.password ? String(patch.password) : '';
  let hashed: { hash: string; salt: string } | null = null;
  if (password) { const bad = validatePassword(password); if (bad) throw new DomainError('invalid', bad); hashed = await hashPassword(password); }
  return (await getBackend()).update(String(id), (u) => {
    const next = { ...u };
    if (name !== undefined) next.name = name.trim().slice(0, 80) || u.name;
    if (role) next.role = role;
    if (disabled !== undefined) next.disabled = disabled;
    if (hashed) Object.assign(next, hashed);
    if (hashed || disabled || (role && role !== u.role)) next.tokenVersion = u.tokenVersion + 1; // invalide les sessions existantes
    return next;
  });
}

export const deleteUser = async (id: string) => (await getBackend()).remove(String(id));
export const touchLogin = async (id: string) => (await getBackend()).touchLogin(id, Date.now());

let seeded = false;
/** Création du premier administrateur depuis l'environnement ; mémoïsé par instance pour éviter un `count` par requête. */
export async function seedFromEnv() {
  if (seeded) return;
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  if ((await countUsers()) > 0) { seeded = true; return; }
  try { await createFirstAdmin({ email: ADMIN_EMAIL, name: ADMIN_NAME || 'Administrateur', password: ADMIN_PASSWORD }); seeded = true; }
  catch (e) {
    if (!(e instanceof DomainError)) throw e;
    seeded = true; // course perdue (déjà initialisé) ou valeurs invalides : inutile de recommencer à chaque requête
    if (e.code !== 'already_initialized') console.error('[auth] ADMIN_* invalide :', e.message);
  }
}
