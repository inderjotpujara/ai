import { expect, test } from 'bun:test';
import { createFileQaAgent } from '../../agents/file-qa.ts';
import qwenFast from '../../models/qwen-fast.ts';

test('file-qa agent has the expected identity and injected tools', () => {
  const tools = { read_file: { description: 'x' } } as never;
  const agent = createFileQaAgent(tools);
  expect(agent.name).toBe('file_qa');
  expect(agent.description.toLowerCase()).toContain('file');
  expect(agent.tools).toBe(tools);
  expect(agent.model).toBeTruthy();
});

test('file-qa agent carries its model declaration', () => {
  const agent = createFileQaAgent({ read_file: { description: 'x' } } as never);
  expect(agent.modelDecl).toBe(qwenFast);
});
