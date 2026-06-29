import { expect, test } from 'bun:test';
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

test('notice includes model, size, ctx, budget and install state', () => {
  const s = formatSelectionNotice({
    decl,
    numCtx: 16384,
    budgetBytes: 12.3e9,
    installed: true,
  });
  expect(s).toContain('qwen3.5:9b');
  expect(s).toContain('9B');
  expect(s).toContain('16384');
  expect(s).toContain('installed');
});

test('not-installed notice announces a pull', () => {
  const s = formatSelectionNotice({
    decl,
    numCtx: 16384,
    budgetBytes: 12.3e9,
    installed: false,
  });
  expect(s.toLowerCase()).toContain('pull');
});
