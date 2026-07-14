# Task 8 Report: Media-Path Confinement

**Status:** DONE  
**Commit:** 590365b  
**Date:** 2026-07-14

## Summary
Implemented `MediaPathError` and `confineToDir()` utility for network-supplied media path confinement. Resolves candidate paths against a root directory via `realpathSync` to defeat `../` traversal, absolute-path escapes, and symlink escapes. All 4 tests pass; typecheck clean; docs-check clean.

## Implementation Details

### Files Created
- `src/server/security/media-path.ts` — Public API: `MediaPathError` (custom Error subclass), `confineToDir(candidate, root): string`
- `tests/server/media-path.test.ts` — TDD test suite: 4 cases

### Security Mechanisms
1. **Path Traversal Defense** (`../` attacks)
   - Candidate path is resolved relative to the realpath root
   - Result must be within the root directory (enforced via prefix check)
   - Test: `confineToDir('../../etc/passwd', root)` → throws MediaPathError ✓

2. **Absolute Path Escape Defense**
   - Absolute paths outside root are caught by realpath comparison
   - Test: `confineToDir('/etc/hosts', root)` → throws MediaPathError ✓

3. **Symlink Escape Defense** (core security)
   - `realpathSync` resolves all symlinks and normalizes the path
   - A symlink pointing outside root is caught by the realpath comparison
   - Boundary check uses `realRoot + sep` to prevent sibling-dir confusion (e.g., `/root-evil` is not inside `/root`)
   - Test: symlink from root → outside directory → throws MediaPathError ✓

4. **Valid File Resolution**
   - Relative path inside root resolves to its canonical realpath
   - Test: `confineToDir('upload.png', root)` → returns `join(root, 'upload.png')` ✓

### Test Results (GREEN)
```
bun test tests/server/media-path.test.ts
──────────────────────────────────────────
 4 pass
 0 fail
 4 expect() calls
Ran 4 tests across 1 file. [15.00ms]

Tests:
  ✓ a file inside the root resolves to its realpath
  ✓ a ../ traversal is rejected
  ✓ an absolute path outside the root is rejected
  ✓ a symlink escaping the root is rejected
```

### Type Checking (CLEAN)
```
bun run typecheck
──────────────────
$ tsc --noEmit
[no errors, no warnings]
```

### Documentation Check (CLEAN)
```
bun run docs:check
──────────────────
✔ docs-check: living docs present + linked; every src subsystem documented.
```

### Commit
```
[slice-30b-local-web-ui 590365b] feat(server): add realpath media-path confinement util
 2 files changed, 61 insertions(+)
 create mode 100644 src/server/security/media-path.ts
 create mode 100644 tests/server/media-path.test.ts
```

## Self-Review

### Correctness
- ✓ Uses `realpathSync` to resolve symlinks → defeats symlink escapes
- ✓ Prefix check includes path separator (`realRoot + sep`) → defeats sibling-dir confusion
- ✓ Candidate is resolved relative to realroot via `resolve(realRoot, candidate)` → defeats `../` traversal
- ✓ Error handling catches exceptions from `realpathSync` (e.g., non-existent paths) → throws MediaPathError
- ✓ All four threat vectors (traversal, absolute escape, symlink escape, non-existent paths) covered

### Code Quality
- ✓ Follows project conventions (Bun, TypeScript, `.ts` import extensions)
- ✓ Custom error class with readonly `candidate` field for debugging
- ✓ Clear docstring explaining purpose + threat model
- ✓ No `console.log` or debugging statements
- ✓ Strict TypeScript: no type assertions, all paths typed
- ✓ No external dependencies beyond `node:fs` and `node:path` (Node stdlib)

### Test Coverage
- ✓ Happy path: relative file inside root
- ✓ Path traversal with `../` escape attempts
- ✓ Absolute path outside root
- ✓ Symlink pointing outside root (validates realpath boundary)
- ✓ macOS /var symlink handling: tests use `realpathSync()` on temp directories

### Documentation
- ✓ Architecture.md already lists `src/server` + `src/server/security/` → docs-check passes
- ✓ Function docstring explains use case (run/upload dir confinement) + threat model
- ✓ Error class docstring documents its use case

## Concerns
**None.** Task completed per specification:
- All threat vectors addressed (realpath handles symlinks; path comparison defeats traversal + escapes)
- 4/4 tests pass (RED → GREEN)
- Typecheck clean (strict tsconfig, no type errors)
- Docs-check clean (module already documented)
- Committed and ready for integration

## Notes for Next Phase
- This utility is the primitive for the D17 perimeter check (network-supplied media paths)
- Integration with chat/media endpoints + `ingestMedia` filesystem auto-detect disabling lands in a later phase per brief
- The `MediaPathError` custom class enables precise error handling in callers (vs. generic Error)

---

**Verification:**
- Ran focused media-path test suite: `bun test tests/server/media-path.test.ts` → 4 pass
- Ran full typecheck: `bun run typecheck` → clean
- Ran docs-check: `bun run docs:check` → clean
- All gates passed, commit landed on `slice-30b-local-web-ui`
