# Slice 30b Phase 3 (Runs) — Runs history browser + live trace waterfall — design

**Date:** 2026-07-15
**Branch:** `slice-30b-phase3-runs` (off `main`)
**Status:** design (brainstormed + APPROVED with user, 2026-07-15) — spec written for planning
**Builds on:** Slice 30b Phase 1 (contracts + BFF + perimeter), Phase 1b (frontend scaffold + routes + transport port), Phase 2 (streaming chat + live rail).
**Diagram:** [`docs/diagrams/slice-30b-phase3-runs/phase3-runs.excalidraw`](../../diagrams/slice-30b-phase3-runs/phase3-runs.excalidraw) (produced alongside this spec).

## Context & framing

Phases 1–2 gave the web UI a chat surface driven by the real engine over SSE, plus a live
"rail" that folds transient status events into an at-a-glance run view. What they did **not**
give is any way to look *back*: every run already writes `runs/<id>/spans.jsonl` (+ artifacts,
+ `degradation.jsonl`, + `error.json`) that the CLI renders (`bun run runs`, `src/cli/runs.ts`),
but the browser has no runs history and no trace detail. The detail DTOs (`RunDTO`, `SpanDTO`,
`DegradeDTO`) were shipped in Phase 1 *specifically so Phase 3 can emit them* — they exist and
are unused today.

Phase 3 closes that gap: a **rich Runs history browser** plus a **run-detail trace waterfall**,
fed by a new **span→DTO mapper** that reads the same on-disk artifacts the CLI reads and
projects them through the Phase-1 contracts. It is also the **first real consumer of the
resumable transport port** (`ChatTransport.stream(runId, cursor)`): the run-detail waterfall
**live-tails** an in-flight run, and the SSE adapter shipped in Phase 2
(`web/src/shared/transport/sse-adapter.ts`) already targets `GET /api/runs/:id/stream` — an
endpoint that is *declared but unbuilt server-side*. Phase 3 builds it.

**Landing pattern (same as Phases 1/1b/2 — a PARTIAL slice).** README and ROADMAP mark **Phase 3
landed**, but the slice-30b capability is **NOT** flipped to ✅ — Phases 4–8 remain. Everything
stays **stateless per request**: the mapper re-reads from disk on each request (with an
mtime-keyed in-memory summary cache for the list). There is **no `SessionStore` and no run
persistence layer** — that is Phase 6.

## Goal (one sentence)

Give the web UI a rich, searchable Runs history and a live-tailing per-run trace waterfall,
fed by a new stateless span→DTO mapper that projects the real engine's on-disk spans/artifacts
through the Phase-1 contracts.

## Locked scope decisions (agreed with user, 2026-07-15 — stated as decided, not open)

- **D1 — Visualization = @visx waterfall ONLY.** A Gantt-style timeline: x = `offsetMs`,
  bar width = `durationMs`, row = span `depth` (tree/offset order), colour = `status`
  (ok/error) + `degraded`. **No `@xyflow` node-graph** (deferred; may never be needed for a
  trace whose natural shape is a timeline, not a free graph).
- **D2 — Telemetry-gap closures = cheap + high-value only.** (a) Read
  `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` off the AI-SDK spans into
  `SpanDTO.tokens`, summed into `RunDTO.tokens`. (b) Extend `ArtifactKind` so
  result/resource/unverified/failed/error/media files classify instead of all falling to
  `Other`. (c) Synthesize `RunLifecycle` from run state/outcome. **Leave `node`, `origin`, and
  `server.principal` reserved** (constant/omitted) — they belong to later slices (24/25/33/35/38).
- **D3 — Runs list = RICH.** Text search + `outcome`/`degraded` facets + pagination
  (cursor-based). Not a bare list.
- **D4 — Run-detail = LIVE-TAILING.** The waterfall updates as an in-flight run progresses,
  consuming the resumable transport port. This is the first real consumer of
  `ChatTransport.stream(runId, cursor)` and the reason the Phase-1b port + Phase-2 SSE adapter
  were built.

---

## Layer ① — Contracts (`src/contracts/`)

The **detail DTOs already exist and are Phase-3-ready** (Phase 1 shipped them; Phase 3 is their
first emitter). Verified against `src/contracts/dto.ts`:

