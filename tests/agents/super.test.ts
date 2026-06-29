import { expect, test } from 'bun:test';
import { createSuperAgent } from '../../agents/super.ts';
import { CAPABILITY_GAP_TOOL } from '../../src/core/capability-gap.ts';

test('super agent exposes a delegate_to_file_qa tool and the gap tool', () => {
  const tools = { read_file: { description: 'x' } } as never;
  const sup = createSuperAgent(tools);
  expect(Object.keys(sup.tools)).toContain('delegate_to_file_qa');
  expect(Object.keys(sup.tools)).toContain(CAPABILITY_GAP_TOOL);
  expect(sup.model).toBeTruthy();
});
