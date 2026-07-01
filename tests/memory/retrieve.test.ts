import { describe, expect, test } from 'bun:test';
import { MemoryError } from '../../src/core/errors.ts';
import { retrieve } from '../../src/memory/retrieve.ts';
import type { RetrievalResult, SpaceMeta } from '../../src/memory/types.ts';

const space: SpaceMeta = {
  name: 'default',
  embedModel: 'e',
  embedDim: 2,
  chunkCapTokens: 100,
  createdAt: 1,
};
const cand = (id: string, text: string, score: number): RetrievalResult => ({
  id,
  text,
  source: 's',
  score,
  namespace: '',
});

describe('retrieve', () => {
  test('budget-fit returns fewer than topK when ctx is tight', async () => {
    const deps = {
      space,
      embedQuery: async () => [1, 0],
      lance: {
        hybridSearch: async () => [
          cand('a', 'x'.repeat(400), 0.1),
          cand('b', 'y'.repeat(400), 0.2),
        ],
      },
    };
    const out = await retrieve('q', { topK: 5, numCtx: 256 }, deps); // budget 0.25*256*4=256 chars
    expect(out.length).toBe(1);
    expect(out[0]?.id).toBe('a');
  });

  test('dimension mismatch throws MemoryError', async () => {
    const deps = {
      space,
      embedQuery: async () => [1, 0, 0],
      lance: { hybridSearch: async () => [] },
    };
    await expect(retrieve('q', {}, deps)).rejects.toBeInstanceOf(MemoryError);
  });

  test('applies reranker when provided', async () => {
    const deps = {
      space,
      embedQuery: async () => [1, 0],
      lance: {
        hybridSearch: async () => [cand('a', 'aa', 0.9), cand('b', 'bb', 0.1)],
      },
      reranker: {
        rerank: async (_q: string, r: RetrievalResult[]) => [...r].reverse(),
      },
    };
    const out = await retrieve(
      'q',
      { topK: 2, numCtx: 8192, rerank: true },
      deps,
    );
    expect(out[0]?.id).toBe('b');
  });

  test('reranker failure degrades to un-reranked candidates instead of throwing', async () => {
    const deps = {
      space,
      embedQuery: async () => [1, 0],
      lance: {
        hybridSearch: async () => [cand('a', 'aa', 0.9), cand('b', 'bb', 0.1)],
      },
      reranker: {
        rerank: async (): Promise<RetrievalResult[]> => {
          throw new Error('reranker exploded');
        },
      },
    };
    const out = await retrieve(
      'q',
      { topK: 2, numCtx: 8192, rerank: true },
      deps,
    );
    // Falls back to hybridSearch's original (best-first) order, unreranked.
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
