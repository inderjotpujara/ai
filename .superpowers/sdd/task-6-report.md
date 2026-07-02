# Task 6 Report: CRAG Grader + Bounded Corrective Retrieve

## Summary

Implemented Task 6 (Grounded Verification / CRAG) following strict TDD. Three functions added to support retrieval grading and corrective retrieval:

- **`gradeRetrieval(query, chunks, deps): Promise<CragGrade>`** — Routes model output to CORRECT/AMBIGUOUS/INCORRECT enum
- **`rewriteQuery(query, deps): Promise<string>`** — Rewrites query via router model, returns first line or falls back to original
- **`correctiveRetrieve(query, recall, deps): Promise<{query, chunks}>`** — Bounded single-pass corrective flow: rewrite query → re-recall

## Files Created/Modified

- **`src/verification/crag.ts`** (28 lines) — Implements three export functions
- **`tests/verification/crag.test.ts`** (31 lines) — Two tests: label→enum mapping, rewrite+recall flow

## TDD Steps

### Step 1 & 2: Failing Tests ✅
Created test file; ran `bun test` → FAIL (file not found).

### Step 3: Implementation ✅
Implemented per brief:
- `gradeRetrieval`: prompt → `generate()` → parse to enum (CORRECT/AMBIGUOUS/INCORRECT)
- `rewriteQuery`: prompt → `generate()` → `.split('\n')[0]?.trim()` (no non-null assertion; use optional chain)
- `correctiveRetrieve`: call rewriteQuery → re-recall with rewritten query → return both

### Step 4: GREEN + Lint Clean ✅
```
bun test: 2 pass, 0 fail
bun run typecheck: pass (no errors)
bun run lint:file: pass (no warnings/errors)
```

Key fixes:
- Replaced non-null assertion `[0]!` with optional chain `[0]?`
- Fixed imports: `type` imports before value imports
- Fixed string concat to template literal in tests
- Properly typed `deps` as `VerifyDeps` (not `any`)

### Step 5: Commit ✅
```
fb364bf feat(verification): CRAG retrieval grader + bounded corrective retrieve
```
Git hooks ran: `docs-check` passed (no new src subsystems).

## Self-Review

**Code Quality:**
- Functions are small, focused, pure (no side effects)
- Type-safe: all imports properly typed, no `any` escapes
- Error handling: fallbacks (e.g., `|| query` if rewrite fails)

**Test Coverage:**
- ✅ Label→enum mapping (INCORRECT → CragGrade.Incorrect)
- ✅ Query rewrite + single re-recall flow
- Mocks `deps.generate()` + custom `recall()` injected
- Tests are isolated, deterministic

**Linting:**
- No console.log, no type errors, no style violations
- All imports organized alphabetically
- Imports split into `type` and value; `type` comes first

## Concerns

**None.** Implementation is clean, follows brief exactly, passes all checks.

## Test Output

```
bun test v1.3.11
 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [9.00ms]
```

---

**Status:** COMPLETE ✅  
**TDD:** RED → GREEN ✅  
**Typecheck:** Pass ✅  
**Lint:** Clean ✅  
**Commit:** fb364bf ✅

## Final-review fix (#1 bar.done + #2 docs honesty)

Applied two whole-branch-review fixes to Slice 14 provisioning (branch `slice-14-provisioning`, base HEAD `92f3500`). Scope was strictly these two items — nothing else touched.

### Fix #1 (Important) — `bar.done()` on terminal progress event

