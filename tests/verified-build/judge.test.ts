import { describe, expect, test } from 'bun:test';
import type { JudgeCandidate } from '../../src/verified-build/judge.ts';
import { selectJudge } from '../../src/verified-build/judge.ts';

const qwen: JudgeCandidate = { model: 'qwen', params: 26e9, family: 'qwen' };
const gemma: JudgeCandidate = { model: 'gemma', params: 9e9, family: 'gemma' };
const llama: JudgeCandidate = { model: 'llama', params: 30e9, family: 'llama' };

describe('selectJudge', () => {
  test('picks the only candidate above the bar even in the generator family', () => {
    const pick = selectJudge({
      candidates: () => [qwen, gemma],
      generatorFamily: 'qwen',
    });
    expect(pick).toEqual({ model: 'qwen', belowBar: false });
  });

  test('prefers a different family over a same-family candidate', () => {
    const pick = selectJudge({
      candidates: () => [qwen, gemma, llama],
      generatorFamily: 'qwen',
    });
    expect(pick).toEqual({ model: 'llama', belowBar: false });
  });

  test('degrades to belowBar when nothing clears the parameter bar', () => {
    const pick = selectJudge({
      candidates: () => [gemma],
      generatorFamily: 'qwen',
    });
    expect(pick).toEqual({ model: null, belowBar: true });
  });

  test('degrades to belowBar with no candidates at all', () => {
    const pick = selectJudge({ candidates: () => [] });
    expect(pick).toEqual({ model: null, belowBar: true });
  });

  test('within the same preference tier the larger model wins', () => {
    const bigQwen: JudgeCandidate = {
      model: 'qwen-big',
      params: 70e9,
      family: 'qwen',
    };
    const pick = selectJudge({
      candidates: () => [qwen, bigQwen],
      generatorFamily: 'qwen',
    });
    expect(pick).toEqual({ model: 'qwen-big', belowBar: false });
  });
});
