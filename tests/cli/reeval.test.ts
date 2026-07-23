import { afterEach, expect, test } from 'bun:test';
import { type ReevalCliDeps, runReevalCli } from '../../src/cli/reeval.ts';
import type { JobRecord } from '../../src/queue/types.ts';
import { JobKind } from '../../src/queue/types.ts';
import { EvalMode } from '../../src/server/jobs/dispatch.ts';

// The bad-args path sets `process.exitCode = 1` (mirrors the a2a/daemon CLI
// idiom) — reset it after every test so that assertion never leaks a
// non-zero exit code into the rest of the `bun test` run.
afterEach(() => {
  process.exitCode = 0;
});

function harness() {
  const out: string[] = [];
  const enqueued: { kind: JobKind; payload: unknown }[] = [];
  const deps: ReevalCliDeps = {
    jobStore: {
      enqueue: (input) => {
        enqueued.push({ kind: input.kind, payload: input.payload });
        return { id: `job-${enqueued.length}` } as JobRecord;
      },
    },
    print: (s) => out.push(s),
  };
  return { out, enqueued, deps };
}

test('reeval --agent file_qa enqueues an Eval(artifact, ref)', async () => {
  const { out, enqueued, deps } = harness();
  await runReevalCli(['--agent', 'file_qa'], deps);
  expect(enqueued).toEqual([
    {
      kind: JobKind.Eval,
      payload: { mode: EvalMode.Artifact, ref: 'file_qa', reason: 'manual' },
    },
  ]);
  expect(out).toEqual(['enqueued job-1']);
});

test('reeval --all enqueues an Eval(sweep)', async () => {
  const { out, enqueued, deps } = harness();
  await runReevalCli(['--all'], deps);
  expect(enqueued).toEqual([
    { kind: JobKind.Eval, payload: { mode: EvalMode.Sweep, reason: 'manual' } },
  ]);
  expect(out).toEqual(['enqueued job-1']);
});

test('reeval with no flags also enqueues a sweep (default)', async () => {
  const { enqueued, deps } = harness();
  await runReevalCli([], deps);
  expect(enqueued).toEqual([
    { kind: JobKind.Eval, payload: { mode: EvalMode.Sweep, reason: 'manual' } },
  ]);
});

test('reeval --agent with no name prints usage and enqueues nothing', async () => {
  const { out, enqueued, deps } = harness();
  await runReevalCli(['--agent'], deps);
  expect(enqueued).toEqual([]);
  expect(out).toEqual(['usage: bun run reeval [--all | --agent <name>]']);
  expect(process.exitCode).toBe(1);
});

test('reeval with an unrecognized flag prints usage and enqueues nothing', async () => {
  const { out, enqueued, deps } = harness();
  await runReevalCli(['--bogus'], deps);
  expect(enqueued).toEqual([]);
  expect(out).toEqual(['usage: bun run reeval [--all | --agent <name>]']);
  expect(process.exitCode).toBe(1);
});
