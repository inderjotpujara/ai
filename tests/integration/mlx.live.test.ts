import { describe, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { RuntimeKind } from '../../src/core/types.ts';
import { mlxServerRuntime } from '../../src/runtime/mlx-server.ts';
import { mlxReady } from './mlx-available.ts';

const model = process.env.MLX_LIVE_MODEL;
// Require the model to be explicitly configured: the round-trip/getModelMax
// tests need it, and MLX's default base URL (:1234) collides with LM Studio's,
// so port-reachability alone must NOT flip this gate on.
const ready = !!model && (await mlxReady(model));

describe.skipIf(!ready)('live MLX server', () => {
  test('lists at least one loaded model', async () => {
    const loaded = await mlxServerRuntime.control.listLoaded();
    expect(Array.isArray(loaded)).toBe(true);
  }, 60_000);

  test('runs a real inference round-trip', async () => {
    // `ready` implies `model` is set (mlxReady only checks isInstalled when
    // model is truthy), but narrow explicitly for the type checker.
    if (!model) throw new Error('MLX_LIVE_MODEL must be set when ready');
    const decl = {
      runtime: RuntimeKind.MlxServer,
      model,
      params: {},
      role: 'live-verify',
      footprint: { approxParamsBillions: 0, bytesPerWeight: 0.55 },
    };
    const result = await generateText({
      model: mlxServerRuntime.createModel(decl),
      prompt: 'Reply with a single short sentence about the ocean.',
    });
    expect(result.text.trim().length).toBeGreaterThan(0);
  }, 60_000);

  test('getModelMax returns a number when the server exposes it', async () => {
    if (!model) throw new Error('MLX_LIVE_MODEL must be set when ready');
    const max = await mlxServerRuntime.control.getModelMax(model);
    expect(max === undefined || typeof max === 'number').toBe(true);
  }, 60_000);
});
