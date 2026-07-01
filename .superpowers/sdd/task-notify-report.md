# Task Report: notify-model-store

## TDD Evidence

### RED — tests failing before implementation

Running `bun run test:file -- ./tests/resource/model-store.test.ts` before creating `src/resource/model-store.ts` produced:

```
bun test v1.3.11 (af24e281)

tests/resource/model-store.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../../src/resource/model-store.ts' from '/Users/inderjotsingh/ai/tests/resource/model-store.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [18.00ms]
error: script "test:file" exited with code 1
```

### GREEN — all four tests passing after implementation

```
bun test v1.3.11 (af24e281)

 4 pass
 0 fail
 4 expect() calls
Ran 4 tests across 1 file. [19.00ms]
```

### Full suite

After wiring chat.ts:

```
$ tsc --noEmit
(exit 0)

bun test v1.3.11 (af24e281)

 27 pass
 0 fail
 42 expect() calls
Ran 27 tests across 13 files. [300.00ms]
```

Lint (biome check .):
- 0 errors
- 1 info (pre-existing biome.json deprecation NOTICE for `recommended` field — not introduced by this change)

---

## Files Created/Modified

### `src/resource/model-store.ts` (new)
Pure utility module with two exports:
- `projectStorePath(): string` — returns `join(process.cwd(), 'model-images')`
- `isProjectStoreActive(storePath?: string): boolean` — checks for `blobs` or `manifests` subdirectory using `existsSync`; defaults to `projectStorePath()` so callers can omit it while tests pass an explicit temp path.

### `tests/resource/model-store.test.ts` (new)
Four test cases using `mkdtempSync` for isolation, with `afterEach` cleanup via `rmSync`:
1. Empty temp dir → `isProjectStoreActive` returns `false`
2. Dir with `blobs/` subdir → returns `true`
3. Dir with `manifests/` subdir → returns `true`
4. `projectStorePath()` ends with `'model-images'`

### `src/cli/chat.ts` (modified)
- Added import: `import { isProjectStoreActive } from '../resource/model-store.ts';` (placed alphabetically between `hardware.ts` and `ollama-control.ts` imports per biome's sort rules)
- After `warmModel(qwenFast.model)`, added a branch that emits one of the two notice strings to stderr before starting the model/tools setup

---

## Exact Notice Strings

**Active (project store detected):**
```
Using project-local models from ./model-images
```

**Inactive (global store in use):**
```
⚠ Ollama is serving from its global store, not ./model-images. Run "bun run serve" to use this project's local models.
```

Both go to `console.error` (stderr), leaving stdout (`console.log`) solely for the agent's answer, consistent with existing chat.ts patterns.

---

## Self-Review

**What went well:**
- The two-function design keeps `model-store.ts` purely synchronous and testable without any mocking (tests use real temp dirs).
- Early-return style in `isProjectStoreActive` matched the project's stated preference.
- The default parameter approach (`storePath: string = projectStorePath()`) keeps the call site in chat.ts clean while keeping tests fully deterministic.

**Potential improvements / things noticed:**
1. **Placement of notice**: The notice fires after `warmModel` but before the model object and file tools are created. This means if `createFileTools()` fails, the user will have seen the notice with no follow-up answer — a minor UX asymmetry, but harmless and matches the brief's instruction.
2. **`projectStorePath` uses `process.cwd()`**: This is consistent with how `runsRoot: 'runs'` works in the same file (also relative to cwd). If the CLI is ever invoked from a different working directory the path will be wrong, but that is an existing project-wide assumption, not introduced here.
3. **No `blobs`/`manifests` check on missing parent**: If `./model-images` itself doesn't exist, `existsSync(join(storePath, 'blobs'))` returns `false` cleanly — no error thrown, which is the correct behavior.
4. **Biome deprecation NOTICE**: The pre-existing `biome.json` deprecation for `recommended: true` causes `bun run lint` to return exit code 1 in older biome versions but 0 with the current version (checked: exits 0 with only an INFO). This is pre-existing and not introduced by this change.
