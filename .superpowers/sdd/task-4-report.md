# Task 4 report: `readRunArtifacts` — readdir + classify into `ArtifactKind` (Slice 30b Phase 3)

## Status: DONE

Commit: `e53f709 feat(run): readRunArtifacts — readdir+classify run dir into ArtifactKind`

## Files changed
- `src/run/artifacts.ts` (new) — `readRunArtifacts(runDir): Promise<RunArtifact[]>` where `RunArtifact = { name: string; bytes: number; kind: ArtifactKind }`.
- `tests/run/artifacts.test.ts` (new) — 4 tests.

## Context check before implementing
Confirmed `ArtifactKind` (in `src/contracts/enums.ts`) already has all 11 members needed (`Answer, Gap, Spans, Degradation, Other, Result, Resource, Unverified, Failed, Error, Media`) — the contracts-group task landed it already, per the brief. Confirmed the `@contracts`/relative barrel `src/contracts/index.ts` re-exports `enums.ts` via `export * from './enums.ts'`, so `../contracts/index.ts` resolves `ArtifactKind` as the brief's snippet expects. Read `src/run/run-trace.ts`'s `readSpans` for the established "swallow fs errors, return empty" convention (`try { readFile(...) } catch { return {spans:[], malformed:0} }`) and matched it exactly in `readRunArtifacts`'s missing-dir handling.

## Implementation
Followed the brief's Step 3 snippet almost verbatim, with two small deliberate deviations:
1. Extracted the return shape into an exported `type RunArtifact = { name: string; bytes: number; kind: ArtifactKind }` (brief inlined the object-literal type on the function signature) — named type is reused for `dirBytes`'s caller and cleaner for the mapper (Task 5+) to import instead of duplicating the inline shape.
2. Doc comment on `readRunArtifacts` explicitly cross-references `readSpans` in `run-trace.ts` as the precedent for the fs-error-tolerance convention, per the brief's ask to "match `src/run/` conventions."

Logic, unchanged from the brief:
- `readdir(runDir, { withFileTypes: true })` wrapped in try/catch → `[]` on any failure (missing dir, permissions, etc. — never throws).
- Directory entries: only `media/` is recognized: it's rolled up via `dirBytes()` (readdir one level under `media/`, sum `stat().size` for each **file** entry — subdirectories under `media/` are ignored per the brief's "media dirs are flat" comment) and emitted as `{ name: 'media', bytes, kind: Media }`. Any other directory entry is silently skipped (not modeled in the brief's classification table).
- File entries: looked up in the `FILE_KINDS` record by exact filename; `?? ArtifactKind.Other` fallthrough for anything unrecognized; `bytes` = `stat().size`.

## TDD
Wrote the test file first (brief's Step 1 sample, plus one additional test I added — see below), ran it to confirm RED (module didn't exist), then wrote the implementation, then GREEN.

```
$ bun test tests/run/artifacts.test.ts
 4 pass
 0 fail
 14 expect() calls
Ran 4 tests across 1 file. [29.00ms]
```

Test coverage (4 tests, beyond the brief's 3-test sample):
1. `answer.txt/result.txt/spans.jsonl/degradation.jsonl/error.json/random.log` → correct kinds, `random.log` → `Other`, byte-size spot-check on `answer.txt`.
2. **Added test** (not in the brief's sample, added for classification-table completeness): `gap.txt/resource.txt/unverified.txt/failed.txt` → `Gap/Resource/Unverified/Failed` — the brief's sample test only exercised 6 of the 10 file-kind rows in its own classification table, leaving 4 (`gap`, `resource`, `unverified`, `failed`) unverified by any test. Added this test so every row of the table has direct coverage.
3. `media/` dir with two files (`4` + `2` bytes) → `Media` kind, `bytes: 6` (rolled-up sum).
4. Missing run dir → `[]`, never throws.

## Gate — all clean
```
$ bun test tests/run/artifacts.test.ts
4 pass, 0 fail, 14 expect() calls

$ bun run typecheck
$ tsc --noEmit   (clean, no output)

$ bun run lint:file -- "src/run/artifacts.ts" "tests/run/artifacts.test.ts"
$ biome check src/run/artifacts.ts tests/run/artifacts.test.ts
Checked 2 files in 28ms. No fixes applied.
```
Commit hook also ran `bun run scripts/docs-check.ts` → passed. No `docs/architecture.md` update in this task: `src/run/` is an already-documented subsystem (per `docs:check`'s per-subsystem gate) and this is a pure new-function addition within it, not a new subsystem — the mapper landing (later task in this same phase) is the natural point to describe `RunDTO.artifacts` in `architecture.md`, per the phase plan.

## Self-review
- Diff is exactly the two new files, nothing else touched — confirmed via `git show --stat` (2 files changed, 119 insertions, 0 deletions).
- `readRunArtifacts` never throws for any input tested: missing dir → `[]`; unreadable/unknown file → `Other`; directory other than `media/` → silently skipped (not a table row, so no artifact emitted — matches the brief's table which lists no "other directory" row).
- `bytes` semantics verified both ways: plain file uses `stat().size` directly (byte-exact, verified `answer.txt` written with 5 bytes → `bytes: 5`); `media/` directory uses the rolled-up sum (verified `4 + 2 = 6`).
- Import style matches sibling `run/` files: `node:fs/promises`, `node:path`, contracts import via the barrel (`../contracts/index.ts`) — consistent with how `run-trace.ts` imports from `../telemetry/`.
- `FILE_KINDS` is a flat `Record<string, ArtifactKind>` — no risk of an enum value drifting out of sync with `src/contracts/enums.ts` since it's a one-way lookup keyed by filename, not a re-declaration of the enum itself.

## Concerns
- None blocking. One forward-note for the mapper task: `readRunArtifacts` skips any directory entry other than `media/` (e.g., if a future run dir grows a second subdirectory) rather than classifying it — this matches the brief's classification table (which has no "other directory" row) but is worth flagging so the mapper doesn't assume every dir entry is represented in the artifact list.
