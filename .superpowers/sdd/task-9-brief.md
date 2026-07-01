## Task 9: `MemoryStore` facade

**Files:**
- Create: `src/memory/store.ts`
- Test: `tests/memory/store.test.ts`

**Interfaces:**
- Produces: `class MemoryStore` with `remember(text, o): Promise<void>`, `ingest(path, o): Promise<{ chunks: number; skipped: boolean }>`, `recall(query, opts): Promise<RetrievalResult[]>`, `reindex(space, newEmbedModel): Promise<void>`, `stats(): Promise<Record<string, number>>`, `close(): void`. Constructed via `createMemoryStore(config, deps)` where `deps = { embedTexts, embedQuery, probe, ensureReady }` (injectable for tests).
- Consumes: everything from Tasks 1–8.

- [ ] **Step 1: Write the failing test** (fully mocked deps — no Ollama)
```ts
// tests/memory/store.test.ts
import { afterEach, describe, expect, test } from 'vitest';
import { rmSync } from 'node:fs';
import { createMemoryStore } from '../../src/memory/store.ts';
import { MemoryKind } from '../../src/memory/types.ts';

const DIR = '/tmp/memstore-test';
afterEach(() => { try { rmSync(DIR, { recursive: true, force: true }); } catch {} });

function fakeDeps() {
  // 2-d embeddings: map first char code to a vector so 'a' matches 'a'.
  const vec = (t: string) => [t.charCodeAt(0) || 0, 1];
  return {
    embedTexts: async (ts: string[]) => ts.map(vec),
    embedQuery: async (t: string) => vec(t),
    probe: async () => ({ dim: 2, maxInput: 2048 }),
  };
}

describe('MemoryStore', () => {
  test('remember then recall roundtrip (creates space, records embedder)', async () => {
    const store = createMemoryStore({ path: DIR, embedModel: 'fake' }, fakeDeps());
    await store.remember('apple pie recipe', { space: 'default', namespace: 'crew:x', kind: MemoryKind.RunMemory, source: 'crew:x:task1', at: 1 });
    const hits = await store.recall('apple', { space: 'default', namespace: 'crew:x', numCtx: 8192 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    store.close();
  });
  test('space embedder is authoritative (global default ignored for existing space)', async () => {
    const store = createMemoryStore({ path: DIR, embedModel: 'fake' }, fakeDeps());
    await store.remember('x', { space: 'default', at: 1 });
    const stats = await store.stats();
    expect(stats.default).toBe(1);
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/memory/store.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/memory/store.ts`**
```ts
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { MemoryError } from '../core/errors.ts';
import { withMemoryIngestSpan } from '../telemetry/spans.ts';
import { chunk } from './chunk.ts';
import { defineMemory, type ResolvedMemoryConfig } from './define.ts';
import { LanceStore } from './lancedb-store.ts';
import { retrieve, type Reranker } from './retrieve.ts';
import { SqliteStore } from './sqlite-store.ts';
import { MemoryKind, type MemoryConfig, type MemoryRecord, type RecallOptions, type RetrievalResult, type SpaceMeta } from './types.ts';

export type StoreDeps = {
  embedTexts: (texts: string[]) => Promise<number[][]>;
  embedQuery: (text: string) => Promise<number[]>;
  probe: (model: string) => Promise<{ dim: number; maxInput: number }>;
  reranker?: Reranker;
};

const DEFAULT_SPACE = 'default';

export function createMemoryStore(config: MemoryConfig, deps: StoreDeps) {
  const cfg: ResolvedMemoryConfig = defineMemory(config);
  const lance = new LanceStore(join(cfg.path, 'lance'));
  const sql = new SqliteStore(join(cfg.path, 'memory.db'));

  async function ensureSpace(space: string, at: number): Promise<SpaceMeta> {
    const existing = sql.getSpace(space);
    if (existing) return existing;
    const { dim, maxInput } = await deps.probe(cfg.embedModel);
    const meta: SpaceMeta = { name: space, embedModel: cfg.embedModel, embedDim: dim, chunkCapTokens: maxInput, createdAt: at };
    sql.createSpace(meta);
    await lance.openOrCreateTable(space, dim);
    return meta;
  }

  async function writeChunks(meta: SpaceMeta, namespace: string, kind: MemoryKind, source: string, text: string, at: number): Promise<number> {
    const chunks = await chunk(text, { capTokens: meta.chunkCapTokens, embed: deps.embedTexts });
    if (chunks.length === 0) return 0;
    const vectors = await deps.embedTexts(chunks.map((c) => c.text));
    const records: MemoryRecord[] = chunks.map((c, i) => ({
      id: `${source}#${c.ordinal}`, space: meta.name, namespace, kind, text: c.text, vector: vectors[i], source, createdAt: at,
    }));
    await lance.upsert(meta.name, records);
    return records.length;
  }

  return {
    async remember(text: string, o: { space?: string; namespace?: string; kind?: MemoryKind; source?: string; at: number }): Promise<void> {
      const meta = await ensureSpace(o.space ?? DEFAULT_SPACE, o.at);
      await writeChunks(meta, o.namespace ?? '', o.kind ?? MemoryKind.RunMemory, o.source ?? `mem:${o.at}`, text, o.at);
    },

    async ingest(path: string, o: { space?: string; namespace?: string; at: number }): Promise<{ chunks: number; skipped: boolean }> {
      const space = o.space ?? DEFAULT_SPACE;
      const text = readFileSync(path, 'utf8');
      const hash = createHash('sha256').update(text).digest('hex');
      if (sql.seenDoc(path, hash)) return { chunks: 0, skipped: true };
      return withMemoryIngestSpan({ space, source: path }, async () => {
        const meta = await ensureSpace(space, o.at);
        const n = await writeChunks(meta, o.namespace ?? '', MemoryKind.Document, path, text, o.at);
        sql.recordDoc(path, hash, n, o.at);
        return { chunks: n, skipped: false };
      });
    },

    async recall(query: string, opts: RecallOptions = {}): Promise<RetrievalResult[]> {
      const space = sql.getSpace(opts.space ?? DEFAULT_SPACE);
      if (!space) return []; // abstention: nothing stored yet
      return retrieve(query, opts, {
        lance, embedQuery: deps.embedQuery, space, reranker: opts.rerank ? deps.reranker : undefined,
      });
    },

    async reindex(space: string, newEmbedModel: string): Promise<void> {
      const meta = sql.getSpace(space);
      if (!meta) throw new MemoryError(`unknown space '${space}'`);
      // Explicit, destructive: drop + recreate under the new embedder. Re-ingest is the caller's job.
      await lance.dropTable(space).catch(() => {});
      const { dim, maxInput } = await deps.probe(newEmbedModel);
      sql.createSpace({ ...meta, embedModel: newEmbedModel, embedDim: dim, chunkCapTokens: maxInput });
      await lance.openOrCreateTable(space, dim);
    },

    async stats(): Promise<Record<string, number>> {
      const out: Record<string, number> = {};
      for (const s of sql.listSpaces()) out[s.name] = await lance.count(s.name).catch(() => 0);
      return out;
    },

    close(): void { sql.close(); },
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
```

- [ ] **Step 4: Run tests + typecheck**
Run: `bun test tests/memory/store.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/memory/store.ts tests/memory/store.test.ts
git commit -m "feat(memory): MemoryStore facade (remember/ingest/recall/reindex/stats)"
```

---

