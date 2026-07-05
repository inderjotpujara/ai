import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { RuntimeKind } from '../../src/core/types.ts';
import { resetBreakers } from '../../src/reliability/breaker.ts';
import {
  createManagedRuntime,
  type RuntimeStrategy,
} from '../../src/runtime/managed-openai-compatible.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

beforeEach(() => {
  // The breaker registry is a shared module-level Map keyed by
  // `runtime:<kind>` — without a reset, a breaker tripped/half-opened by an
  // earlier test (e.g. the "emits outcome=failed" test below) would leak
  // state into later tests reusing the same RuntimeKind.
  resetBreakers();
});

const spawn: SpawnFn = () => ({ pid: 1, kill: () => {}, onExit: () => {} });
const health = (async () =>
  new Response(
    JSON.stringify({ data: [{ id: 'm', max_context_length: 4096 }] }),
    { status: 200 },
  )) as unknown as typeof fetch;

function relaunchStrategy(seen: number[]): RuntimeStrategy {
  return {
    kind: RuntimeKind.LlamaCpp,
    detect: async () => true,
    contextCapability: 'relaunch',
    defaultPort: 8080,
    healthPath: '/health',
    launch: (model, numCtx, port) => {
      seen.push(numCtx ?? -1);
      return {
        cmd: 'llama-server',
        args: ['-m', model, '-c', String(numCtx), '--port', String(port)],
        port,
      };
    },
  };
}

test('warm launches with the requested context (relaunch capability)', async () => {
  const seen: number[] = [];
  const rt = createManagedRuntime(relaunchStrategy(seen), {
    spawn,
    fetchImpl: health,
    startTimeoutMs: 2000,
  });
  await rt.control.warm('m', 8192);
  expect(seen).toEqual([8192]);
});

test('warm reuses the server for the same (model, ctx) — no relaunch', async () => {
  const seen: number[] = [];
  const rt = createManagedRuntime(relaunchStrategy(seen), {
    spawn,
    fetchImpl: health,
    startTimeoutMs: 2000,
  });
  await rt.control.warm('m', 8192);
  await rt.control.warm('m', 8192);
  expect(seen).toEqual([8192]); // launched once
});

test('warm relaunches on a fresh port when model/ctx changes (avoids port collision)', async () => {
  const seen: number[] = [];
  const ports: number[] = [];
  const strat: RuntimeStrategy = {
    kind: RuntimeKind.LlamaCpp,
    detect: async () => true,
    contextCapability: 'relaunch',
    defaultPort: 8080,
    healthPath: '/health',
    launch: (model, numCtx, port) => {
      seen.push(numCtx ?? -1);
      ports.push(port);
      return {
        cmd: 'llama-server',
        args: ['-m', model, '-c', String(numCtx), '--port', String(port)],
        port,
      };
    },
  };
  let next = 10000;
  const portAlloc = async (): Promise<number> => next++;
  const rt = createManagedRuntime(strat, {
    spawn,
    fetchImpl: health,
    startTimeoutMs: 2000,
    portAlloc,
  });
  await rt.control.warm('m', 8192);
  await rt.control.warm('m', 4096); // ctx changed => must relaunch on a NEW port
  expect(seen).toEqual([8192, 4096]);
  expect(ports.length).toBe(2);
  expect(ports[0]).not.toBe(ports[1]);
});

test('fixed-capability strategy does not thread numCtx into the launcher', async () => {
  const seen: (number | undefined)[] = [];
  const strat: RuntimeStrategy = {
    kind: RuntimeKind.MlxServer,
    detect: async () => true,
    contextCapability: 'fixed',
    defaultPort: 8080,
    healthPath: '/v1/models',
    launch: (model, numCtx, port) => {
      seen.push(numCtx);
      return {
        cmd: 'mlx_lm.server',
        args: ['--model', model, '--port', String(port)],
        port,
      };
    },
  };
  const rt = createManagedRuntime(strat, {
    spawn,
    fetchImpl: health,
    startTimeoutMs: 2000,
  });
  await rt.control.warm('m', 8192);
  expect(rt.kind).toBe(RuntimeKind.MlxServer);
  // The base must call launch(model, undefined, port) for 'fixed' — the
  // strategy never sees the requested numCtx, proving it is not threaded in.
  expect(seen).toEqual([undefined]);
});

