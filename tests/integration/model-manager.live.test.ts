import { afterAll, describe, expect, test } from 'bun:test';
import qwenFast from '../../models/qwen-fast.ts';
import qwenRouter from '../../models/qwen-router.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';
import { listLoadedModels } from '../../src/resource/ollama-control.ts';
import { ollamaReady } from './ollama-available.ts';

const ready =
  (await ollamaReady(qwenRouter.model)) && (await ollamaReady(qwenFast.model));

describe.skipIf(!ready)('live model manager: co-residency + pinning', () => {
  const manager = createModelManager();
  afterAll(async () => {
    await manager.unloadAll();
  });

  test('router stays pinned-resident while a specialist loads', async () => {
    await manager.ensureReady(qwenRouter, { pinned: [qwenRouter.model] });
    await manager.ensureReady(qwenFast, { pinned: [qwenRouter.model] });
    const loaded = (await listLoadedModels()).map((m) => m.name);
    expect(loaded).toContain(qwenRouter.model); // pinned survived
    expect(loaded).toContain(qwenFast.model); // specialist co-resident
  }, 180_000);
});
