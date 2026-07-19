# Task 19 Report — `src/contracts/telemetry.ts` (D10)

## Status: DONE

## Summary
Created the isomorphic `TelemetryEventSchema` zod contract for the client→server voice
telemetry beacon (Slice 30b Phase 8, Increment 4). Followed the task brief verbatim.

## Files
- Created `/Users/inderjotsingh/ai/src/contracts/telemetry.ts`:
  - `VOICE_MODEL_TIERS = ['moonshine-base', 'moonshine-tiny'] as const` — wire-mirror of
    web's `ModelTier` string enum (`web/src/features/voice/model-tier.ts`), since
    `src/contracts/` is isomorphic and cannot import the web-only enum. Same precedent as
    Phase 7's `CaptureSource` lift (D5), per the brief's explicit controller decision.
  - `TelemetryEventSchema = z.discriminatedUnion('kind', [...])` with one variant,
    `kind: z.literal('voice.transcribe.web')` — matches Task 20's span name and stays
    distinct from the pre-existing CLI-side `voice.transcribe` span.
  - `type TelemetryEvent = z.infer<typeof TelemetryEventSchema>`.
- Modified `/Users/inderjotsingh/ai/src/contracts/index.ts`: appended
  `export * from './telemetry.ts';` (kept alphabetical: requests → telemetry → voice).
- Created `/Users/inderjotsingh/ai/tests/contracts/telemetry.test.ts`: round-trip parse,
  unknown-`kind` rejection, missing/negative-field rejection (per brief Step 1, exact code).

## TDD flow
1. Wrote the test first; ran `bun test tests/contracts/telemetry.test.ts` → failed as
   expected (`Cannot find module '../../src/contracts/telemetry.ts'`).
2. Wrote the minimal implementation per brief Step 3 (verbatim).
3. Re-ran `bun test tests/contracts/telemetry.test.ts tests/contracts/isomorphic.test.ts`
   → 4 pass, 0 fail (round-trip + reject shapes + isomorphic-import guard).

## Gate results
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- "src/contracts/telemetry.ts" "src/contracts/index.ts" "tests/contracts/telemetry.test.ts"`
  → initially failed on 2 long `expect(() => ...)` lines in the test (formatter wanted
  them wrapped). Ran the required format guard:
  `bunx biome check --write src/contracts/telemetry.ts src/contracts/index.ts tests/contracts/telemetry.test.ts`
  → fixed 1 file (wrapped the two long `expect` calls onto multiple lines; no logic
  change). Re-ran lint → clean, 0 errors.
- Focused test: `bun test tests/contracts/telemetry.test.ts tests/contracts/isomorphic.test.ts`
  → 4 pass, 0 fail, 20 expect() calls.
- Full contracts suite (`bun test tests/contracts/`) → 108 pass, 0 fail, 170 expect()
  calls across 27 files — confirms no regression to existing parity/isomorphic tests.

## Decision followed (per brief)
The spec's `modelTier: ModelTier` cannot be satisfied by importing `ModelTier` directly
(it's web-side; `src/contracts/` is isomorphic and the isomorphic test forbids anything
but `zod`/sibling imports). Per the brief's explicit controller reconciliation, mirrored
the two tier values as a plain `const ... as const` array (`VOICE_MODEL_TIERS`), matching
the Phase 7 `CaptureSource` (D5) precedent — not a TS `enum`, despite the repo's general
"prefer enum over string-literal unions" style rule, since the brief specifies this exact
shape as the reconciled decision for this task.

No parity test (like `capture-source-parity.test.ts`) was added between
`VOICE_MODEL_TIERS` and web's `ModelTier`, since the brief's Step 1–5 didn't request one
and it wasn't in this task's scope — flagging in case Task 20/22 or the controller wants
one added later to guard against value drift (the two moonshine tier values must stay
byte-identical per the brief's own note).

## Commit
`56a9549` — `feat(telemetry): TelemetryEventSchema wire contract for the voice beacon (D10)`
on branch `slice-30b-phase8-polish-a11y`. Files staged: `src/contracts/telemetry.ts`,
`src/contracts/index.ts`, `tests/contracts/telemetry.test.ts`. Pre-commit hook
(`docs-check`) passed automatically.

## Concerns / flags for controller
1. No web-side/`CaptureSource`-style parity test was added for `VOICE_MODEL_TIERS` vs
   `ModelTier` — recommend Task 20/22 or a follow-up task add one if drift risk matters
   (values must stay byte-identical: `moonshine-base`/`moonshine-tiny`).
2. Working tree had many pre-existing unrelated modified files (other task briefs/reports,
   `.remember/` state) before this task started — untouched, not part of this commit.

## Note on file history
This report file previously held a stale Task-19 entry from an earlier task-numbering
scheme (MCP config dormant-transport-kind, commit `4445dc0`). It has been fully
overwritten per the brief's instruction for this slice's Task 19; nothing from the old
content was preserved or merged.
