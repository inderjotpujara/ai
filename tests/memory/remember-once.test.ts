import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { createMemoryStore } from '../../src/memory/store.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

const DIR = '/tmp/memstore-rememberonce-test';

function fakeDeps() {
  const vec = (t: string) => [t.charCodeAt(0) || 0, 1];
  return {
    embedTexts: async (ts: string[]) => ts.map(vec),
    embedQuery: async (t: string) => vec(t),
    probe: async () => ({ dim: 2, maxInput: 2048 }),
  };
}

describe('MemoryStore.rememberOnce (Slice 30b Phase 6, D6)', () => {
  test('writes a chunk and returns skipped:false on the first call', async () => {
    rmSync(DIR, { recursive: true, force: true });
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    try {
      const result = await store.rememberOnce('hello world', {
        space: 'chat',
        namespace: 'sess-1',
        source: 'chat:sess-1:m1',
        at: 1,
      });
      expect(result.skipped).toBe(false);
      const stats = await store.stats();
      expect(stats.chat).toBe(1);
    } finally {
      store.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  });

  test('a repeat call with the SAME source+text is deduped (skipped:true, no new chunk)', async () => {
    rmSync(DIR, { recursive: true, force: true });
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    try {
      await store.rememberOnce('hello world', {
        space: 'chat',
        source: 'chat:sess-1:m1',
        at: 1,
      });
      const second = await store.rememberOnce('hello world', {
        space: 'chat',
        source: 'chat:sess-1:m1',
        at: 2,
      });
      expect(second.skipped).toBe(true);
      const stats = await store.stats();
      expect(stats.chat).toBe(1); // no second chunk written
    } finally {
      store.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  });

  test('the SAME source with DIFFERENT text is NOT deduped (hash+source, not source alone)', async () => {
    rmSync(DIR, { recursive: true, force: true });
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    try {
      await store.rememberOnce('first text', {
        space: 'chat',
        source: 'chat:sess-1:m1',
        at: 1,
      });
      const second = await store.rememberOnce('different text', {
        space: 'chat',
        source: 'chat:sess-1:m1',
        at: 2,
      });
      expect(second.skipped).toBe(false);
    } finally {
      store.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  });

  test('§7.1(d): a DIFFERENT source (a different turn) is never deduped against a prior turn', async () => {
    rmSync(DIR, { recursive: true, force: true });
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    try {
      await store.rememberOnce('same text both turns', {
        space: 'chat',
        source: 'chat:sess-1:m1',
        at: 1,
      });
      const second = await store.rememberOnce('same text both turns', {
        space: 'chat',
        source: 'chat:sess-1:m2',
        at: 2,
      });
      expect(second.skipped).toBe(false);
    } finally {
      store.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  });

  test('emits a memory.remember span tagged with space/namespace/skipped', async () => {
    rmSync(DIR, { recursive: true, force: true });
    const { exporter } = registerTestProvider();
    const store = createMemoryStore(
      { path: DIR, embedModel: 'fake' },
      fakeDeps(),
    );
    try {
      await store.rememberOnce('hello world', {
        space: 'chat',
        namespace: 'sess-1',
        source: 'chat:sess-1:m1',
        at: 1,
      });
      const span = exporter
        .getFinishedSpans()
        .find((s) => s.name === 'memory.remember');
      expect(span).toBeDefined();
      expect(span?.attributes[ATTR.MEMORY_SPACE]).toBe('chat');
      expect(span?.attributes[ATTR.MEMORY_NAMESPACE]).toBe('sess-1');
      expect(span?.attributes[ATTR.MEMORY_REMEMBER_SKIPPED]).toBe(false);
    } finally {
      store.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  });
});
