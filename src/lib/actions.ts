import { toast } from 'sonner';
import { useStore } from './store';
import type { ChatMessage, DataSource, Row, SourceKind, TableSchema, Widget } from './types';
import { uid, fmtNum } from './utils';
import { registerLocal, inferSchema, dropLocal } from './connectors/local-engine';
import { buildSalesDb, buildOdooMock, buildExcelDemo } from './connectors/demo-data';
import { runBiQuery, saveConfig, loadConfig, deleteConfig, fetchTables, schemaRemote, testRemote } from './connectors/remote';
import { buildSystemPrompt, insightsPrompt, reportPrompt } from './llm/prompts';
import { streamLLM, completeOnce, activeModelId, type LlmMessage } from './llm/client';
import { heuristicInsights } from './llm/demo-provider';
import { estCost, estTokens } from './llm/models';
import { applyPalette } from './palettes';
import { splitContent, normalizeViz } from './bi/blocks';
import { detectAnomalies } from './bi/anomaly';
import { indexDocument, removeDocument } from './bi/rag';

const st = () => useStore.getState();
let abort: AbortController | null = null;

/* ------------------------------------------------------------------ sources */
const DEMOS: { kind: SourceKind; id: string; name: string; build: () => { tables: Record<string, Row[]>; schema: TableSchema[] } }[] = [
  { kind: 'demo-sales', id: 'demo-sales', name: 'Sales DB (démo)', build: buildSalesDb },
  { kind: 'demo-odoo', id: 'demo-odoo', name: 'Odoo ERP (démo)', build: buildOdooMock },
  { kind: 'demo-excel', id: 'demo-excel', name: 'Budget.xlsx (démo)', build: buildExcelDemo },
];

export function loadDemo(kind: SourceKind, silent = false) {
  const d = DEMOS.find((x) => x.kind === kind);
  if (!d) return;
  const { tables, schema } = d.build();
  registerLocal(d.id, tables);
  if (!st().sources.some((s) => s.id === d.id)) {
    st().addSource({ id: d.id, name: d.name, kind: d.kind, status: 'active', enabled: true, engine: 'local', schema, createdAt: Date.now(), insights: heuristicInsights({ kind: d.kind, schema } as DataSource) });
    if (!silent) toast.success(`${d.name} connectée`, { description: `${schema.length} tables · prête à interroger` });
  }
}

export const SYNCED_KINDS: SourceKind[] = ['rest', 'airtable', 'notion'];
let initPromise: Promise<void> | null = null;

/** Au démarrage : réhydrate le store, reconstruit les données locales, resynchronise les sources API, installe les démos au premier lancement. */
export function initApp() {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}
async function doInit() {
  await useStore.persist.rehydrate();
  const s = st();
  for (const src of s.sources) {
    const d = DEMOS.find((x) => x.id === src.id);
    if (d) registerLocal(d.id, d.build().tables);
  }
  if (!s.sources.length && !s.onboarded) DEMOS.forEach((d) => loadDemo(d.kind, true));
  if (!st().sessions.length) st().newSession(); else if (!st().activeId) st().selectSession(st().sessions[0].id);
  document.documentElement.dataset.theme = st().theme;
  applyPalette(st().palette || 'aurora');
  useStore.setState({ hydrated: true });
  // resynchronisation en arrière-plan des sources API (REST / Airtable / Notion)
  for (const src of st().sources.filter((x) => SYNCED_KINDS.includes(x.kind))) syncSource(src.id, true);
}

/** Récupère (ou rafraîchit) les données d'une source API et les recharge dans le moteur SQL local. */
export async function syncSource(id: string, silent = false) {
  const src = st().sources.find((x) => x.id === id);
  if (!src) return false;
  st().patchSource(id, { status: 'syncing', error: undefined });
  try {
    const cfg = await loadConfig(id);
    if (!cfg) throw new Error('Identifiants introuvables dans ce navigateur : recréez la connexion.');
    const tables = await fetchTables(src.kind, cfg);
    registerLocal(id, tables);
    st().patchSource(id, { status: 'active', schema: inferSchema(tables), lastSync: Date.now() });
    if (!silent) toast.success(`${src.name} synchronisée`, { description: `${Object.keys(tables).length} table(s)` });
    return true;
  } catch (e) {
    st().patchSource(id, { status: 'error', error: (e as Error).message });
    toast.error(`Synchronisation de ${src.name} impossible`, { description: (e as Error).message });
    return false;
  }
}

