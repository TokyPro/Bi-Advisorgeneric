import type { Row } from '../types';
import { download } from '../utils';

export function exportCsv(rows: Row[], name: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
}

export async function exportXlsx(sheets: { name: string; rows: Row[] }[], file: string) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  sheets.forEach((s, i) => {
    let n = (s.name || `Feuille${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28);
    while (used.has(n)) n = n.slice(0, 25) + '_' + i;
    used.add(n);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), n);
  });
  XLSX.writeFile(wb, `${file}.xlsx`);
}

export async function exportPng(node: HTMLElement, name: string) {
  const { toPng } = await import('html-to-image');
  const bg = getComputedStyle(document.body).backgroundColor;
  const url = await toPng(node, { pixelRatio: 2, backgroundColor: bg, cacheBust: true, filter: (n) => !(n as HTMLElement).dataset?.noExport });
  const a = document.createElement('a'); a.href = url; a.download = `${name}.png`; a.click();
}

export async function exportPdf(node: HTMLElement, name: string) {
  const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const url = await toPng(node, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true, filter: (n) => !(n as HTMLElement).dataset?.noExport });
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Rendu PDF impossible')); img.src = url; });
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const ratio = W / img.width;
  const pageHpx = H / ratio;
  for (let y = 0, p = 0; y < img.height; y += pageHpx, p++) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = Math.min(pageHpx, img.height - y);
    c.getContext('2d')!.drawImage(img, 0, y, img.width, c.height, 0, 0, img.width, c.height);
    if (p) pdf.addPage();
    pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, W, c.height * ratio);
  }
  pdf.save(`${name}.pdf`);
}
