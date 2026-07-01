import { MemoryError } from '../core/errors.ts';
import { currentDelegationContext } from '../core/guardrails.ts';
import { withMemoryRecallSpan } from '../telemetry/spans.ts';
import { retrievalBudgetChars } from './budget.ts';
import type { LanceStore } from './lancedb-store.ts';
import type { RecallOptions, RetrievalResult, SpaceMeta } from './types.ts';

export type Reranker = {
  rerank(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]>;
};

export type RetrieveDeps = {
  lance: Pick<LanceStore, 'hybridSearch'>;
  embedQuery: (t: string) => Promise<number[]>;
  space: SpaceMeta;
  reranker?: Reranker;
};

/** Fallback ceiling on returned results. Env AGENT_MEMORY_TOP_K, default 6. */
function defaultTopK(): number {
  const raw = Number(process.env.AGENT_MEMORY_TOP_K);
  return Number.isInteger(raw) && raw > 0 ? raw : 6;
}

/**
 * Retrieval pipeline: embed query → hybrid search candidates → optional rerank
 * → budget-fit pack, capped at topK. Candidate order from `hybridSearch` (best-first,
 * `_distance` ascending) is preserved unless a reranker is applied, which fully
 * decides order instead.
 */
export async function retrieve(
  query: string,
  opts: RecallOptions,
  deps: RetrieveDeps,
): Promise<RetrievalResult[]> {
  const topK = opts.topK ?? defaultTopK();
  const numCtx = opts.numCtx ?? currentDelegationContext().numCtx;
  return withMemoryRecallSpan(
    {
      space: deps.space.name,
      namespace: opts.namespace,
      reranked: !!(opts.rerank && deps.reranker),
    },
    async () => {
      const vector = await deps.embedQuery(query);
      if (vector.length !== deps.space.embedDim) {
        throw new MemoryError(
          `query embedding dim ${vector.length} ≠ space '${deps.space.name}' dim ${deps.space.embedDim}`,
        );
      }

      let candidates = await deps.lance.hybridSearch(deps.space.name, {
        queryVector: vector,
        queryText: query,
        namespace: opts.namespace,
        kind: opts.kind,
        limit: topK * 4,
      });

      if (opts.rerank && deps.reranker) {
        candidates = await deps.reranker.rerank(query, candidates);
      }

      // Budget-fit: pack top-ranked candidates until the live char budget is
      // spent, capped at topK. The first candidate is always kept even if it
      // alone exceeds the budget, so callers never get zero results when any
      // candidate exists.
      const budget = retrievalBudgetChars(numCtx);
      const out: RetrievalResult[] = [];
      let used = 0;
      for (const c of candidates) {
        if (out.length >= topK) break;
        if (used + c.text.length > budget && out.length > 0) break;
        out.push(c);
        used += c.text.length;
      }
      return out;
    },
  );
}