**Problem:** `src/provisioning/provisioner.ts`'s `onProgress` callback (in the sequential download loop, step 6 of `runProvision`) routed every `DownloadProgress` event — including the terminal `Done`/`Failed` phase — through `deps.ui.bar.render(p)`. In TTY mode, `ProgressBar.render()` (`src/provisioning/ui/progress-bar.ts`) writes `\r\x1b[2K<line>` with no trailing newline, so the "100%" finish line for each model was clobbered by the next model's first `\r` write (and the very last model's line was clobbered by the summary output). `ProgressBar.done()` exists specifically to emit the final line *with* a trailing `\n`, but was never called.

**Fix (TDD: red → green):**
1. Added a failing test first in `tests/provisioning/provisioner.test.ts`: extended the fake `ui.bar` to record every `render()` and `done()` call into `barEvents.{render,done}` arrays, and changed the fake provider to emit one intermediate `Downloading` event followed by the terminal `Done` event. New test `'calls bar.done() on the terminal Done event, bar.render() for intermediate events'` asserts `barEvents.render` has exactly 1 entry (the `Downloading` phase) and `barEvents.done` has exactly 1 entry (the `Done` phase).
   - Confirmed RED: `expect(d.barEvents.render).toHaveLength(1)` failed with `Received length: 2` (both events were going through `render`).
2. Implemented the fix in `src/provisioning/provisioner.ts`: imported `DownloadPhase` from `./types.ts` (added to the existing `import type { DownloadProgress, DownloadProvider } from './types.ts'`, now split into a value + type import), and changed the `onProgress` callback to:
   ```ts
   onProgress: (p) =>
     p.phase === DownloadPhase.Done || p.phase === DownloadPhase.Failed
       ? deps.ui.bar.done(p)
       : deps.ui.bar.render(p),
   ```
3. Confirmed GREEN: all 4 tests in `provisioner.test.ts` pass (the 3 pre-existing consent/degrade tests untouched in behavior, plus the new one).

### Fix #2 (Minor) — stop implying LM Studio is routed via `providerFor`

**Problem:** `docs/architecture.md` §13 already honestly notes LM Studio's adapter is implemented + contract-tested but not reachable via `providerFor` (it shares `ProviderKind.MlxServer` with the HF-fetch provider, so `providerFor(MlxServer)` resolves to `createHfFetchProvider`). `README.md` and `docs/ROADMAP.md`, however, described the download protocol as covering "all four runtimes" / "LM Studio delegating" without that caveat — a soft overclaim on two hard-line docs surfaces.

**Exact clauses added** (same sentence, reused verbatim in both files to match tone):
> "LM Studio's delegating adapter is implemented + contract-tested but not yet routed via `providerFor` — it shares the `MlxServer` kind today; wiring it is a logged follow-on."

- **`README.md`** — appended to the Slice-14 Status paragraph (the sentence ending "...doesn't persist them to disk or compute a real checksum yet)."), right after the three-adapters description.
- **`docs/ROADMAP.md`** — added in two spots:
  1. The "Alternate runtimes & the Mac Mini era" blockquote (the "**Slice 14 lays the download half of these**" note that says `DownloadProvider` + `CatalogSource` cover "**all four**" runtimes) — clause appended after the existing live-verify-deferred sentence.
  2. Recommended-sequence item 7 ("✅ shipped, Slice 14 — First-boot model provisioning..."), inline after the "**all four runtimes** (Ollama + LM Studio delegating; llama.cpp + MLX via one shared HuggingFace fetcher)" clause.

No existing deferred-verify statements or the "Slice 14 follow-ons" section were removed or weakened — this only adds the routing caveat alongside them (ROADMAP.md line ~232 already had a more detailed version of this same fact under "Deferred items," which was left untouched).

### `bun run check` (final gate)

```
$ bun run docs:check && bun run typecheck && bun run lint && bun run test
✔ docs-check: living docs present + linked; every src subsystem documented.
$ tsc --noEmit                     → clean, no errors
$ biome check .                    → 6 pre-existing noExplicitAny warnings (all pre-dating this change,
                                      in tests/provisioning/{provisioner,snapshot-source}.test.ts and
                                      tests/resource/ollama-control.test.ts); 0 errors
$ bun test
 367 pass
 2 skip
 0 fail
 772 expect() calls
Ran 369 tests across 117 files. [144.77s]
```
Exit code: 0. `tests/provisioning/provisioner.test.ts` alone: 4 pass, 0 fail. `tests/provisioning/` full suite: 54 pass, 0 fail.

All 4 `noExplicitAny` warnings in `provisioner.test.ts` (lines 45, 65, 69, 131 post-edit) pre-date this change — verified via `git show HEAD:tests/provisioning/provisioner.test.ts` — no new lint issues introduced.

### Commit

`fix(provisioning): call bar.done() on terminal progress + honest LM-Studio-not-routed docs (Slice 14 final review)`
