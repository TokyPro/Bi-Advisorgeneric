import { NextRequest } from 'next/server';
import { authorize } from '@/server/auth/session';
import { listUsers, createUser, updateUser, deleteUser, pub } from '@/server/auth/store';
import { audit, readAudit } from '@/server/auth/audit';
import { DomainError, authErrorResponse } from '@/server/auth/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Journal non bloquant (US-4) : sa lecture en échec ne doit pas masquer une mutation déjà appliquée.
const snapshot = async () => Response.json({ ok: true, users: (await listUsers()).map(pub), audit: await readAudit().catch(() => []) });

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'admin'); if (a instanceof Response) return a;
  try { return await snapshot(); } catch (e) { return authErrorResponse(e); }
}

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'admin'); if (a instanceof Response) return a;
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'create') { const u = await createUser(b); await audit('user_created', a.user.email, `${u.email} (${u.role})`); }
    else if (b.action === 'update') {
      if (b.id === a.user.id && (b.disabled || (b.role && b.role !== 'admin'))) throw new DomainError('invalid', 'Vous ne pouvez pas désactiver ou rétrograder votre propre compte.');
      const u = await updateUser(b.id, { name: b.name, role: b.role, disabled: b.disabled, password: b.password });
      await audit('user_updated', a.user.email, `${u.email} ${JSON.stringify({ role: b.role, disabled: b.disabled, pw: !!b.password })}`);
    } else if (b.action === 'delete') {
      if (b.id === a.user.id) throw new DomainError('invalid', 'Vous ne pouvez pas supprimer votre propre compte.');
      await deleteUser(b.id); await audit('user_deleted', a.user.email, String(b.id));
    } else throw new DomainError('invalid', 'Action inconnue.');
    return await snapshot();
  } catch (e) { return authErrorResponse(e); }
}
