import type { Row } from '../types';
import { inferSchema, coerceTable } from './local-engine';

export interface ParsedFile {
  kind: 'file' | 'document';
  tables: Record<string, Row[]>;
  text?: string;
  warnings: string[];
}

const safeName = (s: string) => s.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'table';
const MAX_BYTES = 40 * 1024 * 1024;

export async function parseFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_BYTES) throw new Error(`Fichier trop volumineux (${(file.size / 1e6).toFixed(0)} Mo, max 40 Mo).`);
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  try {
    if (['xlsx', 'xls', 'csv'].includes(ext)) return await parseSheet(file);
    if (ext === 'pdf') return await parsePdf(file);
    if (ext === 'docx') return await parseDocx(file);
    if (['txt', 'md'].includes(ext)) return { kind: 'document', tables: {}, text: await file.text(), warnings: [] };
  } catch (e) {
    throw new Error(`Impossible de lire « ${file.name} » : ${(e as Error).message || 'fichier corrompu ?'}`);
  }
  throw new Error(`Format « .${ext} » non supporté (xlsx, xls, csv, pdf, docx, txt).`);
}

async function parseSheet(file: File): Promise<ParsedFile> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false });
  if (!wb.SheetNames.length) throw new Error('classeur vide');
  const tables: Record<string, Row[]> = {};
  const warnings: string[] = [];
  const single = wb.SheetNames.length === 1;
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sn], { defval: null, raw: true });
    if (!rows.length) { warnings.push(`Onglet « ${sn} » vide, ignoré.`); continue; }
    const clean = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().replace(/\s+/g, '_'), v])));
    let name = single ? safeName(file.name) : safeName(sn);
    while (tables[name]) name += '_2';
    tables[name] = clean;
  }
  if (!Object.keys(tables).length) throw new Error('aucune donnée exploitable');
  // typage auto + coercition
  const schema = inferSchema(tables);
  for (const s of schema) tables[s.name] = coerceTable(tables[s.name], s);
  return { kind: 'file', tables, warnings };
}

async function parseDocx(file: File): Promise<ParsedFile> {
  const mammoth = await import('mammoth');
  const buf = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  if (!value.trim()) throw new Error('document vide');
  return { kind: 'document', tables: {}, text: value, warnings: [] };
}

async function parsePdf(file: File): Promise<ParsedFile> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let text = '';
  const tables: Record<string, Row[]> = {};
  const warnings: string[] = [];
  let tcount = 0;
  for (let p = 1; p <= Math.min(doc.numPages, 150); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // regroupe par ligne (coordonnée y)
    const lines = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y)!.push({ x: it.transform[4], s: it.str.trim() });
    }
    const sorted = [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, cells]) => cells.sort((a, b) => a.x - b.x));
    text += sorted.map((c) => c.map((x) => x.s).join(' ')).join('\n') + '\n\n';
    // détection de tableaux : ≥3 lignes consécutives avec le même nombre (≥3) de cellules
    let run: string[][] = [];
    const flush = () => {
      if (run.length >= 3) {
        const [head, ...body] = run;
        const keys = head.map((h, i) => h.replace(/\W+/g, '_') || `col${i + 1}`);
        tcount++;
        tables[`table_p${p}_${tcount}`] = body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])));
      }
      run = [];
    };
    for (const cells of sorted) {
      const arr = cells.map((c) => c.s);
      if (arr.length >= 3 && (!run.length || run[0].length === arr.length)) run.push(arr); else { flush(); if (arr.length >= 3) run.push(arr); }
    }
    flush();
  }
  if (!text.trim()) throw new Error('aucun texte extractible (PDF scanné ? un OCR est nécessaire)');
  if (tcount) warnings.push(`${tcount} tableau(x) détecté(s) et converti(s) en tables interrogeables.`);
  const schema = inferSchema(tables);
  for (const s of schema) tables[s.name] = coerceTable(tables[s.name], s);
  return { kind: 'document', tables, text, warnings };
}

export const baseName = safeName;
