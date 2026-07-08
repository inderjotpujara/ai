### Task 5 report: Top-level error boundary + persisted `error.json`

**Status:** Done.

## Note on this file
This overwrites a stale `task-5-report.md` from an unrelated earlier task
in this same Ops Surface plan ("Signal-clean shutdown"), which had the same
filename due to per-slice task numbering. That content is preserved in git
history (previous commit touching this path).

## Implementation

- Created `src/errors/boundary.ts`:
  - `explain(err: unknown): { title; hint }` — `instanceof` chain over all 8
    exported `core/errors.ts` subclasses (`ResourceError`, `ProviderError`,
    `ToolError`, `MemoryError`, `VerificationError`, `WorkflowError`,
    `CrewError`, `MaxStepsError`), each mapped to an actionable title+hint;
    anything else (plain `Error`, non-Error throws) falls to a generic
    "Unexpected error" pair.
  - `handleTopLevel(err, deps?): number` — logs `✖ <title>: <message>\n  →
    <hint>` via injectable `log` (default `process.stderr.write`); if
    `deps.runDir` is set, best-effort writes `error.json`
    (`{name, title, message, hint, at}`) via injectable `write` (default
    `writeFileSync`), wrapped in `try/catch` so a failing write never
    propagates; always returns `1`.
- Created `tests/errors/boundary.test.ts` — brief's Step 1 sample, written
  first per TDD, confirmed RED (module missing), then GREEN after the
  implementation. One deviation, see below.
- Modified `src/cli/chat.ts`: bottom
  `main().catch((err) => { console.error(err); process.exit(1); })` replaced
  with `main().catch((err) => { process.exit(handleTopLevel(err)); })`;
  added `import { handleTopLevel } from '../errors/boundary.ts';` in its
  correct alphabetical slot in the existing import block (between
  `discovery/build-registry.ts` and `log/logger.ts`).
- Updated `docs/architecture.md`: added an **Error boundary** row
  (`src/errors/`) to the subsystem registry table, placed right after the
  **Process** row (same Slice-30a vintage) — required by the pre-commit
  `docs:check` gate since `src/errors/` is a brand-new top-level subsystem.

## Deviations from the brief's literal sample

- `tests/errors/boundary.test.ts`: the brief's literal
  `JSON.parse(writes['/tmp/r/error.json'])` fails `tsc --noEmit` under this
  repo's `tsconfig.json` (`noUncheckedIndexedAccess: true` types the index
  access as `string | undefined`). A first fix using a `!` non-null
  assertion satisfied typecheck but tripped Biome's `noNonNullAssertion`
  lint rule. Final form: pull the value into a `const written = writes[key]`,
  assert `expect(written).toBeDefined()`, then `JSON.parse(written as
  string)`. Same runtime assertions, clean under both typecheck and lint.
  No other deviations — `src/errors/boundary.ts` matches the brief's Step 3
  code verbatim (only reformatted/reordered per `bunx biome check --write`
  for import grouping/line wraps, no logic changes).

## TDD — RED → GREEN

- **RED:** `bun test tests/errors/boundary.test.ts` →
  `error: Cannot find module '../../src/errors/boundary.ts'`.
- **GREEN:** after adding `src/errors/boundary.ts`:
  `bun test tests/errors/boundary.test.ts` → 2 pass, 0 fail.

## Verification run

- `bun test tests/errors/ tests/cli/` → **73 pass, 0 fail** (154 `expect()`
  calls).
- `bun run typecheck` → clean, 0 errors.
- `bun run lint` (full `biome check .`) → **0 errors**; 14 pre-existing
  warnings in files untouched by this task.
- `bun run docs:check` → `✔ docs-check: living docs present + linked; every
  src subsystem documented.` — also re-ran automatically by the pre-commit
  hook on commit, passed.

## Self-review checklist (from the task prompt)

- `explain` covers all 8 exported error subclasses + a generic fallback —
  confirmed by reading the `instanceof` chain.
- `handleTopLevel` writes `error.json` to `runDir` when provided, and the
  write path is wrapped in `try/catch` so a failing injected `write` never
  throws out of `handleTopLevel`.
- `chat.ts`'s bottom `main().catch` now routes through `handleTopLevel`,
  importing it correctly.
- `docs:check` green, both standalone and via the pre-commit hook on commit.

## Files changed

- `src/errors/boundary.ts` — new.
- `tests/errors/boundary.test.ts` — new.
- `src/cli/chat.ts` — replaced the bottom `main().catch` block + added the
  import; nothing else touched.
- `docs/architecture.md` — added the Error boundary subsystem row.

## Concerns

- `chat.ts`'s top-level `main().catch((err) => { process.exit(handleTopLevel(err)); })`
  calls `handleTopLevel(err)` with **no `deps`** — matches the brief's
  literal wiring exactly, but it means today this call site only logs (via
  the default `process.stderr.write`) and does **not** persist `error.json`
  in a real failure, since `main()`'s top-level catch sits outside any
  `withMcpRun`/`RunHandle` scope that would supply a concrete `runDir`.
  `explain`'s message mapping and the exit(1) behavior work correctly
  regardless. Wiring an actual run directory through to this outer catch
  (e.g. restructuring `main()` so its catch runs inside the run scope, or
  tracking a "last known run dir" module-level) is a natural follow-on if
  per-run `error.json` persistence on real (non-test) failures is desired —
  flagging for whoever picks up hardening this further, not blocking for
  this task as scoped.
- Did not touch `.superpowers/sdd/progress.md` or other tasks' brief/report
  files that appear modified in `git status` — those belong to other
  in-flight Ops Surface tasks and were left untouched/unstaged by this
  task's commit.
- Did not push, per instructions.

## Commit

`06fbc05` — "feat(errors): top-level boundary maps typed errors to
actionable hints + persists error.json". Files in commit: exactly
`src/errors/boundary.ts`, `tests/errors/boundary.test.ts`, `src/cli/chat.ts`,
`docs/architecture.md`.
