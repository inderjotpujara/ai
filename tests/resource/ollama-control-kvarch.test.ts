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

// Fallback chain tests (live-fix: null head_count_kv + derived head_dim)

test('head_count_kv null → falls back to head_count', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        model_info: {
          'general.architecture': 'qwen35',
          'qwen35.block_count': 32,
          'qwen35.attention.head_count': 16,
          'qwen35.attention.head_count_kv': null,
          'qwen35.attention.key_length': 256,
          'qwen35.attention.value_length': 256,
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  expect(await getModelKvArch('qwen3.5:0.6b')).toEqual({
    blockCount: 32,
    headCountKv: 16,
    keyLength: 256,
    valueLength: 256,
    expertCount: 0,
  });
});

test('key_length absent → derived from embedding_length / head_count', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        model_info: {
          'general.architecture': 'gemma4',
          'gemma4.block_count': 32,
          'gemma4.attention.head_count': 16,
          'gemma4.attention.head_count_kv': 8,
          'gemma4.embedding_length': 4096,
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  expect(await getModelKvArch('gemma:7b')).toEqual({
    blockCount: 32,
    headCountKv: 8,
    keyLength: 256,
    valueLength: 256,
    expertCount: 0,
  });
});

test('truly insufficient (no block_count) → undefined', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        model_info: {
          'general.architecture': 'x',
          'x.attention.head_count': 16,
          'x.attention.head_count_kv': 8,
          'x.attention.key_length': 128,
          'x.attention.value_length': 128,
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  expect(await getModelKvArch('x')).toBeUndefined();
});

test('truly insufficient (no head info at all) → undefined', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        model_info: {
          'general.architecture': 'x',
          'x.block_count': 32,
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  expect(await getModelKvArch('x')).toBeUndefined();
});
