import { describe, expect, it } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { RUNTIMES, runtimeFor } from '../../src/runtime/registry.ts';

describe('runtimeFor', () => {
  it('returns the Ollama runtime', () => {
    expect(runtimeFor(RuntimeKind.Ollama).kind).toBe(RuntimeKind.Ollama);
  });
  it('returns the MLX server runtime', () => {
    expect(runtimeFor(RuntimeKind.MlxServer).kind).toBe(RuntimeKind.MlxServer);
  });
  it('every registered runtime exposes control + model factory', () => {
    for (const rt of RUNTIMES) {
      expect(typeof rt.control.isInstalled).toBe('function');
      expect(typeof rt.createModel).toBe('function');
    }
  });
  it('throws for an unregistered runtime kind', () => {
    expect(() => runtimeFor('NotARuntime' as RuntimeKind)).toThrow();
  });
});
