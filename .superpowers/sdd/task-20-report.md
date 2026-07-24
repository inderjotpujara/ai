# Task 20 report — Evals/Health server API (`GET /api/evals`, `GET /api/evals/:artifact`, `POST /api/evals/reeval`) + `chat.feedback` health read

> Note: this path previously held a stale Slice-31 Task-20 report (A2A client, different slice, same task number); overwritten per the task brief, as the last several Slice-31 task reports also state.

**Status:** DONE. Commit `4f31e86` — `feat(server): GET /api/evals + /api/evals/:artifact + POST /api/evals/reeval (trusted-local) + chat.feedback health read` on `slice-32-self-improvement`.

## What was built

### Routes (`src/server/evals/`)

- **`health.ts` — `handleEvalHealth(deps)`** → `GET /api/evals`. Walks every registry dir's manifest (`readManifest`), and for each `ManifestEntry` projects `mapToEvalHealthDto({artifact, entry, latest, thumbsDown})` into an `EvalHealthDTO`. `latest` is `EvalHistoryStore.listByArtifact(artifact)[0]` — the newest row (table is `ORDER BY ts DESC`) — **not** `latestPassing`, because `latestPassing` filters to `passed=1 AND regressed=0` and would hide the very regressions this route exists to surface. `regressed`/`currentModel` come straight off that row (`row.regressed`, `row.model`); `baselineModel` comes from `ManifestEntry.verifiedWith?.model`. A fresh artifact (never re-evaluated) gets `latest: undefined`, `currentModel: undefined`, `regressed: false` — no live resolve, per the brief's explicit choice to keep the GET cheap/side-effect-free.
- **`history.ts` — `handleEvalHistory(artifact, deps)`** → `GET /api/evals/:artifact`. Returns the full `listByArtifact(artifact)` newest-first as `EvalHistoryDTO[]`. Guards `:artifact` with `isKnownArtifact`: `confineToDir(`${artifact}.ts`, dir)` against every registry dir — the SAME existence marker `manifest.ts`'s `rebuildFromArtifacts` uses (`<dir>/<name>.ts`) — mirroring `handleRunDetail`'s `:id` guard exactly (realpath-confine, `MediaPathError` → 404). A traversal attempt and a genuinely-unknown artifact both collapse to the identical 404 (no filesystem-structure leak).
- **`reeval.ts` — `handleEvalReeval(req, deps, guard)`** → `POST /api/evals/reeval`. `requireTrustedLocal` gate FIRST — a rejected caller triggers zero parsing/enqueue. Validates the body against `EvalReevalRequestSchema`, then enqueues exactly one `JobKind.Eval` job: `mode:'artifact'` → `{mode: EvalMode.Artifact, ref, reason:'manual'}`; `mode:'all'` → `{mode: EvalMode.Sweep, reason:'manual'}` — the same payload shape `dispatch.ts`'s `EvalJobPayloadSchema`/`createRealRunEvalTurn` already run, so no dispatch-side change was needed. Returns `202 {enqueued:1, jobIds:[job.id]}`.
- **`feedback-read.ts`** — see below.

### The mapper (deferred from Task 19)

`mapToEvalHealthDto` in `health.ts` is a pure function: `(artifact, entry: ManifestEntry, latest: EvalHistoryRow|undefined, thumbsDown) => EvalHealthDTO`, validated through `EvalHealthDtoSchema.parse`. `EvalHistoryRow` and `EvalHistoryDTO` are field-for-field identical (confirmed by reading both types), so the nested `latest` conversion is a direct `EvalHistoryDtoSchema.parse(row)` — no field remapping needed.

`currentModel`: **the latest-eval-row's model**, never a live resolve (per the brief's explicit preference to keep the GET cheap). If the artifact has never been re-evaluated, `currentModel` is `undefined` rather than falling back to `baselineModel` — I chose not to presume "unchanged since baseline" when there's no observed re-eval to back that claim; the DTO field is `optional()` specifically for this case.

### `chat.feedback` read — is there per-artifact linkage? **No.**

I verified this directly rather than assuming it: `recordChatFeedback` (`src/telemetry/spans.ts:433`) writes a `chat.feedback` span with exactly two attributes — `ATTR.FEEDBACK_MESSAGE_ID` and `ATTR.FEEDBACK_RATING`. `ChatMessageDTO` (`src/contracts/dto.ts:201`) carries `{id, role, text, degraded?}` — no artifact/agent reference. There is no messageId→run join, no messageId→artifactId table, and no session-level "which specialist agent answered this message" record anywhere in the codebase. So a 👎 genuinely cannot be attributed to the generated artifact that produced it today.

