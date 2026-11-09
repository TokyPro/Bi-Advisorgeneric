import type { DataSource } from '../types';
import { getLocalTables } from '../connectors/local-engine';
import { retrieve } from '../bi/rag';

const dialect: Record<string, string> = {
  'demo-sales': 'alasql', 'demo-odoo': 'alasql', 'demo-excel': 'alasql', file: 'alasql', gsheets: 'alasql', document: 'alasql',
  rest: 'alasql', airtable: 'alasql', notion: 'alasql', postgres: 'PostgreSQL', mysql: 'MySQL', mssql: 'SQL Server (T-SQL, TOP n au lieu de LIMIT)', sqlite: 'SQLite',
};

export function schemaText(s: DataSource, mentioned: string[] = []): string {
  const header = `### Source « ${s.name} » (id: ${s.id}, type: ${s.kind}${s.engine === 'local' ? `, dialecte SQL: ${dialect[s.kind]}` : s.kind === 'odoo' ? ', requêtes: type "odoo"' : s.kind === 'mongodb' ? ', requêtes: type "mongo"' : `, dialecte SQL: ${dialect[s.kind]}`})`;
  const tables = s.schema.slice(0, 60).map((t) => {
    const cols = t.columns.slice(0, 50).map((c) => `${c.name}:${c.type}${c.fk ? `→${c.fk}` : ''}`).join(', ');
    let line = `- ${t.name}${t.rowCount != null ? ` (${t.rowCount} lignes)` : ''}${t.description ? ` — ${t.description}` : ''}: ${cols}`;
    if (mentioned.includes(`${s.name}.${t.name}`) || mentioned.includes(t.name)) {
      const sample = getLocalTables(s.id)?.[t.name]?.slice(0, 3);
      if (sample?.length) line += `\n  Exemple: ${JSON.stringify(sample)}`;
    }
    return line;
  });
  return [header, ...tables].join('\n');
}

export function buildSystemPrompt(sources: DataSource[], opts: { mentioned?: string[]; question?: string } = {}): string {
  const active = sources.filter((s) => s.enabled && s.status !== 'error');
  const queryable = active.filter((s) => s.kind !== 'document' || s.schema.length);
  const docs = active.filter((s) => s.kind === 'document');
  const rag = docs.length && opts.question ? retrieve(opts.question, 4, docs.map((d) => d.id)) : [];

  return `Tu es BI Advisor, un conseiller expert en Business Intelligence et Analytics. Tu réponds dans la langue de l'utilisateur (français par défaut), de façon claire, structurée et orientée décision.

## Sources de données connectées
${queryable.length ? queryable.map((s) => schemaText(s, opts.mentioned)).join('\n\n') : '(aucune source interrogeable connectée — invite l\'utilisateur à en connecter une ou à utiliser les données de démonstration)'}
${rag.length ? `\n## Extraits de documents pertinents (RAG)\n${rag.map((c) => `[${c.docName}] ${c.text}`).join('\n---\n')}\n` : ''}
## Comment interroger les données
Pour exécuter une requête ET afficher un graphique, émets un bloc de code de langage \`bi-query\` contenant UN objet JSON valide (une requête par bloc, 4 blocs maximum par réponse) :

\`\`\`bi-query
{"source":"<id de la source>","type":"sql","sql":"SELECT ...","viz":{"type":"bar","x":"colonne_x","y":["colonne_valeur"],"title":"Titre court","format":"currency"}}
\`\`\`

- type "sql" : champ "sql" (SELECT uniquement, jamais de modification). Alias explicites pour toutes les colonnes calculées. LIMIT/TOP ≤ 200 lignes. Trie les séries temporelles par date croissante.
- Dialecte alasql (sources locales/fichiers/démo) : mois = SUBSTRING(date,1,7) ; pas de strftime/date_trunc/FILTER ; JOIN, GROUP BY, HAVING, CASE, ROUND, SUM, AVG, COUNT, MIN, MAX supportés ; entoure d'accents graves les noms avec espaces.
- type "odoo" : champ "odoo": {"model":"sale.order","domain":[["state","in",["sale","done"]]],"fields":["amount_total:sum"],"groupby":["date_order:month"],"method":"read_group"} (ou "search_read" avec "fields" simples, "order", "limit").
- type "mongo" : champ "mongo": {"collection":"orders","pipeline":[{"$group":{...}}]}.
- viz.type ∈ bar | line | area | pie | kpi | table | pivot. "x" = colonne catégorie/date ; "y" = colonnes numériques ; kpi = une seule ligne, y[0] = valeur ; pivot = x (lignes), "series" (colonnes), y[0] (valeur) ; "format" ∈ number | currency | percent ; line/area pour le temps, bar pour comparer, pie pour une répartition (≤ 8 parts).
- Avant le bloc, explique en une phrase ce que tu mesures ; après le bloc (les résultats sont calculés par l'application), n'invente JAMAIS de chiffres : commente uniquement ce que l'utilisateur verra, ou propose des pistes d'analyse. Les résultats réels te sont renvoyés au tour suivant.
- Le texte hors bloc est en Markdown (listes courtes, gras pour les points clés). Termine par 2 questions de suivi pertinentes sous le titre "**Pour aller plus loin**".
- Si une question est ambiguë ou si une colonne n'existe pas, dis-le et propose l'alternative la plus proche plutôt que d'inventer.
- Signale les anomalies (baisses/pics inhabituels, doublons, montants négatifs, valeurs manquantes) quand tu les vois.`;
}

export const insightsPrompt = (s: DataSource) => `${schemaText(s)}

Propose 4 questions stratégiques clés (analyses de tendance, marge, concentration, anomalies) qu'un dirigeant poserait sur ces données. Réponds UNIQUEMENT par un tableau JSON de chaînes en français, sans texte autour. Chaque question doit être réalisable avec les colonnes ci-dessus.`;

export const reportPrompt = (digest: string) => `Rédige un BILAN STRATÉGIQUE exécutif en français, en Markdown, à partir des analyses suivantes (données réelles calculées par l'application). Structure : "## Synthèse" (3-4 phrases), "## Chiffres clés", "## Tendances & anomalies", "## Risques", "## Recommandations" (3 actions priorisées). N'invente aucun chiffre absent des données.

${digest}`;