/** Rafraîchit le schéma d'une source distante (SQL/Mongo/Odoo) ou resynchronise une source API. */
export async function refreshSource(id: string) {
  const src = st().sources.find((x) => x.id === id);
  if (!src) return;
  if (SYNCED_KINDS.includes(src.kind)) { await syncSource(id); return; }
  if (src.engine !== 'remote') { toast.info('Source locale : rien à rafraîchir.'); return; }
  st().patchSource(id, { status: 'syncing', error: undefined });
  try {
    const cfg = await loadConfig(id);
    if (!cfg) throw new Error('Identifiants introuvables : recréez la connexion.');
    const schema = await schemaRemote(src.kind, cfg);
    st().patchSource(id, { status: 'active', schema, lastSync: Date.now() });
    toast.success(`Schéma de ${src.name} actualisé`, { description: `${schema.length} tables/collections` });
  } catch (e) {
    st().patchSource(id, { status: 'error', error: (e as Error).message });
    toast.error('Actualisation impossible', { description: (e as Error).message });
  }
}

/** Test de connectivité d'une source enregistrée (avec ses identifiants chiffrés). */
export async function testSource(id: string): Promise<{ ok: boolean; message: string }> {
  const src = st().sources.find((x) => x.id === id);
  if (!src) return { ok: false, message: 'Source introuvable.' };
  if (src.engine === 'local' && !SYNCED_KINDS.includes(src.kind)) return { ok: true, message: `${src.schema.length} table(s) en mémoire` };
  try {
    const cfg = await loadConfig(id);
    if (!cfg) return { ok: false, message: 'Identifiants introuvables dans ce navigateur.' };
    const r = await testRemote(src.kind, cfg);
    st().patchSource(id, { status: 'active', error: undefined });
    return { ok: true, message: r.message };
  } catch (e) {
    st().patchSource(id, { status: 'error', error: (e as Error).message });
    return { ok: false, message: (e as Error).message };
  }
}

/** Connecte une source API (REST/Airtable/Notion) : données chargées localement + identifiants chiffrés pour la resynchro. */
export async function connectSynced(name: string, kind: SourceKind, config: Record<string, string>, tables: Record<string, Row[]>) {
  const id = uid();
  await saveConfig(id, config);
  registerLocal(id, tables);
  st().addSource({ id, name, kind, status: 'syncing', enabled: true, engine: 'local', schema: inferSchema(tables), createdAt: Date.now(), lastSync: Date.now(), ephemeral: false });
  toast.success(`${name} connectée`, { description: `${Object.keys(tables).length} table(s) chargée(s)` });
  await autoEda(id);
  return id;
}

export async function connectLocal(name: string, kind: SourceKind, tables: Record<string, Row[]>, opts: { text?: string; ephemeral?: boolean } = {}) {
  const id = uid();
  const schema = inferSchema(tables);
  if (Object.keys(tables).length) registerLocal(id, tables);
  if (opts.text) indexDocument(id, name, opts.text);
  const src: DataSource = { id, name, kind, status: 'syncing', enabled: true, engine: 'local', schema, createdAt: Date.now(), ephemeral: opts.ephemeral ?? true };
  st().addSource(src);
  await autoEda(id);
  return id;
}

export async function connectRemote(name: string, kind: SourceKind, config: Record<string, string>, schema: TableSchema[]) {
  const id = uid();
  await saveConfig(id, config);
  st().addSource({ id, name, kind, status: 'syncing', enabled: true, engine: 'remote', schema, createdAt: Date.now() });
  toast.success(`${name} connectée`, { description: `${schema.length} tables/collections inspectées` });
  await autoEda(id);
  return id;
}

export function disconnectSource(id: string) {
  const s = st().sources.find((x) => x.id === id);
  if (!s) return;
  dropLocal(id); removeDocument(id); deleteConfig(id);
  st().removeSource(id);
  toast(`${s.name} déconnectée`);
}

