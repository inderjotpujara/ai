# Slice 30b — Local web UI — design

**Date:** 2026-07-08
**Branch:** `slice-30b-local-web-ui` (stacks on `slice-30a-production-foundation`)
**Status:** design (brainstorm); revised after a 4-agent capability audit **and** a 6-agent
production-readiness audit; under review before planning
**Depends on:** **Slice 30a (production foundation)** — collision-free run IDs, per-run
telemetry, cancellation (AbortController), signal-clean shutdown + child registry,
concurrency-safe stores, schema migrations, structured logger, config schema, `status`/`start`.
30b is built on that stable base and does **not** re-derive it.

## Context & framing

This is the framework's **first visual surface**. Every shipped slice to date is CLI +
on-disk artifacts (`runs/<id>/spans.jsonl`); there is no web server, no daemon, no frontend
dependency in the repo. Slice 30 adds a **local web UI** served from `localhost` that
becomes the primary way a person drives the framework: chat, run and watch crews/workflows,
build agents, browse run traces, manage models/memory/MCP, and talk to it by voice.

Two framing decisions were locked with the user (2026-07-08):

- **Surface = browser web UI, not a terminal TUI.** The browser is the only surface that
  unlocks the voice story deferred from Slice 29: `getUserMedia({ audio: { echoCancellation:
  true }})` gives native AEC (so barge-in works) plus real `keydown`/`keyup` for hold-to-talk.
- **Scope = go big; fold Slice 34 in.** Slice 30 ships the *complete* product surface, not a
  run-history shell. It absorbs Slice 34's primary chat + **cross-invocation persistence**.

### Two load-bearing realities the audit surfaced (these shape the whole plan)

1. **The engine is batch-only and the chat turn is trapped in `main()`.** Everything runs
   through `generateText` (`src/core/agent.ts:54`); there is **no** `streamText`/`useChat`/SSE
   anywhere. `chat.ts main()` (`:177`) is not exported and re-inlines model-selection wiring
   that already exists as `createSelectionRuntime`. So "AI SDK v6 `useChat` over SSE" is not
   free — it rests on three **bounded, nameable engine seams** (see §Engine seams): extract a
   `runChatSession` entry point, add an optional event sink, and stream the leaf specialist.
   None is an engine rewrite; the signals the UI needs already exist at known hook points.
2. **Every capability has a human-in-the-loop consent that is stdin/TTY-only today.** MCP
   mount + OAuth, provisioning selection + disk-shortfall, verify judge-pull, builder
   confirm/reuse, archive prune, gen-model download + voice-clone, and the mic gesture are
   all `askYesNo`/raw-TTY. The web UI must inject its own implementations, which means the
   transport is **bidirectional** (server→client asks, client→server answers), not
   fire-and-forget. This same channel is what four future slices (24/25/34/38) need.

3. **A localhost server is NOT a trusted boundary — perimeter security is a 30b concern, not
   a Slice-24 deferral.** Slice 24 (remote access) lands *after* 30b, so deferring all auth
   there leaves a window where an unauthenticated localhost server *is* the product. Per 2026
   guidance (0.0.0.0-day, DNS rebinding), any webpage the user visits can `fetch()` a
   localhost API and drive the agent — mount a malicious MCP server, trigger a build, or
   auto-approve a consent prompt through the `/respond` back-channel. So 30b ships
   **locally-authenticated now** (remote-*reachable* still waits for Slice 24). See §Web-
   perimeter threat model.

The engine's *reasoning* stays untouched. Slice 30b is a **new surface that adapts existing
pure, dependency-injected functions** over a typed contract boundary, on top of the Slice-30a
foundation.

## Goal (one sentence)

A polished, maintainable local web app (Blueprint-Mono aesthetic) that surfaces *every*
framework capability — chat, crews, workflows, agent/crew builders, run traces,
models/memory/MCP, and barge-in voice — built so the product can grow in complexity without
the frontend and engine becoming entangled.

## Decisions (locked with user, 2026-07-08)

- **D1 — Surface = local browser web UI.** localhost; single-user now, remote-reachable
  later (Slice 24). Not a TUI.
- **D2 — Scope folds Slice 34's primary-chat + persistence in.** Multi-device sync stays out
  (Slice 31).
