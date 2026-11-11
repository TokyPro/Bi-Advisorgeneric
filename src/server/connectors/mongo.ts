import type { TableSchema } from '@/lib/types';
import { assertMongoUriAllowed } from '../net/policy';

type Cfg = Record<string, string>;

async function withMongo<T>(c: Cfg, fn: (db: import('mongodb').Db) => Promise<T>) {
  // Contrôle des hôtes et options avant toute connexion. Pas d'épinglage possible (SRV, découverte de topologie) : risque résiduel R-2.
  await assertMongoUriAllowed(c.url);
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(c.url, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try { return await fn(client.db(c.database || undefined)); } finally { await client.close(); }
}

export const testMongo = (c: Cfg) => withMongo(c, async (db) => { await db.command({ ping: 1 }); return `MongoDB · base ${db.databaseName}`; });

function infer(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'date';
  if (typeof v === 'object') return (v as { _bsontype?: string })._bsontype === 'ObjectId' ? 'objectId' : 'object';
  return typeof v;
}

export async function schemaMongo(c: Cfg): Promise<TableSchema[]> {
  return withMongo(c, async (db) => {
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    const out: TableSchema[] = [];
    for (const col of cols.slice(0, 60)) {
      const docs = await db.collection(col.name).aggregate([{ $sample: { size: 50 } }]).toArray();
      const fields = new Map<string, string>();
      for (const d of docs) for (const [k, v] of Object.entries(d)) if (!fields.has(k) || fields.get(k) === 'null') fields.set(k, infer(v));
      out.push({ name: col.name, columns: [...fields].map(([name, type]) => ({ name, type })), rowCount: await db.collection(col.name).estimatedDocumentCount() });
    }
    return out;
  });
}

export async function queryMongo(c: Cfg, q: { collection: string; pipeline: Record<string, unknown>[] }) {
  const text = JSON.stringify(q.pipeline);
  if (/\$out|\$merge|\$function|\$accumulator/.test(text)) throw new Error('Opérateur interdit (lecture seule).');
  return withMongo(c, async (db) => {
    const docs = await db.collection(q.collection).aggregate([...q.pipeline, { $limit: 1000 }]).toArray();
    return docs.map((d) => JSON.parse(JSON.stringify(d)) as Record<string, unknown>);
  });
}
