import { afterEach, expect, test } from 'bun:test';
import { formatSelectionNotice } from '../../src/cli/selection-notice.ts';
import {
  Capability,
  type ModelDeclaration,
  ProviderKind,
} from '../../src/core/types.ts';

const decl: ModelDeclaration = {
  provider: ProviderKind.Ollama,
  model: 'qwen3.5:9b',
  params: { numCtx: 16384 },
  role: 'general',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: 9, bytesPerWeight: 0.56 },
};

// q8_0 effective KV bytes/token for a typical model: passed explicitly below
const DEFAULT_KV_PER_TOKEN = 131072;
// effective at q8_0 (×0.5)
const DEFAULT_KV_EFFECTIVE = Math.round(DEFAULT_KV_PER_TOKEN * 0.5);

test('notice includes model, size, ctx, budget and install state', () => {
  const s = formatSelectionNotice({
    decl,
    numCtx: 16384,
    kvBytesPerToken: DEFAULT_KV_EFFECTIVE,
    budgetBytes: 12.3e9,
    installed: true,
  });
  expect(s).toContain('qwen3.5:9b');
  expect(s).toContain('9.0B');
  expect(s).toContain('16384');
  expect(s).toContain('installed');
});

test('not-installed notice announces a pull', () => {
  const s = formatSelectionNotice({
    decl,
    numCtx: 16384,
    kvBytesPerToken: DEFAULT_KV_EFFECTIVE,
    budgetBytes: 12.3e9,
    installed: false,
  });
  expect(s.toLowerCase()).toContain('pull');
});

afterEach(() => {
  delete process.env.AGENT_KV_CACHE_TYPE;
});

test('notice labels the active KV cache type', () => {
  process.env.AGENT_KV_CACHE_TYPE = 'q8_0';
  const s = formatSelectionNotice({
    decl,
    numCtx: 16384,
    kvBytesPerToken: DEFAULT_KV_EFFECTIVE,
    budgetBytes: 12.3e9,
    installed: true,
  });
  expect(s).toContain('KV q8_0');
});

test('notice uses "@ N ctx" (chosen, not desired)', () => {
  const s = formatSelectionNotice({
    decl,
    numCtx: 8192,
    kvBytesPerToken: DEFAULT_KV_EFFECTIVE,
    budgetBytes: 12.3e9,
    installed: true,
  });
  expect(s).toContain('@ 8192 ctx');
  expect(s).not.toContain('@ up to');
});

test('large per-model KV/token produces correspondingly large KV GB figure', () => {
  process.env.AGENT_KV_CACHE_TYPE = 'q8_0';
  // gemma-class: 1572864 B/token f16, effective q8_0 = 786432
  const largeKvPerToken = Math.round(1572864 * 0.5);
  const small = formatSelectionNotice({
    decl,
    numCtx: 16384,
    kvBytesPerToken: DEFAULT_KV_EFFECTIVE,
    budgetBytes: 64e9,
    installed: true,
  });
  const large = formatSelectionNotice({
    decl,
    numCtx: 16384,
    kvBytesPerToken: largeKvPerToken,
    budgetBytes: 64e9,
    installed: true,
  });
  // Extract the KV GB number from "KV ≈X.XGB"
  const kvGb = (s: string): number => {
    const v = s.match(/KV ≈([\d.]+)GB/)?.[1];
    return v ? Number.parseFloat(v) : 0;
  };
  expect(kvGb(large)).toBeGreaterThan(kvGb(small) * 3);
});
