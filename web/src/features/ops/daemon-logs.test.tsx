import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';
import { DaemonLogs } from './daemon-logs.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const daemonStatus = {
  running: true,
  pid: 7,
  startedAt: 1,
  uptimeMs: 5,
  bind: { bind: '127.0.0.1', allowedHosts: [], port: 4130, sessionTtlMs: 1 },
};

const queueStats = {
  counts: {},
  total: 0,
  activeCount: 0,
  concurrency: 4,
};

/** Mocks every endpoint `OverviewTab` fetches on mount, so `daemon/logs` can
 *  be exercised through the real Overview mount point (per the brief's Step
 *  1) without the other cards' fetches rejecting as "unexpected fetch". */
function mockOverviewFetch(logLines: string[]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/daemon/logs')) {
      return jsonResponse({ lines: logLines });
    }
    if (url.includes('/api/daemon/status')) return jsonResponse(daemonStatus);
    if (url.includes('/api/queue/stats')) return jsonResponse(queueStats);
    if (url.includes('/api/jobs')) return jsonResponse({ items: [], total: 0 });
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe('DaemonLogs (mounted inside Overview)', () => {
  it('renders the fetched log lines and has no remote stop/start control', async () => {
    vi.stubGlobal('fetch', mockOverviewFetch(['run-1 ok', 'run-2 ok']));
    renderAt('/ops');

    const viewer = await screen.findByTestId('ops-daemon-logs');
    await waitFor(() => expect(viewer).toHaveTextContent('run-1 ok'));
    expect(viewer).toHaveTextContent('run-2 ok');

    expect(screen.queryByRole('button', { name: /stop daemon/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /start daemon/i })).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe('DaemonLogs (standalone)', () => {
  it('fetches the "out" stream by default and switching to "err" re-queries with stream=err', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      expect(url).toContain('/api/daemon/logs');
      if (url.includes('stream=err')) {
        return jsonResponse({ lines: ['err-line'] });
      }
      return jsonResponse({ lines: ['out-line'] });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DaemonLogs />);

    await waitFor(() =>
      expect(screen.getByTestId('ops-daemon-logs')).toHaveTextContent(
        'out-line',
      ),
    );
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('stream=out');

    screen.getByTestId('ops-daemon-logs-stream-err').click();

    await waitFor(() =>
      expect(screen.getByTestId('ops-daemon-logs')).toHaveTextContent(
        'err-line',
      ),
    );
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('stream=err');

    vi.unstubAllGlobals();
  });

  it('shows copy-the-CLI-command guidance for daemon lifecycle, and no remote start/stop control', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ lines: [] })),
    );

    render(<DaemonLogs />);

    await waitFor(() =>
      expect(screen.getByText('agent daemon stop')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /stop daemon/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /start daemon/i })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /restart daemon/i }),
    ).toBeNull();

    vi.unstubAllGlobals();
  });
});
