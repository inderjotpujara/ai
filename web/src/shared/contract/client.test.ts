import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  type ApiError,
  apiFetch,
  notifyConfig,
  sessionToken,
} from './client.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  // biome-ignore lint/suspicious/noExplicitAny: test cleanup of injected global
  delete (globalThis as any).window;
});

function stubToken(token: string) {
  vi.stubGlobal('window', { __AGENT_TOKEN__: token });
}

describe('contract client', () => {
  it('reads the session token from window, empty string when absent', () => {
    vi.stubGlobal('window', {});
    expect(sessionToken()).toBe('');
    stubToken('abc123');
    expect(sessionToken()).toBe('abc123');
  });

  it('sends the bearer token and zod-parses the response', async () => {
    stubToken('secret');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch('/health', {
      schema: z.object({ ok: z.boolean() }),
    });
    expect(result).toEqual({ ok: true });

    // biome-ignore lint/style/noNonNullAssertion: mock.calls[0] is guaranteed present — we just awaited the one call that populates it
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/health');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret',
    );
  });

  it('throws ApiError with the status on non-2xx', async () => {
    stubToken('secret');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 401 })),
    );
    await expect(
      apiFetch('/health', { schema: z.object({ ok: z.boolean() }) }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    } satisfies Partial<ApiError>);
  });

  it('reads the notify config from window, defaults when absent', () => {
    vi.stubGlobal('window', {});
    expect(notifyConfig()).toEqual({ pollMs: 5_000, minDurationMs: 60_000 });
    vi.stubGlobal('window', {
      __AGENT_NOTIFY_POLL_MS__: 1234,
      __AGENT_NOTIFY_MIN_DURATION_MS__: 99_999,
    });
    expect(notifyConfig()).toEqual({ pollMs: 1234, minDurationMs: 99_999 });
  });
});
