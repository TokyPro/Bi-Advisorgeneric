import type { PaletteId } from './palettes';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ChatMessage, DataSource, ModelInfo, ProviderId, Session, Widget } from './types';
import { uid } from './utils';

export interface LlmSettings {
  provider: ProviderId; model: string; customModel: string;
  /** URL de base par fournisseur (NVIDIA NIM auto-hébergé, proxy OpenAI-compatible…) */
  baseUrls: Partial<Record<ProviderId, string>>;
  temperature: number; maxTokens: number;
  /** Consignes d'administrateur ajoutées au prompt système (vocabulaire métier, devise, règles…) */
  instructions: string;
  /** Prix saisis par l'administrateur ($ / million de tokens) — clé "fournisseur:modèle" — pour l'estimation des coûts */
  pricing: Record<string, { in: number; out: number }>;
}
export const DEFAULT_LLM: LlmSettings = { provider: 'demo', model: 'demo-advisor', customModel: '', baseUrls: {}, temperature: 0.2, maxTokens: 4096, instructions: '', pricing: {} };
type KeyStatus = 'unknown' | 'testing' | 'ok' | 'error';
export type Catalog = Partial<Record<ProviderId, { models: ModelInfo[]; at: number }>>;

interface State {
  hydrated: boolean;
  onboarded: boolean;
  theme: 'light' | 'dark';
  palette: PaletteId;
  llm: LlmSettings;
  keyStatus: Partial<Record<ProviderId, KeyStatus>>;
  /** Modèles chargés dynamiquement depuis les API fournisseurs */
  catalog: Catalog;
  sources: DataSource[];
  sessions: Session[];
  activeId: string | null;
  busy: boolean;
  ui: { settings: boolean; connectors: boolean; report: boolean; sidebar: boolean; navCollapsed: boolean; canvas: boolean; tab: 'chat' | 'canvas' };

  set: (p: Partial<State>) => void;
  setUi: (p: Partial<State['ui']>) => void;
  setLlm: (p: Partial<LlmSettings>) => void;
  setKeyStatus: (p: ProviderId, s: KeyStatus) => void;
  setCatalog: (p: ProviderId, models: ModelInfo[]) => void;
  addSource: (s: DataSource) => void;
  patchSource: (id: string, p: Partial<DataSource>) => void;
  removeSource: (id: string) => void;

  newSession: () => string;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  active: () => Session | undefined;
  addMessage: (m: ChatMessage) => void;
  patchMessage: (id: string, p: Partial<ChatMessage>) => void;
  setRun: (msgId: string, idx: number, run: NonNullable<ChatMessage['runs']>[number]) => void;
  addWidget: (w: Widget) => void;
  patchWidget: (id: string, p: Partial<Widget>) => void;
  removeWidget: (id: string) => void;
  setWidgets: (w: Widget[]) => void;
}

const safeStorage = createJSONStorage(() => ({
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
}));

const touch = (s: Session): Session => ({ ...s, updatedAt: Date.now() });

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const mutateActive = (fn: (s: Session) => Session) =>
        set((st) => ({ sessions: st.sessions.map((s) => (s.id === st.activeId ? touch(fn(s)) : s)) }));
      return {
        hydrated: false, onboarded: false, theme: 'light', palette: 'aurora',
        llm: { ...DEFAULT_LLM },
        keyStatus: {}, catalog: {}, sources: [], sessions: [], activeId: null, busy: false,
        ui: { settings: false, connectors: false, report: false, sidebar: false, navCollapsed: false, canvas: true, tab: 'chat' },

        set: (p) => set(p),
        setUi: (p) => set((st) => ({ ui: { ...st.ui, ...p } })),
        setLlm: (p) => set((st) => ({ llm: { ...st.llm, ...p } })),
        setKeyStatus: (p, s) => set((st) => ({ keyStatus: { ...st.keyStatus, [p]: s } })),
        setCatalog: (p, models) => set((st) => ({ catalog: { ...st.catalog, [p]: { models, at: Date.now() } } })),
        addSource: (s) => set((st) => ({ sources: [...st.sources, s] })),
        patchSource: (id, p) => set((st) => ({ sources: st.sources.map((s) => (s.id === id ? { ...s, ...p } : s)) })),
        removeSource: (id) => set((st) => ({ sources: st.sources.filter((s) => s.id !== id) })),

        newSession: () => {
          const s: Session = { id: uid(), title: 'Nouvelle analyse', messages: [], widgets: [], createdAt: Date.now(), updatedAt: Date.now() };
          set((st) => ({ sessions: [s, ...st.sessions], activeId: s.id }));
          return s.id;
        },
        selectSession: (id) => set({ activeId: id }),
        deleteSession: (id) => set((st) => {
          const sessions = st.sessions.filter((s) => s.id !== id);
          return { sessions, activeId: st.activeId === id ? sessions[0]?.id ?? null : st.activeId };
        }),
        active: () => get().sessions.find((s) => s.id === get().activeId),
        addMessage: (m) => mutateActive((s) => ({ ...s, messages: [...s.messages, m], title: s.title === 'Nouvelle analyse' && m.role === 'user' ? m.content.slice(0, 48) : s.title })),
        patchMessage: (id, p) => mutateActive((s) => ({ ...s, messages: s.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) })),
        setRun: (msgId, idx, run) => mutateActive((s) => ({ ...s, messages: s.messages.map((m) => (m.id === msgId ? { ...m, runs: { ...(m.runs || {}), [idx]: run } } : m)) })),
        addWidget: (w) => mutateActive((s) => ({ ...s, widgets: [...s.widgets, w] })),
        patchWidget: (id, p) => mutateActive((s) => ({ ...s, widgets: s.widgets.map((w) => (w.id === id ? { ...w, ...p } : w)) })),
        removeWidget: (id) => mutateActive((s) => ({ ...s, widgets: s.widgets.filter((w) => w.id !== id) })),
        setWidgets: (widgets) => mutateActive((s) => ({ ...s, widgets })),
      };
    },
    {
      name: 'bi-advisor:state',
      version: 1,
      storage: safeStorage,
      skipHydration: true,
      merge: (persisted, current) => { const p = (persisted || {}) as Partial<State>; return { ...current, ...p, llm: { ...current.llm, ...(p.llm || {}) } }; },
      partialize: (st) => ({
        onboarded: st.onboarded, theme: st.theme, palette: st.palette, llm: st.llm, catalog: st.catalog, keyStatus: Object.fromEntries(Object.entries(st.keyStatus).map(([k, v]) => [k, v === 'testing' ? 'unknown' : v])),
        sources: st.sources.filter((s) => !s.ephemeral).map((s) => ({ ...s, status: s.status === 'syncing' ? 'active' : s.status, config: undefined })),
        sessions: st.sessions.slice(0, 30).map((s) => ({
          ...s,
          messages: s.messages.map((m) => ({ ...m, streaming: false })),
          widgets: s.widgets.map((w) => ({ ...w, rows: w.rows.slice(0, 300) })),
        })),
        activeId: st.activeId,
      }),
    },
  ),
);
