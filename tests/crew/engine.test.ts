import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { z } from 'zod';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { runCrew } from '../../src/crew/engine.ts';
import { type CrewDef, CrewProcess } from '../../src/crew/types.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

const seqCrew: CrewDef = {
  id: 'c',
  process: CrewProcess.Sequential,
  members: [
    {
      name: 'a',
      role: 'A',
      goal: 'g',
      backstory: 'b',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
    {
      name: 'b',
      role: 'B',
      goal: 'g',
      backstory: 'b',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  ],
  tasks: [
    {
      id: 't1',
      description: 'do first',
      expectedOutput: 'x',
      member: 'a',
      output: z.string(),
    },
    {
      id: 't2',
      description: 'do second',
      expectedOutput: 'y',
      member: 'b',
      output: z.string(),
    },
  ],
};

describe('runCrew (sequential)', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    ({ exporter, provider } = registerTestProvider());
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  it('threads task output as context to the next task', async () => {
    const seen: string[] = [];
    const outcome = await runCrew(seqCrew, 'topic', {
      tools: {},
      // stub the agent runner: echo which member + whether it saw upstream context
      runAgentStep: async (member, task) => {
        seen.push(member);
        return `${member}:${task.includes('t1') ? 'saw-t1' : 'root'}`;
      },
    });
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      const out = outcome.output as Record<string, unknown>;
      expect(out.t1).toBe('a:root');
      expect(out.t2).toBe('b:saw-t1'); // t2's prompt embedded t1's output under "Context from \"t1\""
    }
    expect(seen).toEqual(['a', 'b']);
  });

  it('reports a failed task via the outcome', async () => {
    const outcome = await runCrew(seqCrew, 'topic', {
      tools: {},
      runAgentStep: async (member) => {
        if (member === 'b') throw new Error('boom');
        return 'ok';
      },
    });
    expect(outcome).toMatchObject({ kind: 'failed', failedTask: 't2' });
  });

  it('emits crew.task.member attribute on each task span', async () => {
    const outcome = await runCrew(seqCrew, 'topic', {
      tools: {},
      runAgentStep: async (member) => {
        return `${member}:ok`;
      },
    });
    expect(outcome.kind).toBe('done');

    const spans = exporter.getFinishedSpans();
    const stepSpans = spans.filter((s) => s.name === 'workflow.step');
    expect(stepSpans).toHaveLength(2); // one for t1, one for t2

    const t1Span = stepSpans.find((s) => s.attributes[ATTR.STEP_ID] === 't1');
    const t2Span = stepSpans.find((s) => s.attributes[ATTR.STEP_ID] === 't2');

    expect(t1Span?.attributes[ATTR.CREW_TASK_MEMBER]).toBe('a');
    expect(t2Span?.attributes[ATTR.CREW_TASK_MEMBER]).toBe('b');
  });
});
