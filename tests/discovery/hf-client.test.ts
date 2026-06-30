import { afterEach, expect, test } from 'bun:test';
import { hfGet } from '../../src/discovery/hf-client.ts';

const orig = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = orig;
  delete process.env.HF_TOKEN;
});

test('parses JSON from a successful response', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: 1 }), {
      status: 200,
    })) as unknown as typeof fetch;
  expect(await hfGet('/api/models?filter=gguf')).toEqual({ ok: 1 });
});
test('adds bearer auth when HF_TOKEN is set', async () => {
  process.env.HF_TOKEN = 'tok';
  let seen: Headers | undefined;
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    seen = new Headers(init?.headers);
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  await hfGet('/api/models');
  expect(seen?.get('authorization')).toBe('Bearer tok');
});
test('throws DiscoveryError on non-ok', async () => {
  globalThis.fetch = (async () =>
    new Response('nope', { status: 429 })) as unknown as typeof fetch;
  await expect(hfGet('/api/models')).rejects.toThrow();
});
