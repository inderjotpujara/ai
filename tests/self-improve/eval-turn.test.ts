import { expect, test } from 'bun:test';
import { createRealRunEvalTurn } from '../../src/server/launch-turns.ts';

// Slice 32 Task 8 lands only the dispatch SEAM. The real `RunEvalTurn` body
// imports `runEval` from `src/self-improve/executor.ts`, which does not exist
// until Task 14/16 — so `createRealRunEvalTurn` is a hard-throwing stub here,
// NOT wired into the daemon/server yet. Fail-fast: constructing it throws so a
// premature wiring crashes loudly rather than dispatching a no-op eval run.
test('createRealRunEvalTurn is a hard-throwing stub until Task 16', () => {
  expect(() => createRealRunEvalTurn('/tmp/runs-eval-turn')).toThrow(
    /runEval not wired until Task 16/,
  );
});
