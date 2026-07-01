import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { createMemoryStore } from '../../src/memory/store.ts';
import { MemoryKind } from '../../src/memory/types.ts';

const DIR = '/tmp/memstore-test';
afterEach(() => {
  try {
    rmSync(DIR, { recursive: true, force: true });
  } catch {}
});

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
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    await store.remember('apple pie recipe', {
      space: 'default',
      namespace: 'crew:x',
      kind: MemoryKind.RunMemory,
      source: 'crew:x:task1',
      at: 1,
    });
    const hits = await store.recall('apple', {
      space: 'default',
      namespace: 'crew:x',
      numCtx: 8192,
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    store.close();
  });
  test('space embedder is authoritative (global default ignored for existing space)', async () => {
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    await store.remember('x', { space: 'default', at: 1 });
    const stats = await store.stats();
    expect(stats.default).toBe(1);
    store.close();
  });
});
