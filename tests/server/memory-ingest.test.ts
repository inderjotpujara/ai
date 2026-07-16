import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryStore } from '../../src/memory/store.ts';
import { handleMemoryIngest } from '../../src/server/memory/ingest.ts';

function ingestReq(body: unknown): Request {
  return new Request('http://localhost/api/memory/default/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('resolves an uploaded fileId and calls store.ingest with the confined path', async () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'memory-ingest-uploads-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-ingest-runs-'));
  writeFileSync(join(uploadsDir, 'abc123.md'), '# hi');
  let seenPath: string | undefined;
  let seenSpace: string | undefined;
  const fakeStore = {
    ingest: async (path: string, opts: { space: string }) => {
      seenPath = path;
      seenSpace = opts.space;
      return { chunks: 1, skipped: false };
    },
  } as unknown as MemoryStore;

  const res = await handleMemoryIngest(
    ingestReq({ fileId: 'abc123.md' }),
    { memoryStore: fakeStore, runsRoot, uploadsDir },
    'default',
  );

  expect(res.status).toBe(200);
  expect(seenSpace).toBe('default');
  expect(seenPath?.endsWith('abc123.md')).toBe(true);
  expect(await res.json()).toEqual({ chunks: 1, skipped: false });
});

test('an unknown/escaping fileId 400s before any engine work (confineToDir guard)', async () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'memory-ingest-uploads-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-ingest-runs-'));
  let called = false;
  const fakeStore = {
    ingest: async () => {
      called = true;
      return { chunks: 0, skipped: false };
    },
  } as unknown as MemoryStore;

  const res = await handleMemoryIngest(
    ingestReq({ fileId: '../../etc/passwd' }),
    { memoryStore: fakeStore, runsRoot, uploadsDir },
    'default',
  );

  expect(res.status).toBe(400);
  expect(called).toBe(false);
});

test('malformed body → 400', async () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'memory-ingest-uploads-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-ingest-runs-'));
  const res = await handleMemoryIngest(
    ingestReq({}),
    {
      memoryStore: {
        ingest: async () => ({ chunks: 0, skipped: false }),
      } as unknown as MemoryStore,
      runsRoot,
      uploadsDir,
    },
    'default',
  );
  expect(res.status).toBe(400);
});

test('a traversal/separator-shaped :space segment 400s before any store call (same guard as handleMemoryRecall)', async () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'memory-ingest-uploads-'));
  const runsRoot = mkdtempSync(join(tmpdir(), 'memory-ingest-runs-'));
  writeFileSync(join(uploadsDir, 'abc123.md'), '# hi');
  let called = false;
  const fakeStore = {
    ingest: async () => {
      called = true;
      return { chunks: 0, skipped: false };
    },
  } as unknown as MemoryStore;

  const res = await handleMemoryIngest(
    ingestReq({ fileId: 'abc123.md' }),
    { memoryStore: fakeStore, runsRoot, uploadsDir },
    '../../etc',
  );

  expect(res.status).toBe(400);
  expect(called).toBe(false);
});