- **D3 — Aesthetic = "Blueprint Mono" (Direction A).** Near-black `#0B0C0E` + dot-grid;
  humanist sans for prose + mono for labels/data; single blueprint-blue accent `#4C8DFF`
  reserved for live/interactive; signal teal `#35D0C0`; spring micro-motion; ⌘K palette as
  the spine. Runner-up directions (Brutalist, Editorial Warm) become future **token-swap
  themes**.
- **D4 — Stack (validated vs 2026 sources).** React 19 · Vite 8 (`web/`) · Tailwind v4 +
  shadcn/ui-on-Base-UI · AI SDK **v6** `useChat` over SSE with **transient data-parts** ·
  AI Elements (copy-in) + streamdown for chat · **@xyflow/react** for delegation + workflow
  graphs · custom **@visx** waterfall for run traces. **Pin `@ai-sdk/react@^3`** (v6 major).
- **D5 — Architecture = contract boundary + thin BFF + feature-sliced frontend + ports.**
  `src/contracts/` (isomorphic Zod, imported by server *and* web) is the single source of
  truth; the server returns DTOs mapped from spans, never raw records. Volatile edges behind
  interfaces. **Maintainability + scalability is the governing constraint** (user directive).
- **D6 — Server = a thin transport-agnostic Bun.serve BFF that owns no business logic.**
  Dev: Vite proxies `/api` to Bun. Prod: `vite build` → static assets served by Bun on one
  origin under **COOP/COEP** (for sherpa WASM `SharedArrayBuffer`). Origin/CORS is
  **config-driven** (a remote tunnel changes the origin — Slice 24). The browser is treated
  as *one* client adapter, so a future Slack/Telegram gateway (Slice 34 Hermes) reuses it.
- **D7 — Persistence = `SessionStore` over `bun:sqlite`, behind a port.** Versioned/migratable
  schema, general beyond chat (goals/evals/triggers add as tables). **Reserve an `owner`
  column now** (constant `"local"`) — backfilling ownership later (Slices 24/33) is the most
  expensive retrofit. Swappable to Postgres.
- **D8 — Voice = getUserMedia(AEC) → AudioWorklet → sherpa-onnx WASM + Silero VAD, behind a
  voice port.** True hold-to-talk, barge-in, interim→final. Reuses Slice 29's sherpa
  transcribe *contract* (Float32/16 kHz); a new browser `captureMic` replaces the raw-TTY one.
- **D9 — ⌘K command palette is in-scope** (launch agent/crew/workflow, jump to run, switch
  model, open settings). Blueprint Mono's spine.
- **D10 — Screen designs precede code (user gate).** The full Blueprint-Mono screen set is
  produced as HTML and synced to a **new** claude.ai/design Design System project (via
  `DesignSync`/`/design-sync`) before implementation; React components build against it.
- **D11 — Ships complete, reviewed in ordered increments** (build order below). No new debt.
- **D12 — The UI surfaces ALL capabilities as first-class, not chat-only.** Nav: **Chat ·
  Crews · Workflows · Builders · Runs · Library (Models / Memory / MCP) · Settings**, tied by
  ⌘K. (This corrects the first draft, which omitted crews/workflows/builders/library.)
- **D13 — Engine seams are explicit, bounded pre-req tasks** (see §Engine seams): extract
  `runChatSession`, add optional `events` sink, add optional leaf `streamText`, inject
  web consent ports. No engine rewrite; the existing loop and signals are reused.
- **D14 — Transport is bidirectional + resume-ready.** SSE for server→client streaming with
  **event IDs** (`Last-Event-ID`); a `POST /api/runs/:id/respond` back-channel for
  consent/human-in-the-loop; `RunStream` carries a resume cursor. Enables Slices 24/25/34/38
  with no contract break.
- **D15 — Contracts reserve forward-compat fields now** (all optional, cheap): run
  **lifecycle** state (`queued|running|paused-awaiting-input|done|failed|resumable`) + run
  **origin**; span/message **`degraded`/trust** marker (Slice 37); span **`node`/location**
  (Slices 31/38); `owner` (Slices 24/33). No AI-SDK types leak into the contract (Slice 23).
- **D16 — Depends on Slice 30a.** The engine-lifecycle/concurrency/migration foundation is a
  prerequisite; 30b assumes collision-free run IDs, per-run telemetry, a working
  `AbortController` (for the Stop button), signal-clean shutdown, WAL sqlite, the migration
  runner, the structured logger, and the config schema are already in place.
