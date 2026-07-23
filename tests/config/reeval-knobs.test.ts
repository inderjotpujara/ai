import { expect, test } from 'bun:test';
import { loadConfig } from '../../src/config/schema.ts';

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
