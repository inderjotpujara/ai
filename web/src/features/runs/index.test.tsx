import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const page = {
  items: [
    {
      id: 'run-1',
      startMs: 1000,
      durationMs: 42,
      outcome: 'answer',
      lifecycle: 'done',
      origin: 'manual',
      models: ['qwen'],
      degraded: false,
      spanCount: 3,
    },
  ],
  total: 1,
};

describe('RunsArea', () => {
  it('lists runs fetched from /api/runs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(page)),
    );
    renderAt('/runs');
    await waitFor(() => expect(screen.getByText('run-1')).toBeInTheDocument());
    expect(screen.getByTestId('area-runs')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows "No runs yet" when the page has no items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [], total: 0 })),
    );
    renderAt('/runs');
    await waitFor(() =>
      expect(screen.getByText('No runs yet')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('shows an in-region error message when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('nope', { status: 500, statusText: 'Internal Error' }),
      ),
    );
    renderAt('/runs');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });

  it('re-fetches with a search query string when the search box changes', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse(page),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/runs');
    await waitFor(() => expect(screen.getByText('run-1')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('runs-search'), {
      target: { value: 'hello' },
    });

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(String(lastCall?.[0])).toContain('search=hello');
    });
    vi.unstubAllGlobals();
  });

  it('requests the next page via cursor when Next is clicked', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cursor=')) {
        return jsonResponse({ items: [], total: 1 });
      }
      return jsonResponse({ ...page, nextCursor: 'abc' });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/runs');
    await waitFor(() => expect(screen.getByText('run-1')).toBeInTheDocument());

    const nextButton = await screen.findByRole('button', { name: /next/i });
    fireEvent.click(nextButton);

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(String(lastCall?.[0])).toContain('cursor=abc');
    });
    vi.unstubAllGlobals();
  });
});