/** Auto-EDA : 3 à 5 questions stratégiques proposées dès la connexion. */
export async function autoEda(id: string) {
  const src = st().sources.find((s) => s.id === id);
  if (!src) return;
  let insights = heuristicInsights(src);
  if (st().llm.provider !== 'demo' && src.schema.length) {
    try {
      const raw = await completeOnce('Tu es un analyste BI. Tu réponds uniquement en JSON.', insightsPrompt(src), st().sources);
      const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || '[]');
      if (Array.isArray(arr) && arr.length) insights = arr.filter((x) => typeof x === 'string').slice(0, 5);
    } catch { /* repli heuristique */ }
  }
  st().patchSource(id, { status: 'active', insights });
  if (insights.length) toast.info('Auto-EDA : pistes d’analyse prêtes', { description: `${insights.length} questions suggérées pour « ${src.name} »` });
}

/* --------------------------------------------------------------------- chat */
function resultDigest(msg: ChatMessage, widgets: Widget[]): string {
  const parts = Object.values(msg.runs || {}).map((r) => {
    const w = widgets.find((x) => x.id === r.widgetId);
    if (r.status === 'error') return `- Erreur : ${r.error}`;
    if (!w) return '';
    return `- « ${w.title} » (${w.rows.length} lignes) : ${JSON.stringify(w.rows.slice(0, 8))}${w.anomalies.length ? ` | anomalies: ${w.anomalies.map((a) => a.message).join('; ')}` : ''}`;
  }).filter(Boolean);
  return parts.length ? `\n\n[Résultats d'exécution fournis par l'application]\n${parts.join('\n')}` : '';
}

export function stopGeneration() { abort?.abort(); }

export async function sendMessage(text: string, mentioned: string[] = []) {
  const q = text.trim();
  if (!q || st().busy) return;
  if (!st().activeId) st().newSession();
  const userMsg: ChatMessage = { id: uid(), role: 'user', content: q, createdAt: Date.now() };
  const { llm } = st();
  const model = activeModelId();
  const aMsg: ChatMessage = { id: uid(), role: 'assistant', content: '', createdAt: Date.now(), streaming: true, provider: llm.provider, model };
  st().addMessage(userMsg); st().addMessage(aMsg);
  useStore.setState({ busy: true });
  abort = new AbortController();

  const sess = st().active()!;
  const history: LlmMessage[] = sess.messages.filter((m) => m.id !== aMsg.id && !m.error && m.content).slice(-12)
    .map((m) => ({ role: m.role, content: m.role === 'assistant' ? m.content + resultDigest(m, sess.widgets) : m.content }));
  const extra = st().llm.instructions?.trim();
  const system = buildSystemPrompt(st().sources, { mentioned, question: q }) + (extra ? `\n\n## Consignes de l'administrateur (prioritaires)\n${extra}` : '');

  let acc = '', last = 0;
  try {
    for await (const chunk of streamLLM({ system, messages: history, sources: st().sources, signal: abort.signal })) {
      acc += chunk;
      if (Date.now() - last > 40) { st().patchMessage(aMsg.id, { content: acc }); last = Date.now(); }
    }
    const cost = estCost(llm.provider, model, estTokens(system + history.map((h) => h.content).join('')), estTokens(acc));
    st().patchMessage(aMsg.id, { content: acc, streaming: false, costUsd: cost });
    await executeBlocks(aMsg.id, acc);
  } catch (e) {
    const msg = (e as Error).message || 'Erreur inconnue';
    st().patchMessage(aMsg.id, { content: acc ? acc : `⚠️ ${msg}`, streaming: false, error: !acc });
    toast.error('Échec de la génération', { description: msg });
  } finally {
    useStore.setState({ busy: false });
    abort = null;
  }
}