test('getModelMax reads /v1/models like the MLX adapter', async () => {
  const rt = createManagedRuntime(relaunchStrategy([]), {
    spawn,
    fetchImpl: health,
    startTimeoutMs: 2000,
  });
  await rt.control.warm('m', 4096);
  expect(await rt.control.getModelMax('m')).toBe(4096);
});

test('daemonLoad path (LM Studio-style) warms without spawning a process', async () => {
  const seenLoads: Array<{ model: string; numCtx: number | undefined }> = [];
  const strat: RuntimeStrategy = {
    kind: RuntimeKind.LmStudio,
    detect: async () => true,
    contextCapability: 'reload',
    defaultPort: 1234,
    healthPath: '/v1/models',
    daemonLoad: async (model, numCtx) => {
      seenLoads.push({ model, numCtx });
      return { baseUrl: 'http://127.0.0.1:1234/v1' };
    },
  };
  const rt = createManagedRuntime(strat, { fetchImpl: health });
  await rt.control.warm('m', 4096);
  expect(seenLoads).toEqual([{ model: 'm', numCtx: 4096 }]);
});

test('isAvailable delegates to strategy.detect', async () => {
  const rt = createManagedRuntime(relaunchStrategy([]), {
    spawn,
    fetchImpl: health,
  });
  expect(await rt.isAvailable()).toBe(true);
});

test('control.isInstalled reflects the runtime model list', async () => {
  const rt = createManagedRuntime(relaunchStrategy([]), {
    spawn,
    fetchImpl: health,
  });
  expect(await rt.control.isInstalled('m')).toBe(true);
  expect(await rt.control.isInstalled('other')).toBe(false);
});

test('control.pull throws — downloads are not managed here', async () => {
  const rt = createManagedRuntime(relaunchStrategy([]), {
    spawn,
    fetchImpl: health,
  });
  await expect(rt.control.pull('m')).rejects.toThrow();
});

test('control.embed throws MemoryError', async () => {
  const rt = createManagedRuntime(relaunchStrategy([]), {
    spawn,
    fetchImpl: health,
  });
  await expect(rt.control.embed('m', ['x'])).rejects.toThrow();
});

test('control.getModelKvArch is undefined', async () => {
  const rt = createManagedRuntime(relaunchStrategy([]), {
    spawn,
    fetchImpl: health,
  });
  expect(await rt.control.getModelKvArch('m')).toBeUndefined();
});

test('control.unload stops the supervised server', async () => {
  let killed = false;
  const spawnTracking: SpawnFn = () => ({
    pid: 1,
    kill: () => {
      killed = true;
    },
    onExit: () => {},
  });
  const rt = createManagedRuntime(relaunchStrategy([]), {
    spawn: spawnTracking,
    fetchImpl: health,
    startTimeoutMs: 2000,
  });
  await rt.control.warm('m', 4096);
  await rt.control.unload('m');
  expect(killed).toBe(true);
});

test('control.unload invokes daemonUnload for daemon-style (reload-capability) strategies', async () => {
  const unloadedModels: string[] = [];
  const strat: RuntimeStrategy = {
    kind: RuntimeKind.LmStudio,
    detect: async () => true,
    contextCapability: 'reload',
    defaultPort: 1234,
    healthPath: '/v1/models',
    daemonLoad: async () => ({ baseUrl: 'http://127.0.0.1:1234/v1' }),
    daemonUnload: async (model) => {
      unloadedModels.push(model);
    },
  };
  const rt = createManagedRuntime(strat, { fetchImpl: health });
  await rt.control.warm('m', 4096);
  await rt.control.unload('m');
  expect(unloadedModels).toEqual(['m']);
});

