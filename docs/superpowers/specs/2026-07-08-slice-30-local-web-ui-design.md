# Slice 30 — Local web UI — design

**Date:** 2026-07-08
**Branch:** `slice-30-local-web-ui` (off `main`)
**Status:** design approved (brainstorm), spec under review before planning

## Context & framing

This is the framework's **first visual surface**. Every shipped slice to date is
CLI + on-disk artifacts (`runs/<id>/spans.jsonl`); there is no web server, no daemon,
and no frontend dependency in the repo. Slice 30 adds a **local web UI** — a browser app
served from `localhost` — that becomes the primary way a person drives the framework:
chat, watch the agents work, browse run history, and talk to it.

Two framing decisions were locked with the user (2026-07-08):

- **Surface = browser web UI, not a terminal TUI.** The browser is the only surface that
  unlocks the headline voice story deferred from Slice 29: `getUserMedia({ audio: {
  echoCancellation: true }})` gives native acoustic echo cancellation (so barge-in works —
  the exact self-echo wall the terminal hit) plus real `keydown`/`keyup` for true
  hold-to-talk. It is also where "make it premium" lives.
- **Scope = go big; fold Slice 34 in.** Per the no-deferrals rule, Slice 30 ships the
  *complete* product surface rather than a run-history-only shell. It absorbs the core of
  the planned Slice 34 ("primary chat / second brain"): **cross-invocation chat
  persistence** (chat has zero memory across invocations today) is in-scope. What remains
  for a later slice is multi-device/second-brain *extras* (sync across machines = Slice 31
  A2A territory), not the primary chat surface.

The engine stays untouched. Slice 30 is a **new surface that adapts existing pure
functions** (`runChat`, `withMcpRun`, `readSpans`/`buildTree`/`summarizeRun`, the
declaration registries) over a typed boundary — not a rewrite.

## Goal (one sentence)

A polished, maintainable local web app (Blueprint-Mono aesthetic) where a person chats with
the multi-agent framework, watches which agent/model is live, browses and inspects run
traces, and speaks with barge-in — built so the product can grow in complexity without the
frontend and engine becoming entangled.

## Decisions (locked with user, 2026-07-08)

- **D1 — Surface = local browser web UI.** Served from `localhost`; single-user now,
  remote-reachable later (Slice 24). Not a TUI (rationale above). TUI is not revisited.
- **D2 — Scope folds Slice 34's primary-chat + persistence in.** Cross-invocation chat
  memory (sessions + message history) is in-scope. Multi-device sync stays out (Slice 31).
- **D3 — Aesthetic = "Blueprint Mono" (Direction A).** Near-black `#0B0C0E` over a
  subliminal dot-grid; humanist sans for prose + mono for every label/datum; a single
  blueprint-blue accent `#4C8DFF` reserved strictly for live/interactive elements; signal
  teal `#35D0C0`; spring micro-motion; ⌘K palette as the spine. The two runner-up
  directions (Terminal-Native Brutalist, Editorial Warm-Clinical) become **future
  switchable themes** — this forces the token discipline in D5.
- **D4 — Stack (validated against 2026 sources).** React 19 · Vite 8 (frontend under
  `web/`) · Tailwind v4 + shadcn/ui-on-Base-UI · AI SDK **v6** `useChat` over SSE with
  **transient data-parts** for the live status panel · Vercel **AI Elements** (copy-in) +
  **streamdown** for the chat body · **@xyflow/react** for the live delegation graph ·
  custom **@visx** waterfall for the run-history trace. **Pin `@ai-sdk/react@^3`** (the
  v6-compatible major) — `@latest` is v7 and would break against our v6 engine pin.
- **D5 — Architecture = contract boundary + thin BFF + feature-sliced frontend + ports.**
  A shared `src/contracts/` (isomorphic Zod schemas = the wire protocol, imported by both
  server and web) is the single source of truth for the boundary. The server returns DTOs
  mapped from spans, never raw `SpanRecord`s. The three volatile edges — **transport**,
  **voice**, **persistence** — sit behind interfaces so implementations can be swapped as
  the product grows. **Maintainability + scalability is the governing constraint** (user
  directive): small focused files, feature isolation, no hardcoded design values.
- **D6 — Server = a thin Bun.serve BFF that owns no business logic.** Dev: Vite dev server
  proxies `/api` to the Bun server. Prod: `vite build` → static assets served by the Bun
  server on one origin (no CORS) under **COOP/COEP** headers (required for sherpa WASM's
  `SharedArrayBuffer`). All reasoning stays in the engine; endpoints are adapters, mappers
  are pure functions.
- **D7 — Persistence = `SessionStore` over `bun:sqlite`, behind a port.** Versioned,
  migratable schema linking sessions ↔ messages ↔ run-ids. Swappable (Postgres) when
  multi-user (Slice 33) arrives.
- **D8 — Voice = getUserMedia(AEC) → AudioWorklet → sherpa-onnx WASM + Silero VAD, behind
  a voice port.** True hold-to-talk (`keydown`/`keyup`), barge-in via AEC, interim→final
  transcription. Reuses Slice 29's sherpa transcribe **contract** (Float32/16 kHz) — the
  same C-core, a different (WASM) binding. Shares the conceptual `Transcriber` seam.
