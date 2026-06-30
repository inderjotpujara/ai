import { describe, expect, test } from 'bun:test';
import { mlxServerRuntime } from '../../src/runtime/mlx-server.ts';

const ready = await mlxServerRuntime.isAvailable();

describe.skipIf(!ready)('live MLX server', () => {
  test('lists at least one loaded model', async () => {
    const loaded = await mlxServerRuntime.control.listLoaded();
    expect(Array.isArray(loaded)).toBe(true);
  }, 30_000);
});
