# Task 1 Report: Lift `VoiceFrames` into `src/contracts/voice.ts`

Branch: `slice-30b-phase7-voice`. Task: Slice 30b Phase 7 (browser voice input), Task 1.

## Status: DONE

## Summary
Relocated `VoiceFrames` from `src/voice/types.ts` into a new `src/contracts/voice.ts`
as a plain (non-zod) type, re-exported it from `src/contracts/index.ts`, and made
`src/voice/types.ts` re-export it rather than redefine it. Pure source relocation,
no behavior change.

## Files changed
- **Created** `src/contracts/voice.ts` — `VoiceFrames` type + D5 rationale doc comment
  (verbatim from brief).
- **Modified** `src/contracts/index.ts` — appended `export * from './voice.ts';`.
- **Modified** `src/voice/types.ts` — replaced the local `VoiceFrames` definition
  (former lines 1-5) with an import + re-export (see deviation below). Rest of the
  file (`CaptureSource`, `VoiceOutcome`, `VoiceError`, `VoiceConfig`, `Transcriber`)
  untouched.
- **Created** `tests/contracts/voice.test.ts` — verbatim from brief.

## Deviations from the brief (both necessary, both verified)

1. **`export type { X } from '...'` alone is insufficient for local use.** The brief's
   Step 3 snippet for `src/voice/types.ts` was a bare re-export
   (`export type { VoiceFrames } from '../contracts/voice.ts';`). That statement
   re-exports the type but does **not** bring `VoiceFrames` into the file's own
   scope, and `Transcriber` (line 41, unchanged) uses `VoiceFrames` locally
   (`transcribe(frames: VoiceFrames): Promise<string>`). `bun run typecheck` caught
   this immediately: `TS2304: Cannot find name 'VoiceFrames'`. Fixed by using an
   `import type` plus a separate `export type { VoiceFrames };` line instead, so the
   name is both imported for local use and re-exported for external consumers:
   ```ts
   import type { VoiceFrames } from '../contracts/voice.ts';

   export type { VoiceFrames };
   ```
   (Biome's `assist/source/organizeImports` additionally required a blank line
   between the import and the export — added.)

2. **Step 2's expected test failure didn't manifest via `bun test`.** The brief
   expected `bun test tests/contracts/voice.test.ts` to fail with
   "Cannot find module" before `src/contracts/voice.ts` existed. In practice it
   passed even with the file missing — bun's transpiler fully erases `import type`
   statements before runtime module resolution, so a type-only import to a
   nonexistent file never causes a runtime error. `tsc --noEmit` (`bun run
   typecheck`) DID fail as expected at that point
   (`TS2307: Cannot find module '../../src/contracts/voice.ts'`), which is the
   equivalent "red" signal under this repo's actual toolchain. Noted as a toolchain
   nuance, not a defect in the brief's intent.

## Verification (all run inline, in order)
- Before implementation: `bun test tests/contracts/voice.test.ts` → 1 pass (see
  deviation #2); `bun run typecheck` correctly failed pre-implementation
  (`TS2307: Cannot find module '../../src/contracts/voice.ts'`).
- After implementation:
  - `bun test tests/contracts/voice.test.ts` → **1 pass, 0 fail**.
  - `bun run typecheck` → clean, after the import/re-export fix.
  - `bun run lint:file -- src/contracts/voice.ts src/contracts/index.ts src/voice/types.ts tests/contracts/voice.test.ts` → clean, after one blank-line fix.
  - `bun test tests/voice/` → **38 pass, 0 fail** (pre-existing suite, unchanged).
  - Final full-gate re-run: `bun run typecheck` clean; `bun test tests/contracts/ tests/voice/` → **142 pass, 0 fail** across 35 files.
  - `bun run lint` (full repo) → 18 pre-existing warnings, all in files untouched by
    this task (e.g. an unused `root` var in an unrelated test helper) — confirmed
    out of scope.

## Consumer check
- `src/voice/capture.ts` and `src/voice/transcribe.ts` both import `VoiceFrames`
  from `./types.ts` (unchanged import path) — compile clean via the re-export.
- `src/telemetry/spans.ts` imports `CaptureSource` (not `VoiceFrames`) from
  `../voice/types.ts` — untouched, unaffected; confirmed via typecheck pass.
- No `web/src` usage yet (browser voice code doesn't exist until later phase-7
  tasks) — the `@contracts` re-export point (`src/contracts/index.ts`) is ready for it.

## Commit
`7bc0ad5` — `feat(voice): lift VoiceFrames into src/contracts as a plain non-zod type (D5)`
(4 files changed: `src/contracts/index.ts`, `src/contracts/voice.ts` (new),
`src/voice/types.ts`, `tests/contracts/voice.test.ts` (new)). Pre-commit
`docs-check` hook passed. This task deliberately does not touch
`docs/architecture.md` per instructions — that lands in Task 16. Only the 4
intended files were staged (confirmed via `git status --short` pre-commit); the
already-modified `.remember/*` / `.superpowers/sdd/progress.md` /
`.superpowers/sdd/task-1-brief.md` from surrounding session/SDD-controller
activity were left untouched/uncommitted, as they belong to a different concern.

## Self-review
- Docstring in `src/contracts/voice.ts` matches the brief verbatim (D5 rationale
  intact).
- `src/voice/types.ts`'s remaining exports (`CaptureSource`, `VoiceOutcome`,
  `VoiceError`, `VoiceConfig`, `Transcriber`) are byte-for-byte unchanged.
- No behavior change; this is a pure type-location refactor, with corrected
  import/export mechanics so the file still typechecks (the brief's literal
  snippet did not).
- No `console.log` introduced, no scope creep, D5 non-zod exception documented
  as required.
- No concerns for downstream tasks; Task 2 (moving `CaptureSource`) can proceed
  against this file as-is.

## Concerns
None. Two minor necessary corrections to the brief's literal code (both caught by
the gate itself, both fixed and re-verified) — flagged above for visibility, not
because scope or intent changed.
