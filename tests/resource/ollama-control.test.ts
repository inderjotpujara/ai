import { afterEach, expect, spyOn, test } from 'bun:test';
import {
  isModelInstalled,
  pullModel,
} from '../../src/resource/ollama-control.ts';

afterEach(() => {
  (globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.();
});

test('isModelInstalled returns true when /api/tags lists the model by name', async () => {
  // biome-ignore lint/suspicious/noExplicitAny: spyOn requires dynamic property access
  spyOn(globalThis, 'fetch' as any).mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }), {
        status: 200,
      }),
    ),
  );
  expect(await isModelInstalled('qwen3:8b')).toBe(true);
  expect(await isModelInstalled('llama3:8b')).toBe(false);
});

test('pullModel POSTs the model field and resolves on 200', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ status: 'success' }), { status: 200 }),
  );
  await pullModel('qwen3:8b');
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('http://localhost:11434/api/pull');
  expect(JSON.parse(init.body as string)).toEqual({
    model: 'qwen3:8b',
    stream: false,
  });
});
