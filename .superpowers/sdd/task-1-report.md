# Task 1 Report — Progress protocol, DownloadProvider interface, dep-free UI (Slice 14)

**Branch:** `slice-14-provisioning`
**Commit:** `75799d6` — `feat(provisioning): progress protocol + tracker + dep-free UI (Slice 14 Task 1)`

## What was built

Exactly the brief's five source files, verbatim code, plus the required doc stub:

- `src/provisioning/types.ts` — `DownloadPhase` enum (string enum, matches repo style), `DownloadProgress` type, `DownloadProvider` type (depends on `ProviderKind` from `src/core/types.ts`).
- `src/provisioning/progress-tracker.ts` — `ProgressTracker` class: monotonic percent clamp (`maxPercent` never regresses) + EWMA speed (`EWMA_ALPHA = 0.3`) derived from byte/time deltas via an injectable `now()` clock for testability.
- `src/provisioning/ui/format.ts` — `formatBytes`, `formatSpeed`, `formatEta`, `renderProgressLine`.
- `src/provisioning/ui/progress-bar.ts` — `ProgressBar` class, thin I/O wrapper (TTY `\r` rewrite vs. non-TTY line-per-update), untested per brief (delegates all logic to tested `renderProgressLine`).
- `src/provisioning/ui/prompt.ts` — `LineInput` type, `stdinInput()` real adapter, `askYesNo`, `selectModels` (generic over `{ recommended: boolean }`), all testable via injected fake input.

Also updated `docs/architecture.md` (required by the repo's pre-commit `docs:check` hook, which fails on any undocumented `src/<subsystem>`): added a `PROV` subgraph node in the module-map Mermaid diagram and a **Provisioning** row in the module table, marked "Slice 14 — in progress, Task 1 of N" — mirroring the exact precedent set by Slice 13's first commit (`4639b3d`), which added a minimal, honest stub for `src/verification/` on its first commit rather than waiting for the slice-close docs pass. This is a structural presence stub only; the full README/ROADMAP/Artifact refresh is deferred to the slice's closing docs commit per repo convention (confirmed via `git log` — e.g. `c8b0da7 docs: bring all four surfaces current through Slice 13`).

## TDD evidence (RED → GREEN)

1. **ProgressTracker**
   - RED: `bun test tests/provisioning/progress-tracker.test.ts` → `error: Cannot find module '../../src/provisioning/progress-tracker.ts'` (0 pass / 1 fail / 1 error).
   - Implemented `types.ts` + `progress-tracker.ts`.
   - GREEN: `4 pass, 0 fail, 4 expect() calls`.

2. **Formatters**
   - RED: `bun test tests/provisioning/ui-format.test.ts` → `error: Cannot find module '../../src/provisioning/ui/format.ts'` (0 pass / 1 fail / 1 error).
   - Implemented `ui/format.ts`.
   - GREEN: `4 pass, 0 fail, 9 expect() calls`.

3. **Prompts**
   - RED: `bun test tests/provisioning/ui-prompt.test.ts` → `error: Cannot find module '../../src/provisioning/ui/prompt.ts'` (0 pass / 1 fail / 1 error).
   - Implemented `ui/prompt.ts`.
   - GREEN: `6 pass, 0 fail, 6 expect() calls`.

4. **ProgressBar** — no test per brief (thin wrapper over tested `renderProgressLine`); created directly.

## Final verification (pristine run, pre-commit)

```
$ bun test tests/provisioning/
14 pass, 0 fail, 19 expect() calls — Ran 14 tests across 3 files.

$ bun run typecheck
$ tsc --noEmit    (clean, no output)

$ bun run lint:file -- src/provisioning/
$ biome check src/provisioning/
Checked 5 files in 3ms. No fixes applied.   (clean)

$ bun run docs:check
✔ docs-check: living docs present + linked; every src subsystem documented.
```

Pre-commit hook (`bun run docs:check`) ran automatically on `git commit` and passed.

## Files changed

- `src/provisioning/types.ts` (new)
- `src/provisioning/progress-tracker.ts` (new)
- `src/provisioning/ui/format.ts` (new)
- `src/provisioning/ui/progress-bar.ts` (new)
- `src/provisioning/ui/prompt.ts` (new)
- `tests/provisioning/progress-tracker.test.ts` (new)
- `tests/provisioning/ui-format.test.ts` (new)
- `tests/provisioning/ui-prompt.test.ts` (new)
- `docs/architecture.md` (modified — Provisioning subsystem stub, see above)

## Self-review findings

- **Code fidelity:** all five source files match the brief's code verbatim, with one required deviation: `bunx biome check --write` (repo's own formatter/import-organizer) reformatted multi-line ternaries/chains and reordered/retyped two imports (`import type` for type-only imports, alphabetical import-name ordering). No logic changed — confirmed by re-running all tests/typecheck after the auto-fix. I additionally hand-removed one genuinely-unused import (`DownloadPhase` in `ui/format.ts` — the brief's own snippet imports it but never references it; `renderProgressLine` uses `p.phase` as a plain string in the template literal, not the enum). This was a lint-driven correction, not a design change.
  - **NOTE for the brief/reviewer:** the brief's Step 7 code block imports `DownloadPhase` in `format.ts` but never uses it — biome's `noUnusedImports` flags this as an error (not a warning) under this repo's config, so it cannot be committed verbatim. Removing the unused import is the only faithful fix; flagging this discrepancy explicitly since the instructions said "use the exact code ... verbatim."
- **No console.log** left in `src/provisioning/` (grep confirmed empty).
- **No new dependency** added — `package.json`/`bun.lock` untouched (confirmed via git status before commit).
- **Enum-over-string-literal-union style**: `DownloadPhase` is a string enum, matching CLAUDE.md's code-style rule.
- **Explicit `.ts` import extensions**: all imports use `.ts`, matching repo convention.
- **Docs hard line**: pre-commit's `docs:check` (structural: "every src subsystem documented") would otherwise block this commit, since it runs unconditionally with no `DOCS_OK` bypass baked into the script (unlike pre-push, which does respect `DOCS_OK=1`). Resolved by adding a minimal, accurate architecture.md stub following the exact precedent of Slice 13's first commit — not a full slice-close docs pass (README/ROADMAP/Artifact are correctly deferred to the slice's closing commit, per repo convention observed in `git log`).
- **Scope discipline**: did not stage or touch pre-existing unstaged changes to `.remember/now.md` or `.superpowers/sdd/task-1-brief.md` (present in git status before this task began) — kept the commit scoped exactly to Task 1's files + the required doc stub.

## Concerns

- None blocking. One minor documented discrepancy (unused `DownloadPhase` import in the brief's `format.ts` snippet) was corrected per lint, as noted above — worth a heads-up to whoever authored the brief in case later tasks' snippets have the same copy-paste artifact.
- The architecture.md stub is intentionally minimal ("Task 1 of N") since Tasks 2+ (Ollama/HF/LM-Studio adapters) don't exist yet; it will need expanding as those land, and the full README/ROADMAP/Artifact refresh is still owed at slice-close.
