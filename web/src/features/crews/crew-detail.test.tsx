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
  name: 'research-crew',
  process: 'sequential',
  members: [
    {
      name: 'researcher',
      role: 'Analyst',
      goal: 'g',
      backstory: 'b',
      requires: [],
      prefer: 'x',
    },
  ],
  tasks: [
    {
      id: 'gather',
      description: 'd',
      expectedOutput: 'o',
      member: 'researcher',
      dependsOn: [],
    },
  ],
};

describe('CrewDetail', () => {
  it('renders members + the task graph', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(detail)),
    );
    renderAt('/crews/research-crew');
    await waitFor(() =>
      expect(screen.getByTestId('crew-detail')).toBeInTheDocument(),
    );
    expect(screen.getByText(/researcher — Analyst/)).toBeInTheDocument();
    expect(screen.getByTestId('dag-view')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('launches a run and navigates to /runs/$runId', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/run')
        ? jsonResponse({ runId: 'run-abc' })
        : jsonResponse(detail),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/crews/research-crew');
    await waitFor(() =>
      expect(screen.getByTestId('crew-run-button')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('crew-run-input'), {
      target: { value: 'AI' },
    });
    fireEvent.click(screen.getByTestId('crew-run-button'));
    await waitFor(() =>
      expect(screen.getByTestId('run-detail')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });
});
