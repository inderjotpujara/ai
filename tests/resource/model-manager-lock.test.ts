import { expect, mock, test } from 'bun:test';
import { type ModelDeclaration, RuntimeKind } from '../../src/core/types.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';

function decl(model: string): ModelDeclaration {
  return {
    runtime: RuntimeKind.Ollama,
    model,
    params: { numCtx: 4096 },
    role: 'general',
    footprint: { approxParamsBillions: 1, bytesPerWeight: 1 },
  };
}

test('concurrent ensureReady calls are serialized (warm never overlaps)', async () => {
  let active = 0;
  let maxActive = 0;
  const control = {
    isInstalled: mock(async () => true),
    listLoaded: mock(async () => []),
    pull: mock(async () => {}),
    unload: mock(async () => {}),
    getModelMax: mock(async () => 8192),
    getModelKvArch: mock(async () => undefined),
    embed: mock(async () => []),
    warm: mock(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    }),
  };
  const m = createModelManager({
    budgetBytes: 1e12,
    warn: () => {},
    controlFor: () => control as never,
  });
  await Promise.all([m.ensureReady(decl('a')), m.ensureReady(decl('b'))]);
  expect(maxActive).toBe(1);
});