- **`SpanDtoSchema` / `SpanDTO`** — `spanId`, `parentSpanId: string | null`, `name`, `offsetMs`,
  `durationMs`, `depth`, `status: SpanStatus`, `statusMessage?`, `agent?`,
  `delegation?: { target, depth, ancestors[] }`, `model?: { id, provider?, numCtx?,
  footprintBytes?, runtimeDegraded? }`, `tokens?: { input?, output? }`, `degraded: boolean`,
  `node?` (reserved), `attributes: Record<string, unknown>`, `events: { name, offsetMs,
  attributes? }[]`.
- **`RunDtoSchema` / `RunDTO`** — `id`, `owner` (reserved constant `"local"`),
  `origin: RunOrigin`, `lifecycle: RunLifecycle`, `startMs`, `durationMs`, `outcome: string`,
  `models: string[]`, `contentPolicy?`, `tokens?`, `degraded: boolean`,
  `degrades: DegradeDTO[]`, `malformedSpans`, `spanCount`, `roots: string[]`,
  `spans: SpanDTO[]`, `artifacts: { name, bytes, kind: ArtifactKind }[]`.
- **`DegradeDtoSchema` / `DegradeDTO`** — `kind: DegradeKind`, `label`, `subject`, `reason`,
  `from?`, `to?`, `attempts?`, `lane?`, `spanId?`.
