# Task 9 report: reliability telemetry (ATTR keys + recordDegrade)

Note: this filename was reused from an earlier, unrelated Task 9 (crew-builder
transpiler, Slice 19/20). That report has been superseded here — this is the
Slice 21 reliability-telemetry task.

## Status: DONE

## What was done
1. Wrote failing test `tests/telemetry/reliability-spans.test.ts` per brief Step 1, ran it, confirmed failure (`Export named 'recordDegrade' not found`).
2. Edited `src/telemetry/spans.ts`:
   - Added `import type { DegradeEvent } from '../reliability/ledger.ts';` near the top, alongside the existing `currentDelegationContext` and `ArtifactKind`/`VerifiedLevel` type imports. No duplicate `trace` import was added — reused the existing one from `@opentelemetry/api`.
   - Added the 8 new reliability ATTR keys (`RELIABILITY_RETRY_ATTEMPTS`, `RELIABILITY_RETRY_LANE`, `RELIABILITY_BREAKER_STATE`, `RELIABILITY_DEGRADE_FROM`, `RELIABILITY_DEGRADE_TO`, `RELIABILITY_DEGRADE_REASON`, `RELIABILITY_DROPPED_AGENT`, `ERROR_TYPE`) inside the `ATTR` object literal, immediately before the closing `} as const;`.
   - Added `export function recordDegrade(event: DegradeEvent): void` right before `withWorkflowSpan`, mirroring `recordGuardrailViolation`'s style (get active span via `trace.getActiveSpan()`, return early if none, `span.addEvent('reliability.degrade', {...})` with `ATTR.ERROR_TYPE`, `'degrade.subject'`, `ATTR.RELIABILITY_DEGRADE_REASON`, and conditional `'degrade.detail'`).
3. Ran the focused test — passed (2 tests, 4 expect calls).
4. Ran `bun run typecheck` — clean.
5. Ran `bun run lint:file -- "src/telemetry/spans.ts" "tests/telemetry/reliability-spans.test.ts"` — initially failed on formatting (import order + line width in the new test file); ran `bunx biome check --write` to auto-fix (only touched the test file — reordered imports alphabetically and wrapped two long lines), then re-ran lint clean.
6. Committed with message `feat(telemetry): reliability attrs + recordDegrade` (commit `abe649b` on branch `slice-21-graceful-degradation-retries`). The pre-commit hook's `docs:check` passed (no `architecture.md` update needed — this extends an already-documented subsystem's existing file, not a new subsystem).

## Deviation
None beyond letting Biome auto-format the test file (cosmetic only — import order + line wrapping); no logic changes. Existing imports were reused as instructed; no duplicate `trace` import added.

## Commits
- `abe649b` — `feat(telemetry): reliability attrs + recordDegrade` (2 files changed, 44 insertions)

## Test summary
`bun test tests/telemetry/reliability-spans.test.ts` → 2 pass, 0 fail, 4 expect() calls.
