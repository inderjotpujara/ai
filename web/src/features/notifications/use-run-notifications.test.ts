import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRunNotifications } from './use-run-notifications.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function runItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    startMs: 0,
    durationMs: 90_000,
    outcome: 'answer',
    lifecycle: 'running',
    origin: 'manual',
    kind: 'crew',
    models: [],
    degraded: false,
    spanCount: 0,
    tokens: { input: 0, output: 0 },
    ...overrides,
  };
}

describe('useRunNotifications', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not poll (and does not notify) before one interval elapses', async () => {
    // Stubbed directly on globalThis (not by replacing `window` wholesale —
    // `window === globalThis` in this happy-dom pool per src/test/setup.ts,
    // so this is equivalent to `window.__AGENT_NOTIFY_*` without stripping
    // `window.document`, which @testing-library/dom's `waitFor` needs).
    vi.stubGlobal('__AGENT_NOTIFY_POLL_MS__', 10);
    vi.stubGlobal('__AGENT_NOTIFY_MIN_DURATION_MS__', 5);
    const fetchMock = vi.fn(async () => jsonResponse({ items: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const onNotify = vi.fn();
    renderHook(() => useRunNotifications(onNotify));
    // No synchronous fetch at mount — the first tick is scheduled, not immediate.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notifies once for a Running->Done transition observed across two ticks', async () => {
    vi.stubGlobal('__AGENT_NOTIFY_POLL_MS__', 5);
    vi.stubGlobal('__AGENT_NOTIFY_MIN_DURATION_MS__', 1);
    let tick = 0;
    const fetchMock = vi.fn(async () => {
      tick += 1;
      return jsonResponse({
        items: [runItem({ lifecycle: tick === 1 ? 'running' : 'done' })],
        total: 1,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onNotify = vi.fn();
    renderHook(() => useRunNotifications(onNotify));

    await waitFor(
      () => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2),
      {
        timeout: 2000,
      },
    );
    await waitFor(() => expect(onNotify).toHaveBeenCalledTimes(1));
    expect(onNotify).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', kind: 'crew' }),
    );
  });

  it('a failed poll tick is swallowed silently — never throws, never crashes the effect', async () => {
    vi.stubGlobal('__AGENT_NOTIFY_POLL_MS__', 5);
    vi.stubGlobal('__AGENT_NOTIFY_MIN_DURATION_MS__', 1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const onNotify = vi.fn();
    expect(() => renderHook(() => useRunNotifications(onNotify))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onNotify).not.toHaveBeenCalled();
  });
});
