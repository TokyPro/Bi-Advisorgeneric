import { NextRequest } from 'next/server';
import { countUsers, createFirstAdmin, seedFromEnv, touchLogin } from '@/server/auth/store';
import { signSession, sessionCookie, clientIp, hitLimit, releaseLimit, SETUP_MAX } from '@/server/auth/session';
import { authSecret, setupMode, setupTokenMatches } from '@/server/auth/config';
import { audit } from '@/server/auth/audit';
import { DomainError, authErrorResponse } from '@/server/auth/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Création du premier compte administrateur (S8). Ordre : limiteur, déjà initialisé (409), politique (403),
 * jeton à temps constant (403, réponse identique absent / vide / faux), validation, création atomique.
 * Chaque appel est compté d'emblée (atomique, CR-2) ; seul un jeton valide rend la tentative.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req), key = `setup|${ip}`;
  try {
    const wait = await hitLimit(key, SETUP_MAX);
    if (wait) throw new DomainError('rate_limited', undefined, { retryAfterMin: wait });
    await seedFromEnv();
    if ((await countUsers()) > 0) throw new DomainError('already_initialized');
    const mode = setupMode();
    if (mode === 'disabled') throw new DomainError('setup_disabled');
    const { email, name, password, token } = await req.json().catch(() => ({}));
    if (mode === 'token' && !setupTokenMatches(token)) {
      await audit('setup_denied', '-', '', ip); // jamais la valeur reçue
      throw new DomainError('setup_token_invalid');
    }
    await releaseLimit(key);
    authSecret(); // configuration vérifiée AVANT la création : pas de compte créé si la session ne peut pas être signée
    const created = await createFirstAdmin({ email, name, password });
    const u = await touchLogin(created.id);
    const cookie = sessionCookie(req, signSession(u.id, u.tokenVersion));
    await audit('setup_admin', u.email, '', ip);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': cookie } });
  } catch (e) { return authErrorResponse(e); }
}
