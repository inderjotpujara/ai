import { expect, test } from 'bun:test';
import {
  TriggerOrigin,
  TriggerOutcome,
  TriggerType,
} from '../../src/triggers/types.ts';

test('TriggerType holds the four source wire values', () => {
  expect((Object.values(TriggerType) as string[]).sort()).toEqual([
    'cron',
    'file',
    'jobchain',
    'webhook',
  ]);
});
test('TriggerOrigin + TriggerOutcome wire values', () => {
  expect((Object.values(TriggerOrigin) as string[]).sort()).toEqual([
    'console',
    'repo',
  ]);
  expect((Object.values(TriggerOutcome) as string[]).sort()).toEqual([
    'failed',
    'fired',
    'skipped-overlap',
  ]);
});
