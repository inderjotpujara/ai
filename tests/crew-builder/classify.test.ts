// tests/crew-builder/classify.test.ts
import { expect, test } from 'bun:test';
import type { BuilderModel } from '../../src/agent-builder/types.ts';
import { classifyNeed } from '../../src/crew-builder/classify.ts';

const fakeModel = (obj: unknown): BuilderModel => ({
  object: async () => obj as never,
});

test('classifies role/task need as crew', async () => {
  expect(
    await classifyNeed(
      'a research team that writes a brief',
      fakeModel({ shape: 'crew' }),
    ),
  ).toBe('crew');
});
test('classifies branching/tool need as workflow', async () => {
  expect(
    await classifyNeed(
      'fetch a url then branch on status',
      fakeModel({ shape: 'workflow' }),
    ),
  ).toBe('workflow');
});
test('defaults to crew on unexpected value', async () => {
  expect(await classifyNeed('x', fakeModel({ shape: 'nonsense' }))).toBe(
    'crew',
  );
});
