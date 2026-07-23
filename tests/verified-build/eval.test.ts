import { describe, expect, test } from 'bun:test';
import { evalRuns } from '../../src/verified-build/config.ts';
import type { EvalDeps } from '../../src/verified-build/eval.ts';
import { evalCases, runGoldenEval } from '../../src/verified-build/eval.ts';
import { JudgeUnavailableError } from '../../src/verified-build/judge.ts';
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

  test('a Grounded case is judged via checkClaim (document/claim), not the rubric', async () => {
    const prompts: string[] = [];
    const grounded: GoldenCase = {
      id: 'g',
      input: 'input g',
      assert: 'the answer cites the doc',
      kind: GoldenKind.Grounded,
    };
    const res = await evalCases(
      [grounded],
      deps(async (prompt) => {
        prompts.push(prompt);
        return true;
      }),
    );
    expect(res.passed).toBe(true);
    const first = prompts[0] ?? '';
    // checkClaim's MiniCheck shape: the artifact output is the Document,
    // the assert is the Claim.
    expect(first).toContain('Document:\noutput for input g');
    expect(first).toContain('Claim: the answer cites the doc');
    expect(first).toContain('Is the claim fully supported by the document?');
    expect(first).not.toContain('Does this output satisfy the requirement?');
  });

  test('a Grounded case with EMPTY output auto-fails without calling the judge', async () => {
    let judgeCalls = 0;
    const grounded: GoldenCase = {
      id: 'g',
      input: 'input g',
      assert: 'the answer cites the doc',
      kind: GoldenKind.Grounded,
    };
    const res = await evalCases([grounded], {
      runCase: async () => '   ',
      judge: async () => {
        judgeCalls++;
        return true;
      },
      judgeModel: 'judge-model',
      belowBar: false,
    });
    expect(res.passed).toBe(false);
    expect(judgeCalls).toBe(0);
  });
});

describe('runGoldenEval', () => {
  const oneCase: GoldenCase[] = [
    { id: 'c0', input: 'x', assert: 'ok', kind: GoldenKind.TaskSuccess },
  ];

  test('returns an EvalResult bound to the selected judge for a qualifying candidate', async () => {
    const res = await runGoldenEval({
      cases: oneCase,
      judgeCandidates: () => [{ model: 'J:32b', params: 32e9, family: 'jf' }],
      generatorFamily: 'gf',
      runCase: async () => 'answer',
      judge: async () => true,
    });
    expect(res?.passed).toBe(true);
    expect(res?.judgeModel).toBe('J:32b');
    expect(res?.belowBar).toBe(false);
  });

  test('binds the SELECTED judge model into every judge call (C3), never the generator', async () => {
    const seen: string[] = [];
    const res = await runGoldenEval({
      cases: oneCase,
      judgeCandidates: () => [
        { model: 'J:32b', params: 32e9, family: 'jf' },
        { model: 'gen-twin', params: 32e9, family: 'gf' },
      ],
      generatorFamily: 'gf',
      runCase: async () => 'answer',
      judge: async (model) => {
        seen.push(model);
        return true;
      },
    });
    expect(res?.passed).toBe(true);
    expect(new Set(seen)).toEqual(new Set(['J:32b']));
  });

  test('returns null when no candidate clears the param bar (below bar)', async () => {
    const res = await runGoldenEval({
      cases: oneCase,
      judgeCandidates: () => [{ model: 'small', params: 1e9, family: 'jf' }],
      runCase: async () => 'answer',
      judge: async () => true,
    });
    expect(res).toBeNull();
  });

  test('degrades to null (skip eval) when the judge model is unavailable', async () => {
    const res = await runGoldenEval({
      cases: oneCase,
      judgeCandidates: () => [{ model: 'J:32b', params: 32e9, family: 'jf' }],
      runCase: async () => 'answer',
      judge: async () => {
        throw new JudgeUnavailableError('J:32b');
      },
    });
    expect(res).toBeNull();
  });

  test('a non-JudgeUnavailableError from the judge still propagates', async () => {
    await expect(
      runGoldenEval({
        cases: oneCase,
        judgeCandidates: () => [{ model: 'J:32b', params: 32e9, family: 'jf' }],
        runCase: async () => 'answer',
        judge: async () => {
          throw new Error('unexpected boom');
        },
      }),
    ).rejects.toThrow('unexpected boom');
  });
});