- **D17 — Perimeter security ships IN 30b** (built with the server): a **per-session bearer
  token** minted at launch (injected into the served HTML, required on every `/api` call); a
  **Host-header allowlist** (`localhost`/`127.0.0.1:PORT`) + cross-origin `Origin` rejection
  on every request (DNS-rebinding/CSRF defense); **inbound Zod validation** of every request
  body before it reaches an engine function; **media-path confinement** (network-supplied
  paths confined to the run/upload dir via `realpath`; the filesystem auto-detect in
  `ingestMedia` is disabled when the caller is the server); the **consent back-channel**
  (`/api/runs/:id/respond`) requires the session token + an unguessable capability `promptId`;
  a **telemetry/record-IO toggle** in Settings (and record-IO defaults **off** for the served
  deployment). Deep hardening (at-rest encryption, tool-exec sandbox, memory RBAC, egress
  policy) stays Slice 35 — but the 30b endpoint auth is what keeps those Slice-35 gaps
  unreachable in the meantime.
- **D18 — Fold ALL 10 conversation must-haves in** (the product basics every peer ships):
  stop-generation, edit+resend, regenerate/retry, copy-message, browser drag-drop +
  paste-image, session rename/delete + **conversation search**, **long-run completion
  notification** (Web Notifications), thumbs up/down feedback (feeds the Slice-31 eval loop),
  real accessibility (keyboard nav + ARIA + `prefers-reduced-motion`), and a functional
  **light theme** (not deferred). Also **delimit untrusted content** (recalled memory, tool
  output, fetched pages, transcripts) in prompts — the builder path already does this;
  extend it to the ingestion paths. SHOULD-haves (branch/fork, slash-commands, @-mentions,
  persona, prompt library, artifacts/canvas, PWA, i18n) are **Tier-2 ROADMAP rows**, not 30b.

## Architecture

Three new areas; the engine is unchanged.

```
~/ai/
├─ src/
│  ├─ contracts/   ← Zod schemas + TS types = the wire protocol (isomorphic, no Node/AI-SDK types).
│  │                 Imported by BOTH server and web. Single source of truth.
│  ├─ server/      ← Thin Bun HTTP/SSE BFF. Adapts engine → HTTP. Pure DTO mappers. No business logic.
│  │   ├─ session/ ← runChatSession extraction + SessionStore (bun:sqlite) + owner scoping
│  │   └─ consent/ ← web implementations of the stdin/TTY consent ports (§Engine seams)
│  └─ (existing engine untouched; small optional seams added — §Engine seams)
└─ web/            ← React 19 + Vite frontend. Feature-sliced.
```

### Data flow

```
browser ──POST /api/chat (task+media)──▶ server.runChatSession ──▶ engine orchestrator (batch)
   ▲  ▲                                     │  │                        │
   │  └── SSE UI-message stream ────────────┘  │ events sink            │ spans → runs/<id>/spans.jsonl
   │      (leaf token deltas + transient          (delegation/model/
   │       data-status + data-confirm)             ledger → SSE)
   └── POST /api/runs/:id/respond ◀── client answers a data-confirm (consent / human-in-loop)
   └── GET /api/runs[/:id][/stream] ──▶ span→DTO mappers ──▶ RunDTO/SpanDTO/DegradeDTO
   └── GET/POST /api/{crews,workflows,agents,models,memory,mcp} ──▶ registries + clean engine fns
   └── voice: getUserMedia(AEC) → AudioWorklet → sherpa WASM → transcript → chat input (local)
```

### Engine seams (bounded pre-req tasks — no rewrite)

1. **Extract `runChatSession({ task, media, events?, confirm?, deps })`** from `chat.ts`
   `main()` — the one genuinely missing abstraction. It re-assembles the existing exported
   pieces (`createSelectionRuntime`, `withMcpRun`, `ingestVoice`/`ingestMedia`,
   `createSuperAgent`, `runChat`) in the current order (provision → warm router → run-scope →
   voice → media → orchestrator → runChat → result). **Both the CLI and the server call it**,
   so behavior can't diverge. Media/voice consent + the gap auto-offer become injected ports.
