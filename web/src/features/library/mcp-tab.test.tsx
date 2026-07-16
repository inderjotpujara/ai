import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Blank-line-delimited SSE body, same helper shape as
 *  `builder-wizard.test.tsx`'s `sseBody`. */
function sseBody(frames: { data: unknown }[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = frames
    .map((f) => `data: ${JSON.stringify(f.data)}\n\n`)
    .join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

// GET /api/mcp returns `{ items: McpServerDTO[] }` (`McpListResponseSchema`,
// `src/server/mcp/list.ts`), matching the sibling `GET /api/models` shape
// (`ModelListResponseSchema`) — NOT a bare array as an earlier brief draft
// modeled it.
const servers = [
  {
    name: 'read_file',
    kind: 'stdio',
    authKind: 'static',
    status: 'skipped',
    reason: 'not mounted this session — use Test Mount',
  },
];

describe('McpTab', () => {
  it('lists configured servers with status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/mcp')) {
          return jsonResponse({ items: servers });
        }
        return jsonResponse({ items: [] });
      }),
    );
    renderAt('/library');
    fireEvent.click(await screen.findByTestId('library-tab-mcp'));
    await waitFor(() =>
      expect(screen.getByText('read_file')).toBeInTheDocument(),
    );
    expect(screen.getByText('skipped')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('submits the Add-server form to POST /api/mcp/add', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/api/mcp/add')) {
          return jsonResponse({
            name: 'gh',
            kind: 'stdio',
            authKind: 'static',
            status: 'skipped',
            reason: 'not mounted this session — use Test Mount',
          });
        }
        return jsonResponse({ items: [] });
      }),
    );
    renderAt('/library');
    fireEvent.click(await screen.findByTestId('library-tab-mcp'));
    fireEvent.change(await screen.findByTestId('mcp-add-name'), {
      target: { value: 'gh' },
    });
    fireEvent.click(screen.getByText('Add server'));
    await waitFor(() =>
      expect(calls.some((u) => u.endsWith('/api/mcp/add'))).toBe(true),
    );
    vi.unstubAllGlobals();
  });

  // Reuses the SAME wire contract as the builder-build flow (T13/T11): the
  // envelope-wrapped StatusEvents (`data-run-start`/`data-confirm`) T23's
  // `src/server/mcp/test-mount.ts` emits via its `events` sink, PLUS the
  // one-shot `data-mcp-server` data part carrying the terminal `McpServerDTO`
  // — proving `useMcpTestMount`'s `postSseStream`+fold wiring end to end
  // through the real `<McpTab>` UI, mid-flow consent included.
  it('Test Mount streams narration, answers data-confirm, then shows the terminal result', async () => {
    const posted: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/mcp')) return jsonResponse({ items: servers });
        if (init?.method === 'POST' && url.includes('/respond')) {
          posted.push({
            url,
            body: init.body ? JSON.parse(init.body as string) : undefined,
          });
          return jsonResponse({ ok: true });
        }
        if (url.endsWith('/api/mcp/test-mount')) {
          return new Response(
            sseBody([
              {
                data: {
                  type: 'data-run-start',
                  data: { type: 'data-run-start', runId: 'run-abc' },
                  transient: true,
                },
              },
              {
                data: {
                  type: 'data-mcp-mount',
                  data: {
                    type: 'data-mcp-mount',
                    server: 'read_file',
                    outcome: 'mounting',
                  },
                  transient: true,
                },
              },
              {
                data: {
                  type: 'data-confirm',
                  data: {
                    type: 'data-confirm',
                    promptId: 'p1',
                    kind: 'mcp-mount',
                    question: 'Mount "read_file"?',
                  },
                  transient: true,
                },
              },
            ]),
            { status: 200 },
          );
        }
        return jsonResponse({ items: [] });
      }),
    );
    renderAt('/library');
    fireEvent.click(await screen.findByTestId('library-tab-mcp'));
    await screen.findByText('read_file');

    fireEvent.click(screen.getByText('Test mount'));
    await waitFor(() =>
      expect(screen.getByText('read_file: mounting')).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('confirm-prompt')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({ promptId: 'p1', value: true });
    vi.unstubAllGlobals();
  });

  // The trailing `data: [DONE]` sentinel is not JSON — `postSseStream` skips
  // it rather than feeding it to `schema.parse`. Regresses loudly (thrown
  // error surfacing as an unhandled rejection) if that skip breaks.
  it('does not crash when the test-mount stream ends with [DONE]', async () => {
    const encoder = new TextEncoder();
    const lines = [
      'data: {"type":"data-mcp-server","data":{"name":"read_file","kind":"stdio","authKind":"static","status":"mounted"},"transient":true}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/mcp')) return jsonResponse({ items: servers });
        if (url.endsWith('/api/mcp/test-mount')) {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              for (const line of lines)
                controller.enqueue(encoder.encode(line));
              controller.close();
            },
          });
          return new Response(stream, { status: 200 });
        }
        return jsonResponse({ items: [] });
      }),
    );
    renderAt('/library');
    fireEvent.click(await screen.findByTestId('library-tab-mcp'));
    await screen.findByText('read_file');
    fireEvent.click(screen.getByText('Test mount'));
    await waitFor(() =>
      expect(screen.getByTestId('mcp-test-mount-result')).toHaveTextContent(
        'read_file: mounted',
      ),
    );
    vi.unstubAllGlobals();
  });

  // Finding #2 (IMPORTANT): clicking "Test mount" fires `start()` from a bare
  // onClick with no await — a rejected stream (server restart, non-2xx) must
  // surface via `state.error`, not become an unhandled rejection that leaves
  // the tab looking frozen.
  it('shows an error instead of freezing when the test-mount stream fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/mcp')) return jsonResponse({ items: servers });
        if (url.endsWith('/api/mcp/test-mount')) {
          return new Response('server error', { status: 500 });
        }
        return jsonResponse({ items: [] });
      }),
    );
    renderAt('/library');
    fireEvent.click(await screen.findByTestId('library-tab-mcp'));
    await screen.findByText('read_file');

    fireEvent.click(screen.getByText('Test mount'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/failed/i);
    vi.unstubAllGlobals();
  });
});
