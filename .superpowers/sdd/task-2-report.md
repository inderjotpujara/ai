# Task 2 report: safe-helper closure vocabulary (`safe-helpers.ts`)

> Note: this file previously held the Slice 18 Task 2 report. That work is
> preserved in git history (commit `f4954b2`). This file now holds the
> Slice 19 Task 2 report.

## Status

**COMPLETED**

## Implemented

- `src/crew-builder/safe-helpers.ts` — exports `fromInput`, `fromStep`, `fromTemplate`
  (→ `(ctx: WorkflowContext) => string`), `whenEquals`, `whenContains`, `whenTruthy`
  (→ `(ctx: WorkflowContext) => boolean`), and `mapOver` (→ `(ctx: WorkflowContext) => unknown[]`).
  All factories return closures only — no throwing paths, no I/O; a shared `asStr()`
  helper stringifies deterministically (strings pass through, `undefined` → `''`,
  everything else via `JSON.stringify`).
- `tests/crew-builder/safe-helpers.test.ts` — the 5 tests verbatim from the brief
  (9 `expect()` calls total).

Code and tests match the brief's Step 1/3 verbatim, with only Biome's own
formatting reflow applied (see Deviation below). No logic changes were needed —
the brief's code typechecked and passed as written.

## TDD evidence

**RED** (before implementation existed):
```
$ bun test tests/crew-builder/safe-helpers.test.ts
error: Cannot find module '../../src/crew-builder/safe-helpers.ts' from '.../tests/crew-builder/safe-helpers.test.ts'
0 pass / 1 fail / 1 error
```

**GREEN** (after implementation):
```
$ bun test tests/crew-builder/safe-helpers.test.ts
5 pass
0 fail
9 expect() calls
Ran 5 tests across 1 file. [10.00ms]

$ bun run typecheck
$ tsc --noEmit
(clean, no output)
```

**Lint** (after `bunx biome check --write` reflowed both files to satisfy the
project's line-width/wrap rules):
```
$ bun run lint:file -- src/crew-builder/safe-helpers.ts tests/crew-builder/safe-helpers.test.ts
$ biome check src/crew-builder/safe-helpers.ts tests/crew-builder/safe-helpers.test.ts
Checked 2 files in 3ms. No fixes applied.
```

## Files changed

- `/Users/inderjotsingh/ai/src/crew-builder/safe-helpers.ts` (new, 46 lines)
- `/Users/inderjotsingh/ai/tests/crew-builder/safe-helpers.test.ts` (new, 32 lines)

## Deviation from brief

The brief's literal source (single-line function signatures, single-line
`.replace(...)` call, one-line multi-import) violated this project's Biome
line-width/formatting rules. Ran `bunx biome check --write` on both files,
which reflowed long signatures/imports/calls across multiple lines (pure
formatting — parameter names, logic, and behavior are byte-identical to the
brief). No other deviation; behavior matches the brief's spec exactly.

## Self-review

- All 7 factories return closures that never throw: `asStr` handles
  `undefined`/objects/primitives; `mapOver` falls back to `[]` for non-arrays;
  `fromTemplate`'s regex replace only touches `{{ident}}` placeholders and
  leaves unmatched text untouched.
- Determinism: no `Date.now()`, `Math.random()`, or other non-deterministic
  inputs — all output is a pure function of `ctx`.
- `WorkflowContext = Record<string, unknown>` (from `src/workflow/types.ts`)
  makes `ctx[ref]` and `ctx.input` type-safe without casts.
- No dependency on any other Slice-19 task's code, per the brief's isolation
  contract — only imports `WorkflowContext` (pre-existing type).
- `whenTruthy` note: `Boolean(ctx[ref]) && asStr(ctx[ref]).length > 0` — for a
  ref holding `0` or `false`, `Boolean(...)` is `false` so it short-circuits to
  `false` (arguably "falsy" is intentional here per the name); for a ref
  holding a non-empty object, `Boolean` is `true` and `asStr(...).length > 0`
  is also true (JSON.stringify of a non-empty object is non-empty). This
  matches the brief's spec and the given test (`{ a: '' }` → `false`)
  precisely; flagging only as a documented edge case, not a bug.

## Commit

`d278749` — `feat(crew-builder): complete safe-helper closure vocabulary`
(2 files changed, 78 insertions) on branch `slice-19-crew-workflow-builder`.
The pre-commit `docs:check` hook ran and passed.

## Concerns

None blocking. Only note: the brief's raw code needed a Biome auto-format
pass to satisfy `lint:file` (formatting-only, no behavior change) — this is
expected for any repo with strict Biome line-width rules.

## Fix: Critical review finding — `asStr` violated "never throw" contract

**Problem.** `asStr(v: unknown): string` (see "Self-review" above) relied on
raw `JSON.stringify(v)` for the fallback branch. `JSON.stringify` throws on
circular objects and on values containing a `BigInt`, and it returns the
*value* `undefined` (not a string) for functions and symbols. Because `ctx`
values are genuinely `unknown` at runtime (tool/agent step outputs feeding a
generated workflow), these paths are reachable and would crash a running
workflow — violating the module's "never throw, always return a string"
contract documented in the Self-review section.

**Fix.** Replaced `asStr` in `src/crew-builder/safe-helpers.ts` with a
hardened version that special-cases `string`/`undefined`/`null`/`function`/
`symbol`/`bigint` before ever calling `JSON.stringify`, and wraps the
remaining `JSON.stringify` call in `try/catch` (covers circular references),
falling back to `String(v)`:

```ts
function asStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  if (typeof v === 'function' || typeof v === 'symbol') return '';
  if (typeof v === 'bigint') return v.toString();
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return String(v);
  }
}
```

**Tests.** Added one test to `tests/crew-builder/safe-helpers.test.ts`
(`asStr-backed helpers never throw on hostile ctx values`) exercising
`fromStep`, `whenContains`, `whenTruthy`, and `fromTemplate` against a
circular object, a `bigint`, a `function`, and a `symbol`. Confirmed the
`whenTruthy('a')({ a: () => 1 })` semantics from the brief note hold under
the fix: `Boolean(fn)` is `true`, but `asStr(fn)` is `''` (function branch),
so `''.length > 0` is `false` → `whenTruthy` returns `false`. No adjustment
to that semantic was needed.

**Commands run:**
```
$ bun test tests/crew-builder/safe-helpers.test.ts
 6 pass
 0 fail
 17 expect() calls
Ran 6 tests across 1 file. [25.00ms]

$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun run lint:file -- src/crew-builder/safe-helpers.ts tests/crew-builder/safe-helpers.test.ts
$ biome check src/crew-builder/safe-helpers.ts tests/crew-builder/safe-helpers.test.ts
Checked 2 files in 35ms. No fixes applied.
```

**Commit:** `fix(crew-builder): harden asStr against circular/bigint/function/symbol (never throw)`
