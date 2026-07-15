import { expect, test } from 'bun:test';
import {
  ArtifactKind,
  DegradeKind,
  RunLifecycle,
  RunOrigin,
  StatusEventType,
} from '../../src/contracts/enums.ts';

test('RunOrigin carries the reserved provenance values', () => {
  expect(Object.values(RunOrigin) as string[]).toEqual([
    'manual',
    'schedule',
    'webhook',
    'api',
    'remote',
  ]);
});

test('ArtifactKind carries the Phase-3 classification members (additive)', () => {
  expect(Object.values(ArtifactKind) as string[]).toEqual([
    'answer',
    'gap',
    'spans',
    'degradation',
    'other',
    'result',
    'resource',
    'unverified',
    'failed',
    'error',
    'media',
  ]);
});

test('RunLifecycle is not just terminal states', () => {
  expect(RunLifecycle.PausedAwaitingInput as string).toBe(
    'paused-awaiting-input',
  );
  expect(RunLifecycle.Resumable as string).toBe('resumable');
});

test('DegradeKind mirrors reliability ledger string values', () => {
  expect(Object.values(DegradeKind) as string[]).toEqual([
    'model_degraded',
    'agent_dropped',
    'tool_skipped',
    'retried',
    'circuit_open',
  ]);
});

test('StatusEventType discriminants are the data-part names', () => {
  expect(StatusEventType.Confirm as string).toBe('data-confirm');
  expect(StatusEventType.RunStart as string).toBe('data-run-start');
});
