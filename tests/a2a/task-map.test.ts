import { expect, test } from 'bun:test';
import {
  CONSENT_UNAVAILABLE_ERROR_CODE,
  consentUnavailableError,
  jobStatusToTaskState,
  orchestratorResultToArtifact,
  orchestratorResultToTaskState,
  resultToTaskError,
} from '../../src/a2a/task-map.ts';
import { TaskStateWire } from '../../src/contracts/index.ts';
import { JobStatus } from '../../src/queue/types.ts';

test('answer → completed with a text artifact', () => {
  const r = { kind: 'answer', text: 'done' } as const;
  expect(orchestratorResultToTaskState(r)).toBe(TaskStateWire.Completed);
  expect(orchestratorResultToArtifact(r)?.parts[0]).toMatchObject({
    kind: 'text',
    text: 'done',
  });
  expect(resultToTaskError(r)).toBeUndefined();
});
test('gap → failed + missing-capability error', () => {
  const r = {
    kind: 'gap',
    missingCapability: 'ocr',
    message: 'no ocr',
  } as const;
  expect(orchestratorResultToTaskState(r)).toBe(TaskStateWire.Failed);
  expect(resultToTaskError(r)).toMatchObject({ message: 'missing-capability' });
});
test('resource → failed + resource error', () => {
  const r = { kind: 'resource', message: 'oom' } as const;
  expect(orchestratorResultToTaskState(r)).toBe(TaskStateWire.Failed);
  expect(resultToTaskError(r)?.code).toBe(-32002);
});
test('jobStatus projection covers every queue status', () => {
  expect(jobStatusToTaskState(JobStatus.Queued)).toBe(TaskStateWire.Submitted);
  expect(jobStatusToTaskState(JobStatus.Running)).toBe(TaskStateWire.Working);
  expect(jobStatusToTaskState(JobStatus.Interrupted)).toBe(
    TaskStateWire.Failed,
  );
});

// --- totality + detail-carrying probes (§7.1) ---

test('gap error carries missingCapability in data, code -32001', () => {
  const r = {
    kind: 'gap',
    missingCapability: 'ocr',
    message: 'no ocr',
  } as const;
  const err = resultToTaskError(r);
  expect(err?.code).toBe(-32001);
  expect(err?.data).toMatchObject({ missingCapability: 'ocr' });
});
test('resource error message is r.message', () => {
  const r = { kind: 'resource', message: 'oom' } as const;
  expect(resultToTaskError(r)?.message).toBe('oom');
});
test('gap / resource produce no artifact', () => {
  expect(
    orchestratorResultToArtifact({
      kind: 'gap',
      missingCapability: 'ocr',
      message: 'no ocr',
    }),
  ).toBeUndefined();
  expect(
    orchestratorResultToArtifact({ kind: 'resource', message: 'oom' }),
  ).toBeUndefined();
});
test('every JobStatus member maps (no completed hole for terminal-failure)', () => {
  const map: Record<JobStatus, TaskStateWire> = {
    [JobStatus.Queued]: TaskStateWire.Submitted,
    [JobStatus.Running]: TaskStateWire.Working,
    [JobStatus.Done]: TaskStateWire.Completed,
    [JobStatus.Failed]: TaskStateWire.Failed,
    [JobStatus.Canceled]: TaskStateWire.Canceled,
    [JobStatus.Interrupted]: TaskStateWire.Failed,
  };
  for (const status of Object.values(JobStatus)) {
    expect(jobStatusToTaskState(status)).toBe(map[status]);
  }
  // Only Done ever projects to completed.
  expect(jobStatusToTaskState(JobStatus.Failed)).not.toBe(
    TaskStateWire.Completed,
  );
  expect(jobStatusToTaskState(JobStatus.Interrupted)).not.toBe(
    TaskStateWire.Completed,
  );
  expect(jobStatusToTaskState(JobStatus.Canceled)).not.toBe(
    TaskStateWire.Completed,
  );
});
test('consentUnavailableError is the typed fail-closed error', () => {
  expect(CONSENT_UNAVAILABLE_ERROR_CODE).toBe(-32003);
  const err = consentUnavailableError();
  expect(err.code).toBe(-32003);
  expect(err.message).toBe('consent-unavailable');
});
