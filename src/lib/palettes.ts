/** Jeux de couleurs de l'application (appliqués via l'attribut data-palette, voir globals.css). */
export type PaletteId = 'aurora' | 'emerald' | 'ocean' | 'sunset' | 'graphite';
export const PALETTES: { id: PaletteId; label: string; hint: string; from: string; to: string; accent: string }[] = [
  { id: 'aurora', label: 'Aurore', hint: 'Violet · bleu', from: '#d983db', to: '#5f9cf1', accent: '#8b6cf0' },
  { id: 'emerald', label: 'Émeraude', hint: 'Vert · bleu', from: '#34c78c', to: '#3b8ce8', accent: '#14a082' },
  { id: 'ocean', label: 'Océan', hint: 'Bleu · cyan', from: '#38bdf8', to: '#4f6ef0', accent: '#6366f1' },
  { id: 'sunset', label: 'Coucher de soleil', hint: 'Orange · rose', from: '#ff9a5a', to: '#ec5296', accent: '#d64aa0' },
  { id: 'graphite', label: 'Graphite', hint: 'Gris · bleu acier', from: '#7882a0', to: '#465578', accent: '#5a648c' },
];
export const applyPalette = (id: PaletteId) => {
  document.documentElement.dataset.palette = id;
  try { localStorage.setItem('bia_palette', id); } catch { /* stockage indisponible */ }
};
