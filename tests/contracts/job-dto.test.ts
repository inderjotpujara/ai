import { expect, test } from 'bun:test';
import {
  JobKindWire,
  JobPriorityWire,
  JobStatusWire,
} from '../../src/contracts/enums.ts';
import {
  JobDtoSchema,
  JobEnqueueRequestSchema,
  JobLaunchResponseSchema,
  JobListQuerySchema,
} from '../../src/contracts/index.ts';

test('JobDtoSchema round-trips a full record', () => {
  const dto = JobDtoSchema.parse({
    id: 'job-1',
    kind: JobKindWire.Crew,
    payload: { name: 'x' },
    priority: JobPriorityWire.Normal,
    status: JobStatusWire.Done,
    attempts: 1,
    maxAttempts: 4,
    createdAt: 1,
    updatedAt: 2,
    finishedAt: 2,
    runId: 'run-1',
    result: { ok: true },
  });
  expect(dto.runId).toBe('run-1');
});

test('JobEnqueueRequestSchema rejects a missing kind', () => {
  expect(() => JobEnqueueRequestSchema.parse({ payload: {} })).toThrow();
});

test('JobLaunchResponseSchema requires jobId AND runId', () => {
  expect(() => JobLaunchResponseSchema.parse({ jobId: 'j' })).toThrow();
  expect(JobLaunchResponseSchema.parse({ jobId: 'j', runId: 'r' }).runId).toBe(
    'r',
  );
});

test('JobListQuerySchema defaults limit to 25', () => {
  expect(JobListQuerySchema.parse({}).limit).toBe(25);
});

test('JobListQuerySchema rejects limit > 200', () => {
  expect(() => JobListQuerySchema.parse({ limit: 201 })).toThrow();
});
