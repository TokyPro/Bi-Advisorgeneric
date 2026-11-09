import { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DRIVERS: [string, string][] = [['pg', 'PostgreSQL'], ['mysql2', 'MySQL'], ['mssql', 'SQL Server'], ['better-sqlite3', 'SQLite'], ['mongodb', 'MongoDB']];

export async function GET(req: NextRequest) {
  const a = requireAuth(req, 'admin'); if (a instanceof Response) return a;
  const drivers = await Promise.all(DRIVERS.map(async ([pkg, label]) => {
    try { await import(/* webpackIgnore: true */ pkg); return { pkg, label, ok: true }; }
    catch (e) { return { pkg, label, ok: false, error: (e as Error).message.split('\n')[0].slice(0, 140) }; }
  }));
  return Response.json({ node: process.version, platform: process.platform, uptime: Math.round(process.uptime()), drivers });
}
