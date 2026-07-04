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
      destDir: '/tmp/dest',
    });
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
  });

  it('short-circuits to Done with bytesTotal null when already downloaded', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: 'already_downloaded' }), {
        status: 200,
      })) as unknown as typeof fetch;

    const provider = createLmStudioProvider({ fetchImpl, pollMs: 0 });
    const progress: Array<{ phase: DownloadPhase; bytesTotal: number | null }> =
      [];
    await provider.download('lmstudio-community/x', {
      onProgress: (p) =>
        progress.push({ phase: p.phase, bytesTotal: p.bytesTotal }),
      signal: new AbortController().signal,
      destDir: '/tmp/dest',
    });
    const last = progress.at(-1);
    expect(last?.phase).toBe(DownloadPhase.Done);
    expect(last?.bytesTotal).toBeNull();
  });

  it('throws when the job status reports failed', async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith('/download')) {
        return new Response(
          JSON.stringify({ job_id: 'j1', status: 'downloading' }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ status: 'failed' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const provider = createLmStudioProvider({ fetchImpl, pollMs: 0 });
    await expect(
      provider.download('lmstudio-community/x', {
        onProgress: () => {},
        signal: new AbortController().signal,
        destDir: '/tmp/dest',
      }),
    ).rejects.toThrow('LM Studio download failed');
  });
});
