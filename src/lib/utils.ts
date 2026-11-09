import { clsx, type ClassValue } from 'clsx';

export const cn = (...i: ClassValue[]) => clsx(i);
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function fmtNum(v: unknown, format: 'number' | 'currency' | 'percent' = 'number'): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return String(v ?? '');
  if (format === 'currency') return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 }).format(n);
  if (format === 'percent') return new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 }).format(n > 1.5 || n < -1.5 ? n / 100 : n);
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 }).format(n);
}

export function fmtCompact(n: number): string {
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export const download = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
