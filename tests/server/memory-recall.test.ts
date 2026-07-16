import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryStore } from '../../src/memory/store.ts';
import { handleMemoryRecall } from '../../src/server/memory/recall.ts';

function recallReq(body: unknown): Request {
  return new Request('http://localhost/api/memory/default/recall', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('recalls against the path space and returns RetrievalResultDTO[]', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-recall-runs-'));
  let seenSpace: string | undefined;
  const fakeStore = {
    recall: async (_q: string, opts: { space?: string }) => {
      seenSpace = opts.space;
      return [
        {
          id: 'doc#0',
          source: 'doc.md',
          text: 'hello',
          score: 0.9,
          namespace: '',
        },
      ];
    },
  } as unknown as MemoryStore;

  const res = await handleMemoryRecall(
    recallReq({ query: 'hello' }),
    { memoryStore: fakeStore, runsRoot },
    'default',
  );

  expect(res.status).toBe(200);
  expect(seenSpace).toBe('default');
  const results = (await res.json()) as { id: string }[];
  expect(results[0]?.id).toBe('doc#0');
});

test('recall response is projected to RetrievalResultDTO — namespace is dropped', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-recall-runs-'));
  const fakeStore = {
    recall: async () => [
      {
        id: 'doc#0',
        source: 'doc.md',
        text: 'hello',
        score: 0.9,
        namespace: 'default',
      },
    ],
  } as unknown as MemoryStore;

  const res = await handleMemoryRecall(
    recallReq({ query: 'hello' }),
    { memoryStore: fakeStore, runsRoot },
    'default',
  );

  expect(res.status).toBe(200);
  const results = (await res.json()) as Record<string, unknown>[];
  expect(Object.keys(results[0] ?? {}).sort()).toEqual([
    'id',
    'score',
    'source',
    'text',
  ]);
  expect(results[0]?.namespace).toBeUndefined();
});

test('malformed body → 400', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-recall-runs-'));
  const res = await handleMemoryRecall(
    recallReq({}),
    {
      memoryStore: { recall: async () => [] } as unknown as MemoryStore,
      runsRoot,
    },
    'default',
  );
  expect(res.status).toBe(400);
});

test('over-long query → 400 (resource-exhaustion bound)', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-recall-runs-'));
  const res = await handleMemoryRecall(
    recallReq({ query: 'x'.repeat(4_001) }),
    {
      memoryStore: { recall: async () => [] } as unknown as MemoryStore,
      runsRoot,
    },
    'default',
  );
  expect(res.status).toBe(400);
});

test('over-large topK → 400 (resource-exhaustion bound)', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-recall-runs-'));
  const res = await handleMemoryRecall(
    recallReq({ query: 'hello', topK: 51 }),
    {
      memoryStore: { recall: async () => [] } as unknown as MemoryStore,
      runsRoot,
    },
    'default',
  );
  expect(res.status).toBe(400);
});

test('a traversal-shaped :space segment is rejected, never reaches the store', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-recall-runs-'));
  let called = false;
  const fakeStore = {
    recall: async () => {
      called = true;
      return [];
    },
  } as unknown as MemoryStore;

  const res = await handleMemoryRecall(
    recallReq({ query: 'hello' }),
    { memoryStore: fakeStore, runsRoot },
    '../../etc/passwd',
  );

  expect(res.status).toBe(400);
  expect(called).toBe(false);
});

test('a space segment with a path separator is rejected', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-recall-runs-'));
  const res = await handleMemoryRecall(
    recallReq({ query: 'hello' }),
    {
      memoryStore: { recall: async () => [] } as unknown as MemoryStore,
      runsRoot,
    },
    'foo/bar',
  );
  expect(res.status).toBe(400);
});
