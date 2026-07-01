import { describe, expect, test } from 'bun:test';
import { runMemoryCli } from '../../src/cli/memory.ts';
import type { MemoryStore } from '../../src/memory/store.ts';

function fakeStore() {
  const calls: string[] = [];
  const store: MemoryStore = {
    remember: async () => {
      calls.push('remember');
    },
    ingest: async () => {
      calls.push('ingest');
      return { chunks: 2, skipped: false };
    },
    recall: async () => {
      calls.push('recall');
      return [{ id: 'a#0', text: 'hi', source: 'a', score: 0, namespace: '' }];
    },
    getByIds: async () => {
      calls.push('getByIds');
      return [{ id: 'a#0', text: 'hi', source: 'a', score: 0, namespace: '' }];
    },
    reindex: async () => {
      calls.push('reindex');
    },
    stats: async () => {
      calls.push('stats');
      return { default: 3 };
    },
    close: () => {},
  };
  return { calls, store };
}

describe('runMemoryCli', () => {
  test('recall routes to store.recall and returns 0', async () => {
    const f = fakeStore();
    const code = await runMemoryCli(['recall', 'apple'], {
      makeStore: () => f.store,
    });
    expect(code).toBe(0);
    expect(f.calls).toContain('recall');
  });

  test('stats routes to store.stats', async () => {
    const f = fakeStore();
    const code = await runMemoryCli(['stats'], { makeStore: () => f.store });
    expect(code).toBe(0);
    expect(f.calls).toContain('stats');
  });

  test('unknown command returns non-zero', async () => {
    const f = fakeStore();
    const code = await runMemoryCli(['frobnicate'], {
      makeStore: () => f.store,
    });
    expect(code).not.toBe(0);
  });
});
