import { describe, expect, test } from 'bun:test';
import { evalRuns } from '../../src/verified-build/config.ts';
import type { EvalDeps } from '../../src/verified-build/eval.ts';
import { evalCases } from '../../src/verified-build/eval.ts';
import type { GoldenCase } from '../../src/verified-build/types.ts';
import { GoldenKind } from '../../src/verified-build/types.ts';

function goldenCase(id: string): GoldenCase {
  return {
    id,
    input: `input ${id}`,
    assert: `assert ${id}`,
    kind: GoldenKind.TaskSuccess,
  };
}

function deps(judge: EvalDeps['judge']): EvalDeps {
  return {
    runCase: async (input) => `output for ${input}`,
    judge,
    judgeModel: 'judge-model',
    belowBar: false,
  };
}

describe('evalCases', () => {
  test('always-yes judge passes every case', async () => {
    const res = await evalCases(
      [goldenCase('a'), goldenCase('b')],
      deps(async () => true),
    );
    expect(res.passed).toBe(true);
    expect(res.passedCount).toBe(2);
    expect(res.total).toBe(2);
    expect(res.perCase.map((r) => r.passed)).toEqual([true, true]);
    expect(res.judgeModel).toBe('judge-model');
    expect(res.belowBar).toBe(false);
  });

  test('a non-unanimous verdict fails the case', async () => {
    expect(evalRuns()).toBe(3);
    let call = 0;
    const verdicts = [true, true, false];
    const res = await evalCases(
      [goldenCase('a')],
      deps(async () => {
        const v = verdicts[call];
        call++;
        return v ?? true;
      }),
    );
    expect(call).toBe(3);
    expect(res.passed).toBe(false);
    expect(res.passedCount).toBe(0);
    expect(res.perCase[0]?.passed).toBe(false);
  });

  test('one passing and one failing case fails overall with the count', async () => {
    const res = await evalCases(
      [goldenCase('pass'), goldenCase('fail')],
      deps(async (prompt) => !prompt.includes('assert fail')),
    );
    expect(res.passed).toBe(false);
    expect(res.passedCount).toBe(1);
    expect(res.total).toBe(2);
    expect(res.perCase.find((r) => r.id === 'pass')?.passed).toBe(true);
    expect(res.perCase.find((r) => r.id === 'fail')?.passed).toBe(false);
  });

  test('judge sees the binary rubric with requirement and output', async () => {
    const prompts: string[] = [];
    await evalCases(
      [goldenCase('a')],
      deps(async (prompt) => {
        prompts.push(prompt);
        return true;
      }),
    );
    const first = prompts[0] ?? '';
    expect(first).toContain('Requirement: assert a');
    expect(first).toContain('output for input a');
    expect(first).toContain('Answer only Yes or No.');
  });
});
