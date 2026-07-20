import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useJobActions } from './use-job-actions.ts';

const interrupted = {
  id: 'job-9',
  kind: 'crew',
  runId: 'run-abc',
  status: 'interrupted',
};

function jsonResponse(body: unknown, status = 202): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function Probe() {
  const { cancel, resume, retry } = useJobActions(() => {});
  return (
    <>
      <button
        type="button"
        data-testid="go-resume"
        onClick={() => resume(interrupted as never)}
      >
        resume
      </button>
      <button
        type="button"
        data-testid="go-cancel"
        onClick={() => cancel({ ...interrupted, status: 'running' } as never)}
      >
        cancel
      </button>
      <button
        type="button"
        data-testid="go-retry"
        onClick={() => retry({ ...interrupted, status: 'failed' } as never)}
      >
        retry
      </button>
    </>
  );
}

describe('useJobActions.resume', () => {
  it('POSTs /api/jobs with {resume: runId} (continue, not restart)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ jobId: 'job-10', runId: 'run-abc' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<Probe />);
    screen.getByTestId('go-resume').click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe('/api/jobs');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ kind: 'crew', resume: 'run-abc' }); // continues the EXISTING run
    vi.unstubAllGlobals();
  });
});

describe('useJobActions.cancel', () => {
  it('POSTs /api/jobs/:id/cancel', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ canceled: true }, 200),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<Probe />);
    screen.getByTestId('go-cancel').click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe('/api/jobs/job-9/cancel');
    expect(init.method).toBe('POST');
    vi.unstubAllGlobals();
  });
});

describe('useJobActions.retry', () => {
  it('POSTs /api/jobs/:id/retry', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ jobId: 'job-11', runId: 'run-def' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<Probe />);
    screen.getByTestId('go-retry').click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe('/api/jobs/job-9/retry');
    expect(init.method).toBe('POST');
    vi.unstubAllGlobals();
  });
});
