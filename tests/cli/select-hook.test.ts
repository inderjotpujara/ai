import { expect, mock, test } from 'bun:test';
import { BOOTSTRAP } from '../../models/registry.ts';
import { createSelectHook } from '../../src/cli/select-hook.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import { ResourceError } from '../../src/core/errors.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';

function specialist(): Agent {
  return {
    name: 'file_qa',
    description: 'd',
    systemPrompt: 'sp',
    tools: {},
    model: undefined as never, // overridden by the hook
    modelReq: {
      role: 'r',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  };
}

test('hook resolves a model + numCtx and returns a bound model', async () => {
  const ensureReady = mock(async () => 16384);
  const capture = {};
  const hook = createSelectHook({
    registry: BOOTSTRAP,
    ensureReady,
    pinned: ['qwen3.5:4b'],
    capture,
  });
  const pre = await hook(specialist());
  expect(pre && 'model' in pre && pre.model).toBeTruthy();
  expect(pre && 'numCtx' in pre && pre.numCtx).toBe(16384);
});

test('hook records ResourceError into capture and returns abort', async () => {
  const ensureReady = mock(async () => {
    throw new ResourceError('no fit');
  });
  const capture: { error?: ResourceError } = {};
  const hook = createSelectHook({
    registry: BOOTSTRAP,
    ensureReady,
    pinned: ['qwen3.5:4b'],
    capture,
  });
  const pre = await hook(specialist());
  expect(capture.error).toBeInstanceOf(ResourceError);
  expect(pre && 'abort' in pre && pre.abort).toBeTruthy();
});

test('agent without modelReq is a no-op', async () => {
  const ensureReady = mock(async () => 0);
  const hook = createSelectHook({
    registry: BOOTSTRAP,
    ensureReady,
    pinned: [],
    capture: {},
  });
  const pre = await hook({
    name: 'x',
    description: 'd',
    systemPrompt: 's',
    tools: {},
    model: undefined as never,
  });
  expect(pre).toEqual({});
  expect(ensureReady).not.toHaveBeenCalled();
});
