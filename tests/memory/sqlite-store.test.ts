import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { SqliteStore } from '../../src/memory/sqlite-store.ts';

const DB = '/tmp/mem-test.db';
afterEach(() => { try { rmSync(DB); } catch {} });

describe('SqliteStore', () => {
  test('space create/get is authoritative for embedder', () => {
    const s = new SqliteStore(DB);
    expect(s.getSpace('default')).toBeUndefined();
    s.createSpace({ name: 'default', embedModel: 'qwen3-embedding:0.6b', embedDim: 768, chunkCapTokens: 512, createdAt: 1 });
    expect(s.getSpace('default')?.embedModel).toBe('qwen3-embedding:0.6b');
    expect(s.getSpace('default')?.embedDim).toBe(768);
    s.close();
  });
  test('doc dedupe by hash', () => {
    const s = new SqliteStore(DB);
    expect(s.seenDoc('a.md', 'h1')).toBe(false);
    s.recordDoc('a.md', 'h1', 3, 1);
    expect(s.seenDoc('a.md', 'h1')).toBe(true);
    expect(s.seenDoc('a.md', 'h2')).toBe(false); // changed content
    s.close();
  });
});
