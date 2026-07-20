import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunOrigin } from '../../src/contracts/enums.ts';
import {
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from '../../src/queue/types.ts';
import { readRunOrigin } from '../../src/run/run-dto.ts';
import { createJobDispatch } from '../../src/server/jobs/dispatch.ts';

const fakeJob = (over: Partial<JobRecord> = {}): JobRecord => ({
  id: 'job-1',
  kind: JobKind.Chat,
  payload: { task: 'hi' },
  priority: JobPriority.Normal,
  status: JobStatus.Running,
  attempts: 1,
  maxAttempts: 4,
  createdAt: 0,
  updatedAt: 0,
  startedAt: 0,
  finishedAt: undefined,
  availableAt: 0,
  runId: 'run-xyz',
  result: undefined,
  error: undefined,
  retriedFrom: null,
  origin: undefined,
  chainDepth: 0,
  ...over,
});

const baseDeps = (runsRoot: string) => ({
  runsRoot,
  runCrewTurn: async () => ({}),
  getCrew: () => undefined,
  runWorkflowTurn: async () => ({}),
  getWorkflow: () => undefined,
  runModelPull: async () => {},
  runChatTurn: async () => ({ kind: 'answer', text: 'x' }) as never,
  runBuilderTurn: async () => ({}) as never,
});

test('markJobOrigin stamps the job.origin when present (Schedule)', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'dispatch-origin-'));
  const dispatch = createJobDispatch(baseDeps(runsRoot));
  await dispatch(JobKind.Chat)(
    fakeJob({ runId: 'run-sched', origin: RunOrigin.Schedule }),
    new AbortController().signal,
  );
  expect(await readRunOrigin(join(runsRoot, 'run-sched'))).toBe(
    RunOrigin.Schedule,
  );
});

test('markJobOrigin stamps the job.origin when present (Webhook)', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'dispatch-origin-'));
  const dispatch = createJobDispatch(baseDeps(runsRoot));
  await dispatch(JobKind.Chat)(
    fakeJob({ runId: 'run-hook', origin: RunOrigin.Webhook }),
    new AbortController().signal,
  );
  expect(await readRunOrigin(join(runsRoot, 'run-hook'))).toBe(
    RunOrigin.Webhook,
  );
});

test('markJobOrigin defaults to Daemon when the job has no origin', async () => {
  const runsRoot = mkdtempSync(join(tmpdir(), 'dispatch-origin-'));
  const dispatch = createJobDispatch(baseDeps(runsRoot));
  await dispatch(JobKind.Chat)(
    fakeJob({ runId: 'run-default', origin: undefined }),
    new AbortController().signal,
  );
  expect(await readRunOrigin(join(runsRoot, 'run-default'))).toBe(
    RunOrigin.Daemon,
  );
});
