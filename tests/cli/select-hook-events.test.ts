import { expect, mock, test } from 'bun:test';
import type { LanguageModel } from 'ai';
import { createSelectHook } from '../../src/cli/select-hook.ts';
import {
  ModelLoadAction,
  type StatusEvent,
  StatusEventType,
} from '../../src/contracts/index.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import type { ModelDeclaration } from '../../src/core/types.ts';
import { Capability, PreferPolicy, RuntimeKind } from '../../src/core/types.ts';
import type { Runtime } from '../../src/runtime/runtime.ts';

/** A minimal stub runtime for injecting via `SelectHookDeps.runtimeFor` in tests,
 *  mirroring the fake used in tests/cli/select-hook.test.ts. */
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

const ollamaDecl: ModelDeclaration = {
  runtime: RuntimeKind.Ollama,
  model: 'qwen3.5:4b',
  params: {},
  role: 'general reasoning + tool use',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.55 },
};

const mlxDecl: ModelDeclaration = {
  runtime: RuntimeKind.MlxServer,
  model: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
  params: {},
  role: 'general reasoning + tool use',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: 7, bytesPerWeight: 0.55 },
};

test('hook emits a ModelSelect event with the agent + chosen model', async () => {
  const ensureReady = mock(async () => 8192);
  const events = mock((_e: StatusEvent) => {});
  const hook = createSelectHook({
    registry: [ollamaDecl],
    ensureReady,
    pinned: [],
    capture: {},
    runtimeFor: (kind) => fakeRuntime(kind, true),
    events,
  });
  const pre = await hook(specialist());
  expect(pre && 'model' in pre && pre.model).toBeTruthy();

  const selectEvents = events.mock.calls
    .map((c) => c[0])
    .filter((e) => e.type === StatusEventType.ModelSelect);
  expect(selectEvents).toHaveLength(1);
  expect(selectEvents[0]).toMatchObject({
    type: StatusEventType.ModelSelect,
    agent: 'file_qa',
    model: ollamaDecl.model,
    numCtx: 8192,
    degraded: false,
  });
});

test('hook emits a ModelLoad(warm) event when it explicitly warms a managed runtime', async () => {
  const ensureReady = mock(async () => 8192);
  const events = mock((_e: StatusEvent) => {});
  const hook = createSelectHook({
    registry: [mlxDecl],
    ensureReady,
    pinned: [],
    capture: {},
    runtimeFor: (kind) => fakeRuntime(kind, true),
    events,
  });
  const pre = await hook(specialist());
  expect(pre && 'model' in pre && pre.model).toBeTruthy();

  const loadEvents = events.mock.calls
    .map((c) => c[0])
    .filter((e) => e.type === StatusEventType.ModelLoad);
  expect(loadEvents).toHaveLength(1);
  expect(loadEvents[0]).toMatchObject({
    type: StatusEventType.ModelLoad,
    model: mlxDecl.model,
    action: ModelLoadAction.Warm,
  });
});

test('hook does NOT emit ModelLoad for Ollama (no explicit warm on that path)', async () => {
  const ensureReady = mock(async () => 8192);
  const events = mock((_e: StatusEvent) => {});
  const hook = createSelectHook({
    registry: [ollamaDecl],
    ensureReady,
    pinned: [],
    capture: {},
    runtimeFor: (kind) => fakeRuntime(kind, true),
    events,
  });
  await hook(specialist());

  const loadEvents = events.mock.calls
    .map((c) => c[0])
    .filter((e) => e.type === StatusEventType.ModelLoad);
  expect(loadEvents).toHaveLength(0);
});
