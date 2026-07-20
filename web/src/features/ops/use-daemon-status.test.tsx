import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDaemonStatus } from './use-daemon-status.ts';
import { useQueueStats } from './use-queue-stats.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function DaemonProbe() {
  const { status } = useDaemonStatus();
  return <div data-testid="pid">{status ? String(status.pid) : 'loading'}</div>;
}

function QueueProbe() {
  const { stats } = useQueueStats();
  return (
    <div data-testid="total">{stats ? String(stats.total) : 'loading'}</div>
  );
}

describe('useDaemonStatus', () => {
  it('fetches daemon status on mount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          running: true,
          pid: 99,
          startedAt: 1,
          uptimeMs: 5,
          bind: {
            bind: '127.0.0.1',
            allowedHosts: [],
            port: 4130,
            sessionTtlMs: 1,
          },
        }),
      ),
    );
    render(<DaemonProbe />);
    await waitFor(() =>
      expect(screen.getByTestId('pid')).toHaveTextContent('99'),
    );
    vi.unstubAllGlobals();
  });
});

describe('useQueueStats', () => {
  it('fetches queue stats on mount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          counts: { queued: 2, running: 1 },
          total: 3,
          activeCount: 1,
          concurrency: 4,
        }),
      ),
    );
    render(<QueueProbe />);
    await waitFor(() =>
      expect(screen.getByTestId('total')).toHaveTextContent('3'),
    );
    vi.unstubAllGlobals();
  });
});
