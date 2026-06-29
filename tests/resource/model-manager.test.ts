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

test('fits alongside pinned: warms, no eviction', async () => {
  // pinned router (4*1.2=4.8e9) loaded; target 8*1.2=9.6e9; budget 20e9 → fits
  const f = fakes({
    listLoaded: mock(async () => [{ name: 'r4', sizeBytes: 4.8e9 }]),
  });
  const mgr = createModelManager({ budgetBytes: 20e9, ...f });
  await mgr.ensureReady(decl('m8', 8), { pinned: ['r4'] });
  expect(f.unload).not.toHaveBeenCalled();
  expect(f.warm).toHaveBeenCalledWith('m8');
});

test('over budget: evicts non-pinned, keeps pinned, then warms', async () => {
  // resident: r4 (pinned 4.8e9) + old8 (9.6e9) = 14.4e9; target new8 9.6e9; budget 16e9
  // must evict old8 (non-pinned); after evict resident 4.8 + 9.6 = 14.4 <= 16 → warm
  const f = fakes({
    listLoaded: mock(async () => [
      { name: 'r4', sizeBytes: 4.8e9 },
      { name: 'old8', sizeBytes: 9.6e9 },
    ]),
  });
  const mgr = createModelManager({ budgetBytes: 16e9, ...f });
  await mgr.ensureReady(decl('new8', 8), { pinned: ['r4'] });
  expect(f.unload).toHaveBeenCalledWith('old8');
  expect(f.unload).not.toHaveBeenCalledWith('r4');
  expect(f.warm).toHaveBeenCalledWith('new8');
});

test('cannot fit with pinned: throws ResourceError, warms nothing', async () => {
  // pinned r8 resident 9.6e9; target big 9.6e9; budget 12e9 → 9.6+9.6 > 12 and only pinned remains
  const f = fakes({
    listLoaded: mock(async () => [{ name: 'r8', sizeBytes: 9.6e9 }]),
  });
  const mgr = createModelManager({ budgetBytes: 12e9, ...f });
  await expect(
    mgr.ensureReady(decl('big', 8), { pinned: ['r8'] }),
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
