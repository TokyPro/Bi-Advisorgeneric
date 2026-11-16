import { NextRequest } from 'next/server';
import { getUser, authDisabled } from '@/server/auth/session';
import { countUsers } from '@/server/auth/store';
import { authSecret, setupMode } from '@/server/auth/config';
import { authErrorResponse } from '@/server/auth/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(req: NextRequest) {
  try {
    if (authDisabled()) return Response.json({ ok: true, user: await getUser(req), needsSetup: false, authDisabled: true }, { headers: NO_STORE });
    authSecret(); // vérifiée dès le chargement : un visiteur anonyme voit l'erreur de configuration (É5a) plutôt qu'un formulaire voué à l'échec
    const user = await getUser(req);
    const needsSetup = (await countUsers()) === 0;
    // Seul l'énuméré est exposé, jamais la valeur de SETUP_TOKEN (H6).
    return Response.json({ ok: true, user, needsSetup, ...(needsSetup ? { setupMode: setupMode() } : {}), authDisabled: false }, { headers: NO_STORE });
  } catch (e) {
    const r = authErrorResponse(e);
    r.headers.set('cache-control', 'no-store');
    return r;
  }
}
