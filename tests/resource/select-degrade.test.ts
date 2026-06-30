import { expect, mock, test } from 'bun:test';
import { BOOTSTRAP } from '../../models/registry.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';
import { resolveModel } from '../../src/resource/selector.ts';
import type { RuntimeControl } from '../../src/runtime/runtime.ts';

/**
 * Budget math (bpw=0.56, MIN_CTX=4096, kvBytesPerToken=131072):
 *   weightsBytes(9, 0.56) = 9e9 * 0.56 * 1.2 = 6.048e9
 *   kvCacheBytes(4096, 131072)              = 536_870_912
 *   9b minNeed ≈ 6.585e9  →  does NOT fit in 4e9
 *
 *   weightsBytes(4, 0.56) = 4e9 * 0.56 * 1.2 = 2.688e9
 *   4b minNeed ≈ 3.225e9  →  FITS in 4e9
 *
 * A budgetBytes of 4e9 is unambiguous: only the 4b candidate can be loaded.
 */
const BUDGET_BYTES = 4e9;

function fakeControl(over: Partial<RuntimeControl> = {}): RuntimeControl {
  return {
    isInstalled: mock(async () => true),
    listLoaded: mock(async () => [] as { name: string; sizeBytes: number }[]),
    pull: mock(async () => {}),
    warm: mock(async () => {}),
    unload: mock(async () => {}),
    getModelMax: mock(async () => 262144),
    getModelKvArch: mock(async () => undefined),
    ...over,
  };
}

test('degrade-to-4b: resolveModel over real BOOTSTRAP falls back to qwen3.5:4b under 4 GB budget', async () => {
  const control = fakeControl();
  const mgr = createModelManager({
    budgetBytes: BUDGET_BYTES,
    warn: mock(() => {}),
    controlFor: () => control,
  });

  const req = {
    role: 'test-tools',
    requires: [Capability.Tools],
    prefer: PreferPolicy.LargestThatFits,
  };

  const { decl, numCtx } = await resolveModel(req, BOOTSTRAP, {
    ensureReady: mgr.ensureReady,
    listLoaded: control.listLoaded,
  });

  expect(decl.model).toBe('qwen3.5:4b');
  expect(numCtx).toBeGreaterThanOrEqual(4096);
});
