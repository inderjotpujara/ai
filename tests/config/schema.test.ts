import { expect, test } from 'bun:test';
import { CONFIG_SPEC, loadConfig } from '../../src/config/schema.ts';

test('every entry has a doc string and a default', () => {
  for (const e of CONFIG_SPEC) {
    expect(e.doc.length).toBeGreaterThan(0);
    expect(e.def).toBeDefined();
  }
});
test('loadConfig applies defaults and records source', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(5);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('default');
});
test('a valid env override wins and is marked env', () => {
  const { values, sources } = loadConfig({ AGENT_MAX_DELEGATION_DEPTH: '8' });
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(8);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('env');
});
test('an invalid number falls back to the default (env-fallback-only rule)', () => {
  const { values, sources } = loadConfig({
    AGENT_MAX_DELEGATION_DEPTH: 'notanumber',
  });
  expect(values.AGENT_MAX_DELEGATION_DEPTH).toBe(5);
  expect(sources.AGENT_MAX_DELEGATION_DEPTH).toBe('default');
});

test('AGENT_SESSIONS_PATH defaults to "sessions" (Slice 30b Phase 6)', () => {
  const { values, sources } = loadConfig({});
  expect(values.AGENT_SESSIONS_PATH).toBe('sessions');
  expect(sources.AGENT_SESSIONS_PATH).toBe('default');
});
test('AGENT_SESSIONS_PATH honors an env override (Slice 30b Phase 6)', () => {
  const { values, sources } = loadConfig({
    AGENT_SESSIONS_PATH: '/tmp/custom-sessions',
  });
  expect(values.AGENT_SESSIONS_PATH).toBe('/tmp/custom-sessions');
  expect(sources.AGENT_SESSIONS_PATH).toBe('env');
});
