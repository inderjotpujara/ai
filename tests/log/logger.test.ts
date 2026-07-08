import { afterEach, expect, test } from 'bun:test';
import { createLogger, setLogSink } from '../../src/log/logger.ts';
import {
  ensureGlobalTelemetry,
  withRunContext,
} from '../../src/telemetry/run-router.ts';

// withRunContext only binds the OTel context once the AsyncLocalStorage
// context manager is registered globally (every real call site does this via
// initRunTelemetry first, e.g. src/cli/with-run.ts). Mirror that invariant
// here so this test is deterministic standalone, not dependent on another
// test file having registered it as a side effect.
ensureGlobalTelemetry();

afterEach(() => {
  setLogSink(undefined);
  delete process.env.AGENT_LOG_LEVEL;
});

test('emits JSON with level, name, msg, fields and stamps runId from context', () => {
  const lines: string[] = [];
  setLogSink((l) => lines.push(l));
  const log = createLogger('test');
  withRunContext('run-xyz', () => log.info('hello', { k: 1 }));
  const rec = JSON.parse(lines[0] ?? '');
  expect(rec).toMatchObject({
    level: 'info',
    name: 'test',
    msg: 'hello',
    k: 1,
    runId: 'run-xyz',
  });
});

test('respects AGENT_LOG_LEVEL gate', () => {
  process.env.AGENT_LOG_LEVEL = 'warn';
  const lines: string[] = [];
  setLogSink((l) => lines.push(l));
  const log = createLogger('t');
  log.info('skip');
  log.warn('keep');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? '').msg).toBe('keep');
});
