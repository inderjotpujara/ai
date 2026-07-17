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
      id: 'sess-1',
      title: 'Debugging the parser',
      owner: 'local',
      createdAt: 1000,
      updatedAt: 2000,
      lastMessageAt: 2000,
    },
  ],
  total: 1,
};

describe('SessionsArea', () => {
  it('lists sessions fetched from /api/sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(page)),
    );
    renderAt('/sessions');
    await waitFor(() =>
      expect(screen.getByText('Debugging the parser')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('area-sessions')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows "No sessions yet" when the page has no items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [], total: 0 })),
    );
    renderAt('/sessions');
    await waitFor(() =>
      expect(screen.getByText('No sessions yet')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('shows an in-region error message when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    renderAt('/sessions');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });

  it('re-fetches with a search query string when the search box changes', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse(page),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/sessions');
    await waitFor(() =>
      expect(screen.getByText('Debugging the parser')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByTestId('sessions-search'), {
      target: { value: 'parser' },
    });

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(String(lastCall?.[0])).toContain('search=parser');
    });
    vi.unstubAllGlobals();
  });

  it('requests the next page via cursor when Next is clicked', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cursor=')) return jsonResponse({ items: [], total: 1 });
      return jsonResponse({ ...page, nextCursor: 'abc' });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/sessions');
    await waitFor(() =>
      expect(screen.getByText('Debugging the parser')).toBeInTheDocument(),
    );

    const nextButton = await screen.findByRole('button', { name: /next/i });
    fireEvent.click(nextButton);

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(String(lastCall?.[0])).toContain('cursor=abc');
    });
    vi.unstubAllGlobals();
  });
});
