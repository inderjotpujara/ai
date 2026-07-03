import { afterAll, beforeAll, expect, mock, test } from 'bun:test';

let __prevKv: string | undefined;
beforeAll(() => {
  __prevKv = process.env.AGENT_KV_CACHE_TYPE;
  process.env.AGENT_KV_CACHE_TYPE = 'f16';
});
afterAll(() => {
  if (__prevKv === undefined) delete process.env.AGENT_KV_CACHE_TYPE;
  else process.env.AGENT_KV_CACHE_TYPE = __prevKv;
});

import { type ModelDeclaration, RuntimeKind } from '../../src/core/types.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';
import type { RuntimeControl } from '../../src/runtime/runtime.ts';

function decl(model: string, role: string): ModelDeclaration {
  return {
    runtime: RuntimeKind.Ollama,
    model,
    params: { numCtx: 0 },
    role,
    footprint: { approxParamsBillions: 4, bytesPerWeight: 1 },
  };
}

test('two agents sharing a model warm it once (reuse the resident copy)', async () => {
  const warmed = new Set<string>();
  const warm = mock(async (model: string) => {
    warmed.add(model);
  });
  const control: RuntimeControl = {
    isInstalled: mock(async () => true),
    pull: mock(async () => {}),
    warm,
    unload: mock(async () => {}),
    // reflect what has been warmed so far → the manager's already-loaded fast path triggers
    listLoaded: mock(async () =>
      [...warmed].map((name) => ({ name, sizeBytes: 1 })),
    ),
    getModelMax: mock(async () => 262144),
    getModelKvArch: mock(async () => undefined),
    embed: mock(async () => []),
  };
  const mgr = createModelManager({
    budgetBytes: 100e9,
    warn: mock(() => {}),
    controlFor: () => control,
  });

  // Agent A and Agent B both resolve to the SAME model string 'shared:7b'.
  await mgr.ensureReady(decl('shared:7b', 'agent_a'));
  await mgr.ensureReady(decl('shared:7b', 'agent_b'));

  expect(warm).toHaveBeenCalledTimes(1); // one resident copy, not duplicated per agent
});
