# notify-model-store: Feature Report

## Status
COMPLETE — single commit, all checks green, task review approved.

## Commit
`582b32c feat(cli): notify when using project-local model store (./model-images)`

## TDD Evidence

### RED (before implementation)
```
bun run test:file -- ./tests/resource/model-store.test.ts

error: Cannot find module '../../src/resource/model-store.ts'
0 pass, 1 fail, 1 error
```

### GREEN (after implementation)
```
4 pass, 0 fail, 4 expect() calls
Ran 4 tests across 1 file. [19ms]
```

### Full suite
```
bun test:   27 pass, 0 fail (42 expect() calls, 13 files)
typecheck:  exit 0
lint:       0 errors (1 pre-existing INFO notice about biome.json deprecated field — not introduced here)
```

## Files Changed
| File | Change |
|------|--------|
| `src/resource/model-store.ts` | New — `projectStorePath()` + `isProjectStoreActive(storePath?)` |
| `tests/resource/model-store.test.ts` | New — 4 TDD tests using real temp dirs |
| `src/cli/chat.ts` | Modified — import + 4-line notice block after `warmModel(...)` |

## Exact Notice Strings
- **Active:** `Using project-local models from ./model-images`
- **Inactive:** `⚠ Ollama is serving from its global store, not ./model-images. Run "bun run serve" to use this project's local models.`

Both go to `console.error` (stderr). stdout unchanged.

## Self-Review / Concerns
- None blocking. Two logged Minors (deferred):
  1. `isProjectStoreActive` could use a single `||` expression instead of two early-return `if`s — style-only, no correctness impact.
  2. Test uses a module-level `let tempDir` rather than `beforeEach`-scoped — correct behavior, marginally less idiomatic.
- `process.cwd()` assumption is consistent with existing `runsRoot: 'runs'` pattern in chat.ts.
- Task reviewer verdict: Spec ✅, Code quality Approved.
