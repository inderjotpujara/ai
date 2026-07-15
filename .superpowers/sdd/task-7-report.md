# Task 7 Report: Thread `runsRoot` into `ServerDeps` — Slice 30b Phase 3

## Status: DONE

## Changes
- `src/server/app.ts`: added required `runsRoot: string` field to `ServerDeps`, after `uploadsDir`.
- `src/server/main.ts`: added `runsRoot,` to the `deps: ServerDeps = { ... }` literal, reusing the existing local `const runsRoot = 'runs'` at line 52 (already threaded into the engine + uploads dir; now also on `deps`).
- `tests/server/app.test.ts`: added a shared `const runsRoot = mkdtempSync(join(tmpdir(), 'app-runs-'))` fixture and threaded `runsRoot,` into all four `ServerDeps` literals: `deps`, `throwingDeps`, `confinedDeps`, `symlinkDeps`.

No behavior change — `runsRoot` is available on `deps` but not yet read by any handler; that's Task 8 (the `GET /api/runs*` endpoints).

## Grep confirmation
`rg "ServerDeps" src tests` found exactly one construction site in `src/` (`src/server/main.ts`) and four literals in `tests/server/app.test.ts`. No other file constructs `ServerDeps`. All five sites updated.

## Gate (all clean)
```
$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun run lint:file -- "src/server/app.ts" "src/server/main.ts" "tests/server/app.test.ts"
$ biome check src/server/app.ts src/server/main.ts tests/server/app.test.ts
Checked 3 files in 38ms. No fixes applied.

$ bun test tests/server/app.test.ts
 7 pass, 0 fail, 24 expect() calls

$ bun test tests/server/main.test.ts
 3 pass, 0 fail, 9 expect() calls
```

pre-commit hook (`bun run scripts/docs-check.ts`) ran clean on commit — purely additive to the already-documented `src/server` subsystem, no new subsystem, so `docs/architecture.md` needed no edit for this task.

## Files changed
- `/Users/inderjotsingh/ai/src/server/app.ts` — `ServerDeps` gains `runsRoot: string`.
- `/Users/inderjotsingh/ai/src/server/main.ts` — `deps` literal gains `runsRoot`.
- `/Users/inderjotsingh/ai/tests/server/app.test.ts` — all four `ServerDeps` literals gain `runsRoot` (new `mkdtempSync` fixture).

## Commit
`8564318 feat(server): thread runsRoot into ServerDeps for the Runs endpoints`

## Self-review
- Confirmed via grep there was exactly one non-test construction site (`main.ts`); no site was missed.
- Test fixture uses a real `mkdtempSync` temp dir (consistent with the existing `uploadsDir` fixture pattern in the same file) rather than a bare string, so any future accidental read still resolves to a real, isolated dir.
- `runsRoot` is a required field per the brief's Task 8 interface note (`RunsDeps = { runsRoot: string }` is a structural subset of `ServerDeps`), so no `?` was added.
- Typecheck is the load-bearing gate here (a required field breaks any un-updated `ServerDeps` literal) — verified clean everywhere `ServerDeps` is constructed.

## Concerns
None. Only one non-test construction site (`src/server/main.ts`) existed alongside the four test literals; all five were updated and verified. No other `ServerDeps`-shaped construction found in the repo.
