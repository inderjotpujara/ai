import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  recordDaemonStart,
  recordDaemonStop,
  recordJobCancel,
  recordJobEnqueue,
  recordJobRetry,
  withJobRunSpan,
} from '../../src/daemon/spans.ts';
import {
  JobKind,
  JobPriority,
  type JobRecord,
  JobStatus,
} from '../../src/queue/types.ts';
import { currentRunId } from '../../src/telemetry/run-router.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

// registerTestProvider() returns { exporter, provider }; shutdown is on .provider.
let h: ReturnType<typeof registerTestProvider>;
beforeAll(() => {
  h = registerTestProvider();
});
afterAll(() => h.provider.shutdown());

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-000000001-abcdef',
    kind: JobKind.Crew,
    payload: { name: 'c', input: 'go' },
    priority: JobPriority.Normal,
    status: JobStatus.Running,
    attempts: 1,
    maxAttempts: 3,
    createdAt: 0,
    updatedAt: 0,
    startedAt: 0,
    finishedAt: undefined,
    availableAt: 0,
    runId: 'run-000000001-xyz',
    result: undefined,
    error: undefined,
    retriedFrom: null,
    origin: undefined,
    chainDepth: 0,
    ...overrides,
  };
}

test('recordDaemonStart opens+closes a daemon.start span tagged with pid', () => {
  recordDaemonStart({ pid: 4242 });
  const span = h.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'daemon.start');
  expect(span).toBeDefined();
  expect(span?.attributes['daemon.pid']).toBe(4242);
});

test('recordDaemonStop opens+closes a daemon.stop span tagged with pid', () => {
  recordDaemonStop({ pid: 4242 });
  const span = h.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'daemon.stop');
  expect(span).toBeDefined();
  expect(span?.attributes['daemon.pid']).toBe(4242);
});

test('recordJobEnqueue emits a job.enqueue span with job attrs + principal', () => {
  const j = job({ id: 'job-enqueue-1', status: JobStatus.Queued, attempts: 0 });
  recordJobEnqueue(j);
  const span = h.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'job.enqueue' && s.attributes['job.id'] === j.id);
  expect(span).toBeDefined();
  expect(span?.attributes['job.kind']).toBe(JobKind.Crew);
  expect(span?.attributes['job.priority']).toBe(JobPriority.Normal);
  expect(span?.attributes['agent.run.id']).toBe(j.runId);
  expect(span?.attributes['job.origin']).toBe('daemon');
  expect(span?.attributes['server.principal']).toBe('local');
});

test('withJobRunSpan sets job.kind/job.attempt and nests under withRunContext(job.runId)', async () => {
  const j = job({ id: 'job-run-1', kind: JobKind.Chat, attempts: 2 });
  let observedRunId: string | undefined;
  const result = await withJobRunSpan(j, async () => {
    observedRunId = currentRunId();
    return 'ok';
  });
  expect(result).toBe('ok');
  expect(observedRunId).toBe(j.runId);
  const span = h.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'job.run' && s.attributes['job.id'] === j.id);
  expect(span).toBeDefined();
  expect(span?.attributes['job.kind']).toBe(JobKind.Chat);
  expect(span?.attributes['job.attempt']).toBe(2);
  expect(span?.attributes['job.priority']).toBe(JobPriority.Normal);
  expect(span?.attributes['agent.run.id']).toBe(j.runId);
});

test('withJobRunSpan records an ERROR status when the executor throws, and still ends the span', async () => {
  const j = job({ id: 'job-run-throw' });
  await expect(
    withJobRunSpan(j, async () => {
      throw new Error('kaboom');
    }),
  ).rejects.toThrow('kaboom');
  const span = h.exporter
    .getFinishedSpans()
    .find(
      (s) => s.name === 'job.run' && s.attributes['job.id'] === 'job-run-throw',
    );
  expect(span?.status.code).toBe(2); // SpanStatusCode.ERROR
});

test('recordJobRetry emits a job.retry span carrying the failed attempt count', () => {
  const j = job({ id: 'job-retry-1', status: JobStatus.Queued, attempts: 1 });
  recordJobRetry(j);
  const span = h.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'job.retry' && s.attributes['job.id'] === j.id);
  expect(span).toBeDefined();
  expect(span?.attributes['job.attempt']).toBe(1);
  expect(span?.attributes['job.origin']).toBe('daemon');
});

test('recordJobCancel emits a job.cancel span with the job attrs', () => {
  const j = job({ id: 'job-cancel-1', status: JobStatus.Running });
  recordJobCancel(j);
  const span = h.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'job.cancel' && s.attributes['job.id'] === j.id);
  expect(span).toBeDefined();
  expect(span?.attributes['job.kind']).toBe(JobKind.Crew);
  expect(span?.attributes['agent.run.id']).toBe(j.runId);
});
