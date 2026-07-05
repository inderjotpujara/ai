import { expect, mock, test } from 'bun:test';
import type { LanguageModel } from 'ai';
import { createSelectHook } from '../../src/cli/select-hook.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import type { ModelDeclaration } from '../../src/core/types.ts';
import { Capability, PreferPolicy, RuntimeKind } from '../../src/core/types.ts';
import { createLedger, DegradeKind } from '../../src/reliability/ledger.ts';
import type { Runtime } from '../../src/runtime/runtime.ts';

/** Mirrors the fake runtime stub in tests/cli/select-hook.test.ts. */
function fakeRuntime(kind: RuntimeKind, available: boolean): Runtime {
  return {
    kind,
    isAvailable: async () => available,
    createModel: () => ({ modelId: kind }) as unknown as LanguageModel,
    control: {
      isInstalled: async () => true,
      pull: async () => {},
      warm: async () => {},
      unload: async () => {},
      listLoaded: async () => [],
      getModelMax: async () => undefined,
      getModelKvArch: async () => undefined,
      embed: async () => [],
    },
  };
}

function specialist(): Agent {
  return {
    name: 'file_qa',
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

const mlxDecl: ModelDeclaration = {
  runtime: RuntimeKind.MlxServer,
  model: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
  params: {},
  role: 'general reasoning + tool use',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: 7, bytesPerWeight: 0.55 },
};

test('hook records a ModelDegraded ledger event when it falls back to Ollama', async () => {
  const ensureReady = mock(async () => 8192);
  const ledger = createLedger();
  const hook = createSelectHook({
    registry: [mlxDecl],
    ensureReady,
    pinned: [],
    capture: {},
    runtimeFor: (kind) => fakeRuntime(kind, kind === RuntimeKind.Ollama),
    log: () => {},
    ledger,
  });
  await hook(specialist());
  expect(ledger.events).toHaveLength(1);
  expect(ledger.events[0]).toMatchObject({
    kind: DegradeKind.ModelDegraded,
    subject: mlxDecl.model,
  });
});

test('hook does not record a ledger event on the non-degraded happy path', async () => {
  const ensureReady = mock(async () => 8192);
  const ledger = createLedger();
  const hook = createSelectHook({
    registry: [mlxDecl],
    ensureReady,
    pinned: [],
    capture: {},
    runtimeFor: (kind) => fakeRuntime(kind, true),
    log: () => {},
    ledger,
  });
  await hook(specialist());
  expect(ledger.events).toHaveLength(0);
});
