import { describe, expect, test } from 'bun:test';
import type { RetrievalResult } from '../../src/memory/types.ts';

// Outcome-gated spike (Task 13): only runs when explicitly enabled via env.
// Records whether a real cross-encoder (transformers.js/ONNX) runs under Bun
// on Apple Silicon. Either PASS or FAIL is an acceptable, recorded outcome —
// see docs/superpowers/specs/2026-07-01-slice-12-memory-rag-design.md §2.9.
const RUN = process.env.AGENT_MEMORY_RERANK_SPIKE === '1';

describe.skipIf(!RUN)('rerank spike (transformers.js under Bun)', () => {
  test('cross-encoder reorders by query relevance', async () => {
    const { makeCrossEncoderReranker } = await import(
      '../../src/memory/reranker.ts'
    );
    const rr = makeCrossEncoderReranker('Xenova/bge-reranker-base');
    const results: RetrievalResult[] = [
      {
        id: 'a',
        text: 'bananas are yellow',
        source: 's',
        score: 0.9,
        namespace: '',
      },
      {
        id: 'b',
        text: 'the capital of France is Paris',
        source: 's',
        score: 0.8,
        namespace: '',
      },
    ];
    const out = await rr.rerank('what is the capital of France', results);
    expect(out[0]?.id).toBe('b');
  }, 120_000);
});
