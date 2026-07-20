import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
const job = {
  id: 'job-42',
  kind: 'crew',
  payload: {},
  priority: 'normal',
  status: 'running',
  attempts: 1,
  maxAttempts: 3,
  createdAt: 1,
  updatedAt: 1,
  availableAt: 0,
  retriedFrom: null,
};

describe('JobsTab', () => {
  it('lists jobs from GET /api/jobs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [job], total: 1 })),
    );
    renderAt('/ops?tab=jobs');
    await waitFor(() => expect(screen.getByText('job-42')).toBeInTheDocument());
    expect(screen.getByTestId('ops-jobs-table')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows an empty-state when there are no jobs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [], total: 0 })),
    );
    renderAt('/ops?tab=jobs');
    await waitFor(() =>
      expect(screen.getByText('No jobs yet')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('narrows the list via the status facet', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('status=done')) {
        return jsonResponse({ items: [], total: 0 });
      }
      return jsonResponse({ items: [job], total: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/ops?tab=jobs');
    await waitFor(() => expect(screen.getByText('job-42')).toBeInTheDocument());

    const statusSelect = screen.getByTestId('ops-jobs-status-filter');
    statusSelect.dispatchEvent(new Event('focus', { bubbles: true }));
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(statusSelect, { target: { value: 'done' } });

    await waitFor(() =>
      expect(screen.getByText('No jobs yet')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('appends a page on load more', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('cursor=abc')) {
        return jsonResponse({ items: [{ ...job, id: 'job-43' }], total: 2 });
      }
      return jsonResponse({ items: [job], total: 2, nextCursor: 'abc' });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/ops?tab=jobs');
    await waitFor(() => expect(screen.getByText('job-42')).toBeInTheDocument());

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => expect(screen.getByText('job-43')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
