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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).includes('/stream')
          ? emptyStream()
          : jsonResponse(runningDto),
      ),
    );
    renderAt('/runs/run-1');
    await waitFor(() =>
      expect(screen.getByTestId('run-busy')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it('live-tails a streamed span onto the waterfall', async () => {
    const extraSpan = {
      spanId: 'b',
      parentSpanId: 'a',
      name: 'tool.call',
      offsetMs: 5,
      durationMs: 2,
      depth: 1,
      status: 'ok',
      degraded: false,
      attributes: {},
      events: [],
    };
    function streamedSpanResponse(): Response {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(
            encoder.encode(`id: e1\ndata: ${JSON.stringify(extraSpan)}\n\n`),
          );
          c.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).includes('/stream')
          ? streamedSpanResponse()
          : jsonResponse(dto),
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

  it('stops tailing once the component unmounts (no crash on late frames)', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const openStream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const streamResponse = new Response(openStream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).includes('/stream') ? streamResponse : jsonResponse(dto),
      ),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = renderAt('/runs/run-1');
    await waitFor(() =>
      expect(screen.getByTestId('bar-a')).toBeInTheDocument(),
    );

    result.unmount();

    // A frame delivered after unmount must not crash or log a stream failure —
    // the cancelled flag makes the `for await` loop return before ingesting.
    const lateSpan = { ...dto.spans[0], spanId: 'late' };
    controller?.enqueue(
      encoder.encode(`id: e2\ndata: ${JSON.stringify(lateSpan)}\n\n`),
    );
    controller?.close();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(errorSpy).not.toHaveBeenCalledWith(
      '[run-detail] live-tail stream failed',
      expect.anything(),
    );
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
