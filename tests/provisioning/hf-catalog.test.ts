import { describe, expect, it } from 'bun:test';
import {
  hfTreeFiles,
  hfTreeSize,
} from '../../src/provisioning/catalog/hf-catalog.ts';

describe('hfTreeFiles', () => {
  it('surfaces lfs.oid for LFS-backed entries and undefined for others', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify([
          { path: 'model-Q4_K_M.gguf', lfs: { size: 5, oid: 'abc123' } },
          { path: 'README.md', size: 1_000 },
        ]),
        { status: 200 },
      );
    const files = await hfTreeFiles(
      'bartowski/x-GGUF',
      fakeFetch as unknown as typeof fetch,
    );
    expect(files).toEqual([
      { path: 'model-Q4_K_M.gguf', size: 5, oid: 'abc123' },
      { path: 'README.md', size: 1_000, oid: undefined },
    ]);
  });
});

describe('hfTreeSize', () => {
  it('returns the size of a single matching GGUF file', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify([
          { path: 'model-Q4_K_M.gguf', size: 4_100_000_000 },
          { path: 'README.md', size: 1_000 },
        ]),
        { status: 200 },
      );
    const bytes = await hfTreeSize(
      'bartowski/x-GGUF',
      { file: 'model-Q4_K_M.gguf' },
      fakeFetch as unknown as typeof fetch,
    );
    expect(bytes).toBe(4_100_000_000);
  });
  it('sums the whole tree for an MLX snapshot (no file filter)', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify([
          { path: 'a.safetensors', size: 2_000_000_000 },
          { path: 'b.safetensors', size: 1_000_000_000 },
          { path: 'config.json', size: 500 },
        ]),
        { status: 200 },
      );
    const bytes = await hfTreeSize(
      'mlx-community/x',
      {},
      fakeFetch as unknown as typeof fetch,
    );
    expect(bytes).toBe(3_000_000_500);
  });
});
