import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { LanceStore } from '../../src/memory/lancedb-store.ts';
import { MemoryKind } from '../../src/memory/types.ts';

const DIR = '/tmp/lance-smoke';

afterEach(() => {
  try {
    rmSync(DIR, { recursive: true, force: true });
  } catch {}
});

describe('LanceStore (native load + roundtrip)', () => {
  test('create, upsert, dense search returns nearest', async () => {
    const s = new LanceStore(DIR);
    await s.openOrCreateTable('default', 2);
    await s.upsert('default', [
      {
        id: 'a',
        space: 'default',
        namespace: '',
        kind: MemoryKind.Document,
        text: 'apple',
        vector: [1, 0],
        source: 'x',
        createdAt: 1,
      },
      {
        id: 'b',
        space: 'default',
        namespace: '',
        kind: MemoryKind.Document,
        text: 'banana',
        vector: [0, 1],
        source: 'x',
        createdAt: 1,
      },
    ]);
    expect(await s.count('default')).toBe(2);
    const hits = await s.hybridSearch('default', {
      queryVector: [0.9, 0.1],
      queryText: 'apple',
      namespace: '',
      limit: 1,
    });
    expect(hits[0]?.id).toBe('a');
  }, 60_000);
});
