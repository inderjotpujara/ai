# Task 13 report — fail-closed mid-run consent → typed `failed` (no hang) (HARD §7.1)

**Slice 31 (A2A interop), Increment 4. Commit `a44aa2f` on `slice-31-a2a-multimachine`.**

## What was implemented

1. **`src/a2a/task-map.ts`** (core deliverable, pure):
   - `CONSENT_DECLINED_MARKER = 'consent-declined'` — the canonical token a declined mid-run consent gate would leave on a job's terminal `error`.
   - `consentDeclinedToTaskError(job: ConsentJobView)` — total over `JobStatus`: returns `{ state: TaskStateWire.Failed, error: consentUnavailableError() }` **only** when `status === Failed` AND `error` carries the consent-decline marker; `undefined` for every other status and for a plain `Failed` with an unrelated/absent error. The `Failed → failed` state it emits is exactly Task 8's `jobStatusToTaskState(Failed)`, so it can never contradict the base projection — it only *attaches* the typed error.
2. **`src/a2a/stream.ts`** (pure framer): `a2aStatusFrame` gained an optional `error` arg that rides the status `message` as an inert `data` part; `frameRunSpanAsA2a` gained an optional `terminalError` that attaches to the `failed` terminal frame (ignored on a `completed` frame).
3. **`src/a2a/server.ts`** `handleTasksGet`: a consent-declined `Failed` job surfaces the typed `consent-unavailable` error on its terminal `failed` status message. (The brief named `rpc.ts` for "tasks/get result", but the tasks/get projection actually lives in `a2a/server.ts` — `rpc.ts` only wraps the dispatcher. `rpc.ts` was left unchanged; the gate still lints it clean.)
4. **`src/server/a2a/stream-route.ts`**: the terminal-frame path passes the consent projection's error into `frameRunSpanAsA2a` when the backing job failed-on-consent.
5. **`tests/a2a/consent-fail-closed.test.ts`**: 6 tests (see below).

## What dispatch.ts actually records for a declined consent + how I detect it — HONESTY

**Investigated (`dispatch.ts`, `queue/types.ts`, `queue/store.ts`, `mcp/consent.ts`, `agent-builder/builder.ts`, `server/consent/registry.ts`):** a settled job's failure is a single `error: string | undefined` title (`markFailed` writes it). I traced every mid-run consent path an A2A-reachable job (Chat/Crew/Workflow — the only kinds `buildJobPayload` enqueues) can hit:

- **MCP-mount consent** (`mcp/consent.ts` `ensureConsent`) fail-closes by **SKIPPING** the server (a `warn` + `return false`) — it never fails the job, never writes an error.
- **Builder consent** (`confirm: async () => false` at `dispatch.ts:200`) returns a `{ kind: 'declined' }` **result** (job goes `Done`, not `Failed`), and the Build kind is **not A2A-reachable** anyway (defense-in-depth guard in `buildJobPayload`).
- The `ConfirmPort` (`server/consent/registry.ts`) emits a `Confirm` `StatusEvent` keyed by `promptId` and returns a promise that only settles via `POST .../respond` — but dispatch wires `noopEventSink`, so there is no live client and **no substrate** for a round-trip (exactly as the brief states).

**Conclusion: a declined-consent A2A job is NOT distinguishable today from any other `Failed` job — no dispatch path sets a consent-specific marker.** Therefore `consentDeclinedToTaskError` is a **best-effort, forward-looking detector**: it matches `CONSENT_DECLINED_MARKER` (best-effort substring, case-insensitive) so the scoped future durable **queue-consent** capability (Task 13 §2 non-goals) has one canonical token to stamp. Until then the refinement is **dormant** — called out in a prominent code comment on the marker and in the test-file header. **I did NOT fabricate a marker in `dispatch.ts`** (it is unmodified, per the brief).

**The load-bearing §7.1 guarantee holds regardless:** the no-hang / terminal-`failed` outcome is carried entirely by Task 8's already-shipped `jobStatusToTaskState` `Failed → failed` projection. The typed `consent-unavailable` error is a refinement of that terminal state, never the guarantee.

## TDD RED → GREEN

- **RED:** `bun run test:file -- "tests/a2a/consent-fail-closed.test.ts"` → `SyntaxError: Export named 'CONSENT_DECLINED_MARKER' not found` (0 pass, 1 fail).
- **GREEN:** after implementation → `6 pass, 0 fail, 19 expect() calls`.
- Regression: `bun test tests/a2a/` → `39 pass`; `bun test tests/server/a2a` → `14 pass`.

Tests: (1) marker job → `failed` + `consent-unavailable`; (2) plain `Failed` (unrelated / absent error) → `undefined`; (3) every non-`Failed` status → `undefined`; (4) `jobStatusToTaskState(Failed) === failed` (Task 8 reuse); (5) integration — `handleTasksGet` on a consent-declined job resolves **within a 1s wall-clock race** to terminal `failed`, asserts NOT `input-required`/`working`/`submitted`, and carries the typed error (proves no hang); (6) terminal STREAM frame carries `consent-unavailable`.

## Gate

`bun run typecheck` → clean. `bun run lint:file -- <touched files>` → clean (after fixing an unknown-cast + import-sort). `git commit` pre-commit `docs-check` → passed.

## Self-review

- **Deterministic terminal `failed`, never hang / never input-required?** Yes. Both surfaces (`tasks/get`, terminal stream frame) derive state from the settled job status via `jobStatusToTaskState` (`Failed → failed`, terminal). The consent projection can only emit `failed` (same state), never `input-required` — no promptId/resume path was added. The wall-clock race test proves resolution.
- **Mapping total?** Yes. `consentDeclinedToTaskError` guards `status !== Failed` first (all other statuses → `undefined`); `jobStatusToTaskState` remains exhaustive with its `never` tail (untouched). No default-to-`completed` hole.
- **Detection honest?** Yes — best-effort against a real field (`JobRecord.error`), no fabricated dispatch marker, limitation documented in code + tests + this report. (Deviation from the brief's sample test, which used a non-existent `failure` field cast `as never`: I used the real `error` field — the honest choice.)
- **Fail-closed posture identical to existing dispatch?** Yes — `dispatch.ts` is unmodified; this task only *reads* the settled job and refines the already-terminal `failed`.

## Concerns

- **Dormant refinement:** the `consent-unavailable` typed error never fires in production today (no marker emitted). By design per the locked fail-closed decision and the scoped-future queue-consent slice; the guarantee that matters (terminal `failed`, no hang) is live via the Task 8 projection. Flagged so the reviewer weighs it as a forward-looking seam, not dead-by-mistake.
- **File-list deviation:** wiring landed in `a2a/server.ts` + `server/a2a/stream-route.ts` (where tasks/get and the terminal frame actually live), not `server/a2a/rpc.ts` (a thin wrapper). `rpc.ts` unchanged and lints clean.

_(Note: this path previously held a stale Slice-25b `device-registry` report; overwritten with the active Slice-31 Task 13 report per the brief.)_
