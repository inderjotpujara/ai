import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as downloadModule from '../../shared/download.ts';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const session = {
  id: 'sess-1',
  title: 'Debugging the parser',
  owner: 'local',
  createdAt: 1000,
  updatedAt: 2000,
  lastMessageAt: 2000,
  messages: [
    { id: 'm1', role: 'user', text: 'why does this fail' },
    { id: 'm2', role: 'assistant', text: 'because of X', degraded: false },
  ],
};

describe('SessionDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the transcript from GET /api/sessions/:id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session)),
    );
    renderAt('/sessions/sess-1');
    await waitFor(() =>
      expect(screen.getByText('why does this fail')).toBeInTheDocument(),
    );
    expect(screen.getByText('because of X')).toBeInTheDocument();
    expect(screen.getByTestId('session-detail')).toBeInTheDocument();
  });

  it('renames the session (PATCH) then re-fetches the detail', async () => {
    const calls: string[] = [];
    let renamed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (init?.method === 'PATCH') {
          renamed = true;
          return new Response(null, { status: 200 });
        }
        return jsonResponse(
          renamed ? { ...session, title: 'New title' } : session,
        );
      }),
    );
    renderAt('/sessions/sess-1');
    await waitFor(() =>
      expect(screen.getByTestId('session-title-input')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('session-title-input'), {
      target: { value: 'New title' },
    });
    fireEvent.click(screen.getByTestId('session-rename-button'));
    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el?.textContent === 'Session New title'),
      ).toBeInTheDocument(),
    );
    expect(calls.some((u) => u.endsWith('/sessions/sess-1'))).toBe(true);
  });

  it('deletes the session (DELETE) then navigates to /sessions', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'DELETE'
          ? new Response(null, { status: 200 })
          : jsonResponse(session),
      ),
    );
    renderAt('/sessions/sess-1');
    await waitFor(() =>
      expect(screen.getByTestId('session-delete-button')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('session-delete-button'));
    await waitFor(() =>
      expect(screen.getByTestId('area-sessions')).toBeInTheDocument(),
    );
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = vi.fn(async () => jsonResponse(session));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/sessions/sess-1');
    await waitFor(() =>
      expect(screen.getByTestId('session-delete-button')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('session-delete-button'));
    await waitFor(() =>
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(screen.getByTestId('session-detail')).toBeInTheDocument();
  });

  it('exports the session by fetching Markdown then calling downloadBlob', async () => {
    const downloadSpy = vi
      .spyOn(downloadModule, 'downloadBlob')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/export')
          ? new Response('# Debugging the parser', {
              status: 200,
              headers: { 'content-type': 'text/markdown; charset=utf-8' },
            })
          : jsonResponse(session),
      ),
    );
    renderAt('/sessions/sess-1');
    await waitFor(() =>
      expect(screen.getByTestId('session-export-button')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('session-export-button'));
    await waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1));
    const [filename, text, mime] = downloadSpy.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(filename).toBe('session-sess-1.md');
    expect(text).toBe('# Debugging the parser');
    expect(mime).toContain('text/markdown');
  });
});