describe('warm concurrency (Slice 26 final review — single-flight)', () => {
  test('two concurrent warm() calls for the SAME (model, ctx) — spawn/launch invoked exactly once', async () => {
    let launchCount = 0;
    const strat: RuntimeStrategy = {
      kind: RuntimeKind.LlamaCpp,
      detect: async () => true,
      contextCapability: 'relaunch',
      defaultPort: 8080,
      healthPath: '/health',
      launch: (model, numCtx, port) => {
        launchCount++;
        return {
          cmd: 'llama-server',
          args: ['-m', model, '-c', String(numCtx), '--port', String(port)],
          port,
        };
      },
    };
    const rt = createManagedRuntime(strat, {
      spawn,
      fetchImpl: health,
      startTimeoutMs: 2000,
    });
    await Promise.all([rt.control.warm('m', 4096), rt.control.warm('m', 4096)]);
    // Without serialization both calls would race past the `current` reuse
    // check before either sets it, launching twice and orphaning one server.
    expect(launchCount).toBe(1);
  });

  test('two concurrent warm() calls for DIFFERENT models — serialized: first is stopped before the second spawns, no orphan', async () => {
    let nextPid = 1;
    const killedPids: number[] = [];
    const spawnTracking: SpawnFn = () => {
      const pid = nextPid++;
      return {
        pid,
        kill: () => {
          killedPids.push(pid);
        },
        onExit: () => {},
      };
    };
    const launched: string[] = [];
    const strat: RuntimeStrategy = {
      kind: RuntimeKind.LlamaCpp,
      detect: async () => true,
      contextCapability: 'relaunch',
      defaultPort: 8080,
      healthPath: '/health',
      launch: (model, numCtx, port) => {
        launched.push(model);
        return {
          cmd: 'llama-server',
          args: ['-m', model, '-c', String(numCtx), '--port', String(port)],
          port,
        };
      },
    };
    let nextPort = 30000;
    const portAlloc = async (): Promise<number> => nextPort++;
    const rt = createManagedRuntime(strat, {
      spawn: spawnTracking,
      fetchImpl: health,
      startTimeoutMs: 2000,
      portAlloc,
    });
    await Promise.all([
      rt.control.warm('m1', 4096),
      rt.control.warm('m2', 4096),
    ]);
    // Serialized in call order (single-threaded JS: both warm() calls run
    // synchronously up to their first await, so the queue order matches
    // Promise.all's array order) — no interleaving.
    expect(launched).toEqual(['m1', 'm2']);
    // Exactly one server (pid 1, the first) was stopped before the second
    // was spawned — proves the two warms never overlapped mid-flight.
    expect(killedPids).toEqual([1]);
  });

  test('a warm() that throws releases the lock — a subsequent warm() still runs', async () => {
    let calls = 0;
    const strat: RuntimeStrategy = {
      kind: RuntimeKind.LlamaCpp,
      detect: async () => true,
      contextCapability: 'relaunch',
      defaultPort: 8080,
      healthPath: '/health',
      launch: (model, numCtx, port) => {
        calls++;
        if (calls === 1) throw new Error('boom');
        return {
          cmd: 'llama-server',
          args: ['-m', model, '-c', String(numCtx), '--port', String(port)],
          port,
        };
      },
    };
    const rt = createManagedRuntime(strat, {
      spawn,
      fetchImpl: health,
      startTimeoutMs: 2000,
    });
    await expect(rt.control.warm('m1', 4096)).rejects.toThrow('boom');
    // If the failed warm wedged the queue, this would hang/never resolve.
    await rt.control.warm('m2', 4096);
    expect(calls).toBe(2);
  });
});

