import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
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
});