export async function executeBlocks(msgId: string, content: string) {
  const segs = splitContent(content).filter((s) => s.type === 'query').slice(0, 4);
  for (const seg of segs) {
    if (seg.type !== 'query') continue;
    const t0 = performance.now();
    if (seg.parseError || !seg.query) { st().setRun(msgId, seg.index, { status: 'error', error: seg.parseError || 'Requête vide.' }); continue; }
    st().setRun(msgId, seg.index, { status: 'running' });
    try {
      const { rows, source, text } = await runBiQuery(st().sources, seg.query);
      if (!rows.length) { st().setRun(msgId, seg.index, { status: 'error', error: 'La requête n’a retourné aucune ligne.' }); continue; }
      const viz = normalizeViz(rows, seg.query.viz);
      const w: Widget = {
        id: uid(), title: viz.title || `Analyse ${st().active()!.widgets.length + 1}`, sourceId: source.id, query: text, viz, rows,
        anomalies: detectAnomalies(rows, viz), span: viz.type === 'kpi' ? 1 : 2, createdAt: Date.now(),
      };
      st().addWidget(w);
      st().setRun(msgId, seg.index, { status: 'ok', rowCount: rows.length, widgetId: w.id, ms: Math.round(performance.now() - t0) });
      if (w.anomalies.length) toast.warning(`${w.anomalies.length} anomalie(s) détectée(s)`, { description: w.anomalies[0].message });
    } catch (e) {
      const msg = (e as Error).message;
      st().setRun(msgId, seg.index, { status: 'error', error: msg });
      toast.error('Échec de la requête', { description: msg });
    }
  }
  if (segs.length && useStore.getState().ui.canvas === false) st().setUi({ canvas: true });
}

/* ------------------------------------------------------------------- rapport */
export function widgetsDigest(widgets: Widget[]): string {
  return widgets.map((w, i) => `#${i + 1} ${w.title} [${w.viz.type}] (${w.rows.length} lignes) ${JSON.stringify(w.rows.slice(0, 12))}${w.anomalies.length ? `\n   Anomalies: ${w.anomalies.map((a) => a.message).join(' ; ')}` : ''}`).join('\n');
}

function localReport(widgets: Widget[]): string {
  const lines: string[] = ['## Synthèse', `Ce bilan consolide **${widgets.length} analyse(s)** réalisées pendant la session. Il met en évidence les chiffres clés, les ruptures de tendance détectées automatiquement et les actions recommandées.`, '', '## Chiffres clés'];
  for (const w of widgets) {
    const y = w.viz.y?.[0];
    if (w.viz.type === 'kpi' && y) lines.push(`- **${w.title}** : ${fmtNum(w.rows[0][y], w.viz.format)}`);
    else if (y && w.viz.x && w.rows.length) {
      const top = [...w.rows].sort((a, b) => Number(b[y]) - Number(a[y]))[0];
      const sum = w.rows.reduce((a, r) => a + (Number(r[y]) || 0), 0);
      lines.push(`- **${w.title}** : « ${String(top[w.viz.x])} » domine avec ${fmtNum(top[y], w.viz.format)} (${sum ? Math.round((Number(top[y]) / sum) * 100) : 0} % du total affiché).`);
    }
  }
  const anos = widgets.flatMap((w) => w.anomalies.map((a) => `**${w.title}** — ${a.message}`));
  lines.push('', '## Tendances & anomalies', ...(anos.length ? anos.map((a) => `- ${a}`) : ['- Aucune anomalie statistique significative détectée.']));
  lines.push('', '## Risques', anos.length ? '- Les ruptures ci-dessus doivent être expliquées (stock, saisonnalité, erreurs de saisie) avant décision.' : '- Pas de risque majeur identifié sur les données analysées.', '', '## Recommandations', '1. Investiguer les anomalies listées et documenter leurs causes.', '2. Concentrer les efforts sur les segments qui portent la majorité de la valeur.', '3. Automatiser ce bilan chaque mois pour suivre les écarts.');
  return lines.join('\n');
}

export async function generateReport(widgets: Widget[]): Promise<string> {
  if (st().llm.provider === 'demo') return localReport(widgets);
  try { return await completeOnce('Tu es un conseiller BI senior.', reportPrompt(widgetsDigest(widgets)), st().sources); }
  catch (e) { toast.error('Rapport IA indisponible, bilan local utilisé', { description: (e as Error).message }); return localReport(widgets); }
}
