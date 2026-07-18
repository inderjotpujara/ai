# Task 12 Report — Builder registry lists + `runBuilderTurn` wiring (`ServerDeps`, `app.ts`, `main.ts`)

Slice 30b Phase 5, Increment 2 (Builders). Status: **DONE**, committed `b9fd0a3`.

## What was implemented

1. **`src/server/builders/list.ts` (new)** — `handleBuilderAgentList()` (`GET
   /api/builders/agents`, wraps `agentNames()`) and `handleBuilderCrewList()`
   (`GET /api/builders/crews`, wraps `[...Object.keys(CREWS),
   ...Object.keys(WORKFLOWS)]`), both validated through
   `BuilderRegistryListResponseSchema` (Task 6) before serialization.
2. **`src/server/launch-turns.ts`** — added `createRealRunBuilderTurn(runsRoot):
   RunBuilderTurn`. Dispatches on `BuilderKind` inside a single
   `withRunTelemetry({ runsRoot, runId }, ...)` scope: `BuilderKind.Agent` →
   `makeRealBuilderDeps` + `buildAgent` + `toBuildResultDto`;
   `BuilderKind.Crew`/`Workflow` → `makeRealCrewBuilderDeps` +
   `buildCrewOrWorkflow` + `toCrewBuildResultDto`. In both branches, the real
   deps' `confirm`/`log`/`verify.confirmReuse` are overridden with the
   SSE-bridged versions the T11 route built, and `cleanup()` (model unload) is
   called in a `finally` around the build call — mirrors `src/cli/agent-builder.ts`
   / `crew-builder.ts`'s `main()` exactly (same deps factories, same
   `withRunTelemetry` usage), just with route-supplied confirm/log instead of
   TTY prompts.
3. **`src/server/app.ts`** — `ServerDeps.runBuilderTurn: RunBuilderTurn` added;
   three routes registered in `handleApi` next to the existing
   `/api/crews`/`/api/workflows` GETs: `GET /api/builders/agents`, `GET
   /api/builders/crews`, `POST /api/builders/build` (delegates to T11's
   `handleBuilderBuild(req, deps)`).
4. **`src/server/main.ts`** — `const runBuilderTurn =
   createRealRunBuilderTurn(runsRoot)` alongside the existing
   `runCrewTurn`/`runWorkflowTurn` construction; added to the real `deps`
   object passed to `buildFetch`.
5. **Fixture ripple** (`ServerDeps` gained a required field) — added
   `runBuilderTurn` (a throwing stub named `unusedRunBuilderTurn`/`noBuilderRun`
   matching each file's existing naming convention, or a `declined` stub in the
   shared `deps()` helper) to all five affected literals:
   `tests/server/app.test.ts` (`deps`, `throwingDeps`, `confinedDeps`,
   `symlinkDeps`), `tests/server/runs-routes.test.ts` (`deps`),
   `tests/server/phase4-routes.test.ts` (`deps()` helper).

## TDD evidence

**RED** (before implementation):
```
tests/server/builders-list.test.ts:
error: Cannot find module '../../src/server/builders/list.ts' ...

tests/server/builders-turn.test.ts:
SyntaxError: Export named 'createRealRunBuilderTurn' not found in module
'/Users/inderjotsingh/ai/src/server/launch-turns.ts'.

0 pass / 2 fail / 2 errors
```

**GREEN** (after implementation, focused run):
```
bun test tests/server/builders-list.test.ts tests/server/builders-turn.test.ts \
  tests/server/app.test.ts tests/server/runs-routes.test.ts tests/server/phase4-routes.test.ts
22 pass, 0 fail, 58 expect() calls
```
`tests/server/builders-turn.test.ts`'s live-model test **ran for real** (not
skipped) in this environment — a local Ollama daemon was reachable — and
passed in ~23s (bumped its bun:test timeout to `120_000`ms since real model
resolution/load + one `generateText` draft call routinely exceeds bun's
default 5s test timeout; this is a timeout-budget fix, not a skip). It is
still gated `test.skip` when no daemon is reachable (`ollamaReachable()` — a
bare `fetch` to `http://localhost:11434/api/version`, not `ollamaReady(model)`,
because `createRealRunBuilderTurn`'s model resolves dynamically via
`resolveModel({ prefer: LargestThatFits })` over whatever the registry
discovers — gating on one specific installed model would be the wrong check).

