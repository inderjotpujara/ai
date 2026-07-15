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
      id: 'fetch-then-summarize',
      description:
        'Fetch a URL with the fetch tool, then summarize via an agent.',
      stepCount: 2,
    },
  ],
};

describe('WorkflowsArea', () => {
  it('lists workflows fetched from /api/workflows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(page)),
    );
    renderAt('/workflows');
    await waitFor(() =>
      expect(screen.getByText('fetch-then-summarize')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('area-workflows')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows "No workflows found" when the registry is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [] })),
    );
    renderAt('/workflows');
    await waitFor(() =>
      expect(screen.getByText('No workflows found')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('filters client-side by search text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(page)),
    );
    renderAt('/workflows');
    await waitFor(() =>
      expect(screen.getByText('fetch-then-summarize')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('workflows-search'), {
      target: { value: 'nope' },
    });
    await waitFor(() =>
      expect(screen.getByText('No workflows found')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('shows an in-region error message when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    renderAt('/workflows');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
