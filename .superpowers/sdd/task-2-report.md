# Task 2 report — Mirror `CaptureSource` into `src/contracts/enums.ts` with a parity test

**Status:** DONE

**Commit:** `8689aa7` — `feat(voice): mirror CaptureSource into contracts with a parity test (D5)`

## What changed
- `src/contracts/enums.ts` — appended `CaptureSource` enum (`Mic = 'mic'`, `File = 'file'`), with
  a doc comment matching the file's existing "wire mirror" convention (see `RuntimeKind` etc.).
  Values are byte-identical to the pre-existing `src/voice/types.ts` definition — this is a
  pure source relocation, not a rename.
- `src/voice/types.ts` — removed the local `CaptureSource` enum definition; replaced with
  `export { CaptureSource } from '../contracts/enums.ts';`, placed immediately after the
  `VoiceFrames` re-export from Task 1 (and ordered ahead of `export type { VoiceFrames }` to
  satisfy biome's `assist/source/organizeImports` export-sort rule).
- `tests/contracts/capture-source-parity.test.ts` (new) — asserts
  `Object.values(ContractCaptureSource).sort()` equals `Object.values(VoiceCaptureSource).sort()`,
  mirroring `tests/contracts/runtime-kind-parity.test.ts`.
- `src/contracts/index.ts` needed no change — it already does `export * from './enums.ts'`, so
  `CaptureSource` is automatically importable from `src/contracts` too.
- `tests/voice/types.test.ts` — untouched, as required (still asserts `CaptureSource.Mic === 'mic'`,
  passes unmodified since the underlying value didn't change; confirmed via `git log` that its
  last touch predates this commit).

## TDD sequence followed
1. Wrote the parity test first → ran it → RED (`Export named 'CaptureSource' not found in module
   '.../src/contracts/enums.ts'`).
2. Added the enum to contracts + re-export in `src/voice/types.ts` → ran it → GREEN.
3. Ran `bun run lint` and hit one real error (biome wanted the two exports reordered in
   `src/voice/types.ts`); fixed by moving `export { CaptureSource } from ...` above
   `export type { VoiceFrames };`. Re-ran lint on the touched files — clean.

## Gate results
- `bun run typecheck` — PASS (`tsc --noEmit`, no output/errors).
- `bun run lint` — PASS: 0 errors; 18 pre-existing warnings, confirmed via `git stash` against the
  base commit `7bc0ad5` (identical warning count/content before my changes, all in unrelated files
  e.g. `tests/models/pull...` unused `root` var). Nothing introduced by this task.
- `bun test tests/contracts/capture-source-parity.test.ts tests/voice/` — PASS: 39 pass, 0 fail,
  69 expect() calls across 11 files (includes the new parity test + all pre-existing voice tests
  unchanged).

## Casing correction applied
Per the controller's explicit correction, `CaptureSource` values were kept as `Mic = 'mic'`,
`File = 'file'` (lowercase) — NOT changed to `'Mic'/'File'`. Verified the `voice.transcribe`
telemetry span's `voice.capture.source` attribute path (`src/telemetry/spans.ts`) is unaffected
since it reads `CaptureSource.Mic`/`.File` member references, not raw strings, and those members'
runtime values are unchanged.

## Commit contents
`8689aa7` — 3 files changed, 26 insertions(+), 5 deletions(-):
`src/contracts/enums.ts`, `src/voice/types.ts`,
`tests/contracts/capture-source-parity.test.ts` (new). Pre-commit `docs-check` passed
automatically ("✔ docs-check: living docs present + linked; every src subsystem documented.") —
no `architecture.md` update required (pure addition inside the already-documented
`src/contracts` subsystem, per the task's "no docs/architecture.md change" instruction).

## Self-review
- Diff reviewed post-commit (`git show HEAD`) — confirms values preserved exactly, no stray edits
  to `tests/voice/types.test.ts` or other consumers (`src/voice/transcribe.ts`,
  `src/telemetry/spans.ts` needed zero changes since they still import `CaptureSource` by the
  same name from `src/voice/types.ts`).
- Only the 3 intended files were staged/committed — verified `git status --short` before commit
  showed unrelated working-tree changes (`.remember/*`, `.superpowers/sdd/*`) as untouched/unstaged.

## Concerns
None.