2. **Optional `events` sink** — a typed `(e: StatusEvent) => void` threaded through the
   already-optional arg chain (`asDelegateTool`/`createOrchestrator` opts, like `ledger`).
   It re-points signals that already exist: the `notify` closure (`select-hook.ts:54`, which
   already computes model/footprint/install/budget), a new `onDelegation(phase, agent)`
   callback that reads the `AsyncLocalStorage` delegation context (depth/ancestors are
   *already assembled* by `withDelegationSpan`), and `ledger.record`. Default sink = today's
   stderr/spans; the server supplies an SSE-writing sink. **No loop change.**
3. **Optional leaf `streamText`** — only the leaf specialist `runAgent` gains an optional
   `streamText` path (guarded by presence of a stream sink; `generateText` stays the default
   so tests/builders are unaffected). The router stays batch (it emits tool-calls, thin
   tokens). `withWallClock` moves to consume the stream to keep the timeout. `textStream`
   forwards up through `runGuardedAgent`'s return.
4. **Web consent ports** — the server injects its own implementations of the existing
   injectable seams: `ProvisionUi` (`askYesNo`/`selectModels`/progress bar), builder
   `confirm`/`confirmReuse`, verify `ensureJudge`, archive `ask`, MCP `ensureConsent` +
   OAuth `openBrowser` (→ in-app redirect), gen `askConsent` + `affirmCloneConsent`, and a
   browser `captureMic`. Each maps to a `data-confirm`/`data-select` SSE event + a
   `POST /api/runs/:id/respond`. **These seams already exist as injected deps** — we only
   supply web-backed implementations.

### Server endpoints

- `POST /api/chat` → SSE UI-message stream: leaf token deltas + **transient `data-*` status
  parts** + `data-confirm` asks. Runs `runChatSession`.
- `POST /api/runs/:id/respond` → resolves a pending consent/human-in-the-loop prompt.
- `GET /api/runs`, `/api/runs/:id`, `/api/runs/:id/stream` (live tail w/ event IDs) →
  `readSpans`/`buildTree`/`summarizeRun` → **DTOs**.
- `GET /api/crews`, `POST /api/crews/:name/run` (SSE) · `GET /api/workflows`,
  `POST /api/workflows/:name/run` (SSE) → `getCrew`/`CREWS`, `getWorkflow`/`WORKFLOWS`,
  `runCrew`/`runFlow`.
- `POST /api/build/agent`, `POST /api/build/crew` (SSE, interactive consent) →
  `buildAgent`/`buildCrewOrWorkflow` + `verifyAndCommit` gate.
- `GET /api/agents` · `GET /api/models` + `POST /api/provision`/`/api/discover` (SSE) ·
  `GET/POST /api/memory` (ingest/recall/stats/reindex) · `GET/POST /api/mcp` (list/status/add
  + OAuth redirect) → the clean DI engine entry points from the inventory.
- Static-serve built `web/` under COOP/COEP; `server.timeout(req, 0)` on SSE handlers.

### Frontend (`web/src/`) — feature-sliced

```
web/src/
├─ app/         shell, layout, routing, providers, ⌘K palette
├─ features/
│  ├─ chat/     streaming chat (AI Elements + streamdown), useChat, error boundary
│  ├─ agents/   live agent/model status rail (transient data-parts)
│  ├─ crews/    browse CREWS · members/roles/process · run + watch · outcome
│  ├─ workflows/ browse WORKFLOWS · step DAG (@xyflow) · run + step-by-step watch
│  ├─ builders/ agent-builder + crew-builder guided flows (replace TTY offers; verify gate)
│  ├─ runs/     run-history browser + @visx waterfall + @xyflow delegation graph
│  ├─ library/  models/provisioning · memory/RAG · MCP mounts (+ OAuth redirect)
│  ├─ voice/    getUserMedia(AEC) → AudioWorklet → sherpa WASM + VAD + orb/waveform
│  └─ sessions/ session list + cross-invocation history (persistence UI)
└─ shared/      design tokens, Base-UI/shadcn primitives, contract client, ports, hooks
```

**Isolation rule:** a feature imports only `shared/` + `src/contracts/`, never another
feature's internals. Growth = a new `features/x/` folder. Each region has its own error
boundary. To keep nav from sprawling, Models/Memory/MCP live under a single **Library** area.

### Ports & adapters

