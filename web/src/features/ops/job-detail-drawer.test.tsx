import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const detail = {
  id: 'job-7',
  kind: 'crew',
  payload: { input: 'go' },
  priority: 'normal',
  status: 'failed',
  attempts: 3,
  maxAttempts: 3,
  createdAt: 1,
  updatedAt: 2,
  finishedAt: 2,
  availableAt: 0,
  runId: 'run-xyz',
  error: 'boom',
  retriedFrom: 'job-1',
};

describe('JobDetailDrawer', () => {
  it('opens on row click, shows detail + a Runs deep-link + retriedFrom back-link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/api/jobs/job-7')
          ? jsonResponse(detail)
          : jsonResponse({
              items: [{ ...detail, retriedFrom: 'job-1' }],
              total: 1,
            }),
      ),
    );
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    expect(await screen.findByTestId('ops-job-drawer')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /run-xyz/ })).toHaveAttribute(
      'href',
      '/runs/run-xyz',
    );
    expect(screen.getByText(/retry of job-1/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('closes the drawer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/api/jobs/job-7')
          ? jsonResponse(detail)
          : jsonResponse({
              items: [{ ...detail, retriedFrom: 'job-1' }],
              total: 1,
            }),
      ),
    );
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    await screen.findByTestId('ops-job-drawer');
    fireEvent.click(screen.getByTestId('ops-job-drawer-close'));
    await waitFor(() =>
      expect(screen.queryByTestId('ops-job-drawer')).not.toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('shows only Retry for a failed job (no Cancel, no Resume)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/api/jobs/job-7')
          ? jsonResponse(detail) // status: 'failed'
          : jsonResponse({ items: [detail], total: 1 }),
      ),
    );
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    await screen.findByTestId('ops-job-drawer-actions');
    expect(screen.getByTestId('ops-job-action-retry')).toBeInTheDocument();
    expect(
      screen.queryByTestId('ops-job-action-cancel'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('ops-job-action-resume'),
    ).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows only Cancel for a running job', async () => {
    const running = { ...detail, status: 'running', error: undefined };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/api/jobs/job-7')
          ? jsonResponse(running)
          : jsonResponse({ items: [running], total: 1 }),
      ),
    );
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    await screen.findByTestId('ops-job-drawer-actions');
    expect(screen.getByTestId('ops-job-action-cancel')).toBeInTheDocument();
    expect(
      screen.queryByTestId('ops-job-action-retry'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('ops-job-action-resume'),
    ).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows both Resume and Retry for an interrupted job with a runId', async () => {
    const interrupted = { ...detail, status: 'interrupted', error: undefined };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/api/jobs/job-7')
          ? jsonResponse(interrupted)
          : jsonResponse({ items: [interrupted], total: 1 }),
      ),
    );
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    await screen.findByTestId('ops-job-drawer-actions');
    expect(screen.getByTestId('ops-job-action-resume')).toBeInTheDocument();
    expect(screen.getByTestId('ops-job-action-retry')).toBeInTheDocument();
    expect(
      screen.queryByTestId('ops-job-action-cancel'),
    ).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows no actions for a done job', async () => {
    const done = { ...detail, status: 'done', error: undefined };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/api/jobs/job-7')
          ? jsonResponse(done)
          : jsonResponse({ items: [done], total: 1 }),
      ),
    );
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    await screen.findByTestId('ops-job-drawer-actions');
    expect(
      screen.queryByTestId('ops-job-action-cancel'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('ops-job-action-resume'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('ops-job-action-retry'),
    ).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('cancel POSTs /api/jobs/:id/cancel, disables while pending, and refreshes the row', async () => {
    const running = { ...detail, status: 'running', error: undefined };
    const canceled = { ...running, status: 'canceled' };
    let canceledYet = false;
    // The cancel POST is held open (a manually-resolved deferred) so the
    // test can observe the button's disabled "pending" state BEFORE the
    // mutation settles — a fetch mock that resolves instantly races past
    // that transient state before any assertion can see it.
    let resolveCancel: (() => void) | undefined;
    const cancelHeld = new Promise<void>((res) => {
      resolveCancel = res;
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/jobs/job-7/cancel' && init?.method === 'POST') {
          await cancelHeld;
          canceledYet = true;
          return jsonResponse({ canceled: true });
        }
        if (url.includes('/api/jobs/job-7')) {
          return jsonResponse(canceledYet ? canceled : running);
        }
        return jsonResponse({
          items: [canceledYet ? canceled : running],
          total: 1,
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    const cancelBtn = await screen.findByTestId('ops-job-action-cancel');
    fireEvent.click(cancelBtn);
    // Still pending — the POST hasn't resolved yet — so the button is
    // disabled and the optimistic flip is already visible.
    await waitFor(() => expect(cancelBtn).toBeDisabled());
    await waitFor(() =>
      expect(
        within(screen.getByTestId('ops-job-row-job-7')).getByText('canceled'),
      ).toBeInTheDocument(),
    );
    resolveCancel?.();
    // The job is now 'canceled', so the Cancel button's gating (queued/
    // running only) no longer matches — it disappears rather than
    // re-enabling.
    await waitFor(() =>
      expect(
        screen.queryByTestId('ops-job-action-cancel'),
      ).not.toBeInTheDocument(),
    );
    // The table row (rendered alongside the drawer) reconciles too.
    expect(screen.getByTestId('ops-job-row-job-7')).toHaveTextContent(
      'canceled',
    );
    vi.unstubAllGlobals();
  });

  it('resume POSTs {resume: runId} and navigates to the same run', async () => {
    const interrupted = { ...detail, status: 'interrupted', error: undefined };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/jobs' && init?.method === 'POST') {
          return jsonResponse({ jobId: 'job-99', runId: 'run-xyz' }, 202);
        }
        if (url.includes('/api/jobs/job-7')) return jsonResponse(interrupted);
        return jsonResponse({ items: [interrupted], total: 1 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    const resumeBtn = await screen.findByTestId('ops-job-action-resume');
    fireEvent.click(resumeBtn);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => {
        const url = typeof u === 'string' ? u : u.toString();
        return url === '/api/jobs' && (i as RequestInit)?.method === 'POST';
      });
      expect(call).toBeDefined();
      const body = JSON.parse((call?.[1] as RequestInit).body as string);
      expect(body).toEqual({ kind: 'crew', resume: 'run-xyz' });
    });
    vi.unstubAllGlobals();
  });

  it('retry POSTs /api/jobs/:id/retry', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/jobs/job-7/retry' && init?.method === 'POST') {
          return jsonResponse({ jobId: 'job-100', runId: 'run-new' }, 202);
        }
        if (url.includes('/api/jobs/job-7')) return jsonResponse(detail);
        return jsonResponse({ items: [detail], total: 1 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    const retryBtn = await screen.findByTestId('ops-job-action-retry');
    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u, i]) => {
          const url = typeof u === 'string' ? u : u.toString();
          return (
            url === '/api/jobs/job-7/retry' &&
            (i as RequestInit)?.method === 'POST'
          );
        }),
      ).toBe(true),
    );
    vi.unstubAllGlobals();
  });

  it('surfaces an error toast and reverts the optimistic status on failure', async () => {
    const running = { ...detail, status: 'running', error: undefined };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/jobs/job-7/cancel' && init?.method === 'POST') {
          return new Response(JSON.stringify({ error: 'boom' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/api/jobs/job-7')) return jsonResponse(running);
        return jsonResponse({ items: [running], total: 1 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/ops?tab=jobs');
    fireEvent.click(await screen.findByTestId('ops-job-row-job-7'));
    const cancelBtn = await screen.findByTestId('ops-job-action-cancel');
    fireEvent.click(cancelBtn);
    // Reverted: still shows Cancel (i.e. still 'running'), not left stuck as
    // the optimistic 'canceled' with no way back.
    await waitFor(() =>
      expect(screen.getByTestId('ops-job-action-cancel')).not.toBeDisabled(),
    );
    expect(screen.getByTestId('toast')).toHaveTextContent(/failed|boom/i);
    vi.unstubAllGlobals();
  });
});
