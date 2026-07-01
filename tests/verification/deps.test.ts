import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { RuntimeControl } from '../../src/runtime/runtime.ts';
import { makeVerifyDeps } from '../../src/verification/deps.ts';

const ENV_KEY = 'AGENT_VERIFY_AUTO_PULL';
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env[ENV_KEY];
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnv;
});

/** Minimal fake RuntimeControl — only isInstalled/pull matter for ensureJudge. */
function fakeControl(over: Partial<RuntimeControl> = {}): RuntimeControl {
  return {
    isInstalled: async () => false,
    pull: async () => {},
    warm: async () => {},
    unload: async () => {},
    listLoaded: async () => [],
    getModelMax: async () => undefined,
    getModelKvArch: async () => undefined,
    embed: async () => [],
    ...over,
  };
}

function fakeManager() {
  return { ensureReady: async () => 4096 } as unknown as Parameters<
    typeof makeVerifyDeps
  >[0]['manager'];
}

function fakeStore() {
  return {
    getByIds: async (_space: string, ids: string[]) =>
      ids.map((id) => ({
        id,
        text: 'evidence',
        source: 'kb',
        score: 0,
        namespace: '',
      })),
  } as unknown as Parameters<typeof makeVerifyDeps>[0]['store'];
}

describe('makeVerifyDeps / ensureJudge policy', () => {
  test('installed judge model -> no pull, fallback false', async () => {
    delete process.env[ENV_KEY];
    let pullCalled = false;
    const control = fakeControl({
      isInstalled: async () => true,
      pull: async () => {
        pullCalled = true;
      },
    });
    const deps = makeVerifyDeps({
      manager: fakeManager(),
      control,
      generalModel: 'general-model',
      store: fakeStore(),
      space: 'default',
    });
    const result = await deps.ensureJudge('bespoke-minicheck');
    expect(result).toEqual({ model: 'bespoke-minicheck', fallback: false });
    expect(pullCalled).toBe(false);
  });

  test("not installed + policy 'never' -> fallback to generalModel, no pull", async () => {
    process.env[ENV_KEY] = '0';
    let pullCalled = false;
    const control = fakeControl({
      isInstalled: async () => false,
      pull: async () => {
        pullCalled = true;
      },
    });
    const deps = makeVerifyDeps({
      manager: fakeManager(),
      control,
      generalModel: 'general-model',
      store: fakeStore(),
      space: 'default',
    });
    const result = await deps.ensureJudge('bespoke-minicheck');
    expect(result).toEqual({ model: 'general-model', fallback: true });
    expect(pullCalled).toBe(false);
  });

  test("not installed + policy 'always' -> pull called, fallback false", async () => {
    process.env[ENV_KEY] = '1';
    let pullCalled = false;
    let pulledModel: string | undefined;
    const control = fakeControl({
      isInstalled: async () => false,
      pull: async (m: string) => {
        pullCalled = true;
        pulledModel = m;
      },
    });
    const deps = makeVerifyDeps({
      manager: fakeManager(),
      control,
      generalModel: 'general-model',
      store: fakeStore(),
      space: 'default',
    });
    const result = await deps.ensureJudge('bespoke-minicheck');
    expect(pullCalled).toBe(true);
    expect(pulledModel).toBe('bespoke-minicheck');
    expect(result).toEqual({ model: 'bespoke-minicheck', fallback: false });
  });

  test("not installed + policy 'prompt' + non-TTY -> fallback, no pull", async () => {
    // default (unset) env => 'prompt'; test runner stdin is not a TTY.
    delete process.env[ENV_KEY];
    let pullCalled = false;
    const control = fakeControl({
      isInstalled: async () => false,
      pull: async () => {
        pullCalled = true;
      },
    });
    const deps = makeVerifyDeps({
      manager: fakeManager(),
      control,
      generalModel: 'general-model',
      store: fakeStore(),
      space: 'default',
    });
    const result = await deps.ensureJudge('bespoke-minicheck');
    expect(result).toEqual({ model: 'general-model', fallback: true });
    expect(pullCalled).toBe(false);
  });

  test('getByIds delegates to store.getByIds', async () => {
    const deps = makeVerifyDeps({
      manager: fakeManager(),
      control: fakeControl(),
      generalModel: 'general-model',
      store: fakeStore(),
      space: 'default',
    });
    const results = await deps.getByIds('default', ['a#0', 'b#1']);
    expect(results.map((r) => r.id)).toEqual(['a#0', 'b#1']);
  });
});
