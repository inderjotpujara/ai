import { expect, test } from 'bun:test';
import {
  DegradeKind,
  RunLifecycle,
  RunOrigin,
  StatusEventType,
} from '../../src/contracts/enums.ts';

test('RunOrigin carries the reserved provenance values', () => {
  expect(Object.values(RunOrigin)).toEqual([
    'manual',
    'schedule',
    'webhook',
    'api',
    'remote',
  ]);
});

test('RunLifecycle is not just terminal states', () => {
  expect(RunLifecycle.PausedAwaitingInput).toBe('paused-awaiting-input');
  expect(RunLifecycle.Resumable).toBe('resumable');
});

test('DegradeKind mirrors reliability ledger string values', () => {
  expect(Object.values(DegradeKind)).toEqual([
    'model_degraded',
    'agent_dropped',
    'tool_skipped',
    'retried',
    'circuit_open',
  ]);
});

test('StatusEventType discriminants are the data-part names', () => {
  expect(StatusEventType.Confirm).toBe('data-confirm');
  expect(StatusEventType.RunStart).toBe('data-run-start');
});
