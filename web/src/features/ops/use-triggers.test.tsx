import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTriggers } from './use-triggers.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function triggerFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'trg-1',
    name: 'nightly-build',
    type: 'cron',
    enabled: true,
    target: { kind: 'workflow', payload: {} },
    config: { schedule: '0 2 * * *' },
    origin: 'console',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function Probe() {
  const { triggers, error } = useTriggers();
  if (error) return <div data-testid="count">error:{error}</div>;
  return (
    <div data-testid="count">
      {triggers ? String(triggers.length) : 'loading'}
    </div>
  );
}

describe('useTriggers', () => {
  it('loads the list on mount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [triggerFixture()] })),
    );
    render(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1'),
    );
    vi.unstubAllGlobals();
  });

  it('setEnabled PATCHes the trigger and refetches the list', async () => {
    const requests: { method: string; url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        requests.push({
          method,
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (method === 'PATCH') {
          return jsonResponse(triggerFixture({ enabled: false }));
        }
        return jsonResponse({ items: [triggerFixture()] });
      }),
    );

    let hook: ReturnType<typeof useTriggers> | undefined;
    function Capture() {
      hook = useTriggers();
      return (
        <div data-testid="count">
          {hook.triggers ? String(hook.triggers.length) : 'loading'}
        </div>
      );
    }
    render(<Capture />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1'),
    );

    await hook?.setEnabled('trg-1', false);

    await waitFor(() =>
      expect(requests.some((r) => r.method === 'PATCH')).toBe(true),
    );
    const patchReq = requests.find((r) => r.method === 'PATCH');
    expect(patchReq?.url).toContain('/api/triggers/trg-1');
    expect(patchReq?.body).toEqual({ enabled: false });
    // Two GETs total: the mount fetch + the post-mutation refresh().
    await waitFor(() =>
      expect(requests.filter((r) => r.method === 'GET').length).toBe(2),
    );

    vi.unstubAllGlobals();
  });

  it('fire POSTs to /triggers/:id/fire and refetches', async () => {
    const requests: { method: string; url: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        requests.push({ method, url });
        if (url.endsWith('/fire')) {
          return jsonResponse({ jobId: 'job-1', runId: 'run-1' }, 202);
        }
        return jsonResponse({ items: [triggerFixture()] });
      }),
    );

    let hook: ReturnType<typeof useTriggers> | undefined;
    function Capture() {
      hook = useTriggers();
      return (
        <div data-testid="count">
          {hook.triggers ? String(hook.triggers.length) : 'loading'}
        </div>
      );
    }
    render(<Capture />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1'),
    );

    const result = await hook?.fire('trg-1');
    expect(result).toEqual({ jobId: 'job-1', runId: 'run-1' });
    expect(
      requests.some((r) => r.method === 'POST' && r.url.endsWith('/fire')),
    ).toBe(true);
    await waitFor(() =>
      expect(requests.filter((r) => r.method === 'GET').length).toBe(2),
    );

    vi.unstubAllGlobals();
  });

  it('surfaces a fetch failure as `error`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    render(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('error:'),
    );
    vi.unstubAllGlobals();
  });
});
