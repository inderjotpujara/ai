# Local Agents

A **local-first, multi-agent framework** for Apple Silicon. Build and run AI
agents against **local models** (no API keys), orchestrated by a super-agent,
on your own machine — today on a laptop, soon full-throttle on a dedicated Mac
Mini.

> **Where this is going:** a local-first, self-owned **n8n × CrewAI** — an
> agent-workflow platform where you compose role-based agents + tools into
> workflows, trigger them, watch them run, and let the system extend itself with
> new agents on demand. Slices 1–7 built the hardware-aware **engine**; the
> product line is now underway — Phase A's run-viewer (Slice 8) and Phase B's
> composition guardrails (Slice 9), workflow/DAG engine (Slice 10), crews &
> roles (Slice 11), memory/RAG (Slice 12), grounded verification (Slice 13),
> first-boot model provisioning (Slice 14), a declarative MCP mount
> registry + starter pack (Slice 15), an MCP telemetry-ordering fix +
> consent robustness hardening (Slice 16), Phase D's **agent-builder**
> (Slice 17) — describe a capability gap, review a proposal, and the system
> writes a new specialist — a **debt wrap-up + MLX completion** slice
> (Slice 18), a **crew/workflow builder** (Slice 19) — describe a
> *multi-step* need and the system composes existing **and** freshly-built
> agents into a reviewed crew or workflow — and the **verified "works out of
> the box"** pass (Slice 20) — every generated artifact is reuse-checked,
> staged, execution-dry-run, and golden-evaled before it may commit — have
> landed, **completing Phase D (self-extension)**, **graceful degradation
> + retries** (Slice 21) fills Phase A's last **reliability** gap — a dead
> MCP server, model, or tool no longer sinks a run; it degrades and tells the
> user — **alternate runtimes + remote-auth completion** (Slice 26)
> raises **LM Studio and llama.cpp to full inference runtimes** alongside
> Ollama and MLX (a shared managed-runtime base with per-runtime
> relaunch/reload/fixed context handling) and completes **live remote MCP
> OAuth** (DCR, browser handshake, on-disk token persistence) plus a
> verified **GitHub-PAT** remote server — and **full multimodal I/O +
> uncensored** (Slice 27, Phase F, pulled in on demand) adds vision/audio/video
> **input** (describe an image, transcribe speech, sample+describe video
> frames — all media-by-reference, never raw bytes through the router),
> text→image/speech/video **generation** (a new `media_creator` specialist),
> and a default-**on** uncensored content-policy axis (model eligibility +
> safety-checker disable). Vision/STT/frames/image-gen/speech-gen/uncensored
> are all live-verified on real hardware; **video generation's dependency
> conflict is resolved** (an isolated venv via `bun run setup:media`) **and
> its CLI arg-correctness is live-verified** against the real `mlx-video`
> CLI — a full render is disk-bound on the dev Mac (LTX-2 is a 19B model,
> not enough free disk here), the framework's hardware-adaptive
> scales-on-a-bigger-box case, not a code gap. (Phase A's one
> remaining open item is the routing-accuracy eval harness.) Then **Slice 29
> (re-scoped 2026-07-07)** shipped voice **input** via `sherpa-onnx` (CLI):
> tap-to-toggle mic capture or `--voice-in <file>`, transcribed and spliced
> into the prompt exactly like `--audio`. Its original "voice in/out +
> streaming CLI" scope was built and **reset** (a hand-rolled terminal voice
> pipeline that fought the OS; archived on branch
> `slice-29-voice-streaming-cli`) — rich interruptible voice now lives in
> **Slice 30b** (local web UI), on browser-native echo cancellation. A
> 2026-07-08 production-readiness audit found the whole engine assumed *one
> run / one process / exits when done* — a blocker for a long-lived
> concurrent web host — so the web UI split into **Slice 30a** (concurrency &
> lifecycle core + ops surface: per-run telemetry routing, cooperative
> cancellation, signal-clean shutdown, concurrency-safe stores, structured
> logging/config/status/usage/error-boundary, first CI pipeline — **shipped**)
> and **Slice 30b** (the local web UI itself, stacking on 30a — a multi-phase
> slice). **Slice 30b Phase 1 — the web backend foundation — has landed**:
> an isomorphic Zod wire protocol (`src/contracts/`) and a thin `Bun.serve`
> BFF (`src/server/`) with the localhost security perimeter (per-session
> bearer token, port-scoped Host/Origin allowlist, realpath media-path
> confinement), `/api/health`, COOP/COEP static serving, and `bun run web`.
> **Phase 1b (the browser frontend scaffold) then landed** — a
> Vite 8 + React 19 SPA (Bun workspace `web/`) with the app shell, TanStack
> Router across the 7 nav areas, a ⌘K palette skeleton, light+dark design
> tokens, and the contract-client + transport-port interface — but it did
> not yet stream, chat, or persist. **Phase 2 — streaming chat + the live
> rail — has now landed**: the browser sends a real chat turn to
> `POST /api/chat` and watches the top-level orchestrator's answer stream
> token-by-token over SSE (specialists still run batch; a status-event sink
> narrates their delegation on a live agent/model rail), plus the
> conversation basics — Stop, copy, per-message regenerate, edit+resend,
> 👍/👎 feedback, an inline human-in-the-loop consent prompt, and
> drag-drop/paste-image upload (media-by-reference, confined server-side).
> Chat is still **stateless per request** — cross-invocation persistence is
> Phase 6. **Phase 3 — Runs history + live trace waterfall — has now
> landed too**: `GET /api/runs` (searchable/faceted/paginated list),
> `GET /api/runs/:id` (full `RunDTO`), and `GET /api/runs/:id/stream`
> (live-tailing SSE) are backed by a new `src/run/run-dto.ts` mapper that
> projects a run's `spans.jsonl`/`degradation.jsonl`/artifacts into
> schema-validated DTOs, and the web ships a real Runs list plus a
> run-detail view whose `@visx` waterfall live-tails a running trace over
> the Phase-1b transport port's resumable `stream(runId, cursor, schema)`
> surface — Phase 3 is its **first real consumer** (Phase 2's chat already
> calls the port's `respond()` leg; Phase 3 is the first to parse a
> `SpanDTO` off the wire). **Phase 4 — Crews & Workflows browse/run/watch —
> has now landed too**: browse both registries, launch a crew or workflow
> run from the browser, and watch its step/task graph light up live on a
> new `@xyflow/react` `DagView` — reusing Phase 3's run-detail/stream/
> waterfall **verbatim** for the "watch" half (a crew/workflow run was
> already a first-class run root). Cross-invocation persistence
> and browser voice remain Phases 6–8. **Phase 5 — Builders + Library — has
> now landed too**: the last two stub nav areas are real — a guided
> agent/crew/workflow build wizard with live narration and mid-flow consent,
> and a 3-tab Library (Models — inventory + live-progress pull; MCP —
> browse/status, add-server, test-mount with real consent + OAuth, closing
> the D10 gap; Memory — spaces/stats, upload→ingest, recall search). Browser
> voice lands next (Phase 7, below); polish/a11y remains Phase 8. **Phase 6 — Persistence + product — has now
> landed too**: chat survives a reload (client-minted session id, idempotent
> upsert, persist-at-start/persist-at-completion); recall reads a dedicated
> `chat` memory space and every completed turn auto-ingests itself back in;
> a real Sessions history (list/detail/rename/delete/Markdown export)
> replaces the placeholder nav area; and client-side long-run completion
> notifications (toast + optional OS `Notification`) close the loop on "did
> my crew/workflow run finish." **Phase 7 — Browser voice input — has now
> landed too**: a mic button in the Composer offers real hold-to-talk
> (`pointerdown`/`up` + `keydown`/`up`) and tap-to-toggle (VAD-gated
> auto-stop) dictation, transcribed client-side via transformers.js +
> Moonshine + Silero VAD (overriding the parent design's sherpa-onnx-WASM
> assumption, D1) — the transcript lands in the same composer text box a
> typed message would, then the user still presses Send. **Phase 8 —
> Polish + a11y + observability — has now landed too**, and it is the
> **30b finale**: WCAG 2.1 AA accessibility (focus-visible ring, real
> labels, `aria-pressed`/`aria-label` coverage, keyboard-navigable tabs,
> `prefers-reduced-motion`, an automated `vitest-axe` regression net),
> progressive-decode interim transcription + an anti-alias downsample
> filter, a completed ⌘K palette, a fix so a long chat turn no longer
> misfires a completion notification (`chat.run` vs `agent.run`), and the
> first client→server telemetry beacon (`voice.transcribe.web`). **Slice
> 30b is now COMPLETE — the capability flips 🟡→✅** (all 8 phases landed).
> Barge-in/interruptible voice and TTS voice-out remain explicit **future
> scope**, not debt. **Slice 23 (AI SDK v7 upgrade)** then shipped — `ai`
> 6→7, `typescript` 5→6, and the `@ai-sdk/react`/`mcp`/`openai-compatible`
> majors, unblocked once `ollama-ai-provider-v2@4` spoke provider-spec v4
> (clearing the 2026-07-05 `num_ctx` hold, live-verified against real
> Ollama). **Slice 24 (always-on daemon + task queue + resumable jobs +
> secure remote access) has since shipped** — the foreground BFF is now a
> long-lived daemon with a durable SQLite job queue at its heart: an HTTP
> call **enqueues** a job and the run outlives its request, jobs survive
> restart, long crew/workflow runs resume at DAG-node granularity, and the
> daemon is reachable from anywhere via a pluggable tunnel (Tailscale
> default) behind durable per-device auth. **Slice 25b (Jobs & Triggers Ops
> Console) has since shipped** — a web management surface for all of that:
> daemon/queue health, job cancel/resume/retry, and device pairing/revoke +
> break-glass root rotate. **Slice 25 (scheduled + triggered agents) has
> since shipped too** — a durable poll-tick scheduler converging
> cron/webhook/file-watch/job-chain sources onto this same queue, with the
> console's Triggers tab now fully live. **Slice 31 (multi-machine + A2A
> interop) has since shipped, closing Phase E** — a hand-rolled A2A v1.0
> layer over the same daemon/queue lets this orchestrator both **expose**
> registered agents/crews/workflows to a remote peer (least-privilege
> allowlist, a separate A2A Bearer, JSON-RPC onto the existing job queue)
> and **discover + hash-pin + consume** a remote peer's skills, driven from
> a new Ops-console Federation tab. See
> [`docs/ROADMAP.md`](docs/ROADMAP.md).

