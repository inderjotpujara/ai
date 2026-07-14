import { expect, test } from 'bun:test';
import { CONFIG_SPEC, loadConfig } from '../../src/config/schema.ts';

const byEnv = (env: string) => CONFIG_SPEC.find((e) => e.env === env);

test('the three AGENT_WEB_* entries exist with documented defaults', () => {
  expect(byEnv('AGENT_WEB_PORT')?.def).toBe(4130);
  expect(byEnv('AGENT_WEB_ORIGIN_ALLOWLIST')?.kind).toBe('string');
  expect(byEnv('AGENT_WEB_RECORD_IO')?.def).toBe(false);
});

test('strict flag marks the === "1" default-off booleans', () => {
  expect(byEnv('AGENT_WEB_RECORD_IO')?.strict).toBe(true);
  expect(byEnv('AGENT_MCP_AUTO_APPROVE')?.strict).toBe(true);
  expect(byEnv('AGENT_PROVISION_AUTO_YES')?.strict).toBe(true);
  // A default-on boolean carries no strict flag.
  expect(byEnv('AGENT_TELEMETRY_RECORD_IO')?.strict).toBeUndefined();
});

test('loadConfig behavior is unchanged: web record-IO defaults off, env overrides', () => {
  expect(loadConfig({}).values.AGENT_WEB_RECORD_IO).toBe(false);
  expect(loadConfig({ AGENT_WEB_RECORD_IO: '1' }).values.AGENT_WEB_RECORD_IO).toBe(true);
  expect(loadConfig({ AGENT_WEB_PORT: '5555' }).values.AGENT_WEB_PORT).toBe(5555);
});
