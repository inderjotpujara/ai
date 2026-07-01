# Task 2 Report: Telemetry spans — verification.check (Slice 13)

## Summary
Additively extended `src/telemetry/spans.ts` with a `verification.check` span, six new
`ATTR.VERIFICATION_*` keys, a `withVerificationSpan(info, fn)` helper, and a
`recordVerdict(unsupportedClaims)` recorder — mirroring the existing `withMemoryEmbedSpan` /
`recordRerankOutcome` patterns byte-for-byte in style. No existing spans, ATTR keys, or exports
were touched.

## Files
- `src/telemetry/spans.ts` — added `VERIFICATION_*` keys to `ATTR`, `VerificationInfo` type,
  `withVerificationSpan`, `recordVerdict`.
- `tests/verification/spans.test.ts` — new test file (2 tests).

## Adapting the brief's test to the real helper
The brief's Step-1 template imported `{ exporter, shutdown }` from
`registerTestProvider()` and called `await shutdown()`. The real
`tests/helpers/otel-test-provider.ts` only returns `{ exporter, provider }` — there is no
`shutdown`. Checked two existing consumers (`tests/memory/spans.test.ts`,
`tests/telemetry/workflow-spans.test.ts`): both destructure just `{ exporter }` and read
`exporter.getFinishedSpans()` immediately after the awaited `withXSpan` call, with no
teardown step — the `SimpleSpanProcessor` exports synchronously on span end, so nothing to
await. I matched that exact pattern: destructure `{ exporter }` only, no shutdown call.

## TDD

**RED** — wrote `tests/verification/spans.test.ts` importing `withVerificationSpan` (not yet
exported):
```
SyntaxError: Export named 'withVerificationSpan' not found in module '.../src/telemetry/spans.ts'.
0 pass / 1 fail / 1 error
```

**GREEN** — implemented per the brief's Step 3 code (ATTR keys + `withVerificationSpan`),
plus `recordVerdict` (listed in the brief's "Interfaces" line but not shown in the Step-3
snippet — added it mirroring `recordRerankOutcome`'s `trace.getActiveSpan()` guard + single
`setAttribute` pattern, since the brief's interface contract names it explicitly):
```
bun test tests/verification/spans.test.ts
2 pass / 0 fail / 7 expect() calls
```

**Full suite** (no telemetry regression):
```
bun run typecheck   → clean, no errors
bun test             → 262 pass, 18 skip, 0 fail, 527 expect() calls, 93 files
```

## Self-review
- `ATTR.VERIFICATION_*` keys added at the end of the existing `ATTR` object — purely additive,
  no reordering/renaming of existing keys.
- `withVerificationSpan` follows the exact `inSpan('name', async (span) => {...; return fn(); })`
  shape used by every other `withXSpan` helper; optional attributes are guarded with
  `!= null` checks identical to `withMemoryRecallSpan`.
- `recordVerdict` follows `recordRerankOutcome`'s exact shape: `trace.getActiveSpan()`, early
  return if none, single `setAttribute` call — no new primitives introduced.
- Doc comments on `withVerificationSpan` and `recordVerdict` match the terse, one-line style
  used elsewhere in the file (e.g. `withMemoryEmbedSpan`, `recordRerankOutcome`).
- Added a second test for `recordVerdict` (not in the brief's minimal template) since I
  implemented that export — kept it in the same describe block, same style as the brief's test.

## Concerns
None. Change is minimal (76 lines, 2 files), purely additive, and the full suite is green with
no telemetry regressions. `docs-check` pre-commit hook passed without needing an
`architecture.md` update (extending an existing subsystem file, not adding a new `src/<subsystem>`).
