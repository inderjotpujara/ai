import { expect, test } from 'bun:test';
import { ContentPolicy } from '../../src/core/types.ts';
import {
  isUncensoredModel,
  uncensoredEnabled,
} from '../../src/media/policy.ts';

test('uncensored defaults ON, off only when explicitly disabled', () => {
  expect(uncensoredEnabled({})).toBe(true);
  expect(uncensoredEnabled({ AGENT_UNCENSORED: '0' })).toBe(false);
  expect(uncensoredEnabled({ AGENT_UNCENSORED: 'false' })).toBe(false);
});

test('predicate matches the abliterated class and the enum tag', () => {
  expect(
    isUncensoredModel({ model: 'goekdenizguelmez/JOSIEFIED-Qwen3:8b' }),
  ).toBe(true);
  expect(isUncensoredModel({ model: 'qwen3.5:9b' })).toBe(false);
  expect(
    isUncensoredModel({
      model: 'x',
      contentPolicy: ContentPolicy.Uncensored,
    }),
  ).toBe(true);
});
