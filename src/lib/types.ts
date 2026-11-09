export type ProviderId = 'demo' | 'anthropic' | 'openai' | 'google' | 'deepseek' | 'nvidia';

export type SourceKind =
  | 'demo-sales' | 'demo-odoo' | 'demo-excel'
  | 'postgres' | 'mysql' | 'mssql' | 'sqlite' | 'mongodb'
  | 'odoo' | 'gsheets' | 'rest' | 'airtable' | 'notion' | 'file' | 'document';

export interface ColumnSchema { name: string; type: string; fk?: string }
export interface TableSchema { name: string; columns: ColumnSchema[]; rowCount?: number; description?: string }

export interface DataSource {
  id: string;
  name: string;
  kind: SourceKind;
  status: 'active' | 'syncing' | 'error';
  enabled: boolean;
  schema: TableSchema[];
  /** 'local' = données en mémoire navigateur (alasql). 'remote' = via /api/connectors */
  engine: 'local' | 'remote';
  /** Config distante (non persistée en clair : stockée chiffrée dans le vault) */
  config?: Record<string, string>;
  insights?: string[];
  error?: string;
  createdAt: number;
  /** true = ne survit pas au rechargement (fichiers) */
  ephemeral?: boolean;
  /** Sources synchronisées (REST/Airtable/Notion/Sheets) : date de dernière synchro */
  lastSync?: number;
}

export type Row = Record<string, unknown>;

export type VizType = 'bar' | 'line' | 'area' | 'pie' | 'kpi' | 'table' | 'pivot';
export interface VizSpec {
  type: VizType;
  title?: string;
  x?: string;
  y?: string[];
  series?: string; // colonne de pivot pour séries
  format?: 'number' | 'currency' | 'percent';
  stacked?: boolean;
}

export interface BiQuery {
  source: string;               // id ou nom de source
  type: 'sql' | 'odoo' | 'mongo';
  sql?: string;
  odoo?: { model: string; domain?: unknown[]; fields?: string[]; groupby?: string[]; order?: string; limit?: number; method?: 'search_read' | 'read_group' };
  mongo?: { collection: string; pipeline: unknown[] };
  viz?: VizSpec;
}

export interface Anomaly { index: number; label: string; value: number; kind: 'spike' | 'drop' | 'outlier'; message: string; column: string }

export interface Widget {
  id: string;
  title: string;
  sourceId: string;
  query: string;
  viz: VizSpec;
  rows: Row[];
  anomalies: Anomaly[];
  span: 1 | 2;
  createdAt: number;
}

export interface QueryRun { status: 'running' | 'ok' | 'error'; error?: string; rowCount?: number; widgetId?: string; ms?: number }

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  provider?: ProviderId;
  model?: string;
  streaming?: boolean;
  runs?: Record<number, QueryRun>;
  costUsd?: number;
  error?: boolean;
}

export interface Session { id: string; title: string; messages: ChatMessage[]; widgets: Widget[]; createdAt: number; updatedAt: number }

/** Modèle chargé dynamiquement depuis l'API du fournisseur (contexte connu seulement si l'API le fournit). */
export interface ModelInfo { id: string; label: string; context?: number; created?: number }
