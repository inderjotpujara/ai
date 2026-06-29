import { afterAll, describe, expect, test } from 'bun:test';
import qwenFast from '../../models/qwen-fast.ts';
import qwenRouter from '../../models/qwen-router.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';
import {
  getModelMaxContext,
  listLoadedModels,
} from '../../src/resource/ollama-control.ts';
import { ollamaReady } from './ollama-available.ts';

const ready =
  (await ollamaReady(qwenRouter.model)) && (await ollamaReady(qwenFast.model));

describe.skipIf(!ready)(
  'live model manager: functional routing + pinning',
  () => {
    const manager = createModelManager();
    afterAll(async () => {
      await manager.unloadAll();
    });

    test('specialist loads and the router stays functional', async () => {
      await manager.ensureReady(qwenRouter, { pinned: [qwenRouter.model] });
      await manager.ensureReady(qwenFast, { pinned: [qwenRouter.model] });
      let loaded = (await listLoadedModels()).map((m) => m.name);
      expect(loaded).toContain(qwenFast.model); // specialist loaded for the delegation

      // When the live budget has room the pinned router is co-resident here; under
      // real memory pressure it is evicted best-effort, so re-ensuring it must bring
      // it back. Either way routing stays functional — that is what we assert.
      await manager.ensureReady(qwenRouter, { pinned: [qwenRouter.model] });
      loaded = (await listLoadedModels()).map((m) => m.name);
      expect(loaded).toContain(qwenRouter.model);
    }, 180_000);

    test('ensureReady returns a sane chosen context within the model max', async () => {
      const max = await getModelMaxContext(qwenFast.model);
      const ctx = await manager.ensureReady(qwenFast, {
        pinned: [qwenRouter.model],
      });
      expect(ctx).toBeGreaterThanOrEqual(4096);
      expect(ctx % 1024).toBe(0);
      if (max !== undefined) expect(ctx).toBeLessThanOrEqual(max);
    }, 180_000);
  },
);
