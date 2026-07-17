import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

// Task T55: `SessionsSidebar` now mounts alongside `SessionsArea` in every
// `renderAt(...)` render (AppShell). It fetches `/api/sessions?limit=10` on
// its own and renders the same "No sessions yet" / row-title text this page
// uses, so a plain `screen.getByText(...)` can match twice. Tests below (a)
// scope `/api/sessions?limit=10` to an empty page so the sidebar doesn't
// echo unrelated fixture data, and (b) scope text queries to the
// `area-sessions` region so the sidebar's own (also legitimately empty)
// state can't collide with this page's assertions.
describe('SessionsArea', () => {
  it('lists sessions fetched from /api/sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('limit=10')
          ? jsonResponse({ items: [], total: 0 })
          : jsonResponse(page),
      ),
    );
    renderAt('/sessions');
    const area = await screen.findByTestId('area-sessions');
    await waitFor(() =>
      expect(
        within(area).getByText('Debugging the parser'),
      ).toBeInTheDocument(),
    );
    expect(area).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows "No sessions yet" when the page has no items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [], total: 0 })),
    );
    renderAt('/sessions');
    const area = await screen.findByTestId('area-sessions');
    await waitFor(() =>
      expect(within(area).getByText('No sessions yet')).toBeInTheDocument(),
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('limit=10')
        ? jsonResponse({ items: [], total: 0 })
        : jsonResponse(page),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/sessions');
    const area = await screen.findByTestId('area-sessions');
    await waitFor(() =>
      expect(
        within(area).getByText('Debugging the parser'),
      ).toBeInTheDocument(),
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
      if (url.includes('limit=10'))
        return jsonResponse({ items: [], total: 0 });
      if (url.includes('cursor=')) return jsonResponse({ items: [], total: 1 });
      return jsonResponse({ ...page, nextCursor: 'abc' });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/sessions');
    const area = await screen.findByTestId('area-sessions');
    await waitFor(() =>
      expect(
        within(area).getByText('Debugging the parser'),
      ).toBeInTheDocument(),
    );

    const nextButton = await within(area).findByRole('button', {
      name: /next/i,
    });
    fireEvent.click(nextButton);

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(String(lastCall?.[0])).toContain('cursor=abc');
    });
    vi.unstubAllGlobals();
  });
});