**Full-suite gate** — `bun run check` (docs:check · typecheck · lint · web
typecheck/vitest · full `bun test`): **exit 0**. `1364 pass, 36 skip, 0 fail,
3245 expect() calls` across 1400 tests / 343 files (root suite); web vitest
`122 passed`. The 15 Biome warnings surfaced are pre-existing, unrelated to
this task's files (`src/memory/chunk.ts` non-null assertions, template-curly
strings in `tests/mcp/pack.test.ts`, `any` in
`tests/provisioning/provisioner.test.ts`/`tests/resource/ollama-control.test.ts`)
— none touched by this task, none newly introduced.

## Per-task gate

- `bun run typecheck` — clean (`tsc --noEmit`, no output).
- `bun run lint:file -- <9 changed files>` — 0 errors after Biome's
  `organizeImports`/formatter auto-fixes (import ordering + one multi-line
  wrap) were applied via `biome check --write`; re-run confirmed clean.
- Focused tests (5 files) — 22 pass, 0 fail (see above).
- `bun run check` (full gate) — exit 0, 0 fail.

## Build-run span lifecycle — exactly once on every path

Traced the actual mechanism (not asserted from the brief alone):

- **No separate "Build run span."** `RunKind.Build` is *derived* post-hoc by
  `deriveRunKind` (`src/run/run-dto.ts:45-52`) from the presence of an
  `agent.build`/`crew.build` root span name in `spans.jsonl` — `withRunTelemetry`
  itself does **not** open any span; it only creates the run dir
  (`createRun`), installs the run-scoped telemetry provider
  (`initRunTelemetry`), and runs the body inside `withRunContext`, flushing
  the provider in a `finally` (`src/cli/with-run.ts:11-22`). So the "Build run
  span" *is* the `agent.build`/`crew.build` span — there is only one span to
  reason about, not two.
