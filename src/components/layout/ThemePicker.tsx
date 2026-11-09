'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { useStore } from '@/lib/store';
import { PALETTES, applyPalette, type PaletteId } from '@/lib/palettes';
import { cn } from '@/lib/utils';

/** Choix du jeu de couleurs (5 palettes) et du mode clair / sombre. Popover en position fixe pour ne pas être rogné par le panneau latéral. */
export default function ThemePicker({ variant = 'row', collapsed = false }: { variant?: 'row' | 'icon'; collapsed?: boolean }) {
  const theme = useStore((s) => s.theme);
  const palette = useStore((s) => s.palette);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);

  const toggle = () => {
    const r = btn.current!.getBoundingClientRect();
    if (variant === 'icon') setPos({ left: Math.max(8, Math.min(r.right - 288, window.innerWidth - 296)), top: r.bottom + 8 });
    else setPos(collapsed ? { left: r.right + 8, bottom: window.innerHeight - r.bottom } : { left: r.left, bottom: window.innerHeight - r.top + 8 });
    setOpen(!open);
  };
  const choose = (id: PaletteId) => { set({ palette: id }); applyPalette(id); };
  const mode = (t: 'light' | 'dark') => { set({ theme: t }); document.documentElement.dataset.theme = t; };

  return (
    <>
      {variant === 'icon' ? (
        <button ref={btn} onClick={toggle} aria-label="Apparence" title="Apparence" className="rounded-xl p-2 text-muted hover:bg-surface2"><Palette size={18} /></button>
      ) : collapsed ? (
        <button ref={btn} onClick={toggle} title="Apparence" aria-label="Apparence" className="flex h-10 w-10 items-center justify-center rounded-xl text-white/70 hover:bg-white/10"><Palette size={17} /></button>
      ) : (
        <button ref={btn} onClick={toggle} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] text-white/70 hover:bg-white/10"><Palette size={16} />Apparence</button>
      )}
      {open && (
        <div ref={box} style={{ position: 'fixed', zIndex: 90, left: pos.left, top: pos.top, bottom: pos.bottom, width: 288 }} className="card p-3 shadow-soft">
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-muted">Jeu de couleurs</div>
          <div className="space-y-1">
            {PALETTES.map((p) => (
              <button key={p.id} onClick={() => choose(p.id)} className={cn('flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition', palette === p.id ? 'border-brand-violet bg-brand-violet/10' : 'border-transparent hover:bg-surface2')}>
                <span className="relative h-7 w-12 shrink-0 overflow-hidden rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,.5),0_2px_0_rgba(0,0,0,.18)]" style={{ backgroundImage: `linear-gradient(90deg, ${p.from}, ${p.to})` }}><span className="absolute bottom-0 right-0 h-3 w-3 rounded-tl-md" style={{ background: p.accent }} /></span>
                <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-fg">{p.label}</span><span className="block text-[11px] text-muted">{p.hint}</span></span>
                {palette === p.id && <Check size={15} className="text-brand-violet" />}
              </button>
            ))}
          </div>
          <div className="mb-2 mt-3 text-[10.5px] font-bold uppercase tracking-wider text-muted">Mode</div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface2 p-1">
            {([['light', 'Clair', Sun], ['dark', 'Sombre', Moon]] as const).map(([id, label, I]) => (
              <button key={id} onClick={() => mode(id)} className={cn('flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition', theme === id ? 'bg-surface text-fg shadow-sm' : 'text-muted')}><I size={13} />{label}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
