import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { routeTree } from '../../app/router.tsx';
import { ThemeProvider } from '../../shared/design/theme.tsx';
import { renderAt } from '../../test/render.tsx';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function emptyStream(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** An SSE Response whose body stays open until `push`/`close` are called. */
function controllableStream(): {
  response: Response;
  push: (frame: string) => void;
  close: () => void;
  error: (e: unknown) => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
    push: (frame) => controller?.enqueue(encoder.encode(frame)),
    close: () => controller?.close(),
    error: (e) => controller?.error(e),
  };
}

const dto = {
  id: 'run-1',
  owner: 'local',
  kind: 'agent',
  origin: 'manual',
  lifecycle: 'done',
  startMs: 0,
  durationMs: 10,
  outcome: 'answer',
  models: ['qwen'],
  degraded: false,
  degrades: [],
  malformedSpans: 0,
  spanCount: 1,
  roots: ['a'],
  artifacts: [],
  spans: [
    {
      spanId: 'a',
      parentSpanId: null,
      name: 'agent.run',
      offsetMs: 0,
      durationMs: 10,
      depth: 0,
      status: 'ok',
      degraded: false,
      attributes: {},
      events: [],
    },
  ],
};

function spanFrame(spanId: string, eventId: string): string {
  const span = { ...dto.spans[0], spanId, offsetMs: 5, durationMs: 2 };
  return `id: ${eventId}\ndata: ${JSON.stringify(span)}\n\n`;
}

