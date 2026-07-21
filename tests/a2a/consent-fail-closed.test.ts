/**
 * Task 13 — fail-closed mid-run consent → typed `failed` (no hang) (HARD §7.1).
 *
 * A remote A2A task runs as a queued job; dispatch is hardcoded fail-closed. A
 * mid-run consent gate therefore can only DECLINE — there is no live client to
 * answer it. This suite proves the outcome is a TYPED, terminal `failed`
 * (`consent-unavailable`): never a hang, never `input-required`.
 *
 * Honesty note (see `consentDeclinedToTaskError` in `task-map.ts`): no dispatch
 * path today lands a consent-tagged `Failed` job on an A2A-reachable kind, so
 * the typed `consent-unavailable` refinement is FORWARD-LOOKING. The load-bearing
 * no-hang guarantee does NOT depend on it — it is carried entirely by Task 8's
 * `jobStatusToTaskState` `Failed → failed` projection, exercised below.
 */

import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { A2aAllowlist } from '../../src/a2a/allowlist.ts';
import { type A2aServerDeps, handleTasksGet } from '../../src/a2a/server.ts';
import { frameRunSpanAsA2a } from '../../src/a2a/stream.ts';
import { createTaskIndex } from '../../src/a2a/task-index.ts';
import {
  CONSENT_DECLINED_MARKER,
  consentDeclinedToTaskError,
  jobStatusToTaskState,
} from '../../src/a2a/task-map.ts';
import {
  type A2aTask,
  type SpanDTO,
  SpanStatus,
  TaskStateWire,
} from '../../src/contracts/index.ts';
import type { JobStore } from '../../src/queue/store.ts';
import {
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from '../../src/queue/types.ts';

// ---- unit: the pure fail-closed consent projection -------------------------

test('a job that failed on a declined consent gate maps to failed + consent-unavailable', () => {
  const proj = consentDeclinedToTaskError({
    status: JobStatus.Failed,
    error: CONSENT_DECLINED_MARKER,
  });
  expect(proj?.state).toBe(TaskStateWire.Failed);
  expect(proj?.error).toMatchObject({ message: 'consent-unavailable' });
});

test('a plain Failed job (unrelated error) is NOT projected as consent-unavailable', () => {
  expect(
    consentDeclinedToTaskError({
      status: JobStatus.Failed,
      error: 'model timeout',
    }),
  ).toBeUndefined();
  // a Failed job with no error string at all is likewise not a consent decline
  expect(
    consentDeclinedToTaskError({ status: JobStatus.Failed, error: undefined }),
  ).toBeUndefined();
});

test('a non-Failed job is never projected as consent-unavailable', () => {
  for (const status of [
    JobStatus.Queued,
    JobStatus.Running,
    JobStatus.Done,
    JobStatus.Canceled,
    JobStatus.Interrupted,
  ]) {
    expect(
      consentDeclinedToTaskError({ status, error: CONSENT_DECLINED_MARKER }),
    ).toBeUndefined();
  }
});

test('Failed still projects to the failed task state (reusing Task 8)', () => {
  expect(jobStatusToTaskState(JobStatus.Failed)).toBe(TaskStateWire.Failed);
});

// ---- integration: no hang, terminal `failed` on tasks/get ------------------

function baseRecord(id: string): JobRecord {
  return {
    id,
    kind: JobKind.Chat,
    payload: {},
    priority: JobPriority.Normal,
    status: JobStatus.Queued,
    attempts: 0,
    maxAttempts: 1,
    createdAt: 0,
    updatedAt: 0,
    startedAt: undefined,
    finishedAt: undefined,
    availableAt: 0,
    runId: undefined,
    result: undefined,
    error: undefined,
    retriedFrom: null,
    origin: undefined,
    chainDepth: 0,
  };
}

function fakeAllowlist(): A2aAllowlist {
  return {
    list: () => [],
    put: () => {},
    remove: () => {},
    resolve: () => undefined,
  };
}

function harness(): { deps: A2aServerDeps; seed: (rec: JobRecord) => void } {
  const jobs = new Map<string, JobRecord>();
  const store = { getJob: (id: string) => jobs.get(id) } as unknown as JobStore;
  const deps: A2aServerDeps = {
    allowlist: fakeAllowlist(),
    // Dispatch-level test; the route Bearer gate is out of scope, so a stub
    // enrollment satisfies the required field without being consulted.
    enrollment: {
      issue: () => ({ id: '', token: '' }),
      verify: () => false,
      revoke: () => {},
      list: () => [],
    },
    jobStore: store,
    runsRoot: mkdtempSync(join(tmpdir(), 'a2a-consent-')),
    taskIndex: createTaskIndex(),
  };
  return { deps, seed: (rec) => jobs.set(rec.id, rec) };
}

/** Resolve `p` or throw if it does not settle within `ms` — a hang would time
 *  out the wall-clock race and FAIL, so a pass PROVES a terminal outcome. */
function withinWallClock<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error('hang: no terminal state within wall-clock')),
        ms,
      ),
    ),
  ]);
}

test('a task whose dispatch declined consent reaches a terminal failed state (never hangs, never input-required)', async () => {
  const { deps, seed } = harness();
  // taskId === jobId (1:1). A job that settled Failed because dispatch's
  // fail-closed confirm declined a mid-run consent gate.
  const job: JobRecord = {
    ...baseRecord('task-consent-1'),
    status: JobStatus.Failed,
    error: CONSENT_DECLINED_MARKER,
    runId: 'run-consent-1',
  };
  seed(job);

  const res = await withinWallClock(
    handleTasksGet({ id: job.id }, deps),
    1_000,
  );
  if (!res.ok) throw new Error(`expected ok task, got error ${res.error.code}`);
  const task = res.result as A2aTask;

  // Terminal `failed` — NOT a pending/hanging state, NOT input-required.
  expect(task.status.state).toBe(TaskStateWire.Failed);
  expect(task.status.state).not.toBe(TaskStateWire.InputRequired);
  expect(task.status.state).not.toBe(TaskStateWire.Working);
  expect(task.status.state).not.toBe(TaskStateWire.Submitted);

  // The typed consent-unavailable error rides the failed status message.
  const part = task.status.message?.parts[0];
  expect(part?.kind).toBe('data');
  const data = (part as unknown as { data: { error: { message: string } } })
    .data;
  expect(data.error.message).toBe('consent-unavailable');
});

test('the terminal STREAM frame for a consent-declined run carries consent-unavailable', () => {
  const ctx = { taskId: 'task-consent-2', contextId: 'ctx-2' };
  const rootSpan = {
    name: 'chat.run',
    spanId: 'span-root',
    status: SpanStatus.Error,
  } as unknown as SpanDTO;
  const proj = consentDeclinedToTaskError({
    status: JobStatus.Failed,
    error: CONSENT_DECLINED_MARKER,
  });
  const frame = frameRunSpanAsA2a(rootSpan, ctx, proj?.error);
  const payload = JSON.parse(
    frame?.slice(frame.indexOf('data:') + 5).trim() ?? '{}',
  );
  expect(payload.status.state).toBe(TaskStateWire.Failed);
  expect(payload.final).toBe(true);
  expect(payload.status.message.parts[0].data.error.message).toBe(
    'consent-unavailable',
  );
});
