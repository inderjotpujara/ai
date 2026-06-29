import { expect, test } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { mlxServerRuntime } from '../../src/runtime/mlx-server.ts';

test('mlx runtime has the right kind and builds a model', () => {
  expect(mlxServerRuntime.kind).toBe(ProviderKind.MlxServer);
  const model = mlxServerRuntime.createModel({
    provider: ProviderKind.MlxServer,
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
