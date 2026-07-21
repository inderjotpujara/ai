import { expect, test } from 'bun:test';
import { loadConfig } from '../../src/config/schema.ts';

test('trigger knobs carry computed/conventional defaults', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_TRIGGERS_POLL_MS).toBe(1000);
  expect(values.AGENT_TRIGGERS_MAX_CHAIN_DEPTH).toBe(8);
  expect(values.AGENT_TRIGGERS_WATCH_ROOT).toBe('~/.agent/inbox');
  expect(values.AGENT_TRIGGERS_ENABLED).toBe(false);
  expect(sources.AGENT_TRIGGERS_ENABLED).toBe('default');
});

test('trigger knobs honor env overrides', () => {
  const { values, sources } = loadConfig({
    AGENT_TRIGGERS_POLL_MS: '500',
    AGENT_TRIGGERS_MAX_CHAIN_DEPTH: '3',
    AGENT_TRIGGERS_WATCH_ROOT: '/tmp/custom-inbox',
    AGENT_TRIGGERS_ENABLED: '1',
  });
  expect(values.AGENT_TRIGGERS_POLL_MS).toBe(500);
  expect(values.AGENT_TRIGGERS_MAX_CHAIN_DEPTH).toBe(3);
  expect(values.AGENT_TRIGGERS_WATCH_ROOT).toBe('/tmp/custom-inbox');
  expect(values.AGENT_TRIGGERS_ENABLED).toBe(true);
  expect(sources.AGENT_TRIGGERS_ENABLED).toBe('env');
});

test('no AGENT_TRIGGERS_PATH knob is registered (dropped — no consumer)', () => {
  const { values } = loadConfig({});
  expect(values.AGENT_TRIGGERS_PATH).toBeUndefined();
});
