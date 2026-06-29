import { expect, test } from 'bun:test';
import {
  Capability, ContentPolicy, type ModelDeclaration, PreferPolicy, ProviderKind,
} from '../../src/core/types.ts';
import { selectCandidates } from '../../src/resource/selector.ts';

function m(model: string, caps: Capability[], policy?: ContentPolicy): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama, model, params: {}, role: 'r',
    capabilities: caps, contentPolicy: policy,
    footprint: { approxParamsBillions: 7, bytesPerWeight: 0.56 },
  };
}
const tools = { role: 'r', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits };

test('uncensored models excluded by default', () => {
  const reg = [m('safe', [Capability.Tools]), m('unc', [Capability.Tools], ContentPolicy.Uncensored)];
  expect(selectCandidates(tools, reg).map((d) => d.model)).toEqual(['safe']);
});
test('uncensored included when allowUncensored', () => {
  const reg = [m('safe', [Capability.Tools]), m('unc', [Capability.Tools], ContentPolicy.Uncensored)];
  const out = selectCandidates({ ...tools, allowUncensored: true }, reg).map((d) => d.model);
  expect(out.sort()).toEqual(['safe', 'unc']);
});
test('vision-only model excluded for a tools requirement', () => {
  const reg = [m('vis', [Capability.Vision]), m('tool', [Capability.Tools])];
  expect(selectCandidates(tools, reg).map((d) => d.model)).toEqual(['tool']);
});