- **`TokensSchema`** — `{ input?: number, output?: number }` (optional); the mapper tolerates
  absence (telemetry gap #1). Reused for both `SpanDTO.tokens` and `RunDTO.tokens`.

**ADD to `src/contracts/dto.ts`:**

- **`RunListItemDtoSchema` / `RunListItemDTO`** — a lightweight list summary carrying **no
  `spans` and no `artifacts`** (the whole point of the cache; see Layer ②):
  `id`, `startMs`, `durationMs`, `outcome: string`, `lifecycle: RunLifecycle`,
  `origin: RunOrigin`, `models: string[]`, `degraded: boolean`, `spanCount: number`,
  `tokens?: TokensSchema`.

**ADD to `src/contracts/requests.ts`:**

- **`RunListQuerySchema`** — `{ search?: string, outcome?: string, degraded?: boolean,
  limit: number, cursor?: string }`. (`limit` carries a sensible default via `.default(...)`;
  `cursor` is the opaque pagination token — an encoded `startMs`/`id` boundary.)
- **`RunListResponseSchema` / `RunListResponse`** — `{ items: RunListItemDTO[],
  nextCursor?: string, total: number }`.

**EXTEND `ArtifactKind` in `src/contracts/enums.ts`** (additive / forward-compatible; the enum
comment already reads *"mapper-side readdir+classify; Slice 30b Phase 3"*). Existing members:
`Answer`, `Gap`, `Spans`, `Degradation`, `Other`. **Add:** `Result`, `Resource`, `Unverified`,
`Failed`, `Error`, `Media`. Pure additions — no member is renamed or removed, so every existing
consumer stays valid.

**Isomorphism guard (unchanged rule):** contracts import **nothing but zod** — no reliability,
no telemetry, no fs. `DegradeKind`/`RunOrigin`/`RunLifecycle`/`SpanStatus`/`ArtifactKind` stay
redeclared enums; the mapper (engine-side) maps *into* these types but never the reverse.

---

## Layer ② — The span→DTO mapper (`src/run/run-dto.ts` + `src/run/artifacts.ts`, NEW)

Both files are engine-side but **import only `@contracts` types** (contracts is zod-only /
isomorphic). Their output **must validate against `RunDtoSchema` / `SpanDtoSchema`** — a mapper
unit test parses the output through the schema.

### `src/run/run-dto.ts`

Mirror the existing readers in `src/run/run-trace.ts` (which already power `bun run runs`):

1. **`readSpans(runDir)`** → `{ spans: SpanRecord[], malformed }` — reuse as-is (from
   `run-trace.ts`); it tolerates a missing/partly-written `spans.jsonl` and counts malformed
   lines. `SpanRecord` shape is `src/telemetry/jsonl-exporter.ts` (`startUnixNano`,
   `endUnixNano`, `durationMs`, `status: { code, message? }`, `attributes`, `events[]`, …).
2. **`buildTree(spans)`** → `TraceNode[]` — reuse as-is; parent/child tree sorted by
   `startUnixNano`, roots first.
3. **Walk the tree to assign `depth`** (root = 0, child = parent+1), then **FLATTEN to
   `SpanDTO[]`** in tree/offset order, computing per span:
   - `offsetMs = (span.startUnixNano - rootStartUnixNano) / 1e6` where `rootStartUnixNano` is
     the earliest root's `startUnixNano` (nanoseconds → ms).
   - `durationMs` = `span.durationMs` (already ms, exact per the exporter comment).
   - `status` = `span.status.code === 2 ? SpanStatus.Error : SpanStatus.Ok`
     (OTel `SpanStatusCode.ERROR === 2`); `statusMessage` = `span.status.message`.
   - Typed sub-objects projected from the `ATTR.*` attribute keys (`src/telemetry/spans.ts`):
     `agent` (from delegation/run attrs), `delegation` (`ATTR.DELEGATION_TARGET`,
     `ATTR.DELEGATION_DEPTH`, `ATTR.DELEGATION_ANCESTORS`), `model`
     (`ATTR.MODEL_ID`/`MODEL_PROVIDER`/`MODEL_NUM_CTX`/`MODEL_FOOTPRINT_BYTES`/
     `MODEL_RUNTIME_DEGRADED`).
   - `tokens` = `{ input?: attrs[ATTR.USAGE_INPUT_TOKENS], output?: attrs[ATTR.USAGE_OUTPUT_TOKENS] }`
     when present — these land **only on AI-SDK generation spans**, so most spans have no
     `tokens` (schema optional).
   - `degraded` = span carries a `reliability.degrade` event or a degrade attribute.
   - `attributes` passed through as `Record<string, unknown>`; `events` mapped to
     `{ name, offsetMs, attributes? }` with each event's `offsetMs` relative to the same root.
   - `node` **omitted** (reserved, D2).
4. **`degrades`** — read `runs/<id>/degradation.jsonl`, one JSON `DegradeEvent` per line (shape
   from `src/reliability/ledger.ts` `serializeLedger` — `{ kind, subject, reason, detail?,
   from?, to?, attempts?, lane? }`), map to `DegradeDTO[]` (add `label` from the `DegradeKind`
   and carry `spanId` when correlatable). `RunDTO.degraded` = `degrades.length > 0`.
5. **`models`** — distinct `ATTR.MODEL_ID` values across all spans (same as `summarizeRun`).
6. **`tokens` (run roll-up)** — sum of per-span `tokens.input` / `tokens.output` (undefined when
   no span carried usage; telemetry gap #1 tolerance).
7. **`contentPolicy`** — `ATTR.CONTENT_POLICY` off the `agent.run` root when present.
8. **`outcome`** — `ATTR.OUTCOME` off the `agent.run` root, else `"unknown"` (same as
   `summarizeRun`).
9. **`origin`** = `RunOrigin.Manual` (reserved constant, D2); **`owner`** = `"local"`
   (reserved constant).
10. **`lifecycle` synthesis (D2c):** `RunLifecycle.Running` if the `agent.run` root span has no
    end recorded (in-flight / spans.jsonl still growing); else `RunLifecycle.Failed` when the
    root status is error or `outcome` is a failure kind (e.g. `resource`), else
    `RunLifecycle.Done`. (`Queued`/`PausedAwaitingInput`/`Resumable` stay reserved for
    Slices 24/25/34/38 — this synthesis only ever emits `Running`/`Done`/`Failed`.)
11. **`malformedSpans`** = the `malformed` count from `readSpans`; **`spanCount`** =
    `spans.length`; **`roots`** = root span ids.

Export the primary entry `mapRunToDto(runsRoot, id): Promise<RunDTO | undefined>` (undefined
when the run dir has no spans, mirroring `summarizeRun`).

**`summarizeRunListItem(runsRoot, id): Promise<RunListItemDTO | undefined>`** — the list-cheap
projection. It still reads `spans.jsonl` to compute `spanCount`/`models`/`lifecycle`/`tokens`,
so to avoid re-reading every run's full `spans.jsonl` on every list request it is fronted by an
**mtime-keyed in-memory summary cache**: keyed by run dir + its `stat().mtimeMs`; a cache hit
returns the memoized `RunListItemDTO`, a miss (or changed mtime = in-flight run still being
written) recomputes. Note in-code **why**: the rich list would otherwise be O(runs × spans/run)
disk reads per keystroke-driven request; a real persisted index is **Phase 6**, this cache is
the stateless-friendly interim.

### `src/run/artifacts.ts`

`readRunArtifacts(runDir): Promise<{ name, bytes, kind: ArtifactKind }[]>` — `readdir` the run
dir (with file sizes via `stat`) and classify each entry into the **extended** `ArtifactKind`:

| file / entry        | `ArtifactKind` |
|---------------------|----------------|
| `answer.txt`        | `Answer`       |
| `gap.txt`           | `Gap`          |
| `resource.txt`      | `Resource`     |
| `result.txt`        | `Result`       |
| `unverified.txt`    | `Unverified`   |
| `failed.txt`        | `Failed`       |
| `spans.jsonl`       | `Spans`        |
| `degradation.jsonl` | `Degradation`  |
| `error.json`        | `Error`        |
| `media/` (dir)      | `Media`        |
| anything else       | `Other`        |

`bytes` = file size (for `media/`, the directory's rolled-up size or entry count — keep it
simple: sum of contained file sizes). This is the second half of D2b.

---

## Layer ③ — Server endpoints (`src/server/runs/`, wired in `src/server/app.ts`)

Three read endpoints, all **GET**, all behind the **existing perimeter** (token guard +
Host/Origin check — already shipped Phase 1; `handleApi` runs only after `guard.verify` and
`enforcePerimeter`). All three route through the existing `withServerRequestSpan` that
`handleApi` already opens for every `/api` request (route/method attrs).

`ServerDeps` (`src/server/app.ts`) gains a **`runsRoot: string`** field (today
`src/server/main.ts:52` holds `const runsRoot = 'runs'` locally and only threads it into the
engine + uploads dir; Phase 3 also passes it into `deps`).

1. **`GET /api/runs?search=&outcome=&degraded=&limit=&cursor=`** → `RunListResponse`.
   Parse the query via `RunListQuerySchema`; `readdir(runsRoot)` for run dirs; `summarizeRunListItem`
   (cache-fronted) each; filter by `search` (substring over id/models/outcome), `outcome`
   facet, `degraded` facet; **sort desc by `startMs`** (newest first); paginate by `cursor`/`limit`.
   `total` = filtered count; `nextCursor` = boundary token when more remain.
2. **`GET /api/runs/:id`** → full `RunDTO` via `mapRunToDto`. 404 (`{ error: 'not found' }`)
   when the mapper returns undefined.
3. **`GET /api/runs/:id/stream`** → **SSE run-stream** (the endpoint the Phase-1b transport
   port + Phase-2 SSE adapter already target). It:
   - emits an **initial snapshot** of the run's existing spans as `SpanDTO` SSE events (each
     frame carries an `id:` = the span's ordinal/`spanId` so the client can resume), then
   - **tails** `runs/<id>/spans.jsonl` — `fs.watch` (or a bounded poll) + read-from-offset —
     emitting each newly-appended span as a `SpanDTO` event **until the `agent.run` root span
     closes** (mirrors the CLI `--follow` stop condition in `src/cli/runs.ts`: stop once a span
     named `agent.run` with an end is present), then ends the stream.
   - supports **`Last-Event-ID` / cursor resume**: on reconnect, replay only spans after the
     given cursor (the adapter sends `Last-Event-ID`; `fromCursor` in the port).

**Security (path-traversal defense, D17 spirit):** the `:id` path segment MUST be confined via
**`confineToDir(id, runsRoot)`** (reuse `src/server/security/media-path.ts`'s primitive — it
realpath-resolves and rejects `../`/symlink/absolute escapes with `MediaPathError`). A
`MediaPathError` maps to a 404 (never leak whether it was traversal vs. missing), consistent
with how `serveStatic` already treats it.

**Telemetry:** the tail (endpoint 3) is additionally wrapped in a **new `runs.stream` span**
that mirrors `withUiStreamSpan` (`src/telemetry/spans.ts`) — recorder shape `{ chunk(bytes),
resume(), outcome(o) }`, aggregates `chunks`/`bytes`/`resumes`/`outcome` set in a `finally`.
Add a `withRunStreamSpan({ route, runId }, fn)` helper alongside `withUiStreamSpan` (reuse the
existing `UI_STREAM_*` ATTR keys, or add parallel `RUN_STREAM_*` keys — an implementation
detail for the plan). As with chat, `withServerRequestSpan` measures time-to-first-response and
`runs.stream` measures the body pump.

Routing wires into `handleApi` alongside the existing `/api/runs/:id/respond` regex match: add
`GET` matches for `^/api/runs$`, `^/api/runs/([^/]+)$`, and `^/api/runs/([^/]+)/stream$` (order
the stream/detail matches before the bare-id match). Keep the thin-BFF discipline: the handlers
own no reasoning — they call the mapper and stream from disk.

---

## Layer ④ — Web feature (`web/src/features/runs/`)

**Deps (`web/package.json`, installed with `bun`):** add the **minimal** @visx set —
`@visx/scale`, `@visx/shape`, `@visx/axis`, `@visx/group`, `@visx/tooltip`. **Not `@xyflow`**
(D1). No other runtime deps.

- **`index.tsx` (`RunsArea`)** — replaces the Phase-1b stub. The **rich list** (D3): a search
  box, `outcome` + `degraded` facet controls, and pagination. Fetches via the established
  contract client — `apiFetch('/runs?<query>', { schema: RunListResponseSchema })`
  (`web/src/shared/contract/client.ts` prepends `/api` and injects the bearer token; query
  string is baked into the path since `apiFetch` takes a path). Rows link to `/runs/$runId`
  (route already registered in `web/src/app/router.tsx`). Wrap the whole area in
  `RegionErrorBoundary region="Runs"` (same pattern as `ChatArea`). Consume Blueprint-Mono
  design tokens (`var(--color-*)`) — never raw hex.
- **`run-detail.tsx` (`RunDetail`)** — replaces the Phase-1b stub (the route already reads
  `runId` via `useParams({ from: '/runs/$runId' })`). Flow:
  1. Fetch `GET /api/runs/:id` for the **snapshot** (`apiFetch('/runs/' + runId, { schema:
     RunDtoSchema })`).
  2. Open the **run-stream** via the transport port —
     `createSseTransport().stream(runId, cursor)` — for live-tailing (D4).
  3. A **`use-run-trace.ts`** reducer-fold hook (**mirror `use-status-events.ts`**: `useState`
     + `useCallback` + a **pure `fold` function** over incoming `SpanDTO`s) merges the snapshot
     + streamed deltas into a single trace view, de-duping by `spanId` and tracking the last
     seen `eventId` as the resume cursor.
  4. Renders the waterfall; a busy indicator while `lifecycle === Running`.
- **`waterfall.tsx`** — the **@visx Gantt** (D1): a `scaleLinear` time axis (domain `0 →
  maxOffset+maxDuration`), one row per span in tree/offset order, bar `x = scale(offsetMs)`,
  `width = scale(durationMs)`, row `y` from `depth`/index. Colour by `status` (ok vs. error) +
  `degraded`. Click a bar → a **span-detail side panel** showing the span's
  attributes/events/model/tokens. Tokens/design via `var(--color-*)`.
- **`web/src/shared/design/tokens.css`** — **ADD a `--color-danger` token** (light + dark) for
  error spans; none exists today (the file currently defines bg/surface/fg/muted/border/backdrop +
  accent/signal). Follow the file's split: define the literal under `:root` (dark) and
  `:root:where(.light)` (light), not `@theme`.
- **⌘K (`web/src/app/commands.ts`)** — add jump-to-run navigation command(s). The registry
  comment already reserves *"jump-to-run"*; wire a command that navigates to `/runs` (and/or a
  recent-run entry). Keep to the `Command` shape (`{ id, label, run(nav) }`).

### Transport-port note (reconciliation — see report)

The Phase-2 SSE adapter's `stream()` currently **hard-parses each frame with
`StatusEventSchema`** and yields `TransportEvent = StatusEvent & { eventId }`
(`web/src/shared/transport/sse-adapter.ts`, `web/src/shared/transport/types.ts`). The
run-stream emits **`SpanDTO`** frames, which are **not** `StatusEvent`s — so `stream()` must be
**generalized to parse the frame payload against a caller-supplied schema** (defaulting to
`StatusEventSchema` so the existing chat-fallback path is byte-for-byte unchanged), or
`run-detail` consumes the run-stream through a thin SpanDTO-parsing variant of the same reader.
This is a **small, necessary extension of the port** (not new scope) and is the one place the
shipped code diverges from a naive "just reuse `stream()`" reading — the plan must resolve it
explicitly. The private `readSseStream`/`parseSseFrame` frame reader is reused unchanged; only
the payload schema at the yield site is parameterized.

---

## Layer ⑤ — Telemetry-gap closures

As D2, restated for the "telemetry to emit" ledger:

- **Tokens (gap #1 for the trace surface):** `SpanDTO.tokens` from `ATTR.USAGE_INPUT_TOKENS`/
  `ATTR.USAGE_OUTPUT_TOKENS`; `RunDTO.tokens` = per-run sum. **Read-only projection — no new
  span emission** (the attributes already land on AI-SDK gen spans). Slice 30a's F11 usage
  roll-up is the complementary aggregate; this is the per-run/per-span view.
- **Artifact classification (gap):** `ArtifactKind` extended so result/resource/unverified/
  failed/error/media files classify instead of collapsing to `Other`.
- **Lifecycle synthesis (gap):** `RunLifecycle` derived from root-span end + outcome, so the UI
  shows Running/Done/Failed instead of only a terminal `outcome` string.
- **Reserved (NOT closed):** `SpanDTO.node`, `RunDTO.origin` (constant `manual`), and
  `server.principal` (constant `local`) stay reserved for Slices 24/25/33/35/38.

---

## Error handling / graceful degrade

- A missing/partial/empty `spans.jsonl` → mapper returns `undefined` (list skips it; detail
  404s) — never throws. Malformed span lines are **counted** (`malformedSpans`), not fatal
  (existing `readSpans` behavior).
- Missing `degradation.jsonl`/`error.json`/artifacts → empty arrays, never a 500.
- Path traversal on `:id` → `MediaPathError` → 404 (no leak).
- Every handler stays inside the existing `handleApi` try/catch that maps a throw to a JSON 500,
  and the top-level `buildFetch` backstop that never crashes the process.
- The run-stream degrades cleanly: if the file vanishes mid-tail or the watch errors, emit the
  `runs.stream` outcome and end the SSE stream (client shows the last known trace, not a crash).
- Web: `RegionErrorBoundary` around `RunsArea`/`RunDetail`; a failed fetch/parse renders an
  in-region error, not a white screen.

## Testing strategy

**Root (Bun) — mapper + server** (`bun test --path-ignore-patterns 'web/**'`):

- **Mapper unit tests** off fixture `spans.jsonl` (+ `degradation.jsonl` + artifact files): tree
  depth/offset assignment, `offsetMs` math, `status` mapping (code 2 → Error), token projection
  + run sum, `degrades` mapping, `lifecycle` synthesis (in-flight → Running, error → Failed,
  clean → Done), malformed-line counting. **Output validated through `RunDtoSchema`/`SpanDtoSchema`.**
- **Artifact classification** table test (every kind + `Other` fallthrough).
- **Summary cache** — same mtime returns memoized item; changed mtime recomputes.
- **Endpoint tests:** list filter/sort(desc by startMs)/paginate + facets; detail 200/404; the
  **`confineToDir` traversal-defense case** (`GET /api/runs/..%2f.../` → 404, no escape);
  stream **snapshot then tail** (append a line → new SpanDTO frame) and **`Last-Event-ID`
  resume** (reconnect replays only after cursor).

**Web (Vitest + @testing-library + happy-dom)** — see `web/vitest.config.ts`,
`web/src/test/render.tsx` `renderAt` for route-mounted tests:

- `RunsArea`: renders list rows, search/facets filter, pagination advances, row link navigates.
- `RunDetail` + `use-run-trace`: snapshot renders; streamed `SpanDTO` deltas fold in (pure
  `fold` unit-tested like `foldEvent`); de-dupe by `spanId`; resume cursor tracked.
- `waterfall`: bars positioned from offset/duration, error/degraded colouring, click opens the
  span-detail panel.

**Per-task SDD gate** = `bun run typecheck` + `bun run lint` (+ `bun run lint`/`typecheck` in
`web/`) + focused tests (implementer runs focused inline; controller runs the full suite +
`bun run check` between tasks).

**Live-verify (before merge):** run a real model turn, open `/runs`, confirm the run appears
with correct outcome/lifecycle/tokens, open its detail, confirm the waterfall matches
`bun run runs <id>`, and confirm the waterfall **live-tails** a fresh in-flight run to
completion (the D4 headline check).

## Standing spec notes (per repo CLAUDE.md — the four living surfaces + telemetry)

**Architecture-doc update note (`docs/architecture.md`):**
- **Server node** — deepen with the 3 new GET endpoints (`/api/runs`, `/api/runs/:id`,
  `/api/runs/:id/stream`) + note the `runsRoot` dep and `confineToDir` reuse.
- **New §"Runs (web UI — Slice 30b Phase 3)"** — the list + waterfall + live-tail flow and the
  transport-port consumer.
- **`src/run` mapper** — document `run-dto.ts` + `artifacts.ts` and the mtime summary cache
  (with the "real index = Phase 6" note).
- **Contracts §** — `RunListItemDTO`/`RunListQuery`/`RunListResponse` + the extended
  `ArtifactKind`.
- Plus the other three surfaces at slice completion: **README** (Status line + slice-status
  table Phase-3 row, ✅ Done — but slice-30b capability NOT flipped), **ROADMAP** (flip the
  Phase-3 entry / recommended-sequence marker), the **SDD ledger**
  (`.superpowers/sdd/progress.md`, gated by pre-push), and **regenerate the docs-snapshot
  Artifact** (4th surface: new Runs subsystem node/edges, updated footer slice + test counts).

**Telemetry to emit:**
- `server.request` spans on all 3 endpoints (route attr — already emitted by `handleApi`'s
  `withServerRequestSpan`).
- A new **`runs.stream` span** for the tail (`chunks`/`bytes`/`resumes`/`outcome`, mirroring
  `ui.stream`).
- The tokens/lifecycle/artifact closures (Layer ⑤) — read-only projections, no new emission
  beyond the stream span.

## Non-goals / deferred

- **`SessionStore` + run persistence + rename/delete/export** → **Phase 6** (Phase 3 is
  stateless per request; the mapper re-reads disk).
- **`@xyflow` node-graph** (D1 — waterfall only).
- **Voice.**
- **Accessibility polish** → Phase 8 (⌘K completeness also finishes there; Phase 3 adds only
  jump-to-run).
- **`SpanDTO.node`, `RunDTO.origin`, `server.principal`** stay **reserved** (constant/omitted).
- **`runs/` retention GC** (registered Slice 30a as a Tier-2 ROADMAP slice — not built here).

## Top risks & mitigations

1. **Transport-port payload mismatch** (`stream()` parses `StatusEventSchema`, run-stream emits
   `SpanDTO`). Mitigate: parameterize the frame-payload schema on the port (default =
   `StatusEventSchema`) so the chat path is unchanged; unit-test both payloads through the
   shared frame reader. (Flagged for reconciliation — see report.)
2. **List cost at scale** (O(runs × spans) disk reads per request). Mitigate: mtime-keyed
   summary cache + `RunListItemDTO` carrying no spans/artifacts; document the Phase-6 index as
   the real fix.
3. **`fs.watch` reliability across platforms.** Mitigate: bounded poll + read-from-offset
   fallback (the CLI `--follow` already uses a poll loop), and a hard stop on `agent.run` close.
4. **Live-tail + resume correctness** (dropped/duplicated spans on reconnect). Mitigate:
   de-dupe by `spanId` in the fold; `Last-Event-ID` cursor replays only post-cursor spans;
   test the reconnect path.
