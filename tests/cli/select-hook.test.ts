import type { LanguageModel } from 'ai';
import { expect, mock, test } from 'bun:test';
import { BOOTSTRAP } from '../../models/registry.ts';
import { createSelectHook } from '../../src/cli/select-hook.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import { ResourceError } from '../../src/core/errors.ts';
import type { ModelDeclaration } from '../../src/core/types.ts';
import {
  Capability,
  PreferPolicy,
  RuntimeKind,
} from '../../src/core/types.ts';
import type { Runtime } from '../../src/runtime/runtime.ts';

/** A minimal stub runtime for injecting via `SelectHookDeps.runtimeFor` in tests,
 *  so degrade behavior can be exercised without a live MLX/Ollama server. */
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
    model: undefined as never, // overridden by the hook
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

test('hook builds via MLX runtime for MlxServer decl when MLX is available: model defined, numCtx undefined, no degrade', async () => {
  const ensureReady = mock(async () => 8192);
  const capture = {};
  const log = mock((_msg: string) => {});
  const hook = createSelectHook({
    registry: [mlxDecl],
    ensureReady,
    pinned: [],
    capture,
    runtimeFor: (kind) => fakeRuntime(kind, true),
    log,
  });
  const pre = await hook(specialist());
  expect(pre && 'model' in pre && pre.model).toBeTruthy();
  // numCtx is undefined for non-Ollama providers — num_ctx is an Ollama-specific option
  expect(pre && 'numCtx' in pre ? pre.numCtx : 'absent').toBeUndefined();
  expect(log).not.toHaveBeenCalled();
});

test('hook degrades to Ollama when the declared MLX runtime is unreachable: no throw, degrade logged', async () => {
  const ensureReady = mock(async () => 8192);
  const capture = {};
  const log = mock((_msg: string) => {});
  const hook = createSelectHook({
    registry: [mlxDecl],
    ensureReady,
    pinned: [],
    capture,
    runtimeFor: (kind) =>
      fakeRuntime(kind, kind === RuntimeKind.Ollama), // only Ollama is reachable
    log,
  });
  const pre = await hook(specialist());
  expect(pre && 'model' in pre && pre.model).toBeTruthy();
  // Degraded to Ollama, so the Ollama-specific numCtx option is passed through.
  expect(pre && 'numCtx' in pre ? pre.numCtx : 'absent').toBe(8192);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0]?.[0]).toContain('MlxServer');
  expect(log.mock.calls[0]?.[0]).toContain('Ollama');
});

test('hook degrades using fallbackModel: Ollama receives the fallback tag, not the unresolvable MLX id', async () => {
  const declWithFallback: ModelDeclaration = {
    ...mlxDecl,
    fallbackModel: 'qwen2.5:7b-instruct',
  };
  const ensureReady = mock(async () => 8192);
  const capture = {};
  const log = mock((_msg: string) => {});
  let seenModelId: string | undefined;
  const capturingFakeRuntime = (kind: RuntimeKind, available: boolean): Runtime => ({
    kind,
    isAvailable: async () => available,
    createModel: (decl: ModelDeclaration) => {
      if (kind === RuntimeKind.Ollama) seenModelId = decl.model;
      return { modelId: kind } as unknown as LanguageModel;
    },
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
  });
  const hook = createSelectHook({
    registry: [declWithFallback],
    ensureReady,
    pinned: [],
    capture,
    runtimeFor: (kind) =>
      capturingFakeRuntime(kind, kind === RuntimeKind.Ollama),
    log,
  });
  const pre = await hook(specialist());
  expect(pre && 'model' in pre && pre.model).toBeTruthy();
  expect(seenModelId).toBe('qwen2.5:7b-instruct');
  expect(seenModelId).not.toBe(declWithFallback.model);
});
