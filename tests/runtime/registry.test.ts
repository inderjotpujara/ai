import { describe, expect, it } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { runtimeFor } from '../../src/runtime/registry.ts';

describe('runtimeFor', () => {
  it('returns the Ollama runtime', () => {
    expect(runtimeFor(RuntimeKind.Ollama).kind).toBe(RuntimeKind.Ollama);
  });
  it('returns the MLX server runtime', () => {
    expect(runtimeFor(RuntimeKind.MlxServer).kind).toBe(RuntimeKind.MlxServer);
  });
});
