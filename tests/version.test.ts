import { expect, test } from 'bun:test';
import { APP_VERSION } from '../src/version.ts';

test('APP_VERSION is a semver string', () => {
  expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});
