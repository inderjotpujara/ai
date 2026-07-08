import { afterEach, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { createMemoryStore } from '../../src/memory/store.ts';

const DIR = '/tmp/embguard-test';
afterEach(() => {
  try {
    rmSync(DIR, { recursive: true, force: true });
  } catch {}
});

function deps(dim: number) {
  return {
    embedTexts: async (texts: string[]) =>
      texts.map(() => new Array(dim).fill(0)),
    embedQuery: async () => new Array(dim).fill(0),
    probe: async () => ({ dim, maxInput: 512 }),
  };
}
test('ensureSpace refuses a configured embedder that differs from the stored one', async () => {
  const a = createMemoryStore({ path: DIR, embedModel: 'model-a' }, deps(8));
  await a.remember('hello', { space: 'default', at: 1 });
  a.close();
  const b = createMemoryStore({ path: DIR, embedModel: 'model-b' }, deps(8));
  await expect(
    b.remember('again', { space: 'default', at: 2 }),
  ).rejects.toThrow(/embedder/i);
  b.close();
});
