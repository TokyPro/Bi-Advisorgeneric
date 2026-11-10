/**
 * Règles d'URL du Markdown produit par le LLM (C1). Module pur, sans dépendance, pour être testable par `node` directement.
 * Un `<img>` distant ou un lien porteur de données suffirait à exfiltrer le contenu d'une réponse (injection de prompt).
 */

// Les caractères de contrôle et blancs internes permettent de déguiser un schéma (`java\tscript:`) : on refuse plutôt que de nettoyer.
const hasUnsafeChar = (s: string) => [...s].some((ch) => {
  const c = ch.charCodeAt(0);
  return c <= 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
});

/** Transforme une URL de lien Markdown : renvoie l'URL si sûre, '' sinon. Les `src` (images) sont toujours vidés. */
export function safeUrlTransform(url: string, key: string): string {
  if (key !== 'href') return '';
  const u = url.trim();
  if (!u || hasUnsafeChar(u)) return '';
  if (u.startsWith('#')) return u;
  const lower = u.toLowerCase();
  if (!lower.startsWith('https://') && !lower.startsWith('mailto:')) return '';
  try {
    const parsed = new URL(u);
    if (parsed.protocol === 'https:' && parsed.hostname) return parsed.href;
    if (parsed.protocol === 'mailto:') return parsed.href;
  } catch {
    // URL non analysable : traitée comme non sûre.
  }
  return '';
}

/** Hôte affiché dans l'info-bulle ; '' si non analysable. */
export function linkHost(href: string): string {
  try {
    const u = new URL(href);
    if (u.protocol === 'mailto:') return u.pathname.split('@').pop() || '';
    return u.hostname;
  } catch {
    return '';
  }
}
