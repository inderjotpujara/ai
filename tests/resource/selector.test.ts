import { expect, test } from 'bun:test';
import {
  Capability,
  type ModelDeclaration,
  PreferPolicy,
  ProviderKind,
} from '../../src/core/types.ts';
import { selectCandidates } from '../../src/resource/selector.ts';

function m(
  model: string,
  b: number,
  caps: Capability[],
  bpw = 0.56,
): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: {},
    role: 'test',
    capabilities: caps,
    footprint: { approxParamsBillions: b, bytesPerWeight: bpw },
  };
}

const tools = {
  role: 'r',
  requires: [Capability.Tools],
  prefer: PreferPolicy.LargestThatFits,
};

test('hard-filters out models missing a required capability', () => {
  const reg = [
    m('big-novtools', 9, []),
    m('small-tools', 4, [Capability.Tools]),
  ];
  const out = selectCandidates(tools, reg);
  expect(out.map((d) => d.model)).toEqual(['small-tools']);
});

test('ranks largest params first', () => {
  const reg = [m('a4', 4, [Capability.Tools]), m('b9', 9, [Capability.Tools])];
  expect(selectCandidates(tools, reg).map((d) => d.model)).toEqual([
    'b9',
    'a4',
  ]);
});

test('tie-break: equal params -> smaller footprint first', () => {
  const reg = [
    m('heavy', 9, [Capability.Tools], 0.9),
    m('light', 9, [Capability.Tools], 0.5),
  ];
  expect(selectCandidates(tools, reg).map((d) => d.model)).toEqual([
    'light',
    'heavy',
  ]);
});

test('warm-aware bias: among identical candidates, resident first', () => {
  const reg = [
    m('cold', 9, [Capability.Tools]),
    m('warm', 9, [Capability.Tools]),
  ];
  const out = selectCandidates(tools, reg, new Set(['warm']));
  expect(out.map((d) => d.model)).toEqual(['warm', 'cold']);
});