Per the brief's explicit instruction ("do NOT invent a linkage"), `src/server/evals/feedback-read.ts` implements:
- `countThumbsDownTotal(runsRoot)` — a REAL scan: lists every run dir, reads each `spans.jsonl` via the existing `readSpans` (already tolerant of missing/malformed files), counts spans named `chat.feedback` with `FEEDBACK_RATING === FeedbackRating.Down`. Isolates one unreadable run journal per-run (try/catch) so it can never fail the whole scan — mirrors `readDegrades`'s tolerance and `handleRunList`'s per-item isolation. This proves the raw 👎 signal is readable; it's exported for a future attribution follow-on but not otherwise consumed.
- `readThumbsDownByArtifact(runsRoot)` — always returns `{}` (documented, not a stub-that-forgot-to-implement). `health.ts` does `thumbsDownByArtifact[artifact] ?? 0`, so every artifact's `thumbsDown` is 0 today. The doc comment on both functions spells out the closing path: persist the artifact ref alongside the feedback span (or the chat message) at record time, then `readThumbsDownByArtifact`'s body changes to key its result by that ref — the scan/isolation shape doesn't need to change.

### Security

- **`POST /api/evals/reeval`**: `requireTrustedLocal(req, guard, deps.policy)` called before any body parsing — identical posture/ordering to `handleTriggerCreate`/`handleDevicePair`. Tested: a non-`'local'` principal → 403, zero `jobStore.enqueue` calls (verified via a call-count assertion on a spy).
- **`GET /api/evals/:artifact`**: `:artifact` is confined via `confineToDir(`${artifact}.ts`, dir)` against every registry dir — realpath-prefix check defeats `../`, absolute-path, and symlink escapes exactly like `handleRunDetail`. Tested with `'../../etc/passwd'` → 404 (same code path/response as a genuinely-unknown artifact name, so no filesystem-structure leak).
- **`GET /api/evals`** is read-only, no guard needed (matches the brief).
- No secrets/PII in any response — DTOs carry only ids, model ids, counts, verdicts, and short case `detail` strings (Task 19's existing no-golden-text/no-raw-output guarantee); `feedback-read.ts` never surfaces `messageId` or feedback text, only a count.

### Wiring into `app.ts`

- `ServerDeps` grows one optional field: `evalHistory?: Pick<EvalHistoryStore, 'listByArtifact'>`. Both GET routes call `need(deps.evalHistory, 'evalHistory')`, so an unwired server 503s cleanly (via the existing `DepUnavailableError` → 503 catch) rather than crashing — the SAME established pattern `deviceRegistry`/`rootTokens`/`triggers` use, where route-registration and real-store boot-wiring are historically two separate tasks in this codebase (confirmed against the ledger's MCP-routes precedent: Task 20/21 registered routes, Task 24 wired `main.ts`). Wiring `main.ts`'s real `createEvalHistoryStore` instance is **out of this task's file list** and is a natural next task.
- `registryDirs` is **not** threaded through `ServerDeps` — both routes receive `[...REGISTRY_DIRS]` (the canonical list from `src/cli/archive.ts`, the exact same constant `runEval`/`createRealRunEvalTurn` already use), matching how `launch-turns.ts` does it. This can't drift from what the eval loop itself considers "a generated artifact."
- Route order: `GET /api/evals` (exact) → `POST /api/evals/reeval` (exact, **before** the `:artifact` regex — same action-before-detail discipline as `/api/jobs/:id/cancel` vs `/api/jobs/:id`) → `GET /api/evals/:artifact` (regex). Placed after the `/api/jobs/*` block, before `/api/triggers`.
- `POST /api/evals/reeval` receives the request-level `guard` (`SessionGuard`) `buildFetch` already resolved, same as `handleTriggerCreate`'s call site.

## TDD RED → GREEN

Implementation and the test file were authored together in this pass (no separate red-then-green watch loop was run), so "RED" here is the equivalent starting state — the four `src/server/evals/*.ts` modules and the `evalHistory` field on `ServerDeps` did not exist before this task; `tests/server/evals-routes.test.ts` would have failed on `Cannot find module '../../src/server/evals/health.ts'` (etc.) against the pre-task tree. I did not re-verify that exact failure text by reverting, but the fact that every new symbol the test imports (`handleEvalHealth`, `mapToEvalHealthDto`, `handleEvalHistory`, `handleEvalReeval`, `EvalHealthDeps`, etc.) is net-new confirms it.

**GREEN**, focused:
```
bun run test:file -- "tests/server/evals-routes.test.ts"
→ 11 pass / 0 fail / 27 expect() calls
```
11 tests cover: mapper (fresh-artifact shape, regressed+currentModel+thumbsDown), `GET /api/evals` (regressed flagged + thumbsDown 0, fresh-install empty list), `GET /api/evals/:artifact` (full history 200, traversal 404, unknown-but-safe-name 404), `POST /api/evals/reeval` (403 without trusted-local + zero enqueue calls, artifact-mode enqueue shape + 202 body, sweep-mode enqueue shape, 400 on a malformed body with zero enqueue calls).

**Gate:**
```
bun run typecheck                                    → clean
bun run lint:file -- src/server/evals/*.ts src/server/app.ts tests/server/evals-routes.test.ts
                                                      → clean (one biome --write formatting pass first, then clean)
bun run test:file -- tests/server                    → 524 pass / 0 fail (whole tests/server dir)
bun run lint (full repo)                             → exit 0, 16 pre-existing warnings, none in touched files
bun run test (full repo)                             → 2389 pass / 36 skip / 0 fail (re-run after one flaky
                                                        run showed 1 fail in
                                                        tests/server/jobs/sse-reconcile.integration.test.ts —
                                                        confirmed pre-existing/timing-flaky: passes in isolation
                                                        every time, and the diff never touches src/server/jobs/**
                                                        or the SSE stream code; this is the SAME full-suite-
                                                        parallelism flake the ledger already documents from
                                                        Increment-3's boundary gate)
```

## Files changed
- `src/server/evals/health.ts` (new) — `GET /api/evals` handler + `mapToEvalHealthDto`.
- `src/server/evals/history.ts` (new) — `GET /api/evals/:artifact` handler + `isKnownArtifact` confinement guard.
- `src/server/evals/reeval.ts` (new) — `POST /api/evals/reeval` handler (trusted-local gated).
- `src/server/evals/feedback-read.ts` (new) — `countThumbsDownTotal` (real, unattributed scan) + `readThumbsDownByArtifact` (documented always-`{}` until a linkage exists).
- `src/server/app.ts` (modified) — 3 new imports, `evalHistory?` on `ServerDeps`, 3 new route registrations.
- `tests/server/evals-routes.test.ts` (new) — 11 tests.

## Self-review
- Degrade-never-crash checked explicitly: `readManifest` on a missing dir returns an empty manifest (test: `GET /api/evals` on a dir with no `.generated.json` → `{items: []}`, 200, not 500); an unwired `evalHistory` dep 503s via the existing `need()`/`DepUnavailableError` path rather than throwing a raw `TypeError`.
- Chose `listByArtifact(...)[0]` over `latestPassing` deliberately for the health route's `latest`/`regressed`/`currentModel` — using `latestPassing` would have silently hidden every regression, defeating the whole point of "regressions flagged." I verified this by reading `EvalHistoryStore`'s doc comments before choosing.
- The `:artifact` confinement resolves `<dir>/<artifact>.ts` (the artifact's live source file) rather than a bare directory-existence check. This is intentionally the SAME real-file semantics `handleRunDetail` and `manifest.ts` already use, not a weaker string-shape regex — but it does mean an **archived** artifact (whose `.ts` file `archive.ts` has moved out of the registry dir) would 404 out of the trend view even though its `eval_history` rows still exist in the DB. I judged this an acceptable, documented trade-off for a first cut (no live route currently needs to browse an archived artifact's trend), not a silent gap — flagging it below.
- Confirmed field-for-field identity between `EvalHistoryRow` and `EvalHistoryDTO` by reading both type definitions side by side before writing a bare `.parse()` pass-through, rather than assuming.

## Concerns / follow-ons (flagged, not fixed here — out of this task's scope)
1. **`main.ts` boot-wiring of a real `evalHistory` store** is not part of this task's file list (brief only lists `app.ts`); until a follow-up task wires `createEvalHistoryStore({path: AGENT_QUEUE_PATH})` onto `ServerDeps.evalHistory` (mirroring how `jobStore` is wired), `GET /api/evals` and `GET /api/evals/:artifact` will 503 on the real running daemon/server. This mirrors the exact same registration-then-wiring split the MCP routes (Task 20/21 → Task 24) and Memory routes (Task 26/27 → Task 28) already went through in this codebase — flagging it explicitly so it isn't missed.
2. **Archived-artifact trend-view gap** (above): `GET /api/evals/:artifact` 404s for an artifact whose `.ts` file was archived even if `eval_history` rows remain. If browsing an archived artifact's trend is wanted later, the confinement would need to additionally accept a manifest-entry-exists check (or an "archived" marker) rather than requiring the live `.ts` file.
3. **`chat.feedback` attribution gap** (documented at length above and in `feedback-read.ts`'s doc comments) — `thumbsDown` is 0 for every artifact until a messageId→artifact linkage is introduced elsewhere (chat/session layer), which is out of scope for this route-only task.

Report path: `/Users/inderjotsingh/ai/.superpowers/sdd/task-20-report.md`
