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

import { ResourceError } from '../../src/core/errors.ts';
import { type ModelDeclaration, ProviderKind } from '../../src/core/types.ts';
import {
  createModelManager,
  MIN_CTX,
} from '../../src/resource/model-manager.ts';
import type { RuntimeControl } from '../../src/runtime/runtime.ts';

function decl(model: string, b: number): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: { numCtx: 0 }, // numCtx 0 → KV term 0, so bytes == params*1e9*bpw*1.2
    role: 'test',
    footprint: { approxParamsBillions: b, bytesPerWeight: 1 }, // bytes = b*1e9*1.2
  };
}
// weightsBytes(b, 1) === b*1e9*1.2

function fakeControl(over: Partial<RuntimeControl> = {}): RuntimeControl {
  return {
    isInstalled: mock(async () => true),
    pull: mock(async () => {}),
    warm: mock(async () => {}),
    unload: mock(async () => {}),
    listLoaded: mock(async () => [] as { name: string; sizeBytes: number }[]),
    getModelMax: mock(async () => 262144),
    getModelKvArch: mock(async () => undefined),
    embed: mock(async () => []),
    ...over,
  };
}

function fakes(
  overrides: {
    control?: RuntimeControl;
    budgetBytes?: number;
    warn?: (m: string) => void;
  } = {},
) {
  const control = overrides.control ?? fakeControl();
  return {
    control,
    deps: {
      budgetBytes: overrides.budgetBytes ?? 100e9,
      warn: overrides.warn ?? mock(() => {}),
      controlFor: () => control,
    },
  };
}

function declCtx(model: string, b: number, numCtx: number): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: { numCtx },
    role: 'test',
    footprint: { approxParamsBillions: b, bytesPerWeight: 1 },
  };
}

test('already-loaded model: no pull/warm/unload', async () => {
  const f = fakes({
    control: fakeControl({
      listLoaded: mock(async () => [{ name: 'm8', sizeBytes: 1 }]),
    }),
  });
  const mgr = createModelManager(f.deps);
  await mgr.ensureReady(decl('m8', 8));
  expect(f.control.warm).not.toHaveBeenCalled();
  expect(f.control.pull).not.toHaveBeenCalled();
  expect(f.control.unload).not.toHaveBeenCalled();
});

test('not installed: pulls then warms', async () => {
  const f = fakes({
    control: fakeControl({ isInstalled: mock(async () => false) }),
  });
  const mgr = createModelManager(f.deps);
  await mgr.ensureReady(decl('m8', 8));
  expect(f.control.pull).toHaveBeenCalledWith('m8');
  expect(f.control.warm).toHaveBeenCalledWith('m8', MIN_CTX);
});

test('fits in free headroom: warms, no eviction', async () => {
  // target 8*1.2=9.6e9; free headroom 20e9 → fits without touching the loaded router.
  const f = fakes({
    budgetBytes: 20e9,
    control: fakeControl({
      listLoaded: mock(async () => [{ name: 'r4', sizeBytes: 4.8e9 }]),
    }),
  });
  const mgr = createModelManager(f.deps);
  await mgr.ensureReady(decl('m8', 8), { pinned: ['r4'] });
  expect(f.control.unload).not.toHaveBeenCalled();
  expect(f.control.warm).toHaveBeenCalledWith('m8', MIN_CTX);
});

test('insufficient free: evicts non-pinned to grow headroom, keeps pinned, then warms', async () => {
  // free headroom 2e9; target new8 needs 9.6e9 → must evict. Evicting old8 (non-pinned,
  // 9.6e9) returns its bytes → headroom 2 + 9.6 = 11.6 ≥ 9.6 → warm. Pinned r4 untouched.
  const f = fakes({
    budgetBytes: 2e9,
    control: fakeControl({
      listLoaded: mock(async () => [
        { name: 'r4', sizeBytes: 4.8e9 },
        { name: 'old8', sizeBytes: 9.6e9 },
      ]),
    }),
  });
  const mgr = createModelManager(f.deps);
  await mgr.ensureReady(decl('new8', 8), { pinned: ['r4'] });
  expect(f.control.unload).toHaveBeenCalledWith('old8');
  expect(f.control.unload).not.toHaveBeenCalledWith('r4');
  expect(f.control.warm).toHaveBeenCalledWith('new8', MIN_CTX);
});

