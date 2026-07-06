import { expect, mock, test } from 'bun:test';
import { createSelectHook } from '../../src/cli/select-hook.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import { ResourceError } from '../../src/core/errors.ts';
import {
  Capability,
  ContentPolicy,
  type ModelDeclaration,
  PreferPolicy,
  RuntimeKind,
} from '../../src/core/types.ts';
import { uncensoredEnabled } from '../../src/media/policy.ts';
import { selectCandidates } from '../../src/resource/selector.ts';

function m(model: string, policy?: ContentPolicy): ModelDeclaration {
  return {
    runtime: RuntimeKind.Ollama,
    model,
    params: {},
    role: 'r',
    capabilities: [Capability.Tools],
    contentPolicy: policy,
    footprint: { approxParamsBillions: 7, bytesPerWeight: 0.56 },
  };
}

const registry = [m('default-model'), m('unc-model', ContentPolicy.Uncensored)];

const base = {
  role: 'r',
  requires: [Capability.Tools],
  prefer: PreferPolicy.LargestThatFits,
};

test('uncensored candidate is eligible when the switch defaults on', () => {
  // Mirrors select-hook's thread-through: allowUncensored is sourced from
  // uncensoredEnabled() when the agent didn't explicitly set it.
  const allowUncensored = uncensoredEnabled({});
  expect(allowUncensored).toBe(true);
  const survivors = selectCandidates(
    { ...base, allowUncensored },
    registry,
  ).map((d) => d.model);
  expect(survivors.sort()).toEqual(['default-model', 'unc-model']);
});

test('uncensored candidate is excluded when AGENT_UNCENSORED=0', () => {
  const allowUncensored = uncensoredEnabled({ AGENT_UNCENSORED: '0' });
  expect(allowUncensored).toBe(false);
  const survivors = selectCandidates(
    { ...base, allowUncensored },
    registry,
  ).map((d) => d.model);
  expect(survivors).toEqual(['default-model']);
});

// End-to-end: `createSelectHook` builds the requirement passed to `resolveModel`.
// An agent that doesn't set `allowUncensored` should still get an uncensored-only
// registry resolved successfully, because the hook fills it in from the switch.

const uncensoredOnlyRegistry: ModelDeclaration[] = [
  {
    runtime: RuntimeKind.Ollama,
    model: 'unc-only',
    params: {},
    role: 'r',
    capabilities: [Capability.Tools],
    contentPolicy: ContentPolicy.Uncensored,
    footprint: { approxParamsBillions: 7, bytesPerWeight: 0.56 },
  },
];

function specialist(): Agent {
  return {
    name: 'specialist',
    description: 'd',
    systemPrompt: 'sp',
    tools: {},
    model: undefined as never,
    modelReq: {
      role: 'r',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  };
}

test('select-hook defaults allowUncensored from uncensoredEnabled() so an uncensored-only registry resolves', async () => {
  const previous = process.env.AGENT_UNCENSORED;
  delete process.env.AGENT_UNCENSORED; // unset => uncensoredEnabled() === true
  try {
    const ensureReady = mock(async () => 8192);
    const hook = createSelectHook({
      registry: uncensoredOnlyRegistry,
      ensureReady,
      pinned: [],
      capture: {},
    });
    const pre = await hook(specialist());
    expect(pre && 'model' in pre && pre.model).toBeTruthy();
  } finally {
    if (previous === undefined) delete process.env.AGENT_UNCENSORED;
    else process.env.AGENT_UNCENSORED = previous;
  }
});

test('select-hook with AGENT_UNCENSORED=0 aborts against an uncensored-only registry', async () => {
  const previous = process.env.AGENT_UNCENSORED;
  process.env.AGENT_UNCENSORED = '0';
  try {
    const ensureReady = mock(async () => 8192);
    const capture: { error?: ResourceError } = {};
    const hook = createSelectHook({
      registry: uncensoredOnlyRegistry,
      ensureReady,
      pinned: [],
      capture,
    });
    const pre = await hook(specialist());
    expect(pre && 'abort' in pre && pre.abort).toBeTruthy();
    expect(capture.error).toBeInstanceOf(ResourceError);
  } finally {
    if (previous === undefined) delete process.env.AGENT_UNCENSORED;
    else process.env.AGENT_UNCENSORED = previous;
  }
});
