import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ProviderKind } from '../../src/core/types.ts';
import { createHfFetchProvider } from '../../src/provisioning/providers/hf-fetch.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

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
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfSnapshot, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      sha256: async () => 'deadbeef',
    });
    const phases: DownloadPhase[] = [];
    await provider.download('mlx-community/x', {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
      destDir: '/tmp/dest',
    });
    expect(phases).toContain(DownloadPhase.Downloading);
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });

  it('HfGguf: writes the file to destDir atomically and reaches Done', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfGguf, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
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

  it('rejects a modelRef with an absolute-path file component', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'hf-'));
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.HfGguf, {
      fetchImpl: (async () =>
        streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
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
});
