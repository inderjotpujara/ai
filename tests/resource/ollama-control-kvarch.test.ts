import { afterEach, expect, test } from 'bun:test';
import { getModelKvArch } from '../../src/resource/ollama-control.ts';

const orig = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = orig;
});

test('parses KV arch from /api/show model_info', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        model_info: {
          'general.architecture': 'qwen3',
          'qwen3.block_count': 36,
          'qwen3.attention.head_count_kv': 8,
          'qwen3.attention.key_length': 128,
          'qwen3.attention.value_length': 128,
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  const arch = await getModelKvArch('qwen3.5:9b');
  expect(arch).toEqual({
    blockCount: 36,
    headCountKv: 8,
    keyLength: 128,
    valueLength: 128,
    expertCount: 0,
  });
});
test('undefined when required fields missing', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ model_info: { 'general.architecture': 'x' } }),
      { status: 200 },
    )) as unknown as typeof fetch;
  expect(await getModelKvArch('x')).toBeUndefined();
});
test('undefined (no throw) on fetch failure', async () => {
  globalThis.fetch = (async () => {
    throw new Error('down');
  }) as unknown as typeof fetch;
  expect(await getModelKvArch('x')).toBeUndefined();
});
