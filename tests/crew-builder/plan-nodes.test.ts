import { expect, test } from 'bun:test';
import type { BuilderModel } from '../../src/agent-builder/types.ts';
import { planNodes } from '../../src/crew-builder/plan-nodes.ts';

const model = (obj: unknown): BuilderModel => ({
  object: async () => obj as never,
  text: async () => '',
});

test('crew node plan returns members', async () => {
  const plan = await planNodes(
    'x',
    'crew',
    'analysis',
    model({
      members: [
        {
          name: 'researcher',
          role: 'r',
          goal: 'g',
          backstory: 'b',
          requires: ['tools'],
          tools: [],
        },
      ],
    }),
    ['fetch'],
  );
  expect(plan.members?.[0]?.name).toBe('researcher');
});
test('drops tools not in the palette', async () => {
  const plan = await planNodes(
    'x',
    'crew',
    'a',
    model({
      members: [
        {
          name: 'm',
          role: 'r',
          goal: 'g',
          backstory: 'b',
          requires: ['tools'],
          tools: ['fetch', 'not_in_pack'],
        },
      ],
    }),
    ['fetch'],
  );
  expect(plan.members?.[0]?.tools).toEqual(['fetch']);
});
