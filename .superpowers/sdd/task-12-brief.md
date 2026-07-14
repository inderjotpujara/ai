### Task 12: Docs — `## Contracts` + `## Server (web BFF)` subsystem sections (docs-check gate)

**Files:**
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: nothing.
- Produces: two new sections naming the substrings `src/contracts` and `src/server` so `scripts/docs-check.ts` rule 3 passes (it hard-fails on any undocumented `src/<subsystem>`).

- [ ] **Step 1: Confirm docs-check currently FAILS on the new subsystems**

Run: `bun run docs:check`
Expected: FAIL — `subsystem src/contracts/ is not documented ...` and `subsystem src/server/ is not documented ...`.

- [ ] **Step 2: Append the two subsystem sections**

Add to the end of `docs/architecture.md` (before the final trailing content if any; a new top-level `##` section each):

```markdown
---

## Contracts (web wire protocol — `src/contracts/`, Slice 30b Phase 1)

**Feature.** `src/contracts/` is the single source of truth for the local web
UI's wire protocol: Zod schemas plus their inferred TypeScript types. It is
**isomorphic** — imported by both the server (`src/server/`) and the future
browser (`web/`) — and depends on **nothing but `zod`** (a test,
`tests/contracts/isomorphic.test.ts`, enforces this; no `node:*`, no engine,
no AI-SDK types, per Slice-23 forward-compat).

**Mechanism.** `enums.ts` holds the finite named sets (`RunOrigin`,
`RunLifecycle`, `SpanStatus`, `ArtifactKind`, `DegradeKind`, `ChatRole`,
`ModelLoadAction`, `StatusEventType`). `dto.ts` defines the read-model DTOs
(`RunDTO`/`SpanDTO`/`DegradeDTO`/`ChatMessageDTO`) with forward-compat fields
optional (reserved `owner`, run `lifecycle`/`origin`, span `degraded`/`node`,
token roll-ups). `events.ts` defines the transient-SSE `StatusEvent`
discriminated union (`data-run-start` … `data-confirm` … `data-run-end`) —
OUR types, never re-exported AI-SDK `UIMessage` parts. `requests.ts` defines the
inbound bodies the server validates before any engine call (`ChatRequest` over a
minimal structural `UiMessageLike`, and `RespondRequest` for the consent
back-channel). `index.ts` is the barrel.

**Data flow.** browser/server ⇄ `contracts` schemas: the server parses inbound
requests (`ChatRequestSchema.parse`) at the perimeter and (later phases) maps
engine spans → `RunDTO`/`SpanDTO` and writes `StatusEvent`s as transient SSE
data-parts. The `DegradeKind` wire enum mirrors `src/reliability/ledger.ts` by
value (guarded by `tests/contracts/degrade-kind-parity.test.ts`) without
importing it.

## Server (web BFF — `src/server/`, Slice 30b Phase 1)

**Feature.** `src/server/` is a thin, transport-agnostic `Bun.serve` BFF that
owns **no business logic** — it adapts the engine to HTTP and enforces the
localhost security perimeter (D17). Phase 1 ships the perimeter, `/api/health`,
static serving, and the `bun run web` entry; the streaming chat handler, DTO
mappers, and remaining endpoints attach in later phases.

**Mechanism.** `main.ts` (`bun run web`) reads the `AGENT_WEB_*` config, mints a
per-session bearer token, injects it into the served HTML, and boots
`Bun.serve({ idleTimeout: 0 })`. `app.ts` (`buildFetch`) is the request
pipeline: **perimeter → token → route**. `security/origin.ts` enforces a
Host-header allowlist (`localhost`/`127.0.0.1:PORT`) plus cross-origin `Origin`
rejection (DNS-rebinding/CSRF defense); `security/token.ts` mints + constant-time
verifies the bearer; `security/media-path.ts` confines network-supplied media
paths to a realpath inside the run/upload dir. Static assets are served under
**COOP/COEP** (`same-origin` / `require-corp`) for future sherpa WASM
`SharedArrayBuffer`. Every `/api` handler is wrapped in a `server.request`
telemetry span (`src/telemetry/spans.ts`, with a reserved `server.principal`
attribute) and typed-error handling via `explain()` (`src/errors/boundary.ts`) —
so an endpoint degrades to a JSON error, never crashes.

**Data flow.** `request → enforcePerimeter → token guard → withServerRequestSpan
→ route (/api/health | static) → JSON/HTML response`. Served-mode record-IO is
OFF by default (`AGENT_WEB_RECORD_IO`), distinct from the CLI's
`AGENT_TELEMETRY_RECORD_IO`.
```

