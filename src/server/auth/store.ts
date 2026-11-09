import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Stockage des comptes : fichier JSON (data/users.json, permissions 600) — mots de passe hachés scrypt. */
export const DATA_DIR = process.env.BI_DATA_DIR || path.join(process.cwd(), 'data');
const USERS = path.join(DATA_DIR, 'users.json');

export type Role = 'admin' | 'user';
export interface User { id: string; email: string; name: string; role: Role; hash: string; salt: string; createdAt: number; disabled?: boolean; tokenVersion: number; lastLogin?: number }
export type PublicUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'createdAt' | 'disabled' | 'lastLogin'>;

const ensureDir = () => fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
function read(): User[] { try { return JSON.parse(fs.readFileSync(USERS, 'utf8')); } catch { return []; } }
function write(u: User[]) { ensureDir(); const tmp = USERS + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(u, null, 2), { mode: 0o600 }); fs.renameSync(tmp, USERS); }

export const pub = (u: User): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, disabled: u.disabled, lastLogin: u.lastLogin });

export function hashPassword(pw: string, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex') };
}
export function checkPassword(u: User | undefined, pw: string) {
  // calcul factice si l'utilisateur n'existe pas : temps de réponse constant
  const s = u?.salt ?? 'f'.repeat(32);
  const h = Buffer.from(hashPassword(pw, s).hash, 'hex');
  const ref = Buffer.from(u?.hash ?? '0'.repeat(128), 'hex');
  return !!u && h.length === ref.length && crypto.timingSafeEqual(h, ref);
}

export function validatePassword(pw: string) {
  if (pw.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Le mot de passe doit contenir des lettres et des chiffres.';
  return null;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const listUsers = () => read();
export const countUsers = () => read().length;
export const findByEmail = (e: string) => read().find((u) => u.email === e.trim().toLowerCase());
export const findById = (id: string) => read().find((u) => u.id === id);

export function createUser(p: { email: string; name: string; role: Role; password: string }): User {
  const email = p.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error('Adresse e-mail invalide.');
  if (!p.name.trim()) throw new Error('Nom requis.');
  const bad = validatePassword(p.password); if (bad) throw new Error(bad);
  const all = read();
  if (all.some((u) => u.email === email)) throw new Error('Cet e-mail est déjà utilisé.');
  const u: User = { id: crypto.randomUUID(), email, name: p.name.trim().slice(0, 80), role: p.role === 'admin' ? 'admin' : 'user', ...hashPassword(p.password), createdAt: Date.now(), tokenVersion: 1 };
  write([...all, u]);
  return u;
}

const activeAdmins = (all: User[]) => all.filter((u) => u.role === 'admin' && !u.disabled);

export function updateUser(id: string, patch: { name?: string; role?: Role; disabled?: boolean; password?: string; lastLogin?: number }): User {
  const all = read();
  const u = all.find((x) => x.id === id);
  if (!u) throw new Error('Utilisateur introuvable.');
  const next = { ...u };
  if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 80) || u.name;
  if (patch.role) next.role = patch.role;
  if (patch.disabled !== undefined) next.disabled = patch.disabled;
  if (patch.lastLogin) next.lastLogin = patch.lastLogin;
  if (patch.password) { const bad = validatePassword(patch.password); if (bad) throw new Error(bad); Object.assign(next, hashPassword(patch.password)); }
  if (patch.password || patch.disabled || (patch.role && patch.role !== u.role)) next.tokenVersion = u.tokenVersion + 1; // invalide les sessions existantes
  const after = all.map((x) => (x.id === id ? next : x));
  if (activeAdmins(all).length && !activeAdmins(after).length) throw new Error('Impossible : il doit rester au moins un administrateur actif.');
  write(after);
  return next;
}

export function deleteUser(id: string) {
  const all = read();
  const after = all.filter((u) => u.id !== id);
  if (after.length === all.length) throw new Error('Utilisateur introuvable.');
  if (!activeAdmins(after).length) throw new Error('Impossible : il doit rester au moins un administrateur actif.');
  write(after);
}

/** Création du premier administrateur depuis l'environnement (déploiements automatisés). */
export function seedFromEnv() {
  if (countUsers() || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return;
  try { createUser({ email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME || 'Administrateur', role: 'admin', password: process.env.ADMIN_PASSWORD }); } catch (e) { console.error('[auth] ADMIN_* invalide :', (e as Error).message); }
}

let cachedSecret: string | null = null;
export function authSecret(): string {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16) return process.env.AUTH_SECRET;
  if (cachedSecret) return cachedSecret;
  const f = path.join(DATA_DIR, 'auth-secret');
  try { cachedSecret = fs.readFileSync(f, 'utf8').trim(); } catch { ensureDir(); cachedSecret = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, cachedSecret, { mode: 0o600 }); }
  return cachedSecret;
}
