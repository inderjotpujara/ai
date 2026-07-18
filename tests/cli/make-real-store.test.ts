import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRealStore } from '../../src/cli/memory.ts';

describe('makeRealStore (exported for CLI recall wiring, Slice 30b Phase 6, D5)', () => {
  test('constructs a real MemoryStore + ModelManager pair without touching Ollama at construction time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'make-real-store-'));
    const prevPath = process.env.AGENT_MEMORY_PATH;
    process.env.AGENT_MEMORY_PATH = dir;
    try {
      const { store, manager } = makeRealStore({});
      expect(typeof store.recall).toBe('function');
      expect(typeof store.remember).toBe('function');
      expect(typeof store.rememberOnce).toBe('function');
      expect(typeof store.ingest).toBe('function');
      expect(typeof store.stats).toBe('function');
      expect(typeof store.close).toBe('function');
      store.close();
      await manager.unloadAll(); // safe no-op: nothing was ever ensureReady'd
    } finally {
      if (prevPath === undefined) delete process.env.AGENT_MEMORY_PATH;
      else process.env.AGENT_MEMORY_PATH = prevPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('honors an --embed override for the embed model (no network call at construction)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'make-real-store-embed-'));
    const prevPath = process.env.AGENT_MEMORY_PATH;
    process.env.AGENT_MEMORY_PATH = dir;
    try {
      const { store } = makeRealStore({ embed: 'some-other-embedder' });
      expect(typeof store.recall).toBe('function');
      store.close();
    } finally {
      if (prevPath === undefined) delete process.env.AGENT_MEMORY_PATH;
      else process.env.AGENT_MEMORY_PATH = prevPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
