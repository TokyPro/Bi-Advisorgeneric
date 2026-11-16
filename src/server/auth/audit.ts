import { getBackend } from './backends';
import type { AuditEntry } from './backends/types';

// Une entrée par ligne (format TSV en local) : aucune tabulation ni fin de ligne injectée (S6), taille bornée.
const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').slice(0, 200);

/**
 * Journal d'audit best-effort : n'est jamais bloquant. En cas d'échec, l'événement (sans secret) part sur console.warn,
 * visible dans les journaux de la plateforme. À attendre (`await`) : sur une fonction serverless, une promesse non
 * attendue peut être interrompue après la réponse. Ne jamais y passer mot de passe, jeton, secret ni URL de base.
 */
export async function audit(event: string, actor: string, detail = '', ip = '') {
  const e: AuditEntry = { at: new Date().toISOString(), event: norm(event), actor: norm(actor), detail: norm(detail), ip: norm(ip) };
  try { await (await getBackend()).appendAudit(e); }
  catch { console.warn(JSON.stringify({ audit: e.event, actor: e.actor, at: e.at })); }
}

export const readAudit = async (n = 60) => (await getBackend()).readAudit(n);