describe('RunDetail', () => {
  it('renders the snapshot waterfall for a run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).includes('/stream') ? emptyStream() : jsonResponse(dto),
      ),
    );
    renderAt('/runs/run-1');
    await waitFor(() =>
      expect(screen.getByTestId('bar-a')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('run-detail')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('retries a snapshot 404 (run still starting) then renders the run', async () => {
    // A freshly-launched run's dir is pre-created but span-less for a brief
    // window → mapRunToDto → 404. The page must retry (not surface "failed to
    // load") and render once the snapshot becomes available.
    let runFetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/stream')) return emptyStream();
        runFetchCount += 1;
        if (runFetchCount <= 2) {
          return new Response(JSON.stringify({ error: 'not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
        return jsonResponse(dto);
      }),
    );
    renderAt('/runs/run-1');
    await waitFor(
      () => expect(screen.getByTestId('bar-a')).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(runFetchCount).toBeGreaterThanOrEqual(3);
    vi.unstubAllGlobals();
  });

  it('surfaces a non-404 snapshot error immediately (no retry)', async () => {
    let runFetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/stream')) return emptyStream();
        // Task T55: `SessionsSidebar` (AppShell) also fetches
        // `/api/sessions?limit=10` on mount; it must not be counted as a
        // run-snapshot fetch attempt by this test's no-retry assertion.
        if (url.includes('/api/sessions'))
          return jsonResponse({ items: [], total: 0 });
        runFetchCount += 1;
        return new Response(JSON.stringify({ error: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    renderAt('/runs/run-1');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // A 500 is real — it must NOT be retried like a 404.
    expect(runFetchCount).toBe(1);
    vi.unstubAllGlobals();
  });

  it('shows a busy indicator while the run is running', async () => {
    const runningDto = { ...dto, lifecycle: 'running' };
    // Stream stays open (run still in progress) → busy must remain visible.
    const stream = controllableStream();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).includes('/stream')
          ? stream.response
          : jsonResponse(runningDto),
      ),
    );
    renderAt('/runs/run-1');
    await waitFor(() =>
      expect(screen.getByTestId('run-busy')).toBeInTheDocument(),
    );
    stream.close();
    vi.unstubAllGlobals();
  });

  it('clears the busy indicator once the run finishes and the stream closes', async () => {
    const runningDto = { ...dto, lifecycle: 'running' };
    const stream = controllableStream();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).includes('/stream')
          ? stream.response
          : jsonResponse(runningDto),
      ),
    );
    renderAt('/runs/run-1');
    await waitFor(() =>
      expect(screen.getByTestId('run-busy')).toBeInTheDocument(),
    );
    // Run finishes → server closes the stream → busy must disappear.
    stream.close();
    await waitFor(() =>
      expect(screen.queryByTestId('run-busy')).not.toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('live-tails a streamed span onto the waterfall', async () => {
    const stream = controllableStream();
    stream.push(spanFrame('b', 'e1'));
    stream.close();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).includes('/stream') ? stream.response : jsonResponse(dto),
      ),
    );
    renderAt('/runs/run-1');
    await waitFor(() =>
      expect(screen.getByTestId('bar-a')).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('bar-b')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('clears the busy indicator when the live-tail stream errors (non-abort)', async () => {
    const runningDto = { ...dto, lifecycle: 'running' };
    const stream = controllableStream();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).includes('/stream')
          ? stream.response
          : jsonResponse(runningDto),
      ),
    );
    renderAt('/runs/run-1');
    await waitFor(() =>
      expect(screen.getByTestId('run-busy')).toBeInTheDocument(),
    );
    // A non-abort stream failure must still clear busy (not stick forever).
    stream.error(new Error('stream boom'));
    await waitFor(() =>
      expect(screen.queryByTestId('run-busy')).not.toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('remounts and resets the waterfall when the runId changes', async () => {
    const dtoFor = (id: string, spanId: string) => ({
      ...dto,
      id,
      roots: [spanId],
      spans: [{ ...dto.spans[0], spanId }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/stream')) return emptyStream();
        return url.includes('/runs/run-2')
          ? jsonResponse(dtoFor('run-2', 'b'))
          : jsonResponse(dtoFor('run-1', 'a'));
      }),
    );
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/runs/run-1'] }),
    });
    render(
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('bar-a')).toBeInTheDocument(),
    );
    await act(async () => {
      await router.navigate({
        to: '/runs/$runId',
        params: { runId: 'run-2' },
      });
    });
    // The key={runId} remount resets useRunTrace: run-2's bar appears and
    // run-1's bar is gone (not merged into the new run's waterfall).
    await waitFor(() =>
      expect(screen.getByTestId('bar-b')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('bar-a')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('aborts the stream fetch on unmount and ingests no post-unmount frames', async () => {
    const stream = controllableStream();
    let streamSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input).includes('/stream')) {
          streamSignal = init?.signal ?? undefined;
          return stream.response;
        }
        return jsonResponse(dto);
      }),
    );

    const result = renderAt('/runs/run-1');
    await waitFor(() =>
      expect(screen.getByTestId('bar-a')).toBeInTheDocument(),
    );
    // Stream is open with no pending frame — the idle-between-frames case.
    expect(streamSignal?.aborted).toBe(false);

    result.unmount();

    // Cleanup must abort the fetch immediately, even while idle.
    expect(streamSignal?.aborted).toBe(true);

    // A frame delivered after unmount must never reach the waterfall.
    stream.push(spanFrame('late', 'e2'));
    stream.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByTestId('bar-late')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  const workflowDto = {
    ...dto,
    kind: 'workflow',
    roots: ['root'],
    spans: [
      {
        spanId: 'root',
        parentSpanId: null,
        name: 'workflow.run',
        offsetMs: 0,
        durationMs: 20,
        depth: 0,
        status: 'ok',
        degraded: false,
        attributes: { 'workflow.id': 'fetch-then-summarize' },
        events: [],
      },
      {
        spanId: 'step-fetch',
        parentSpanId: 'root',
        name: 'workflow.step',
        offsetMs: 1,
        durationMs: 5,
        depth: 1,
        status: 'ok',
        degraded: false,
        attributes: { 'workflow.step.id': 'fetch' },
        events: [],
      },
    ],
  };

  const workflowDef = {
    id: 'fetch-then-summarize',
    steps: [
      { id: 'fetch', kind: 'tool', tool: 'fetch' },
      { id: 'summarize', kind: 'agent', agent: 'web_fetch' },
    ],
    edges: [{ from: 'fetch', to: 'summarize', kind: 'depends' }],
  };

  it('offers a Graph/Waterfall toggle for a workflow run and overlays live step status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/stream')) return emptyStream();
        if (url.includes('/workflows/')) return jsonResponse(workflowDef);
        return jsonResponse(workflowDto);
      }),
    );
    renderAt('/runs/run-1');
    await waitFor(() =>
      expect(screen.getByTestId('view-toggle-graph')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('view-toggle-graph'));
    await waitFor(() =>
      expect(screen.getByTestId('dag-view')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('dag-node-fetch')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows no Graph toggle for a plain agent run (no recognized crew/workflow root)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).includes('/stream') ? emptyStream() : jsonResponse(dto),
      ),
    );
    renderAt('/runs/run-1');
    await waitFor(() =>
      expect(screen.getByTestId('bar-a')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('view-toggle-graph')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('Amendment A: loads the graph immediately from graphKind/graphId search params, before any root span exists', async () => {
    // `dto` here has no workflow.run/crew.run root at all — the search-param
    // path must resolve the graph without ever consulting the span trace.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/stream')) return emptyStream();
        if (url.includes('/workflows/')) return jsonResponse(workflowDef);
        return jsonResponse(dto);
      }),
    );
    renderAt('/runs/run-1?graphKind=workflow&graphId=fetch-then-summarize');
    await waitFor(() =>
      expect(screen.getByTestId('dag-view')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('dag-node-fetch')).toBeInTheDocument();
    // The view auto-switches to Graph for the launch→watch flow — no click
    // needed, unlike the cold-open telemetry-scan fallback above.
    expect(screen.getByTestId('view-toggle-graph')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