- **`agent.build`/`crew.build` open-and-close is owned by
  `withAgentBuildSpan`/`withCrewBuildSpan`** (`src/telemetry/spans.ts:771-793`,
  `799-...`), both thin wrappers over a shared `inSpan(name, fn)`
  (`src/telemetry/spans.ts:194-211`):
  ```ts
  return tracer().startActiveSpan(name, async (span) => {
    try { return await fn(span); }
    catch (err) { span.setStatus({...ERROR}); throw err; }
    finally { span.end(); }
  });
  ```
  `span.end()` sits in a `finally` around the ENTIRE `fn` body — there is
  exactly one `startActiveSpan` call and exactly one `span.end()` call per
  invocation, regardless of how `fn` (i.e. all of `buildAgent`/
  `buildCrewOrWorkflow`'s generate/consent/verify/commit logic) settles.
- **`buildAgent`/`buildCrewOrWorkflow` wrap their ENTIRE body in this one
  call** (`return withAgentBuildSpan(need, async (rec) => { ... })` —
  `src/agent-builder/builder.ts:327`, mirrored in
  `src/crew-builder/builder.ts`). Every one of the outcomes named in the task
  brief is just a different `return` (or thrown error) from *inside* that
  same callback — there is no code path that returns/throws from
  `buildAgent`/`buildCrewOrWorkflow` without passing back through `inSpan`'s
  `finally`:
  - `declined` — early `return` after `deps.confirm` returns false.
  - `invalid` — early `return` after validation issues exhaust retries.
  - `abandoned` / `reused` — early `return`s from the reuse-check branch.
  - `failed-verification` — `return`ed by `verifyAndCommitProposal`.
  - `written` — the success `return`.
  - **engine throw** (e.g. a live model call rejects) — propagates up through
    `inSpan`'s `catch`/`finally`, which still calls `span.end()` before
    rethrowing; `createRealRunBuilderTurn`'s own `try/finally` around
    `cleanup()` then runs, and the error propagates out through
    `withRunTelemetry`'s `finally` (`tel.shutdown()`), which is likewise
    unconditional.
  - **client disconnect mid-build** — `createRealRunBuilderTurn` is never
    given `req.signal` (no dependency on the HTTP request/response lifecycle
    at all), and T11's `handleBuilderBuild` doesn't detach `execute` — the
    build simply keeps running to completion server-side even if the SSE
    connection drops, so there is no teardown path this turn needs to guard
    against; the span closes normally when the build itself finishes.
- **Verified live, not just read**: the `builders-turn.test.ts` live run
  actually exercised the decline path against a real model and confirmed
  `spans.jsonl` contains `"name":"agent.build"` after the promise settles —
  direct evidence the span is written (i.e. `span.end()` ran) before
  `withRunTelemetry`'s `tel.shutdown()` flush completed.

Conclusion: the span-once invariant holds on every path named in the task
description (success, decline, verify-fail, engine throw, client disconnect)
without any new guard code being needed in `createRealRunBuilderTurn` itself —
it falls out of `inSpan`'s existing try/finally discipline, which
`buildAgent`/`buildCrewOrWorkflow` already wrap their whole bodies in. This
was the T11 verifiers' open cross-task item; it is closed by this trace, not
by a new mechanism.

## Files changed

- `src/server/builders/list.ts` (new)
- `src/server/launch-turns.ts` (added `createRealRunBuilderTurn`)
- `src/server/app.ts` (`ServerDeps.runBuilderTurn`, 3 routes)
- `src/server/main.ts` (real turn construction + wiring into `deps`)
- `tests/server/builders-list.test.ts` (new)
- `tests/server/builders-turn.test.ts` (new)
- `tests/server/app.test.ts`, `tests/server/runs-routes.test.ts`,
  `tests/server/phase4-routes.test.ts` (fixture ripple)

## Self-review

- Verified `research-crew`/`fetch-then-summarize` are the real registry ids
  (`crews/research-crew.ts`, `workflows/fetch-then-summarize.ts`) before
  writing the list test — brief's placeholder names matched the checkout
  as-is, no substitution needed.
- Confirmed `BuilderDeps.confirm`/`CrewBuilderVerifyDeps.confirmReuse` are
  structurally compatible with `RunBuilderTurn`'s `confirm: (question:
  string) => Promise<boolean>` / `confirmReuse: (kind: string, question:
  string) => Promise<boolean>` signatures (parameter contravariance:
  `ReuseKind` is a string enum, so a function accepting `string` satisfies a
  slot typed to accept `ReuseKind`) — `tsc --noEmit` confirms no widening
  issue.
- Ran Biome's `--write` to fix import ordering rather than hand-ordering
  (avoids transcription drift from the brief's snippets); re-verified lint
  clean and typecheck clean afterward.
- Bumped only the live-model test's own timeout (`120_000`ms, third arg to
  `test(...)`) rather than touching any global bun test config — scoped to
  the one test that legitimately needs it.
- Confirmed via `bun run check` (full suite, exit 0) that the `ServerDeps`
  ripple didn't miss any other literal in the tree — no other file failed to
  typecheck.

## Concerns

- None blocking. One note for a future task: `tests/server/builders-turn.test.ts`
  is a genuinely live-model test (like the CLI's own `agent-builder.ts`
  `main()`) — it will silently `test.skip` in CI/environments without a
  reachable Ollama daemon. This mirrors existing repo convention
  (`ollamaReady`-gated `.live.test.ts` files) and is called out explicitly in
  the test's own comment rather than being a hidden gap; the live-verify pass
  (Increment 6) is the backstop that exercises it for real.