- **D9 — ⌘K command palette is in-scope.** It is Blueprint Mono's spine: launch agents,
  jump to runs, switch models, open settings. Keyboard-first is core to the aesthetic.
- **D10 — Screen designs precede code (user gate).** The full Blueprint-Mono screen set is
  produced as HTML and **synced to a claude.ai/design Design System project** (via the
  `DesignSync` tool / `/design-sync`) BEFORE implementation. The React components are then
  built against that design-system reference. Screens enumerated below.
- **D11 — Ships complete, reviewed in ordered increments** (build order below). No new
  deferred debt.

## Architecture

Three new top-level areas; the engine is unchanged.

```
~/ai/
├─ src/
│  ├─ contracts/   ← Zod schemas + TS types = the wire protocol (isomorphic, no Node APIs).
│  │                 Imported by BOTH server and web. Single source of truth for the boundary.
│  ├─ server/      ← Thin Bun HTTP/SSE backend-for-frontend. Adapts engine → HTTP.
│  │                 Pure span→DTO mappers. Owns NO business logic.
│  └─ (existing engine untouched)
└─ web/            ← React 19 + Vite frontend. Feature-sliced.
```

### Data flow

```
browser (web/) ──POST /api/chat──▶ server ──runChat/withMcpRun──▶ engine (orchestrator)
      ▲   ▲                          │                                   │
      │   └── SSE UI-message stream ─┘ (tokens + transient data-status)   │ spans → runs/<id>/spans.jsonl
      │                                                                   │
      └── GET /api/runs[/:id][/stream] ──▶ server ──readSpans/buildTree/summarizeRun──▶ DTOs
      └── GET /api/agents · /api/models ──▶ server ──registries──▶ DTOs
      └── voice: getUserMedia(AEC) → AudioWorklet → sherpa WASM → transcript → chat input (local)
```

### Server (`src/server/`) — endpoints

- `POST /api/chat` → SSE UI-message stream (`createUIMessageStream`). Runs the orchestrator
  via `runChat`/`withMcpRun`; emits tokens **plus transient `data-status` parts**
  (agent/model/phase) sourced from the existing `onBeforeDelegate` hook + telemetry, so the
  live panel updates without polluting saved chat history.
- `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/stream` (live tail) → via
  `summarizeRun`/`readSpans`/`buildTree` → **contract DTOs** (a mapping layer keeps the
  wire stable even if span internals change).
- `GET /api/agents`, `GET /api/models` → declaration registries → DTOs.
- Static serving of built `web/` under COOP/COEP. `server.timeout(req, 0)` on SSE handlers
  (Bun closes idle connections at 10s; a quiet stream counts as idle).

### Frontend (`web/src/`) — feature-sliced

```
web/src/
├─ app/       shell, layout (rail │ main │ trace), providers, routing, ⌘K palette
├─ features/
│  ├─ chat/   streaming chat (AI Elements + streamdown), useChat wiring, error boundary
│  ├─ agents/ live agent/model status rail (consumes transient data-parts)
│  ├─ runs/   run-history browser + @visx trace waterfall + @xyflow delegation graph
│  ├─ voice/  getUserMedia(AEC) → AudioWorklet → sherpa WASM + VAD + orb/waveform
│  └─ sessions/ session list + cross-invocation history (persistence UI)
└─ shared/    design tokens, Base-UI/shadcn primitives, contract client, ports, hooks
```

**Isolation rule:** a feature imports only `shared/` and `src/contracts/` — never another
feature's internals. Growth = a new `features/x/` folder. Each feature region has its own
**error boundary** (chat can fail without killing the rail).

### Ports & adapters (the volatile edges)

- **Transport port** (`shared/transport`) — `ChatTransport` / `RunStream`. Default adapter:
  SSE (AI SDK). Later: WebSocket or Redis-backed resumable streams (remote, Slice 24).
- **Voice port** (`features/voice`) — `SttEngine` + `AudioCapture`. Adapter: sherpa WASM +
  AudioWorklet. Swappable: Whisper-WASM fallback or server-side STT.
- **Persistence port** (`src/server`) — `SessionStore`. Adapter: `bun:sqlite`. Swappable:
  Postgres (multi-user, Slice 33).

### Design-token system (Blueprint Mono)

`web/src/shared/design/tokens.css` defines palette / type-scale / spacing / motion as CSS
custom properties consumed via Tailwind v4 `@theme`. **Components reference tokens, never
raw hex.** Themes (Blueprint default; Brutalist / Editorial later) are token overrides only
— no component changes to add a theme. Fonts embedded as `@font-face` data-URIs (Geist Sans
+ Geist Mono); no CDN.

## Screens (design set for D10 — synced to claude.ai/design before code)

1. **Workspace** — chat + agent/model rail + trace strip (default state); **first-run /
   empty** state.
2. **Chat states** — streaming with shimmer, tool-call card, reasoning block, citations,
   error/reconnecting.
