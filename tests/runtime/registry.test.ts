import { expect, test } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { runtimeFor } from '../../src/runtime/registry.ts';

test('runtimeFor returns the Ollama runtime', () => {
  const rt = runtimeFor(ProviderKind.Ollama);
  expect(rt.kind).toBe(ProviderKind.Ollama);
  expect(typeof rt.control.isInstalled).toBe('function');
  expect(typeof rt.createModel).toBe('function');
});
test('runtimeFor throws on an unknown kind', () => {
  expect(() => runtimeFor('nope' as ProviderKind)).toThrow();
});
