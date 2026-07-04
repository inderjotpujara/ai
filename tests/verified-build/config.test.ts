import { describe, expect, test } from 'bun:test';
import {
  archiveIdleDays,
  dryRunMs,
  evalRuns,
  judgeMinParams,
  maxRepairs,
  reuseBands,
} from '../../src/verified-build/config.ts';

describe('verified-build config defaults', () => {
  test('dryRunMs defaults to 45000', () => {
    expect(dryRunMs()).toBe(45000);
  });

  test('maxRepairs defaults to 2', () => {
    expect(maxRepairs()).toBe(2);
  });

  test('reuseBands defaults to reuse 0.85 / offer 0.75', () => {
    expect(reuseBands().reuse).toBe(0.85);
    expect(reuseBands().offer).toBe(0.75);
  });

  test('judgeMinParams defaults to 24e9', () => {
    expect(judgeMinParams()).toBe(24e9);
  });

  test('archiveIdleDays defaults to 30', () => {
    expect(archiveIdleDays()).toBe(30);
  });

  test('evalRuns defaults to 3', () => {
    expect(evalRuns()).toBe(3);
  });
});

describe('verified-build config env overrides', () => {
  test('AGENT_REUSE_REUSE overrides reuse band', () => {
    const previous = process.env.AGENT_REUSE_REUSE;
    process.env.AGENT_REUSE_REUSE = '0.9';
    try {
      expect(reuseBands().reuse).toBe(0.9);
      expect(reuseBands().offer).toBe(0.75);
    } finally {
      if (previous === undefined) {
        delete process.env.AGENT_REUSE_REUSE;
      } else {
        process.env.AGENT_REUSE_REUSE = previous;
      }
    }
  });

  test('a non-numeric env value falls back to the default', () => {
    const previous = process.env.AGENT_BUILD_MAX_REPAIRS;
    process.env.AGENT_BUILD_MAX_REPAIRS = 'not-a-number';
    try {
      expect(maxRepairs()).toBe(2);
    } finally {
      if (previous === undefined) {
        delete process.env.AGENT_BUILD_MAX_REPAIRS;
      } else {
        process.env.AGENT_BUILD_MAX_REPAIRS = previous;
      }
    }
  });
});
