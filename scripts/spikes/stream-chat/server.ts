/**
 * Slice 30b — Spike A, part 2: real leaf `streamText` → SSE UI-message stream
 * → browser `useChat`, through the repo's ACTUAL Ollama provider.
 *
 * Proves end-to-end (the critical-path unknown):
 *  1. `streamText` over `createOllamaModel(decl)` streams tokens incrementally.
 *  2. v6 server helpers (`createUIMessageStream` + `createUIMessageStreamResponse`)
 *     produce an SSE UI-message stream Bun.serve can return.
 *  3. A TRANSIENT `data-status` part rides the same stream (the live-rail seam)
 *     and reaches the client's `onData` (never lands in message.parts).
 *  4. `@ai-sdk/react` `useChat` renders leaf tokens live in a real browser.
 *
 * This is a throwaway spike (scripts/spikes/), not production wiring.
 * Run: bun scripts/spikes/stream-chat/server.ts   (needs Ollama up)
 */
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from 'ai';
import { Capability, type ModelDeclaration, RuntimeKind } from '../../../src/core/types.ts';
import { createOllamaModel } from '../../../src/providers/ollama.ts';

const PORT = Number(process.env.SPIKE_PORT ?? 5799);

// A small, snappy local model for a responsive stream demo.
const leafDecl: ModelDeclaration = {
  runtime: RuntimeKind.Ollama,
  model: process.env.SPIKE_MODEL ?? 'qwen3.5:4b',
  params: { temperature: 0.3, numCtx: 8192 },
  role: 'spike leaf specialist',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
};

const html = await Bun.file(new URL('./index.html', import.meta.url)).text();

const server = Bun.serve({
  port: PORT,
  idleTimeout: 0, // never idle-close an SSE connection mid-stream
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (url.pathname === '/client.js') {
      return new Response(Bun.file(new URL('./client.js', import.meta.url)), {
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { messages } = (await req.json()) as { messages: UIMessage[] };

      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          // Transient status part (the live-rail seam): delivered via onData,
          // never persisted into message.parts.
          writer.write({
            type: 'data-status',
            data: { phase: 'leaf-streaming', model: leafDecl.model },
            transient: true,
          });

          const result = streamText({
            model: createOllamaModel(leafDecl),
            system: 'You are a concise assistant. Answer in 2-4 sentences.',
            messages: await convertToModelMessages(messages), // v6: async
            abortSignal: req.signal, // client disconnect stops generation
          });

          writer.merge(result.toUIMessageStream());
        },
        onError: (err) => `stream error: ${(err as Error).message}`,
      });

      return createUIMessageStreamResponse({ stream });
    }

    return new Response('not found', { status: 404 });
  },
});

console.log(`spike-A stream server: http://localhost:${server.port}  (model=${leafDecl.model})`);