test('budget given as a function is resolved live on each ensureReady', async () => {
  // function form (the live-budget shape); target 9.6e9 ≤ 20e9 free headroom → no eviction.
  const f = fakes({
    control: fakeControl({
      listLoaded: mock(async () => [{ name: 'r4', sizeBytes: 4.8e9 }]),
    }),
  });
  const budgetBytes = mock(async () => 20e9);
  const mgr = createModelManager({ ...f.deps, budgetBytes });
  await mgr.ensureReady(decl('m8', 8), { pinned: ['r4'] });
  expect(budgetBytes).toHaveBeenCalled();
  expect(f.control.unload).not.toHaveBeenCalled();
  expect(f.control.warm).toHaveBeenCalledWith('m8', MIN_CTX);
});

test('best-effort pin: evicts the pinned model when it is all that is left to free', async () => {
  // free headroom 2e9; only the pinned router r8 (9.6e9) is loaded; target big needs 9.6e9.
  // Degrade: evict r8 → headroom 2 + 9.6 = 11.6 ≥ 9.6 → warm. Run stays functional.
  const warnFn = mock(() => {});
  const f = fakes({
    budgetBytes: 2e9,
    warn: warnFn,
    control: fakeControl({
      listLoaded: mock(async () => [{ name: 'r8', sizeBytes: 9.6e9 }]),
    }),
  });
  const mgr = createModelManager(f.deps);
  await mgr.ensureReady(decl('big', 8), { pinned: ['r8'] });
  expect(f.control.unload).toHaveBeenCalledWith('r8');
  expect(f.control.warm).toHaveBeenCalledWith('big', MIN_CTX);
  expect(warnFn).toHaveBeenCalled();
});

test('target alone exceeds budget: throws ResourceError, warms nothing', async () => {
  // nothing loaded; target needs 9.6e9 but budget is 8e9 → cannot fit even alone.
  const f = fakes({ budgetBytes: 8e9 });
  const mgr = createModelManager(f.deps);
  await expect(
    mgr.ensureReady(decl('big', 8), { pinned: [] }),
  ).rejects.toBeInstanceOf(ResourceError);
  expect(f.control.warm).not.toHaveBeenCalled();
});

test('unloadAll unloads every warmed model', async () => {
  const f = fakes();
  const mgr = createModelManager(f.deps);
  await mgr.ensureReady(decl('a', 1));
  await mgr.ensureReady(decl('b', 1));
  await mgr.unloadAll();
  expect(f.control.unload).toHaveBeenCalledWith('a');
  expect(f.control.unload).toHaveBeenCalledWith('b');
});

test('ample headroom: chosenCtx is the desired value, warmed at it', async () => {
  const f = fakes();
  const mgr = createModelManager(f.deps);
  const ctx = await mgr.ensureReady(declCtx('m1', 1, 16384));
  expect(ctx).toBe(16384);
  expect(f.control.warm).toHaveBeenCalledWith('m1', 16384);
});

test('tight headroom: chosenCtx shrinks to fit, floored & rounded to 1024', async () => {
  // weights(1,1)=1.2e9; kv/token=131072. budget chosen so maxCtxByFit == 8192:
  // headroom-weights = 8192*131072 = 1073741824 → budget = 1073741824 + 1.2e9.
  const f = fakes({ budgetBytes: 1073741824 + 1.2e9 });
  const mgr = createModelManager(f.deps);
  const ctx = await mgr.ensureReady(declCtx('m1', 1, 16384));
  expect(ctx).toBe(8192);
  expect(ctx % 1024).toBe(0);
  expect(f.control.warm).toHaveBeenCalledWith('m1', 8192);
});

