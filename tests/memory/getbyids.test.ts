import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { LanceStore } from '../../src/memory/lancedb-store.ts';
import { MemoryKind } from '../../src/memory/types.ts';

const DIR = '/tmp/getbyids-test';
afterEach(() => {
  try {
    rmSync(DIR, { recursive: true, force: true });
  } catch {}
});

describe('LanceStore.getByIds', () => {
  test('returns only the requested ids', async () => {
    const s = new LanceStore(DIR);
    await s.openOrCreateTable('default', 2);
    await s.upsert('default', [
      {
        id: 'a#0',
        space: 'default',
        namespace: '',
        kind: MemoryKind.Document,
        text: 'alpha',
        vector: [1, 0],
        source: 'a',
        createdAt: 1,
      },
      {
        id: 'b#0',
        space: 'default',
        namespace: '',
        kind: MemoryKind.Document,
        text: 'beta',
        vector: [0, 1],
        source: 'b',
        createdAt: 1,
      },
    ]);
    const got = await s.getByIds('default', ['a#0']);
    expect(got.map((r) => r.id)).toEqual(['a#0']);
    expect(got[0]?.text).toBe('alpha');
    expect(await s.getByIds('default', [])).toEqual([]);
  }, 60_000);
});
