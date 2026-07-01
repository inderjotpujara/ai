import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryError } from '../core/errors.ts';
import { withMemoryIngestSpan } from '../telemetry/spans.ts';
import { chunk } from './chunk.ts';
import { defineMemory, type ResolvedMemoryConfig } from './define.ts';
import { LanceStore } from './lancedb-store.ts';
import { type Reranker, retrieve } from './retrieve.ts';
import { SqliteStore } from './sqlite-store.ts';
import {
  type MemoryConfig,
  MemoryKind,
  type MemoryRecord,
  type RecallOptions,
  type RetrievalResult,
  type SpaceMeta,
} from './types.ts';

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
    const meta: SpaceMeta = {
      name: space,
      embedModel: cfg.embedModel,
      embedDim: dim,
      chunkCapTokens: maxInput,
      createdAt: at,
    };
    sql.createSpace(meta);
    await lance.openOrCreateTable(space, dim);
    return meta;
  }

  async function writeChunks(
    meta: SpaceMeta,
    namespace: string,
    kind: MemoryKind,
    source: string,
    text: string,
    at: number,
  ): Promise<number> {
    const chunks = await chunk(text, {
      capTokens: meta.chunkCapTokens,
      embed: deps.embedTexts,
    });
    if (chunks.length === 0) return 0;
    const vectors = await deps.embedTexts(chunks.map((c) => c.text));
    if (vectors.length !== chunks.length) {
      throw new MemoryError(
        `embedTexts returned ${vectors.length} vectors for ${chunks.length} chunks`,
      );
    }
    const records: MemoryRecord[] = chunks.map((c, i) => {
      const v = vectors[i];
      if (!v) throw new MemoryError(`missing vector for chunk ${i}`);
      return {
        id: `${source}#${c.ordinal}`,
        space: meta.name,
        namespace,
        kind,
        text: c.text,
        vector: v,
        source,
        createdAt: at,
      };
    });
    await lance.upsert(meta.name, records);
    return records.length;
  }

  return {
    async remember(
      text: string,
      o: {
        space?: string;
        namespace?: string;
        kind?: MemoryKind;
        source?: string;
        at: number;
      },
    ): Promise<void> {
      const meta = await ensureSpace(o.space ?? DEFAULT_SPACE, o.at);
      await writeChunks(
        meta,
        o.namespace ?? '',
        o.kind ?? MemoryKind.RunMemory,
        o.source ?? `mem:${o.at}`,
        text,
        o.at,
      );
    },

    async ingest(
      path: string,
      o: { space?: string; namespace?: string; at: number },
    ): Promise<{ chunks: number; skipped: boolean }> {
      const space = o.space ?? DEFAULT_SPACE;
      const text = readFileSync(path, 'utf8');
      const hash = createHash('sha256').update(text).digest('hex');
      if (sql.seenDoc(space, path, hash)) return { chunks: 0, skipped: true };
      return withMemoryIngestSpan({ space, source: path }, async () => {
        const meta = await ensureSpace(space, o.at);
        const n = await writeChunks(
          meta,
          o.namespace ?? '',
          MemoryKind.Document,
          path,
          text,
          o.at,
        );
        sql.recordDoc(space, path, hash, n, o.at);
        return { chunks: n, skipped: false };
      });
    },

    async recall(
      query: string,
      opts: RecallOptions = {},
    ): Promise<RetrievalResult[]> {
      const space = sql.getSpace(opts.space ?? DEFAULT_SPACE);
      if (!space) return []; // abstention: nothing stored yet
      return retrieve(query, opts, {
        lance,
        embedQuery: deps.embedQuery,
        space,
        reranker: opts.rerank ? deps.reranker : undefined,
      });
    },

    async reindex(space: string, newEmbedModel: string): Promise<void> {
      const meta = sql.getSpace(space);
      if (!meta) throw new MemoryError(`unknown space '${space}'`);
      // Explicit, destructive: drop + recreate under the new embedder. Re-ingest is the caller's job.
      await lance.dropTable(space).catch(() => {});
      sql.clearDocsForSpace(space);
      const { dim, maxInput } = await deps.probe(newEmbedModel);
      sql.createSpace({
        ...meta,
        embedModel: newEmbedModel,
        embedDim: dim,
        chunkCapTokens: maxInput,
      });
      await lance.openOrCreateTable(space, dim);
    },

    async stats(): Promise<Record<string, number>> {
      const out: Record<string, number> = {};
      for (const s of sql.listSpaces())
        out[s.name] = await lance.count(s.name).catch(() => 0);
      return out;
    },

    close(): void {
      sql.close();
    },
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
