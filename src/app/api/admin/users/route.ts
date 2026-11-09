import { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/session';
import { listUsers, createUser, updateUser, deleteUser, pub } from '@/server/auth/store';
import { audit, readAudit } from '@/server/auth/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const a = requireAuth(req, 'admin'); if (a instanceof Response) return a;
  return Response.json({ ok: true, users: listUsers().map(pub), audit: readAudit() });
}

export async function POST(req: NextRequest) {
  const a = requireAuth(req, 'admin'); if (a instanceof Response) return a;
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'create') { const u = createUser(b); audit('user_created', a.user.email, `${u.email} (${u.role})`); }
    else if (b.action === 'update') {
      if (b.id === a.user.id && (b.disabled || (b.role && b.role !== 'admin'))) throw new Error('Vous ne pouvez pas désactiver ou rétrograder votre propre compte.');
      const u = updateUser(b.id, { name: b.name, role: b.role, disabled: b.disabled, password: b.password });
      audit('user_updated', a.user.email, `${u.email} ${JSON.stringify({ role: b.role, disabled: b.disabled, pw: !!b.password })}`);
    } else if (b.action === 'delete') {
      if (b.id === a.user.id) throw new Error('Vous ne pouvez pas supprimer votre propre compte.');
      deleteUser(b.id); audit('user_deleted', a.user.email, b.id);
    } else throw new Error('Action inconnue.');
    return Response.json({ ok: true, users: listUsers().map(pub), audit: readAudit() });
  } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 400 }); }
}