describe('runtime.warm telemetry (Slice 26 Task 8)', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    ({ exporter, provider } = registerTestProvider());
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  function runtimeWarmSpans() {
    return exporter.getFinishedSpans().filter((s) => s.name === 'runtime.warm');
  }

  test('emits outcome=spawned on first warm and outcome=reused on the same (model, ctx)', async () => {
    const rt = createManagedRuntime(relaunchStrategy([]), {
      spawn,
      fetchImpl: health,
      startTimeoutMs: 2000,
    });
    await rt.control.warm('m', 8192);
    await rt.control.warm('m', 8192);
    const spans = runtimeWarmSpans();
    expect(spans.length).toBe(2);
    expect(spans[0]?.attributes[ATTR.RUNTIME_KIND]).toBe(RuntimeKind.LlamaCpp);
    expect(spans[0]?.attributes[ATTR.RUNTIME_WARM_OUTCOME]).toBe('spawned');
    expect(spans[0]?.attributes[ATTR.RUNTIME_CONTEXT_REQUESTED]).toBe(8192);
    expect(spans[0]?.attributes[ATTR.RUNTIME_CONTEXT_APPLIED]).toBe(8192);
    expect(spans[1]?.attributes[ATTR.RUNTIME_WARM_OUTCOME]).toBe('reused');
  });

  test('emits outcome=daemon-loaded for daemon strategies (LM Studio-style)', async () => {
    const strat: RuntimeStrategy = {
      kind: RuntimeKind.LmStudio,
      detect: async () => true,
      contextCapability: 'reload',
      defaultPort: 1234,
      healthPath: '/v1/models',
      daemonLoad: async (_model, _numCtx) => ({
        baseUrl: 'http://127.0.0.1:1234/v1',
      }),
    };
    const rt = createManagedRuntime(strat, { fetchImpl: health });
    await rt.control.warm('m', 4096);
    const spans = runtimeWarmSpans();
    expect(spans.length).toBe(1);
    expect(spans[0]?.attributes[ATTR.RUNTIME_WARM_OUTCOME]).toBe(
      'daemon-loaded',
    );
    expect(spans[0]?.attributes[ATTR.RUNTIME_CONTEXT_CAPABILITY]).toBe(
      'reload',
    );
    expect(spans[0]?.attributes[ATTR.RUNTIME_CONTEXT_APPLIED]).toBe(4096);
  });

  test('omits RUNTIME_CONTEXT_APPLIED for a fixed-capability strategy (MLX)', async () => {
    const strat: RuntimeStrategy = {
      kind: RuntimeKind.MlxServer,
      detect: async () => true,
      contextCapability: 'fixed',
      defaultPort: 8080,
      healthPath: '/v1/models',
      launch: (model, _numCtx, port) => ({
        cmd: 'mlx_lm.server',
        args: ['--model', model, '--port', String(port)],
        port,
      }),
    };
    const rt = createManagedRuntime(strat, {
      spawn,
      fetchImpl: health,
      startTimeoutMs: 2000,
    });
    await rt.control.warm('m', 8192);
    const spans = runtimeWarmSpans();
    expect(spans.length).toBe(1);
    expect(spans[0]?.attributes[ATTR.RUNTIME_CONTEXT_CAPABILITY]).toBe('fixed');
    expect(spans[0]?.attributes[ATTR.RUNTIME_CONTEXT_REQUESTED]).toBe(8192);
    expect(spans[0]?.attributes[ATTR.RUNTIME_CONTEXT_APPLIED]).toBeUndefined();
    expect(spans[0]?.attributes[ATTR.RUNTIME_WARM_OUTCOME]).toBe('spawned');
  });

  test('emits outcome=failed and still propagates the error when launch throws', async () => {
    const strat: RuntimeStrategy = {
      kind: RuntimeKind.LlamaCpp,
      detect: async () => true,
      contextCapability: 'relaunch',
      defaultPort: 8080,
      healthPath: '/health',
      launch: () => {
        throw new Error('launch failed');
      },
    };
    const rt = createManagedRuntime(strat, {
      spawn,
      fetchImpl: health,
      startTimeoutMs: 2000,
    });
    await expect(rt.control.warm('m', 8192)).rejects.toThrow('launch failed');
    const spans = runtimeWarmSpans();
    expect(spans.length).toBe(1);
    expect(spans[0]?.attributes[ATTR.RUNTIME_WARM_OUTCOME]).toBe('failed');
  });
});
