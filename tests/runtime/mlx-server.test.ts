import { expect, test } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import {
  createMlxServerRuntime,
  mlxServerRuntime,
} from '../../src/runtime/mlx-server.ts';

test('mlx runtime has the right kind and builds a model', () => {
  expect(mlxServerRuntime.kind).toBe(RuntimeKind.MlxServer);
  const model = mlxServerRuntime.createModel({
    runtime: RuntimeKind.MlxServer,
    model: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
    params: {},
    role: 'r',
    footprint: { approxParamsBillions: 7, bytesPerWeight: 0.55 },
  });
  expect(model).toBeDefined();
});

test('isInstalled reads /v1/models', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [{ id: 'mlx-community/Qwen2.5-7B-Instruct-4bit' }],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  try {
    expect(
      await mlxServerRuntime.control.isInstalled(
        'mlx-community/Qwen2.5-7B-Instruct-4bit',
      ),
    ).toBe(true);
    expect(await mlxServerRuntime.control.isInstalled('absent')).toBe(false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

function fakeFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
    })) as unknown as typeof fetch;
}

test('getModelMax returns the exposed context length when present', async () => {
  const runtime = createMlxServerRuntime({
    baseUrl: 'http://fake:1234/v1',
    fetchImpl: fakeFetch({
      data: [
        { id: 'model-a', max_context_length: 32768 },
        { id: 'model-b', context_length: 8192 },
        { id: 'model-c' },
      ],
    }),
  });

  expect(await runtime.control.getModelMax('model-a')).toBe(32768);
  expect(await runtime.control.getModelMax('model-b')).toBe(8192);
  expect(await runtime.control.getModelMax('model-c')).toBeUndefined();
  expect(await runtime.control.getModelMax('missing')).toBeUndefined();
});

test('listLoaded maps ids and reports sizes when present', async () => {
  const runtime = createMlxServerRuntime({
    baseUrl: 'http://fake:1234/v1',
    fetchImpl: fakeFetch({
      data: [
        { id: 'model-a', size_bytes: 4_000_000_000 },
        { id: 'model-b', size: 2_000_000_000 },
        { id: 'model-c' },
      ],
    }),
  });

  const loaded = await runtime.control.listLoaded();
  expect(loaded).toEqual([
    { name: 'model-a', sizeBytes: 4_000_000_000 },
    { name: 'model-b', sizeBytes: 2_000_000_000 },
    { name: 'model-c', sizeBytes: 0 },
  ]);
});

test('isInstalled works against the injected fetch', async () => {
  const runtime = createMlxServerRuntime({
    baseUrl: 'http://fake:1234/v1',
    fetchImpl: fakeFetch({ data: [{ id: 'model-a' }] }),
  });

  expect(await runtime.control.isInstalled('model-a')).toBe(true);
  expect(await runtime.control.isInstalled('model-z')).toBe(false);
});

test('a metadata fetch failure degrades to undefined/[] instead of throwing', async () => {
  const failingFetch = (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;
  const runtime = createMlxServerRuntime({
    baseUrl: 'http://fake:1234/v1',
    fetchImpl: failingFetch,
  });

  await expect(runtime.control.getModelMax('model-a')).resolves.toBeUndefined();
  await expect(runtime.control.listLoaded()).resolves.toEqual([]);
  await expect(runtime.control.isInstalled('model-a')).resolves.toBe(false);
  await expect(runtime.isAvailable()).resolves.toBe(false);
});

test('a non-ok /models response degrades to undefined/[] instead of throwing', async () => {
  const runtime = createMlxServerRuntime({
    baseUrl: 'http://fake:1234/v1',
    fetchImpl: fakeFetch({}, 500),
  });

  await expect(runtime.control.getModelMax('model-a')).resolves.toBeUndefined();
  await expect(runtime.control.listLoaded()).resolves.toEqual([]);
});
