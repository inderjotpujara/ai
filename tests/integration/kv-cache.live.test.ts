import { describe, expect, test } from 'bun:test';
import qwenFast from '../../models/qwen-fast.ts';
import { f16KvBytesPerToken } from '../../src/resource/kv-cache.ts';
import { getModelKvArch } from '../../src/resource/ollama-control.ts';
import { ollamaReady } from './ollama-available.ts';

const ready = await ollamaReady(qwenFast.model);
describe.skipIf(!ready)('live KV arch probe', () => {
  test('reads real KV arch and computes a positive f16 baseline', async () => {
    const arch = await getModelKvArch(qwenFast.model);
    expect(arch).toBeDefined();
    if (arch) expect(f16KvBytesPerToken(arch)).toBeGreaterThan(0);
  }, 30_000);
});
