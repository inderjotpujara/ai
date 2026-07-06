import { expect, test } from 'bun:test';
import { AGENTS, agentNames } from '../../agents/index.ts';
import { Capability } from '../../src/core/types.ts';

test('vision specialist is registered and requires Vision', () => {
  expect(agentNames()).toContain('vision');
  const visionFactory = AGENTS.vision;
  expect(visionFactory).toBeDefined();
  const agent = visionFactory?.({});
  expect(agent?.name).toBe('vision');
  expect(agent?.modelReq?.requires).toContain(Capability.Vision);
});
