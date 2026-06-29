import { afterAll, describe, expect, test } from 'bun:test';
import { REGISTRY } from '../../models/registry.ts';
import qwenFast from '../../models/qwen-fast.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';
import { resolveModel } from '../../src/resource/selector.ts';
import { unloadModel } from '../../src/resource/ollama-control.ts';
import { ollamaReady } from './ollama-available.ts';

const ready = await ollamaReady(qwenFast.model);

describe.skipIf(!ready)('live dynamic model selection (real Ollama)', () => {
  afterAll(async () => {
    await unloadModel(qwenFast.model);
  });

  test('with plentiful RAM, largest-that-fits resolves to the 9b specialist', async () => {
    const manager = createModelManager();
    const { decl, numCtx } = await resolveModel(
      { role: 'general reasoning + tool use', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits },
      REGISTRY,
      { ensureReady: (d, o) => manager.ensureReady(d, o) },
    );
    expect(decl.model).toBe('qwen3.5:9b');
    expect(numCtx).toBeGreaterThanOrEqual(4096);
  }, 180_000);
});
