import { afterEach, expect, test } from 'bun:test';
import {
  runTriggersCli,
  type TriggersCliDeps,
} from '../../src/cli/triggers.ts';
import { JobKind } from '../../src/queue/types.ts';
import {
  type Trigger,
  type TriggerFiring,
  TriggerOrigin,
  TriggerOutcome,
  TriggerType,
} from '../../src/triggers/types.ts';

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'trig-1',
    name: 'nightly-sync',
    type: TriggerType.Cron,
    enabled: true,
    target: { kind: JobKind.Chat, payload: {} },
    config: { schedule: '0 0 * * *' },
    origin: TriggerOrigin.Console,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function harness() {
  const out: string[] = [];
  const calls: { fn: string; args: unknown[] }[] = [];
  const state = { triggers: [makeTrigger()] as Trigger[] };
  const deps: TriggersCliDeps = {
    list: () => {
      calls.push({ fn: 'list', args: [] });
      return state.triggers;
    },
    getByName: (name) => {
      calls.push({ fn: 'getByName', args: [name] });
      return state.triggers.find((t) => t.name === name);
    },
    add: (spec) => {
      calls.push({ fn: 'add', args: [spec] });
      const trigger = makeTrigger({
        id: 'trig-2',
        name: spec.name,
        type: spec.type,
        config: spec.config,
      });
      if (spec.type === TriggerType.Webhook) {
        return { trigger, token: 'raw-token-abc', url: 'http://x/hooks/abc' };
      }
      return { trigger };
    },
    setEnabled: (id, enabled) => {
      calls.push({ fn: 'setEnabled', args: [id, enabled] });
    },
    remove: (id) => {
      calls.push({ fn: 'remove', args: [id] });
    },
    history: (id) => {
      calls.push({ fn: 'history', args: [id] });
      const firing: TriggerFiring = {
        id: 'f-1',
        triggerId: id,
        firedAt: 1,
        jobId: 'job-1',
        runId: 'run-1',
        outcome: TriggerOutcome.Fired,
      };
      return [firing];
    },
    fire: async (id) => {
      calls.push({ fn: 'fire', args: [id] });
      if (id === 'skip-me') return { skipped: 'skipped-overlap' };
      return { jobId: 'job-9', runId: 'run-9' };
    },
    print: (s) => out.push(s),
  };
  return { deps, out, calls, state };
}

// Fix 1/2 (Task 32 review) reject-config-and-dup-name paths set
// `process.exitCode = 1` on the real process object (mirroring the
// `agent-builder`/`crew-builder`/`discover` CLI idiom) — reset it after
// every test in this file so a rejection assertion never leaks a non-zero
// exit code into the overall `bun test` run.
afterEach(() => {
  process.exitCode = 0;
});

test('list prints each trigger', async () => {
  const h = harness();
  await runTriggersCli(['list'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'list', args: [] });
  expect(h.out.join('\n')).toContain('trig-1');
  expect(h.out.join('\n')).toContain('nightly-sync');
});

test('list with no triggers prints a friendly message', async () => {
  const h = harness();
  h.state.triggers = [];
  await runTriggersCli(['list'], h.deps);
  expect(h.out.join('\n')).toContain('no triggers');
});

test('enable toggles via setEnabled(true)', async () => {
  const h = harness();
  await runTriggersCli(['enable', 'trig-1'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'setEnabled', args: ['trig-1', true] });
});

test('disable toggles via setEnabled(false)', async () => {
  const h = harness();
  await runTriggersCli(['disable', 'trig-1'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'setEnabled', args: ['trig-1', false] });
});

test('remove calls deps.remove with the id', async () => {
  const h = harness();
  await runTriggersCli(['remove', 'trig-1'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'remove', args: ['trig-1'] });
  expect(h.out.join('\n')).toContain('removed trig-1');
});

test('history prints a firings table', async () => {
  const h = harness();
  await runTriggersCli(['history', 'trig-1'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'history', args: ['trig-1'] });
  expect(h.out.join('\n')).toContain('job-1');
  expect(h.out.join('\n')).toContain('run-1');
});

test('fire prints jobId/runId on success', async () => {
  const h = harness();
  await runTriggersCli(['fire', 'trig-1'], h.deps);
  expect(h.calls).toContainEqual({ fn: 'fire', args: ['trig-1'] });
  expect(h.out.join('\n')).toContain('jobId=job-9');
  expect(h.out.join('\n')).toContain('runId=run-9');
});

test('fire prints a not-fired message when skipped', async () => {
  const h = harness();
  await runTriggersCli(['fire', 'skip-me'], h.deps);
  expect(h.out.join('\n')).toContain('not fired: skipped-overlap');
});

