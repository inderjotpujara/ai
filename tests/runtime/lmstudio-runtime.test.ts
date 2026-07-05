import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import {
  type LmStudioClient,
  makeLmStudioStrategy,
} from '../../src/runtime/strategies/lmstudio.ts';

function fakeClient(log: string[]): LmStudioClient {
  return {
    load: async (m, ctx) => {
      log.push(`load ${m} @ ${ctx}`);
    },
    unload: async (m) => {
      log.push(`unload ${m}`);
    },
    listLoaded: async () => ['m'],
    reachable: async () => true,
  };
}

/** Narrows `strategy.daemonLoad`/`daemonUnload` from optional to present;
 * a daemon strategy (LM Studio) always defines both, so a missing one is a
 * test bug. */
function daemonLoad(
  strategy: ReturnType<typeof makeLmStudioStrategy>,
  model: string,
  numCtx: number | undefined,
) {
  if (!strategy.daemonLoad) throw new Error('daemonLoad is undefined');
  return strategy.daemonLoad(model, numCtx);
}

function daemonUnload(
  strategy: ReturnType<typeof makeLmStudioStrategy>,
  model: string,
) {
  if (!strategy.daemonUnload) throw new Error('daemonUnload is undefined');
  return strategy.daemonUnload(model);
}

test('daemonLoad loads the model at the requested context (reload capability)', async () => {
  const log: string[] = [];
  const strat = makeLmStudioStrategy(() => fakeClient(log));
  expect(strat.kind).toBe(RuntimeKind.LmStudio);
  expect(strat.contextCapability).toBe('reload');
  const r = await daemonLoad(strat, 'm', 8192);
  expect(r.baseUrl).toBe('http://127.0.0.1:1234/v1');
  expect(log).toContain('load m @ 8192');
});

test('daemonUnload unloads the model', async () => {
  const log: string[] = [];
  const strat = makeLmStudioStrategy(() => fakeClient(log));
  await daemonUnload(strat, 'm');
  expect(log).toContain('unload m');
});

test('detect() reflects client reachability', async () => {
  const reachableStrat = makeLmStudioStrategy(() => fakeClient([]));
  expect(await reachableStrat.detect()).toBe(true);

  const unreachableClient: LmStudioClient = {
    load: async () => {},
    unload: async () => {},
    listLoaded: async () => [],
    reachable: async () => false,
  };
  const unreachableStrat = makeLmStudioStrategy(() => unreachableClient);
  expect(await unreachableStrat.detect()).toBe(false);
});

test('static config: port, health path, base path, no launch', () => {
  const strat = makeLmStudioStrategy(() => fakeClient([]));
  expect(strat.defaultPort).toBe(1234);
  expect(strat.healthPath).toBe('/v1/models');
  expect(strat.basePath).toBe('/v1');
  expect(strat.launch).toBeUndefined();
});
