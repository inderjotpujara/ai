import { expect, test } from 'bun:test';
import { registerChild } from '../../src/process/child-registry.ts';
import {
  installSignalHandlers,
  onShutdown,
} from '../../src/process/lifecycle.ts';

test('SIGINT runs teardown callbacks and kills children before exit', async () => {
  const events: string[] = [];
  let killed = false;
  registerChild({
    kill: () => {
      killed = true;
    },
  });
  onShutdown(() => {
    events.push('teardown');
  });
  const handlers: Record<string, () => void> = {};
  installSignalHandlers({
    on: (sig, cb) => {
      handlers[sig] = cb;
    },
    exit: () => {
      events.push('exit');
    },
  });
  await handlers.SIGINT?.();
  expect(events).toEqual(['teardown', 'exit']);
  expect(killed).toBe(true);
});
