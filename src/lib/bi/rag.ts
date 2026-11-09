/**
 * RAG temporaire 100 % local : découpage en chunks + embeddings "hashing trick" (256 dim) + cosinus.
 * Aucun appel réseau, rien n'est persisté : l'index vit en mémoire le temps de la session.
 */
const DIM = 256;
const STOP = new Set('le la les de des du un une et en au aux ce ces que qui pour par sur dans avec est sont the of and to in a is for on'.split(' '));

export interface Chunk { id: string; docId: string; docName: string; text: string; vec: Float32Array }
const index: Chunk[] = [];

function tokens(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function embed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  const t = tokens(text);
  for (let i = 0; i < t.length; i++) {
    v[hash(t[i]) % DIM] += 1;
    if (i < t.length - 1) v[hash(t[i] + '_' + t[i + 1]) % DIM] += 0.5;
  }
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= n;
  return v;
}

export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\s+\n/g, '\n').trim();
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += size - overlap) out.push(clean.slice(i, i + size));
  return out;
}

export function indexDocument(docId: string, docName: string, text: string) {
  removeDocument(docId);
  chunkText(text).forEach((t, i) => index.push({ id: `${docId}:${i}`, docId, docName, text: t, vec: embed(t) }));
}
export const removeDocument = (docId: string) => { for (let i = index.length - 1; i >= 0; i--) if (index[i].docId === docId) index.splice(i, 1); };
export const hasDocuments = () => index.length > 0;

export function retrieve(query: string, k = 4, docIds?: string[]): Chunk[] {
  const q = embed(query);
  return index
    .filter((c) => !docIds || docIds.includes(c.docId))
    .map((c) => { let s = 0; for (let i = 0; i < DIM; i++) s += q[i] * c.vec[i]; return { c, s }; })
    .filter((x) => x.s > 0.05)
    .sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.c);
}
