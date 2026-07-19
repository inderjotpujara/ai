import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createCheckpointStore } from '../../src/workflow/checkpoint.ts';
import { defineWorkflow } from '../../src/workflow/define.ts';
import { runWorkflow } from '../../src/workflow/engine.ts';
import type { WorkflowDeps } from '../../src/workflow/run-step.ts';
import { StepKind } from '../../src/workflow/types.ts';

/** A linear 3-node DAG a→b→c where each node's execution bumps a per-node
 *  counter, so we can assert exactly how many times each node's body ran. */
function threeNodeFlow() {
  return defineWorkflow({
    id: 'resume-flow',
    steps: [
      {
        id: 'a',
        kind: StepKind.Agent,
        agent: 'a',
        input: () => 'a',
        output: z.string(),
      },
      {
        id: 'b',
        kind: StepKind.Agent,
        agent: 'b',
        input: (ctx) => `after ${ctx.a}`,
        output: z.string(),
      },
      {
        id: 'c',
        kind: StepKind.Agent,
        agent: 'c',
        input: (ctx) => `after ${ctx.b}`,
        output: z.string(),
      },
    ],
  });
}

/** runAgentStep that counts executions per node and can be told to throw on `b`. */
function countingDeps(counts: Record<string, number>, failB: () => boolean) {
  const deps: WorkflowDeps = {
    tools: {},
    runAgentStep: async (name) => {
      counts[name] = (counts[name] ?? 0) + 1;
      if (name === 'b' && failB()) throw new Error('b crashed');
      return name.toUpperCase();
    },
  };
  return deps;
}

test('a run killed after node a resumes without re-executing a and finishes b,c', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-'));
  const def = threeNodeFlow();
  const counts: Record<string, number> = {};
  let bShouldFail = true;

  // Pass 1: b throws → run fails at b. a is checkpointed, c never reached.
  const store1 = createCheckpointStore(dir);
  const out1 = await runWorkflow(def, 'go', {
    ...countingDeps(counts, () => bShouldFail),
    checkpoint: store1,
  });
  expect(out1).toMatchObject({ kind: 'failed', failedStep: 'b' });
  expect(counts.a).toBe(1);
  expect(counts.c ?? 0).toBe(0);
  expect(createCheckpointStore(dir).completed()).toEqual(new Set(['a']));

  // Pass 2: RESUME same run dir. a must NOT re-execute; b,c run to completion.
  bShouldFail = false;
  const store2 = createCheckpointStore(dir);
  const out2 = await runWorkflow(def, 'go', {
    ...countingDeps(counts, () => bShouldFail),
    checkpoint: store2,
  });
  expect(out2.kind).toBe('done');
  // Side-effect counter proves node a's body ran EXACTLY ONCE across both passes.
  expect(counts.a).toBe(1);
  expect(counts.c).toBe(1);
  if (out2.kind === 'done') {
    expect(out2.output.a).toBe('A'); // seeded from the checkpoint, not re-run
    expect(out2.output.c).toBe('C');
  }
});

test('a fully-checkpointed run resumes to completion with zero node executions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-'));
  const def = threeNodeFlow();
  const counts: Record<string, number> = {};

  const store1 = createCheckpointStore(dir);
  const out1 = await runWorkflow(def, 'go', {
    ...countingDeps(counts, () => false),
    checkpoint: store1,
  });
  expect(out1.kind).toBe('done');
  expect(counts).toEqual({ a: 1, b: 1, c: 1 });

  // Re-run: every node is checkpointed → nothing executes again.
  const store2 = createCheckpointStore(dir);
  const out2 = await runWorkflow(def, 'go', {
    ...countingDeps(counts, () => false),
    checkpoint: store2,
  });
  expect(out2.kind).toBe('done');
  expect(counts).toEqual({ a: 1, b: 1, c: 1 }); // unchanged — zero re-execution
});

test('a fresh run with no checkpoint executes all nodes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-'));
  const def = threeNodeFlow();
  const counts: Record<string, number> = {};
  const out = await runWorkflow(def, 'go', {
    ...countingDeps(counts, () => false),
    checkpoint: createCheckpointStore(dir),
  });
  expect(out.kind).toBe('done');
  expect(counts).toEqual({ a: 1, b: 1, c: 1 });
});