- [ ] **Step 3: Run docs-check to verify it passes**

Run: `bun run docs:check`
Expected: PASS — `✔ docs-check: living docs present + linked; every src subsystem documented.`

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): add Contracts + Server (web BFF) subsystem sections (Slice 30b Phase 1)"
```

---

### Final gate (run after Task 12)

- [ ] **Run the full pre-PR gate**

Run: `bun run check`
Expected: PASS — docs-check ✔, typecheck ✔, lint ✔, all tests green (the new `tests/contracts/**` and `tests/server/**` suites included).

> Note: `bun run check` runs `lint` (`biome check .`) across the repo. If Biome flags style on any new file (import ordering, quote style), fix in place and re-run — this is not a plan step to skip.

---

## Self-Review

I ran the writing-plans self-review checklist against the Phase-1 spec scope (§Build order item 1 "Foundations + perimeter security", D15 forward-compat fields, D17 perimeter, the M3 config carry-forward, the Spike-A findings) and the repo conventions supplied:

- **Spec coverage.** Every Phase-1 deliverable maps to a task: contract DTOs + forward-compat optionals (Task 2), status events (Task 3), inbound request schemas (Task 4), isomorphic no-forbidden-imports guard (Task 1) + DegradeKind parity (Task 2), `ConfigEntry.strict?` M3 carry-forward + `AGENT_WEB_*` (Task 5), bearer token (Task 6), Host/Origin allowlist (Task 7), media-path confinement (Task 8), `server.request` span with reserved principal (Task 9), thin BFF + COOP/COEP + `/api/health` + typed-error handling (Task 10), `bun run web` entry + HTML token injection (Task 11), docs-check subsystem stubs (Task 12). Explicitly out of Phase 1 and NOT tasked: the chat/SSE handler, DTO mappers, `web/` frontend harness/tokens/shell (Phase 1b), persistence/`SessionStore` — all called out in Global Constraints.
- **Placeholder scan.** No `TBD`/"add error handling"/"write tests for the above"; every code step carries complete, real code and exact run/commit commands.
- **Type consistency.** Names are stable across tasks: enums (Task 1) feed `z.enum(...)` in Tasks 2–4; `OriginPolicy`/`ServerDeps` defined in Tasks 7/10 are consumed verbatim in Tasks 10/11; `withServerRequestSpan`'s `{ status }` recorder (Task 9) is called exactly in Task 10; `ServerDeps.policy` object-identity mutation (port reconcile) is used consistently in the Task 10 test and Task 11 entry.

Two verification points I could not fully pin from static reading and flagged inline for the implementer: (a) the exact `registerTestProvider()` accessor/shutdown surface in `tests/helpers/otel-test-provider.ts` (Task 9 step 1 notes to mirror the existing `tests/telemetry/*.test.ts` usage); (b) Zod v4's `z.enum(NativeEnum)` / `z.record(key, value)` signatures (stated in Global Constraints; a `bun run typecheck` at Task 2/4 will catch any drift immediately). I am leaving the deeper adversarial correctness review to the orchestrator per subagent-driven-development's two-stage review.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-14-slice-30b-phase1-contracts-server-security.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development
- Fresh subagent per task + two-stage review.

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans
- Batch execution with checkpoints for review.
