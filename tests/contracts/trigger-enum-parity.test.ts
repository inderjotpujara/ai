import { expect, test } from 'bun:test';
import {
  TriggerOriginWire,
  TriggerOutcomeWire,
  TriggerTypeWire,
} from '../../src/contracts/enums.ts';
import {
  TriggerOrigin,
  TriggerOutcome,
  TriggerType,
} from '../../src/triggers/types.ts';

// The wire enums (`src/contracts/enums.ts`) MUST hold the same string values as
// their engine counterparts in `src/triggers/types.ts` (Task 1). We compare the
// underlying string values (not the nominal enum arrays, which bun's `toEqual`
// rejects across two distinct string enums) so a future value drift breaks the
// build — same guard intent as `job-kind-parity.test.ts`. Slice 25.
const values = (e: Record<string, string>): string[] => Object.values(e).sort();

test('contract TriggerType values stay isomorphic with the engine', () => {
  expect(values(TriggerTypeWire)).toEqual(values(TriggerType));
});

test('contract TriggerOrigin values stay isomorphic with the engine', () => {
  expect(values(TriggerOriginWire)).toEqual(values(TriggerOrigin));
});

test('contract TriggerOutcome values stay isomorphic with the engine', () => {
  expect(values(TriggerOutcomeWire)).toEqual(values(TriggerOutcome));
});
