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
      name: 'research-crew',
      description: 'Research a topic and produce a short brief.',
      process: 'sequential',
      memberCount: 2,
      taskCount: 2,
    },
  ],
};

describe('CrewsArea', () => {
  it('lists crews fetched from /api/crews', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(page)),
    );
    renderAt('/crews');
    await waitFor(() =>
      expect(screen.getByText('research-crew')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('area-crews')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows "No crews found" when the registry is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [] })),
    );
    renderAt('/crews');
    await waitFor(() =>
      expect(screen.getByText('No crews found')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('filters client-side by search text (name or description)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(page)),
    );
    renderAt('/crews');
    await waitFor(() =>
      expect(screen.getByText('research-crew')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('crews-search'), {
      target: { value: 'nope' },
    });
    await waitFor(() =>
      expect(screen.getByText('No crews found')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('shows an in-region error message when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    renderAt('/crews');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
