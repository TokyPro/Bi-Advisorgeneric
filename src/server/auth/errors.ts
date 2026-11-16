/** Erreurs typées de l'authentification et leur traduction HTTP (codes stables lus par le client, H2). */

export const AUTH_MESSAGES = {
  config: "Configuration incomplète : AUTH_SECRET est requis. Contactez l'administrateur.",
  storage: "Service d'authentification momentanément indisponible. Réessayez dans un instant.",
  setup_token_invalid: "Jeton d'initialisation invalide.",
  setup_disabled: "Initialisation non configurée. L'administrateur doit définir SETUP_TOKEN ou ADMIN_EMAIL / ADMIN_PASSWORD.",
  already_initialized: "L'application est déjà initialisée.",
  email_taken: 'Cet e-mail est déjà utilisé.',
  last_admin: 'Impossible : il doit rester au moins un administrateur actif.',
  rate_limited: 'Trop de tentatives. Réessayez dans quelques minutes.',
  not_found: 'Utilisateur introuvable.',
  invalid: 'Requête invalide.',
} as const;

export type DomainCode = Exclude<keyof typeof AUTH_MESSAGES, 'config' | 'storage'>;

const STATUS: Record<DomainCode, number> = {
  setup_token_invalid: 403, setup_disabled: 403, already_initialized: 409, email_taken: 400,
  last_admin: 400, rate_limited: 429, not_found: 400, invalid: 400,
};

/** AUTH_SECRET absent ou trop court en mode hébergé, ou configuration de stockage incohérente. */
export class AuthConfigError extends Error {
  readonly code = 'config' as const;
  constructor() { super(AUTH_MESSAGES.config); this.name = 'AuthConfigError'; }
}

/** Stockage des comptes injoignable ou pilote absent. Ne porte jamais le message d'origine (hôte, identifiants). */
export class AuthStorageError extends Error {
  readonly code = 'storage' as const;
  constructor() { super(AUTH_MESSAGES.storage); this.name = 'AuthStorageError'; }
}

/** Erreur métier : le message est destiné à l'utilisateur et ne contient aucune donnée sensible. */
export class DomainError extends Error {
  constructor(readonly code: DomainCode, message?: string, readonly extra?: Record<string, unknown>) {
    super(message ?? AUTH_MESSAGES[code]);
    this.name = 'DomainError';
  }
  get status() { return STATUS[this.code]; }
}

/** Code d'erreur technique sans détail : `err.code` (ECONNREFUSED, 28P01…) ou le nom de la classe. */
export const errCode = (e: unknown) => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(c) ? c : (e as Error | null)?.name || 'inconnu';
};

export function authErrorResponse(e: unknown): Response {
  if (e instanceof DomainError) return Response.json({ ok: false, code: e.code, error: e.message, ...e.extra }, { status: e.status });
  if (e instanceof AuthConfigError) return Response.json({ ok: false, code: e.code, error: e.message }, { status: 503 });
  if (!(e instanceof AuthStorageError)) console.error('[auth] erreur inattendue :', errCode(e));
  return Response.json({ ok: false, code: 'storage', error: AUTH_MESSAGES.storage }, { status: 503 });
}
