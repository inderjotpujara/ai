import { describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import { ProviderKind } from '../../src/core/types.ts';
import { makeEmbedder, probeEmbedder } from '../../src/memory/embed.ts';
import { createMemoryStore } from '../../src/memory/store.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';
import { runtimeFor } from '../../src/runtime/registry.ts';
import { ollamaReady } from './ollama-available.ts';

const EMBED_MODEL = 'qwen3-embedding:0.6b';
const ready = await ollamaReady(EMBED_MODEL);
const DIR = '/tmp/mem-live';

describe.skipIf(!ready)('memory.live', () => {
  it('ingest text then recall a relevant chunk', async () => {
    try {
      rmSync(DIR, { recursive: true, force: true });
    } catch {}

    // Closes the Task 4 minor: probeEmbedder must return real dim/maxInput, not
    // the silent { dim: 768, maxInput: 2048 } fallback.
    const probed = await probeEmbedder(EMBED_MODEL);
    expect(probed.dim).toBeGreaterThan(0);
    expect(probed.maxInput).toBeGreaterThan(0);

    const manager = createModelManager();
    const control = runtimeFor(ProviderKind.Ollama).control;
    const embedder = makeEmbedder({
      ensureReady: (decl) => manager.ensureReady(decl),
      control,
      model: EMBED_MODEL,
    });
    const store = createMemoryStore(
      { path: DIR, embedModel: EMBED_MODEL },
      {
        embedTexts: embedder.embed,
        embedQuery: async (text) =>
          (await embedder.embed([text]))[0] as number[],
        probe: probeEmbedder,
      },
    );

    try {
      await store.remember(
        'The Raft consensus algorithm elects a leader via randomized election timeouts.',
        { space: 'default', at: Date.now() },
      );

      const hits = await store.recall('how does raft choose a leader', {
        space: 'default',
        numCtx: 8192,
      });

      expect(hits.length).toBeGreaterThan(0);
      const joined = hits.map((h) => h.text).join('\n');
      expect(joined.toLowerCase()).toMatch(/leader|raft/);
    } finally {
      store.close();
      await manager.unloadAll();
      try {
        rmSync(DIR, { recursive: true, force: true });
      } catch {}
    }
  }, 180_000);
});
