import { expect, test } from 'bun:test';
import { loadConfig } from '../../src/config/schema.ts';

test('A2A knobs carry conventional defaults', () => {
  const { values } = loadConfig({});
  expect(values.AGENT_A2A_ENABLED).toBe(false);
  expect(values.AGENT_A2A_CARD_TTL).toBe(300);
  expect(values.AGENT_A2A_REPLAY_WINDOW_MS).toBe(300_000);
  expect(values.AGENT_A2A_SKILLS_PATH).toBe('a2a-skills.json');
  expect(values.AGENT_A2A_REMOTES_PATH).toBe('~/.config/ai/a2a-remotes.json');
});