- **Transport** (`shared/transport`) — `ChatTransport`/`RunStream`, **bidirectional +
  resumable** (SSE + `respond` back-channel + resume cursor). Adapter: SSE now; WS/resumable
  later.
- **Voice** (`features/voice`) — `SttEngine`+`AudioCapture`. Adapter: sherpa WASM + AudioWorklet.
- **Persistence** (`src/server/session`) — `SessionStore`. Adapter: `bun:sqlite`.
- **Consent** (`src/server/consent`) — the web-backed implementations of the engine's
  injected consent seams.

### Contract DTOs (`src/contracts/`) — precise, forward-compat

```ts
type RunDTO = {
  id: string; owner: string;                 // owner reserved now (= "local")
  origin: 'manual'|'schedule'|'webhook'|'api'|'remote';   // provenance (Slice 25)
  lifecycle: 'queued'|'running'|'paused-awaiting-input'|'done'|'failed'|'resumable'; // not just terminal
  startMs: number; durationMs: number;
  outcome: string;                           // agent.run.outcome, w/ workflow/crew fallbacks (gap #2)
  models: string[]; contentPolicy?: string;
  tokens?: { input?: number; output?: number };  // run-level roll-up (gap #1; tolerate absence)
  degraded: boolean; degrades: DegradeDTO[]; // Slice 37 taint
  malformedSpans: number; spanCount: number;
  roots: string[]; spans: SpanDTO[];         // flattened; UI rebuilds TREE via parentSpanId (Slice 36)
  artifacts: { name: string; bytes: number; kind: 'answer'|'gap'|'spans'|'degradation'|'other' }[];
};                                            // artifacts via readdir+classify (gap #4)

type SpanDTO = {
  spanId: string; parentSpanId: string|null; name: string;
  offsetMs: number; durationMs: number; depth: number;   // durationMs exact; offset approx (gap #5)
  status: 'ok'|'error'; statusMessage?: string;
  agent?: string;                            // derived from ancestors/target (gap #6)
  delegation?: { target: string; depth: number; ancestors: string[] };
  model?: { id: string; provider?: string; numCtx?: number; footprintBytes?: number; runtimeDegraded?: boolean; /* … */ };
  tokens?: { input?: number; output?: number };
  degraded: boolean;                         // Slice 37; node?: string reserved for Slices 31/38
  attributes: Record<string, unknown>;       // passthrough for domain panels (workflow/crew/memory/mcp/media/voice)
  events: { name: string; offsetMs: number; attributes?: Record<string, unknown> }[];
};

type DegradeDTO = { kind: DegradeKind; label: string; subject: string; reason: string;
                    from?: string; to?: string; attempts?: number; lane?: string; spanId?: string };
// ChatMessageDTO also carries an optional `degraded`/trust marker (Slice 37).
```

Status events are OUR Zod types (`data-run-start`/`-delegation`/`-model-select`/`-model-load`/
`-degrade`/`-confirm`/`-run-end`), never re-exported AI-SDK `UIMessage` types.

### Design-token system

`web/src/shared/design/tokens.css` — Blueprint Mono palette/type/spacing/motion as CSS custom
properties via Tailwind v4 `@theme`. Components reference tokens, never raw hex; themes are
token overrides only. Geist Sans + Geist Mono embedded as `@font-face` data-URIs. A
**functional light theme** ships (D18), not just dark.

### Web-perimeter threat model & required hardening (D17)

The server exposes RCE-adjacent capability (mounting MCP servers, spawning processes,
downloading models, writing+running generated agent code, driving the orchestrator). Treat
localhost as hostile:

