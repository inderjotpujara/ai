import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  };
}

const dto = {
  id: 'run-1',
  owner: 'local',
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
});
