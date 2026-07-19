import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SessionsSidebar', () => {
  it('shows "No sessions yet" before any session exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [], total: 0 })),
    );
    renderAt('/');
    await waitFor(() =>
      expect(screen.getByText('No sessions yet')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('lists recent sessions from GET /api/sessions?limit=10', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('limit=10');
      return jsonResponse({
        items: [
          {
            id: 'sess-1',
            title: 'Debugging the parser',
            owner: 'local',
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        total: 1,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/');
    await waitFor(() =>
      expect(screen.getByText('Debugging the parser')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('links each row to /sessions/$sessionId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [
            {
              id: 'sess-2',
              title: 'Another chat',
              owner: 'local',
              createdAt: 0,
              updatedAt: 0,
            },
          ],
          total: 1,
        }),
      ),
    );
    renderAt('/');
    const link = await screen.findByRole('link', { name: 'Another chat' });
    expect(link).toHaveAttribute('href', '/sessions/sess-2');
    vi.unstubAllGlobals();
  });

  it('labels the sidebar landmark for assistive tech (D1)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [], total: 0 })),
    );
    renderAt('/');
    expect(
      await screen.findByRole('complementary', { name: /recent sessions/i }),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
