import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useJobs } from './use-jobs.ts';

function Probe() {
  const { page } = useJobs();
  return <div data-testid="count">{page ? page.items.length : 'loading'}</div>;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('useJobs', () => {
  it('fetches the first page of jobs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [
            {
              id: 'job-1',
              kind: 'crew',
              payload: {},
              priority: 'normal',
              status: 'queued',
              attempts: 0,
              maxAttempts: 3,
              createdAt: 1,
              updatedAt: 1,
              availableAt: 0,
              retriedFrom: null,
            },
          ],
          total: 1,
        }),
      ),
    );
    render(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1'),
    );
    vi.unstubAllGlobals();
  });
});
