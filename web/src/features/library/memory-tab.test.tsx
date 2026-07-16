import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const spaces = [{ name: 'default', chunkCount: 12 }];
const recallResults = [
  { id: 'doc#0', source: 'notes.md', text: 'hello world', score: 0.87 },
];

function textFile(name = 'notes.md'): File {
  return new File(['# hello'], name, { type: 'text/markdown' });
}

describe('MemoryTab', () => {
  it('lists spaces with chunk counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/memory/spaces'))
          return jsonResponse(spaces);
        return jsonResponse([]);
      }),
    );
    renderAt('/library');
    fireEvent.click(await screen.findByTestId('library-tab-memory'));
    await waitFor(() =>
      expect(screen.getByText('default')).toBeInTheDocument(),
    );
    expect(screen.getByText('12 chunks')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('runs a recall search and renders RetrievalResultDTO[]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/recall')) return jsonResponse(recallResults);
        if (url.endsWith('/api/memory/spaces')) return jsonResponse(spaces);
        return jsonResponse([]);
      }),
    );
    renderAt('/library');
    fireEvent.click(await screen.findByTestId('library-tab-memory'));
    fireEvent.change(await screen.findByTestId('memory-recall-query'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByText('Recall'));
    await waitFor(() =>
      expect(screen.getByText('hello world')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('uploads a document via /api/upload, then ingests the returned fileId', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/api/upload')) {
          expect(init?.body).toBeInstanceOf(FormData);
          return jsonResponse({ uploadId: 'server-minted-id.md' });
        }
        if (url.endsWith('/ingest')) {
          const body = JSON.parse(String(init?.body)) as { fileId: string };
          expect(body).toEqual({ fileId: 'server-minted-id.md' });
          return jsonResponse({ chunks: 3, skipped: false });
        }
        if (url.endsWith('/api/memory/spaces')) return jsonResponse(spaces);
        return jsonResponse([]);
      }),
    );
    renderAt('/library');
    fireEvent.click(await screen.findByTestId('library-tab-memory'));

    const fileInput = await screen.findByTestId('memory-file-input');
    await userEvent.upload(fileInput, textFile());
    fireEvent.click(screen.getByText('Ingest into space'));

    await waitFor(() =>
      expect(screen.getByTestId('memory-ingest-result')).toHaveTextContent(
        '3 chunks',
      ),
    );
    expect(calls.some((u) => u.endsWith('/api/upload'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/ingest'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('surfaces an error when the spaces list fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    renderAt('/library');
    fireEvent.click(await screen.findByTestId('library-tab-memory'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('surfaces an error when recall fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/recall'))
          return new Response('boom', { status: 500 });
        if (url.endsWith('/api/memory/spaces')) return jsonResponse(spaces);
        return jsonResponse([]);
      }),
    );
    renderAt('/library');
    fireEvent.click(await screen.findByTestId('library-tab-memory'));
    fireEvent.change(await screen.findByTestId('memory-recall-query'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByText('Recall'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
