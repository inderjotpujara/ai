### Task 14: telemetry — `withCrewBuildSpan` + ATTR keys — Report

**Status:** Implemented, GREEN.

**TDD cycle:**
- RED: wrote `tests/telemetry/crew-build-span.test.ts` (exact test from brief) and ran
  `bun test tests/telemetry/crew-build-span.test.ts` → failed with
  `SyntaxError: Export named 'withCrewBuildSpan' not found in module '.../src/telemetry/spans.ts'`.
- GREEN: added 7 `ATTR` keys (`CREW_BUILD_NEED`, `CREW_BUILD_SHAPE`, `CREW_BUILD_ID`,
  `CREW_BUILD_MEMBERS`, `CREW_BUILD_STEPS`, `CREW_BUILD_MEMBERS_BUILT`, `CREW_BUILD_OUTCOME`)
  and `withCrewBuildSpan<T>(need, fn)` to `src/telemetry/spans.ts`, mirroring
  `withAgentBuildSpan` verbatim (same `inSpan('crew.build', ...)` wrapper, same
  `{ event, outcome }` recorder shape, same shape-based count routing pattern from the brief).
  Ran `bun test tests/telemetry/crew-build-span.test.ts` → `1 pass, 0 fail`.
- `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
- `bun test tests/telemetry/` (full dir, regression check) → `13 pass, 0 fail` across 6 files.
- `bun run lint:file -- src/telemetry/spans.ts tests/telemetry/crew-build-span.test.ts` →
  `biome check`, "Checked 2 files in 5ms. No fixes applied."

**Files:**
- Modified: `/Users/inderjotsingh/ai/src/telemetry/spans.ts` (+ATTR keys, +`withCrewBuildSpan`)
- Added: `/Users/inderjotsingh/ai/tests/telemetry/crew-build-span.test.ts`

**Commit:** `6dd1402` — `feat(telemetry): withCrewBuildSpan + crew.build ATTR keys` (2 files changed, 58
insertions). Staged only these 2 files explicitly (`git add src/telemetry/spans.ts
tests/telemetry/crew-build-span.test.ts`); did not touch the many other repo-wide modified
files present from parallel in-flight task work (`.superpowers/sdd/*`, `.remember/*`).

**Self-review:**
- Helper matches brief's interface exactly, including the `shape === 'crew' ? MEMBERS :
  STEPS` count-routing logic and optional-arg guards (`!== undefined` / truthy checks) copied
  from `withAgentBuildSpan`'s pattern.
- Did not touch the OTel transport/exporter — only added attribute keys and a new span-wrapper
  function, per the standing rule.
- `as const` on `ATTR` preserved; no new types/enums needed since the brief's interface uses
  plain `string`/`number` params (matching the existing `withAgentBuildSpan` signature style,
  not introducing enums where the sibling helper doesn't use them either).

**Concerns:** None. This is an additive, isolated change with no consumers yet (Task 16's
builder will call it). No regressions in the telemetry suite.

**Note:** This file previously held a report for a different Task 14 from an earlier slice
(provisioning telemetry attrs). That content is superseded — see git history for the prior
report if needed.
