import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

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
  uptimeMs: 90_061_000, // 1d 1h 1m 1s
  bind: {
    bind: '127.0.0.1',
    allowedHosts: [],
    port: 4130,
    sessionTtlMs: 1,
  },
};

const stoppedDaemonStatus = {
  running: false,
  bind: {
    bind: '127.0.0.1',
    allowedHosts: [],
    port: 4130,
    sessionTtlMs: 1,
  },
};

// Deliberately a PARTIAL map — `done`/`canceled` are absent so the
// `counts[status] ?? 0` render path is exercised, not just the populated ones.
const queueStats = {
  counts: { queued: 2, running: 1, failed: 1 },
  total: 4,
  activeCount: 2,
  concurrency: 4,
};

const failedJob = {
  id: 'job-fail-1',
  kind: 'crew',
  payload: {},
  priority: 'normal',
  status: 'failed',
  attempts: 3,
  maxAttempts: 3,
  createdAt: 1,
  updatedAt: 2,
  availableAt: 0,
  retriedFrom: null,
};

function mockFetch(overrides?: {
  daemon?: unknown;
  queue?: unknown;
  jobs?: unknown;
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/daemon/status')) {
      return jsonResponse(overrides?.daemon ?? daemonStatus);
    }
    if (url.includes('/api/queue/stats')) {
      return jsonResponse(overrides?.queue ?? queueStats);
    }
    if (url.includes('/api/jobs')) {
      return jsonResponse(overrides?.jobs ?? { items: [failedJob], total: 1 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe('OverviewTab', () => {
  it('renders daemon/queue/recent-failures cards on the default Overview panel', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderAt('/ops');

    expect(await screen.findByTestId('ops-overview')).toBeInTheDocument();

    // Daemon card: running + pid + humanized uptime.
    await waitFor(() =>
      expect(screen.getByTestId('ops-daemon-state')).toHaveTextContent(
        'running',
      ),
    );
    expect(screen.getByText('7')).toBeInTheDocument();

    // Queue card: activeCount and running-rows count rendered as DISTINCT
    // labels/numbers — never summed or reconciled.
    expect(screen.getByText('active workers')).toBeInTheDocument();
    expect(screen.getByText('running rows')).toBeInTheDocument();
    expect(screen.getByTestId('ops-queue-active')).toHaveTextContent('2');
    expect(screen.getByTestId('ops-queue-running-rows')).toHaveTextContent('1');

    // Partial-map discipline: `done` and `canceled` are absent from
    // `queueStats.counts` above — they must render as 0, not blank/undefined.
    expect(screen.getByTestId('ops-queue-count-done')).toHaveTextContent('0');
    expect(screen.getByTestId('ops-queue-count-canceled')).toHaveTextContent(
      '0',
    );

    // Recent failures: the one failed job appears with a Retry button.
    await waitFor(() =>
      expect(screen.getByTestId('ops-failure-job-fail-1')).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('ops-failure-action-job-fail-1'),
    ).toHaveTextContent('Retry');

    vi.unstubAllGlobals();
  });

  it('shows a stopped daemon state with no pid/uptime', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ daemon: stoppedDaemonStatus, jobs: { items: [], total: 0 } }),
    );
    renderAt('/ops');

    await waitFor(() =>
      expect(screen.getByTestId('ops-daemon-state')).toHaveTextContent(
        'stopped',
      ),
    );

    vi.unstubAllGlobals();
  });

  it('renders every JobStatusWire status as 0 when absent from a partial counts map', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        queue: { counts: {}, total: 0, activeCount: 0, concurrency: 4 },
        jobs: { items: [], total: 0 },
      }),
    );
    renderAt('/ops');

    await waitFor(() =>
      expect(screen.getByTestId('ops-queue-count-queued')).toHaveTextContent(
        '0',
      ),
    );
    expect(screen.getByTestId('ops-queue-count-running')).toHaveTextContent(
      '0',
    );
    expect(screen.getByTestId('ops-queue-count-done')).toHaveTextContent('0');
    expect(screen.getByTestId('ops-queue-count-failed')).toHaveTextContent('0');
    expect(screen.getByTestId('ops-queue-count-interrupted')).toHaveTextContent(
      '0',
    );
    expect(screen.getByTestId('ops-queue-count-canceled')).toHaveTextContent(
      '0',
    );
    // activeCount vs running-rows stay distinct numbers even both-zero.
    expect(screen.getByTestId('ops-queue-active')).toHaveTextContent('0');
    expect(screen.getByTestId('ops-queue-running-rows')).toHaveTextContent('0');

    vi.unstubAllGlobals();
  });
});
