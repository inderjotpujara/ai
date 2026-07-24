import { afterEach, describe, expect, test } from 'bun:test';
import { loadConfig } from '../../src/config/schema.ts';
import {
  reevalEnabled,
  reevalHysteresis,
  reevalRerunCases,
  reevalSweepCron,
} from '../../src/self-improve/config.ts';

test('reeval knobs carry conventional defaults', () => {
  const { values } = loadConfig({});
  expect(values.AGENT_REEVAL_ENABLED).toBe(true);
  expect(values.AGENT_REEVAL_SWEEP_CRON).toBe('0 4 * * *');
  expect(values.AGENT_REEVAL_HYSTERESIS).toBe(0.15);
  expect(values.AGENT_REEVAL_RERUN_CASES).toBe(2);
});

test('reeval knobs are overridden by env', () => {
  const { values } = loadConfig({
    AGENT_REEVAL_ENABLED: '0',
    AGENT_REEVAL_SWEEP_CRON: '30 2 * * *',
    AGENT_REEVAL_HYSTERESIS: '0.2',
    AGENT_REEVAL_RERUN_CASES: '3',
  });
  expect(values.AGENT_REEVAL_ENABLED).toBe(false);
  expect(values.AGENT_REEVAL_SWEEP_CRON).toBe('30 2 * * *');
  expect(values.AGENT_REEVAL_HYSTERESIS).toBe(0.2);
  expect(values.AGENT_REEVAL_RERUN_CASES).toBe(3);
});

// `src/self-improve/config.ts` reads AGENT_REEVAL_* via its own local
// readers (not `loadConfig`) — regression coverage for the Task-12 fix:
// those readers must honor an explicit `0`, not silently reject it via the
// legacy `Number(x) || fallback` idiom.
const REEVAL_ENV_KEYS = [
  'AGENT_REEVAL_ENABLED',
  'AGENT_REEVAL_SWEEP_CRON',
  'AGENT_REEVAL_HYSTERESIS',
  'AGENT_REEVAL_RERUN_CASES',
] as const;

function clearReevalEnv(): void {
  for (const key of REEVAL_ENV_KEYS) delete process.env[key];
}

describe('src/self-improve/config.ts readers', () => {
  afterEach(clearReevalEnv);

  test('explicit 0 is honored for hysteresis, not rejected as falsy', () => {
    process.env.AGENT_REEVAL_HYSTERESIS = '0';
    expect(reevalHysteresis()).toBe(0);
  });

  test('explicit 0 is honored for rerun-cases, not rejected as falsy', () => {
    process.env.AGENT_REEVAL_RERUN_CASES = '0';
    expect(reevalRerunCases()).toBe(0);
  });

  test('unset numeric knobs fall back to documented defaults', () => {
    expect(reevalHysteresis()).toBe(0.15);
    expect(reevalRerunCases()).toBe(2);
  });

  test('non-finite / garbage numeric env falls back to default', () => {
    process.env.AGENT_REEVAL_HYSTERESIS = 'not-a-number';
    process.env.AGENT_REEVAL_RERUN_CASES = 'NaN';
    expect(reevalHysteresis()).toBe(0.15);
    expect(reevalRerunCases()).toBe(2);
  });

  test('boolean reader still disables on "0" / "false" (case-insensitive)', () => {
    process.env.AGENT_REEVAL_ENABLED = '0';
    expect(reevalEnabled()).toBe(false);
    process.env.AGENT_REEVAL_ENABLED = 'FALSE';
    expect(reevalEnabled()).toBe(false);
    process.env.AGENT_REEVAL_ENABLED = 'true';
    expect(reevalEnabled()).toBe(true);
  });

  test('boolean reader defaults to enabled when unset', () => {
    expect(reevalEnabled()).toBe(true);
  });

  test('string reader honors an explicit override and falls back to default', () => {
    process.env.AGENT_REEVAL_SWEEP_CRON = '30 2 * * *';
    expect(reevalSweepCron()).toBe('30 2 * * *');
    delete process.env.AGENT_REEVAL_SWEEP_CRON;
    expect(reevalSweepCron()).toBe('0 4 * * *');
  });
});
