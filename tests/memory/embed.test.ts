import { describe, expect, test } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { embedderDecl } from '../../src/memory/embed.ts';

describe('embedderDecl', () => {
  test('is weights-only (no KV budget)', () => {
    const d = embedderDecl('qwen3-embedding:0.6b');
    expect(d.model).toBe('qwen3-embedding:0.6b');
    expect(d.provider).toBe(ProviderKind.Ollama);
    expect(d.footprint.kvBytesPerToken).toBe(0);
    expect(d.footprint.approxParamsBillions).toBeGreaterThan(0);
  });

  test('carries a role and empty params for the model manager', () => {
    const d = embedderDecl('qwen3-embedding:0.6b');
    expect(d.role).toBeTruthy();
    expect(d.params).toEqual({});
  });
});
