'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export function Modal({ open, onClose, title, subtitle, children, wide }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ y: 24, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 16, opacity: 0 }} transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className={cn('card relative flex max-h-[88vh] w-full flex-col overflow-hidden shadow-soft', wide ? 'max-w-4xl' : 'max-w-xl')}>
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
              <div><h2 className="text-lg font-bold">{title}</h2>{subtitle && <p className="text-sm text-muted">{subtitle}</p>}</div>
              <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 text-muted hover:bg-surface2"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Drawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-sm" onClick={onClose} />
          <motion.aside initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }} transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col border-l border-line bg-surface shadow-soft">
            <div className="flex items-start justify-between border-b border-line px-6 py-4">
              <div><h2 className="text-lg font-bold">{title}</h2>{subtitle && <p className="text-sm text-muted">{subtitle}</p>}</div>
              <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 text-muted hover:bg-surface2"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Spinner({ size = 16 }: { size?: number }) { return <Loader2 size={size} className="animate-spin" />; }

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm outline-none transition focus:border-brand-violet focus:ring-2 focus:ring-brand-violet/20 placeholder:text-muted/60';

export function Dot({ status }: { status: 'ok' | 'error' | 'testing' | 'unknown' | 'active' | 'syncing' }) {
  const c = status === 'ok' || status === 'active' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : status === 'testing' || status === 'syncing' ? 'bg-amber-400 animate-pulseDot' : 'bg-slate-300';
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', c)} />;
}
