import { expect, test } from 'bun:test';
import {
  MemoryIngestRequestSchema,
  MemoryIngestResponseSchema,
} from '../../src/contracts/requests.ts';

test('MemoryIngestRequestSchema requires a fileId string', () => {
  expect(MemoryIngestRequestSchema.parse({ fileId: 'abc123.md' }).fileId).toBe(
    'abc123.md',
  );
  expect(() => MemoryIngestRequestSchema.parse({})).toThrow();
});

test('MemoryIngestRequestSchema rejects an unbounded fileId (defense in depth)', () => {
  // Server-minted upload ids are `<32 hex>.ext` (~36 chars) — this bound
  // exists so a pathological client string never reaches confineToDir/fs.
  expect(() =>
    MemoryIngestRequestSchema.parse({ fileId: 'a'.repeat(1_000) }),
  ).toThrow();
});

test('MemoryIngestResponseSchema accepts a valid ingest result', () => {
  expect(
    MemoryIngestResponseSchema.parse({ chunks: 3, skipped: false }),
  ).toEqual({ chunks: 3, skipped: false });
  expect(
    MemoryIngestResponseSchema.parse({ chunks: 0, skipped: true }),
  ).toEqual({ chunks: 0, skipped: true });
});

test('MemoryIngestResponseSchema rejects a malformed store response', () => {
  expect(() =>
    MemoryIngestResponseSchema.parse({ chunks: '3', skipped: false }),
  ).toThrow();
  expect(() => MemoryIngestResponseSchema.parse({ chunks: 3 })).toThrow();
});
