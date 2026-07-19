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
  id: 'fetch-then-summarize',
  steps: [
    { id: 'fetch', kind: 'tool', tool: 'fetch' },
    { id: 'summarize', kind: 'agent', agent: 'web_fetch' },
  ],
  edges: [{ from: 'fetch', to: 'summarize', kind: 'depends' }],
};

describe('WorkflowDetail', () => {
  it('renders the step DAG', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(detail)),
    );
    renderAt('/workflows/fetch-then-summarize');
    await waitFor(() =>
      expect(screen.getByTestId('workflow-detail')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('dag-view')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows a step-detail panel when a node is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(detail)),
    );
    renderAt('/workflows/fetch-then-summarize');
    fireEvent.click(await screen.findByTestId('dag-node-fetch'));
    await waitFor(() =>
      expect(screen.getByTestId('step-detail')).toBeInTheDocument(),
    );
    expect(screen.getByText(/tool: fetch/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('launches a run and navigates to /runs/$runId', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/run')
        ? jsonResponse({ runId: 'run-xyz' })
        : jsonResponse(detail),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/workflows/fetch-then-summarize');
    await waitFor(() =>
      expect(screen.getByTestId('workflow-run-button')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('workflow-run-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByTestId('workflow-run-button'));
    await waitFor(() =>
      expect(screen.getByTestId('run-detail')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('labels the step-detail landmark for assistive tech (D1)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(detail)),
    );
    renderAt('/workflows/fetch-then-summarize');
    fireEvent.click(await screen.findByTestId('dag-node-fetch'));
    expect(
      await screen.findByRole('complementary', {
        name: /selected step detail/i,
      }),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
