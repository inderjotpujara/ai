import * as lancedb from '@lancedb/lancedb';
import {
  MemoryKind,
  type MemoryRecord,
  type RetrievalResult,
} from './types.ts';

type HybridSearchQuery = {
  queryVector: number[];
  queryText: string;
  namespace?: string;
  kind?: MemoryKind;
  limit: number;
};

const SEED_ID = '__seed__';

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * LanceDB-backed vector store. One table per `space`; `namespace`/`kind`
 * are plain filterable columns within a table (not separate tables).
 *
 * Search is DENSE-ONLY: this installed version's FTS index creation is
 * best-effort (see openOrCreateTable) and hybrid `.search(text, "hybrid")`
 * is not wired up here — see the class doc below for why.
 *
 * Score convention: `RetrievalResult.score` is LanceDB's raw `_distance`
 * from vector search — LOWER IS BETTER (closer). Callers must sort/compare
 * ascending, not descending.
 */
export class LanceStore {
  private conn?: Awaited<ReturnType<typeof lancedb.connect>>;

  constructor(private readonly dir: string) {}

  private async db() {
    this.conn ??= await lancedb.connect(this.dir);
    return this.conn;
  }

  async openOrCreateTable(space: string, dim: number): Promise<void> {
    const db = await this.db();
    const names = await db.tableNames();
    if (names.includes(space)) return;

    const seed = [
      {
        id: SEED_ID,
        space,
        namespace: '',
        kind: String(MemoryKind.Document),
        text: '',
        vector: Array(dim).fill(0),
        source: '',
        createdAt: 0,
      },
    ];
    const table = await db.createTable(space, seed);
    await table.delete(`id = '${SEED_ID}'`);

    // FTS is best-effort: the shipped 0.30.0 JS API supports Index.fts(),
    // but hybrid query wiring (search(text, "hybrid")) is not exercised or
    // documented cleanly enough to depend on yet. We still build the index
    // opportunistically so a later task can switch to hybrid without a
    // migration; if index creation fails for any reason, dense search still
    // works fine without it.
    try {
      await table.createIndex('text', { config: lancedb.Index.fts() });
    } catch {
      // FTS optional — dense-only search remains fully functional.
    }
  }

  async upsert(space: string, records: MemoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await this.db();
    const table = await db.openTable(space);
    const ids = records.map((r) => `'${escapeSqlLiteral(r.id)}'`).join(',');
    await table.delete(`id IN (${ids})`);
    await table.add(records.map((r) => ({ ...r, kind: String(r.kind) })));
  }

  async hybridSearch(
    space: string,
    q: HybridSearchQuery,
  ): Promise<RetrievalResult[]> {
    const db = await this.db();
    const table = await db.openTable(space);

    const filters: string[] = [];
    if (q.namespace != null && q.namespace !== '') {
      filters.push(`namespace = '${escapeSqlLiteral(q.namespace)}'`);
    }
    if (q.kind) {
      filters.push(`kind = '${escapeSqlLiteral(String(q.kind))}'`);
    }

    let query = table.search(q.queryVector).limit(q.limit);
    if (filters.length > 0) {
      query = query.where(filters.join(' AND '));
    }

    const rows = (await query.toArray()) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      text: r.text as string,
      source: r.source as string,
      score: (r._distance as number) ?? 0,
      namespace: r.namespace as string,
    }));
  }

  async count(space: string): Promise<number> {
    const db = await this.db();
    const table = await db.openTable(space);
    return table.countRows();
  }

  async dropTable(space: string): Promise<void> {
    const db = await this.db();
    await db.dropTable(space);
  }
}
