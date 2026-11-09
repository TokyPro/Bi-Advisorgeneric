import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store';

const F = path.join(DATA_DIR, 'audit.log');
export function audit(event: string, actor: string, detail = '', ip = '') {
  try { fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 }); fs.appendFileSync(F, `${new Date().toISOString()}\t${event}\t${actor}\t${detail.replace(/\s+/g, ' ')}\t${ip}\n`, { mode: 0o600 }); } catch { /* journal best-effort */ }
}
export function readAudit(n = 60) {
  try { return fs.readFileSync(F, 'utf8').trim().split('\n').slice(-n).reverse().map((l) => { const [at, event, actor, detail, ip] = l.split('\t'); return { at, event, actor, detail, ip }; }); } catch { return []; }
}
