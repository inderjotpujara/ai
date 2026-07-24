import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newRunId } from '../../src/run/run-id.ts';
import { EvalMode } from '../../src/server/jobs/dispatch.ts';
import { createRealRunEvalTurn } from '../../src/server/launch-turns.ts';

// Slice 32 Task 16 wires the REAL eval turn end-to-end. The composition (model
// manager + registry + resolve/runCase/judge over live models + MCP-free golden
// replay) is covered by live-verify, exactly like the sibling real turns
// (`createRealRunChatTurn` et al) — a unit test can only exercise the seam that
// does NOT need a live model. Two properties are unit-checkable offline:
//   1. Constructing the turn no longer throws the Task-8 stub (it now returns a
//      thin closure that builds its deps per-run, so boot never crashes).
//   2. The disabled-master-switch path returns a terminal OrchestratorResult
//      without ever resolving a model (a Sweep with detection off short-circuits
//      before any registry scan / model call), which also proves the run scope,
//      per-run stores, and the `eval.reeval` root span all compose offline.

let dir: string;
let prevEnabled: string | undefined;
let prevQueue: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eval-turn-'));
  prevEnabled = process.env.AGENT_REEVAL_ENABLED;
  prevQueue = process.env.AGENT_QUEUE_PATH;
  // Detection OFF so a Sweep short-circuits ('reeval disabled') before touching
  // any model — keeps this a true offline unit test.
  process.env.AGENT_REEVAL_ENABLED = '0';
  process.env.AGENT_QUEUE_PATH = join(dir, 'jobs');
});
afterEach(async () => {
  process.env.AGENT_REEVAL_ENABLED = prevEnabled;
  process.env.AGENT_QUEUE_PATH = prevQueue;
  await rm(dir, { recursive: true, force: true });
});

test('createRealRunEvalTurn constructs without throwing (no longer the Task-8 stub)', () => {
  const turn = createRealRunEvalTurn(join(dir, 'runs'));
  expect(typeof turn).toBe('function');
});

test('createRealRunEvalTurn runs a disabled sweep to a terminal result offline (no model)', async () => {
  const turn = createRealRunEvalTurn(join(dir, 'runs'));
  const res = await turn({
    mode: EvalMode.Sweep,
    reason: 'test',
    runId: newRunId(),
  });
  expect(res).toEqual({ kind: 'answer', text: 'reeval disabled' });
});
