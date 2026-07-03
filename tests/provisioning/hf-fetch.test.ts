import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { ProviderKind } from '../../src/core/types.ts';
import { createHfFetchProvider } from '../../src/provisioning/providers/hf-fetch.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

/**
 * Deterministically simulates a write-side failure (EACCES/ENOSPC-class)
 * without touching the filesystem or chmod'ing anything: the very first
 * `_write` call emits 'error' on itself instead of invoking the write
 * callback, exactly like a real fd failure would.
 */
class ErroringWriteStream extends Writable {
  override _write(
    _chunk: Uint8Array,
    _encoding: BufferEncoding,
    _callback: (error?: Error | null) => void,
  ): void {
    this.emit('error', new Error('ENOSPC: simulated disk-full write failure'));
  }
}

function streamingResponse(chunks: Uint8Array[], total: number): Response {
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-length': String(total) },
  });
}

describe('createHfFetchProvider', () => {
  it('emits Downloading progress that reaches Done', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfSnapshot, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      sha256: async () => 'deadbeef',
      treeFiles: async () => [{ path: 'model.bin', size: 2000 }],
    });
    const phases: DownloadPhase[] = [];
    await provider.download('mlx-community/x', {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
      destDir: dest,
    });
    expect(phases).toContain(DownloadPhase.Downloading);
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });

  it('HfSnapshot: enumerates the repo tree and writes every file', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const provider = createHfFetchProvider(ProviderKind.HfSnapshot, {
      treeFiles: async () => [
        { path: 'config.json', size: 3 },
        { path: 'model.safetensors', size: 5 },
      ],
      fetchImpl: (async (u: string) =>
        streamingResponse(
          [new Uint8Array(u.endsWith('config.json') ? 3 : 5)],
          u.endsWith('config.json') ? 3 : 5,
        )) as unknown as typeof fetch,
    });
    const phases: DownloadPhase[] = [];
    await provider.download('mlx-community/x', {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
      destDir: dest,
    });
    const configPath = join(dest, 'mlx-community/x/config.json');
    const weightsPath = join(dest, 'mlx-community/x/model.safetensors');
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(weightsPath)).toBe(true);
    expect(readFileSync(configPath).byteLength).toBe(3);
    expect(readFileSync(weightsPath).byteLength).toBe(5);
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
    // Exactly one Done for the whole snapshot, not one per file.
    expect(phases.filter((p) => p === DownloadPhase.Done)).toHaveLength(1);
  });

  it('HfSnapshot: a rejecting tree fetch degrades to a ProviderError, not a crash', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const provider = createHfFetchProvider(ProviderKind.HfSnapshot, {
      treeFiles: async () => {
        throw new Error('boom');
      },
    });
    await expect(
      provider.download('mlx-community/x', {
        onProgress: () => {},
        signal: new AbortController().signal,
        destDir: dest,
      }),
    ).rejects.toThrow(/HF tree listing failed/);
  });

  it('HfGguf: a rejecting tree fetch degrades to compute-and-record (no gate)', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfGguf, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      treeFiles: async () => {
        throw new Error('tree service unavailable');
      },
    });
    const phases: DownloadPhase[] = [];
    await provider.download('org/repo::model.gguf', {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
      destDir: dest,
    });
    expect(existsSync(join(dest, 'model.gguf'))).toBe(true);
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });

  it('HfSnapshot: rejects on sha256 mismatch and leaves no final file or .part behind', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const provider = createHfFetchProvider(ProviderKind.HfSnapshot, {
      fetchImpl: (async () =>
        streamingResponse(
          [new Uint8Array(3)],
          3,
        )) as unknown as typeof fetch,
      sha256: async () => 'actual-hash',
      treeFiles: async () => [
        { path: 'config.json', size: 3, oid: 'expected-hash' },
      ],
    });
    await expect(
      provider.download('mlx-community/x', {
        onProgress: () => {},
        signal: new AbortController().signal,
        destDir: dest,
      }),
    ).rejects.toThrow(/sha256 mismatch/);
    const configPath = join(dest, 'mlx-community/x/config.json');
    expect(existsSync(configPath)).toBe(false);
    expect(existsSync(`${configPath}.part`)).toBe(false);
  });

  it('HfGguf: writes the file to destDir atomically and reaches Done', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfGguf, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      treeFiles: async () => [],
    });
    const phases: DownloadPhase[] = [];
    await provider.download('org/repo::model.gguf', {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
      destDir: dest,
    });
    const out = join(dest, 'model.gguf');
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).byteLength).toBe(2000);
    expect(existsSync(`${out}.part`)).toBe(false);
    expect(phases).toContain(DownloadPhase.Finalizing);
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });

  it('rejects a modelRef with a traversal file component and writes nothing outside destDir', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const parent = dirname(dest);
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfGguf, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      treeFiles: async () => [],
    });
    await expect(
      provider.download('org/repo::../../evil.gguf', {
        onProgress: () => {},
        signal: new AbortController().signal,
        destDir: dest,
      }),
    ).rejects.toThrow();
    expect(existsSync(join(parent, 'evil.gguf'))).toBe(false);
    expect(existsSync(join(dirname(parent), 'evil.gguf'))).toBe(false);
  });

  it('HfSnapshot: rejects a tree entry with a traversal path and writes nothing outside destDir', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const parent = dirname(dest);
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfSnapshot, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      treeFiles: async () => [{ path: '../evil.bin', size: 2000 }],
    });
    await expect(
      provider.download('mlx-community/x', {
        onProgress: () => {},
        signal: new AbortController().signal,
        destDir: dest,
      }),
    ).rejects.toThrow();
    expect(existsSync(join(parent, 'evil.bin'))).toBe(false);
    expect(existsSync(join(dirname(parent), 'evil.bin'))).toBe(false);
  });

  it('rejects (not crashes) when the write stream errors, and leaves no .part file', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfGguf, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      openWriteStream: () => new ErroringWriteStream(),
      treeFiles: async () => [],
    });
    await expect(
      provider.download('org/repo::model.gguf', {
        onProgress: () => {},
        signal: new AbortController().signal,
        destDir: dest,
      }),
    ).rejects.toThrow(/simulated disk-full/);
    expect(existsSync(join(dest, 'model.gguf.part'))).toBe(false);
    expect(existsSync(join(dest, 'model.gguf'))).toBe(false);
  });

  it('rejects a modelRef with an absolute-path file component', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfGguf, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      treeFiles: async () => [],
    });
    await expect(
      provider.download('org/repo::/etc/evil', {
        onProgress: () => {},
        signal: new AbortController().signal,
        destDir: dest,
      }),
    ).rejects.toThrow();
    expect(existsSync('/etc/evil')).toBe(false);
  });

  it('HfGguf: threads the tree oid as expectedOid and rejects on sha256 mismatch', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfGguf, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      sha256: async () => 'actual-hash',
      treeFiles: async (repo) => {
        expect(repo).toBe('org/repo');
        return [{ path: 'model.gguf', size: 2000, oid: 'expected-hash' }];
      },
    });
    await expect(
      provider.download('org/repo::model.gguf', {
        onProgress: () => {},
        signal: new AbortController().signal,
        destDir: dest,
      }),
    ).rejects.toThrow(/sha256 mismatch/);
    expect(existsSync(join(dest, 'model.gguf'))).toBe(false);
    expect(existsSync(join(dest, 'model.gguf.part'))).toBe(false);
  });

  it('HfGguf: succeeds when the tree oid matches the downloaded sha256', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfGguf, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      sha256: async () => 'matching-hash',
      treeFiles: async () => [
        { path: 'model.gguf', size: 2000, oid: 'matching-hash' },
      ],
    });
    const phases: DownloadPhase[] = [];
    await provider.download('org/repo::model.gguf', {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
      destDir: dest,
    });
    expect(existsSync(join(dest, 'model.gguf'))).toBe(true);
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });
});