> **Status:** Slice 30b **Phases 1 (web backend foundation), 1b (frontend
> scaffold), 2 (streaming chat + live rail), 3 (Runs history + live
> trace waterfall), 4 (Crews & Workflows browse/run/watch), 5
> (Builders + Library), 6 (Persistence + product), 7 (Browser voice
> input), and 8 (Polish + a11y + observability) have all landed** — this
> is now a **full-slice landing**: the Slice-30b capability line item is
> flipped to **✅ shipped**. **Slice 23 (AI SDK v6→v7 upgrade) has since
> shipped too** — the engine now runs on `ai@7`/provider-spec v4
> (`ollama-ai-provider-v2@4`, `typescript@6`), which unblocked and led into
> **Slice 24 (always-on daemon + task queue + resumable jobs + secure remote
> access) — now also ✅ shipped**: a durable SQLite job queue + bounded
> worker pool detach every run from its request, a portable daemon core
> (PID + `SIGTERM` drain + boot-recovery) with a launchd recipe and an
> `agent daemon` CLI hosts it, a durable root token mints per-device session
> tokens for secure remote access over a pluggable tunnel, and long
> crew/workflow jobs resume from a per-node checkpoint; see the slice table
> below. **Slice 25b (Jobs & Triggers Ops Console) — now also ✅ shipped**:
> a web `/ops` console gives that daemon/queue/auth backend a real operator
> surface — health cards, job cancel/resume/retry with a lineage-preserving
> retry, a redacted daemon-logs tail, and a Devices & Access tab (the
> daemon's first *positive* device registry, pairing with a QR, revoke, and
> a break-glass root rotate) gated by a new trusted-local-only privileged-
> write check. **Slice 25 (scheduled + triggered agents) — now also ✅
> shipped**: a durable poll-tick scheduler (`src/triggers/`) living in the
> daemon converges four sources — cron (Croner v10, atomic due-row claim,
> fire-once-on-boot misfire catch-up), webhook (`POST /hooks/:token`, the
> only unauthenticated route class — token-hash + HMAC + replay window +
> rate limit), file-watch (chokidar v4, path-confined), and job-chain (a
> pool completion observer, depth-capped cycle guard) — onto the same
> Slice-24 queue through one `fire.ts` convergence point, threading
> `RunOrigin` provenance so the runs `?origin=` facet lights up for trigger
> fires; both a repo-TS-defs authoring surface and full console/API CRUD
> ship, and the console's previously-stubbed Triggers tab is now a live
> list + create dialog + firings drawer, plus a new `agent triggers` CLI.
> **Slice 31 (multi-machine + A2A interop) — now also ✅ shipped, closing
> Phase E**: a hand-rolled **A2A v1.0** layer (JSON-RPC over HTTP+SSE) over
> the Slice-24 daemon/queue. **Expose:** `GET
> /.well-known/agent-card.json` (public, outside the `/api` guard, `404`
> fail-safe while `AGENT_A2A_ENABLED` is off) advertises skills 1:1 from a
> least-privilege allowlist (`src/a2a/allowlist.ts` — only registered
> Chat/Crew/Workflow refs); `POST /api/a2a` verifies a SEPARATE A2A-Bearer
> credential (D5) **before parsing the body**, then a replay guard, then
> maps the (untrusted-fenced) inbound task onto the SAME `JobStore.enqueue`
> (`origin=Remote`); streaming methods re-frame the existing run-stream SSE
> engine — no parallel stream. **Consume:** `src/a2a/client.ts`
> discovers + hash-pins a remote card (SSRF-guarded, timeout+size-capped,
> a hash mismatch is a hard reject, never a silent re-pin) and
> `src/a2a/mount.ts` shapes a `delegate_to_<name>` `ToolSet` matching the
> MCP mount's failure-returns-not-throws contract — **honestly not yet
> spliced into a live chat/crew/workflow session's tool set** this slice;
> today's shipped Consume surface is discover→pin→persist plus manual
> invocation via `agent a2a call` or the Federation tab's recent-remote-
> tasks history. A new Ops-console **Federation tab** (Expose + Consume
> panels) and `agent a2a skills|token|remotes|call|card` CLI. An
> adversarial review caught + fixed three real defects (a non-exposable
> `JobKind` could slip the allowlist; a terminal SSE frame could arrive
> before a same-poll child's progress frame; the consume-side delegate
> loop originally returned `message/send`'s `submitted` shell as the
> answer). See [`docs/architecture.md`](docs/architecture.md)
> §"`src/a2a/` — A2A interop".
> **Phase 2**
> turns the Phase-1b Chat area live: the browser sends a real turn to
> `POST /api/chat` and the **top-level orchestrator streams its answer
> token-by-token** over an AI-SDK v6 UI-message-stream SSE response
> (specialists stay on the existing batch `generateText` path — a new
> `EventSink` threaded through delegation narrates their progress instead,
> since v6's `useChat` can't nest a second live stream inside a tool call).
> New engine seams are additive and optional (`src/core/events.ts`'s
> `EventSink`; `core/agent.ts`'s `StreamSink`/`streamText` path, draining
> `consumeStream()` **inside** `withWallClock` so the wall-clock timeout
> still bounds a streaming generation — a trap caught before it shipped);
> `src/cli/run-chat-session.ts` extracts the shared "run one chat turn" body
> both the CLI and the server now call. **Server** (`src/server/`) adds
> `POST /api/chat` (the SSE handler, over a **lazily built** engine — nothing
> warms at server boot), `POST /api/runs/:id/respond` (a bidirectional
> human-in-the-loop consent channel keyed by an unguessable `randomBytes(32)`
> promptId), `POST /api/upload` (a confined image upload — server-minted
> filename, mediaType allowlist, 20 MB cap, `confineToDir` on write **and**
> read), and `POST /api/feedback` (a `chat.feedback` span, the Slice-31 eval
> seam). **Security finding fixed in-slice (D17):** wiring uploads first
> reactivated `ingestMedia`'s prompt-text filesystem auto-detect on the
> server path (task text is attacker-controlled over HTTP) — now explicitly
> disabled server-side (`ingestDeps:{exists:()=>false}`), CLI unaffected.
> **Web** (`web/`) ships a real streaming `features/chat/` (`@ai-sdk/react`'s
> `useChat` + `DefaultChatTransport`, hand-authored AI-Elements/`streamdown`
> rendering) with the conversation basics — **Stop**, copy, per-message
> **regenerate**, **edit+resend**, 👍/👎 **feedback**, an inline
> **data-confirm** prompt, and **drag-drop/paste-image** upload
> (media-by-reference) — plus `features/agents/`'s live agent/model **rail**
> (`useStatusEvents` folding transient `data-*` parts into
> `{agent, model, phase, degraded}`). Chat is still **stateless per
> request** — no `SessionStore` until Phase 6. **Explicitly not yet shipped
> (Phases 4–8):** the crews/workflows/builders/library feature screens,
> cross-invocation persistence, and the browser voice surface.
> See [`docs/architecture.md`](docs/architecture.md) §Contracts, §Server,
> §"Web frontend", §"Streaming chat".
>
> **Phase 3 — Runs history + live trace waterfall — has now landed**:
> three new `GET` endpoints (`src/server/runs/{list,detail,stream}.ts`,
> wired into `app.ts` behind the existing perimeter) — `GET /api/runs`
> (zod-parsed search/outcome/degraded query, cache-fronted, opaque
> cursor pagination), `GET /api/runs/:id` (full `RunDTO`), and
> `GET /api/runs/:id/stream` (live-tailing SSE) — with `confineToDir`
> guarding the `:id` segment on **both** detail and stream (a
> path-escaping id and a missing run both 404 identically, no filesystem
> leak) and a new `runsRoot` dependency on `ServerDeps`. A new engine-side
> mapper, `src/run/run-dto.ts`, projects a run's `spans.jsonl` +
> `degradation.jsonl` + on-disk artifacts (`src/run/artifacts.ts`'s
> `readRunArtifacts`, classified into an extended `ArtifactKind`) into a
> schema-validated `RunDTO` (`mapRunToDto`) or a list-cheap
> `RunListItemDTO` (`summarizeRunListItem`, fronted by an in-process cache
> keyed on `spans.jsonl`'s mtime — a real persisted run index is Phase 6);
> both share one `runRootSummary` helper that derives lifecycle/duration/
> outcome from the recognized `agent.run`/`crew.run`/`workflow.run` root,
> so a finished crew or workflow run no longer misreports as perpetually
> `Running` the way a naive `agent.run`-only check would. `withRunStreamSpan`
> (mirrors `withUiStreamSpan`) wraps the stream handler in a `runs.stream`
> span. **Web:** `features/runs/` ships a real, searchable/faceted
> (outcome/degraded)/cursor-paginated Runs list and a run-detail view that
> fetches the `RunDTO` snapshot, seeds a pure `foldSpan` reducer, then
> live-tails new spans over the Phase-1b resumable transport port's
> **first real consumer** (`createSseTransport().stream(runId, cursor,
> SpanDtoSchema, signal)`); `waterfall.tsx` renders the span tree as an
> `@visx` Gantt chart (offset/duration-scaled bars, error/degraded/normal
> color precedence, a click-to-inspect span-detail panel) — per decision
> D1, a waterfall only, no `@xyflow` node-graph this phase. `SpanDTO.node`,
> `RunDTO.origin` (still constant `manual`), and `server.principal` (still
> constant `local`) remain reserved for later slices. Full suite:
> 1274 pass/36 skip/0 fail\* (root, 1310 tests) + 83 pass (web, Vitest/happy-dom).
> \*One rerun surfaced the documented pre-existing `verification.live`
> grounding-judge flake (real-Ollama nondeterminism, unrelated to Runs);
> an isolated rerun of `tests/verification` was clean.
> See [`docs/architecture.md`](docs/architecture.md) §Contracts, §Server,
> §"Runs".
>
> **Phase 4 — Crews & Workflows browse/run/watch — has now landed too**:
> the Crews and Workflows nav areas are real. Two new browse endpoint pairs
> (`src/server/crews/`, `src/server/workflows/`) project the in-memory
> `CREWS`/`WORKFLOWS` registries — via new pure mappers `crew-dto.ts`/
> `workflow-dto.ts` — to JSON-safe list/detail DTOs (workflow edges derived
> via `effectiveDeps` **verbatim**, the same function the engine uses, so
> the browser's graph can never disagree with what actually runs). Launching
> a run is **fire-and-watch**: `POST /api/crews/:name/run` /
> `POST /api/workflows/:id/run` validates the body, mints a `runId`,
> **pre-creates** the run directory, starts the run **detached** via
> `launch-turns.ts` (the exact same `withMcpRun`+live-selection+
> `runCrewCli`/`runFlow` path `bun run crew`/`bun run flow` use), and returns
> `{runId}` immediately — any throw in the detached run is caught and
> persisted to `error.json`, never an unhandled rejection (adversarially
> verified by two parallel Opus reviewers over the concurrency contract).
> The browser then opens the **same** `GET /api/runs/:id/stream` Phase 3
> already ships — **no new stream code at all** — and overlays live
> per-step status on a new generic `@xyflow/react` `DagView`
> (`web/src/shared/dag/`, deterministic layered layout, no `dagre`) fed by
> `workflowGraph`/`crewGraph`; the latter is **process-aware** (D7a): a
> sequential crew renders a task-dependency DAG, a hierarchical crew — which
> has no static task graph, only runtime delegation — renders a
> manager→members delegation star instead. A **kind facet** on the Runs
> list (backed by a new `RunKind` derived from each run's root span name)
> makes a launched crew/workflow run findable alongside chat/agent runs.
> Two honest, documented limitations: a hierarchical crew's delegation star
> renders but never lights up (it emits no per-step spans to overlay); and
> the graph is only reliably drawable once the run's root span closes
> (write-on-end span export, the same underlying mechanism as Phase 3's
> in-flight-nested-run caveat) — worked around for the **primary**
> launch→watch flow via a URL-param handoff (the def id rides
> `?graphKind=&graphId=` from the Run button, so the graph is visible from
> `t=0`), leaving only a cold-open (opened from the Runs list) still
> waiting on it. Full suite: 1328 pass/37 skip/0 fail (root) + 118 pass
> (web, Vitest/happy-dom). See [`docs/architecture.md`](docs/architecture.md)
> §Contracts, §Server, §"Crews & Workflows".
>
> **Phase 5 — Builders + Library — has now landed too**: the last two stub
> nav areas (Builders, Library) are real. **Builders:** a new
> `POST /api/builders/build` SSE route streams the guided-build wizard
> (agent, crew, or workflow) — narration text-deltas, a mid-flow
> **`data-confirm`** consent/reuse-offer ask answered over the same
> `POST /api/runs/:id/respond` channel Phase 2 built, and a one-shot
> terminal `data-build-result` (`BuildResultDTO`) — wrapping the pre-existing
> `agent.build`/`crew.build` spans (§18/§19) with **no new span kind**, just
> a third trigger alongside the CLI and the chat gap-offer. Adversarially
> verified by two parallel Opus reviewers (concurrency/streaming +
> wire-contract/handler/security), both "SOUND, could not refute." **Models:**
> `GET /api/models` (provider-agnostic installed+pullable inventory) and
> `POST /api/models/pull` (fire-and-watch, same launch contract as Phase 4)
> — the genuinely new mechanism is the **pull→spans bridge**: each download
> progress tick becomes its own short-lived `model.pull.progress` **child
> span**, so the download's live progress reaches the browser over the
> **existing** `GET /api/runs/:id/stream` with **zero new stream code**
> (also adversarially verified, 2 Opus lenses, both "SOUND"). **MCP:**
> `GET /api/mcp` (addressable mount-status snapshot), `POST /api/mcp/add`
> (atomic config write), and `POST /api/mcp/test-mount` (SSE) — the last one
> closes **decision D10**: it is the `ConsentRegistry`'s **first real
> caller**, so a never-before-approved MCP server can now get real
> interactive consent (+ OAuth loopback) from the browser instead of
> silently skipping. `src/mcp/mount.ts` itself has zero diff — the CLI path
> is completely unaffected. **Memory:** `GET /api/memory/spaces`,
> `POST /api/memory/:space/recall`, and `POST /api/memory/:space/ingest`
> (upload-then-ingest via the shared `uploadImage` helper + server-side
> `confineToDir` — fork-3, no client filesystem path ever reaches the
> store) give the memory layer its **first web consumer**; `memory.recall`'s
> span was already wired (§11) — this phase just gives it a run to land in.
> **Web:** a real `features/builders/` (mode toggle + streamed narration +
> proposal `DagView` preview, gated on a real schema-`safeParse` discriminant)
> and a real 3-tab `features/library/` (Models/MCP/Memory), all reusing the
> **same** `postSseStream`/flat-frame wire contract and `RegionErrorBoundary`
> pattern established in Phases 2–4 — no new transport anywhere this phase.
> Honest caveats, not silently dropped: media-gen model management stays
> read-only-at-most (a parallel Slice-28 catalog, out of scope here); no ANN
> index; recall is a standalone search surface, not yet wired into chat's
> answer path; MCP entries can be added and tested but not yet edited or
> removed from the browser. Full suite: 1429 pass/36 skip/0 fail (root) +
> 150 pass, 39 files (web, Vitest/happy-dom). See
> [`docs/architecture.md`](docs/architecture.md) §Contracts, §Server,
> §"Builders + Library".
>
> **Phase 6 — Persistence + product — has now landed too**: chat survives a
> reload. **Sessions:** a new `src/session/` `SessionStore` (`bun:sqlite`,
> the identical WAL/`busy_timeout`/`foreign_keys` pragma trio + `db/migrate.ts`
> runner the memory store already uses) persists a **client-minted**
> `sessionId` (v4-UUID-regex-validated at the same `ChatRequestSchema.parse()`
> call `handleChat` already makes; the server never mints one itself) via
> idempotent `INSERT OR IGNORE` — a retried POST is a safe no-op.
> `POST /api/chat` upserts the session and appends the user message
> **before** any engine work, and appends the assistant message only
> **after** `runChatTurn` resolves (turn-boundary persistence — the "visible
> gap never partial" contract was adversarially verified by two parallel
> Opus reviewers). `GET/PATCH/DELETE /api/sessions(/:id)` +
> `GET /api/sessions/:id/export` give the browser a real **Sessions**
> history: a searchable, cursor-paginated list (mirroring Runs' opaque
> cursor), detail/rehydrate-on-reload, rename, delete, and a Markdown export
> fetched with the bearer token rather than linked (a bare `<a href>` would
> 401 through the existing perimeter). **Recall + auto-ingest:**
> `runChatSession` gains one optional `memoryStore` dependency shared by CLI
> and server alike — recall now reads a dedicated `chat` memory space
> (space-wide, no namespace, so a session remembers across itself) via the
> pre-existing `injectRecall`, and every completed turn writes itself back
> in via a new `MemoryStore.rememberOnce` (content-hash-deduped, so a
> retried/duplicate turn never double-ingests), fired **after** the SSE
> stream ends — the browser never waits on it. **Notifications:** a
> client-side `AppShell` hook polls the existing `GET /api/runs` on an
> interval and diffs each run's lifecycle (baseline-then-diff, so
> already-terminal runs never fire on mount); a qualifying
> `Running→Done/Failed` transition above a minimum duration fires a toast
> plus an optional, permission-gated OS `Notification` — no new server
> endpoint, no event bus (adversarially verified, 2 Opus lenses). **Honest
> caveats, not silently dropped:** `parentMessageId` is written to the
> `messages` table but not consumed for threading — regenerate/edit+resend
> stay linear this phase, reserved for Slice 41; there is no JSON export
> (Markdown only); there is no server-push/global SSE event bus; there is no
> session retention/GC; and the CLI gets the recall **READ** benefit only —
> no CLI-side session persistence; and long chat turns are classified
> `kind=agent`, so a chat exceeding the notification duration threshold can
> still fire a completion toast — the notification's Chat-kind exclusion
> doesn't cover chat-originated agent runs (a documented limitation, to
> refine in a follow-on). Full suite: 1549 pass/36 skip/0 fail
> (root) + 204 pass, 48 files (web, Vitest/happy-dom). See
> [`docs/architecture.md`](docs/architecture.md) §Contracts, §Server,
> §"Persistence — Sessions + chat recall".
>
> **Previously:** Slice 30a — **concurrency & lifecycle core + ops
> surface**, the production foundation the local web UI (Slice 30b) needs
> before it can host multiple concurrent runs in one long-lived process.
> **Concurrency/lifecycle:** collision-free run ids; a per-run telemetry
> **router** (`telemetry/run-router.ts`) replacing the old process-global
> OTel provider so concurrent runs' spans no longer corrupt each other;
> cooperative cancellation (`withWallClock` now actually aborts the work it
> races; an `AbortSignal` threads the whole `runChat`→`generateText` chain;
> Slice 30b Phase 2 wired the first live trigger — the web UI's **Stop**
> button, via `useChat.stop()` aborting the underlying fetch);
> a central child-process registry + `SIGINT`/`SIGTERM` shutdown so Ctrl-C no
> longer orphans model servers/ffmpeg; sqlite `WAL`+`busy_timeout`; a
> model-manager **admission mutex** (closes a concurrent-load race,
> empirically verified); `db/migrate.ts` schema migrations + a memory
> embedder-mismatch guard (throws instead of silently serving a stale
> embedder). **Ops surface:** a structured run-id-stamped logger; a
> documented `AGENT_*` config schema (`bun run config`); `bun run status`;
> app versioning (`0.2.0`, `--version`, `bun run start`); a top-level error
> boundary (`error.json` persistence); a usage rollup (`bun run usage`); and
> the framework's **first CI pipeline** (`.github/workflows/ci.yml`). Full
> suite 1108 pass/36 skip/0 fail. See
> [`docs/architecture.md`](docs/architecture.md) §§4, 7, 11, 21.

> **Previously:** Slice 29 — **CLI voice input (STT)**: `src/voice/`
> adds tap-to-toggle mic capture (`--voice`) and file transcription
> (`--voice-in <path>`) via `sherpa-onnx` (moonshine-tiny model,
> `bun run setup:voice`), spliced into the prompt exactly like `--audio`'s
> text-splice (§22). Transcription runs behind an execution seam —
> **in-process** `sherpa-onnx-node` (default, confirmed to load under Bun by
> a day-1 spike) or a **node-subprocess** worker (`AGENT_VOICE_EXEC=subprocess`)
> — chosen for reuse: the same recognizer family ships a browser-WASM build,
> so Slice 30b's web UI can transcribe without a second STT stack. Mic
> auto-stop uses ffmpeg `silencedetect` (not a real-time VAD model — a
> deliberate, disclosed refinement from the original re-scope, kept
> model-free and execution-seam-independent). Degrade-never-crash throughout:
> a missing model/addon, a failed capture, or silence all degrade to a
> warning (+ ledger entry) rather than crashing the turn. Voice-out,
> barge-in, and true hold-to-talk stay out of scope — Slice 30b's browser UI
> got real `getUserMedia` AEC and hold-to-talk (Phase 7), but shipped
> **dictation-only**: rich, interruptible barge-in voice + TTS voice-out
> remain explicit **future scope**, reconciled in Phase 8. See
> [`docs/architecture.md`](docs/architecture.md) §23.

> **Before that:** Slice 28 — **Hardware-adaptive media generation +
> reachable gen degrade**: generation models are now auto-prescribed by a
> parallel gen-fit selector (`generate/select.ts` — largest-that-fits from a
> per-modality candidate ladder against the live hardware budget, env-pin
> authoritative, consent-gated pull, graceful no-fit degrade), and
> `createGenerateTools` runs via `runGenJob` so the one-shot↔server degrade +
> ComfyUI/Wan lane are reachable. Live-verified: image auto-fit → real FLUX
> PNG, speech auto-fit → real Kokoro WAV, video degrades gracefully (no fitting
> model cached on the dev box — auto-renders once one is). Built on **Slice 27
> — Full multimodal I/O + uncensored** (Phase F): a `src/media/`
> subsystem, built on one design principle throughout: **media-by-reference,
> not media-by-value** — a run-scoped `MediaStore` mints a short opaque handle
> (`img_1`/`aud_1`/`vid_1`) for every piece of media, and only a
> `[img:h]`/`[audio:h]`/`[video:h]` marker travels through the router and the
> delegation boundary (`z.string()` untouched); the specialist that actually
> needs the bytes resolves the handle at the last moment, right before the
> model call. **Input (analysis):** `--image`/`--audio`/`--video` CLI flags
> (repeatable) + prompt-embedded path auto-detection + macOS `--paste`, each
> degrading independently (a bad path is skipped + warned, never aborts the
> turn); audio is transcribed immediately via `mlx-whisper` and spliced into
> the prompt as text; video is frame-sampled via `ffmpeg` into a handle-group;
> images and video frames resolve to AI-SDK v6 `FilePart`s (base64, per a
> live-verify finding that Ollama's `images[]` rejects a raw `Uint8Array`) for
> the new **`vision`** specialist (`qwen2.5vl:7b`, selected through the
> existing hardware-fit selector like any other capability). **Generation:**
> a `MediaGenerator` job adapter (`ExecMode.OneShot|Server`, cancel-race-safe,
> wall-clock-timeout-guarded) backs three default engines — **mflux** (image,
> via an ungated FLUX-schnell mirror since the obvious default is
> HuggingFace-gated), **Kokoro/mlx-audio** (speech), **LTX/mlx-video**
> (video) — exposed as `generate_image`/`generate_speech`/`generate_video`
> tools on a new **`media_creator`** specialist; a ComfyUI/Wan server-lane
> strategy exists but is shape-only (ComfyUI isn't installed). **Uncensored**
> is a cross-cutting axis, shipped **default-ON**: two orthogonal mechanisms —
> a model-eligibility predicate (an agent/env can still opt out) and a
> Diffusers/ComfyUI-lane safety-checker disable (a no-op on the filter-free
> mflux/mlx-audio/mlx-video engines) — plus `content_policy` telemetry on
> every run and a fail-safe voice-clone consent gate (orthogonal, for
> cloning-capable TTS models only). New `Capability.ImageGen/SpeechGen/VideoGen`
> type the taxonomy for future selector-routed generation (not yet consumed —
> generation is currently routed structurally by media kind, not the
> selector). New `INPUT_MODALITY`/`CONTENT_POLICY` telemetry attrs +
> `media.transcribe`/`media.frames`/`media.generate` spans. **Live-verified on
> this Mac:** vision (real `qwen2.5vl`), STT (real `mlx-whisper`), video
> frame-sampling (real `ffmpeg`), image generation (real `mflux`, a
> controller-viewed PNG), speech generation (real Kokoro — `misaki[en]` is
> auto-installed by `bun run setup:media`), and uncensored (pulled and ran a
> real abliterated model). **Video *generation*:** the earlier `mlx-video`
> ↔ `transformers` dependency conflict is **resolved** via an isolated video
> venv (`bun run setup:media`, `transformers==5.5.0` pinned after the
> `mlx-video` install), and the strategy's **CLI arg-correctness is
> live-verified** against the real `mlx_video.ltx_2.generate` CLI (caught +
> fixed a real bug — `-n` → `--num-frames`, plus a required `--pipeline`,
> `AGENT_VIDEO_PIPELINE`-overridable). A **full render is disk-bound on the
> dev Mac** (LTX-2 is a 19B model, ~100 GB full repo, vs. ~90 GB free here) —
> the framework's hardware-adaptive "scales on a higher-disk box" case, not a
> code defect; the code (`ltxStrategy`, the tool, the server-lane degrade
> path) is complete, unit-tested, reviewed, and now CLI-verified. See
> [`docs/architecture.md`](docs/architecture.md) §22.

> **Previously:** Slice 26 — **Alternate runtimes + remote-auth completion**
> (debt slice, gated on installing those runtimes / having creds — landed out
> of sequence per that gate). Stood up **LM Studio and llama.cpp as full
> inference runtimes** alongside Ollama and MLX via a shared managed-runtime
> base (`createManagedRuntime(strategy)`, spawn/health-poll/kill-on-timeout,
> per-runtime relaunch/reload/fixed context handling) and completed **live
> remote MCP OAuth** (DCR, browser handshake, on-disk token persistence) plus
> a verified **GitHub-PAT** remote server; live-verified on this Mac across
> all three managed runtimes, both download adapters, GitHub-PAT, and a full
> Linear OAuth handshake. See [`docs/architecture.md`](docs/architecture.md)
> §5 / §14.

> Also previously: Slice 21 — **Graceful degradation + retries** (fills
> Phase A's last reliability gap; the routing-accuracy eval harness remains
> open). One canonical `src/reliability/` layer — a three-lane
> error taxonomy (`Lane.Transient/RouteWorthy/Terminal`), retry with
> full-jitter backoff + `Retry-After` respect, run/idle timeouts, a
> hand-rolled circuit breaker (shared registry keyed by dependency id), a
> failure-domain-aware model-degradation chain, and a user-facing
> `DegradationLedger` — is now wired into delegation, the workflow engine,
> crews, MCP tool calls, and the model selector: a dead dependency **drops
> that agent/step and tells the user** (printed summary + persisted
> `run.dir/degradation.jsonl` + `reliability.*` telemetry) instead of
> silently failing or sinking the run. The pre-existing provisioning
> stall/retry guards and the verified-build wall-clock primitive were
> migrated onto the same layer, closing 8 places that used to duplicate
> retry/timeout logic. Per D5 (AI SDK v6 already retries LLM-call transport
> errors), the LLM turn itself is never double-retried — only cross-boundary
> operations the framework owns (MCP calls, downloads, runtime probes) get
> `withRetry`. **Live-verified on real Ollama** (4 scenarios,
> `tests/integration/reliability-live.test.ts`, `RELIABILITY_LIVE=1`): an
> unreachable MLX runtime degrades to a real Ollama fallback model that
> actually generates, a Tool step that fails once then succeeds is retried to
> completion, a delegated agent whose model call fails returns a structured
> error without crashing the run, and a real `withMcpRun` persists
> `degradation.jsonl` + a `reliability.degrade` span event. See
> [`docs/architecture.md`](docs/architecture.md) §21. Also shipped: Slice 20
> (**Verified "works out of the box"**, Phase D — closes the phase — every
> agent-builder/crew-builder write becomes stage→verify→commit: a
> pre-generation reuse check against a per-registry manifest, an execution
> dry-run against a benign representative task with a bounded self-repair
> loop, a golden-eval judged by the largest installed model, and usage
> aggregation + a reversible archive flow), Slice 19 (**Crew/workflow
> builder**, Phase D — a multi-step need becomes a
> reviewed crew or workflow via a staged declarative-IR pipeline, a two-tier
> structural+semantic gate, consent-gated auto-build of missing member
> agents, and a deterministic transpiler; live-verified end to end — a
> generated crew was written *and executed* to a correct result), Slice 18
> (**Debt wrap-up + MLX completion** — the download/inference enum split,
> `hf-fetch` real disk persistence, the MLX runtime raised to Ollama's bar
> and live-verified both ways, provisioning polish, and MCP/agent-builder
> debt), Slice 17 (**Agent-builder**, Phase D — describe a need, review a
> proposal, and the system writes a reviewed specialist, live on the next
> run), Slice 16 (MCP telemetry-ordering fix
> + consent robustness — `mcp.mount` now lands in `runs/<id>/spans.jsonl`,
> consent judged on stdin **and** stderr TTY), Slice 15 (`mcp.json` mount
> registry + starter pack, `src/mcp/`, 12-entry curated pack, consent-gated +
> tool-definition-pinned mounting), Slice 14 (first-boot provisioning +
> runtime-agnostic downloader, Ollama live-verified; LM Studio/llama.cpp/MLX
> contract-tested at the time, live-verify completed in Slice 26), Slice 8
> (OTel run-viewer, `bun run
> runs`), Slice 9 (composition guardrails — delegation depth limit +
> return-size cap), Slice 10 (workflow/DAG engine, `bun run flow <name>`),
> Slice 11 (crews & roles, `bun run crew <name>`), Slice 12 (memory/RAG,
> `bun run memory ingest|recall|stats|reindex`), and Slice 13 (grounded
> verification, `--verify`). See [Roadmap](#roadmap).

---

## What it does (today)

```sh
# Ask a question about a local file. The agent reads the file via a tool and answers.
bun run src/cli/chat.ts "What animal is mentioned in /tmp/sample.txt?"
```

Under the hood, one CLI run autonomously:

1. **Checks the memory budget** — computes the live budget
   (`min(75% × Metal cap, 80% × available RAM)`, recomputed each delegation),
   estimates the model's footprint, and confirms it fits.
2. **Ensures the model is present** — pulls the chosen specialist model (e.g.
   `qwen3.5:9b`) if it isn't installed (no hardcoded download step you have to run).
3. **Warms the model** into memory.
4. **Runs the agent loop** — the model calls a `read_file` tool (exposed over
   **MCP**) and composes an answer.
5. **Records the run** — writes the answer and an append-only journal to
   `runs/<id>/`.
6. **Unloads the model** to free memory.

No manual steps. No API keys. Everything runs locally.

**Dynamic model selection (Slice 5).** Specialists declare a *capability requirement* (`requires: [tools]`, `prefer: largest-that-fits`) rather than a fixed model. At each delegation the selector picks the largest registry model that fits the **live** memory budget (degrading 9b→4b under pressure), prints a one-line notice (size · context · footprint · installed/pulling · budget), and the Model Manager loads it. If nothing fits, the run ends with an honest `resource` message and a non-zero exit instead of a hallucinated answer. The registry is a machine-adaptive bootstrap ladder populated at runtime by Slice 6 discovery.

**Model discovery (Slice 6).** `bun run discover` fetches the latest tool-capable GGUF (and MLX, when a local MLX server is running) models from Hugging Face (trusted publishers, sized to your live RAM budget), writes a per-machine `model-images/catalog.json`, and pre-pulls the top fitting model. Normal `chat` runs read an **offline** merge of the bootstrap rungs + locally-installed models + the cached catalog — no network needed. A local MLX server (LM Studio / vllm-mlx at `MLX_BASE_URL`) is discovered + used automatically when running. Vision/audio/video and an uncensored mode are typed-in seams shipped in later slices.

**KV-cache quantization (Slice 7).** Start with `bun run serve` (sets `OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE`, default `q8_0` — flash attention is *required* and not auto-enabled on Apple Silicon). KV cache type is **global** (Ollama limitation), but the manager sizes context **per-model from each model's live architecture** (`/api/show`), so q8_0 yields ~2× context (near-lossless on tolerant architectures) and a generalized advisory warns when an *arch-risky* model (small head_dim / MoE) runs under a quantized cache. Override with `AGENT_KV_CACHE_TYPE=f16|q8_0|q4_0`.

**Run-viewer / OpenTelemetry telemetry (Slice 8).** Every run is instrumented as an **OpenTelemetry trace** — root, delegation, and model-lifecycle spans written to `runs/<id>/spans.jsonl`. `bun run runs` lists recent runs, `bun run runs <id>` renders the trace as a terminal timeline, and `bun run runs <id> --follow` tails it live. The exporter is swappable: point `AGENT_OTLP_ENDPOINT` at any OTLP-compatible backend (Jaeger, Tempo, Phoenix, Honeycomb) to get the same signal there with no re-instrumentation. The underlying `src/telemetry/` layer is the shared seam every later subsystem (guardrails, workflows) emits spans into.

**Composition guardrails (Slice 9).** Prerequisites for safe multi-agent depth, enforced via an `AsyncLocalStorage`-based delegation context: a **depth limit** (default 5, guarantees termination, override `AGENT_MAX_DELEGATION_DEPTH`; recursion within the limit is allowed) and a **live return-size cap** (¼ × the calling model's `num_ctx`, override `AGENT_RETURN_CTX_FRACTION`) so a sub-agent can't blow the caller's context budget. Violations surface as soft errors plus an `agent.guardrail.violation` span event rather than a hard crash.

**Workflow / DAG engine (Slice 10).** A second, deterministic orchestration mode alongside the LLM router: `defineWorkflow({id, steps})` builds a code-first, typed, JSON-serializable DAG out of `agent` / `tool` / `branch` / `map` (bounded fan-out) steps, with Zod-validated structured I/O flowing between them. Execution is fail-fast by default, with a per-step `onError: 'continue' | {fallback}` escape hatch. Run one with `bun run flow <name>`; workflows live in the `workflows/` registry and are executed by `runWorkflow()`. Agent steps reuse the Slice 9 guardrails via a shared `runGuardedAgent`, and the engine emits `workflow.run` / `workflow.step` spans into the same telemetry layer. See [`docs/architecture.md`](docs/architecture.md) §9.

**Crews & roles (Slice 11).** A CrewAI-style role/task/process layer composed on top of the existing workflow engine and orchestrator — not a new engine. `defineCrew({id, members, tasks, process})` is validated at construction (unique names/ids, member/dependency resolution, acyclic task graph). **Members** are `{role, goal, backstory, requires, prefer, tools?}` — role/goal/backstory compose into the system prompt, and the model is resolved live by the selector (largest-that-fits), same as any other agent. **Tasks** are `{description, expectedOutput, member, dependsOn?, output?}` with optional Zod-typed output; `dependsOn` forms context edges between tasks. Two **processes**: `sequential` compiles the crew to a Slice-10 workflow DAG and runs it on the existing engine, and `hierarchical` reuses the orchestrator with an auto manager (model defaults to the router). Crew runs reuse the Slice 9 guardrails via `runGuardedAgent` and emit `crew.run` / `crew.step` (`crew.task.member`) telemetry. Run one with `bun run crew <name> [input...]`; crews live in the `crews/` registry (ships a `research-crew` example: researcher → writer, sequential). Live model selection — largest-that-fits, computed at run time — is now wired into both the `flow` and `crew` CLIs via a shared `src/cli/select-runtime.ts`. See [`docs/architecture.md`](docs/architecture.md) §10.

**Memory / RAG (Slice 12).** A persistent semantic memory layer, `src/memory/`, composed on top of the Model Manager (weights-only embedder loading), the guardrails delegation context (injection budget), and telemetry — not a new resource mechanism. A two-tier store: **LanceDB** (embedded vector DB, one table per named *space*) + **`bun:sqlite`** (a space registry that's the authority for that space's embedder+dimension, and a `(space, source)`-scoped document ingestion manifest so re-ingesting an unchanged file is a no-op). Default embedder `qwen3-embedding:0.6b`. Retrieval is **dense vector search today** (an FTS index is created opportunistically but hybrid BM25+dense fusion isn't wired up yet) → an **optional cross-encoder rerank, on by default** (`transformers.js`/ONNX, `Xenova/bge-reranker-base` — the viability spike passed on Apple Silicon; disable with `AGENT_MEMORY_RERANK=0`; a reranker failure degrades gracefully to the pre-rerank order rather than crashing) → a live budget-fit pack sized off the caller's `num_ctx`. Results are citation-tagged (`[mem:<id>]`) and recall abstains explicitly (`"No supporting memory found."`) rather than fabricating — the two anti-hallucination primitives that Slice 13's verification layer builds on. Drive it directly with `bun run memory ingest|recall|stats|reindex`, or opt a crew/workflow into a bound `recall` tool + auto-persisted task/step output via an optional `memory` dependency. See [`docs/architecture.md`](docs/architecture.md) §11.

**Grounded verification (Slice 13).** An anti-hallucination layer, `src/verification/`, built directly on Slice 12's citation tags and abstention primitive — not a new engine. `verify()` decomposes an answer into atomic claims, fetches **exactly the memory chunks each claim cites** (`getByIds`), and checks every claim against its own cited evidence with **`bespoke-minicheck`** — a small model fine-tuned for `(document, claim) → supported?` fact-checking, distinct from the general/router model that still handles decomposition and retrieval grading. The judge model is **consent-pulled** on first use (prompted interactively, or `AGENT_VERIFY_AUTO_PULL=1`/`0` to force); if it's unavailable, verification falls back to the general model rather than hard-failing. A **bounded Corrective RAG** step (grades retrieval and, if weak, rewrites the query and re-answers; re-retrieval happens when a `recall` dependency is wired — the current `--verify` CLI path re-answers without fresh retrieval, a documented follow-up) runs once by default before the final gate; if the answer still isn't faithful (`faithfulness < 0.9` by default), the system **abstains** — `{kind:'unverified'}` — instead of presenting an unsupported draft. It's opt-in and additive: flag a task/crew/workflow `verify: true`, or pass `--verify` to `bun run crew <name>`/`bun run flow <name>`, and the compiler splices a verify→branch→corrective→abstain sub-graph after the answering step (`StepKind.Verify`); everything else compiles unchanged. An abstention writes `runs/<id>/unverified.txt` and exits non-zero. Designed for the **terminal** answering step of a run — a documented limitation, not yet per-mid-step. The eval gate is an **in-repo golden set** (~20 cases), no external framework. See [`docs/architecture.md`](docs/architecture.md) §12.

**First-boot provisioning (Slice 14).** A first-boot / on-demand model provisioning layer, `src/provisioning/`, that gets weights onto disk without manual `ollama pull`s — it does not replace the Model Manager; provisioning just makes sure the bytes are present for `ensureReady` to pick up on the next normal run. `bun run provision` runs the flow: detect the host → discover fitting models (a dynamic per-runtime catalog query, degrading per-source to a committed `snapshot.json` on a throw or empty result) → `fitAndRank` by hardware fit → **per-model consent** (recommended pre-selected, nothing downloads without an explicit yes) → a disk-space preflight + stall/retry supervisor guards (`checkDiskSpace`, `withRetry`, `StallWatchdog`) → sequential downloads through a runtime-agnostic `DownloadProvider` with one live progress bar, each model's failure caught individually so one bad pull never aborts the rest. Adapters exist behind that interface: **Ollama is live-verified end-to-end** (a real pull to 100%, idempotent re-provision); **the shared HuggingFace fetcher (llama.cpp GGUF + MLX snapshot) is now download-complete and live-verified** (Slice 18 — atomic disk-write + HF-LFS-oid verify, real MLX-snapshot pull); **LM Studio's download adapter is wired into `providerFor` (under its own `ProviderKind.LmStudio` since the Slice 18 enum split) and live-verified in Slice 26** (`ALTRUNTIME_LIVE=1`; the live pass fixed its download poll-URL). Degrade-never-crash applies per catalog source and per model. A non-invasive, TTY-gated `chat.ts` auto-detect hook offers the same flow when a declared model is missing, and the run emits an `agent.model.provision` telemetry span (candidate/selected/byte counts, downloaded/failed outcome). See [`docs/architecture.md`](docs/architecture.md) §13.

**MCP mount registry & starter pack (Slice 15).** Slice 3's two hardcoded mounts (`createFileTools`/`createFetchTools`) are replaced by a **declarative registry**, `src/mcp/`: a committed `mcp.json` (the standard `mcpServers` shape, plus a per-server `agents` field for scoping) is read by `loadMcpConfig()` (per-entry degrade — a bad entry warns and is skipped, one needing an unset env var goes `dormant`) and mounted by `mountAll()`. Every mount is **consent-gated** — a TTY prompt shows the exact command/URL before it runs (or `AGENT_MCP_AUTO_APPROVE=1` for headless/CI), and its tool definitions are **hashed and pinned** so a server that changes its tools after approval (a "rug-pull") gets caught and re-prompted rather than silently trusted. A **12-entry curated starter pack** — `bun run mcp list|status|add <name>` — covers files (`file-tools`, `filesystem`), SQL (`sqlite`, SELECT-gated `query` + `execute`), memory, sequential-thinking, web-fetch, git, time, browser (Playwright), GitHub, and web-search (Brave/Exa); key-gated entries stay dormant until their env var is set. A live eval (`tests/mcp/eval-scoping.test.ts`) checks that a `file_qa`-scoped agent reliably picks `read_file` over a merged toolset's distractors. See [`docs/architecture.md`](docs/architecture.md) §14.

**MCP telemetry-ordering fix + consent robustness (Slice 16).** Slice 15 wired an `mcp.mount` span around every mount pass, but each CLI's `main()` mounted **before** creating the run dir/telemetry provider, so the span was recorded against the OTel no-op default and never reached `runs/<id>/spans.jsonl`. A new `src/cli/with-mcp-run.ts` fixes this by owning the whole per-run CLI scope in one place — `createRun` → `initRunTelemetry(run.dir)` → `withMcpMountSpan(mountAll(...))` → the run body → `finally { registry.close(); telemetry.shutdown() }` — so `mcp.mount` now lands alongside every other span. The mount span also gains a `mcp.server.count` attribute and a corrected `mcp.tool.count` (now the sum of mounted servers' tool counts, not a raw record count). Separately, interactive consent prompting now requires **both** stdin and stderr to be TTYs (`interactiveTTY()`) — judging on stderr alone let a piped-in run (`bun run flow ... < /dev/null`) hang on an already-ended stdin — and `stdinInput()` resolves `''` on stream `end` instead of leaving the read promise pending. See [`docs/architecture.md`](docs/architecture.md) §14.

**Agent-builder (Slice 17, Phase D).** The first self-extension slice: `src/agent-builder/` turns *"describe a need"* into a working specialist. `generateProposal` drafts a snake_case name/description/system-prompt/rationale from the need (inserted as `<need>…</need>` **delimited data**, never instructions, to blunt prompt injection); `suggestServers` picks the minimal MCP-server subset from the Slice 15 `STARTER_PACK` — **palette-only**, anything the model invents is dropped; `validateProposal` is a pure structural gate (unique snake_case name, non-empty fields, palette-only + correctly-scoped servers) that runs **before** consent is ever asked; `writeAgent` then atomically renders `agents/<name>.ts`, inserts one import + registry line into a new `agents/index.ts` **registry** (`AGENTS: Record<name, AgentFactory>` + `agentNames()` — `super.ts`/`chat.ts`/`flow.ts` now build their agent set from it instead of hardcoding factories) at marker comments, and scopes any suggested servers into `mcp.json` (deep-cloning pack entries so it never mutates the shared `STARTER_PACK`). `buildAgent` sequences generate→suggest→validate→consent→write under a new `agent.build` telemetry span (`agent.build.need`/`.outcome`/`.agent_name`/`.server_count`). Two triggers: `bun run agent-builder "<need>" [--yes]`, and a TTY-gated offer when `chat.ts` hits a `{kind:'gap'}` outcome (that outcome and its `agent.gap.missing_capability` attribute are unchanged — the offer is a purely additive branch). Safety model: **review-before-activate** (consent is mandatory, no bypass in the chat path), **palette-only tools**, **no same-run activation** (a written agent is live on the *next* run), and — through Slice 17 — no tool-code generation and no OAuth (both revisited in Slice 18). See [`docs/architecture.md`](docs/architecture.md) §18.

**Debt wrap-up + MLX completion (Slice 18).** A single slice discharging the dischargeable-now deferred debt logged through Slice 17, centered on MLX. **Enum split:** `src/core/types.ts` now carries a download `ProviderKind` (`Ollama`/`HfGguf`/`HfSnapshot`/`LmStudio`) separate from an inference `RuntimeKind` (`Ollama`/`MlxServer`/`LmStudio`), bridged by `src/core/kind-map.ts` (`downloadKindFor`/`runtimeKindFor`); `ModelDeclaration` carries `runtime`, a provisioning `Candidate` carries both. **HF-fetch real disk download:** `src/provisioning/providers/hf-fetch.ts` now persists bytes — atomic `.part`→rename for a single-file GGUF and whole-tree enumeration for an MLX snapshot, HF-LFS-`oid` verify-when-present else compute-and-record, a `safeJoin` traversal guard, write-stream-error→`ProviderError`, and `withRetry`+`StallWatchdog` parity with Ollama. **MLX runtime:** `createMlxServerRuntime` fills the OpenAI-compatible control surface (`getModelMax`/`listLoaded`/best-effort `pull`, honest `undefined`/no-ops elsewhere); MLX is selected **opt-in** via a declaration's `runtime` and **degrades to Ollama** (using `fallbackModel`) when the server is unreachable, emitting `model.runtime.selected`/`.degraded`. **Provisioning polish:** TTY-gated bounded-parallel downloads (`DOWNLOAD_CONCURRENCY=2`) with a `MultiProgressBar`, truthful `provision.snapshot_fallback`/`.runtime`/`.deferred_verify` telemetry, a `bytesPerWeight` 0.56→0.6 bump + an injectable Metal reader (`AGENT_METAL_WORKING_SET_BYTES`), and a manual `scripts/refresh-snapshot.ts`. **MCP + agent-builder debt:** `mcp.transport` telemetry, an engine-enforced read-only sqlite gate (`PRAGMA query_only`, which also allows `WITH…SELECT` CTEs), an atomic `addPackEntry`, `warnUnknownAgents` in chat, MCP OAuth `authProvider` (contract-tested), an agent-builder same-run bounded retry, and a consent-gated tool-code path that writes an **inert `<name>.proposal.ts`** (no same-run activation). **Live-verified both ways** — real `mlx_lm.server` inference and a real HF-snapshot download, plus an Ollama regression pass. (LM Studio / llama.cpp as full *inference* runtimes and the live OAuth handshake — listed as deferred here — both **shipped in Slice 26**; the TS-SDK-v2 / AI-SDK-v7 migration — held as Slice 23 — has since **shipped too** (2026-07-19).) See [`docs/architecture.md`](docs/architecture.md) §5/§13/§14/§18.

**Crew/workflow builder (Slice 19, Phase D).** Self-extension one level up from Slice 17: `src/crew-builder/` turns a plain-language **multi-step** need into a working **crew** (CrewAI-style role/goal/task team, `sequential` or `hierarchical`) or **workflow** (a raw DAG covering all 4 directly-planned `StepKind`s — agent/tool/branch/map; `Verify` is reachable only via a step's `verify` flag), composing **existing and freshly-built** agents. Generation is staged, not one-shot: `classify` (crew vs workflow) → `analyze` (**think-first**, prose-only) → `plan-nodes` → `plan-edges` assemble a declarative, JSON-safe **IR** (`CrewIR`/`WorkflowIR`, Zod-validated) — never a `CrewDef`/`WorkflowDef` directly, since those carry live closures and aren't serializable. Step inputs, branch predicates, and map sources are expressed as a small **safe-helper vocabulary** (`fromInput`/`fromStep`/`fromTemplate`/`whenEquals`/`whenContains`/`whenTruthy`/`mapOver`) — the only closures a model can pick from, never invent. A **two-tier validation gate** (`validate.ts`) checks structure first (refs resolve, tools are palette-only, the graph is acyclic via a shared `assertAcyclic` now extracted into `workflow/define.ts`) and only then asks an LLM judge whether the graph actually accomplishes the need. After consent, `resolve-members.ts` **auto-builds any genuinely-missing member agents** by delegating to the Slice-17 agent-builder (its own per-agent consent), reconciling any renamed refs; a deterministic, model-free `transpile.ts` then renders the IR to real `crews/<id>.ts`/`workflows/<id>.ts` TS (every string `JSON.stringify`'d), and `write.ts` writes it + a registry entry atomically. `CrewMember` gained an optional `agentRef` (`src/crew/types.ts`) so a crew member can reuse a registered — or just-built — agent, resolved by `crewAgentMap` (`src/crew/engine.ts`). Two triggers: `bun run crew-builder "<need>" [--yes]`, and a TTY-gated `chat.ts` offer (`shouldOfferCrew`'s multi-step heuristic, tried before the existing single-agent offer). Safety model mirrors the agent-builder: review-before-activate, palette-only tools, per-agent auto-build consent, no same-run activation. **Live-verified end to end on Ollama** — a generated crew was written and then actually **executed** (`runCrew`) to a correct result, the first live run of this pipeline, which surfaced and fixed 4 real defects (a nested-schema key-hint gap in the shared `BuilderModel` seam, under-specified IR prompt constraints, a regeneration loop that didn't catch a throw, and a tool-name/`ToolSet` type mismatch). `crew.build` telemetry span. See [`docs/architecture.md`](docs/architecture.md) §19.

**Verified "works out of the box" (Slice 20, Phase D — closes the phase).** Generation used to be write-then-return: a proposal/IR passed structural (and, since Slice 19, semantic-judge) validation and landed in the registry without ever being run. `src/verified-build/` turns every agent-builder/crew-builder write into **stage → verify → commit** through one shared, cheapest-first gate (`verifyAndCommit`). Before anything is generated, a **reuse check** distills the need into a capability signature, embeds it, and cosine-compares it against a per-registry **manifest sidecar** (`<registry>/.generated.json` — which now persists each generated artifact's original need, signature+vector, verified level, golden path, and usage counters): **≥0.85 → ask to reuse** the existing artifact (accept → nothing is generated; decline → generate), **0.75–0.85 → offer** the close match and ask reuse-or-build, **<0.75 → generate**; the non-interactive `--yes` policy auto-reuses a Reuse hit but declines an Offer hit. After consent, the artifact is **staged** (a def file on disk, never the registry index), re-checked structurally, then **actually executed** against a benign read-only representative task (`dry-run.ts` — every run is `withWallClock`-raced; the agent path additionally aborts in flight via a new `runAgent` `abortSignal` seam, while crew/workflow runs are wall-clock-raced only since `runCrew`/`runWorkflow` take no signal yet), with a bounded **self-repair loop** (≤2 attempts, the real runtime error fed back into a fresh regeneration — the agent-builder re-drafts with the error as retry feedback, the crew-builder re-plans with it appended — keeping the consented name/id). A **golden-eval** then auto-decomposes the need into 3–7 binary cases and judges each artifact output with the **largest installed model (~26–30b), preferring a different family than the generator** (falling back to same-family/largest); each case requires a unanimous yes over 3 judge runs, with grounded-kind cases routed through the verification layer's `checkClaim`; if no installed model clears the ~24B-parameter judge bar, the behavioral eval is **skipped and the commit is marked `verified: runs`** — degrade, never block, never an unconsented pull. Only a passing (or explicitly `--force`d/`verify.force`d, marked `unverified` with a WARNING) gate reaches **commit**: the registry-index splice, a `<name>.golden.json`, and the manifest upsert; a failed gate registers nothing and the staged file is discarded. On top of the manifest: **usage aggregation** derived from every run's `spans.jsonl` (no new bookkeeping) and a **reversible archive** flow — `bun run archive [--prune]` reports (and, per-candidate consent, archives to `<registry>/archive/`) artifacts that are idle *and* have a more-used near-duplicate — plus an informational reuse hint on chat's gap offers. `build.verify` / `build.archive` telemetry spans. See [`docs/architecture.md`](docs/architecture.md) §20.

**Alternate runtimes + remote-auth completion (Slice 26).** Declaring `runtime: RuntimeKind.LlamaCpp` or `RuntimeKind.LmStudio` on a model now runs real inference, not just a download: `src/runtime/managed-openai-compatible.ts`'s `createManagedRuntime(strategy)` is the shared implementation behind both, plus a rewritten `mlx-server.ts`. llama.cpp **relaunches** `llama-server -c <numCtx>` to change context (or `-hf <org/repo>` when the model looks like an HF repo id rather than a local path); LM Studio **reloads** the model via `@lmstudio/sdk`'s `client.llm.load(model,{config:{contextLength}})` against its always-on daemon; MLX's context is **fixed** (`mlx_lm.server` has no context flag) — a requested window is honestly never applied rather than silently ignored. All three are spawn/health-polled/kill-on-timeout-supervised by `process-supervisor.ts` (a fresh free port every relaunch) and circuit-breaker-wrapped per runtime kind. `select-hook.ts` now calls `rt.control.warm(model, numCtx)` for every non-Ollama runtime so a resolved context actually reaches the process. Separately, MCP OAuth is now **live**, not contract-tested-only: `src/mcp/oauth-provider.ts`'s `createOAuthProvider` is a real `@ai-sdk/mcp` `OAuthClientProvider` (Dynamic Client Registration, PKCE, a CSRF `state` nonce, a browser-loopback redirect capture, and authorization-server metadata persistence), backed by a `token-store.ts` atomic **0600** on-disk store; `with-mcp-run.ts` now actually constructs one per `auth.kind: oauth` config entry (previously always empty, so OAuth silently degraded every time), and `mcp/client.ts`'s `mountMcpServer` completes the handshake the first time a server is used. Live-verified on real hardware: llama.cpp, LM Studio, and MLX all serving inference; a GitHub-PAT remote server; and a full Linear OAuth handshake (DCR → browser → token exchange → 47 tools, with silent token-reuse on a second run). See [`docs/architecture.md`](docs/architecture.md) §5 / §14.

**Full multimodal I/O + uncensored (Slice 27).** `src/media/` adds vision/audio/video **input** and text→image/speech/video **generation**, all **media-by-reference**: a run-scoped `MediaStore` mints a short handle (`img_1`/`aud_1`/`vid_1`) for every piece of media, and only a `[img:h]`/`[audio:h]`/`[video:h]` marker travels through the router and the delegation boundary — the specialist that needs the bytes resolves the handle at the last moment. **Input:** `bun run src/cli/chat.ts "..." --image path.png` (also `--audio`/`--video`, repeatable, plus prompt-embedded path auto-detection and macOS `--paste`); audio is transcribed via `mlx-whisper` and spliced into the prompt as text, video is frame-sampled via `ffmpeg` into a handle-group, and images/frames resolve to real AI-SDK v6 attachments for the new **`vision`** specialist (`qwen2.5vl:7b`). **Generation:** a new **`media_creator`** specialist calls `generate_image`/`generate_speech`/`generate_video` tools backed by mflux (image), Kokoro/mlx-audio (speech), and LTX/mlx-video (video) — each a subprocess behind a shared `MediaGenerator` job adapter (`ExecMode.OneShot|Server`, cancel-safe, wall-clock-timeout-guarded). **Uncensored is a default-ON, cross-cutting axis** (`AGENT_UNCENSORED=0` to opt out): a model-eligibility predicate plus a Diffusers/ComfyUI-lane safety-checker disable (a no-op on the filter-free default engines), with `content_policy` telemetry on every run and a fail-safe voice-clone consent gate. **Live-verified on real hardware:** vision, STT, video frame-sampling, image generation (real `mflux` PNG), speech generation (real Kokoro wav), and uncensored (a real abliterated model, pulled and run). **Video *generation*:** the `mlx-video` ↔ `transformers` dependency conflict is **resolved** via an isolated video venv (`bun run setup:media`, `transformers==5.5.0` pinned), and the strategy's **CLI arg-correctness is live-verified** against the real `mlx_video.ltx_2.generate` CLI (caught + fixed `-n`→`--num-frames` and a required `--pipeline`, `AGENT_VIDEO_PIPELINE`-overridable). A full end-to-end render is **disk-bound** on the dev Mac (LTX-2 is a 19B model, ~100 GB full repo, vs. ~90 GB free) — the framework's hardware-adaptive "scales on a higher-disk box" case, not a code gap; the code (strategy, tool, server-lane degrade) is complete, unit-tested, reviewed, and now CLI-verified. See [`docs/architecture.md`](docs/architecture.md) §22.

**Hardware-adaptive media generation + reachable gen degrade (Slice 28).** Generation model choice is no longer env-pinned-or-hardcoded — a **parallel gen-fit selector** (`generate/select.ts` `selectGenModel`) prescribes a machine-appropriate model per modality: **env pin is authoritative** (`AGENT_{IMAGE,VOICE,VIDEO}_MODEL`), else it filters the per-modality candidate ladder (`generate/catalog.ts`) by uncensored eligibility and picks the **largest that fits** the live hardware budget (`weightsBytes` vs `liveBudgetBytes`), walking best-first past not-installed candidates (consent-gating a pull, `HF_HOME`-aware) and returning `undefined` — a graceful "no model fits, use a bigger box" degrade — when nothing fits. Because a generation engine spawns a CLI that writes a file (no runtime, no `LanguageModel`), this rides a path **parallel** to the main model selector rather than through `resolveModel`; the chosen repo is injected via the existing `GenOpts.model` seam. `createGenerateTools` now runs each tool through **`runGenJob`** (mapping `candidate.engine`→strategy, video passing the other-engine strategy as a `fallback`), so the one-shot↔server degrade and the ComfyUI/Wan lane are finally reachable from the product surface. `gen.fit.*` telemetry records each decision. **Live-verified on real hardware:** image auto-fit selected `FLUX.1-schnell-mflux-4bit` and rendered a real PNG, speech auto-fit selected Kokoro and rendered a real WAV, and video degraded gracefully (no fitting video model cached on the dev box — it auto-renders once one is). See [`docs/architecture.md`](docs/architecture.md) §22.

**Voice input (Slice 29, re-scoped).** A new `src/voice/` subsystem adds speech-to-text to the `chat` prompt: `bun run src/cli/chat.ts "..." --voice` opens a tap-to-toggle mic capture (tap `[space]` to start; ffmpeg `avfoundation` streams PCM, a `silencedetect` filter auto-stops on the first pause after speech, or tap `[space]`/`[enter]` to stop manually, `[ctrl-c]` cancels; capped at 60 s), and `--voice-in <path>` transcribes a file instead — either way the transcript splices into the prompt exactly like `--audio`'s text-splice (§22). The engine is **sherpa-onnx** (`bun run setup:voice` downloads the default moonshine-tiny model), run behind an execution seam: **in-process** via the `sherpa-onnx-node` addon (default — a day-1 spike confirmed it loads under Bun) or a **node-subprocess** worker (`AGENT_VOICE_EXEC=subprocess`) for platforms where that isn't true. sherpa-onnx was chosen specifically because it also ships a browser-WASM build, so the same recognizer reuses into **Slice 30b**'s web UI without a second STT stack. **Degrade-never-crash**: a missing model/addon, a failed capture, or captured silence all degrade to a warning + a `DegradeKind.ToolSkipped` ledger entry rather than crashing the turn. This is a **re-scope**: the original "voice in/out + streaming CLI" plan was built and then **reset** — a hand-rolled terminal pipeline (streaming STT + VAD + TTS voice-out + barge-in) fought the OS (no acoustic echo cancellation on speaker playback, TTS reading markdown aloud) and is archived, unmerged, on branch `slice-29-voice-streaming-cli`. Voice-**out**, barge-in, and true hold-to-talk (terminals have no key-release event) are explicitly Slice 30b's job, where the browser's `getUserMedia({audio:{echoCancellation:true}})` gives real AEC for free. See [`docs/architecture.md`](docs/architecture.md) §23.

**Concurrency & lifecycle core + ops surface (Slice 30a).** A production-readiness audit ahead of the local web UI (Slice 30b) found the whole engine assumed *one run, one process, exits when done* — a blocker for a long-lived host serving multiple concurrent runs. This slice closes that gap without touching the product surface. **Concurrency/lifecycle:** run ids are now collision-free (`newRunId()`, replacing `run-<pid>`, which collided under concurrent runs); telemetry moved from a **process-global** `setGlobalTracerProvider` swap (correct for one run, corrupting for two overlapping ones) to **one global provider fronted by a per-run routing processor** (`telemetry/run-router.ts`) that fans each span out by the run id bound into its OTel context, so concurrent runs' spans stay isolated; cancellation is now **cooperative**, not just a race — `withWallClock` actually aborts the work it times out (previously the timed-out call kept running in the background), and an `AbortSignal` threads the whole `runChat`→`runOrchestrator`→`runAgent`→`generateText` chain (wired end to end; nothing wires a live trigger like a Stop button into it yet — that's 30b's job); a **central child-process registry** + `SIGINT`/`SIGTERM` handler means Ctrl-C now drains every registered child (model servers, media-gen subprocesses, the voice mic/STT subprocess) instead of orphaning them; sqlite gained `WAL`+`busy_timeout` for concurrent reader/writer access; the model manager's admission section (`ensureReady`) is now serialized by a promise-chain mutex so two concurrent delegations can't race the same LRU-eviction decision; and the memory store's `ensureSpace` now **throws** on an embedder mismatch instead of silently serving a stale space (`reindex` is the explicit fix), with its schema now versioned via a shared `db/migrate.ts` runner. **Ops surface:** a structured, run-id-stamped logger (`log/logger.ts`, `AGENT_LOG_LEVEL`); a single documented schema for all 64 `AGENT_*` env knobs (`bun run config`); `bun run status` (Ollama reachability, loaded models, live RAM budget, app version); the app is now versioned (`0.2.0`, `bun run src/cli/start.ts --version`, plus a `bun run start` scaffold entry for 30b); a top-level error boundary maps every typed error to an actionable hint and best-effort persists `error.json` to the run dir; `bun run usage` rolls up token/latency usage from existing `spans.jsonl` telemetry (no new instrumentation); and the framework finally has a **CI pipeline** (`.github/workflows/ci.yml` — docs:check → typecheck → lint → the mock test suite on every push/PR to main). Full suite: 1108 pass / 36 skip / 0 fail. See [`docs/architecture.md`](docs/architecture.md) §§4 (admission mutex), 7 (telemetry router), 11 (migrations + embedder guard + WAL), 21 (cooperative cancellation), and the Process/DB/Config/Logging/Usage/Error-boundary rows in §2.

**Local web UI — Phase 1: web backend foundation (Slice 30b).** The local web
UI is a multi-phase slice; Phase 1 ships the **backend only** — there is
**no user-facing UI yet**. Two new subsystems, both thin and
business-logic-free. **Contracts** (`src/contracts/`) is the single source
of truth for the wire protocol: **isomorphic** (importable by both the
server and the future browser) and kept dependency-free of the engine —
`tests/contracts/isomorphic.test.ts` allows only `zod` and sibling files.
It holds wire enums, read-model DTOs (`RunDTO`/`SpanDTO`/`DegradeDTO`/
`ChatMessageDTO`, with forward-compat fields for later slices already
present-and-required today), a transient-SSE `StatusEvent` discriminated
union (never a re-exported AI-SDK `UIMessage` part), and the inbound request
schemas (`ChatRequest`/`RespondRequest`) the server validates at the
perimeter. **Server** (`src/server/`) is a thin `Bun.serve` BFF: a
per-session bearer token (constant-time verify), a **port-scoped**
Host/Origin allowlist (a security-lens review caught and closed a
portless-loopback DNS-rebinding/CSRF bypass in-slice), realpath media-path
confinement (defeats path traversal and symlink escape), `/api/health`,
COOP/COEP static serving (readies a future sherpa-onnx-WASM
`SharedArrayBuffer` for barge-in voice), `server.request` telemetry, and
typed-error→JSON degrade (never crashes). `bun run web` mints the token,
injects it into the served HTML, and boots the server. **Live-verified**
against the real running server (curl + Chrome): perimeter ordering (403
before auth), the token guard, COOP/COEP headers, and
`crossOriginIsolated === true`. **Explicitly not yet shipped:** the React
frontend (`web/`), the streaming chat/SSE handler, DTO mappers reading real
engine data, and the crews/workflows/builders/library UI, persistence, and
voice surfaces — Phases 1b through 8. See
[`docs/architecture.md`](docs/architecture.md) §Contracts, §Server.

**Local web UI — Phase 1b: frontend scaffold, then Phase 2: streaming
chat + live rail (Slice 30b).** Phase 1b landed the browser side of the
scaffold — `web/` as its own Bun workspace member (Vite 8 + React 19 +
Tailwind v4), a Blueprint-Mono light/dark design-token system, a TanStack
Router app shell over the 7 nav areas, and a ⌘K palette skeleton — but it
only rendered, routed, and themed; nothing streamed, chatted, or persisted.
**Phase 2 turns the Chat area live.** The browser now sends a real turn to
`POST /api/chat` and watches the **top-level orchestrator stream its answer
token-by-token** over an AI-SDK v6 UI-message-stream SSE response;
delegated specialists stay on the existing batch `generateText` path (v6's
`useChat` can't nest a second live stream inside a tool call), so a new
`EventSink` threaded through delegation narrates their progress on a live
agent/model **rail** instead (`Delegation` → `ModelSelect` → `ModelLoad` →
running). The engine seams are additive and optional: `src/core/events.ts`'s
`EventSink`; `core/agent.ts`'s `StreamSink`/`streamText` path (draining
`consumeStream()` **inside** the wall-clock race, or the timeout would never
actually bound a streaming generation — a trap caught before it shipped);
`src/cli/run-chat-session.ts` extracts the shared "run one chat turn" body
the CLI and server both call now. **Server** (`src/server/`) adds
`POST /api/chat` (over a **lazily built** engine — nothing warms at server
boot, only on the first real request), `POST /api/runs/:id/respond` (a
bidirectional human-in-the-loop consent channel keyed by an unguessable
`randomBytes(32)` promptId — no real consumer wires into it yet, the channel
itself ships), `POST /api/upload` (a confined image upload — server-minted
filename, an image-mediaType allowlist, a 20 MB cap, `confineToDir` on
**both** the write and read side), and `POST /api/feedback` (a
`chat.feedback` telemetry span, the Slice-31 eval seam). **A security finding
fixed in-slice (D17):** wiring uploads first reactivated `ingestMedia`'s
prompt-text filesystem auto-detect on the server path — since the task text
is attacker-controlled over HTTP, scanning it for real host paths and
reading them unconfined would be an arbitrary-file-read hole; the server
path now explicitly disables that auto-detect (`ingestDeps:{exists:()=>false}`),
while the CLI (a trusted local caller) keeps it. **Web** ships a real
streaming `features/chat/` (`@ai-sdk/react`'s `useChat` +
`DefaultChatTransport`, hand-authored AI-Elements/`streamdown` message
rendering) with the conversation basics — **Stop** (aborts the underlying
fetch mid-stream), **copy**, per-message **regenerate**, **edit+resend**
(truncate history, resend), **👍/👎 feedback**, an inline **data-confirm**
prompt (dismiss = fail-safe decline), and **drag-drop/paste-image** upload
(media-by-reference) — plus `features/agents/`'s live rail
(`useStatusEvents` folding transient `data-*` parts into
`{agent, model, phase, degraded}`). Chat stays **stateless per request** —
no `SessionStore` until Phase 6. **Explicitly not yet shipped (Phases
3–8):** span→`RunDTO`/`SpanDTO` waterfall mappers + `@visx`/`@xyflow` run
history, the crews/workflows/builders/library feature screens,
cross-invocation persistence, and the browser voice surface. See
[`docs/architecture.md`](docs/architecture.md) §"Web frontend",
§"Streaming chat".

**Persistence + product (web UI — Slice 30b Phase 6).** Chat now survives a
reload. A new `src/session/` `SessionStore` (`bun:sqlite`, the identical
WAL/`busy_timeout`/`foreign_keys` pragma trio + `db/migrate.ts` migration
runner the memory store already uses) persists a **client-minted**
`sessionId` (v4-UUID-regex-validated at the same `ChatRequestSchema.parse()`
call `handleChat` already makes) via idempotent `INSERT OR IGNORE` — a
retried POST is a safe no-op. `POST /api/chat` upserts the session and
appends the user message **before** any engine work, and appends the
assistant message only **after** `runChatTurn` resolves (turn-boundary
persistence — the "visible gap never partial" contract was adversarially
verified by two parallel Opus reviewers). `GET/PATCH/DELETE
/api/sessions(/:id)` + `GET /api/sessions/:id/export` give the browser a
real **Sessions** history — a searchable, cursor-paginated list (mirroring
Runs' opaque cursor), detail/rehydrate-on-reload, rename, delete, and a
Markdown export (fetched with the bearer token rather than linked, since a
bare `<a href>` would 401 through the existing perimeter). **Recall +
auto-ingest:** `runChatSession` gains one optional `memoryStore` dependency
shared by CLI and server — recall now reads a dedicated `chat` memory space
(space-wide, no namespace, so a session remembers across itself) via the
pre-existing `injectRecall`, and every completed turn writes itself back in
via a new `MemoryStore.rememberOnce` (content-hash-deduped, so a
retried/duplicate turn never double-ingests), fired **after** the SSE
stream ends — the browser never waits on it. **Notifications:** a
client-side `AppShell` hook polls the existing `GET /api/runs` on an
interval and diffs each run's lifecycle (baseline-then-diff, so
already-terminal runs never fire on mount); a qualifying
`Running→Done/Failed` transition above a minimum duration fires a toast
plus an optional, permission-gated OS `Notification` — no new server
endpoint, no event bus (adversarially verified, 2 Opus lenses). **Honest
caveats, not silently dropped:** `parentMessageId` is written to the
`messages` table but not consumed for threading — regenerate/edit+resend
stay linear this phase, reserved for Slice 41; there is no JSON export
(Markdown only); there is no server-push/global SSE event bus; there is no
session retention/GC; and the CLI gets the recall **READ** benefit only —
no CLI-side session persistence. (The `kind=agent` long-chat notification
false-positive noted here at Phase-6 ship time was **fixed in Phase 8** —
see below.) Full suite: 1549 pass/36 skip/0 fail
(root) + 204 pass, 48 files (web, Vitest/happy-dom). See
[`docs/architecture.md`](docs/architecture.md) §"Persistence — Sessions +
chat recall".

**Polish + a11y + observability (web UI — Slice 30b Phase 8 — the 30b
finale).** Phases 1–7 shipped every functional surface; Phase 8 closes the
a11y, correctness, and observability debt each phase deferred, flipping the
30b capability 🟡→✅. **Accessibility (WCAG 2.1 AA):** an app-wide
`:focus-visible` ring token + `.sr-only` utility; real `<label>`s on the
Composer textarea and the Settings voice-model-tier select; live-bound
`aria-pressed` on the theme/voice/OS-notify toggles + `aria-label` on the
three `<aside>` landmarks; a shared roving-tabindex keyboard pattern
(`nextTabIndex`) for the Library/Builders tabs; a `useReducedMotion` hook
gating `DagView`'s `fitView` pan/zoom; and an automated `vitest-axe`
regression net (zero violations across 6 area baselines) that **caught and
fixed a real bug** — three unlabeled `<select>` filters on `/runs`. **Voice
polish:** progressive-decode interim transcription (words now stream in as
Moonshine decodes a closed segment — **not** real-time-during-speech ASR,
which remains future scope) and a one-pole anti-alias low-pass filter ahead
of the downsampler's interpolation. **⌘K completeness:** the command type
widened to a discriminated nav/action union; voice-input and theme toggle
commands; degenerate jump-to-* commands deduped; a "jump to a recent run"
deep link. **Correctness:** chat turns now open their own `chat.run` root
span instead of borrowing the generic `agent.run` name, so `deriveRunKind`
classifies them as `Chat` and a long chat turn **no longer fires a false
completion notification** — the Phase-6 `kind=agent` limitation above is
closed. **Observability:** the first client→server telemetry in the repo —
`POST /api/telemetry` (the token travels in the `sendBeacon` JSON body and is
verified timing-safe in the handler — **not** a `?k=` URL token, which would
leak via browser history / proxy logs — since `sendBeacon` can't set headers)
writes a new `voice.transcribe.web` span, distinct from the pre-existing
CLI-side `voice.transcribe` span. **Honest caveats, not silently dropped:**
barge-in/interruptible voice and TTS voice-out remain explicit **future
scope**, not debt (Phase 7 D2, restated here); the progressive-decode
interim is not real-time-during-speech transcription; the standalone
`mcp`/`memory` CLI `--follow` auto-stop gap this phase's `chat.run` work
also touched (`RUN_ROOT_NAMES`/`TERMINAL_RUN_ROOTS`) is closed for
chat/crew/workflow/build/pull runs. See
[`docs/architecture.md`](docs/architecture.md) §"Voice (web UI — Slice 30b
Phase 7)", §"Telemetry (web UI — Slice 30b Phase 8)", §"Accessibility
(a11y, web UI — Slice 30b Phase 8)", §7 "Observability".

---

## Quick start

**Prerequisites:** [Bun](https://bun.com) ≥ 1.3, [Ollama](https://ollama.com)
(running locally), an Apple Silicon Mac, and [`uvx`](https://docs.astral.sh/uv/)
(for the keyless web-fetch agent — `uvx mcp-server-fetch`). The unit/mock test
suite needs none of these; only the CLI and opt-in live tests do.

```sh
bun install                 # install dependencies (pinned, see below)
bun run typecheck           # type-check
bun test                    # run the test suite (no model needed — uses a mock)
bun run lint                # lint + format check (Biome)
```

**Start Ollama the project way (do this on every machine).** Quit the Ollama
menu-bar app first, then:

```sh
bun run serve               # runs `ollama serve` with OLLAMA_MODELS=./model-images
```

This is the **uniform process across all machines** — laptop, Mac Mini, etc.
Models always live under [`model-images/`](model-images/README.md) (git-ignored,
so each machine keeps its own copy), and the framework pulls anything missing on
first use. Then, in another terminal:

```sh
# Real end-to-end (downloads the specialist model, e.g. qwen3.5:9b, on first run):
echo "The quick brown fox jumps over the lazy dog." > /tmp/sample.txt
bun run src/cli/chat.ts "What animal is in /tmp/sample.txt?"
```

Run a deterministic workflow (fixed steps, not LLM-routed) with `bun run flow`,
run a role-based crew with `bun run crew`, and inspect any run's OTel trace with
`bun run runs`:

```sh
bun run flow fetch-then-summarize "https://example.com"   # run a registered workflow
bun run crew research-crew "local vector databases"       # run a registered crew
bun run runs                                              # list recent runs
bun run runs <run-id>                                     # render its trace as a timeline
```

Ops commands (Slice 30a):

```sh
bun run status                                            # Ollama reachability, loaded models, live RAM, app version
bun run config                                            # dump the effective AGENT_* config table (source: env|default)
bun run usage                                             # token/latency usage rolled up from runs/<id>/spans.jsonl
bun run start -- --version                                # print the app version (0.2.0)
```

### Multimodal setup

Working STT, image-gen, and TTS (plus isolated video-gen) with **one command**:

```sh
bun run setup:media
```

This installs `ffmpeg` (via Homebrew on macOS) and two Python venvs the
media engines run in — a "media" venv (mlx-whisper, mflux, mlx-audio +
misaki[en], all auto-installed) and a separate **isolated** "video" venv
(mlx-video, with `transformers` pinned to `5.5.0` **after** the mlx-video
install so the pin wins over its own resolver — this is what resolves the
`mlx-video` ↔ `transformers>=5` conflict that used to block video-gen; see
`docs/architecture.md` §22 for why the two venvs can't share one
`transformers` version). It's idempotent, so it's safe to re-run any time.
See `scripts/setup-media.ts` and [`docs/architecture.md`](docs/architecture.md)
§22 for the mechanics.

**Image generation works immediately, no HuggingFace account needed** — the
default model is an ungated mirror. **Video generation** is CLI-verified
against the real `mlx-video` engine in that isolated venv, but a full render
is disk-hungry (LTX-2 is a 19B model, ~100 GB full repo) — it needs enough
free disk, which the shared dev Mac doesn't have; a machine with more disk
renders it as-is. The only manual, user-only step is for
**gated model variants**: run `huggingface-cli login` **in your own
terminal** (never paste an HF token into an AI chat) and accept that model's
license on huggingface.co.

---

## Architecture at a glance

The framework sits on **Vercel AI SDK 6** (provider abstraction + tool-calling
loop) and adds only the thin layers it needs. Tools are exposed over **MCP** so
they're reusable across other agent tools (Claude Code, Cursor, …).

```
                 ┌─────────────────────────────┐
   you  ───────► │  cli/chat.ts (entrypoint)   │
                 └──────────────┬──────────────┘
                                │
       ┌────────────────────────┼─────────────────────────┐
       ▼                        ▼                          ▼
┌──────────────┐      ┌───────────────────┐       ┌────────────────┐
│  resource/   │      │  core/agent.ts    │       │   run/         │
│  (budget,    │      │  runAgent loop    │       │  run-store +   │
│  warm/unload)│      │  (AI SDK 6 +      │       │  journal       │
└──────┬───────┘      │  stopWhen guard)  │       └────────────────┘
       │              └─────────┬─────────┘
       ▼                        │ tools (ToolSet)
┌──────────────┐                ▼
│ providers/   │      ┌───────────────────┐      ┌──────────────────┐
│ ollama.ts ──►│      │  mcp/client.ts ──►│─────►│ mcp/server.ts    │
│ (LanguageMod)│      │  (createMCPClient)│ stdio│  read_file tool  │
└──────────────┘      └───────────────────┘      └──────────────────┘
```

**Full details, data-flow diagrams, and design decisions:**
[`docs/architecture.md`](docs/architecture.md).

### Project structure

| Path | Responsibility |
|---|---|
| `src/core/` | `agent.ts` (the loop), `agent-def.ts`, `delegate.ts`, `orchestrator.ts`, `capability-gap.ts`, `resource-capture.ts` (the `{kind:'resource'}` seam), `types.ts` (download `ProviderKind` + inference `RuntimeKind`), `kind-map.ts` (`downloadKindFor`/`runtimeKindFor`), `errors.ts` |
| `src/providers/` | `ollama.ts` — builds an AI SDK model from a declaration |
| `src/resource/` | `hardware.ts` (live free-RAM via `vm_stat` + Metal-cap ceiling), `footprint.ts` (weights + KV split), `kv-cache.ts` (per-model arch-derived KV sizing + quant-risk), `model-manager.ts` (load/evict/pin + dynamic `num_ctx`), `model-store.ts` (installed-model cache), `selector.ts` (capability filter + largest-that-fits + `resolveModel` fallback loop), `ollama-control.ts` (pull/warm/unload/`getModelMaxContext`/`getModelKvArch`) |
| `src/runtime/` | `runtime.ts` (runtime port), `ollama.ts` (its own control impl) + `mlx-server.ts`/`strategies/{llamacpp,lmstudio,mlx}.ts` (4 adapters, the latter 3 sharing `managed-openai-compatible.ts`'s `createManagedRuntime(strategy)` control surface, Slice 26), `process-supervisor.ts` (spawn/health-poll/kill-on-timeout for spawned strategies), `registry.ts` (runtime registry) — build a model from a declaration per provider |
| `src/discovery/` | `discover.ts` + `build-registry.ts` (offline registry merge), `catalog-source.ts` + `huggingface-gguf.ts` + `huggingface-mlx.ts` + `hf-client.ts` (HF catalogs), `host.ts` (machine detect), `catalog-cache.ts`, `quant.ts`, `sources.ts` |
| `src/run/` | `run-store.ts` (run dirs + artifacts), `run-id.ts` (`newRunId()` — collision-free sortable run ids, Slice 30a, replacing `run-<pid>`), `run-trace.ts` (span reader/tree — `spans.jsonl` is canonical; the earlier `journal.ts` is retired) |
| `src/tools/` | `read-file.ts` — the `read_file` tool |
| `src/mcp/` | `types.ts`/`config.ts` (`mcp.json` registry, per-entry degrade), `consent.ts` (spec/tools-hash pinning, `.mcp-approvals.json`), `mount.ts` (`mountAll`, per-agent slices), `pack.ts` (12-entry starter pack), `client.ts` (`mountMcpServer` primitive; completes the first-time OAuth handshake, Slice 26), `oauth-provider.ts` (real `OAuthClientProvider`: DCR/PKCE/CSRF-state/AS-metadata persistence, Slice 26), `token-store.ts` (0600 atomic on-disk token/client store, Slice 26), `loopback.ts` (browser-redirect capture, Slice 26), `server.ts`/`sqlite-server.ts` (in-repo servers) |
| `src/cli/` | `chat.ts` (entrypoint), `run-chat.ts` (testable orchestration; `signal?: AbortSignal` cooperative-cancellation seam, Slice 30a), `flow.ts` (`bun run flow`), `crew.ts` (`bun run crew`), `with-mcp-run.ts` (per-run scope + telemetry + mount helper, Slice 16), `with-run.ts` (`withRunTelemetry` — the mount-free per-run telemetry scope for the builder + archive CLIs, so their `build.verify`/`build.archive` spans land in `runs/<id>/spans.jsonl`, Slice 20), `select-hook.ts` (selector-driven `onBeforeDelegate`), `selection-notice.ts` (per-delegation notice), `mcp.ts` (`bun run mcp list\|status\|add`), `agent-builder.ts` (`bun run agent-builder "<need>" [--yes] [--force]`, Slice 17; `--force` commits a failed gate at `unverified` with a WARNING), `crew-builder.ts` + `offer-crew.ts` (`bun run crew-builder "<need>" [--yes] [--force]`, Slice 19), `archive.ts` (`bun run archive [--prune]`, Slice 20), `status.ts` (`bun run status`, Slice 30a), `config.ts` (`bun run config`, Slice 30a), `usage.ts` (`bun run usage`, Slice 30a), `start.ts` (`bun run start`, `--version`, Slice 30a) |
| `src/agent-builder/` | Specialist agent generation (Slice 17): `types.ts`, `generate.ts` (prompt-injection-guarded draft), `suggest-tools.ts` (palette-only server pick), `validate.ts` (structural gate), `write.ts` (atomic file + registry + `mcp.json` scoping), `builder.ts` (`buildAgent`/`buildTool`: generate→suggest→validate→retry→consent→write), `deps.ts` (live tools-capable largest-that-fits model); Slice 18 adds the consent-gated inert tool-code path (`generate-tool.ts`/`validate-tool.ts`/`write-tool.ts` → `<name>.proposal.ts`) |
| `src/process/`, `src/db/`, `src/log/`, `src/config/`, `src/usage/`, `src/errors/` | The Slice 30a ops surface: `process/child-registry.ts` + `process/lifecycle.ts` (central child-process registry + `SIGINT`/`SIGTERM`-drained shutdown), `db/migrate.ts` (shared `bun:sqlite` schema-version migration runner), `log/logger.ts` (structured, run-id-stamped leveled logger, `AGENT_LOG_LEVEL`), `config/schema.ts` (`CONFIG_SPEC` — the documented `AGENT_*` schema `bun run config` dumps), `usage/aggregate.ts` (token/latency rollup from `spans.jsonl`), `errors/boundary.ts` (top-level error → hint + `error.json`) |
| `src/crew-builder/` | Crew/workflow generation from a multi-step need (Slice 19, Phase D): `ir.ts` (`CrewIR`/`WorkflowIR` + Zod), `safe-helpers.ts` (the closure vocabulary), `classify.ts`/`analyze.ts`/`plan-nodes.ts`/`plan-edges.ts` (staged generation), `validate.ts` (two-tier structural+semantic gate), `resolve-members.ts` (auto-build missing agents via the agent-builder), `transpile.ts` (deterministic IR→TS), `write.ts` (atomic multi-write; split into stage/register since Slice 20), `builder.ts` (`buildCrewOrWorkflow` orchestrator), `deps.ts`; CLI `bun run crew-builder "<need>" [--yes]` (`src/cli/crew-builder.ts`) + a TTY-gated `chat.ts` multi-step gap-offer (`src/cli/offer-crew.ts`) |
| `src/verified-build/` | Behavioral verification of generated artifacts (Slice 20): `gate.ts` (`verifyAndCommit`, the stage→verify→commit spine), `signature.ts`/`reuse.ts`/`manifest.ts` (capability signature + cosine reuse bands + `.generated.json` sidecar), `dry-run.ts`/`repair.ts` (bounded real execution + self-repair), `judge.ts`/`golden.ts`/`eval.ts` (cross-family judge selection, 3–7 golden cases, unanimous rubric eval), `usage.ts` (usage from `spans.jsonl`), `archive.ts` (reversible idle-near-duplicate archiving), `types.ts`/`config.ts` (`VerifiedLevel`/`ReuseKind`/… + env-fallback-only thresholds) |
| `models/` | model **declarations** (data, not weights) — `qwen-fast.ts`, `qwen-router.ts`, `registry.ts` (bootstrap capability ladder) |
| `agents/` | agent definitions — **all agents live here** ([readme](agents/README.md)); `index.ts` is the `AGENTS` registry (`agentNames()`) generated agents register into (Slice 17) |
| `model-images/` | local model blob files (git-ignored, [readme](model-images/README.md)) |
| `docs/` | architecture + the design specs/plans under `docs/superpowers/` |

---

## Why local models, no API keys

The whole point is a self-owned inference box (the Mac Mini). Depending on paid
APIs would defeat that. A single cloud **escape hatch** — Codex via the official
SDK on a personal plan — is planned as an *opt-in* "heavy lifting" backup, never
the default. (Gemini CLI and Claude Code are intentionally excluded.)

## Why Ollama (and where llama.cpp fits)

Short answer: **we are using llama.cpp — through Ollama.** Ollama is a wrapper
around the llama.cpp inference engine (and Apple's MLX on 32 GB+ Macs). Choosing
Ollama isn't choosing *against* llama.cpp; it's choosing not to hand-roll the
layers an agent system needs on top of it:

- **Model management** — `pull` / `list` / `ps`, automatic quantization
  selection. Raw llama.cpp means managing GGUF files and load flags ourselves.
- **An HTTP control API** — warm / `keep_alive` / unload / `/api/ps`. Our
  **autonomous resource manager** needs exactly this to load/unload models and
  read what's resident. With bare llama.cpp we'd build that layer by hand.
- **First-class tool-calling** — reliable function-calling for agents, plus a
  clean AI SDK provider (`ollama-ai-provider-v2`).
- **MLX for free** — on 32 GB+ Apple Silicon, Ollama 0.19+ runs on an MLX
  backend, faster than vanilla llama.cpp Metal.

Critically, the model layer is **runtime-agnostic** (ports/adapters via AI SDK's
`LanguageModel`). Ollama is just the default Tier-1 adapter — a managed
**llama.cpp-server**, **LM Studio**, and **MLX-server** adapter all now sit
behind the same interface too (Slice 26, §5), for when lower-level control
(custom sampling, a specific runtime already installed) is wanted; no agent
code changes either way. Heavier MLX variants (persistent KV-cache via omlx,
higher concurrency via vMLX) can slot in the same way later. See
[`docs/architecture.md`](docs/architecture.md#why-ollama).

---

## Roadmap

| Slice | Scope | Status |
|---|---|---|
| **1** | One agent (file Q&A) · resource warm-up/unload · MCP `read_file` · run store | ✅ Done |
| **2** | Super-agent (agents-as-tools) delegating to sub-agents · `report_capability_gap` (route-or-gap) · opt-in live test | ✅ Done |
| **3** | **Integrations:** `mountMcpServer()` (mount any MCP server) · web-fetch agent via keyless `uvx mcp-server-fetch` · multi-specialist routing · opt-in live tests | ✅ Done |
| **4** | **Model Manager:** multi-model, hardware-aware — small pinned router (`qwen3.5:4b`) + on-demand specialists (`qwen3.5:9b`) · live free-RAM budget (`min(75% Metal cap, 80% available)` via `vm_stat`, per-delegation) · best-effort pin (pinned evicted only as last resort) · dynamic `num_ctx` sized from headroom, clamped by live model max, floored at 4096 | ✅ Done |
| **5** | **Dynamic model selection** — agents declare a capability requirement (`requires`/`prefer`) instead of a fixed model; registry + selector pick the largest model that fits the live budget; Model Manager loads it; genuine no-fit surfaces as `{kind:'resource'}` | ✅ Done |
| **6** | **Model discovery** — `runDiscovery` fetches tool-capable GGUF/MLX models from Hugging Face (trusted publishers, sized to live RAM), writes `model-images/catalog.json`, pre-pulls the top fit; offline merge of bootstrap + local + catalog at chat time; Ollama + MLX-server runtimes; four-axis taxonomy (capability/modality, runtime, source, content-policy) | ✅ Done |
| **7** | **KV-cache quantization** — global `AGENT_KV_CACHE_TYPE` (default q8_0); `OLLAMA_FLASH_ATTENTION=1` required; per-model arch-derived sizing from `/api/show`; generalized arch-risk advisory (small head_dim / MoE) | ✅ Done |
| **8** | **Run-viewer / OTel telemetry** (Phase A) — every run is an OpenTelemetry trace (`runs/<id>/spans.jsonl`); `bun run runs` (list / `<id>` timeline / `--follow`); swappable OTLP backend via `AGENT_OTLP_ENDPOINT` | ✅ Done |
| **9** | **Composition guardrails** (Phase B prerequisite) — `AsyncLocalStorage` delegation context; depth limit (default 5, `AGENT_MAX_DELEGATION_DEPTH`); live return-size cap (¼ × caller `num_ctx`, `AGENT_RETURN_CTX_FRACTION`); soft-error surfacing + `agent.guardrail.violation` span event | ✅ Done |
| **10** | **Workflow / DAG engine** (Phase B) — `defineWorkflow({id, steps})`, code-first typed DAG; step kinds `agent`/`tool`/`branch`/`map`; Zod-validated step I/O; fail-fast + per-step `onError`; `bun run flow <name>` + `workflows/` registry + `runWorkflow()`; reuses Slice 9 guardrails | ✅ Done |
| **11** | **Crews & roles** (Phase B) — `defineCrew({id, members, tasks, process})`; members with role/goal/backstory (live model selection) + tasks with `dependsOn`; `sequential` (compiles to a Slice-10 workflow) and `hierarchical` (orchestrator + auto manager) processes; `bun run crew <name>` + `crews/` registry; reuses Slice 9 guardrails; live model selection also wired into the `flow` CLI via shared `src/cli/select-runtime.ts` | ✅ Done |
| **12** | **Memory / RAG** (Phase B) — `src/memory/`: two-tier store (LanceDB table-per-space + `bun:sqlite` space registry/document manifest); weights-only embedder (`qwen3-embedding:0.6b`) loaded via the Model Manager; dense-vector retrieval → optional cross-encoder rerank (default-on, graceful degradation) → live budget-fit pack; citation-tagged + abstaining `recall` tool; `bun run memory ingest\|recall\|stats\|reindex`; optional crew/workflow `memory` dep (bound `recall` tool + auto-persist) | ✅ Done |
| **13** | **Grounded verification** (Phase B) — `src/verification/`: claim decomposition + cited-evidence lookup (`getByIds`) → per-claim MiniCheck faithfulness judge (`bespoke-minicheck`, consent-pull + general-model fallback) → bounded Corrective RAG (rewrite + re-answer; re-recall when `recall` wired; CLI path re-answers without retrieval—documented follow-up, once) → abstain on fail (`{kind:'unverified'}`); opt-in `--verify` on `bun run crew`/`flow` splices a verify→branch→corrective→abstain sub-graph (`StepKind.Verify`) after the terminal answering step; writes `runs/<id>/unverified.txt` + non-zero exit on abstention; in-repo golden-set eval gate (no external framework) | ✅ Done |
| **14** | **First-boot provisioning + downloader** (Phase A/ops) — `src/provisioning/`: runtime-agnostic `DownloadProvider` abstraction (Ollama live-verified at Slice 14; MLX live-verified Slice 18; LM Studio + llama.cpp GGUF live-verified Slice 26) + unified progress protocol; two-phase catalog discovery (dynamic per-runtime query + committed-snapshot fallback); hardware-fit ranking + per-model consent; disk preflight + stall/retry supervisor guards; `bun run provision` + a non-invasive `chat.ts` auto-detect hook | ✅ Done |
| **15** | **`mcp.json` mount registry + starter pack** (Phase C) — `src/mcp/`: declarative registry (`config.ts`, per-server `agents` scoping) replaces Slice 3's hardcoded mounts; consent-gated mounting with spec-hash/tools-hash pinning against tool-definition drift (`consent.ts`, `mount.ts`); 12-entry curated starter pack (`pack.ts`, `bun run mcp list\|status\|add`); registry wired into all three CLIs (`chat`/`flow`/`crew`); live scoping eval (`tests/mcp/eval-scoping.test.ts`) | ✅ Done |
| **16** | **MCP telemetry-ordering fix + consent robustness** (Phase C follow-on) — `src/cli/with-mcp-run.ts` owns `createRun` → `initRunTelemetry` → `withMcpMountSpan(mountAll(...))` for `chat`/`flow`/`crew` so `mcp.mount` now lands in `runs/<id>/spans.jsonl` (previously silently dropped); mount span gains `mcp.server.count` + a corrected (summed) `mcp.tool.count`; `runFlow`/`runCrewCli`/`runChat` now take `run: RunHandle` from the caller; consent interactivity now requires stdin **and** stderr TTY (`interactiveTTY()`), and `stdinInput()` resolves on stream `end` (no more hang on `< /dev/null`) | ✅ Done |
| **17** | **Agent-builder** (Phase D) — generate a specialist on a capability gap: `src/agent-builder/` drafts a proposal (prompt-injection-guarded), suggests a minimal palette-only server subset from the Slice 15 pack, validates it structurally, requires explicit consent, then atomically writes the agent file + a new `agents/index.ts` registry entry + scoped `mcp.json`; triggers via `bun run agent-builder "<need>"` and a TTY-gated `chat.ts` gap-offer (the `{kind:'gap'}` outcome itself is unchanged); `agent.build` telemetry span; safety model = review-before-activate, palette-only, no same-run activation | ✅ Done |
| **18** | **Debt wrap-up + MLX completion** — split the overloaded enum into download `ProviderKind` + inference `RuntimeKind` (+ `kind-map.ts`); `hf-fetch` now persists weights to disk (atomic `.part`→rename, HF-LFS-oid verify, single-file GGUF + MLX snapshot, traversal-guarded, retry/stall parity); MLX runtime raised to Ollama's bar (`createMlxServerRuntime`, opt-in + degrade-to-Ollama via `fallbackModel`); provisioning polish (bounded-parallel downloads + `MultiProgressBar`, truthful telemetry, Metal reader, `refresh-snapshot.ts`); MCP/agent-builder debt (engine-enforced read-only sqlite via `PRAGMA query_only`, MCP OAuth `authProvider`, `mcp.transport`, atomic `addPackEntry`, agent-builder retry + inert-`.proposal.ts` tool-code path). LM Studio download wired (contract-tested); MLX **live-verified both ways** | ✅ Done |
| **19** | **Crew/workflow builder** (Phase D) — compose, not just generate: `src/crew-builder/` turns a multi-step need into a **crew** or **workflow** via a staged, validated IR-then-transpile pipeline (`classify`→`analyze` think-first→`plan-nodes`→`plan-edges`→two-tier `validate`→consent→`resolve-members` auto-build via the agent-builder→deterministic `transpile`→atomic `write`); a small safe-helper vocabulary (`fromInput`/`fromStep`/`fromTemplate`/`whenEquals`/`whenContains`/`whenTruthy`/`mapOver`) is the only closures a model can pick from; shared `assertAcyclic` (`workflow/define.ts`) gates both shapes' graphs; `CrewMember.agentRef` lets a crew member reuse a registered (or freshly-built) agent; triggers via `bun run crew-builder "<need>"` and a TTY-gated `chat.ts` multi-step gap-offer; `crew.build` telemetry span. **Live-verified end to end on Ollama** — a generated crew executed to a correct result, surfacing + fixing 4 live-only defects | ✅ Done |
| **20** | **Verified "works out of the box"** (Phase D — closes the phase) — `src/verified-build/`: builder writes become **stage → verify → commit** via a shared cheapest-first gate — pre-generation **reuse check** (capability-signature embedding vs a per-registry `.generated.json` manifest; ≥0.85 confirm-gated reuse · 0.75–0.85 offer, ask reuse-or-build · <0.75 generate; `--yes` auto-reuses Reuse, declines Offer) → stage (never the index) → structural → **execution dry-run** (`withWallClock`-raced; the agent path additionally aborts in flight via a new `runAgent` `abortSignal` seam — crew/workflow are wall-clock-raced only; ≤2 self-repair attempts feeding the runtime error back into a regeneration) → **golden-eval** (3–7 auto-generated binary cases, largest-installed judge preferring cross-family, unanimous over 3 runs; no judge ≥ ~24B ⇒ skip + commit `verified: runs` — degrade, never block) → commit (index + `<name>.golden.json` + manifest) at the earned `VerifiedLevel`; failed gate registers nothing and the staged file is discarded (`--force`/`verify.force` ⇒ `unverified` + WARNING). Plus usage aggregation from `spans.jsonl` + reversible archive (`bun run archive [--prune]`, live-reference-protected cross-registry) + a chat reuse hint; `build.verify`/`build.archive` telemetry. **Live-verified on Ollama** — a real build committed at `verified: runs` (judge-degrade path) and a re-run of the same need hit reuse at 89% | ✅ Done |
| **21** | **Graceful degradation + retries** (Phase A — fills the last reliability gap; the routing-accuracy eval harness remains the one open Phase-A item) — `src/reliability/`: a three-lane error taxonomy (`classify.ts` — `Lane.Transient/RouteWorthy/Terminal`, pure, unknown→Terminal); retry with full-jitter backoff + attempt-cap + `Retry-After` respect, Transient-only (`retry.ts`); run wall-clock + idle-stall timeouts (`timeout.ts`); a hand-rolled circuit breaker with a shared per-dependency registry (`breaker.ts`); a failure-domain-aware model-degradation chain (`degrade.ts`); a user-facing `DegradationLedger` (`ledger.ts`) persisted to `run.dir/degradation.jsonl` and printed as a run summary. Wired into delegation (drop/degrade + record), the workflow engine + crews (per-step retry/timeout, breaker-wrapped Tool/MCP steps), MCP tool calls (`wrapToolsWithBreaker`), and the model selector (`degradeChain`). Per **D5**, the LLM turn itself is never double-retried (AI SDK v6 already retries transport errors) — only cross-boundary ops the framework owns get `withRetry`. Migrated the pre-existing provisioning stall/retry guards and the verified-build wall-clock primitive onto the same layer. **Live-verified on real Ollama** (4 scenarios, `tests/integration/reliability-live.test.ts`, `RELIABILITY_LIVE=1`) — MLX-unreachable degrades to a real Ollama fallback that generates, a failing-then-succeeding Tool step retries to completion, a delegated agent whose model call fails returns a structured error without crashing, and a real `withMcpRun` persists `degradation.jsonl` + a `reliability.degrade` span event. See [`docs/architecture.md`](docs/architecture.md) §21 | ✅ Done |
| **23** | **AI SDK v6→v7 upgrade** (deferred dependency-major slice, held 2026-07-05, unblocked 2026-07-19) — `ai` 6→7, `@ai-sdk/react` 3→4, `@ai-sdk/mcp` 1→2, `@ai-sdk/openai-compatible` 1→3, `@ai-sdk/provider-utils` 4→5, new `@ai-sdk/otel`, `ollama-ai-provider-v2` 3→4, `typescript` 5→6 (root + web, in lockstep; `zod` untouched, already `^4.4.3`). Codemod-first (`stepCountIs`→`isStepCount`, `experimental_telemetry`→`telemetry`, `system`→`instructions`, `ToolCallOptions`→`ToolExecutionOptions`) then hand-fixed the one substantive seam: v7 extracted OpenTelemetry out of core `ai` into `@ai-sdk/otel`, so a new `src/telemetry/ai-sdk.ts` `ensureAiSdkTelemetry()` registers a `LegacyOpenTelemetry` integration (a dynamic tracer that re-resolves per span, so AI-SDK spans keep following the run-router's per-run tracer-provider swaps) — preserves the v6 span shape (`ai.generateText`, `ai.telemetry.functionId`) with zero fixture churn. Unblocked once `ollama-ai-provider-v2@4` shipped provider-spec-v4 support, clearing the original hold's `num_ctx` regression risk — **live-verified against real Ollama**: `num_ctx` still forwards via `{ollama:{options:{num_ctx}}}` to native `/api/chat` (confirmed at `context_length=16384`, not the 4096 default). `bun run check` green (root 1589 pass/36 skip, web + typecheck + lint). Unblocks the Slice 24 daemon line. See [`docs/architecture.md`](docs/architecture.md) §5 / §7 | ✅ Done |
| **24** | **Always-on daemon + task queue + resumable jobs + secure remote access** (Phase E) — turns the foreground `Bun.serve` BFF into a long-lived daemon with a durable SQLite job queue at its heart. **Queue** (`src/queue/`): `createJobStore` (mirrors `SessionStore` — WAL, `db/migrate.ts` `'init-jobs'` migration, keyset pages) with an atomic **`claimNext`** (`BEGIN IMMEDIATE`, priority-then-FIFO via `ORDER BY priority ASC, created_at ASC`, an `available_at<=now` retry gate), `markFailed` re-queue with full-jitter backoff (no breaker — jobs share no failure domain), and `reconcileOrphans` boot recovery; a bounded `createWorkerPool` (N = `computeConcurrency()`, per-job `AbortController` cancel, error-isolated loops so a store throw can't wedge the daemon, bounded `drain`). **Detached execution:** `POST /api/jobs` enqueues → `202 {jobId, runId}`; chat/crew/workflow/pull handlers migrated off inline-await/`void`-detach onto the queue so a run **outlives its request**; SSE reconnect replays by wire-order (`runs/stream.ts` — an integration test caught + fixed a dropped-terminal-root-frame gap); concurrent-stream cap + run-dir rate limit. **Daemon** (`src/daemon/`): `createDaemon().start()` boot-ordering (double-start guard → `reconcileOrphans` FIRST → `writePid` → `pool.start` → `startWebServer` in injected-pool mode → `SIGTERM`/`SIGINT` drain), PID file (0600, stale-clear), launchd plist (`KeepAlive`/`RunAtLoad`) + `agent daemon install/start/stop/status/logs` CLI. **Durable auth:** a persisted root token (`~/.agent/daemon-token`, 0600, survives restart) mints stateless per-device **HMAC session tokens** (Fable-audited sound — sig-before-parse, constant-time, fail-closed revocation set); `rotate` invalidates all sessions. **§7.4 threat model:** loopback-default bind (`AGENT_WEB_BIND`) + tunnel host (`AGENT_WEB_ALLOWED_HOSTS`) past the Host perimeter, the network is *not* the trust boundary (tunnel-without-token → 401; wrong Host → 403 before token), body caps, MCP `redirect:'error'` SSRF guard, path-confined resume runId (HIGH traversal/IDOR fix). **Resumable jobs:** the `@ai-sdk/workflow` spike was **ruled out** (exports no durable store/DAG/resume; that's the separate Vercel Workflow DevKit) → a **custom per-node checkpoint** (`src/workflow/checkpoint.ts`, atomic `runs/<id>/checkpoint.json`); `--resume`/re-enqueue skips completed DAG nodes with no re-execution; durable consent survives restart. **Pluggable tunnel** (Tailscale default, Cloudflare/reverse-proxy documented; TLS delegated to the transport). New `daemon.*`/`job.*` telemetry + populated `RunOrigin.Daemon`/`server.principal` provenance. See [`docs/architecture.md`](docs/architecture.md) §24 | ✅ Done |
| **25b** | **Jobs & Triggers Ops Console** (web-UI companion to Slice 24; a new, non-destructive ROADMAP row between 24 and 25) — the always-on daemon + task queue + durable auth Slice 24 shipped were **backend-only**; this slice adds the operator surface. One new `/ops` nav entry (`web/src/features/ops/`) with four tabs: **Overview** (daemon/queue health cards off two new reads — `GET /api/daemon/status` now adds `startedAt`/`uptimeMs` from the PID file's mtime + a `bind` sub-object, and a new `GET /api/queue/stats` off a single race-safe `JobStore.stats()` `GROUP BY` query, `activeCount` kept a deliberately separate field from the DB `running` count) plus a redacted `GET /api/daemon/logs` tail (bounded read, `[0-9a-f]{64,}`/`Bearer` secrets scrubbed before the bytes leave the host); **Jobs** (the queue table + detail drawer + cancel/resume, plus a new lineage-preserving **`POST /api/jobs/:id/retry`** stamping `retriedFrom`); **Triggers** (the intended cron/webhook/event IA rendered **read-only**, "arrives in Slice 25" — no backend wiring yet); **Devices & Access** (bind posture + Tailscale/Cloudflare recipe cards, device pairing with a self-contained QR, revoke, and a break-glass root rotate). The biggest new backend surface is the first **positive** device registry (`~/.agent/devices.json`, beside the existing negative revocation set) behind a new `requireTrustedLocal` gate (session-guard **and** a genuinely loopback Host **and** allowed origin) on all three privileged-write routes (`GET/POST /api/devices`, `POST /api/devices/:id/revoke`, `POST /api/security/rotate-root`) — a Fable-led adversarial pass on this surface caught and closed two CRITICALs pre-merge (a captured-string session store that made `rotate-root` a silent no-op — fixed via a live root **getter** resolved per-call; and the boot-minted `'local'` token being servable to *any* client including a tunnel — fixed by injecting it into the served HTML only for a genuinely loopback `Host`) plus a fail-open empty-HMAC-key forgery vector in the root-token file (closed with atomic-write hardening). **Deployment note:** both loopback backstops trust the `Host` header, so a Tailscale/tunnel recipe in front of the daemon must forward the real tailnet/tunnel hostname, never rewrite it to `127.0.0.1`. Distinct from **Slice 26**'s already-shipped "remote-auth completion," which is OAuth to **remote MCP servers** — this slice's device pairing/rotate is auth **to our own daemon**, an orthogonal concern that happens to share the phrase "remote auth." See [`docs/architecture.md`](docs/architecture.md) §24.1/24.3/24.5, §"Jobs & Triggers Ops Console" | ✅ Done |
| **26** | **Alternate runtimes + remote-auth completion** (debt — gated on installing those runtimes/having creds, landed out of numeric sequence once both existed) — **Phase A:** `src/runtime/managed-openai-compatible.ts`'s `createManagedRuntime(strategy)` is the one control-surface implementation shared by **llama.cpp** (`strategies/llamacpp.ts`, `contextCapability:'relaunch'` — kills+respawns `llama-server -c <numCtx>`), **LM Studio** (`strategies/lmstudio.ts`, `'reload'` — `@lmstudio/sdk`'s `client.llm.load(model,{config:{contextLength}})` against the always-on daemon), and **MLX** (`strategies/mlx.ts`, `'fixed'` — `mlx_lm.server` has no context flag, so a requested context is honestly never applied); `process-supervisor.ts` owns spawn/health-poll/kill-on-timeout (fresh free port per relaunch, `breakerFor('runtime:'+kind)`); `mlx-server.ts` rewritten onto this base while preserving its external-baseUrl no-spawn compat path; `select-hook.ts` now calls `rt.control.warm(model, numCtx)` for every non-Ollama runtime; new `RUNTIME_*` telemetry (`telemetry/spans.ts`'s `withRuntimeSpan`); the LM Studio download adapter's job-status poll URL fixed (wrong since Slice 18). **Phase B:** `src/mcp/oauth-provider.ts`'s `createOAuthProvider` is a real `@ai-sdk/mcp` `OAuthClientProvider` (DCR/CIMD, PKCE + CSRF `state`, browser-loopback via `loopback.ts`, authorization-server metadata persistence) backed by `token-store.ts`'s atomic **0600** `~/.config/ai/mcp-tokens.json`; `with-mcp-run.ts` now actually builds an `authProvider` per OAuth config entry (previously never populated — OAuth always silently degraded); `mcp/client.ts`'s `mountMcpServer` completes the first-time handshake on `UnauthorizedError`; new `mcp.auth.*` telemetry. **Live-verified on real hardware:** all 3 managed runtimes end to end (llama.cpp `n_ctx=8192`, LM Studio `ctx=4096`, MLX fixed), both download adapters, a GitHub-PAT remote server, and a full Linear OAuth handshake (DCR→browser→exchange→47 tools; token-reuse with no browser on a second run) — this pass caught 3 real defects (poll URL, incomplete handshake, missing AS-metadata persistence), all fixed in-slice. New dep `@lmstudio/sdk`. See [`docs/architecture.md`](docs/architecture.md) §5 / §14 | ✅ Done |
| **27** | **Full multimodal I/O + uncensored** (Phase F, pulled in on demand ahead of the daemon) — new `src/media/` subsystem, media-by-reference throughout (a run-scoped `MediaStore` mints `img_N`/`aud_N`/`vid_N` handles; `[img:h]`/`[audio:h]`/`[video:h]` markers travel through the router/delegation boundary, never raw bytes). **Input:** `ingest.ts` (`--image`/`--audio`/`--video`/`--paste` + prompt-embedded path auto-detection, per-item graceful degrade), `audio/transcribe.ts` (`mlx-whisper` STT), `video/frames.ts` (`ffmpeg` frame-sampling → a frame-group handle), `resolve.ts` (handles → base64 AI-SDK v6 `FilePart`s); new **`vision`** specialist (`qwen2.5vl:7b`, `Capability.Vision`, selector-routed like any other specialist). **Generation:** `generate/adapter.ts`'s `MediaGenerator` (`ExecMode.OneShot|Server`, cancel-race-safe, wall-clock-timeout-guarded, `runGenJob` same-kind degrade dispatcher) backs mflux (image, via an ungated FLUX-schnell mirror), Kokoro/mlx-audio (speech), and LTX/mlx-video (video) strategies + a shape-only ComfyUI/Wan server lane; `generate_image`/`generate_speech`/`generate_video` tools on a new **`media_creator`** specialist. New `Capability.ImageGen/SpeechGen/VideoGen` type the taxonomy (not yet selector-consumed). **Uncensored** ships **default-ON**, two orthogonal mechanisms: model-eligibility (`policy.ts`, `select-hook.ts`'s `allowUncensored`) + Diffusers/ComfyUI safety-checker disable (`generate/safety.ts`, no-op on the filter-free default engines), plus `content_policy` run telemetry and a fail-safe voice-clone consent gate (`consent.ts`, orthogonal, cloning models only) and a `LEGAL_NOTE` string constant. New `INPUT_MODALITY`/`CONTENT_POLICY` attrs + `media.transcribe`/`media.frames`/`media.generate` spans. **Live-verified on real hardware:** vision, STT, video frame-sampling, image generation (real `mflux` PNG), speech generation (real Kokoro wav — `misaki[en]` auto-installed by `bun run setup:media`), and uncensored (a real pulled-and-run abliterated model). **Video *generation*:** the `mlx-video`↔`transformers` dependency conflict is **resolved** via an isolated video venv (`bun run setup:media`, `transformers==5.5.0` pinned) and the strategy's **CLI arg-correctness is live-verified** against the real CLI (caught + fixed `-n`→`--num-frames` + a required `--pipeline`); a full render is **disk-bound** on the dev Mac (LTX-2 is a 19B model, ~100 GB full repo vs. ~90 GB free) — the framework's hardware-adaptive "scales on a bigger box" case, not a code gap; the generation code itself is complete, unit-tested, reviewed, and now CLI-verified. ComfyUI/Wan server lane is shape-only (ComfyUI not installed). See [`docs/architecture.md`](docs/architecture.md) §22 | ✅ Done |
| **28** | **Hardware-adaptive media generation + reachable gen degrade** (Slice-27 follow-on) — a **parallel gen-fit selector** (`generate/select.ts` `selectGenModel`) prescribes a machine-appropriate generation model per modality: env-pin authoritative (`AGENT_{IMAGE,VOICE,VIDEO}_MODEL`) → uncensored filter → **largest-that-fits** by footprint vs the live hardware budget (`weightsBytes`/`liveBudgetBytes`) → installed/consent walk (`isGenModelInstalled` honors `HF_HOME`; consent-gate a pull, decline → next-installed) → `undefined` on no-fit (graceful degrade, never crashes). Candidate ladders in `generate/catalog.ts` (`GenModelCandidate`, **not** a `ModelDeclaration` — gen has no runtime/`LanguageModel`, so it rides a path *parallel* to the main selector). Chosen repo is injected via the existing `GenOpts.model` seam (image/speech unchanged; `ltxStrategy` gains `--model`, Wan graph gains a checkpoint node). `createGenerateTools` now runs via **`runGenJob`** (engine→strategy map, video passes the other-engine `fallback` + `serverReachable`) so the one-shot↔server degrade + ComfyUI/Wan lane are reachable; `runGenJob` drops the engine-specific repo when degrading cross-engine. `gen.fit.*` telemetry (`recordGenFit`). **Live-verified:** image auto-fit → real FLUX-schnell-4bit PNG, speech auto-fit → real Kokoro WAV, video degrades gracefully (no fitting model cached — auto-renders once one is present). Adversarial review caught + fixed 2 real bugs (env-pin engine misroute; enum-cast fallback). See [`docs/architecture.md`](docs/architecture.md) §22 | ✅ Done |
| **29** | **CLI voice input (STT), re-scoped** (Phase F) — new `src/voice/` subsystem: tap-to-toggle mic capture (`--voice`, ffmpeg `avfoundation` + `silencedetect` auto-stop) or file transcription (`--voice-in <path>`), transcribed via **sherpa-onnx** (moonshine-tiny model, `bun run setup:voice`) and spliced into the prompt exactly like `--audio`'s text-splice (§22). Transcription runs behind an execution seam — **in-process** `sherpa-onnx-node` (default, a day-1 spike confirmed it loads under Bun) or a **node-subprocess** worker (`AGENT_VOICE_EXEC=subprocess`) — chosen because the same recognizer family ships a browser-WASM build, reusable by Slice 30b's web UI. Auto-stop uses ffmpeg `silencedetect`, not a real-time VAD model — a disclosed refinement from the original re-scope. Degrade-never-crash: a missing model/addon, failed capture, or silence all warn + ledger rather than crash. Original "voice in/out + streaming CLI" scope was built and **reset** (archived on branch `slice-29-voice-streaming-cli`) — voice-out/barge-in/hold-to-talk deferred to Slice 30b's browser-native AEC. See [`docs/architecture.md`](docs/architecture.md) §23 | ✅ Done |
| **25** | **Scheduled + triggered agents** (Phase E) — a durable **poll-tick scheduler** (`src/triggers/`) living in the daemon converges four sources onto the Slice-24 queue through one `fire.ts` convergence point (chain-depth cap, overlap protection, `RunOrigin` provenance, a `trigger_firings` audit trail): **cron** (`scheduler.ts`/`next-run.ts`, Croner v10 as a library, atomic `BEGIN IMMEDIATE` claim of due rows, at-most-once fire-once-on-boot misfire catch-up), **webhook** (`POST /hooks/:token`, the only unauthenticated route class — outside the `/api` session guard, inside the Host/Origin perimeter: SHA-256 token-hash lookup, HMAC-SHA256 over the raw body with a ±5-minute replay window, a body cap, and the shared rate limiter), **file-watch** (`watcher.ts`/`confine.ts`, chokidar v4, path confinement re-checked at both creation and watch-start, `{{file.path}}` substitution), and **job-chain** (`chain.ts`, a `pool.ts` `onSettled` observer firing on terminal settle only, depth read from the finished job's persisted `chainDepth`). Two new tables (`triggers`/`trigger_firings`) share `jobs.db` via a combined migration superset; HMAC secrets persist to `~/.agent/trigger-secrets.json` (0600), never in the DB. Both authoring surfaces ship: repo TS defs (`triggers/index.ts`, the `crews/index.ts` pattern, synced at boot, pause/resume-only from the console) and full console/API CRUD (seven `requireTrustedLocal`-gated `/api/triggers*` routes). The Slice-25b stubbed Triggers tab is now a live list + create dialog + firings drawer (`web/src/features/ops/`); a new `agent triggers` CLI mirrors the daemon CLI's shape. See [`docs/architecture.md`](docs/architecture.md) §"`src/triggers/` — trigger engine" | ✅ Done |
| **30a** | **Concurrency & lifecycle core + ops surface** (Phase F/ops — production foundation ahead of the web UI, split out after a production-readiness audit) — **Concurrency & lifecycle:** collision-free run ids (`run/run-id.ts` `newRunId()`, replacing collision-prone `run-<pid>`); a **per-run telemetry router** (`telemetry/run-router.ts` — one global OTel provider fronted by a `RunRoutingSpanProcessor` that routes spans by run-id-in-context, replacing the old process-global `setGlobalTracerProvider` swap that corrupted concurrent runs); cooperative **cancellation** (`withWallClock(ms, fn(signal), external?)` now actually aborts the work it races, not just the timer; an `AbortSignal` threads `runChat`→`runOrchestrator`→`runDefinedAgent`→`runAgent`→`generateText` — wired end to end, no live trigger yet); a central child-process registry + signal-clean shutdown (`process/child-registry.ts` + `process/lifecycle.ts` — `SIGINT`/`SIGTERM` drains `onShutdown` callbacks then kills every registered child); sqlite `WAL`+`busy_timeout`; a model-manager admission mutex (serializes `ensureReady`, empirically closes a concurrent-load race); `db/migrate.ts` schema migrations + a memory embedder-mismatch guard (`ensureSpace` now throws instead of silently serving a stale embedder). **Ops surface:** a structured, run-id-stamped logger (`log/logger.ts`); a documented config schema (`config/schema.ts`, 64 `AGENT_*` entries, `bun run config`); `bun run status` (Ollama reachability, loaded models, live RAM, version); app versioning (`0.2.0`, `--version`, `bun run start` — the 30b web-UI scaffold entry point); a top-level error boundary (`errors/boundary.ts`, actionable hints + `error.json` persistence); a usage rollup (`bun run usage`, aggregates token/latency from existing `spans.jsonl`); and the **first CI pipeline** (`.github/workflows/ci.yml` — docs:check → typecheck → lint → test on every push/PR). Full suite 1108 pass/36 skip/0 fail. See [`docs/architecture.md`](docs/architecture.md) §§4, 7, 11, 21 | ✅ Done |
| **30b** | **Local web UI — Phases 1 (web backend) + 1b (frontend scaffold) + 2 (streaming chat + live rail) + 3 (Runs history + live trace waterfall) + 4 (Crews & Workflows browse/run/watch) + 5 (Builders + Library) + 6 (Persistence + product) + 7 (Browser voice input) + 8 (Polish + a11y + observability)** (Phase F, multi-phase slice, stacks on 30a) — **Phase 1:** an isomorphic Zod wire protocol (`src/contracts/`: enums, read-model DTOs, transient-SSE `StatusEvent` union, inbound request schemas) + a thin `Bun.serve` BFF (`src/server/`: per-session bearer token, port-scoped Host/Origin allowlist, realpath media-path confinement, `/api/health`, COOP/COEP static serving, `server.request` telemetry, `bun run web`); live-verified against the real running server (curl + Chrome). **Phase 1b:** the browser frontend scaffold — `web/` as a Bun workspace member (Vite 8 + React 19 + Tailwind v4 + Vitest/happy-dom), Blueprint-Mono light+dark design tokens + `ThemeProvider`, Base-UI `Button`/`Dialog` + per-region error boundary, a token'd contract client + a bidirectional transport-port **interface** (both via a `@contracts` alias), a TanStack Router app shell over the 7 nav areas + run-detail, and a ⌘K palette skeleton (26 web component tests). **Phase 2:** turns Chat live — `POST /api/chat` streams the top-level orchestrator's answer token-by-token (specialists stay batch, narrated via a new `EventSink`) over an AI-SDK v6 UI-message SSE response, built on additive engine seams (`core/events.ts`'s `EventSink`, `core/agent.ts`'s `StreamSink`/`streamText` path draining inside `withWallClock`, `cli/run-chat-session.ts`'s shared CLI/server turn runner); the server adds `POST /api/runs/:id/respond` (consent back-channel, unguessable `promptId`), `POST /api/upload` (confined image upload — a security finding here, D17, closed the server-side `ingestMedia` auto-detect hole an HTTP-attacker could otherwise reach), and `POST /api/feedback`; the web app ships a real streaming `features/chat/` (`useChat`+`DefaultChatTransport`, AI-Elements/`streamdown`) with Stop/copy/regenerate/edit-resend/👍👎/data-confirm/drag-drop-upload, plus `features/agents/`'s live agent/model rail. Chat stays **stateless per request** (no `SessionStore` — Phase 6). **Phase 3:** Runs history + live trace waterfall — three new `GET` endpoints (`src/server/runs/{list,detail,stream}.ts`, `confineToDir`-guarded `:id` on both detail and stream, a new `runsRoot` server dep) backed by a new `src/run/run-dto.ts` mapper (`mapRunToDto`/`summarizeRunListItem`, an mtime-keyed summary cache, a shared name-agnostic run-root helper so `crew.run`/`workflow.run` roots report correctly too) and `src/run/artifacts.ts` (`readRunArtifacts`, the extended `ArtifactKind`); the web ships a searchable/faceted/paginated Runs list and a run-detail view whose `@visx` waterfall live-tails a running trace via the Phase-1b transport port's first real consumer (`stream(runId, cursor, schema)`). **Phase 4:** Crews & Workflows browse/run/watch — new browse endpoints (`src/server/crews/`, `src/server/workflows/`) project the `CREWS`/`WORKFLOWS` registries via new pure mappers (`crew-dto.ts`/`workflow-dto.ts`, edges via `effectiveDeps` verbatim) to list/detail DTOs; a **fire-and-watch** launch (`POST .../:id/run` → `launch-turns.ts`, the same `withMcpRun`+`runCrewCli`/`runFlow` path the CLIs use, run **detached**, `error.json` on throw, adversarially reviewed) mints a runId and returns immediately; the browser then reuses Phase 3's `GET /api/runs/:id/stream` **verbatim** to watch it, overlaying live per-step status on a new generic `@xyflow/react` `DagView` (`web/src/shared/dag/`) fed by process-aware `workflowGraph`/`crewGraph` (D7a — sequential crews render a task-DAG, hierarchical crews a manager→members delegation star); a new `RunKind`-based kind facet makes launched runs findable in the Runs list. Two documented limitations: hierarchical crews never light up (no per-step spans to overlay) and the graph is only reliably drawable once the run's root span closes for a cold-opened run (worked around for the primary flow via a URL-param handoff). **Phase 5:** Builders + Library — the last two stub nav areas go live. A new `POST /api/builders/build` SSE route streams a guided agent/crew/workflow build wizard (narration + mid-flow `data-confirm` consent/reuse-offer + a one-shot terminal `BuildResultDTO`), wrapping the pre-existing `agent.build`/`crew.build` spans with no new span kind (adversarially reviewed, 2 Opus lenses). `GET /api/models` + `POST /api/models/pull` add a Models tab (provider-agnostic inventory, fire-and-watch pull) whose live progress rides a **pull→spans bridge** — each tick is its own short-lived `model.pull.progress` child span, so the **existing** `GET /api/runs/:id/stream` surfaces it with zero new stream code (also adversarially reviewed). `GET /api/mcp` + `POST /api/mcp/add` + `POST /api/mcp/test-mount` add an MCP tab whose test-mount is the `ConsentRegistry`'s **first real caller**, closing decision D10 (a never-approved server can now get real interactive consent + OAuth from the browser); `src/mcp/mount.ts` has zero diff. `GET /api/memory/spaces` + recall/ingest give memory its first web consumer (fork-3 confined upload-then-ingest). Deferred, not silently dropped: media-gen model management (read-only-at-most), no ANN index, recall not yet wired into chat, MCP entries addable/testable but not editable/removable. **Phase 6:** Persistence + product — chat survives a reload via a new `src/session/` `SessionStore` (`bun:sqlite`, mirrors `createMemoryStore`'s shape) that persists a client-minted `sessionId` (v4-UUID-regex-validated) through idempotent `INSERT OR IGNORE` upserts; `POST /api/chat` persists the user message before any engine work and the assistant message only after `runChatTurn` resolves (turn-boundary persistence, adversarially reviewed); `GET/PATCH/DELETE /api/sessions(/:id)` + `GET /api/sessions/:id/export` give the browser a real Sessions history (search/cursor-paginated list, detail/rehydrate, rename, delete, bearer-fetched Markdown export); `runChatSession` gains an optional `memoryStore` so recall reads a dedicated `chat` memory space and every completed turn auto-ingests itself back in via a new `rememberOnce` (content-hash-deduped, fire-and-forget); a client-side `AppShell` hook polls `GET /api/runs` and diffs lifecycle transitions (baseline-then-diff, adversarially reviewed) to fire a toast plus an optional OS `Notification` on a qualifying long-run completion. Honest caveats: `parentMessageId` is written but unused (reserved for Slice 41); no JSON export; no server-push/global SSE event bus; no session retention/GC; the CLI gets the recall READ benefit only. **Phase 7:** a Composer mic button (hold-to-talk + VAD-gated tap-to-toggle) transcribes speech client-side via transformers.js + Moonshine + Silero VAD (D1 — overriding the parent spec's sherpa-onnx-WASM assumption), writing interim/final text into the existing composer `value` state; no new server route, no new telemetry span (the transcript rides the resulting chat turn's existing span). **Phase 8 (the 30b finale):** WCAG 2.1 AA accessibility (`:focus-visible` ring token + `.sr-only`, real `<label>`s, `aria-pressed`/`aria-label` coverage, roving-tabindex Library/Builders tabs, `useReducedMotion`-gated `DagView` motion, a `vitest-axe` regression net that caught + fixed 3 unlabeled `/runs` `<select>`s); progressive-decode interim ASR (`TextStreamer`/`transcribeInterim`, per-segment-token guarded — not real-time-during-speech) + a one-pole anti-alias downsample filter; a completed ⌘K (discriminated nav/action `Command` union, voice/theme toggles, deduped jumps, jump-to-recent-run); the D9 `chat.run`-vs-`agent.run` root-span split (`deriveRunKind`→`Chat`, fixing the false-positive completion toast on long chat turns, plus the CLI `RUN_ROOT_NAMES`/`TERMINAL_RUN_ROOTS` blast-radius fix); and the first client→server telemetry (`POST /api/telemetry`, token carried in the `sendBeacon` JSON body + handler-verified timing-safe — not a `?k=` URL token — new `voice.transcribe.web` span, distinct from the CLI's `voice.transcribe`). Barge-in/TTS voice-out and real-time-during-speech ASR remain explicit future scope, not debt. See [`docs/architecture.md`](docs/architecture.md) §Contracts, §Server, §"Web frontend", §"Streaming chat", §"Runs", §"Crews & Workflows", §"Builders + Library", §"Persistence — Sessions + chat recall", §"Voice (web UI — Slice 30b Phase 7)", §"Telemetry (web UI — Slice 30b Phase 8)", §"Accessibility (a11y, web UI — Slice 30b Phase 8)" | ✅ Done |
| **31** | **Multi-machine + A2A interop** (Phase E, web-focused — closes Phase E) — one hand-rolled **A2A v1.0** layer (JSON-RPC over HTTP+SSE; not `@a2a-js/sdk`, still v1.0-beta) over the Slice-24 daemon/queue, driven from a new Ops-console **Federation tab**. **EXPOSE:** `GET /.well-known/agent-card.json` (public discovery, outside the `/api` guard, `404` fail-safe while `AGENT_A2A_ENABLED` is off — default off) advertises skills 1:1 from a least-privilege allowlist (`src/a2a/allowlist.ts` — only registered Chat/Crew/Workflow refs, author-time **and** invoke-time resolve-then-reject); `POST /api/a2a` (JSON-RPC `message/send`/`tasks/get`/`tasks/cancel`) verifies a SEPARATE A2A-Bearer credential (D5, distinct token domain from a browser device session, sharing only the root HMAC key) **before the body is even parsed**, then a replay guard (nonce+timestamp), then maps the (untrusted-fenced) inbound task onto the **same** `JobStore.enqueue` (`origin=Remote`, `taskId===jobId`); `message/stream`/`tasks/resubscribe` re-frame the **existing** run-stream SSE engine (no parallel stream) into A2A `TaskStatusUpdateEvent`/`TaskArtifactUpdateEvent` frames. **CONSUME:** `src/a2a/client.ts` discovers + hash-pins a remote's card (SSRF-guarded via the existing `redirect:'error'` fetch, timeout+size-capped, a hash mismatch is a HARD reject — never a silent re-pin) and `src/a2a/mount.ts` shapes a `delegate_to_<name>` `ToolSet` matching the MCP mount's failure-returns-not-throws contract (send→poll-to-terminal, per-remote circuit breaker) — **honestly not yet spliced into a live chat/crew/workflow session's own tool set** this slice (`mountAll`/`loadMcpConfig` never reads the remote store); today's real CONSUME surface is discover→pin→persist plus manual invocation via `agent a2a call` or the Federation tab's recent-remote-tasks history (reusing the existing Runs browser, zero new run-history plumbing). New `agent a2a skills|token|remotes|call|card` CLI mirroring `agent daemon`'s shape. Adversarial review caught + fixed **three real defects**: a non-exposable `JobKind` could slip past the allowlist's least-privilege check, a terminal SSE frame could arrive before a same-poll child's progress frame (data loss on a spec-conformant client), and the consume-side delegate loop originally returned `message/send`'s `submitted` shell as if it were the answer (every real delegation would have failed). See [`docs/architecture.md`](docs/architecture.md) §"`src/a2a/` — A2A interop" | ✅ Done |
| **Next (product line)** | Toward a local **n8n × CrewAI**: **Slice 30b is fully shipped** (all 8 phases — dictation-only voice; barge-in remains explicit future scope, not debt); **Slice 23** (AI SDK v6→v7 upgrade) ✅ **shipped** (2026-07-19), clearing the dependency-line hold; **Slice 24** (always-on daemon + task queue + resumable jobs + secure remote access) ✅ **shipped**; **Slice 25b** (Jobs & Triggers Ops Console) ✅ **shipped**; **Slice 25** (the triggers backend — cron/webhook/file-watch/job-chain enqueuing onto the Slice-24 queue, live-wiring the console's Triggers tab) ✅ **shipped**; **Slice 31** (multi-machine + A2A interop) ✅ **shipped** — **Phase E is now complete**; **next: the committed 32–37 backlog** (see [`docs/ROADMAP.md`](docs/ROADMAP.md)'s recommended sequence); Codex heavy-lifting backup (Slice 22) stays deferred to the very end (Slice 38) | Planned |

**Full long-range roadmap** — the n8n × CrewAI vision, the six product phases,
the continuous hardware-aware engine line, and the recommended sequence:
[`docs/ROADMAP.md`](docs/ROADMAP.md). Design specs and implementation plans live
in [`docs/superpowers/`](docs/superpowers/).

---

## Development

```sh
bun run test -- -t "test name"      # single test by name
bun run test:file -- ./tests/...    # a specific test file
bun run lint -- --write             # auto-fix lint/format
```

- **Stack:** TypeScript + Bun + Vercel AI SDK 6. Pinned: `ai@^6` (not v7 — it
  renames APIs), `ollama-ai-provider-v2@^3`, `@ai-sdk/mcp@^1`,
  `@modelcontextprotocol/sdk@^1`, `zod@^4`.
- **Style:** small single-responsibility files, plain self-explanatory code,
  typed errors, string enums. Tests verify real behavior (the agent loop is
  tested against AI SDK's mock model; the MCP path is a real subprocess
  round-trip).
- **First clone:** run `bun run setup` once to activate the git hooks
  (`.githooks/`). `bun run check` runs the full pre-PR gate
  (docs-check · typecheck · lint · tests).
- **CI (Slice 30a):** `.github/workflows/ci.yml` runs the same gate
  (docs:check → typecheck → lint → the mock test suite) on every push to
  `main` and every PR — the framework's first automated pipeline; live
  (`*.live.test.ts`) tests need a running Ollama and stay local/manual.

---

## Documentation

Start at the **[documentation map](docs/README.md)** — the index of every
maintained doc. The key references:

- **[`docs/architecture.md`](docs/architecture.md)** — the living technical map: module/dependency graph, runtime data-flow, every subsystem and mechanism.
- **[`docs/ROADMAP.md`](docs/ROADMAP.md)** — the long-range plan (local-first n8n × CrewAI, phases A–F).
- Module docs: [`agents/README.md`](agents/README.md), [`model-images/README.md`](model-images/README.md). Per-slice design records: [`docs/superpowers/`](docs/superpowers/).

**The hard line:** documentation stays current with the code — a stale doc is a
defect, not debt. Every slice updates `architecture.md` (and this map if a doc
is added/renamed); the slice's final review audits the doc against the diff for
accuracy. Enforced by `bun run docs:check` (pre-commit) and a pre-push currency
gate. See the [documentation map](docs/README.md) for details.
