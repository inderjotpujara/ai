import { expect, mock, test } from 'bun:test';
import { ResourceError } from '../../src/core/errors.ts';
import { type ModelDeclaration, ProviderKind } from '../../src/core/types.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';

function decl(model: string, b: number): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: { numCtx: 0 }, // numCtx 0 → KV term 0, so bytes == params*1e9*bpw*1.2
    role: 'test',
    footprint: { approxParamsBillions: b, bytesPerWeight: 1 }, // bytes = b*1e9*1.2
  };
}
// declBytes(decl(_, b)) === b*1e9*1.2

function fakes(
  overrides: Partial<Parameters<typeof createModelManager>[0]> = {},
) {
  return {
    isInstalled: mock(async () => true),
    listLoaded: mock(async () => [] as { name: string; sizeBytes: number }[]),
    pull: mock(async () => {}),
    warm: mock(async () => {}),
    unload: mock(async () => {}),
    warn: mock(() => {}), // no-op so eviction warnings never leak to console
    ...overrides,
  };
}

test('already-loaded model: no pull/warm/unload', async () => {
  const f = fakes({
    listLoaded: mock(async () => [{ name: 'm8', sizeBytes: 1 }]),
  });
  const mgr = createModelManager({ budgetBytes: 100e9, ...f });
  await mgr.ensureReady(decl('m8', 8));
  expect(f.warm).not.toHaveBeenCalled();
  expect(f.pull).not.toHaveBeenCalled();
  expect(f.unload).not.toHaveBeenCalled();
});

test('not installed: pulls then warms', async () => {
  const f = fakes({ isInstalled: mock(async () => false) });
  const mgr = createModelManager({ budgetBytes: 100e9, ...f });
  await mgr.ensureReady(decl('m8', 8));
  expect(f.pull).toHaveBeenCalledWith('m8');
  expect(f.warm).toHaveBeenCalledWith('m8');
});

test('fits in free headroom: warms, no eviction', async () => {
  // target 8*1.2=9.6e9; free headroom 20e9 → fits without touching the loaded router.
  const f = fakes({
    listLoaded: mock(async () => [{ name: 'r4', sizeBytes: 4.8e9 }]),
  });
  const mgr = createModelManager({ budgetBytes: 20e9, ...f });
  await mgr.ensureReady(decl('m8', 8), { pinned: ['r4'] });
  expect(f.unload).not.toHaveBeenCalled();
  expect(f.warm).toHaveBeenCalledWith('m8');
});

test('insufficient free: evicts non-pinned to grow headroom, keeps pinned, then warms', async () => {
  // free headroom 2e9; target new8 needs 9.6e9 → must evict. Evicting old8 (non-pinned,
  // 9.6e9) returns its bytes → headroom 2 + 9.6 = 11.6 ≥ 9.6 → warm. Pinned r4 untouched.
  const f = fakes({
    listLoaded: mock(async () => [
      { name: 'r4', sizeBytes: 4.8e9 },
      { name: 'old8', sizeBytes: 9.6e9 },
    ]),
  });
  const mgr = createModelManager({ budgetBytes: 2e9, ...f });
  await mgr.ensureReady(decl('new8', 8), { pinned: ['r4'] });
  expect(f.unload).toHaveBeenCalledWith('old8');
  expect(f.unload).not.toHaveBeenCalledWith('r4');
  expect(f.warm).toHaveBeenCalledWith('new8');
});

test('budget given as a function is resolved live on each ensureReady', async () => {
  // function form (the live-budget shape); target 9.6e9 ≤ 20e9 free headroom → no eviction.
  const f = fakes({
    listLoaded: mock(async () => [{ name: 'r4', sizeBytes: 4.8e9 }]),
  });
  const budgetBytes = mock(async () => 20e9);
  const mgr = createModelManager({ budgetBytes, ...f });
  await mgr.ensureReady(decl('m8', 8), { pinned: ['r4'] });
  expect(budgetBytes).toHaveBeenCalled();
  expect(f.unload).not.toHaveBeenCalled();
  expect(f.warm).toHaveBeenCalledWith('m8');
});

test('best-effort pin: evicts the pinned model when it is all that is left to free', async () => {
  // free headroom 2e9; only the pinned router r8 (9.6e9) is loaded; target big needs 9.6e9.
  // Degrade: evict r8 → headroom 2 + 9.6 = 11.6 ≥ 9.6 → warm. Run stays functional.
  const f = fakes({
    listLoaded: mock(async () => [{ name: 'r8', sizeBytes: 9.6e9 }]),
  });
  const mgr = createModelManager({ budgetBytes: 2e9, ...f });
  await mgr.ensureReady(decl('big', 8), { pinned: ['r8'] });
  expect(f.unload).toHaveBeenCalledWith('r8');
  expect(f.warm).toHaveBeenCalledWith('big');
  expect(f.warn).toHaveBeenCalled();
});

test('target alone exceeds budget: throws ResourceError, warms nothing', async () => {
  // nothing loaded; target needs 9.6e9 but budget is 8e9 → cannot fit even alone.
  const f = fakes();
  const mgr = createModelManager({ budgetBytes: 8e9, ...f });
  await expect(
    mgr.ensureReady(decl('big', 8), { pinned: [] }),
  ).rejects.toBeInstanceOf(ResourceError);
  expect(f.warm).not.toHaveBeenCalled();
});

test('unloadAll unloads every warmed model', async () => {
  const f = fakes();
  const mgr = createModelManager({ budgetBytes: 100e9, ...f });
  await mgr.ensureReady(decl('a', 1));
  await mgr.ensureReady(decl('b', 1));
  await mgr.unloadAll();
  expect(f.unload).toHaveBeenCalledWith('a');
  expect(f.unload).toHaveBeenCalledWith('b');
});
