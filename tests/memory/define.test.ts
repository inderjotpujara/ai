import { describe, expect, test } from 'bun:test';
import { defineMemory } from '../../src/memory/define.ts';
import { MemoryError } from '../../src/core/errors.ts';

describe('defineMemory', () => {
  test('applies fallback defaults', () => {
    const cfg = defineMemory({});
    expect(cfg.path).toBe('memory');
    expect(cfg.embedModel).toBe('qwen3-embedding:0.6b');
  });
  test('honors explicit values', () => {
    const cfg = defineMemory({ path: '/tmp/mem', embedModel: 'bge-m3' });
    expect(cfg.path).toBe('/tmp/mem');
    expect(cfg.embedModel).toBe('bge-m3');
  });
  test('rejects empty path', () => {
    expect(() => defineMemory({ path: '  ' })).toThrow(MemoryError);
  });
});
