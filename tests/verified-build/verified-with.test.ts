import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import {
  parseQuant,
  verifiedWithFrom,
} from '../../src/verified-build/verified-with.ts';

test('parseQuant extracts a quant suffix from a model tag, else undefined', () => {
  expect(parseQuant('qwen2.5:7b-instruct-q4_K_M')).toBe('q4_K_M');
  expect(parseQuant('llama3.1-8b-q4_0')).toBe('q4_0');
  expect(parseQuant('qwen2.5:7b')).toBeUndefined();
});

test('verifiedWithFrom maps a resolved decl+numCtx onto a VerifiedWith', () => {
  const vw = verifiedWithFrom(
    {
      decl: {
        runtime: RuntimeKind.Ollama,
        model: 'qwen2.5:7b-instruct-q4_K_M',
        params: {},
        role: 'r',
        footprint: { approxParamsBillions: 7, bytesPerWeight: 0.5 },
      },
      numCtx: 8192,
    },
    1000,
  );
  expect(vw).toEqual({
    runtime: RuntimeKind.Ollama,
    model: 'qwen2.5:7b-instruct-q4_K_M',
    paramsBillions: 7,
    numCtx: 8192,
    quant: 'q4_K_M',
    capturedAtMs: 1000,
  });
});