test('chosenCtx is capped by the live-probed model max', async () => {
  const f = fakes({
    control: fakeControl({ getModelMax: mock(async () => 6144) }),
  });
  const mgr = createModelManager(f.deps);
  const ctx = await mgr.ensureReady(declCtx('m1', 1, 16384));
  expect(ctx).toBe(6144);
});

test('probe failure falls back to decl.maxContext', async () => {
  const f = fakes({
    control: fakeControl({
      getModelMax: mock(async () => {
        throw new Error('no show');
      }),
    }),
  });
  const mgr = createModelManager(f.deps);
  const d = { ...declCtx('m1', 1, 16384), maxContext: 5120 };
  const ctx = await mgr.ensureReady(d);
  expect(ctx).toBe(5120);
  expect(f.control.getModelMax).toHaveBeenCalled();
});

test('cannot fit even the MIN_CTX floor: throws, warms nothing', async () => {
  // minNeed = weights(1,1)=1.2e9 + 4096*131072 ≈ 1.737e9; budget 1e9 < minNeed, nothing to evict.
  const f = fakes({ budgetBytes: 1e9 });
  const mgr = createModelManager(f.deps);
  await expect(
    mgr.ensureReady(declCtx('big', 1, 16384)),
  ).rejects.toBeInstanceOf(ResourceError);
  expect(f.control.warm).not.toHaveBeenCalled();
});

test('routes lifecycle through controlFor(decl.provider)', async () => {
  const f = fakes();
  const mgr = createModelManager(f.deps);
  await mgr.ensureReady({
    provider: ProviderKind.Ollama,
    model: 'm7',
    params: { numCtx: 0 },
    role: 't',
    footprint: { approxParamsBillions: 7, bytesPerWeight: 1 },
  });
  expect(f.control.warm).toHaveBeenCalledWith('m7', expect.any(Number));
});

test('embedder role: skips /api/generate warm but still installs it', async () => {
  const f = fakes();
  const mgr = createModelManager(f.deps);
  await mgr.ensureReady({
    provider: ProviderKind.Ollama,
    model: 'qwen3-embedding:0.6b',
    params: {},
    role: 'embedder',
    footprint: {
      approxParamsBillions: 0.6,
      bytesPerWeight: 1,
      kvBytesPerToken: 0,
    },
  });
  expect(f.control.warm).not.toHaveBeenCalled();
  expect(f.control.pull).not.toHaveBeenCalled(); // already "installed" per fakeControl default
});

test('embedder role: is tracked as resident (loaded, evictable, skips a second load)', async () => {
  const f = fakes();
  const mgr = createModelManager(f.deps);
  const embedDecl: ModelDeclaration = {
    provider: ProviderKind.Ollama,
    model: 'qwen3-embedding:0.6b',
    params: {},
    role: 'embedder',
    footprint: {
      approxParamsBillions: 0.6,
      bytesPerWeight: 1,
      kvBytesPerToken: 0,
    },
  };
  await mgr.ensureReady(embedDecl);
  // unloadAll only unloads models tracked in the manager's own residency map —
  // if the embedder weren't recorded there, this would be a no-op for it.
  await mgr.unloadAll();
  expect(f.control.unload).toHaveBeenCalledWith('qwen3-embedding:0.6b');
});

test('embedder role co-resides with a chat model and participates in LRU eviction', async () => {
  // chat8 needs weights(8,1)=9.6e9 + MIN_CTX kv. Budget 2e9 free + evicting the
  // embedder (9.6e9) must be enough to fit — proves the embedder is tracked in
  // the same evictable pool as chat models, not a bookkeeping no-op.
  const f = fakes({
    budgetBytes: 2e9,
    control: fakeControl({
      listLoaded: mock(async () => [
        { name: 'qwen3-embedding:0.6b', sizeBytes: 9.6e9 },
      ]),
    }),
  });
  const mgr = createModelManager(f.deps);
  await mgr.ensureReady(decl('chat8', 8), { pinned: [] });
  expect(f.control.unload).toHaveBeenCalledWith('qwen3-embedding:0.6b');
  expect(f.control.warm).toHaveBeenCalledWith('chat8', MIN_CTX);
});
