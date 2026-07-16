import { expect, test } from 'bun:test';
import type { MemoryStore } from '../../src/memory/store.ts';
import { handleMemorySpaces } from '../../src/server/memory/spaces.ts';

test('projects store.stats() to MemorySpaceDTO[]', async () => {
  const fakeStore = {
    stats: async () => ({ default: 12, research: 3 }),
  } as unknown as MemoryStore;
  const res = await handleMemorySpaces({ memoryStore: fakeStore });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([
    { name: 'default', chunkCount: 12 },
    { name: 'research', chunkCount: 3 },
  ]);
});

test('empty store → empty array, not an error', async () => {
  const fakeStore = { stats: async () => ({}) } as unknown as MemoryStore;
  const res = await handleMemorySpaces({ memoryStore: fakeStore });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});
