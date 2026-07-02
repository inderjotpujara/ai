import { describe, expect, it } from 'bun:test';
import { createLmStudioProvider } from '../../src/provisioning/providers/lmstudio.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

describe('createLmStudioProvider', () => {
  it('starts a download job then polls to completion, emitting Done', async () => {
    let poll = 0;
    const fetchImpl = (async (url: string, _init?: RequestInit) => {
      if (String(url).endsWith('/download')) {
        return new Response(
          JSON.stringify({
            job_id: 'j1',
            status: 'downloading',
            total_size_bytes: 1000,
          }),
          { status: 200 },
        );
      }
      poll++;
      const body =
        poll < 2
          ? {
              status: 'downloading',
              downloaded_bytes: 500,
              total_size_bytes: 1000,
            }
          : {
              status: 'completed',
              downloaded_bytes: 1000,
              total_size_bytes: 1000,
            };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createLmStudioProvider({ fetchImpl, pollMs: 0 });
    const phases: DownloadPhase[] = [];
    await provider.download('lmstudio-community/x', {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
    });
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });
});
