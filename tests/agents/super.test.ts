import { expect, test } from 'bun:test';
import { createSuperAgent } from '../../agents/super.ts';
import { CAPABILITY_GAP_TOOL } from '../../src/core/capability-gap.ts';

test('super agent exposes delegate tools for both specialists and the gap tool', () => {
  const fileTools = { read_file: { description: 'x' } } as never;
  const fetchTools = { fetch: { description: 'x' } } as never;
  const sup = createSuperAgent(fileTools, fetchTools);
  const toolNames = Object.keys(sup.tools);
  expect(toolNames).toContain('delegate_to_file_qa');
  expect(toolNames).toContain('delegate_to_web_fetch');
  expect(toolNames).toContain(CAPABILITY_GAP_TOOL);
  expect(sup.model).toBeTruthy();
});
