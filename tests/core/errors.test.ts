import { expect, test } from 'bun:test';
import {
  DelegationError,
  ProviderError,
  ResourceError,
} from '../../src/core/errors.ts';

test('typed errors carry their class name and message', () => {
  const err = new ResourceError('model does not fit budget');
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('ResourceError');
  expect(err.message).toBe('model does not fit budget');
});

test('ProviderError preserves an optional cause', () => {
  const cause = new Error('connection refused');
  const err = new ProviderError('ollama unreachable', { cause });
  expect(err.name).toBe('ProviderError');
  expect(err.cause).toBe(cause);
});

test('DelegationError carries its class name', () => {
  const err = new DelegationError('sub-agent file_qa failed');
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('DelegationError');
  expect(err.message).toBe('sub-agent file_qa failed');
});
