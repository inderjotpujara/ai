import { expect, test } from 'bun:test';
import { createFileQaAgent } from '../../agents/file-qa.ts';
import { createWebFetchAgent } from '../../agents/web-fetch.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';

test('file_qa declares a tool requirement with largest-that-fits', () => {
  const a = createFileQaAgent({});
  expect(a.modelReq?.requires).toContain(Capability.Tools);
  expect(a.modelReq?.prefer).toBe(PreferPolicy.LargestThatFits);
});

test('web_fetch declares a tool requirement with largest-that-fits', () => {
  const a = createWebFetchAgent({});
  expect(a.modelReq?.requires).toContain(Capability.Tools);
  expect(a.modelReq?.prefer).toBe(PreferPolicy.LargestThatFits);
});
