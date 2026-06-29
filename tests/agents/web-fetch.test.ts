import { expect, test } from 'bun:test';
import { createWebFetchAgent } from '../../agents/web-fetch.ts';

test('web-fetch agent has the expected identity and injected tools', () => {
  const tools = { fetch: { description: 'x' } } as never;
  const agent = createWebFetchAgent(tools);
  expect(agent.name).toBe('web_fetch');
  expect(agent.description.toLowerCase()).toContain('url');
  expect(agent.tools).toBe(tools);
  expect(agent.model).toBeTruthy();
});
