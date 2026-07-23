# Task 14 review-gap fix (Slice 32, self-improvement loop) — telemetry coverage for `applyRegressionOutcome`

## Gap being closed

`applyRegressionOutcome` (`src/self-improve/action.ts`) calls, on a confirmed
`Regression` only:
3. `recordDegrade({ kind: DegradeKind.ModelDegraded, subject, reason, from, to })`
   (`src/telemetry/spans.ts`)
4. `recordEvalRegression({ artifact, regressedCount, drop, from, to })`
   (`src/self-improve/spans.ts`)

Both are OTel no-ops via `trace.getActiveSpan()` when no tracer provider is
registered. All 6 pre-existing tests in `tests/self-improve/action.test.ts`
call `applyRegressionOutcome` with no tracer registered, so steps 3–4 ran
(or didn't run) completely unobserved by any assertion — a passing test
suite gave zero signal about whether these two calls fire, with the right
attributes, on `Regression`, or stay silent on `Pass`/`WithinNoise`/
`Inconclusive`.

## What was added (test-only)

File: `tests/self-improve/action.test.ts` (same file — reused the existing
`entryAt`/`resultWith`/`fakeStore`/`call` helpers, per the existing fake-deps
setup; did not create a new test file).

New imports: `afterEach`, `beforeEach`, `describe` (bun:test);
`BasicTracerProvider`/`InMemorySpanExporter` types; `DegradeKind`
(`src/reliability/ledger.ts`); `ATTR`, `withRunSpan`
(`src/telemetry/spans.ts`); `registerTestProvider`
(`tests/helpers/otel-test-provider.ts`).

New `describe('applyRegressionOutcome telemetry (active tracer registered)')`
block, lifecycle mirrors `tests/telemetry/reliability-spans.test.ts`'s nested
"structured attributes" describe (`beforeEach` → `registerTestProvider()`,
`afterEach` → `await provider.shutdown(); exporter.reset()` — fresh
InMemory-backed provider per test, no leak into other test files: confirmed
by re-running the whole `tests/self-improve/` directory, still 35/35 green).

Each case wraps the `call(...)` invocation in `withRunSpan('run-…', 'sweep',
async () => { ... })` so `trace.getActiveSpan()` inside `recordDegrade` /
`recordEvalRegression` resolves to the `agent.run` span instead of being a
no-op — `applyRegressionOutcome` itself opens no span, so the test has to
supply the active-span context, exactly like `withRunSpan` does for
`recordDegrade` in `reliability-spans.test.ts`.

### Test 1 — confirmed `Regression` fires both, with the right attrs

`RegressionVerdict.Regression`, `regressedCaseIds: ['c0', 'c2']`, `drop: 0.2`,
`currentModel: 'B:7b'`, `baselineModel: 'A:7b'`, artifact name `'a'`.

Asserted on `reliability.degrade` event (`span.events.find(e.name ===
'reliability.degrade')`):
- `ATTR.ERROR_TYPE` (`'error.type'`) === `DegradeKind.ModelDegraded`
- `'degrade.subject'` === `'a'`
- `ATTR.RELIABILITY_DEGRADE_FROM` (`'degrade.from'`) === `'A:7b'`
- `ATTR.RELIABILITY_DEGRADE_TO` (`'degrade.to'`) === `'B:7b'`

Asserted on `eval.regression` event:
- `ATTR.EVAL_ARTIFACT` (`'eval.artifact'`) === `'a'`
- `ATTR.EVAL_REGRESSED_COUNT` (`'eval.regressed_count'`) === `2`
- `ATTR.EVAL_DROP` (`'eval.drop'`) === `0.2`
- `ATTR.RELIABILITY_DEGRADE_FROM` === `'A:7b'`
- `ATTR.RELIABILITY_DEGRADE_TO` === `'B:7b'`

(`RELIABILITY_DEGRADE_FROM`/`TO` are the exact attr keys `recordEvalRegression`
reuses on the `eval.regression` event per `src/self-improve/spans.ts`.)

### Test 2 — `Pass` / `WithinNoise` / `Inconclusive` fire NEITHER

`test.each([['WithinNoise', ...], ['Pass', ...], ['Inconclusive', ...]] as
const)` — one case per non-Regression verdict. Each asserts, on the finished
`agent.run` span:
- `span.events.find(e => e.name === 'reliability.degrade')` is `undefined`
- `span.events.find(e => e.name === 'eval.regression')` is `undefined`

This is the observability half of the "never-demote" guarantee already
covered behaviorally (upsert-call-count assertions) by the pre-existing
tests.

## Evidence (GREEN)

`action.ts` was not touched, so there is no before/after RED→GREEN diff to
show for the production code; the point of this task is that the new
assertions themselves are the previously-missing signal. All gate commands
green, both the new file state and the whole `self-improve` directory:

```
$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun run lint:file -- tests/self-improve/action.test.ts
$ biome check tests/self-improve/action.test.ts
Checked 1 file in 7ms. No fixes applied.

$ bun run test:file -- tests/self-improve/action.test.ts
$ bun test --path-ignore-patterns 'web/**' --path-ignore-patterns 'spikes/**' tests/self-improve/action.test.ts
bun test v1.3.11 (af24e281)

 10 pass
 0 fail
 47 expect() calls
Ran 10 tests across 1 file. [208.00ms]
```

10 = the original 6 + 1 (Regression telemetry) + 3 (`test.each` non-Regression
cases). All pre-existing tests remain green, unmodified.

Cross-file leak check — re-ran the whole `tests/self-improve/` directory to
confirm the registered/shutdown tracer provider doesn't bleed into sibling
files (`history.test.ts`, `regression.test.ts`, `spans.test.ts`, etc.):

```
$ bun run test:file -- tests/self-improve/
 35 pass
 0 fail
 110 expect() calls
Ran 35 tests across 6 files. [532.00ms]
```

## Files changed

- `tests/self-improve/action.test.ts` — test-only addition (new imports +
  one new `describe` block with 4 new test cases). No other file touched.

## `src/self-improve/action.ts` — UNCHANGED

Confirmed no edit was needed or made; behavior stays exactly as approved.

## Concerns

None. The gap is now closed with assertions on the exact attribute keys
`recordDegrade`/`recordEvalRegression` emit (verified by reading
`src/telemetry/spans.ts` and `src/self-improve/spans.ts` directly, not
inferred) and the test lifecycle mirrors the two existing precedent files
exactly (`tests/telemetry/reliability-spans.test.ts` for the `beforeEach`/
`afterEach` reset pattern, `tests/self-improve/spans.test.ts` for the
`eval.regression` event-attribute precedent). Note: this filename was
previously used by an unrelated Slice-29 Task-14 fix report; it has been
overwritten with this Slice-32 Task-14 content per the current task's
`report path` instruction.
