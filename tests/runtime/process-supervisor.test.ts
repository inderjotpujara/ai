import { expect, test } from 'bun:test';
import {
  type SpawnFn,
  superviseServer,
} from '../../src/runtime/process-supervisor.ts';

function fakeSpawn(): { spawn: SpawnFn; killed: () => boolean } {
  let wasKilled = false;
  const spawn: SpawnFn = () => ({
    pid: 4242,
    kill: () => {
      wasKilled = true;
    },
    onExit: () => {},
  });
  return { spawn, killed: () => wasKilled };
}
const okAfter = (n: number): typeof fetch => {
  let calls = 0;
  return (async () => {
    calls++;
    return new Response('', { status: calls >= n ? 200 : 503 });
  }) as unknown as typeof fetch;
};

test('spawns, polls health, resolves a baseUrl', async () => {
  const { spawn } = fakeSpawn();
  const s = await superviseServer(
    {
      cmd: 'x',
      args: [],
      host: '127.0.0.1',
      port: 9999,
      basePath: '/v1',
      healthPath: '/health',
    },
    { spawn, fetchImpl: okAfter(2), pollMs: 0, startTimeoutMs: 5000 },
  );
  expect(s.baseUrl).toBe('http://127.0.0.1:9999/v1');
});

test('kills the child and throws when health never comes up', async () => {
  const { spawn, killed } = fakeSpawn();
  const never = (async () =>
    new Response('', { status: 503 })) as unknown as typeof fetch;
  await expect(
    superviseServer(
      {
        cmd: 'x',
        args: [],
        host: '127.0.0.1',
        port: 9999,
        basePath: '/v1',
        healthPath: '/health',
      },
      { spawn, fetchImpl: never, pollMs: 0, startTimeoutMs: 30 },
    ),
  ).rejects.toThrow('healthy');
  expect(killed()).toBe(true);
});

test('stops polling the health endpoint once the wall-clock deadline wins', async () => {
  const { spawn } = fakeSpawn();
  let calls = 0;
  const alwaysFails = (async () => {
    calls++;
    throw new Error('connection refused');
  }) as unknown as typeof fetch;

  await expect(
    superviseServer(
      {
        cmd: 'x',
        args: [],
        host: '127.0.0.1',
        port: 9999,
        basePath: '/v1',
        healthPath: '/health',
      },
      { spawn, fetchImpl: alwaysFails, pollMs: 0, startTimeoutMs: 20 },
    ),
  ).rejects.toThrow('healthy');

  const callsAtRejection = calls;
  await new Promise((resolve) => setTimeout(resolve, 100));

  // If the loser loop from Promise.race were never cancelled, it would keep
  // calling fetchImpl indefinitely; a stopped loop makes at most one more
  // in-flight call after rejection.
  expect(calls - callsAtRejection).toBeLessThanOrEqual(1);
});
