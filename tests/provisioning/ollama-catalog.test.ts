import { describe, expect, it } from 'bun:test';
import { ollamaManifestSize } from '../../src/provisioning/catalog/ollama-catalog.ts';

describe('ollamaManifestSize', () => {
  it('sums layer sizes plus config size from the registry manifest', async () => {
    const fakeFetch = async () => new Response(JSON.stringify({
      config: { size: 561 },
      layers: [{ size: 2_000_000_000 }, { size: 8_000 }, { size: 4_000 }],
    }), { status: 200 });
    const bytes = await ollamaManifestSize('llama3.2', 'latest', fakeFetch as unknown as typeof fetch);
    expect(bytes).toBe(2_000_000_000 + 8_000 + 4_000 + 561);
  });
  it('throws on a non-200 manifest response', async () => {
    const fakeFetch = async () => new Response('nope', { status: 404 });
    await expect(ollamaManifestSize('x', 'latest', fakeFetch as unknown as typeof fetch)).rejects.toThrow();
  });
});
