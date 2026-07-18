# Task 9 Report: Builder confirm/log adapter (pure, unit-tested)

Note: this filename was previously used for an unrelated Task 9 from Slice 30b
Phase 4 (workflow browse handlers). That content is superseded — this is Slice
30b Phase 5's Task 9 (builder confirm/log adapter), Increment 2 (Builders).

## Status: DONE

## What was implemented

Created `src/server/builders/adapter.ts` — the pure, I/O-free bridge (D4) between the
frozen `BuilderDeps`/`CrewBuilderVerifyDeps` engine hooks (Slices 17/20:
`confirm: (text: string) => Promise<boolean>`, `confirmReuse?: (kind: ReuseKind, text:
string) => Promise<boolean>`, `log?: (m: string) => void`) and the server's
`ConsentRegistry`/SSE writer. Three exports, matching the brief verbatim:

- `confirmViaPort(port: ConfirmPort, events: EventSink, kind: string): (question: string) => Promise<boolean>`
  — fixed `kind` per call site (e.g. `'build'`); mints `{ kind, question }` through the
  port on the same event sink the build's narration also writes to, coerces the port's
  `unknown` resolution to `boolean` via `Boolean(...)`.
- `confirmReuseViaPort(port: ConfirmPort, events: EventSink): (kind: string, question: string) => Promise<boolean>`
  — same bridge, but `kind` (the `ReuseKind` value, `'reuse'`/`'offer'`) is supplied per
  call instead of fixed.
- `TextPartWriter` type + `logToTextDelta(write: TextPartWriter): (m: string) => void`
  — bridges the builder's narration hook to a `text-start`/`text-delta`/`text-end`
  triple per call, each with a fresh incrementing `narration-N` id so the browser
  renders one line per call rather than a run-on paragraph. `TextPartWriter` is
  structurally narrower than the AI-SDK `UIMessageStreamWriter['write']`, so
  `logToTextDelta(writer.write)` type-checks by ordinary contravariance without this
  module importing `ai`.

No engine-side code changed — this task only adds the adapter.

## TDD evidence

**RED** (module not found, confirmed before implementation):
```
bun test tests/server/builders-adapter.test.ts
error: Cannot find module '../../src/server/builders/adapter.ts' from '/Users/inderjotsingh/ai/tests/server/builders-adapter.test.ts'
0 pass / 1 fail / 1 error
```

**GREEN** (after implementing `src/server/builders/adapter.ts` verbatim per brief):
```
bun test tests/server/builders-adapter.test.ts
4 pass
0 fail
8 expect() calls
Ran 4 tests across 1 file. [13.00ms - 15.00ms]
```

Four tests, all passing:
1. `confirmViaPort` mints a fixed-kind ask through the port and resolves its answer.
2. `confirmViaPort` coerces a non-boolean port answer (`undefined`) to `false`.
3. `confirmReuseViaPort` threads the caller-supplied kind (varies per call: `'reuse'`
   then `'offer'`).
4. `logToTextDelta` writes one start/delta/end triple per call with distinct
   incrementing ids (`narration-0`, `narration-1`).

## Per-task gate (all three, before commit)

- `bun run typecheck` — clean (`tsc --noEmit`, no output/errors).
- `bun run lint:file -- src/server/builders/adapter.ts tests/server/builders-adapter.test.ts`
  — 0 errors after one auto-fix pass (`bunx biome check --write` reordered the test's
  type-only import after the value import and reflowed a long `emit(...)` call across
  multiple lines — pure formatting, no logic change). Final run: "Checked 2 files in
  3ms. No fixes applied."
- Focused tests — 4/4 pass (see GREEN above).

## Files changed

- `src/server/builders/adapter.ts` (new, 55 lines)
- `tests/server/builders-adapter.test.ts` (new, 60 lines)

## Commit

`f0161ab` — `feat(server): builder confirm/confirmReuse/log adapters onto ConfirmPort + SSE writer (Phase 5)`
(2 files changed, 115 insertions(+); pre-commit `docs:check` passed — no `src/`
subsystem-doc gap since `builders/` sits under the already-documented `src/server/`
tree.)

Branch: `slice-30b-phase5-builders-library` (pre-existing branch, unchanged). Only
`src/server/builders/adapter.ts` and `tests/server/builders-adapter.test.ts` were
staged — no `git add -A` — working tree had numerous unrelated dirty files from other
in-flight Phase 5 tasks (`.remember/*`, `.superpowers/sdd/task-*-brief.md`/
`task-*-report.md`, `.superpowers/sdd/progress.md`); these were deliberately left
unstaged and NOT included in this commit.

## Self-review

- Implementation is byte-for-byte the brief's Step 3 code (only whitespace differs,
  from the biome auto-format pass on the test file's imports/wrapping — the adapter
  file itself needed no reformatting).
- Verified `ConfirmPort` (`src/server/consent/registry.ts:10-13`) and `EventSink`
  (`src/core/events.ts`) signatures against the brief's claims before writing: both
  match exactly (`ConfirmPort = (ask: ConfirmAsk, emit: EventSink) => Promise<unknown>`;
  `EventSink = (e: StatusEvent) => void`).
- `Boolean(await port(...))` is the only coercion point — correctly turns the
  `Promise<unknown>` port contract into the `Promise<boolean>` the engine's
  `confirm`/`confirmReuse` hooks require; test 2 explicitly locks in the `undefined →
  false` case.
- `logToTextDelta`'s closure-scoped counter (`let n = 0`) is per-adapter-instance, not
  global — each `logToTextDelta(...)` call site gets its own independent narration-id
  sequence starting at 0, which is what a fresh build run wants (verified by reasoning
  through the closure semantics, not just by the given test, since the test only
  exercises one instance).
- Only two files touched; no incidental changes to unrelated pre-existing modified
  files in the working tree (confirmed via `git status --short` before staging).

## Concerns

None. The adapter's output shapes (the `data-confirm` ask parameter, the
`text-start`/`text-delta`/`text-end` part shapes) are fixed exactly as given in the
brief and match the existing `ConfirmPort`/`EventSink` contracts with no
interpretation required. No ambiguity encountered — nothing to flag for Task 11/13.