| Threat | Defense (in 30b) |
|---|---|
| Any browser page `fetch()`ing our localhost API (0.0.0.0-day / CSRF) | **Host-header allowlist** + cross-origin `Origin` rejection on every request |
| DNS rebinding defeating a random port | Host-header allowlist (not port secrecy) |
| Unauthenticated capability access | **Per-session bearer token** minted at launch, required on all `/api` |
| Malformed/hostile request bodies reaching engine fns | **Inbound Zod validation** before any engine call |
| Arbitrary-file-read via network-supplied media paths | **Path confinement** (realpath ∈ run/upload dir); no fs auto-detect over HTTP |
| CSRF auto-approving a consent prompt | `/respond` requires session token + unguessable capability `promptId` |
| Prompt injection via recalled memory / tool output / fetched pages / transcripts | **Delimit untrusted content** as DATA (reuse the builder's `delimitData` pattern) |
| PII/secrets persisted in `runs/spans.jsonl` and served to the browser | record-IO **off by default** for served mode; Settings toggle; same auth on any DTO carrying prompt bodies |

COOP/COEP (needed for sherpa WASM `SharedArrayBuffer`) is **not** access control — the above
still applies. Deep hardening (encryption-at-rest, VM/seccomp tool sandbox, memory
RBAC/provenance, egress/SSRF allowlist, audit-grade logging) remains **Slice 35**; the 30b
auth is what prevents those gaps from being remotely reachable until then.

## Screens (design set for D10 — synced to claude.ai/design before code)

1. **Workspace** (chat + agent/model rail + trace strip); first-run/empty state.
2. **Chat states** — streaming/shimmer, **Stop button** (mid-stream cancel), tool-call card,
   reasoning, citations, message actions (**copy · edit+resend · regenerate/retry · 👍/👎
   feedback**), **`data-confirm` inline prompt**, error/reconnecting.
3. **Live agent/model panel** — status rail (enter→model-select→load→running→exit), model
   loaded/loading, degraded marker.
4. **Crews** — crew list; crew detail (members/roles/process); run + live watch (delegation
   graph shines here); outcome (done/failed/unverified).
5. **Workflows** — workflow list; step DAG (@xyflow); run + step-by-step execution.
6. **Builders** — agent-builder & crew-builder guided flows (need → proposal → verify gate →
   commit), replacing the CLI TTY offers.
7. **Runs** — run-history list (outcome/duration/models/tokens/lifecycle/origin).
8. **Run detail** — @visx waterfall + @xyflow delegation graph, per-span tokens/model,
   degrade/taint badges.
9. **Library** — Models/provisioning (with download consent + disk-shortfall), Memory/RAG
   (ingest/recall/stats), MCP mounts (list/status/add + mount-consent + OAuth redirect).
10. **Voice active** — hold-to-talk, barge-in, interim→final, waveform.
11. **⌘K command palette**.
12. **Settings** — uncensored toggle (`AGENT_UNCENSORED`), theme switch, verify config, model prefs.
13. **Sessions** — cross-invocation history sidebar (persistence); **rename / delete /
    conversation search**; export (md/json).
14. **Composer** — text + **drag-drop file / paste-image**, attachment chips, voice toggle.
15. **Notifications** — a **long-run-completion** toast/Web-Notification (minute-long local
    runs); permission-request flow.
16. **Accessibility pass** — visible focus, keyboard nav, ARIA on the rail/graph/trace,
    `prefers-reduced-motion` (Blueprint Mono leans on spring motion, so this matters).

## Status events (transient SSE data-parts — all from existing seams)

`data-run-start` · `data-provision` · `data-mcp-mount` · `data-delegation` (agent, depth,
parentAgent, ancestors) · `data-model-select` (agent, model, numCtx, footprint, install,
degraded) · `data-model-load` (pull/evict/warm) · `data-degrade` · **`data-confirm`**
(bidirectional; promptId, kind, question) · leaf token deltas · `data-run-end`. The live
panel's agent/model/phase triple maps directly onto delegation + model-select + model-load.

## Telemetry gaps to close (found by the audit)

1. **Token roll-up not emitted** by `spans.ts` (only AI-SDK `experimental_telemetry` on gen
   spans) → add an explicit run/agent token roll-up (sum child gen spans); mapper tolerates absence.
2. **No uniform run-outcome** on workflow-/crew-only roots → mapper falls back to
   `workflow.outcome`/`crew.*.outcome`; framework sets a uniform root outcome attr.
3. **Degrade↔span correlation missing** → emit a `spanId`/`degrade.id` on both the ledger row
   and the `reliability.degrade` span event so taint badges land on the exact bar.
4. **Ledger/artifact filenames caller-defined** → mapper `readdir`s the run dir and classifies;
   pin canonical names at call sites if the UI needs stable deep-links.
5. **`startUnixNano` lossy** → use exact `durationMs` for bar widths; treat offsets as approximate.
6. **Delegating agent name not a first-class span attr** → derive node labels from
   `ancestors`/`target` (or add the attr).

## Anticipate-now seams for future slices (build room, don't build now)

Ranked by retrofit-cost × dependents (from the forward-compat audit):
1. **`owner` identity** reserved in schema + session/message/run DTOs + server request context
   (Slices 24/33/35). *Most expensive to backfill.*
2. **Bidirectional + resumable transport** — SSE event IDs, `respond` back-channel, resume
   cursor (Slices 24/25/34/38).
3. **Run lifecycle + origin** in the DTO, not just terminal outcome (Slices 24/25/34/38).
4. **Optional `degraded`/trust + `node`/location** fields on span & message DTOs (Slices
   37/31/38) — trivial now, costly to thread through @visx/@xyflow later.
5. **Own the wire schema** — no AI-SDK-v6 types in `src/contracts/` (Slice 23 → v7 = adapter swap).
6. **Transport-agnostic BFF** — browser is one client adapter (Slice 34 Hermes gateway).
7. **Trace DTO on the span tree** via `buildTree`, never flat (Slice 36 CodeAct).
8. **Config-driven origin/CORS** (Slice 24 tunnel).
9. **Extensible SessionStore schema** — goals/evals/triggers as additive tables.

No *new port* beyond transport/voice/persistence/consent is needed for any future slice — the
pressure is on what the **contracts and transport leave room for**.

## Error handling / graceful degrade (never crash)

- **Server:** typed errors; every endpoint degrades gracefully (reuses Slice 21); SSE emits
  typed **error data-parts**, never a silent drop.
- **Frontend:** per-feature error boundaries; connection loss → EventSource auto-reconnect via
  `Last-Event-ID` + a visible "reconnecting" state; voice permission/mic denied → explicit
  inline hint (mirrors Slice 29 TCC hint); WASM/model load failure → degrade to text input.
- Consent prompts that the user dismisses resolve to the fail-safe default (decline), matching
  the engine's off-TTY behavior (gen-model download / clone consent already default-decline).

## Testing

- **Contracts:** Zod round-trip tests (parse ⇄ serialize), incl. the forward-compat optional fields.
- **Engine seams:** `runChatSession` unit test with fake deps (asserts CLI/server parity); the
  `events` sink emits the expected StatusEvents for a scripted delegation; leaf `streamText`
  path vs `generateText` default.
- **Server:** pure span→DTO mapper tests (incl. the 6 gap behaviors); endpoint integration
  tests against Bun.serve with a fake orchestrator; SSE lifecycle (idle-timeout, event IDs,
  error part); consent round-trip (`data-confirm` → `respond`).
- **Frontend:** component tests (Vitest + Testing Library / webapp-testing skill); transport
  port contract test; smoke e2e (drive a run, assert stream + rail + trace render).
- **Voice:** PCM downsample/format math unit tests (WASM mocked); WASM validated in live-verify.
- **Live-verify (gated):** real browser + model + crew run + voice barge-in + trace, end-to-end.

## Standing spec notes (per repo CLAUDE.md)

- **Architecture-doc update note:** adds subsystems `src/contracts/`, `src/server/` (+
  `session/`, `consent/`) and top-level `web/`. `scripts/docs-check.ts` hard-fails until each
  `src/<subsystem>` is in `docs/architecture.md`, so new **§Contracts**, **§Server (web BFF)**,
  **§Web UI** sections (feature map + data-flow + engine seams + ports + token system + DTO
  contract) are day-one. Also: subsystem-registry table; Mermaid module + data-flow diagrams
  (web/server/contracts nodes+edges, the bidirectional respond edge, the events-sink edge);
  README (status line + ✅ Slice 30 row + Web-UI feature paragraph + Next line); ROADMAP (flip
  "TUI / local web UI" → ✅ Slice 30 in gap/phase/sequence tables; note Slice 34 primary-chat
  folded in); SDD ledger `.superpowers/sdd/progress.md`; regenerate the docs-snapshot Artifact
  (new nodes + footer slice/test counts).
- **Telemetry to emit:** `server.request` span per HTTP request (route, status, duration,
  **request principal/owner** so it upgrades to audit-grade for Slice 35) and `ui.stream` span
  per SSE session (chunks/bytes/outcome, resume count); reuse Slice-29 `voice.transcribe` for
  the browser path. Server spans correlate with the run trace so a UI-driven run is one
  continuous trace. New engine seams emit: `events`-sink coverage is observable via the
  existing delegation/model spans (no new engine spans needed beyond the roll-up in gap #1).

## Out of scope (explicit)

The engine-lifecycle/concurrency/migration **foundation → Slice 30a** (prerequisite).
Multi-device / cross-machine sync (Slice 31 A2A); the always-on daemon + secure remote tunnel
(Slice 24 — 30b is remote-*reachable* and locally-authenticated, but the tunnel/remote-auth
ships there); scheduled/triggered runs (Slice 25 — the DTO reserves `origin`, no trigger UI
now); TTS voice-*out* beyond barge-in; a public/hosted deployment. Single-user localhost.

**Tier-2 (registered as new ROADMAP rows, not built here):** model-weight disk GC, `runs/`
retention + index, LanceDB compaction, live-model CI runner, **Artifacts/canvas**,
branch/fork conversations, slash-commands, @-mentions, persona/custom-instructions, prompt
library, responsive/PWA (pairs with Slice 24), i18n. **Deep hardening → Slice 35**;
degradation taint → Slice 37 (fields reserved); Codex cloud → Slice 38.

## Top risks & mitigations

1. **sherpa-onnx browser WASM is build-from-source (Emscripten), not an npm install** — the
   biggest hidden effort. **Day-1 de-risking spike** (build + self-host + in-browser model
   load) before the voice phase; single-threaded fallback if COOP/COEP isolation is
   troublesome; lazy-load + IndexedDB-cache the ~80 MB blobs.
2. **The engine seams (runChatSession extraction + leaf streamText + events sink)** are the
   critical path — a second **day-1 spike** proves the extraction + a token stream reaching the
   browser through `useChat` on AI SDK v6 before committing the chat phase.
3. **AI SDK v6-vs-v7 drift** — pin `@ai-sdk/react@^3`; keep AI-SDK types out of `src/contracts/`.
4. **Bun SSE flushing / idle-timeout** — async-generator body, `server.timeout(req,0)`, verify
   token-level flushing live.
5. **Scope (large slice)** — enforced ordered phases (below), each independently reviewable.
6. **Design/engine coupling creep** — contract boundary + pure mappers + feature isolation are
   the guardrail; the final review audits that no feature reaches engine internals and no
   component hardcodes design values.

## Build order within the slice (ships complete; reviewed in increments)

**Prerequisite: Slice 30a lands first** (foundation + CI pipeline). Then:

0. **Two day-1 spikes** (de-risk): (a) engine seams — extract `runChatSession`, prove leaf
   `streamText` → `useChat` token stream on v6; (b) sherpa WASM build + in-browser load.
1. **Foundations + perimeter security** — `src/contracts/` (DTOs + status events +
   forward-compat fields, **inbound request schemas**) · thin server + static serving +
   COOP/COEP · **session token + Host/Origin allowlist + inbound validation + media-path
   confinement** (D17) · frontend test harness (Vitest/Testing-Library) · design-token system
   (light + dark) · app shell + ⌘K skeleton.
2. **Chat + live rail + product basics** — SSE streaming chat (AI Elements/streamdown) ·
   **Stop / edit / regenerate / copy / feedback** · transient data-parts → agent/model rail ·
   the bidirectional `data-confirm` channel (token-protected) · composer drag-drop/paste ·
   untrusted-content delimiting. SSE-lifecycle + contract tests here.
3. **Runs** — run-history browser · @visx waterfall · @xyflow delegation graph · telemetry-gap
   closures (token roll-up, correlation id, uniform outcome).
4. **Crews + Workflows** — browse/run/watch both; the workflow step DAG.
5. **Builders + Library** — agent/crew builder flows (verify gate) · Models/Memory/MCP
   (incl. mount consent + OAuth redirect + provisioning selection).
6. **Persistence + product** — `SessionStore` (owner + `parentMessageId` reserved) ·
   cross-invocation history · **wire memory recall into chat** · Sessions UI (rename/delete/
   **search**/export) · **long-run completion notifications**.
7. **Voice** — AudioWorklet + sherpa WASM + VAD + barge-in.
8. **Polish + docs + live-verify** — motion, **a11y (keyboard/ARIA/reduced-motion)**, ⌘K
   completeness, all-4-docs + Artifact, ledger, live-verify (real browser + model + crew +
   voice barge-in + trace + Stop + notification).
