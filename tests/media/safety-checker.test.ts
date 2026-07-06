import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mfluxStrategy } from '../../src/media/generate/image-mflux.ts';
import { buildDiffusersFlags } from '../../src/media/generate/safety.ts';

let savedUncensored: string | undefined;

beforeEach(() => {
  savedUncensored = process.env.AGENT_UNCENSORED;
});

afterEach(() => {
  if (savedUncensored === undefined) {
    delete process.env.AGENT_UNCENSORED;
  } else {
    process.env.AGENT_UNCENSORED = savedUncensored;
  }
});

test('buildDiffusersFlags includes safety_checker=None when explicitly disabled', () => {
  expect(buildDiffusersFlags({ disableSafetyChecker: true })).toContain(
    'safety_checker=None',
  );
});

test('buildDiffusersFlags omits safety_checker=None when explicitly enabled', () => {
  expect(buildDiffusersFlags({ disableSafetyChecker: false })).not.toContain(
    'safety_checker=None',
  );
  expect(buildDiffusersFlags({ disableSafetyChecker: false })).toEqual([]);
});

test('buildDiffusersFlags defaults to uncensoredEnabled() when undefined — default on', () => {
  delete process.env.AGENT_UNCENSORED;
  expect(buildDiffusersFlags({})).toContain('safety_checker=None');
});

test('buildDiffusersFlags defaults to uncensoredEnabled() when undefined — AGENT_UNCENSORED=0', () => {
  process.env.AGENT_UNCENSORED = '0';
  expect(buildDiffusersFlags({})).not.toContain('safety_checker=None');
  expect(buildDiffusersFlags({})).toEqual([]);
});

test('mflux (filter-free) buildOneShot args are unchanged regardless of disableSafetyChecker', () => {
  delete process.env.AGENT_IMAGE_MODEL;
  const buildOneShot = mfluxStrategy.buildOneShot;
  if (!buildOneShot) {
    throw new Error('buildOneShot must be defined');
  }
  const withDisable = buildOneShot('a fox', '/out.png', {
    disableSafetyChecker: true,
  });
  const withoutDisable = buildOneShot('a fox', '/out.png', {
    disableSafetyChecker: false,
  });
  const undefinedDisable = buildOneShot('a fox', '/out.png', {});

  expect(withDisable.args).toEqual(withoutDisable.args);
  expect(withDisable.args).toEqual(undefinedDisable.args);
  expect(withDisable.cmd).toBe(withoutDisable.cmd);
});
