import { afterEach, expect, mock, test } from 'bun:test';
import type { ModelDeclaration } from '../../src/core/types.ts';
import { ProviderKind } from '../../src/core/types.ts';
import type { KvArch } from '../../src/resource/kv-cache.ts';
import {
  createModelManager,
  MIN_CTX,
} from '../../src/resource/model-manager.ts';
import type { RuntimeControl } from '../../src/runtime/runtime.ts';

afterEach(() => {
  delete process.env.AGENT_KV_CACHE_TYPE;
});

const arch: KvArch = {
  blockCount: 32,
  headCountKv: 8,
  keyLength: 128,
  valueLength: 128,
  expertCount: 0,
};
function control(over: Partial<RuntimeControl> = {}): RuntimeControl {
  return {
    isInstalled: mock(async () => true),
    pull: mock(async () => {}),
    warm: mock(async () => {}),
    unload: mock(async () => {}),
    listLoaded: mock(async () => [] as { name: string; sizeBytes: number }[]),
    getModelMax: mock(async () => 262144),
    getModelKvArch: mock(async () => arch),
    embed: mock(async () => []),
    ...over,
  };
}
function decl(numCtx: number): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model: 'm',
    params: { numCtx },
    role: 't',
    footprint: { approxParamsBillions: 1, bytesPerWeight: 0 },
  }; // weights 0 → all headroom is KV
}

test('q8_0 doubles chosenCtx vs f16 for the same budget (per-model arch baseline)', async () => {
  const c = control();
  const f16KvPerTok =
    arch.blockCount *
    arch.headCountKv *
    (arch.keyLength + arch.valueLength) *
    2; // 32*8*256*2
  const budget = f16KvPerTok * 8192; // exactly 8192 tokens at f16
  process.env.AGENT_KV_CACHE_TYPE = 'f16';
  const ctxF16 = await createModelManager({
    budgetBytes: budget,
    warn: () => {},
    controlFor: () => c,
  }).ensureReady(decl(1_000_000));
  process.env.AGENT_KV_CACHE_TYPE = 'q8_0';
  const ctxQ8 = await createModelManager({
    budgetBytes: budget,
    warn: () => {},
    controlFor: () => c,
  }).ensureReady(decl(1_000_000));
  expect(ctxF16).toBe(8192);
  expect(ctxQ8).toBe(16384); // ~2× under q8_0
});

test('arch-risky model under a quantized type triggers a one-time advisory', async () => {
  process.env.AGENT_KV_CACHE_TYPE = 'q8_0';
  const warn = mock((_: string) => {});
  const c = control({
    getModelKvArch: mock(async () => ({
      ...arch,
      keyLength: 64,
      valueLength: 64,
    })),
  }); // small head_dim
  await createModelManager({
    budgetBytes: 100e9,
    warn,
    controlFor: () => c,
  }).ensureReady(decl(8192));
  expect(warn).toHaveBeenCalled();
  expect(warn.mock.calls[0]?.[0] ?? '').toContain('KV');
});

test('probe failure falls back to the 131072 f16 baseline (no throw)', async () => {
  process.env.AGENT_KV_CACHE_TYPE = 'f16';
  const c = control({ getModelKvArch: mock(async () => undefined) });
  const budget = 131072 * 4096; // exactly MIN_CTX at the default baseline
  const ctx = await createModelManager({
    budgetBytes: budget,
    warn: () => {},
    controlFor: () => c,
  }).ensureReady(decl(1_000_000));
  expect(ctx).toBe(MIN_CTX);
});
