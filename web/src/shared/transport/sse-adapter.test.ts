import { SpanDtoSchema } from '@contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createSseTransport, postSseStream } from './sse-adapter.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  // biome-ignore lint/suspicious/noExplicitAny: test cleanup of injected global
  delete (globalThis as any).window;
});

function stubToken(token: string) {
  vi.stubGlobal('window', { __AGENT_TOKEN__: token });
}

/** Builds a fetch Response whose body streams the given SSE frames. */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('createSseTransport', () => {
  describe('stream', () => {
    it('yields TransportEvents parsed from SSE frames, tagged with eventId', async () => {
      stubToken('secret');
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            'id: 1\ndata: {"type":"data-delegation","agent":"file_qa","depth":1,"ancestors":["orchestrator"]}\n\n',
            'id: 2\ndata: {"type":"data-run-end","runId":"r1","outcome":"answer"}\n\n',
          ]),
        );
      vi.stubGlobal('fetch', fetchMock);

      const transport = createSseTransport();
      const events = [];
      for await (const event of transport.stream('r1')) events.push(event);

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: 'data-delegation',
        agent: 'file_qa',
        depth: 1,
        ancestors: ['orchestrator'],
        eventId: '1',
      });
      expect(events[1]).toEqual({
        type: 'data-run-end',
        runId: 'r1',
        outcome: 'answer',
        eventId: '2',
      });

      // biome-ignore lint/style/noNonNullAssertion: mock.calls[0] guaranteed present
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/runs/r1/stream');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer secret',
      );
    });

    it('sends Last-Event-ID when fromCursor is passed', async () => {
      stubToken('secret');
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            'id: 3\ndata: {"type":"data-run-end","runId":"r1","outcome":"answer"}\n\n',
          ]),
        );
      vi.stubGlobal('fetch', fetchMock);

      const transport = createSseTransport();
      const events = [];
      for await (const event of transport.stream('r1', '2')) events.push(event);

      expect(events).toHaveLength(1);
      // biome-ignore lint/style/noNonNullAssertion: mock.calls[0] guaranteed present
      const [, init] = fetchMock.mock.calls[0]!;
      expect((init.headers as Record<string, string>)['Last-Event-ID']).toBe(
        '2',
      );
    });
  });

  describe('respond', () => {
    it('POSTs the payload to /api/runs/:id/respond with the bearer header', async () => {
      stubToken('secret');
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const transport = createSseTransport();
      const result = await transport.respond('r1', {
        promptId: 'p1',
        value: true,
      });

      expect(result).toBeUndefined();
      // biome-ignore lint/style/noNonNullAssertion: mock.calls[0] guaranteed present
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/runs/r1/respond');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer secret',
      );
      expect(JSON.parse(init.body as string)).toEqual({
        promptId: 'p1',
        value: true,
      });
    });
  });
});

describe('createSseTransport stream() payload schema', () => {
  it('parses SpanDTO frames when a SpanDtoSchema is supplied', async () => {
    const spanFrame = {
      spanId: 's1',
      parentSpanId: null,
      name: 'agent.run',
      offsetMs: 0,
      durationMs: 5,
      depth: 0,
      status: 'ok',
      degraded: false,
      attributes: {},
      events: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([`id: s1\ndata: ${JSON.stringify(spanFrame)}\n\n`]),
      ),
    );
    const out = [];
    for await (const ev of createSseTransport().stream(
      'r1',
      null,
      SpanDtoSchema,
    )) {
      out.push(ev);
    }
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ spanId: 's1', eventId: 's1' });
  });
});

describe('postSseStream', () => {
  function sseBody(
    frames: { id?: string; data: unknown }[],
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const text = frames
      .map(
        (f) =>
          `${f.id ? `id: ${f.id}\n` : ''}data: ${JSON.stringify(f.data)}\n\n`,
      )
      .join('');
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
  }

  it('POSTs a JSON body and yields parsed, schema-validated frames with eventId', async () => {
    const FrameSchema = z.object({
      type: z.string(),
      value: z.number().optional(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ need: 'x' });
        return new Response(
          sseBody([{ id: 'e1', data: { type: 'a', value: 1 } }]),
          {
            status: 200,
          },
        );
      }),
    );
    const out: unknown[] = [];
    for await (const frame of postSseStream(
      '/api/builders/build',
      { need: 'x' },
      FrameSchema,
    )) {
      out.push(frame);
    }
    expect(out).toEqual([{ type: 'a', value: 1, eventId: 'e1' }]);
    vi.unstubAllGlobals();
  });

  it('is [DONE]-tolerant: the trailing `data: [DONE]` sentinel (the AI-SDK UI-message-stream terminator, e.g. `createUIMessageStreamResponse`) is ignored, not JSON.parse-crashed', async () => {
    const FrameSchema = z.object({
      type: z.string(),
      value: z.number().optional(),
    });
    const encoder = new TextEncoder();
    const raw = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('id: e1\ndata: {"type":"a","value":1}\n\n'),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(raw, { status: 200 })),
    );
    const out: unknown[] = [];
    for await (const frame of postSseStream(
      '/api/builders/build',
      {},
      FrameSchema,
    )) {
      out.push(frame);
    }
    expect(out).toEqual([{ type: 'a', value: 1, eventId: 'e1' }]);
    vi.unstubAllGlobals();
  });
});
