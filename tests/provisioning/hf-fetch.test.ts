import { describe, expect, it } from 'bun:test';
import { createHfFetchProvider } from '../../src/provisioning/providers/hf-fetch.ts';
import { ProviderKind } from '../../src/core/types.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

function streamingResponse(chunks: Uint8Array[], total: number): Response {
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-length': String(total) } });
}

describe('createHfFetchProvider', () => {
  it('emits Downloading progress that reaches Done', async () => {
    const chunk = new Uint8Array(1000);
    const provider = createHfFetchProvider(ProviderKind.MlxServer, {
      fetchImpl: (async () => streamingResponse([chunk, chunk], 2000)) as unknown as typeof fetch,
      sha256: async () => 'deadbeef',
    });
    const phases: DownloadPhase[] = [];
    await provider.download('mlx-community/x', {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
    });
    expect(phases).toContain(DownloadPhase.Downloading);
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });
});
