import { DomainError } from '../errors';

export type Role = 'admin' | 'user';
export interface User { id: string; email: string; name: string; role: Role; hash: string; salt: string; createdAt: number; disabled?: boolean; tokenVersion: number; lastLogin?: number }
export type PublicUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'createdAt' | 'disabled' | 'lastLogin'>;
export interface AuditEntry { at: string; event: string; actor: string; detail: string; ip: string }

/**
 * Limiteur de tentatives : `max` tentatives dans une fenêtre de 10 min, puis blocage de 10 min à partir de la max-ième.
 * La tentative est comptée AVANT la vérification du mot de passe, en une seule opération atomique : des requêtes
 * concurrentes ne peuvent pas toutes passer avec un compteur à zéro (CR-2).
 */
export interface AttemptStore {
  /** Compte une tentative ; renvoie les minutes de blocage restantes (0 : tentative autorisée). */
  hit(key: string, max: number): Promise<number>;
  /** Retire une tentative (connexion réussie) sans remettre le compteur à zéro. */
  release(key: string): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface AuthBackend {
  readonly kind: 'file' | 'postgres';
  count(): Promise<number>;
  list(): Promise<User[]>;
  findById(id: string): Promise<User | undefined>;
  findByEmail(emailNormalized: string): Promise<User | undefined>;
  /** Insère un utilisateur validé et haché. `onlyIfEmpty` : vérification et insertion dans la même section critique. */
  insert(u: User, opts?: { onlyIfEmpty?: boolean }): Promise<User>;
  /** `mutate` (pure) est appliquée à l'état relu DANS la section critique ; invariant « ≥ 1 admin actif » vérifié. */
  update(id: string, mutate: (u: User) => User): Promise<User>;
  remove(id: string): Promise<void>;
  /** Ne modifie QUE lastLogin : une désactivation concurrente n'est jamais écrasée (S7). */
  touchLogin(id: string, at: number): Promise<User>;
  attempts: AttemptStore;
  appendAudit(e: AuditEntry): Promise<void>;
  readAudit(n: number): Promise<AuditEntry[]>;
}

export const ATTEMPT_WINDOW_MS = 10 * 60_000;

export const activeAdmins = (all: User[]) => all.filter((u) => u.role === 'admin' && !u.disabled).length;

/** Invariant partagé par les deux backends, évalué sous verrou. */
export function assertAdminInvariant(before: User[], after: User[]) {
  if (activeAdmins(before) && !activeAdmins(after)) throw new DomainError('last_admin');
}
