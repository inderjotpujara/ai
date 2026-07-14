# Slice 30b — Spike A findings (engine seams → browser token stream)

**Date:** 2026-07-14 · **Branch:** `slice-30b-local-web-ui` · **Verdict: ✅ PASS — critical path de-risked.**

Goal: prove a leaf `streamText` token stream reaches a real browser through
`useChat` on AI SDK v6, and that the `withWallClock` timeout still bounds a
streamed turn. Both proven with real evidence (Ollama `qwen3.5:4b`, real Chrome).

## What was run
- `stream-wallclock-check.ts` — deterministic (no model/browser) proof of the
  wall-clock × stream trap + fix. **PASS** (`bun scripts/spikes/stream-chat/stream-wallclock-check.ts`).
- `server.ts` + `client.tsx` + `index.html` — Bun.serve BFF streaming the real
  Ollama model as a v6 UI-message SSE stream; `@ai-sdk/react` `useChat` client.
  Verified live in Chrome: user+assistant messages streamed token-by-token; the
  transient `data-status` part reached `onData` (`{phase:"leaf-streaming",model:"qwen3.5:4b"}`).

## Findings that shape the implementation plan

1. **Engine seams are LOW risk (from the mapping agents).** All six
   `runChatSession` re-assembly targets are already exported; `runChat` already
   accepts an `AbortSignal` (Stop button); the `events` sink threads one-for-one
   like `ledger?` through `createSuperAgent`/`createOrchestrator`/`asDelegateTool`/
   `runGuardedAgent`/`SelectHookDeps`. Path drift: real files are
   `src/cli/select-hook.ts` and top-level `agents/super.ts` (not `src/agents/`).

2. **⚠ Wall-clock × stream trap (must encode in the leaf-stream task).**
   `streamText(...)` returns promptly and streams lazily, so if `withWallClock`'s
   `fn` merely returns the result object, the race settles in ~1ms and the timeout
   STOPS bounding generation (proven: `[BAD] elapsed=1ms, DEFEATED`). Fix: `fn`
   must **drain** the stream — `await result.consumeStream()` (or iterate
   `textStream`) — with the abort signal threaded in (proven: `[GOOD] elapsed=302ms,
   ENFORCED`). Fast streams don't false-timeout.

3. **⚠ AI SDK v6.0.217 API gotcha: `convertToModelMessages` is ASYNC** — must be
   `await`ed. Passing the un-awaited Promise as `messages` yields the opaque
   "messages.some is not a function" / empty-stream error. (Cost ~10 min to find;
   documenting so the chat task doesn't rediscover it.)

4. **v6 server recipe (works on Bun.serve):**
   ```ts
   const stream = createUIMessageStream({
     execute: async ({ writer }) => {
       writer.write({ type: 'data-status', data: {...}, transient: true }); // live rail
       const result = streamText({ model, messages: await convertToModelMessages(msgs), abortSignal: req.signal });
       writer.merge(result.toUIMessageStream());
     },
     onError: (e) => `stream error: ${(e as Error).message}`,
   });
   return createUIMessageStreamResponse({ stream });
   ```
   `Bun.serve({ idleTimeout: 0 })` is required so SSE isn't idle-closed mid-stream.
   `req.signal → streamText.abortSignal` gives clean client-disconnect cancel.

5. **Transient data-parts are the live-rail mechanism (confirmed live).**
   `writer.write({ type:'data-*', data, transient:true })` → client
   `useChat({ onData })`; transient parts never land in `message.parts`. This is
   how `data-delegation`/`-model-select`/`-model-load`/`-degrade` should ride.

6. **Client recipe:** `useChat({ transport: new DefaultChatTransport({ api }) })`,
   `sendMessage({ text })`, render `message.parts[]` (`{type:'text', text}`).
   Deps proven: `@ai-sdk/react@3.0.227`, `react@19.2.7`, `react-dom@19.2.7`.

7. **⚠ Bundler note (spike-only, won't bite the real build):** `bun build` as a
   bundler emits `jsxDEV` (dev JSX runtime) unless `--minify`, and the production
   `react/jsx-dev-runtime` stub lacks `jsxDEV` → runtime crash. The real frontend
   uses **Vite 8** (D4), which selects the correct JSX runtime, so this is a
   `bun build` quirk only. Also: serve dev assets with `cache-control: no-store`
   (Chrome aggressively caches the bundle) — Vite HMR handles this.

## Dependency note for the plan
The spike added `react`, `react-dom`, `@ai-sdk/react` to the ROOT `package.json`.
Phase 1 must decide dep placement: the spec puts the frontend in `web/` (its own
Vite project) — these likely belong in `web/package.json`, not root. Revisit when
scaffolding `web/`.