3. **Live agent/model panel** — status rail (done/running/queued/idle), model
   loaded/loading, degraded marker.
4. **Run-history browser** — the run list (outcome, duration, models, tokens).
5. **Run detail** — @visx trace waterfall + @xyflow delegation graph, per-span token/cost.
6. **Voice active** — hold-to-talk, barge-in, interim→final transcription, waveform.
7. **⌘K command palette** — launch agent, jump to run, switch model, open settings.
8. **Settings** — uncensored toggle (`AGENT_UNCENSORED`), theme switch, model selection.
9. **Sessions** — session list / cross-invocation history sidebar (persistence).

## Error handling / graceful degrade (never crash)

- **Server:** typed errors; every endpoint degrades gracefully (reuses Slice 21
  reliability). The SSE stream emits typed **error data-parts** — never a silent drop.
- **Frontend:** per-feature error boundaries; connection loss → EventSource auto-reconnect
  + a visible "reconnecting" state; voice permission denied / no mic → explicit inline
  message (mirrors the Slice 29 TCC-permission hint); WASM/model load failure → degrade to
  text input with a clear notice.
- Never silent-fail (upheld by the silent-failure-hunter review dimension).

## Testing

- **Contracts:** Zod schema round-trip tests (parse ⇄ serialize).
- **Server:** pure span→DTO mapper unit tests; endpoint integration tests against Bun.serve
  with a fake orchestrator; SSE lifecycle (idle-timeout, error-part) tests.
- **Frontend:** component tests (Vitest + Testing Library / the webapp-testing skill);
  transport-port contract test; a smoke e2e (drive a run, assert the stream renders and the
  rail updates).
- **Voice:** unit-test the PCM downsample/format math (48k→16k, Float32→Int16) with the WASM
  engine mocked; the WASM build itself validated in live-verify.
- **Live-verify (gated):** real browser + real model + real voice (barge-in) + real trace,
  end-to-end on this Mac, per the live-verify-before-merge rule.

## Standing spec notes (per repo CLAUDE.md)

- **Architecture-doc update note:** this slice ADDS subsystems (`src/contracts/`,
  `src/server/`) and a new top-level `web/`. `scripts/docs-check.ts` hard-fails until each
  `src/<subsystem>` is named in `docs/architecture.md`, so new **§Contracts** and **§Server
  (web BFF)** sections plus a **§Web UI** section (feature-slice map + data-flow + ports +
  token system) are day-one work. Also update the subsystem-registry table, the Mermaid
  module + data-flow diagrams (new web/server/contracts nodes + edges), README (status line
  + slice-status row ✅ Slice 30 + a Web-UI feature paragraph + "Next" line), `docs/ROADMAP.md`
  (flip "TUI / local web UI" → ✅ shipped Slice 30 in the gap table, phase table, and
  recommended sequence; note Slice 34's primary-chat scope folded in), the SDD ledger
  `.superpowers/sdd/progress.md`, and regenerate the docs-snapshot Artifact (new Web-UI /
  Server / Contracts nodes + footer slice & test counts).
- **Telemetry to emit:** a `server.request` span per HTTP request and a `ui.stream` span per
  SSE session (attributes: route, status, duration-ms, bytes/chunks, outcome), plus a
  `voice.transcribe` span reusing the Slice-29 `VOICE_*` semantics for the browser path.
  Server spans nest under / correlate with the existing run trace so a UI-driven run is one
  continuous trace. Degrade events via `recordDegrade` on the ledger.

## Out of scope (explicit)

Multi-device / cross-machine sync (Slice 31 A2A), scheduled/triggered runs from the UI
(Slice 25), the always-on daemon + secure remote tunnel (Slice 24 — the UI is built to be
remote-*reachable* but shipping the tunnel/auth is that slice), TTS voice-*out* beyond what
barge-in needs, and a public/hosted deployment. Slice 30 is single-user localhost.

## Top risks & mitigations

1. **sherpa-onnx browser WASM is build-from-source (Emscripten), not an npm install** — the
   biggest hidden effort. Mitigate with a **day-1 de-risking spike** (build + self-host +
   load a model in-browser) before committing the voice phase; ship a single-threaded WASM
   fallback if COOP/COEP isolation proves troublesome; lazy-load + IndexedDB-cache the
   ~80 MB model blobs.
2. **AI SDK v6-vs-v7 drift** — `ai@latest` is v7; we are pinned to v6. Pin `@ai-sdk/react@^3`
   explicitly and lock versions; verify `useChat` transient data-parts on v6 in the spike.
3. **Bun SSE flushing / idle-timeout** — Bun can batch `ReadableStream` chunks and closes
   idle connections at 10s. Use the async-generator body pattern, call `server.timeout(req,
   0)`, and verify token-level flushing live.
4. **Scope (this is a large slice)** — enforced ordered phases (contracts+shell → chat+rail
   → runs → persistence → voice → palette+polish+docs), each independently reviewable, so
   the slice lands complete without a big-bang merge.
5. **Design/engine coupling creep** — the contract boundary + pure DTO mappers + feature
   isolation are the guardrail; the final review audits that no feature reaches into engine
   internals and no component hardcodes design values.
