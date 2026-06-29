import { afterEach, expect, spyOn, test } from 'bun:test';
import {
  isModelInstalled,
  listLoadedModels,
  pullModel,
  unloadModel,
  warmModel,
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

test('warmModel POSTs to /api/generate with stream: false', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({}), { status: 200 }),
  );
  await warmModel('qwen3:8b');
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('http://localhost:11434/api/generate');
  expect(JSON.parse(init.body as string)).toEqual({
    model: 'qwen3:8b',
    stream: false,
  });
});

test('unloadModel POSTs to /api/generate with keep_alive: 0 and stream: false', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({}), { status: 200 }),
  );
  await unloadModel('qwen3:8b');
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('http://localhost:11434/api/generate');
  expect(JSON.parse(init.body as string)).toEqual({
    model: 'qwen3:8b',
    keep_alive: 0,
    stream: false,
  });
});

test('listLoadedModels maps /api/ps name + size to LoadedModel[]', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        models: [
          { name: 'qwen3:8b', size: 6_000_000_000 },
          { name: 'qwen3:4b', size: 3_500_000_000 },
        ],
      }),
      { status: 200 },
    ),
  );
  const loaded = await listLoadedModels();
  expect(loaded).toEqual([
    { name: 'qwen3:8b', sizeBytes: 6_000_000_000 },
    { name: 'qwen3:4b', sizeBytes: 3_500_000_000 },
  ]);
  expect((fetchSpy.mock.calls[0] as [string])[0]).toBe(
    'http://localhost:11434/api/ps',
  );
});

test('listLoadedModels returns [] when nothing is loaded', async () => {
  spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ models: [] }), { status: 200 }),
  );
  expect(await listLoadedModels()).toEqual([]);
});
