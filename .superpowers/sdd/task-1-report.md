# Task 1 Report: Add `RuntimeKind` + extend `ProviderKind` + `downloadKindFor` (Slice 18)

## Status: DONE

## What was implemented

Followed the task brief (`.superpowers/sdd/task-1-brief.md`) verbatim, via TDD:

1. **`src/core/types.ts`** — replaced the two-member `ProviderKind` (previously
   overloaded as both download-routing and inference-routing) with a four-member
   download-side `ProviderKind` (`Ollama | HfGguf | HfSnapshot | LmStudio`), added a
   new inference-side `RuntimeKind` enum (`Ollama | MlxServer | LmStudio`), and
   renamed `ModelDeclaration.provider: ProviderKind` → `ModelDeclaration.runtime:
   RuntimeKind`.
2. **`src/core/kind-map.ts`** (new) — pure helper `downloadKindFor(runtime, shape):
   ProviderKind` mapping an inference runtime + repo shape to the download provider
   that fetches it: LmStudio→LmStudio, MlxServer→HfSnapshot, Ollama+gguf-file→HfGguf,
   Ollama+other shape→Ollama.
3. **`tests/core/kind-map.test.ts`** (new) — the 4 tests specified in the brief,
   verbatim.

## TDD evidence

**RED** — before `kind-map.ts` existed:
```
$ bun run test:file -- "tests/core/kind-map.test.ts"
$ bun test tests/core/kind-map.test.ts
error: Cannot find module '../../src/core/kind-map.ts' from '/Users/inderjotsingh/ai/tests/core/kind-map.test.ts'
0 pass
1 fail
1 error
Ran 1 test across 1 file. [14.00ms]
```

**GREEN** — after implementing `types.ts` + `kind-map.ts`:
```
$ bun run test:file -- "tests/core/kind-map.test.ts"
$ bun test tests/core/kind-map.test.ts
 4 pass
 0 fail
 4 expect() calls
Ran 4 tests across 1 file. [11.00ms]
```

## Files changed

- `src/core/types.ts` (modified) — `ProviderKind` redefined (2→4 members),
  `RuntimeKind` added, `ModelDeclaration.provider` → `.runtime`.
- `src/core/kind-map.ts` (new) — `RepoShape` type + `downloadKindFor()`.
- `tests/core/kind-map.test.ts` (new) — 4 tests.

Commit: `1c0723e` — "feat(core): split ProviderKind (download) from RuntimeKind
(inference) + downloadKindFor"

## Self-review

- Enum members, doc comments, and the helper signature match the brief's exact
  interfaces verbatim — no deviation.
- Per the task's explicit instructions, did NOT touch any consumer file
  (registry.ts, runtime files, discovery, select-hook, etc.) — those are expected
  to break and are fixed in Tasks 2-4 of this slice's WS1.
- Did NOT run the full `bun run typecheck` or full `bun test` suite, per
  instructions — only the scoped `tests/core/kind-map.test.ts` (the broader build
  is expected red by design until Tasks 2-4 land).
- The pre-commit `docs:check` hook ran automatically on commit and passed (no
  living-doc gap introduced — `kind-map.ts` lives inside the already-documented
  `src/core` subsystem in `docs/architecture.md`, and no new subsystem was added).
- Only the three files specified in the brief (`src/core/types.ts`,
  `src/core/kind-map.ts`, `tests/core/kind-map.test.ts`) were staged and
  committed, confirmed via `git status --short` before commit. Other unrelated
  working-tree modifications present at the time (`.remember/now.md`,
  `.superpowers/sdd/progress.md`, `.superpowers/sdd/task-1-brief.md` —  from the
  surrounding slice orchestration, not this task) were deliberately left
  unstaged/untouched.

## Concerns

None. The task was self-contained and unambiguous; no deviations from the brief
were needed.
