import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import {
  createManagedRuntime,
  type RuntimeStrategy,
} from '../../src/runtime/managed-openai-compatible.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

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
