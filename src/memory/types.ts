export enum MemoryKind {
  RunMemory = 'run',
  Document = 'document',
}

/** A stored, embedded unit of text. id is stable + surfaced in recall for citation. */
export type MemoryRecord = {
  id: string; // stable chunk id, e.g. `${source}#${ordinal}`
  space: string; // collection name (→ LanceDB table)
  namespace: string; // partition within a space (e.g. crew id); '' = space-wide
  kind: MemoryKind;
  text: string;
  vector: number[]; // dim == space.embedDim
  source: string; // file path / crew:task / free label
  createdAt: number; // epoch ms (passed in; no Date.now() in engine core)
};

/** Space metadata (sqlite) — the authority for a space's embedder + dims. */
export type SpaceMeta = {
  name: string;
  embedModel: string; // recorded at creation; recall/write ALWAYS use this
  embedDim: number; // vector width of the LanceDB table
  chunkCapTokens: number; // derived live from embedModel max-input at creation
  createdAt: number;
};

export type Chunk = { text: string; ordinal: number };

export type RetrievalResult = {
  id: string;
  text: string;
  source: string;
  score: number;
  namespace: string;
};

export type RecallOptions = {
  space?: string; // default 'default'
  namespace?: string; // filter; omit = whole space
  kind?: MemoryKind;
  topK?: number; // CEILING (fallback AGENT_MEMORY_TOP_K=6); budget may return fewer
  numCtx?: number; // caller ctx for injection-budget fit; default from ALS
  rerank?: boolean; // default from AGENT_MEMORY_RERANK (off unless spike passes)
};

export type MemoryConfig = {
  path?: string; // dir, default AGENT_MEMORY_PATH='memory'
  embedModel?: string; // default AGENT_MEMORY_EMBED_MODEL='qwen3-embedding:0.6b'
};
