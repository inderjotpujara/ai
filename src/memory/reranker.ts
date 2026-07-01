import type { Reranker } from './retrieve.ts';
import type { RetrievalResult } from './types.ts';

/** Default cross-encoder reranker model (transformers.js / ONNX, downloaded + cached by the library itself). */
const DEFAULT_RERANK_MODEL = 'Xenova/bge-reranker-base';

type CrossEncoderHandles = {
  tokenizer: (
    text: string | string[],
    opts: {
      text_pair: string | string[];
      padding?: boolean;
      truncation?: boolean;
    },
    // biome-ignore lint/suspicious/noExplicitAny: transformers.js tokenizer output is a loosely-typed Tensor bag consumed only by the model call below
  ) => any;
  model: (
    inputs: unknown,
  ) => Promise<{ logits: { data: Float32Array | number[]; dims: number[] } }>;
};

let handlesPromise: Promise<CrossEncoderHandles> | undefined;

/** Lazily load + cache the tokenizer/model pair. transformers.js manages its own
 * weights cache (NOT the project's Ollama Model Manager) — first call downloads
 * the ONNX weights to its local cache dir; later calls reuse them.
 *
 * Retryable: if the load rejects (e.g. transient network failure fetching
 * weights), the cached promise is reset to `undefined` so the NEXT call
 * attempts a fresh load instead of re-rejecting with the stale error forever.
 */
async function loadCrossEncoder(model: string): Promise<CrossEncoderHandles> {
  if (!handlesPromise) {
    handlesPromise = (async () => {
      try {
        const { AutoTokenizer, AutoModelForSequenceClassification } =
          await import('@huggingface/transformers');
        const tokenizer = await AutoTokenizer.from_pretrained(model);
        const seqModel =
          await AutoModelForSequenceClassification.from_pretrained(model);
        return {
          tokenizer: (text, opts) => tokenizer(text, opts),
          model: (inputs) => seqModel(inputs),
        } satisfies CrossEncoderHandles;
      } catch (err) {
        handlesPromise = undefined;
        throw err;
      }
    })();
  }
  return handlesPromise;
}

/**
 * Cross-encoder reranker seam (Task 13 spike). Scores each `[query, doc]` pair
 * with a real cross-encoder (transformers.js/ONNX) and sorts results by that
 * score, descending. This fully replaces the incoming candidate order — unlike
 * RRF, a cross-encoder reads query+doc jointly, so its ranking is authoritative.
 *
 * Outcome-gated: only wired as the default `Reranker` if the Bun/Apple-Silicon
 * spike (tests/memory/reranker.spike.test.ts) passes. See §2.9 of the Slice 12
 * design spec for the recorded outcome. If unavailable/undesired, an equivalent
 * opt-in path is `llama-server`'s `/v1/rerank` endpoint (llama.cpp), which needs
 * no Node-native ONNX dependency — swap in a `Reranker` that calls that HTTP
 * endpoint instead of this transformers.js implementation.
 */
export function makeCrossEncoderReranker(
  model = DEFAULT_RERANK_MODEL,
): Reranker {
  return {
    async rerank(
      query: string,
      results: RetrievalResult[],
    ): Promise<RetrievalResult[]> {
      if (results.length === 0) return results;
      const { tokenizer, model: seqModel } = await loadCrossEncoder(model);

      const queries = results.map(() => query);
      const docs = results.map((r) => r.text);
      const inputs = tokenizer(queries, {
        text_pair: docs,
        padding: true,
        truncation: true,
      });
      const { logits } = await seqModel(inputs);

      const data = logits.data;
      const width = logits.dims[logits.dims.length - 1] ?? 1;
      const scored = results.map((r, i) => ({
        result: r,
        // Cross-encoders trained for reranking (e.g. bge-reranker) emit a single
        // relevance logit per pair; if a model instead emits per-class logits,
        // take the last column (conventionally the "relevant"/positive class).
        score: Number(data[i * width + (width - 1)]),
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.map((s) => s.result);
    },
  };
}