test('add parses a JSON spec and prints a webhook token once', async () => {
  const h = harness();
  const spec = {
    name: 'incoming-hook',
    type: TriggerType.Webhook,
    target: { kind: JobKind.Chat, payload: {} },
    config: { hmac: true },
    origin: TriggerOrigin.Console,
  };
  await runTriggersCli(['add', JSON.stringify(spec)], h.deps);
  expect(h.calls).toContainEqual({ fn: 'add', args: [spec] });
  const printed = h.out.join('\n');
  expect(printed).toContain('created trig-2');
  expect(printed).toContain('shown once');
  expect(printed).toContain('raw-token-abc');
  expect(printed).toContain('http://x/hooks/abc');
});

test('add for a non-webhook trigger prints no token', async () => {
  const h = harness();
  const spec = {
    name: 'nightly',
    type: TriggerType.Cron,
    target: { kind: JobKind.Chat, payload: {} },
    config: { schedule: '0 0 * * *' },
    origin: TriggerOrigin.Console,
  };
  await runTriggersCli(['add', JSON.stringify(spec)], h.deps);
  expect(h.out.join('\n')).not.toContain('shown once');
});

test('add with a valid cron pattern still creates fine', async () => {
  const h = harness();
  const spec = {
    name: 'valid-cron',
    type: TriggerType.Cron,
    target: { kind: JobKind.Chat, payload: {} },
    config: { schedule: '*/5 * * * *' },
    origin: TriggerOrigin.Console,
  };
  await runTriggersCli(['add', JSON.stringify(spec)], h.deps);
  expect(h.calls).toContainEqual({ fn: 'add', args: [spec] });
  expect(h.out.join('\n')).toContain('created trig-2');
  expect(process.exitCode).toBe(0);
});

test('add with an invalid cron pattern errors and does not call deps.add (Fix 1)', async () => {
  const h = harness();
  const spec = {
    name: 'broken-cron',
    type: TriggerType.Cron,
    target: { kind: JobKind.Chat, payload: {} },
    config: { schedule: 'not a cron' },
    origin: TriggerOrigin.Console,
  };
  await runTriggersCli(['add', JSON.stringify(spec)], h.deps);
  expect(h.calls.find((c) => c.fn === 'add')).toBeUndefined();
  expect(h.out.join('\n')).toMatch(/error.*cron/i);
  expect(process.exitCode).toBe(1);
});

test('add with a file path escaping the watch root errors and does not call deps.add (Fix 1)', async () => {
  const h = harness();
  const spec = {
    name: 'escaping-file',
    type: TriggerType.File,
    target: { kind: JobKind.Chat, payload: {} },
    config: { path: '../../../etc/passwd' },
    origin: TriggerOrigin.Console,
  };
  await runTriggersCli(['add', JSON.stringify(spec)], h.deps);
  expect(h.calls.find((c) => c.fn === 'add')).toBeUndefined();
  expect(h.out.join('\n')).toMatch(/error/i);
  expect(process.exitCode).toBe(1);
});

test('add with a duplicate console trigger name errors and does not call deps.add (Fix 2)', async () => {
  const h = harness();
  // `makeTrigger()` seeds state.triggers with a trigger named 'nightly-sync' —
  // reuse that name to simulate the dup.
  const spec = {
    name: 'nightly-sync',
    type: TriggerType.Cron,
    target: { kind: JobKind.Chat, payload: {} },
    config: { schedule: '0 0 * * *' },
    origin: TriggerOrigin.Console,
  };
  await runTriggersCli(['add', JSON.stringify(spec)], h.deps);
  expect(h.calls.find((c) => c.fn === 'add')).toBeUndefined();
  expect(h.calls).toContainEqual({ fn: 'getByName', args: ['nightly-sync'] });
  expect(h.out.join('\n')).toContain(
    'a console trigger named "nightly-sync" already exists',
  );
  expect(process.exitCode).toBe(1);
});

test('add with invalid JSON prints an error and does not call deps.add', async () => {
  const h = harness();
  await runTriggersCli(['add', '{not json'], h.deps);
  expect(h.calls.find((c) => c.fn === 'add')).toBeUndefined();
  expect(h.out.join('\n')).toContain('invalid JSON');
});

test('add with no arg prints usage', async () => {
  const h = harness();
  await runTriggersCli(['add'], h.deps);
  expect(h.out.join('\n')).toContain('usage');
  expect(h.calls.find((c) => c.fn === 'add')).toBeUndefined();
});

test('unknown subcommand prints usage', async () => {
  const h = harness();
  await runTriggersCli(['bogus'], h.deps);
  expect(h.out.join('\n')).toMatch(/usage: agent triggers/);
});

test('no subcommand prints usage', async () => {
  const h = harness();
  await runTriggersCli([], h.deps);
  expect(h.out.join('\n')).toMatch(/usage: agent triggers/);
});
